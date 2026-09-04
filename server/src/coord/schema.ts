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
 * That column's own comment inside migration 1 spells the vocabulary out
 * (`ask|done|merged|mail|run`). Read it as a SNAPSHOT of what the union held
 * when v1 was written, not as the authority: migration 1 is frozen, so its
 * bytes are history and are not edited when the union grows — `shared/api.ts`'s
 * `NotifyEvent['kind']` and `NOTIFY_KINDS` are the live list, and they have
 * since gained `coord` (D-1163). What the comment says that REMAINS true of
 * every generation is the part that matters: the server never writes
 * `'unknown'`.
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
  //
  // FIX ROUND 3 (Tasks 40/41 review, F1) AMENDS THIS MIGRATION A THIRD TIME,
  // adding `lifecycle_by_at` below. `CoordStore.recentProvenance` (Task 34)
  // reads this table on the shared `FleetWatcher` tick every 60s (Task 41);
  // measured on an in-memory `node:sqlite` with 500,000 rows over 30 days —
  // ~1.5-2yr of growth at this migration's own stated ~90 MB/year, since the
  // table is NEVER PRUNED — the query planned as `SCAN lifecycle_events`
  // (same defect `runs_by_session` above already fixed once for `runs`):
  // ~50ms/call regardless of window density, because nothing bounds the scan
  // to the `at >= ?` predicate. `recentProvenance`'s own query now reads
  // `FROM lifecycle_events INDEXED BY lifecycle_by_at` — see that method's
  // comment for why a bare `CREATE INDEX` was not enough on its own (the
  // planner prefers a free-ordering scan over an index seek plus an explicit
  // sort, confirmed with and without `ANALYZE`) and for the array-order-
  // identical proof that forcing the index changes nothing about what the
  // query returns. The premise above was RE-VERIFIED for this round too:
  // `origin/main`'s `schema.ts` still has exactly TWO migration entries, and
  // `git merge-base --is-ancestor` against `origin/main` says NO for Task
  // 27's commit, Fix Round 1's `badoutcome` commit, and Fix Round 2's CHECK
  // constraint commit — so this migration still has not shipped.
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
  -- FIX ROUND 3 (Tasks 40/41 review, F1). \`recentProvenance\`'s window read
  -- (\`at >= ?\`) has no help from either index above -- \`sessionId\` and \`tx\`
  -- are both the wrong leading column -- so it planned as \`SCAN
  -- lifecycle_events\`, an O(table size) cost on a table this migration's own
  -- header says is NEVER PRUNED. \`recentProvenance\` reads this table with
  -- \`INDEXED BY lifecycle_by_at\`, forcing the seek this index makes
  -- possible -- see that method's own comment in coord/store.ts for why the
  -- FORCE was necessary (a bare index here was not enough on its own) and
  -- for the array-order-identical proof.
  CREATE INDEX lifecycle_by_at      ON lifecycle_events(at);

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

  // ── 4: user_version 3 -> 4 ────────────────────────────────────────────────
  // Build 9 wave 7 (§1 D8/D11/D12/D13): hot-file claims and the deviation
  // ledger — the two coordination primitives that are "a query against the
  // mirror plus one compare-and-swap that only the box with a database can
  // perform" (the spec's spine, sentence for sentence).
  //
  // A SEPARATE MIGRATION, for the reason migrations 2 and 3 each restate:
  // db.ts runs `for (let v = current; v < COORD_SCHEMA_VERSION; v++)`, and
  // MIGRATIONS[2] is on origin/main — a live server may already sit at
  // user_version 3, so an amendment to any earlier index would silently
  // diverge from what is actually on disk.
  //
  // D8'S RULING ON `claims`, WRITTEN WHERE THE TABLE IS BORN so nobody later
  // files it as a doctrine violation: claims are AUTHORITATIVE in coord.db,
  // AND THEIR LOSS IS FREE BY CONSTRUCTION. There is no flat file to
  // re-measure, and manufacturing one would require widening the agent's
  // write whitelist beyond `.cc-clips` — the one structural guarantee keeping
  // the agent from corrupting the files it reads — and would re-open the
  // naming-sweep trap (D12) the moment anyone reached for ws-hold. Losing
  // coord.db expires every claim at once, which is exactly the pre-feature
  // state: sessions lose PROTECTION, never WORK, and re-claim on their next
  // attempt. The lease (CLAIM_LEASE_MS 45 min, CLAIM_HARD_CAP_MS 8 h) is what
  // earns that reading — it is why claims got a lease before they got a table.
  //
  // D8'S RULING ON `ledger_alloc`: authoritative, WITH a flat-file ground
  // truth so the re-measurement doctrine holds without a special case. Every
  // allocation is appended to ~/.ccrc/ledger-alloc.log FIRST and committed
  // here SECOND (ledgerlog.ts, wave 7 part B); recovery takes MAX(file, db),
  // so a number is SKIPPED, NEVER REISSUED. A gap costs nothing — the ledger
  // is prose, parsed by nothing; a reissue cost 394 rewritten D-ref lines
  // across 30 files under merge pressure (bb47c9e).
  //
  // TASK 13 (part B, the allocator's store half) AMENDS THIS MIGRATION IN
  // PLACE: `ledger_alloc` gains `runId`/`landedAt`/`landedIn` and takes the
  // L0 row's own field names (`allocatedTo`/`allocatedAt` —
  // `DeviationAllocation`, shared/api.ts), `ledger_floor`'s stamp becomes
  // `updatedAt`. That looks like exactly the mistake the paragraph above
  // forbids, so migration 2's ruling is RE-VERIFIED rather than assumed:
  // `git merge-base --is-ancestor` says this migration's Task-6 commit is
  // NOT an ancestor of `origin/main`, whose `schema.ts` still tops out at
  // `MIGRATIONS[2]` — no server that has ever run has executed this file's
  // `user_version 3 -> 4` step, and every database past it is a test temp
  // file rebuilt fresh from `MIGRATIONS` on every run. The columns were born
  // under one drafting section's spelling while the defining task's landed
  // shape already carried nine fields; per the plan's cross-task signature
  // governance the consumer adapts to the landed definition — and here the
  // TABLE is the consumer.
  //
  // D11, AND THE ORDER IS THE RULING — stated here so a reviewer does not
  // assume one mechanism makes the other redundant:
  //   1. The in-transaction read IS the compare-and-swap. POST /api/claims
  //      (part B) expires lapsed rows, reads ALL live conflicting paths —
  //      exact match AND directory-prefix containment, which no index can
  //      express — then inserts, inside one tx(). Sound because there is one
  //      server process and DatabaseSync has no async surface: the whole
  //      transaction runs without yielding the event loop.
  //   2. `claim_one_owner` below and ledger_alloc's PRIMARY KEY (project, n)
  //      are the BACKSTOP: if a future refactor ever loses the transaction,
  //      the failure is a loud constraint violation, never a duplicate.
  `
  CREATE TABLE claims (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project       TEXT NOT NULL,
    heldBy        TEXT NOT NULL,        -- the claiming SESSION id. Attribution, not authentication
    heldByUuid    TEXT NOT NULL,        -- the same uuid check POST /api/mail ingress already makes
    intent        TEXT NOT NULL,        -- what the holder says it is doing. <= 512 BYTES, refused
                                        -- over-cap at the route (part B) — the LC_REASON_MAX_BYTES
                                        -- policy: refuse, never shorten. Free text, parsed nowhere;
                                        -- re-POSTing the same paths rewrites it, which is D12
                                        -- ruling 3: the signal sweepNames freezes is REPLACED here
    runId         INTEGER REFERENCES runs(id),  -- null for a claim outside any run; run close
                                        -- releases this run's claims in the close transaction
    state         TEXT NOT NULL,        -- live|released|lapsed|broken (CLAIM_STATES); read back
                                        -- through isClaimState, never a cast — the same
                                        -- we-do-not-know rule as every enum column in this file
    createdAt     INTEGER NOT NULL,
    renewedAt     INTEGER NOT NULL,
    expiresAt     INTEGER NOT NULL,     -- the lease. Renewed by measurement (claimExpiry, D12),
                                        -- never by a session-side heartbeat
    hardExpiresAt INTEGER NOT NULL,     -- createdAt + CLAIM_HARD_CAP_MS. NEVER extended: doubt can
                                        -- hold a claim, but not forever
    endedAt       INTEGER,              -- LAPSE, DO NOT DELETE (D12): an ended claim keeps its row,
    endedBy       TEXT                  -- so "held by X until it died" stays answerable
  );
  CREATE INDEX claims_by_state   ON claims(state);          -- the renew/lapse sweep reads live rows
  CREATE INDEX claims_by_project ON claims(project, state); -- GET /api/claims?project= — the
                                                            -- coordinator asks before splitting work
  CREATE INDEX claims_by_run     ON claims(runId);          -- run close releases by runId — the
                                                            -- runs_by_session precedent, one wave on

  -- PATHS ARE A CHILD TABLE, NOT A JSON COLUMN ON claims, and the choice is
  -- single-definition: the path set must be queryable per (project, path) for
  -- the CAS read and constrainable for the backstop index, and a JSON copy
  -- beside this table would be two homes for one fact. A claim's paths are a
  -- SET, acquired all-or-nothing (D12) — the route inserts every row or none,
  -- inside the same tx() as the conflict read.
  --
  -- \`live\` mirrors exactly ONE BIT of the parent's state — the partial-index
  -- predicate's input, which SQLite cannot evaluate across a join. Written in
  -- the SAME tx() as every claims.state transition (store.ts, part B, whose
  -- suite carries the desync mutant). Not a second authority: the four-word
  -- vocabulary keeps its single home on claims.state. Ending a claim flips
  -- live to 0 and deletes nothing — path history outlives the claim exactly
  -- as the claim row outlives its lease.
  CREATE TABLE claim_paths (
    claimId INTEGER NOT NULL REFERENCES claims(id),
    project TEXT NOT NULL,
    path    TEXT NOT NULL,              -- normalized by claims.ts (normalizeClaimPath): relative,
                                        -- no trailing slash, no dot segments. '.' and '' are
                                        -- refused upstream — claiming the whole repo IS the wedge
    live    INTEGER NOT NULL DEFAULT 1
  );
  -- THE D11 BACKSTOP. Deliberately UNABLE to express the directory-prefix
  -- containment rule (shared/ vs shared/api.ts) — that is the in-transaction
  -- read's job, and this index exists so losing that read is loud, not silent.
  CREATE UNIQUE INDEX claim_one_owner    ON claim_paths(project, path) WHERE live = 1;
  CREATE INDEX        claim_paths_by_claim ON claim_paths(claimId);

  -- D13: the allocator's record. One row per issued number, forever. state
  -- stores exactly TWO values, allocated|landed (DEVIATION_ALLOC_STATES,
  -- shared/api.ts) — 'landed' means the number was seen DEFINED in a plan file
  -- in the working tree of the MAIN checkout at sweep time, on whatever branch
  -- that checkout was on, uncommitted edits included (sweepLedgerReconcile,
  -- part B). NOT proof of a merge: no git is consulted on that path, so it is a
  -- weaker signal than the one the bb47c9e incident lacked, not the same one.
  -- 'stale' is NEVER WRITTEN here: a fact about a row and a clock is
  -- derived by the reader (allocatedAt + LEDGER_STALE_MS, 7 days
  -- never-landed), reported and NEVER reclaimed. Read back through the L0
  -- guard, never a cast.
  CREATE TABLE ledger_alloc (
    project     TEXT NOT NULL,
    n           INTEGER NOT NULL,
    title       TEXT NOT NULL,
    allocatedTo TEXT NOT NULL,          -- the requesting SESSION id. Attribution, not
                                        -- authentication — the claims-table stance, one table up
    runId       INTEGER,                -- null for an allocation outside any run
    allocatedAt INTEGER NOT NULL,
    state       TEXT NOT NULL,
    landedAt    INTEGER,                -- markLanded's stamp — landed is terminal, never re-stamped
    landedIn    TEXT,                   -- the plan file reconcile found the number in, repo-relative
    PRIMARY KEY (project, n)
  );

  -- D13: the self-seeded floor. THE FLOOR ONLY EVER RISES (store method, part
  -- B, enforced there and mutant-tested there); until a row exists here,
  -- allocation answers 409 not-seeded — openCoordDb's own "refuse to start
  -- rather than open empty" rule, one level up. floor = max(D-n seen in
  -- docs/superpowers/{plans,specs}) + LEDGER_SEED_GAP, because numbers
  -- allocated but not yet written into any plan are invisible to the scan,
  -- and re-issuing one IS the bb47c9e failure. evidence names the file and
  -- the number the seed was measured from.
  CREATE TABLE ledger_floor (
    project   TEXT PRIMARY KEY,
    floor     INTEGER NOT NULL,
    evidence  TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  `,

  // ── 5: user_version 4 -> 5 ────────────────────────────────────────────────
  // `runs.dispatchStartedAt` — WHEN THIS RUN'S DISPATCH BEGAN. One column, and
  // the smallest honest thing that closes the dispatch window.
  //
  // WHAT IT MEANS. Stamped immediately BEFORE the `ws-add` that mints a fresh
  // workspace (`coord/dispatch.ts`), which is the one moment the run knows a
  // dispatch is in flight AND the session id does not exist yet — the server
  // learns that id by REGISTRY DIFF, after the call returns, so until then
  // nothing CAN name the row. For the whole of that stretch the console
  // previously showed, in order, nothing at all, then a `dead` row qualified
  // "never started", then "unclaimed — a live pane with no claim": three
  // fault-shaped words for an entirely normal event, beside a run board sitting
  // on `planned`.
  //
  // THE FRESH-SPAWN ARM ONLY, DELIBERATELY. `dispatch.ts`'s other arm — the
  // wave N>=2 resume (D-1: `ensure` into the workspace the run already owns) —
  // stamps nothing, because it has neither half of the window this column
  // describes: no workspace is being minted and `sessionId` is known before the
  // call, so the console has a row to point at from the first frame. The cost
  // is that NULL carries two conditions, and both are named wherever it is read
  // (`RunSummary.dispatchStartedAt`, `hydrateRun`) rather than left to be
  // discovered: nobody dispatched this run, or every dispatch was a resume.
  // `state` is what answers "was this dispatched" on both arms.
  //
  // A MEASUREMENT, NEVER A MODE FLAG, AND SO NOTHING EVER CLEARS IT. `state`
  // moving to `dispatched` is what ends the "dispatching" rendering; this
  // timestamp then STAYS, as forensic material — `dispatchedAt -
  // dispatchStartedAt` is how long the spawn actually took, which a flag
  // cleared on success would have destroyed. A retry overwrites it with the new
  // attempt's start, which is the honest answer to "when did the dispatch that
  // is running now begin". One writer (`CoordStore.markDispatchStarted`), one
  // reader per consumer; there is no second writer to drift.
  //
  // AND IT NAMES THE WEDGE. `dispatch.ts`'s own comment on the refusal path
  // says it: "a run stuck in `planned` beside an unexplained new workspace is a
  // state no verb names, which is the class this build is judged on." With this
  // column, `planned` + a `dispatchStartedAt` older than `SPAWN_STALL_MS`
  // (shared/api.ts — a RENDERING threshold, deliberately not a copy of the
  // `ws-add` verb TIMEOUT) IS that state, rendered, for the first time.
  //
  // NOT A NEW RunState, deliberately: `RUN_STATES` and `RUN_TRANSITIONS` are
  // untouched and the coordinator skill's clauses say nothing new. `planned`
  // was overloaded — "opened, nobody has dispatched" and "dispatch in flight"
  // — and one nullable integer separates them without touching the machine.
  //
  // ADDITIVE, AND A SEPARATE MIGRATION, for the reason migrations 2, 3 and 4
  // each restate in turn: `db.ts` runs `for (let v = current; v <
  // COORD_SCHEMA_VERSION; v++)`, so an edit to an already-applied entry never
  // runs again against a file already past it. MIGRATIONS[0..3] are FROZEN.
  // NULLABLE WITH NO DEFAULT is the whole contract on the read side: NULL means
  // "no fresh-spawn dispatch has started for this run" (both of the conditions
  // named above), and a default would collapse that into "one started at the
  // epoch" — the overloaded-null defect at the one seam this column exists to
  // keep honest. `ALTER TABLE ... ADD COLUMN` is the only statement here;
  // nothing is rebuilt, renamed or repurposed.
  `
  ALTER TABLE runs ADD COLUMN dispatchStartedAt INTEGER;
  `,

  // ── 6: user_version 5 -> 6 ────────────────────────────────────────────────
  // D-792: WHAT REFUSED THIS DELIVERY, and for how long.
  //
  // `sweepMail`'s ladder has ten refusal paths; two of them write `lastError`
  // via `backOff` and the rest `continue` in silence. That silence is right as
  // a SCHEDULING decision — those gates hold indefinitely for a session that is
  // merely busy, and charging them toward `MAIL_MAX_ATTEMPTS` would park every
  // busy worker's mail. But "must not park" got implemented as "must not be
  // written down", and a delivery then sat `delivered`/`attempts: 0` for ELEVEN
  // HOURS, refused ~4,000 times, while every surface reported health.
  //
  // FOUR COLUMNS, NOT ONE, because they answer four different questions and
  // collapsing any pair re-creates the defect:
  //   lastGate   — WHICH gate (a closed `MailGate`, shared/api.ts)
  //   gateCount  — how many CONSECUTIVE refusals at that same gate
  //   gateSince  — when THIS gate first refused this row, unbroken
  //   gateAt     — when the most recent refusal was OBSERVED
  // `gateSince` and `gateAt` are not redundant: a sweep that has STOPPED
  // running leaves `gateSince` looking exactly like one still refusing, and
  // `now - gateAt` is the only thing that separates them.
  //
  // NOT A SCHEDULING INPUT, and that is the load-bearing constraint rather than
  // a nicety. Nothing reads these to decide whether, when or how often to
  // deliver — hence NO INDEX, deliberately: an index exists to serve a query,
  // a query here would be a scheduling read, and the absence is the evidence
  // there is none. `attempts` remains SEND-FAILURE budget alone and is
  // untouched by every gate below.
  //
  // ADDITIVE AND ITS OWN MIGRATION, for the reason 2..5 each restate: `db.ts`
  // runs `for (v = current; v < COORD_SCHEMA_VERSION; v++)`, so editing an
  // applied entry never runs again. MIGRATIONS[0..4] are FROZEN.
  //
  // NULLABLE, EXCEPT THE COUNT. NULL `lastGate` means "no ordinary gate has
  // refused this row" — a fresh delivery, or one that moved — and a default
  // would collapse that into "refused by something at the epoch", which is the
  // overloaded null this column exists to remove. `gateCount` defaults 0
  // because a count of refusals genuinely starts at none.
  `
  ALTER TABLE mail_deliveries ADD COLUMN lastGate TEXT;
  ALTER TABLE mail_deliveries ADD COLUMN gateCount INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE mail_deliveries ADD COLUMN gateSince INTEGER;
  ALTER TABLE mail_deliveries ADD COLUMN gateAt INTEGER;
  `,

  // ── 7: user_version 6 -> 7 ────────────────────────────────────────────────
  // Two columns recording what a dispatch DECIDED, as opposed to what it did
  // (D-1298). MIGRATIONS[0..5] ARE FROZEN, for the reason every entry above
  // states: db.ts's loop runs `for (v = current; v < COORD_SCHEMA_VERSION; v++)`,
  // so an amendment to an applied entry never runs again.
  //
  // `briefQueued` is `!resumed || clearedAt !== null` (coord/dispatch.ts) — the
  // answer to "did this dispatch actually queue a wave-brief". Its TRUE branch
  // already leaves a durable artefact, the brief mail row itself. Its FALSE branch
  // — a resume whose `/clear` was refused — left NOTHING, and absence there is
  // indistinguishable from "no dispatch ever happened", which is the one state an
  // operator most needs told apart from it. A reader could re-derive the formula
  // from `resumed`/`clearedAt`, but that is a re-derivation of a RULE, not a
  // record of a DECISION, and it silently changes meaning the day anything else
  // writes `clearedAt`.
  //
  // `clearError` is the `sendPrompt` refusal code that made it false. Today it
  // survives only as `run_events.detail`'s `clear-refused:<code>` — a table no
  // HTTP route serves — written through a MUTUALLY EXCLUSIVE ternary
  // (coord/dispatch.ts) that already drops it whenever `adopted` wins.
  //
  // NULLABLE, NO DEFAULT, both. NULL means "an older build wrote this row, or no
  // dispatch has committed for it". `briefQueued = 0` means "this dispatch queued
  // no brief". A `DEFAULT 0` would make those one value — the overloaded null this
  // file's own additive-only rule forbids at a new seam, and the exact defect the
  // dispatchStartedAt and gate-column entries above each argued through.
  `
  ALTER TABLE runs ADD COLUMN briefQueued INTEGER;
  ALTER TABLE runs ADD COLUMN clearError  TEXT;
  `,

  // ── 8: user_version 7 -> 8 ────────────────────────────────────────────────
  // A ONE-TIME DATA REPAIR (D-1424) — the only entry in this array that is not
  // DDL, and the reason it is one is that hand-editing a live coord.db is
  // available to nobody. MIGRATIONS[0..6] ARE FROZEN, for the reason every entry
  // above states: db.ts's loop runs `for (v = current; v < COORD_SCHEMA_VERSION;
  // v++)`, so an amendment to an applied entry never runs again.
  //
  // WHAT WENT WRONG. Until this build the reconcile sweep's landing half matched
  // a bare `\bD-<n>\b` anywhere in a plan's text while its orphan half, eleven
  // lines away, used the DEFINITION shape (D-1420, watch.ts). On 2026-09-02 a
  // BLOCKQUOTE citing an allocation RANGE — a line reading, in full, "> " then
  // bold "D-1294..D-1332" then "from POST /api/ledger/deviations" — stamped those
  // two numbers `landed` against a plan that CITES them and DEFINES neither.
  // `markLanded`'s `WHERE ... state = 'allocated'` (store.ts) makes a landing
  // terminal, so the corrected sweep can never re-decide them: the rows have to
  // be put back before it can.
  //
  // WHY TWO NUMBERS **AND** A PATH, AND NOT THE PATH ALONE. The path alone was
  // this repair's first design, on the measurement that the citing file defined
  // nothing the allocator had ever issued. THAT MEASUREMENT EXPIRED THE DAY AFTER
  // IT WAS TAKEN. The file merged to main on 2026-09-03 carrying a ledger of its
  // own; replaying `definitionsIn` over that copy yields a ledger of its own — a
  // D-1245..D-1252 band and an unbroken band from D-1333 UP, which that plan keeps
  // extending (#46 carried it past D-1366 the morning after this paragraph was
  // first written, which is why the cardinal that stood here is gone: it went
  // stale in one day, D-1444) — and the upper band is
  // allocator-issued by the file's own record. A path-keyed statement would
  // therefore have un-landed every one of those CORRECT rows, and would have found some
  // already there: the old bare-`\b` matcher landed D-1333 against this same file
  // too, and THERE IT WAS RIGHT. The repair would have created the corruption it
  // exists to fix.
  //
  // WHAT HOLDS THE NARROW FORM is a property of the two numbers, not of that
  // file's size — which is why it does not expire the way the first one did. The
  // citing file defines neither 1294 nor 1332, and cannot come to: both are
  // already DEFINED, on origin/main, in
  // 2026-09-02-program-leverage-wave7-f7.md, and an allocator-era number defined
  // in a second file is what `unallocatedDefinitions` and
  // `deviation-refs.test.ts` exist to catch. So no correctly-landed row can name
  // THIS pair against THIS path, however that plan grows. It does NOT generalise
  // to another citing file or another pair; the matcher fix is what stops there
  // being one.
  //
  // AFTER THIS both numbers are `allocated` again and the corrected sweep
  // re-decides them from the plans it can actually read — landing them against
  // the wave-7 plan that defines them, once the main checkout carries it, and
  // until then leaving an OPEN row, which is a true statement where the stamp was
  // a false one. `landedAt` is cleared with `landedIn` for the same reason: a row
  // that is `allocated` while still carrying a landing stamp is the overloaded
  // value this whole repair is about.
  //
  // `state = 'landed'` is BELT-AND-BRACES and no test can red it, which is said
  // here rather than hidden: `markLanded` is the only writer of `landedIn` in
  // `server/src` and it always sets `state`, `landedAt` and `landedIn` together,
  // so an `allocated` row carrying a non-null `landedIn` is a state this tree
  // cannot reach. A fixture that could red the predicate would have to invent
  // one. The two NUMBERS and the PATH are what actually hold this statement.
  `
  UPDATE ledger_alloc
     SET state = 'allocated', landedAt = NULL, landedIn = NULL
   WHERE state = 'landed'
     AND n IN (1294, 1332)
     AND landedIn = 'docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md';
  `,
];

/** The version this build writes. `MIGRATIONS.length` and nothing else: a
 *  hand-maintained constant beside a growing array is a pair that goes out of
 *  step, and the failure is silent (a migration that never runs). */
export const COORD_SCHEMA_VERSION = MIGRATIONS.length;
