/**
 * The v1 DDL, and the ONLY place a migration is written.
 *
 * COLUMNS ARE ADDITIVE-ONLY (spec:77). A column is never repurposed and never
 * dropped; nullable means "an older build lacked it".
 *
 * ALL FIVE of this file's enum columns have a designated we-do-not-know
 * member on the READ side (`shared/api.ts`'s `RunState`/`WorkItemState`/
 * `MailKind`/`ProgramState`/`MailDeliveryState`), so a token written by a
 * newer build lands somewhere honest instead of being switched on and
 * rendered as nothing — `PrPhase`'s `'unchecked'` is the precedent
 * (`server/src/registry.ts:133-140`). Deviation D-8 found that this plan's
 * own draft left two of the five — `programs.state` and
 * `mail_deliveries.state` — uncovered on the wire (`programs()` returning a
 * raw `string`; `MailSummary.state` a closed union with no `unknown` arm).
 * Task 3 closed both: `CoordStore.programs()` reads through `isProgramState`,
 * never a cast, and `MailSummary.state: MailDeliveryState` carries
 * `'unknown'` alongside `isMailDeliveryState`. This paragraph is the record
 * that the gap is SHUT, not an open item — do not re-file D-8 against either
 * column, and do not read the inline DDL comments below as still pending.
 *
 * `run_events` and `mail_rejections` are NOT in spec:106-117's six-table list.
 * They are forced by two of the spec's own sentences: "Every transition records
 * who caused it" (spec:126) is a history, not a column; and "Every rejection is
 * itself recorded" (spec:147) has nowhere to go — a rejected ingress has no
 * `mail` row by construction, since it may carry an unknown recipient or a
 * stale uuid, and writing it into `mail` would put unattributable rows in the
 * table the delivery lane walks. See the plan's deviation D-3.
 *
 * `feed_events` is a THIRD table beyond the six, added later still (Task 10's
 * own orchestrator-added scope, PR J interface 5 reconciled): the durable
 * archive behind `NotifyLog`'s in-memory ring (`server/src/notifylog.ts`),
 * which keeps its exact current role — this table is what `GET /api/feed`
 * answers once the ring has evicted a row or the process has restarted and
 * re-minted a fresh epoch. `feed_events.kind` is shaped like a sixth enum
 * column but is deliberately NOT one of the five the paragraph above counts,
 * and is not held to the we-do-not-know discipline those five are: it is
 * written only from a value this server itself already typed as
 * `NotifyEvent['kind']` (`FleetWatcher.pushOne`'s own call sites), the
 * client-side `'unknown'` degrade member that type carries is a READ-side
 * concept for an older PWA parsing a newer server's frame
 * (`reviveNotifyEvent`), and this server never writes it here. `CoordStore.
 * feedEvents` reads it back with a documented cast — the same stance
 * `mail_rejections.code` below already takes, and for the identical reason.
 *
 * `runs.claimedBy` implements spec:291-292's multi-coordinator non-goal: one
 * coordinator per program, and a second one refuses rather than arbitrating.
 */
