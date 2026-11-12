# Coord-DB migrations that merge in either order Implementation Plan

- **D-8338 (2026-11-12)** — coord-DB migrations merge in either order: every migration has a stable name and declared dependencies, the applied set is stored by name in `coord_migrations` (filled once from the current schema version), the numbered entries on `main` when the build starts are a frozen prefix, new migrations are one `.sql` file each applied in topological order with ties by name, and `user_version` becomes the applied set's size, written only upward (operator approval 2026-11-12, option 2 in its smallest form).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or superpowers:executing-plans) to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every behaviour step is test first.

> **Execution status:** Drafted 2026-11-12 on `origin/main` `3c074f025`, after the operator approved the design. Nothing is built yet. The plan ships in the design's own pull request; the build is a separate pull request per task, or one pull request for Tasks 1 to 7 if the coordinator prefers, with no product code before then.

**Goal:** Two pull requests that each add a coord-DB migration merge in either order, through the merge queue, with no renumbering and no conflict, and every install (fresh, at today's version, or further behind) ends with both applied.

**Why:** Today a migration's identity is its position in `MIGRATIONS`, and `user_version` is a high-water mark, so two independent migration pull requests both claim the next slot and the second to merge renumbers and edits every test that names it. On 2026-11-11 five did at once (spec §1.3).

**Architecture:**
- **The frozen prefix.** `MIGRATIONS` in `server/src/coord/schema.ts` is closed at the length `main` holds when the build starts: 61 on 2026-11-12 (entry 61 is `nodes.reportedSweep`, D-8386, #2699), re-measured on `origin/main` before the runner's pull request and before its merge. Entry *k* is named `legacy-<k>` (three digits) and is declared after `legacy-<k-1>`. No entry is added, edited or renumbered again.
- **Named migrations.** Each new migration is one file, `server/src/coord/migrations/<yyyy-mm-dd>-<kebab-words>.sql`. Its file name is its name forever. An optional first line `-- after: <name>, <name>` declares what it must follow; every named migration follows `legacy-<L>` without saying so.
- **The registry** (L1, pure): the prefix and the named files as one list of `{ name, after, sql }`, checked for bad names, shared names, dependencies that name nothing and cycles, and ordered topologically with ties broken by name in byte order.
- **The applied set**: a table `coord_migrations (name TEXT PRIMARY KEY, appliedAt INTEGER)`. The first migration a build applies to a file writes, in its own transaction, `legacy-001` to `legacy-<v>` for the file's `user_version` *v* (the one-time backfill; `appliedAt` NULL means "applied before the set was kept"). Up to the prefix's end the version is the authority over the rows.
- **The open decision** (L1, pure): from the registry, the stored version and the stored rows, `planMigrationOpen` answers `current`, `apply` (what the set is, whether the first transaction rewrites it, what to run in order) or `newer` (rule 3: read as it is, migrate nothing, write nothing).
- **The runner** (`openCoordDb`, L3): decides through `planMigrationOpen` and acts. Each migration is one transaction holding its SQL, its `coord_migrations` row and `PRAGMA user_version = <size of the applied set after it>`, so the version only ever goes up and still counts one per migration for the snapshot keeper.
- **The guards**: a census test (names never shared, grammar, dependencies, no cycle, the prefix closed, no test naming a position past it) and an add-only rule for landed migration files in the CI ledger guard.

**Tech Stack:** TypeScript (ESM) on Node's `node:sqlite` `DatabaseSync`; vitest; the CI guard script `.github/ci/ledger-guard.mjs` (plain Node ESM); `deploy/build-release.sh` (bash).

**Spec:** `docs/superpowers/specs/2026-11-11-coord-migrations-commute-design.md`: §0 (the approval and the four details settled while writing this plan), §5, §7.2 (the smallest change), §7.4 (existing installs), §8 (the twelve tests) and §9 (O1 to O4, ruled in §0).

**Measured on `3c074f025`** (the facts the tasks rest on):
- `server/src/coord/db.ts` owns the runner: `openCoordDb(dbPath)` (one caller, `server/src/index.ts`), `CoordDbUnmigratable`, `describeMigrationProgress(current, v)`, `shouldRemoveMigrationFailureArtifact`, and re-exports `COORD_SCHEMA_VERSION`.
- `server/src/coord/schema.ts` is pure data: it imports only `TERMINAL_RUN_STATES` from `shared/api.ts`, exports `MIGRATIONS` (61 entries, each with a `── k: user_version k-1 -> k` banner) and `COORD_SCHEMA_VERSION = MIGRATIONS.length`. Only `db.ts` imports it at runtime; every other mention in `server/src` and `shared/` is a comment. It must stay pure, so the directory loader is a module of its own.
- `server/src/coord/store.ts` (`CoordStore`) takes an opened `DatabaseSync` and reads neither `user_version` nor `MIGRATIONS`. It does not change, and neither do its tests.
- `deploy/coordination-snapshot.mjs` reads `user_version` from the file header to keep one snapshot "from before a schema migration" (`uv < refUv`). It does not change: the version still rises by one per migration.
- 11 test files import `COORD_SCHEMA_VERSION` from `../src/coord/db.js`, one (`coord-db.test.ts`) from `../src/coord/schema.js`; 86 assertions in 13 files name it.
- Count pins in `server/test/coord-db.test.ts`: `expect(COORD_SCHEMA_VERSION).toBe(61)` twice and `expect(MIGRATIONS.length).toBe(61)`, under the comment list naming `MIGRATIONS[0]` to `MIGRATIONS[60]`; the banner test "every entry carries its own banner, numbered 1..N in order".
- `buildAt` in `coord-db.test.ts` mocks `../src/coord/schema.js` with `{ ...actual, MIGRATIONS: cut, COORD_SCHEMA_VERSION: cut.length }` to stand in for an older build.
- Hand rollbacks: `run-close-switch.test.ts` ("migration 54 adds the claimant-gone group …") opens a fresh file, drops every object entries 54 to 61 made, and sets `PRAGMA user_version = 53`; each new numbered entry has added its own `DROP` there. 20 more tests in `coord-db.test.ts` (and `collect-lane-restore-wording.test.ts`, `coordination-snapshot.test.ts`) build a raw file at a low version without the runner.
- Rule-3 fakes: `coord-db.test.ts` sets `COORD_SCHEMA_VERSION + 7` and `+ 3` (three times) and, in "a database from a NEWER build still READS", the literal `PRAGMA user_version = 99`; `landing-line-migration`, `landing-journal-migration`, `collect-lane-migration` and `ledgers-migration` set `COORD_SCHEMA_VERSION + 1`.
- `server/package.json`'s `build` is `tsc`, which copies no `.sql`; `deploy/build-release.sh` checks `server/dist/server/src/index.js` exists, so a source file `server/src/coord/x.ts` builds to `server/dist/server/src/coord/x.js`.
- `.github/ci/ledger-guard.mjs` (D-6926) classifies `git diff --name-status -M` lines against a `PROTECTED` list and refuses a modify, delete or rename-away; `server/test/ci-ledger-guard.test.ts` tests it.

## Global Constraints

- **No product code in the design's pull request.** This plan and the spec are the whole of it.
- **Test first for every behaviour**, red on the old code, green after. A move keeps its test's assertions and changes only imports; an intended behaviour change is its own commit.
- **Characterization before the runner changes.** Task 4's first commit pins today's legacy behaviour (messages, versions, failure cleanup) through the existing `coord-db.test.ts` suites, green on the old runner, before a line of `db.ts` changes.
- **Rule 1 to rule 4 of `openCoordDb` hold** (forward-only, one transaction per migration, refuse to start rather than start empty, a newer file is read but not migrated, the markdown ledger stays the recovery record). `user_version` is never written downward, and nothing is written when nothing is missing.
- **The frozen prefix is never edited.** No byte of `MIGRATIONS[0..L-1]` changes, and no numbered entry is added after the runner lands.
- **Messages for the frozen entries do not change.** A failure in `legacy-<k>` still reads `… is at schema <k-1> and migration <k> failed …` with `describeMigrationProgress`'s clause, so every existing message assertion stays green.
- **Refusal and reason words are declared once.** New quoted kebab words under `server/src/coord` (`missing-dependency`, `duplicate-name`, `version-set-mismatch` …) live in a declared `as const` union with an `is…` guard that mail-routes' word census admits. Callers compare through the guard or the union, never a fresh string literal.
- **Rings.** `migrationRegistry.ts` and `migrationPlan.ts` are L1: they import nothing at runtime but types and each other. Only `migrationFiles.ts` (L3) touches `node:fs`. `schema.ts` stays pure. All of `server/test/rings` stays green, and `coord/**` is already C5 Coordination in the ring-context table, so no new table row is needed.
- **Machine-neutral, installer-reusable.** Paths resolve from `import.meta.url`; nothing names a box, a home path or an account.
- **No operator act is added.** Migrations still run by themselves at start and a failure is still a failed deploy with the journal tail, so no console control is needed.
- **Gates every task runs:** `(cd server && npx tsc --noEmit -p .)`; `(cd server && npx tsc --noEmit -p test/tsconfig.tests.json 2>&1 | grep -v '^../agent')` prints nothing; `npx vitest run` on the task's tests and on `coord-db.test.ts`, `run-close-switch.test.ts`, the four `*-migration.test.ts` rule-3 files, `coord-policy-rings.test.ts`, `mail-routes.test.ts`, `single-definition-pin.test.ts`, `deviation-refs.test.ts` and `server/test/rings` (at most ten files per call).
- **Commits cite D-8338.** A commit that adds or edits a file under `docs/superpowers/plans/` carries `Ledger-Edit: D-8338` above `Co-Authored-By`.

## Review Focus

- **The version only goes up.** Every path through `planMigrationOpen` and the runner either writes nothing or writes a value above the one stored. Look hardest at the hand-rewind case (version at or below *L*, more rows than it explains) and at a file above *L* whose rows disagree with it.
- **The backfill is exactly once, and inside a migration.** A fresh install whose first migration fails must still leave no file behind (`coord-db.test.ts`: "a fresh install whose first migration fails leaves NO file behind …"), and a file with nothing missing must see no migration transaction at all.
- **Topological order is deterministic.** The same registry and set give the same order on every machine; the tiebreak is a byte compare, never `localeCompare`.
- **Rule 3 keeps today's sentence** ("this build knows …", "reading it as-is and migrating nothing") so the eight existing rule-3 tests stay green without edits.
- **No test names a position past the prefix**, and the one literal pin of *L* lives in the census.
- **`buildAt` still imitates a pre-design build**: with `NAMED_MIGRATIONS` mocked empty, a build cut at entry 54 never runs a named migration over a partial prefix.

---

### Task 1: The migration registry (names, dependencies, problems, order)

**Files:**
- Create: `server/src/coord/migrationRegistry.ts` (L1)
- Test: `server/test/coord-migration-registry.test.ts`

**Interfaces:**

```ts
export interface Migration { readonly name: string; readonly after: readonly string[]; readonly sql: string }

/** `legacy-001` … : the stable name of frozen entry `position` (1-based). */
export function legacyName(position: number): string;
/** Entry k is `legacy-<k>`, after `legacy-<k-1>` (entry 1 after nothing). */
export function legacyMigrations(sqls: readonly string[]): Migration[];

/** The grammar of a named migration's file stem. */
export const NAMED_MIGRATION_NAME: RegExp; // /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/

export const REGISTRY_PROBLEMS = ['bad-name', 'bad-header', 'duplicate-name', 'missing-dependency', 'cycle'] as const;
export type RegistryProblemCode = typeof REGISTRY_PROBLEMS[number];
export function isRegistryProblemCode(x: unknown): x is RegistryProblemCode;
export interface RegistryProblem { readonly code: RegistryProblemCode; readonly names: readonly string[] }

/** One named file: its stem is the name; a first line `-- after: a, b` is the dependency list. */
export function parseNamedMigration(fileName: string, text: string): Migration | RegistryProblem;

export interface Registry {
  readonly legacyCount: number;                 // L
  readonly byName: ReadonlyMap<string, Migration>;
}
export type RegistryBuild = { kind: 'ok'; registry: Registry } | { kind: 'malformed'; problems: readonly RegistryProblem[] };
/** The prefix plus the named files; every named one also after `legacy-<L>`. */
export function buildRegistry(legacySqls: readonly string[], named: readonly Migration[]): RegistryBuild;

/** Every migration of `registry` not in `applied`, dependencies first, ready ones by name in byte order (Kahn). */
export function applyOrder(registry: Registry, applied: ReadonlySet<string>): Migration[];
```

- [ ] **Step 1: failing tests.** In `coord-migration-registry.test.ts`, over inline fixtures (never the real directory):
  - `legacyName(1)` is `legacy-001`, `legacyName(61)` is `legacy-061`; `legacyMigrations` chains each entry after the one before it.
  - `parseNamedMigration`: `2026-11-12-practice-reviews.sql` with no header has `after: []`; a first line `-- after: 2026-11-09-a, 2026-11-10-b` gives both; a stem off the grammar (`Practice.sql`, `2026-11-12_x.sql`, `x.sql`) is `bad-name`; an `-- after:` line anywhere but the first, or with an empty item, is `bad-header`.
  - `buildRegistry`: two migrations with one name, and two that differ only in case, are `duplicate-name` naming both; a named one called like a legacy one is `bad-name`; an `after` naming nothing is `missing-dependency` naming the migration and the missing name; A after B after A is `cycle` naming the members. Every problem is reported, not just the first.
  - `applyOrder`: with nothing applied, the prefix comes first in position order, then the named ones; two named ones with no declared edge come in byte order of name (`2026-11-12-a` before `2026-11-12-b`, and `2026-11-12-Z` cannot exist because of the grammar); a declared `after` beats the tiebreak; an applied set containing `legacy-001` to `legacy-061` and A yields only B; the same inputs give the same order on repeated calls.
  - `isRegistryProblemCode` accepts each member and refuses `'cycles'`, `''`, `null`.
  Run `npx vitest run test/coord-migration-registry.test.ts`: it fails (module missing).
- [ ] **Step 2: implement** `migrationRegistry.ts`. Kahn's algorithm over `byName`, the ready set kept sorted by a plain `<` compare. Names are compared for sharing after lower-casing, so a case-insensitive checkout can never hold two.
- [ ] **Step 3: green**, plus `coord-policy-rings.test.ts`, `mail-routes.test.ts` and `server/test/rings` (the new union's words must pass the census).
- [ ] **Step 4: commit** `feat(coord-db): the migration registry, names, dependencies and order (D-8338)`.

### Task 2: The open decision (version, applied set, rule 3)

**Files:**
- Create: `server/src/coord/migrationPlan.ts` (L1)
- Test: `server/test/coord-migration-plan.test.ts`

**Interfaces:**

```ts
export const NEWER_FILE_WHYS = ['unknown-name', 'version-set-mismatch'] as const;
export type NewerFileWhy = typeof NEWER_FILE_WHYS[number];
export function isNewerFileWhy(x: unknown): x is NewerFileWhy;

export type MigrationOpen =
  | { kind: 'current' }
  | { kind: 'apply'; applied: readonly string[]; rewrite: boolean; todo: readonly Migration[] }
  | { kind: 'newer'; why: NewerFileWhy; version: number; known: number };

/** `rows` is `coord_migrations`' names, or null when the table does not exist. */
export function planMigrationOpen(registry: Registry, version: number, rows: readonly string[] | null): MigrationOpen;
```

The rules, in order (*L* = `registry.legacyCount`, *n* = the registry's size):
1. **Above the prefix's end** (`version > L`): no table, or a row naming a migration the registry lacks, or `version` other than `rows.length`, is `newer` (`unknown-name` when a row is unknown, `version-set-mismatch` otherwise), with `known` = *n*. Otherwise the set is `rows`.
2. **At or below it** (`version <= L`): the set is `legacy-001` to `legacy-<version>`, whatever `rows` holds (the version is the authority, spec §0 item 2). `rewrite` is true when the table is missing or its rows differ from that set.
3. `todo` is `applyOrder(registry, set)`. Empty `todo` is `current` (nothing is written, even when `rewrite` would be true).

- [ ] **Step 1: failing tests**, one per row of this table, over a registry of three legacy entries and two named ones A and B:

  | version | rows | expected |
  |---|---|---|
  | 0 | null | `apply`, set empty, rewrite, todo legacy 1 to 3 then A, B |
  | 2 | null | `apply`, set legacy-001..002, rewrite, todo legacy-003, A, B |
  | 3 | null | `apply`, set legacy-001..003, rewrite, todo A, B (an install at today's version) |
  | 3 | legacy-001..003 | `apply`, no rewrite, todo A, B |
  | 2 | legacy-001..003, A (a hand rewind) | `apply`, set legacy-001..002, rewrite, todo legacy-003, A, B |
  | 4 | legacy-001..003, A | `apply`, no rewrite, todo B |
  | 5 | legacy-001..003, A, B | `current` |
  | 5 | legacy-001..003, A, C (C unknown) | `newer`, `unknown-name` |
  | 7 | legacy-001..003, A, B | `newer`, `version-set-mismatch` (a newer build's version) |
  | 10 | null | `newer`, `version-set-mismatch` (above the prefix with no table) |
  | 4 | legacy-001..003, A, B | `newer`, `version-set-mismatch` (fewer than the rows explain) |

  And a property check over every row: in an `apply` answer, `applied.length + todo.length` is *n*, and `applied.length` equals `version` (the set is rebuilt from the version up to *L*, and must match it above), so the first write (`applied.length + 1`) is always above the stored version.
- [ ] **Step 2: implement** `migrationPlan.ts`.
- [ ] **Step 3: green**, plus the census and ring tests as in Task 1.
- [ ] **Step 4: commit** `feat(coord-db): the open decision over the version and the applied set (D-8338)`.

### Task 3: The named-migration directory, its loader and the build copy

**Files:**
- Create: `server/src/coord/migrations/README.md` (the rules: add only, the name grammar, `-- after:` on the first line, plain SQL, additive only, a migration's own test finds it by name)
- Create: `server/src/coord/migrationFiles.ts` (L3)
- Create: `server/scripts/copy-migrations.mjs`
- Modify: `server/package.json` (`"build": "tsc && node scripts/copy-migrations.mjs"`)
- Modify: `deploy/build-release.sh` (one more check beside the server-build check)
- Test: `server/test/coord-migration-files.test.ts`; `server/test/build-release.test.ts` (one row)

**Interfaces:**

```ts
/** `server/src/coord/migrations` from source, `server/dist/server/src/coord/migrations` from a build (import.meta.url). */
export const MIGRATIONS_DIR: string;
export interface NamedMigrationLoad { readonly migrations: readonly Migration[]; readonly problems: readonly RegistryProblem[] }
/** Every `*.sql` in `dir`, parsed; any other entry but README.md, or a missing directory, is a problem. */
export function loadNamedMigrations(dir?: string): NamedMigrationLoad;
/** The shipped directory, loaded once at import. */
export const NAMED_MIGRATIONS: NamedMigrationLoad;
```

A missing directory is a `bad-name` problem naming the path, so a release that lost the copy refuses to start loudly instead of applying a partial set. The census words stay those of Task 1's union.

- [ ] **Step 1: failing tests.** Over directories made under the test's temp root: two valid files load sorted by name with their `after` lists; a `.txt` file, a subdirectory and a bad stem are problems; `README.md` is allowed; a missing directory is a problem; the real `MIGRATIONS_DIR` exists and loads with no problems. For the copy: run `copy-migrations.mjs` with an output root in a temp directory (the script takes `--out <dir>`, default `dist/server/src/coord/migrations`) and assert the copied set equals the source set. In `build-release.test.ts`, a fixture tree with a server build but no `migrations` directory fails with the new message (this file's GNU tar legs are a known failure on macOS; run the new row with `-t`).
- [ ] **Step 2: implement.** The copy script uses `fs.cpSync(src, out, { recursive: true })` after removing `out`, so a deleted file never survives in `dist/`. `build-release.sh` adds `[ -d "$ROOT/server/dist/server/src/coord/migrations" ] || die "no coord-DB migrations at …/dist after npm run build"`.
- [ ] **Step 3: green**; `(cd server && npm run build)` leaves `dist/server/src/coord/migrations/README.md`.
- [ ] **Step 4: commit** `feat(coord-db): the named-migration directory, its loader and the build copy (D-8338)`.

### Task 4: The runner applies by name

**Files:**
- Modify: `server/src/coord/db.ts` (`openCoordDb`, a named form of the progress clause, `LEGACY_MIGRATION_COUNT`, `COORD_SCHEMA_VERSION`)
- Modify: `server/src/coord/schema.ts` (drop `COORD_SCHEMA_VERSION`; the closing comment says the list is closed and new migrations are files)
- Modify: `server/test/coord-db.test.ts` (the count pins, the one `schema.js` import, `buildAt`, the literal `99`)
- Test: `server/test/coord-migrations-runner.test.ts`

**Interfaces:**

```ts
export const LEGACY_MIGRATION_COUNT: number;   // MIGRATIONS.length, read from schema.ts at import
export const COORD_SCHEMA_VERSION: number;     // LEGACY_MIGRATION_COUNT + NAMED_MIGRATIONS.migrations.length
export function openCoordDb(dbPath: string, registry?: RegistryBuild): DatabaseSync; // default: MIGRATIONS + NAMED_MIGRATIONS
export function describeNamedMigrationProgress(committed: readonly string[], failed: string): string;
```

`LEGACY_MIGRATION_COUNT` is computed in `db.ts` from `MIGRATIONS.length`, not exported by `schema.ts`, so `buildAt`'s cut of `MIGRATIONS` still moves it. The 11 test files that import `COORD_SCHEMA_VERSION` from `db.js` keep working unchanged.

The open, in order: a `malformed` registry throws `CoordDbUnmigratable` naming each problem before `new DatabaseSync`; the 0-byte guard as today; read `user_version` and, if `coord_migrations` exists, its names; `planMigrationOpen`; `newer` warns with today's sentence (`coord.db is at schema <v>, this build knows <COORD_SCHEMA_VERSION> — reading it as-is and migrating nothing …`) and returns; `apply` runs each of `todo` in its own `tx`: `CREATE TABLE IF NOT EXISTS coord_migrations (name TEXT PRIMARY KEY, appliedAt INTEGER)`, then (first one only, when `rewrite`) `DELETE FROM coord_migrations` and the backfill rows with `appliedAt` NULL, then its SQL, its row with `appliedAt = Date.now()`, and `PRAGMA user_version = <rows after it>`. A failure takes today's path (close, the 0-byte cleanup, `CoordDbUnmigratable`) with the numbered message for a `legacy-<k>` and `describeNamedMigrationProgress` for a named one.

- [ ] **Step 1: characterization, green on the old runner.** Run `coord-db.test.ts`, `run-close-switch.test.ts` and the four rule-3 `*-migration.test.ts` files and record them green. Add to `coord-migrations-runner.test.ts` a test that a fresh open ends at `MIGRATIONS.length` with every table entry 61 made, so the move is pinned before it starts.
- [ ] **Step 2: failing tests** in `coord-migrations-runner.test.ts`, each passing a fixture registry (`buildRegistry(MIGRATIONS, [A, B])` with A and B two inline migrations adding one table each) to `openCoordDb`:
  1. **Either order** (spec §8 test 1): a file at *L* opened with {A}, then {A, B}; another opened with {B}, then {A, B}. Both end with the same `coord_migrations` names, the same `sqlite_master` (name and normalised SQL) and `user_version` *L* + 2.
  2. **Existing install** (test 2): a file built by the shipped runner with no named migrations, so at *L* with no table, opened with {A, B}: the table holds `legacy-001` to `legacy-<L>` (`appliedAt` NULL) plus A and B, the version is *L* + 2, and a row written before the open is still there.
  3. **Fresh and behind** (test 3): a new file, and one built to 53 by `openCoordDb(file, buildRegistry(MIGRATIONS.slice(0, 53), []))`, both end with the whole prefix and A and B.
  4. **Rule 3, every trigger** (test 4): an unknown row; a fully migrated file raised to `COORD_SCHEMA_VERSION + 1` and `+ 7`; a file at *L* + 7 with no table opened by a build shipping two; a file whose version is below its rows. Each warns exactly once with today's sentence, migrates nothing, and leaves the version and the rows as they were.
  5. **The version only goes up**: across tests 1 to 3 and 6, record `user_version` after each committed migration (a `tx` spy) and assert each value is above the one before.
  6. **One transaction each** (test 5): a fixture B whose SQL fails halfway leaves no B table, no B row and no version change; the refusal names B and, when A committed first this open, names A.
  7. **Nothing missing writes nothing**: reopening a fully migrated file runs no migration transaction (the `tx` spy sees no call) and leaves `user_version` and the rows as they were.
  8. **A malformed registry refuses** before the file exists: with a cycle, the path is never created.
  Run: they fail.
- [ ] **Step 3: implement** in `db.ts` and trim `schema.ts`'s `COORD_SCHEMA_VERSION` (its doc comment moves with it).
- [ ] **Step 4: the one-time test edits** in `coord-db.test.ts`: the count pins become `expect(LEGACY_MIGRATION_COUNT).toBe(MIGRATIONS.length)` and `expect(COORD_SCHEMA_VERSION).toBe(LEGACY_MIGRATION_COUNT + NAMED_MIGRATIONS.migrations.length)` (the literal *L* moves to Task 6's census); the import of `COORD_SCHEMA_VERSION` moves from `schema.js` to `db.js`; `buildAt` drops `COORD_SCHEMA_VERSION: cut.length` and also mocks `../src/coord/migrationFiles.js` with `NAMED_MIGRATIONS: { migrations: [], problems: [] }`; "a database from a NEWER build still READS" sets `COORD_SCHEMA_VERSION + 38` instead of `99` (the same value today, and no longer a position literal).
- [ ] **Step 5: green**: the new file, every Step 1 file unchanged except the edits of Step 4, and the gates. The 86 `COORD_SCHEMA_VERSION` assertions pass without edits.
- [ ] **Step 6: commit** `feat(coord-db): the runner applies migrations by name, the version counts the applied set (D-8338)`.

### Task 5: Hand rollbacks keep working

**Files:**
- Create: `server/test/coordDbAt.ts` (test helper)
- Modify: `server/test/run-close-switch.test.ts` (the rewind in "migration 54 adds the claimant-gone group …")
- Test: `server/test/coord-migrations-runner.test.ts` (two more cases)

**Interfaces:**

```ts
/** A coord.db at frozen position `n`, built by the real runner over `MIGRATIONS.slice(0, n)` and no named migration. */
export function coordDbAt(file: string, n: number): void;
```

- [ ] **Step 1: failing tests** in `coord-migrations-runner.test.ts`:
  - **A hand rewind below the prefix's end still replays.** Open a file with the shipped registry, drop entry 61's column by hand, set `PRAGMA user_version = 60`, reopen: entry 61 runs again, the rows are `legacy-001` to `legacy-<L>` plus every shipped name, the version is `COORD_SCHEMA_VERSION`. This is the run-close shape, and spec §0 item 2's rule.
  - **`coordDbAt(file, 53)`** gives `user_version` 53, rows `legacy-001` to `legacy-053`, and no table entries 54 onward made.
- [ ] **Step 2: implement** `coordDbAt` (`openCoordDb(file, buildRegistry(MIGRATIONS.slice(0, n), [])).close()`), and point Task 4's "behind" case at it.
- [ ] **Step 3: move the run-close rewind.** Build the file with `coordDbAt(file, 53)`, seed `run_close_settings` (entry 51 inserts its one row) with the same `UPDATE`, close, reopen with the shipped build. The assertions stay byte for byte; the eight-entry `DROP` list and its comment go. A later named migration no longer needs an edit here.
- [ ] **Step 4: green**: `run-close-switch.test.ts`, the runner file, `coord-db.test.ts`.
- [ ] **Step 5: commit** `test(coord-db): hand rollbacks build at a frozen position through the runner (D-8338)`.

### Task 6: The CI guards (names never shared, landed files add only)

**Files:**
- Test (create): `server/test/coord-migrations-census.test.ts`
- Modify: `.github/ci/ledger-guard.mjs` (a second protected row with no escape)
- Modify: `server/test/ci-ledger-guard.test.ts`

- [ ] **Step 1: failing census** in `coord-migrations-census.test.ts`, over the real tree:
  - **Two migrations never share a name**: every stem in `MIGRATIONS_DIR` plus every `legacyName(k)` for `k` in 1 to *L*, lower-cased, is distinct; `buildRegistry(MIGRATIONS, NAMED_MIGRATIONS.migrations)` is `ok` (grammar, dependencies, no cycle); `NAMED_MIGRATIONS.problems` is empty; the directory holds only `.sql` files and `README.md`.
  - **The prefix is closed**: `MIGRATIONS.length` is 61, the one literal pin of *L* (re-measured before merge, spec §0); the banner test in `coord-db.test.ts` is untouched.
  - **Isolation** (spec §8 test 6): each shipped named migration applies on a file at *L* plus only what it declares, transitively.
  - **Order does not matter where nothing is declared** (test 7): applying the shipped named migrations with ties in byte order and again in reverse byte order gives the same `sqlite_master`.
  - **No test names a position past the prefix** (test 10): in every `server/test/**/*.ts` that imports `coord/schema` or `coord/db`, no `user_version = <literal>` above *L* and no `MIGRATIONS[<literal>]` at or past *L*. (Today's highest are `MIGRATIONS[60]` in a comment and the `99` Task 4 removed.)
  The isolation and order cases run over an empty list until the first named migration ships; each asserts its loop ran `NAMED_MIGRATIONS.migrations.length` times so it cannot pass by skipping.
- [ ] **Step 2: failing guard cases** in `ci-ledger-guard.test.ts`: a `M`, `D` or `R` line for `server/src/coord/migrations/<name>.sql` is a violation even with a `Ledger-Edit` trailer and on a `ledger/<programme>` branch; an `A` line passes; `README.md` in that directory may be modified.
- [ ] **Step 3: implement.** `PROTECTED` becomes rows `{ re, escape }`: the two ledger trees keep `Ledger-Edit` and the ledger-branch pass; `^server/src/coord/migrations/[^/]+\.sql$` has neither. The summary names which rule fired. No new workflow job: the existing `ledger-guard` step in `.github/workflows/ci.yml` runs it.
- [ ] **Step 4: green**: both files, `ci-reach-census.test.ts`, `ci-pipeline.test.ts`.
- [ ] **Step 5: commit** `ci(coord-db): migrations never share a name, and a landed one is never edited (D-8338)`.

### Task 7: The prose

**Files:**
- Modify: `server/src/coord/schema.ts` (the header and the closing comment: the list is closed at *L*, the "RE-MEASURE the slot" instruction is for the frozen entries' history only, new migrations go to `migrations/`)
- Modify: `server/src/coord/db.ts` (the rule comment: rule 1 now says "in dependency order", rule 3 names both triggers)
- Modify: `CLAUDE.md` (the coord.db invariant: named migrations, add only, the applied set)
- Modify: `README.md` (§ Fleet coordination: one sentence on named migrations)
- Modify: `docs/superpowers/specs/2026-11-11-coord-migrations-commute-design.md` (an "As built" line under §0 with the merged pull requests)

- [ ] **Step 1:** write the prose; run `deviation-refs.test.ts`, `docs-policy.test.ts`, `private-names.test.ts`, `oss-metadata.test.ts` and every census that reads `CLAUDE.md` or `README.md` (`grep -l "CLAUDE.md\|README.md" server/test/*census*.test.ts`).
- [ ] **Step 2: commit** `docs(coord-db): named migrations in the schema, the runner and the guides (D-8338)`.

## Self-review against the spec

| Spec | Task |
|---|---|
| §0 item 1 (frozen entries named, the one-time backfill) | 1 (`legacyName`), 2 (rules 2 and 3), 4 (the first transaction) |
| §0 item 2 (version authority up to *L*) | 2, 5 |
| §0 item 3 (topological order, fixed tiebreak, refusals) | 1, 4 (test 8) |
| §0 item 4 (trigger b in both directions) | 2, 4 (test 4) |
| §7.2 items 1, 2, 6, 8 | 6, 3, 3, 6 |
| §7.2 item 7 (three test edits once) | 4 (step 4), 5 |
| §8 tests 1 to 12 | 4 (1 to 5), 6 (6, 7, 8, 9, 10, 11), 3 (12) |

## Deviations found

- The spec's §7.2 item 5 put `NAMED_MIGRATIONS` in `schema.ts`. Measured, `schema.ts` is pure data and reading a directory is I/O, so the loader is `migrationFiles.ts` (L3) and `COORD_SCHEMA_VERSION` is computed in `db.ts`, which already re-exports it to 11 of the 12 test files that read it.
- `openCoordDb` gains an optional registry argument. The fixture registries of the either-order and rule-3 tests need it, and it keeps the tests off module mocks; the one production caller passes none.
- The rule-3 fake in "a database from a NEWER build still READS" moves from the literal `99` to `COORD_SCHEMA_VERSION + 38` (the same value on `3c074f025`), so the census can forbid position literals past the prefix without an exemption.
- The landed-files guard is a row of the existing ledger guard, not a new script: the same classification of `git diff --name-status` lines, a different escape (none).
