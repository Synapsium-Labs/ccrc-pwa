# Overlord W1a: the hook reports every start to the server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** at every SessionStart of a session that is not a child, except a fork, the hook reports the start (its
source, the conversation's uuid, the model, the registry row's incarnation) to a new door,
`POST /api/sessions/:id/start`, which records it in `continuity_starts`. A report the server could not take for a
reason that can pass (no answer, a timeout, a server error, or `stale-uuid` in the `/clear` race) is spooled and sent
again, a bounded number of times, at the session's next SessionStart or UserPromptSubmit; never on the tool-call
path.

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
- The spawn sets `CCRC_SESSION_GENERATION` in the session's environment (`ccd/ccd#_spawn_start`'s `genenv`), from
  `_reg_generation_read`, which passes only `_reg_generation_valid`: a 36-character lowercase uuid naming the registry
  row's life. This programme calls that life the row's **incarnation** (the index's slug
  `generation-means-one-life`); the tree's identifiers keep their names.
- The tree's one attribution gate is `server/src/coord/attribution.ts#attributionVerdict`. Inside
  `registerCoordRoutes` it is wrapped in `requireAttribution`, a closure local to that function, so a routes file of
  its own cannot import it; such a file takes it injected, as a dependency named `attribute` over
  `attributionVerdict` (the landing and claim lanes do the same). It checks `fromUuid` against
  `$REG/<id>.uuid` and answers `stale-uuid` (403) on a mismatch and `registry-unmeasurable` (502,
  `shared/refusal.ts`) when the registry cannot be read. The mail door's inline ladder is the older copy. After a
  `/clear` or a fresh start the registry's uuid follows the new conversation within one `_sync_uuid` tick (about 5 s).
- A fork (`source: "fork"`, measured by W0a) shares the pane's session id with a new uuid that the registry never
  follows, so its report would answer `stale-uuid` for good.
- The hook's header says PreToolUse, PostToolUse and Stop "take no lock and wait on nothing"; today's network calls are
  on compact, resume, clear and wake events only.
- `ccd/ccd#_reg_purge` removes every dot-free `$REG/<id>.<field>` file with its row, and `_ws_slug_residue` lists
  them; a suffix with a dot (`<id>.a.b`) is skipped by both, deliberately, so a spool file must be dot-free.
- `ccd/ccrc-api` says its route count in words ("seventy-two" at the branch point) and
  `server/test/ccrc-api.test.ts` pins it (`toHaveLength`) and maps each verb in `WORDS`.
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
  `_hook_timeout`, and a failure that can pass spools. Hook tests use fixture HOMEs. Never print the box token; `ccrc-api` reads it.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. `session-hook*` suites are load-sensitive; re-run a red one alone first.
- **Growth check.** `ccd/session-hook.sh` grows at most 40 net lines (`GROWTH_LIMIT`); the report, the spool and the
  resend all in `_hook_start_report` (with its send helper `_hook_start_send`), and nothing else.
