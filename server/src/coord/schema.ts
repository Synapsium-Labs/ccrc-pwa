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
 * re-minted a fresh epoch. `feed_events.kind` IS a sixth we-do-not-know
 * column (correction, review finding 2 — an earlier draft of this paragraph
 * exempted it on the grounds that it is "written only from a value this
 * server itself already typed", and likened that to `mail_rejections.code`
 * below; both halves were wrong, the second more so, since that column's own
 * docstring in `store.ts` states the OPPOSITE stance in so many words). The
 * exemption's premise fails on a rollback: `deploy.sh` keeps per-timestamp
 * backups, and `shared/api.ts`'s own rollback paragraph (`:567-571`) is
 * exactly the "older, same, or newer" span that makes "this server itself
 * already typed it" false the moment the running server is OLDER than the
 * build that last wrote this column. `CoordStore.feedEvents` reads `kind`
 * back through `isNotifyKind` (`shared/api.ts`, exported beside
 * `NOTIFY_KINDS` for exactly this caller), degrading an unrecognised token
 * to `'unknown'` — the same guard `isRunState`/`isProgramState`/
 * `isMailDeliveryState` already give the other five, never a cast.
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
    rejectCode    TEXT,
    replayCount   INTEGER NOT NULL DEFAULT 0   -- review finding 20: successful REPLAYS (a send
                                                -- onto an already-delivered row), counted
                                                -- separately from attempts (SEND FAILURES
                                                -- only) -- the ceiling sweepMail uses to park a
                                                -- delivery that keeps succeeding but is never
                                                -- acked, since MAIL_MAX_ATTEMPTS structurally
                                                -- cannot apply to a send that never fails.
                                                -- Landed in v1 rather than a migration 2 because,
                                                -- at the time, coord.db existed on no box. THAT
                                                -- PREMISE HAS EXPIRED: the server's copy is live
                                                -- and already at user_version 1, so v1 is now
                                                -- FROZEN — a change to MIGRATIONS[0] would never
                                                -- run against it. Every later column or index is
                                                -- its own migration (runs_by_session is the first).
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
  -- which resets to 0 on one).
  -- Landed in v1 while coord.db still existed on no box. That premise has
  -- expired — the live database is already at user_version 1, so v1 is
  -- frozen and every later change is its own migration.
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

  // ── 2: user_version 1 -> 2 ────────────────────────────────────────────────
  // `CoordStore.openRunsForSession` — "which OPEN runs name this session?" —
  // is asked at three destructive decision points (close's fleet act,
  // `archiveMerged`, the by-hand archive route). `runs` had no index on
  // `sessionId`, and `state NOT IN (…)` is negated set membership, not
  // seekable, so the query planned as `SCAN runs`. Measured against the v1
  // DDL in an in-memory `node:sqlite`: `SCAN runs` before,
  // `SEARCH runs USING INDEX runs_by_session (sessionId=?)` after.
  //
  // A SEPARATE MIGRATION, not an amendment to migration 1, and that is
  // load-bearing: `db.ts` runs `for (let v = current; v < COORD_SCHEMA_VERSION; v++)`,
  // so an edit to `MIGRATIONS[0]` never executes against a database already
  // at `user_version 1` — and the server's copy IS one, having driven five
  // runs through build4.
  `
  CREATE INDEX runs_by_session ON runs(sessionId);
  `,

  // ── 3: user_version 2 -> 3 ────────────────────────────────────────────────
  // The lifecycle journal mirror (build 9 §1 D1/D6/D8). `$REG/.lifecycle/
  // journal-<19-digit-epochNs>.ndjson` is APPEND-ONLY on the fleet host and is
  // the one record `_reg_purge` (ccd:458-556) cannot reach; these three tables
  // are the server's copy of it.
  //
  // RE-MEASUREMENT, PROVABLY — the D8 ruling, written here rather than in a
  // plan so nobody later files it as a doctrine violation. `parseJournalLine`
  // is pure and total: no clock, no lookup, no registry, no other row. The
  // ONLY server-owned value in `lifecycle_events` is `ingestedAt`, and it is
  // never read as an event time. `raw` holds the line VERBATIM, so the
  // reconstruction drill (`server/test/lifecycle-replay.test.ts`) is BYTE
  // EQUALITY rather than resemblance, and a field a NEWER ccd writes that this
  // build cannot model is not lost — a later build re-projects it out of `raw`
  // without re-reading the fleet box.
  //
  // NEVER PRUNED, unlike `feed_events`. `feed_events` prunes to 2000 because it
  // backs a UI ring; this table IS the record — bound the producer (`_lc_rotate`
  // caps the journal at LC_GEN_KEEP x LC_GEN_MAX_BYTES), never the record.
  // ~90 MB/year on the SERVER box, inside the `VACUUM INTO` snapshot
  // `deploy.sh` already takes. Row count and byte size are reported through
  // `/api/fleet/health` so the operator sees it coming.
  //
  // A SEPARATE MIGRATION for the reason migration 1 states in full: `db.ts` runs
  // `for (let v = current; v < COORD_SCHEMA_VERSION; v++)`, and the server's copy
  // is already at `user_version 2`.
  //
  // FIX ROUND 1 (Task 29 review, F1) AMENDS THIS MIGRATION IN PLACE, adding
  // `badoutcome` below — which looks like exactly the mistake the paragraph
  // above forbids, so the ruling and its premise are recorded here rather
  // than only in a review thread. The "separate migration, never an
  // amendment" rule protects a migration that has already RUN somewhere,
  // because `db.ts`'s `for (let v = current; ...)` loop only ever executes
  // `MIGRATIONS[v]` for `v >= current` — an edit to an already-applied
  // migration index never re-runs against a database already past it, so an
  // amendment there would silently diverge from what is actually on disk.
  // THIS migration has not shipped: wave 4's server deploy is Task 43 and
  // has not happened, `origin/main` (measured via `git merge-base --is-
  // ancestor` against this branch's Task 27/28 commits, both NOT ancestors
  // of `origin/main`) does not contain `MIGRATIONS[2]` at all — `schema.ts`
  // on `origin/main` has exactly TWO migration entries, not three — so no
  // server that has ever run has executed this file's `user_version 2 -> 3`
  // step, and the live `~/.ccrc/coord.db` cannot be past `user_version 2`.
  // Every database that HAS reached `user_version 3` is a test temp file
  // created by this branch's own suites, which are rebuilt from `MIGRATIONS`
  // fresh on every run and carry no state across them. Amending in place
  // rather than adding `MIGRATIONS[3]` avoids a fourth table shape
  // (`lifecycle_events` missing `badoutcome`, briefly, between versions 3
  // and 4) that nothing would ever have actually run against.
  //
  // FIX ROUND 2 (Tasks 33/34 review, F2) AMENDS THIS MIGRATION AGAIN, adding
  // the CHECK constraint on `lifecycle_gaps` below. The premise above was
  // RE-VERIFIED for this round, not assumed: `origin/main`'s `schema.ts`
  // still has exactly TWO migration entries (no `lifecycle_events`,
  // `lifecycle_gaps` or `badoutcome` anywhere in it), and `git merge-base
  // --is-ancestor` against `origin/main` says NO for both Task 27's commit
  // and Fix Round 1's `badoutcome` commit — so this migration still has not
  // shipped and the same reasoning applies again.
  `
  CREATE TABLE lifecycle_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    -- <epochNs>.<BASHPID>.<seq> (D6). INTRINSIC identity, not positional:
    -- (gen, startOffset) was rejected because an offset is not a function of
    -- the bytes when the consumer does not own the tail, and a shifted offset
    -- silently collides under OR IGNORE. NULL only when the line carried none.
    uid        TEXT,
    gen        TEXT NOT NULL,     -- the 19 digits from the FILENAME, never a header line
    at         INTEGER,           -- CCD's clock, epoch ms, off the line. NULL = the line carried
                                   -- no readable \`at\`. NEVER 0 -- 0 is a date, not an absence
    ingestedAt INTEGER NOT NULL,  -- THE SERVER'S clock. Never read as an event time (D8)
    act        TEXT NOT NULL,     -- LifecycleAct; 'unknown' is its we-do-not-know member, read
                                   -- back through isLifecycleAct and never cast
    badact     TEXT,              -- the token that degraded to 'unknown'; NULL when none did
    outcome    TEXT NOT NULL,     -- LifecycleOutcome; same we-do-not-know rule
    badoutcome TEXT,              -- badact's twin on the outcome side (FIX ROUND 1, F1): NULL
                                   -- whenever outcome is not 'unknown'. Added by amending THIS
                                   -- migration rather than a new one -- see the justification
                                   -- above the CREATE TABLE, which records why that is safe here.
    verb       TEXT,
    sessionId  TEXT,              -- the SUBJECT of the act (ccd's wire field \`id\`), not the actor
    tx         TEXT,              -- pairs an \`intent\` with its outcome (D4). An intent with no
                                   -- sibling is a process that died mid-destroy -- DERIVED by the
                                   -- reader, never stored as a flag
    refusal    TEXT,              -- D15: spelled \`refusal\`, NEVER \`refused\`. \`wsaudit.test.ts\`
                                   -- greps ccd for /"refused":"([a-z0-9-]+)"/ and holds the result
                                   -- set-equal to wsaudit.ts's SENTENCES; that test must stay green
                                   -- with NO edit, and this spelling is half of why it does
    detail     TEXT,              -- ccd's one line for a person. DISPLAY-ONLY -- nothing parses it
    truncated  INTEGER NOT NULL DEFAULT 0,
                                  -- the line said \`"truncated":true\`: \`_lc_json\` shed fields to fit
                                  -- LC_LINE_MAX. Its own column because otherwise "the family was
                                  -- not on the line" and "the family was dropped to fit" collapse
                                  -- to one NULL, and a reader cannot tell absence from loss
    obsJson    TEXT,              -- the three families that NEVER merge (D2), as validated JSON.
    decJson    TEXT,              -- NULL = the family was not on the line; '{}' would mean it was
    measJson   TEXT,              -- there and empty, which is a different fact. These hold what
                                  -- THIS build could model; anything a newer ccd wrote that it
                                  -- could not is still in \`raw\`, verbatim, and re-projectable
    raw        TEXT NOT NULL      -- the line VERBATIM. D8's drill is byte equality
  );
  -- TWO PARTIAL UNIQUE INDEXES, and the split is the design. A parsed line
  -- dedupes on its own \`uid\`. A line with NO usable uid dedupes on its BYTES
  -- within its generation, because generations are immutably named and a
  -- byte offset is exactly the positional identity D6 rejects.
  -- DISCLOSED RESIDUAL: two BYTE-IDENTICAL unparseable lines in one generation
  -- collapse to one row. The alternatives are a positional key (rejected above)
  -- or a content hash, which would put \`node:crypto\` inside a pure L1 parser.
  CREATE UNIQUE INDEX lifecycle_uid     ON lifecycle_events(uid)      WHERE uid IS NOT NULL;
  CREATE UNIQUE INDEX lifecycle_raw_uid ON lifecycle_events(gen, raw) WHERE uid IS NULL;
  -- \`GET /api/lifecycle?session=\` is the whole read surface. Ordered by this
  -- table's own id, never by \`at\`: \`at\` is CCD's clock and is nullable, and id
  -- is monotonic across a generation rotation the way \`feed_events\` already
  -- relies on for the same reason.
  CREATE INDEX lifecycle_by_session ON lifecycle_events(sessionId, id);
  CREATE INDEX lifecycle_by_tx      ON lifecycle_events(tx);

  -- The cursor, and it is an OPTIMISATION, NEVER A CORRECTNESS INPUT (D6):
  -- advanced only inside the same tx() as the rows it covers, so it can never
  -- move past uncommitted data, and re-reading a generation from offset 0 is
  -- always no-op-or-catch-up.
  CREATE TABLE lifecycle_generations (
    gen         TEXT PRIMARY KEY,
    firstSeenAt INTEGER NOT NULL,
    lastSweepAt INTEGER NOT NULL,
    cursor      INTEGER NOT NULL,  -- BYTE offset just past the last COMPLETE line ingested
    size        INTEGER NOT NULL,  -- the size the last successful read reported. READ BACK, not
                                   -- decoration: a file truncated to a length still AHEAD of the
                                   -- cursor is invisible to a cursor test and visible to this one
    retired     INTEGER NOT NULL DEFAULT 0
  );

  -- Gaps are RECORDED, never silently skipped (D6). A byte we saw and could
  -- not model is a different fact from a byte that was never there.
  CREATE TABLE lifecycle_gaps (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       INTEGER NOT NULL,   -- the server's clock
    gen      TEXT NOT NULL,
    reason   TEXT NOT NULL,      -- rotated-away|shrank|unknown; read back through isLifecycleGapReason
    detail   TEXT NOT NULL,      -- DISPLAY-ONLY -- nothing parses it back
    lostFrom INTEGER,            -- the byte range known lost. NULL where it could not be bounded
    lostTo   INTEGER,
    -- COUPLED, AS A STORAGE CONSTRAINT rather than caller discipline (Fix
    -- Round 2, F2): \`lostFrom\`/\`lostTo\` are either both NULL or both set,
    -- and a \`reason\` of 'unknown' always carries a null pair -- there is no
    -- bounded range for a hole the mirror could not place at all. This is
    -- the same invariant \`mirrorplan.ts\`'s private \`coupledLoss\` enforces
    -- at its one call site (still the ONLY producer of a LifecycleGap pair
    -- anywhere in server/src or shared/), restated here so it is a MECHANISM
    -- rather than a fact resting on every future writer remembering to route
    -- through an unexported helper in another file. Only a one-directional
    -- implication on 'unknown' -- a NON-'unknown' reason MAY still carry a
    -- null pair (\`coupledLoss\`'s own \`bounded === null\` branch), so this
    -- does not assert the converse.
    CHECK ((lostFrom IS NULL) = (lostTo IS NULL) AND (reason <> 'unknown' OR lostFrom IS NULL))
  );
  CREATE INDEX lifecycle_gaps_by_at ON lifecycle_gaps(at);
  `,
];

/** The version this build writes. `MIGRATIONS.length` and nothing else: a
 *  hand-maintained constant beside a growing array is a pair that goes out of
 *  step, and the failure is silent (a migration that never runs). */
export const COORD_SCHEMA_VERSION = MIGRATIONS.length;