export const MIGRATIONS: readonly string[] = [
  // ── 1: user_version 0 -> 1 ────────────────────────────────────────────────
  `
  CREATE TABLE programs (
    slug       TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    createdAt  INTEGER NOT NULL,
    state      TEXT NOT NULL              -- active|paused|done|abandoned|unknown; D-8 closed by
                                           -- Task 3's ProgramState/isProgramState
  );

  CREATE TABLE runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    program       TEXT NOT NULL REFERENCES programs(slug),
    wave          INTEGER NOT NULL,
    waveOf        INTEGER,
    project       TEXT NOT NULL,
    sessionId     TEXT,                   -- null until dispatch mints the workspace
    workspace     TEXT,
    branch        TEXT,
    state         TEXT NOT NULL,          -- see RUN_TRANSITIONS
    claimedBy     TEXT,                   -- the one coordinator; a second refuses
    resumed       INTEGER NOT NULL DEFAULT 0,   -- deviation D-1: wave N>=2 resumes
    clearedAt     INTEGER,               -- deviation D-1: when the post-resume /clear committed;
                                          -- null until the dispatch route (Task 9) performs it —
                                          -- RunSummary.clearedAt's wire promise needs a column to
                                          -- read, not a hardcoded null (see CoordStore.hydrateRun)
    openedAt      INTEGER NOT NULL,
    dispatchedAt  INTEGER,
    closedAt      INTEGER,
    handoffCommit TEXT,
    prLineage     TEXT                    -- JSON, folded from .prhistory at close
  );
  CREATE INDEX runs_by_state   ON runs(state);
  CREATE INDEX runs_by_program ON runs(program, wave);

  CREATE TABLE run_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    runId     INTEGER NOT NULL REFERENCES runs(id),
    at        INTEGER NOT NULL,
    fromState TEXT NOT NULL,
    toState   TEXT NOT NULL,
    causedBy  TEXT NOT NULL,              -- 'coordinator' | 'operator' | <session id>
    detail    TEXT
  );
  CREATE INDEX run_events_by_run ON run_events(runId, at);

  CREATE TABLE work_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    runId           INTEGER NOT NULL REFERENCES runs(id),
    title           TEXT NOT NULL,
    state           TEXT NOT NULL,        -- pending|claimed|done|failed|abandoned
    claimedBy       TEXT,                 -- a session id
    blockedBy       TEXT NOT NULL DEFAULT '[]',  -- JSON array of work_item ids
    doneFingerprint TEXT                  -- JSON, as reported then re-measured
  );
  CREATE INDEX work_items_by_run ON work_items(runId);

  CREATE TABLE mail (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        INTEGER NOT NULL,
    fromId    TEXT NOT NULL,
    fromUuid  TEXT NOT NULL,
    toId      TEXT NOT NULL,              -- 'coordinator' | a session id
    runId     INTEGER REFERENCES runs(id),
    kind      TEXT NOT NULL,              -- finding|question|answer|status|artifact
    subject   TEXT NOT NULL,
    body      TEXT NOT NULL,              -- <= MAIL_BODY_MAX_BYTES
    artifacts TEXT NOT NULL DEFAULT '[]'  -- JSON array of PATHS, never payloads
  );

  CREATE TABLE mail_deliveries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    mailId        INTEGER NOT NULL REFERENCES mail(id),
    toId          TEXT NOT NULL,          -- the resolved SESSION id
    state         TEXT NOT NULL,          -- queued|delivered|acked|rejected|unknown; D-8 closed
                                           -- by Task 3's MailDeliveryState/isMailDeliveryState
    attempts      INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt INTEGER NOT NULL DEFAULT 0,
    -- The rendered envelope, stored at QUEUE time. spec:174-177 requires a
    -- replay to be verbatim and never re-rendered; a render deferred to each
    -- sweep would silently change with any later edit to envelope.ts.
    envelope      TEXT NOT NULL,
    lastError     TEXT,
    deliveredAt   INTEGER,
    ingestedAt    INTEGER,                -- the UserPromptSubmit edge (spec:178-180)
    ackedAt       INTEGER,
    rejectCode    TEXT
  );
  -- dueDeliveries (deviation D-10, found in Task 3 review) reads BOTH arms
  -- through this one index, not two. D-10 as first landed added a SECOND
  -- index here, mail_deliveries_replay(state, deliveredAt), reasoned to be
  -- what the replay arm needs the way this one already covers the queued
  -- arm -- true of D-10's query at the time, false of the query actually
  -- shipped: a later fix, ALSO found in Task 3 review ("mail replay honors
  -- backoff" -- see store.ts's dueDeliveries docstring), added
  -- "AND nextAttemptAt <= ?" to the replay arm too, so both arms now filter on
  -- (state, nextAttemptAt) and this index alone serves both --
  -- EXPLAIN QUERY PLAN on the shipped query picks mail_deliveries_due for
  -- both OR branches (measured); mail_deliveries_replay was never read by
  -- any query in this build and is dropped. The replay arm's OTHER
  -- predicate -- MAX(COALESCE(ingestedAt,0), COALESCE(deliveredAt,0)) +
  -- replayMs <= now (review findings 2/6 changed this from a plain COALESCE,
  -- which pinned the clock at the FIRST ingestedAt forever and starved every
  -- later replay's own deliveredAt) -- is an expression on two nullable
  -- columns no index on bare deliveredAt could have served anyway; it stays
  -- an unindexed filter within the (state, nextAttemptAt) row set, which the
  -- sweep's own scale (one poll per MAIL_SWEEP_MS, not a hot path) does not
  -- need an index for.
  CREATE INDEX mail_deliveries_due ON mail_deliveries(state, nextAttemptAt);

  CREATE TABLE mail_rejections (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       INTEGER NOT NULL,
    code     TEXT NOT NULL,
    fromId   TEXT, fromUuid TEXT, toId TEXT, runId INTEGER, kind TEXT, subject TEXT,
    detail   TEXT
  );

  CREATE TABLE coordinator_state (
    id                   INTEGER PRIMARY KEY CHECK (id = 1),
    maxConcurrentWorkers INTEGER NOT NULL,
    maxSessionsPerDay    INTEGER NOT NULL,
    updatedAt            INTEGER NOT NULL
  );
  INSERT INTO coordinator_state (id, maxConcurrentWorkers, maxSessionsPerDay, updatedAt)
    VALUES (1, 3, 12, 0);

  -- Task 10 (orchestrator-added scope): the durable archive behind NotifyLog's
  -- in-memory ring. epoch/seq mirror NotifyLog's own pair AT RECORD TIME --
  -- not a second counter -- so a row can be correlated back to the catch-up
  -- watermark that was live when it was written; ordering for GET /api/feed is
  -- this table's own id (monotonic across an epoch rotation, unlike seq,
  -- which resets to 0 on one). Landed in v1 rather than a migration 2 for the
  -- same reason D-1's runs.clearedAt amendment gives: coord.db exists on no
  -- box yet, so amending v1 before it has ever been observed costs nothing.
  CREATE TABLE feed_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    epoch     TEXT NOT NULL,
    seq       INTEGER NOT NULL,
    at        INTEGER NOT NULL,
    kind      TEXT NOT NULL,        -- ask|done|merged|mail|run — never 'unknown', see this file's header
    sessionId TEXT NOT NULL,
    title     TEXT NOT NULL,
    body      TEXT NOT NULL
  );
  `,
];

/** The version this build writes. `MIGRATIONS.length` and nothing else: a
 *  hand-maintained constant beside a growing array is a pair that goes out of
 *  step, and the failure is silent (a migration that never runs). */
export const COORD_SCHEMA_VERSION = MIGRATIONS.length;