- **Migration slot** re-measured before merge; tests find it by `findIndex`. Cite by symbol or `@anchor`. No private
  names: fixtures `lane-a-project-a`. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-start-report/departures.md`.
- **New door, every census in the same pull request** (the list above, plus `server/test/secret-mask.test.ts` if a GET
  is added; this piece adds none).

## Review Focus

1. A start is never lost silently: a timed-out, unanswered or `stale-uuid` report is spooled and resent a bounded
   number of times, a resent report is recorded once (idempotent on the hook's report id), and every drop is counted.
2. A child's start and a fork's are not reported, and the hook's start path is never slowed past its bound. The tool
   path (PreToolUse, PostToolUse, Stop) makes no call at all.
3. Attribution: a report whose uuid does not match the registry yet is refused `stale-uuid` and resent, never accepted
   on the session id alone; any other refusal is dropped, counted, not spooled.
4. The spool is purged with its row, and a spool written while its row was being purged is removed by the hook's
   re-check after the write, so it never holds the slug (ruling R12).

---

### Task 1: The record (`continuity_starts`) and its writer

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: the table)
- Create: `server/src/continuity/continuityStore.ts` (L3 functions over the store's `DatabaseSync`, with one-line
  delegates on `CoordStore`, under the growth check)
- Modify: `server/src/coord/store.ts` (the delegates)
- Modify: `server/test/single-definition/writers-map.test.ts` (`TABLES` gains `continuity_starts`)
- Assumes: C3's row `continuity/**` (card PR A owns it; if this piece merges first, it carries the same byte-identical
  edit to `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`)
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
  rowIncarnation TEXT,                 -- CCRC_SESSION_GENERATION (a lowercase uuid), or null
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
  `fresh: false` and one row; an unknown `source` word is stored as `other`; `rowIncarnation` round-trips as text; the
  migration's slot found by `findIndex`.
- [ ] **Step 2: Run.** Red. **Step 3: Implement** in `practiceCasesStore.ts`'s shape. **Step 4: Run** this suite,
  `test/coord-db.test.ts`, `test/single-definition/writers-map.test.ts`. Green.
- [ ] **Step 5: Commit.** `feat(continuity): continuity_starts, the record of every reported start, and its one writer`

### Task 2: The door

**Files:**
- Create: `server/src/continuity/routes.ts` (L4: `registerContinuityRoutes(app, deps)`; the start door)
- Modify: `server/src/server.ts` (one registration line; growth-checked, shared by lanes: see the index's "Where lanes
  meet")
- Modify: `server/src/auth/gate.ts` (EXEMPT entry, reason: "the hook's report: box token and attribution")
- Modify: `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts` (a `CONTINUITY_SRC` lane source),
  `server/test/rings/fastify-l4.data.ts`, `README.md` (the auth paragraph's counts), `CLAUDE.md` (the box-token
  paragraph's list of `requireMailToken` routes)
- Test: `server/test/continuity-start-route.test.ts` (new)

**Door:** `POST /api/sessions/:id/start`, body
`{ fromId, fromUuid, reportId, source, model?, rowIncarnation?, reportedAt }`. Order: the box token
(`requireMailToken`, 401 on missing); `fromId === :id` (403 `not-owner`); shape (`reportId` matches
`^[A-Za-z0-9_-]{8,64}$`, `source` a string, `reportedAt` a safe integer; `rowIncarnation`, when present, matches the
grammar of `_reg_generation_valid`, a 36-character lowercase uuid, and a value that does not is refused 400
`bad-request`, as #2740 does); the tree's one attribution gate, the injected `attribute` over `attributionVerdict`,
answered through `refuseRoute` (`stale-uuid` 403, `registry-unmeasurable` 502), never a copy; then `insertStart` with `receivedAt` from
`deps.time.clock.wall()`. Answers `202 { ok: true, id, fresh }`. No refusal word is added.

- [ ] **Step 1: Measure** how a routes file of its own takes the injected `attribute` (the landing and claim lanes'
  wiring); name it in the departures note.
- [ ] **Step 2: Failing tests:** no token 401; another session's id 403 `not-owner`; a stale uuid 403 `stale-uuid`; an
  unmeasurable registry 502 `registry-unmeasurable`; a good report 202 with `fresh: true`, the resend 202 with `fresh:
  false`; a bad `reportId` 400; a malformed `rowIncarnation` 400 `bad-request`; an absent one stored as `null`.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run** the new suite, the census suites listed above,
  `test/mail-routes.test.ts`, `test/rings/*.test.ts`, both `tsc` runs. Green.
- [ ] **Step 6: Mutation.** Drop the attribution check: the stale-uuid case goes red. Revert.
- [ ] **Step 7: Commit.** `feat(continuity): POST /api/sessions/:id/start, the hook's start report (box token, attribution)`

### Task 3: The client and the hook

**Files:**
- Modify: `ccd/ccrc-api` (`[sessions.start]='POST|/api/sessions/{id}/start|yes|-'`; the route count word one higher
  than it stands at merge, measured)
- Modify: `server/test/ccrc-api.test.ts` (its `toHaveLength` and `WORDS` follow the new row)
- Modify: `ccd/session-hook.sh` (one function, `_hook_start_report`, with its send helper `_hook_start_send`, as
  #2740 builds it. It runs on SessionStart and UserPromptSubmit only, for a row ccd created (`generation` stands) that
  is not a child, and after the hookstate write, so it never delays the `working` edge (m-B10). The dot-free spool
  `$REG/<id>.startpending` holds, on its first line, `<not-before ms>\t<dropped count>` (the back-off stamp and the
  drop count), and on each later line `<tries>\t<report JSON>`, oldest first, at most `START_PENDING_MAX` (20). A
  pass runs once `START_RESEND_BACKOFF_MS` (30 s) has passed since the stamp: it sends each kept report once inside one
  4 s budget, removes it on a 202, adds a try on `stale-uuid` and drops it at `START_RESEND_TRIES` (5), drops and
  counts any other refusal, and ends at the first send with no answer, which keeps the rest. On SessionStart, unless
  the payload's `source` is `fork`, it then builds the body with `jq` from the payload's `session_id`, `source` and
  `model` and the environment's `CCRC_SESSION_GENERATION`, and sends it through `_hook_timeout 4 ccrc-api sessions
  start` unless the pass found the server silent; no answer, a 5xx or `stale-uuid` keeps it with 0 tries, any other
  refusal is dropped and counted. The spool is written to a dot-free temp name and renamed, and removed when it holds
  no report and no drop. **After the write it re-checks `generation`, and removes the spool if the row is gone, as
  the join record does** (ruling R12): a purge that ran during the 4 s send would otherwise leave a spool that holds
  the slug for ever (`_ws_slug_free` refuses while any dot-free field stands). No `ccd/ccd` edit: `_reg_purge` and
  `_ws_slug_residue` take the spool by their glob)
- Test: `server/test/session-hook-start-report.test.ts` (new, fixture HOME, a stub `ccrc-api` that records its argv and
  answers what the case sets), the `_reg_purge` suite (measure: `grep -ln '_reg_purge\|_ws_slug_residue' server/test`)

- [ ] **Step 1: Failing tests:**
  - a SessionStart `clear` sends one report with the payload's uuid and `source: "clear"`; a child sends none; a
    `fork` sends none and spools nothing;
  - the stub answering `stale-uuid` leaves one spool line, and the next UserPromptSubmit (the stamp set 31 s back)
    resends it and removes it on 202; a resend inside 30 s makes no call;
  - the stub answering 400 or 403 `not-owner` spools nothing and counts one drop on the spool's first line;
  - the stub hanging past the bound leaves the start path's exit code and stdout unchanged (the anchor and cards still
    print) and one spool line; a resend pass with two lines ends at the first timeout, making one call;
  - a line that has failed 5 times is dropped and counted; at most 20 lines are kept, the oldest dropped and counted;
  - PreToolUse, PostToolUse and Stop with a spool standing make no call (the stub's argv log stays empty);
  - `_reg_purge` removes `startpending` with the row, and `_ws_slug_residue` lists it while it stands;
  - a stub that removes `generation` before answering 5xx (a purge during the send) leaves no spool;
  - on a UserPromptSubmit with a spool to resend, the hookstate is already `working` when the stub is called.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the new suite and the SessionStart suites
  (`grep -ln 'SessionStart' server/test/session-hook*.test.ts`). Green.
- [ ] **Step 5: Mutation.** Skip the spool on `stale-uuid`: the resend case goes red. Resend on PreToolUse too: the
  tool-path case goes red. Skip the re-check after the write: the purge-during-send case goes red. Call the report
  before the hookstate write: the `working` case goes red. Revert each.
- [ ] **Step 6: Commit.** `feat(hook): every non-child SessionStart is reported to the server, spooled and resent on failure`

## Deviations found

- **D-8557, start-report-hook-growth, scope** (2026-11-13) — review 1911's fixes to the start report (one millisecond budget
  for the whole event, the fresh report first, the back-off stamped by how the pass ended and clamped, the sender's
  uuid rewritten on resend, and the answers that keep a report and count a try) put `ccd/session-hook.sh` at +51 net
  code lines against the merge-base, over the growth limit of 40. Waived to 56 by
  `server/test/growth-waivers/D-8557-session-hook.json`: the report must run on the SessionStart path itself, and the
  hook loads no library.

Decisions this plan takes, by slug:

- **start-report-for-every-non-child** — the hook reports the start of every session that is not a child and not a
  fork; the generations lane keeps only the long-lived roles' (the hook cannot know a role; `roleOf` is the server's).
- **start-spool-file** — a report the server did not take, for a reason that can pass, is one line of the dot-free
  spool `$REG/<id>.startpending` (20 reports, 5 tries each), whose first line carries the back-off stamp and the drop
  count; it is purged with the row. It holds no authority and no switch, has one writer (the hook) and is resent,
  never read as truth. Table 3.6a lists it (this programme's spec amendment).
- **start-resend-off-the-tool-path** — the resend runs on SessionStart and UserPromptSubmit only, inside
  `_hook_start_report`, once 30 s have passed since the stamp on the spool's first line, and a send with no answer ends
  the pass; the tool path makes no call.
- **start-report-follows-the-build** — the spool's shape (no separate drop counter), the 30 s back-off, the resend
  folded into `_hook_start_report`, no `ccd/ccd` edit and the 400 for a malformed `rowIncarnation` follow #2740's code
  (the coordinator's ruling on R5).
- **spool-rechecks-its-row** — after writing the spool the hook re-checks `generation` and removes the spool if the
  row is gone, as the join record does, so a purge during the send never orphans it (ruling R12).
- **start-report-after-hookstate** — the report and its resend run after the hookstate write (m-B10).
- **readers-by-the-hold-table** — the hook's reader start and stop reports wait for W1, with the Overlord's readers. In
  W1a a coordinator's running subagent is seen by the hibernate hold table (`background`, an unfinished turn), which is
  the soft precondition's first test.
- **attribution-reused** — the start door calls the tree's one attribution gate, injected as `attribute` over
  `attributionVerdict`, through `refuseRoute`; an unmeasurable registry is 502.
- **row-incarnation-is-text** — the row incarnation the spawn exports as `CCRC_SESSION_GENERATION` is a lowercase
  uuid, stored as `TEXT` (`rowIncarnation`); a malformed value is refused 400, and an absent one is stored as `null`.

## Where things stand

**Needs before it starts:** nothing beyond `main`.

**What depends on it:** the generations piece (it mints from `continuity_starts`); the renewal-act piece (the receipt's
second half is a reported start); W1's loaded-file report and witness extend the same door file.

**Open questions for the operator:** none.
