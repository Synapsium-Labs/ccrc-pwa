# Overlord W1a: the hook reports every start to the server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** at every SessionStart of a session that is not a child, the hook reports the start (its source, the
conversation's uuid, the model, the registry generation) to a new door, `POST /api/sessions/:id/start`, which records
it in `continuity_starts`. A report the server could not take is spooled and sent again at the session's next hook
event.

**Why:** every start is a generation (C36, H12): a planned renewal, a crash restart, a swap landing and a wake each mint
the next one, and "from W1a the hook of every long-lived role reports its SessionStart through the hook's report door,
with the box token and attribution". A start the server did not receive "is reported again when the server is back,
and mints its generation then" (§3.3.11). This piece is the report and its record only; the generations piece mints
from the record.

**Architecture:** the hook (fleet box) calls `ccrc-api sessions start` with a short timeout; the door (L4, in a new
routes file of context C3, `server/src/continuity/routes.ts`) checks the box token and attribution, then calls the
store's one writer; the record is an append-only table. No decision is taken at the door beyond validation. One pull
request.

**Tech Stack:** bash (`ccd/session-hook.sh`, `ccd/ccrc-api`), TypeScript (ESM), `node:sqlite`, Fastify, vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.11 (H12: "Every start mints a generation"; the
re-report of a start the server did not receive), Table 11.1e row "The hook's reports" (start in W1a; witness, reader
start and stop, model switch, and the loaded-file report in W1), §11.2 (Table 11.2: the hook's reports group, "the box
token and attribution, a short timeout", `view`, `EXEMPT`), Table 3.6a.

## What exists today

- The hook makes no report to the server: its only server calls are `_hook_roster_card`'s `ccrc-api runs list`
  (through `_hook_timeout 4`) and the approval wait.
- `ccd/ccrc-api` maps verbs to routes in `ROUTES` (`[runs.dispatch]='POST|/api/runs/{id}/dispatch|yes|-'`); it reads
  the box token and the server address itself.
- The spawn sets `CCRC_SESSION_GENERATION` (the registry row's generation) in the session's environment
  (`ccd/ccd#_spawn_start`'s `genenv`).
- The mail door's attribution gate (`server/src/coord/routes.ts`, `POST /api/mail`, checks 5.5 and 6) checks
  `fromUuid` against `$REG/<id>.uuid` and answers `stale-uuid` (403) on a mismatch. After a `/clear` or a fresh start
  the registry's uuid follows the new conversation within one `_sync_uuid` tick (about 5 s).
- Every box-token door is counted: `server/test/box-token-census.test.ts` (lane sources, `WORDS`),
  `server/test/auth-gate.test.ts` (`ROUTES`, the EXEMPT keys, two prose counts) with one EXEMPT entry per route in
  `server/src/auth/gate.ts`, `server/test/rings/fastify-l4.data.ts` (`FASTIFY_L4_ALLOWLIST`), and the README's auth
  paragraph and `CLAUDE.md`'s box-token paragraph, which the census reads.
- Migrations: `server/src/coord/schema.ts#MIGRATIONS`, 63 at the branch point.

## Global Constraints

- **Architecture (`CLAUDE.md`).** The door is L4 and decides nothing: it validates and calls the store. The table has
  one writer, `continuityStore.ts#insertStart`, named in `server/test/single-definition/writers-map.test.ts`. The new
  routes file is a lane source of its own in the census (as `ledgersRoutes.ts` is). Additive wire: nothing crosses the
  fleet frame; the request body is a new door's. A guard ships with a test that goes red without it.
- **SAFETY (`CLAUDE.md`).** No ccd verb. The hook never blocks a start on the server: the call is bounded by
  `_hook_timeout`, and any failure spools. Hook tests use fixture HOMEs. Never print the box token; `ccrc-api` reads it.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. `session-hook*` suites are load-sensitive; re-run a red one alone first.
- **Growth check.** `ccd/session-hook.sh` grows at most 40 net lines (`GROWTH_LIMIT`); put the report and the spool in
  one function.
- **Migration slot** re-measured before merge; tests find it by `findIndex`. Cite by symbol or `@anchor`. No private
  names: fixtures `lane-a-project-a`. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-start-report/departures.md`.
- **New door, every census in the same pull request** (the list above, plus `server/test/secret-mask.test.ts` if a GET
  is added; this piece adds none).

## Review Focus

1. A start is never lost silently: a refused or timed-out report is spooled and resent, and a resent report is recorded
   once (idempotent on the hook's report id).
2. A child's start is not reported (its wave is its renewal), and the hook's start path is never slowed past its bound.
3. Attribution: a report whose uuid does not match the registry yet is refused `stale-uuid` and resent, never accepted
   on the session id alone.

---

### Task 1: The record (`continuity_starts`) and its writer

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: the table)
- Create: `server/src/continuity/continuityStore.ts` (L3 functions over the store's `DatabaseSync`, with one-line
  delegates on `CoordStore`, under the growth check)
- Modify: `server/src/coord/store.ts` (the delegates)
- Modify: `server/test/single-definition/writers-map.test.ts` (`TABLES` gains `continuity_starts`)
- Modify: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (C3's row: `continuity/**`, if absent)
- Test: `server/test/continuity-starts-store.test.ts` (new), `server/test/coord-db.test.ts`

**Schema:**

```sql
CREATE TABLE continuity_starts (
  id           INTEGER PRIMARY KEY,
  sessionId    TEXT NOT NULL,
  reportId     TEXT NOT NULL,          -- the hook's own id for this report, so a resend is one row
  uuid         TEXT NOT NULL,          -- the conversation that started
  source       TEXT NOT NULL,          -- startup | resume | clear | compact | fork | other
  model        TEXT,                   -- as the payload carries it, or null
  regGen       INTEGER,                -- CCRC_SESSION_GENERATION, or null
  reportedAt   INTEGER NOT NULL,       -- the hook's clock, ms (data only)
  receivedAt   INTEGER NOT NULL,       -- the server's clock, ms: what every reader ages from (§11.5)
  UNIQUE (sessionId, reportId)
);
CREATE INDEX continuity_starts_by_session ON continuity_starts(sessionId, receivedAt);
```

**Interfaces:** `insertStart(row): { ok: true; id: number; fresh: boolean } | { ok: false; kind: 'write-failed' }`
(`fresh: false` on a resend that hit the unique key); `startsSince(sinceId): StartRow[] | { ok: false }` (the
generations lane's read).

- [ ] **Step 1: Failing tests:** insert then read back; a second insert with the same `(sessionId, reportId)` answers
  `fresh: false` and one row; an unknown `source` word is stored as `other`; the migration's slot found by
  `findIndex`.
- [ ] **Step 2: Run.** Red. **Step 3: Implement** in `practiceCasesStore.ts`'s shape. **Step 4: Run** this suite,
  `test/coord-db.test.ts`, `test/single-definition/writers-map.test.ts`. Green.
- [ ] **Step 5: Commit.** `feat(continuity): continuity_starts, the record of every reported start, and its one writer`

### Task 2: The door

**Files:**
- Create: `server/src/continuity/routes.ts` (L4: `registerContinuityRoutes(app, deps)`; the start door)
- Modify: `server/src/server.ts` (one registration line)
- Modify: `server/src/auth/gate.ts` (EXEMPT entry, reason: "the hook's report: box token and attribution")
- Modify: `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts` (a `CONTINUITY_SRC` lane source),
  `server/test/rings/fastify-l4.data.ts`, `README.md` (the auth paragraph's counts), `CLAUDE.md` (the box-token
  paragraph's list of `requireMailToken` routes)
- Test: `server/test/continuity-start-route.test.ts` (new)

**Door:** `POST /api/sessions/:id/start`, body `{ fromId, fromUuid, reportId, source, model?, regGen?, reportedAt }`.
Order: the box token (`requireMailToken`, 401 on missing); `fromId === :id`; the attribution gate the mail door uses
(registry measured; `stale-uuid` 403; `registry-unmeasurable` 503), reusing its function, not a copy; shape
(`reportId` matches `^[A-Za-z0-9_-]{8,64}$`, `source` a string, `reportedAt` a safe integer); then `insertStart` with
`receivedAt` from `deps.time.clock.wall()`. Answers `202 { ok: true, id, fresh }`. Refusal words are the mail door's
existing ones; none is added.

- [ ] **Step 1: Measure** the mail door's attribution function (its name and whether it is exported); if it is inline,
  the first commit of this task extracts it unchanged (a characterization test pins the mail door's 403s first).
- [ ] **Step 2: Failing tests:** no token 401; another session's id 403; a stale uuid 403 `stale-uuid`; an unmeasurable
  registry 503; a good report 202 with `fresh: true`, the resend 202 with `fresh: false`; a bad `reportId` 400.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run** the new suite, the census suites listed above,
  `test/mail-routes.test.ts`, `test/rings/*.test.ts`, both `tsc` runs. Green.
- [ ] **Step 6: Mutation.** Drop the attribution check: the stale-uuid case goes red. Revert.
- [ ] **Step 7: Commit.** `feat(continuity): POST /api/sessions/:id/start, the hook's start report (box token, attribution)`

### Task 3: The client and the hook

**Files:**
- Modify: `ccd/ccrc-api` (`[sessions.start]='POST|/api/sessions/{id}/start|yes|-'`)
- Modify: `ccd/session-hook.sh` (`_hook_start_report`: on SessionStart, unless `$REG/<id>.child` exists, build the body
  with `jq` from the payload's `session_id`, `source` and `model` and the environment's `CCRC_SESSION_GENERATION`, call
  `_hook_timeout 4 ccrc-api sessions start`; on any answer but 202, write the body to `$REG/<id>.start-pending.<reportId>`;
  at the start of every later hook event of that session, resend each pending file once and remove it on a 202)
- Test: `server/test/session-hook-start-report.test.ts` (new, fixture HOME, a stub `ccrc-api` that records its argv and
  answers what the case sets)

- [ ] **Step 1: Failing tests:** a SessionStart `clear` sends one report with the payload's uuid and `source: "clear"`;
  a child sends none; the stub answering 403 leaves one pending file, and the next UserPromptSubmit resends it and
  removes it on 202; the stub hanging past the bound leaves the start path's exit code and stdout unchanged (the anchor
  and cards still print) and one pending file; at most 20 pending files are kept (the oldest dropped first, each drop
  counted in `$REG/<id>.start-pending.dropped`).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the new suite and the SessionStart suites
  (`grep -ln 'SessionStart' server/test/session-hook*.test.ts`). Green.
- [ ] **Step 5: Mutation.** Skip the spool on a non-202: the resend case goes red. Revert.
- [ ] **Step 6: Commit.** `feat(hook): every non-child SessionStart is reported to the server, spooled and resent on failure`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **start-report-for-every-non-child** — the hook reports the start of every session that is not a child; the
  generations lane keeps only the long-lived roles' (the hook cannot know a role; `roleOf` is the server's).
- **start-spool-file** — a report the server did not take is spooled as `$REG/<id>.start-pending.<reportId>`, a file
  Table 3.6a does not list. It holds no authority and no switch, has one writer (the hook) and is resent, never read as
  truth. Recorded for the coordinator as a spec gap (Table 3.6a).
- **readers-by-the-hold-table** — the hook's reader start and stop reports wait for W1, with the Overlord's readers. In
  W1a a coordinator's running subagent is seen by the hibernate hold table (`background`, an unfinished turn), which is
  the soft precondition's first test.
- **attribution-reused** — the start door reuses the mail door's attribution gate, extracted unchanged if it is inline.

## Where things stand

**Needs before it starts:** nothing beyond `main`.

**What depends on it:** the generations piece (it mints from `continuity_starts`); the renewal-act piece (the receipt's
second half is a reported start); W1's loaded-file report and witness extend the same door file.

**Open questions for the operator:** none.
