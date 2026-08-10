# Build 7 — fleet coordination: programs become runs, sessions get mail, a coordinator drives waves

**Status:** design, 2026-08-07 — **awaiting operator review before any
execution.** This is the SDD centerpiece: ccrc exists to run SDD programs
across the fleet, and this build is the layer that makes a program a live,
observable, coordinated thing rather than a discipline held in one
orchestrator's head.

**Inherits:** the ratified 2026-08-05 direction (payloads, idle-timed
delivery, coordinator-as-session, caps) and Build 2.5's standing note — the
hold, the PR lineage and the handoff-as-commit discipline are the substrate
this build reads; its explicit non-goals (boundary triggering, wave dispatch,
agent-to-agent messaging, machine-readable program state, a coordinator) are
exactly this build's goals. Scoped from five read-only scouts against
`00ec0a1`; the facts below were measured, not assumed.

## 0. Four measured facts that shaped everything

1. **Two boxes.** The server (and therefore SQLite) lives on `server-box`;
   ccd, the registry, tmux and every session live on `openclaw`. The agent
   link between them is **read-only for files** (writes: `.cc-clips` only) —
   the server mutates the registry only through whitelisted ccd verbs.
   `README.md`'s "local mode is what's deployed" is false
   (`/api/fleet/health` → `{"mode":"remote"}`) and gets corrected in this
   build.
2. **On the fleet host, identity is attribution, not authentication.** All
   sessions share one UNIX user; ccd has no caller auth; the exec whitelist
   guards the PWA→server→agent direction only. Any session can already run
   any verb, write any registry file, and send keys to any pane. The spec
   never pretends otherwise.
3. **The server's HTTP API is unauthenticated**, and the one existing
   box→server ingress (`notify.sh`) carries zero identity while the server
   regex-routes its body to a session. The mail bus must not inherit that
   shape.
4. **`node:sqlite` works on server-box today** (v22.22.3; `DatabaseSync`
   create/insert/select proven live). Zero native deps; experimental status
   accepted with an escape hatch (better-sqlite3 builds on the boxes — the
   agent already compiles node-pty at deploy).

## 1. Names (because `tasks` is taken)

Claude Code's TodoWrite already owns `TaskItem`/`TaskProgress`/`tasks` across
shared/server/PWA, and the repo has a test-enforced one-definition rule. This
build's nouns:

- **Program** — the long-horizon effort. Identity = slug. Its human record
  stays `docs/superpowers/programs/<slug>.md`, markdown, committed, unparsed.
- **Run** — one wave of a program in one workspace: dispatch → work → PRs →
  handoff commit → close.
- **WorkItem** — a unit inside a run (implement task N, review X, fix wave),
  with DAG-lite `blockedBy`.
- **Mail** — an agent-to-agent message: `finding | question | answer |
  status | artifact` (artifact = **paths, not payloads**).

## 2. Storage — SQLite on the server, and the rules it lives by

One database, `~/.ccrc/coord.db` on the server box, opened with `node:sqlite`
(`DatabaseSync`). Tables: `programs`, `runs`, `work_items`, `mail`,
`mail_deliveries`, `coordinator_state` (single-row caps/counters). WAL mode;
every write in a transaction.

**This repeals the README's "No database" — deliberately and in writing.**
The deferral had an owner ("Build 7, not here" — attention-ux spec) and a
named trigger (agent-to-agent orchestration, per the Orca analysis); this is
the trigger arriving.

The house cache rules ("the READ is the version negotiation", v1-forever) do
**not** transfer, because they govern caches whose loss is free and this is
the first artifact whose loss is not. The rules that govern here:

- `user_version` pragma **is** the schema version. Migrations are
  forward-only, idempotent, run at open, in a transaction — and a DB that
  cannot migrate **refuses to start loudly** (rejection-collapses-to-empty is
  the cache rule; here it would erase a program's history). The server deploy
  gains `verify-service.sh ccrc.service` (today only the agent path has it).
- Columns are additive-only; nullable means "an older build lacked it";
  every enum has a designated we-do-not-know member.
- Rollback is real (`~/ccrc-backups/` exists for exactly that): an older
  build meeting a newer schema ignores unknown columns and never treats a
  higher `user_version` as fatal downward — it may only refuse to *migrate*,
  never to *read*.
- **The markdown ledger stays the disaster-recovery ground truth.** If the
  DB is lost, a program is reconstructible from
  `docs/superpowers/programs/<slug>.md` + the registry + `.prhistory` — and
  a test proves the reconstruction path for a representative program.
- `engines` fields land in all three package.jsons and CI's node version is
  asserted against them (today the ≥22 floor is prose only).

**What maps where** (settling the pre-SQLite sketch): runs/work-items/mail/
coordinator state = SQLite. The **hold stays a ccd file** — it is the veto
the destructive verbs read locally, and a row on another box cannot gate a
reap run from a terminal. `prhistory` stays ccd's; at run close the server
reads it once (via FleetIO — a new, read-only path) to fold PR lineage into
the run record. The program ledger stays markdown, written by the
coordinator, parsed by nothing.

**No new ccd verbs in this build.** The ratified "runs/tasks = ccd verbs"
sketch predates the SQLite confirmation; with records server-side, the box
half is already sufficient: `ws-hold` is the claim/veto, `ws-add`/`start`
are dispatch, `pr-open`/`pr-state` are the PR lane, `ws-archive` the close.
Every one is already granted and gated. (The six-table cost of a verb is
budgeted at zero, and the caps lane stays byte-identical on the fleet.)

## 3. The run model

```
programs:  slug PK · title · createdAt · state(active|paused|done|abandoned)
runs:      id PK · program FK · wave INT · sessionId · workspace · branch
           · state(planned|dispatched|working|awaiting-review|merging|closing|done|failed)
           · dispatchedAt · closedAt · handoffCommit · prLineage JSON (folded at close)
work_items: id PK · run FK · title · state(pending|claimed|done|failed|abandoned)
           · claimedBy (sessionId) · blockedBy JSON · doneFingerprint JSON
mail:      id PK · at · fromId · fromUuid · toId ('coordinator' | session id)
           · runId? · kind · subject · body (≤8KB) · artifacts JSON (paths)
mail_deliveries: mailId FK · state(queued|delivered|acked|rejected) · attempts
           · lastError? · deliveredAt? · ackedAt? · rejectCode?
```

- A run **joins** the existing substrate, never replaces it: its workspace
  carries a hold whose reason names the program by the standing convention
  (`program:<slug> wave:N/M` — still display-only, never parsed; the run row
  has its own columns).
- Run state changes are events on the wire (§7) and in the feed. Every
  transition records who caused it (`coordinator`, `operator`, a session id).
- **Done-authority is a fingerprint, not a claim.** A `worker_done` (mail
  kind `status`, subject `wave-done`) carries `{branchTip, prNumber, prPhase,
  handoffCommit}`. The coordinator **re-measures** each fact (pr-state,
  git via the session's own report or FleetIO reads) before advancing the
  run; mismatch → typed rejection (`stale-tip`, `pr-regressed`,
  `no-handoff-commit`, …) mailed back, run state unchanged. This is Orca's
  "a stale worker_done can never settle a task", built from ccd's own
  fingerprint-as-consent idiom.

## 4. The mail bus

**Ingress:** `POST /api/mail` on the server. Authenticated by a **box
token** — a new secret in `~/.cc-secrets/ccrc-mail.token` on the fleet host,
shipped alongside `agent.env`'s lane, held server-side in config. This
authenticates *the box*, which is the honest unit (fact 2); per-session
identity rides as attribution: `{fromId, fromUuid}`, verified server-side
against the registry (`fromUuid === $REG/<id>.uuid` read via FleetIO, the
hookstate gate's exact shape) — freshness, not forgery-proofness, and the
spec says so. `/api/notify` keeps its current shape (out of scope; noted).

**Rejection codes are typed and total** — `unknown-sender`, `stale-uuid`,
`unknown-recipient`, `unknown-run`, `oversize`, `bad-kind`, `unauthenticated`,
plus the done-authority set (§3). Every rejection is itself recorded (a
rejected message is a fact about the fleet).

**`/api/notify` adopts the box token in this build too** (operator ruling,
2026-08-08) — the anonymous box→server ingress closes entirely. `notify.sh`
gains the token read from `~/.cc-secrets/ccrc-mail.token`; the server
accepts the old shape for one deploy generation (absent token → accepted,
logged as legacy) so the hook cannot go dark mid-rollout, then the
tolerance is removed.

**Delivery — idle-timed injection, replay-until-ack:**

- A new watcher lane (`MAIL_SWEEP_MS = 10_000`, never awaited) walks
  `queued` deliveries. Per recipient it applies **ccd's proven gate policy**
  (the `_auto_compact_check` conjuncts, read from signals the server already
  has): session alive; hookstate fresh and `state ∈ {done, idle}`-equivalent;
  no dialog/ask pending; quiet ≥ 60s; per-session mail cooldown; a fleet
  `mail-disabled` marker file as kill-switch (read via FleetIO). Only then
  does it inject through **`sendPrompt`'s full proof discipline** (echo
  verified, draft-present refused, dialog-open refused) inside the session's
  KeyedQueue slot.
- **Busy sessions are backed off, not stacked.** Claude Code silently queues
  prompts sent mid-turn (measured); the server cannot see that queue, so
  delivery-while-busy is forbidden — the lane retries next sweep,
  `attempts` capped with exponential spacing, and a delivery that keeps
  failing parks as `rejected('undeliverable')` with its mail intact.
- The injected text is a fenced, self-describing envelope (sender, run,
  kind, subject, body, artifact paths) so the receiving agent can act on it
  without tooling; **ack** = the recipient POSTs `/api/mail/:id/ack` (box
  token; same attribution check). Until acked, the delivery replays —
  verbatim, never re-rendered — on later sweeps after cooldown.
- `session-hook.sh`'s already-written-but-discarded `event` field is exposed
  through `HookState` (one field), giving the lane a cheap
  `UserPromptSubmit`-edge to confirm the turn actually started.
- **Dependency stated:** bug #21 (text→Enter race) lives on this exact path;
  its formal closure (the send path's own pins largely cover it) is a
  Definition-of-Done item here, not a footnote.

## 5. The coordinator

A **normal fleet session** in its own workspace (holdable by design), running
a **skill** — the fourth fleet-host artifact in ccd's install lane
(`install-session-hooks.sh`'s four-homes shape, so a swap never strands it on
an account without the skill).

- **It acts through the server's HTTP API, not raw ccd.** Dispatch =
  `POST /api/runs/:id/dispatch` (server → existing `wsAdd`/`start` argv →
  agent → ccd), close = the existing archive route, PRs via the pr routes.
  One chokepoint means caps are *enforced*, every act is *recorded* on the
  run, and the PWA sees everything. Raw ccd remains physically possible
  (fact 2); the skill's contract plus the single recorded chokepoint is the
  honest boundary, and the spec names it as such.
- **Caps, enforced server-side at dispatch:** `maxConcurrentWorkers`
  (running runs), `maxSessionsPerDay` (dispatches per rolling 24h) — rows in
  `coordinator_state`, surfaced in the PWA. **Pause is a file**:
  `$REG/coordinator-paused` on the fleet host, operator-owned (`touch`/`rm`),
  read via FleetIO before any dispatch, shown as a banner. Matches the
  `-disabled` family; no verb, no route, no way for the coordinator to
  unpause itself.
- **`ws-reap` stays human-only** — stated honestly: there is no mechanism
  that makes it so on a single-uid box (the audit→reap chain is scriptable).
  What this build does: the coordinator's skill contract excludes reap; the
  coordinator holds every workspace it owns (making any reap a deliberate
  two-act release-then-reap); and reap consent stays in the PWA ceremony.
  Convention, plus a mechanical speed bump, named as exactly that.
- **Wave lifecycle** automates Build 2.5's six manual steps: coordinator
  opens the run (ledger commit + hold), dispatches, watches mail + pr-state,
  re-measures the done fingerprint, reviews the handoff commit, updates the
  hold reason, dispatches wave N+1 fresh into the same workspace, releases on
  final merge. **The brief's content stays discipline** — the skill carries
  the template, the quality gate stays ordinary review of the handoff commit.
- The operator observes and interrupts at every point: the run board, the
  mail feed, push events, the pause file, and the ordinary ability to just
  talk to any session.

## 6. Surfaces

- **Run board** — `/runs` (route free; `/fleet` and `/docs` are co-tenant
  reserved). A `{type:'runs'}` frame on `/ws/fleet` (additive; old clients
  drop it) carries active runs + work-item tallies; REST `GET /api/runs` for
  cold start and the archive of finished runs. Anatomy copies `/accounts`
  (route regex, `data-view` OR, back control, gates). Rows are mono machine
  voice; **no glow — runs are not living panes**; status vocabulary gets its
  own small table, not `SessionBucket`'s.
- **Mail feed** — the first renderer of the durable feed. New `NotifyEvent`
  kinds (`mail`, `run`) with what that forces, done properly: a client-side
  unknown-kind degradation branch (today's closed 3-union has none), tags
  that do **not** collapse per session (two messages must not replace each
  other), and a **presence-gate exemption**: agent-to-agent mail is a record,
  not a "needs your eyes" ping — it lands in the feed regardless of watching,
  and only its *push* is presence-gated. Unread counting via `isUnseen`/`ack`
  (the pre-committed single implementation), badged on the bell.
- **Session mail strip** — the TaskStrip idiom above the composer:
  outstanding mail for *this* session, collapsed to a headline, nothing when
  empty. (A full in-transcript mail `ChatItem` is deferred to Build 4's
  transcript surface — one build owns the conversation model.)
- Push copy stays disciplined: `✉ finding › <ws>` etc., project-decorated
  only when >1 project active, actionless in v1.

## 7. What stays discipline (unchanged by automation)

Handoffs are commits; briefs are written prose reviewed like code; the
program ledger is for humans and parsed by nothing; parallelism only across
workspaces the plan proves disjoint; SDD's per-PR mechanics (implement →
review lenses → whole-branch pass) unchanged — the coordinator *dispatches*
that shape, it does not reinvent it.

## 8. Failure modes and restart semantics

- Server restart: DB is authoritative; sweeps resume; in-flight deliveries
  re-verify against hookstate before re-injecting; the primed-quiet rule
  (no notification storm on boot) extends to the mail lane.
- Coordinator session dies mid-wave: the run says `dispatched`/`working`
  with a dead coordinator visibly attached; the operator restarts it (or any
  fresh session resumes from the ledger + run row — the coordinator holds no
  unique state, by inheritance from the operating model).
- Worker dies / uuid rotates: attribution goes stale (`stale-uuid`
  rejections), the run shows a dead worker, the coordinator re-dispatches
  fresh into the held workspace — the exact recovery Build 2.5 designed.
- DB lost: reconstruct from ledger + registry + prhistory (tested, §2).
- Fleet host unreachable: dispatch and delivery refuse (the lane skips);
  runs go honest-stale; nothing is invented.

## 9. Testing & rollout

- Schema/migration tests (open-migrate-reopen, refuse-on-unmigratable,
  rollback-read); mail ingress rejection table pinned both directions;
  delivery gate conjuncts pinned against fixture hookstates incl. the
  never-inject-into-dialog case; done-fingerprint mismatch table; caps and
  pause refusals; run-board/feed/strip component tests under the standing
  design gates; the reconstruction drill.
- Rollout: **agent-first is trivially satisfied** (no ccd changes; the skill
  + token ship via the install lane), then server (with `verify-service.sh`
  newly wired), then PWA.
- **Acceptance is dogfood:** the first coordinated program is Build 4
  (transcript surface) run through the coordinator — real waves, real PRs,
  the operator watching from the board. Success = a program completes with
  human pauses only at review points, and the audit trail reads true.

## 10. Non-goals

Cross-box relay/E2EE (tailnet is the boundary); authenticating sessions to
each other beyond attribution; parsing the ledger; autonomous reap; PWA mail
composition (humans already have the composer); replacing the SDD skill
mechanics; multi-coordinator arbitration (one coordinator per program; a
`claimedBy` column exists so a second one refuses).

## Operator rulings (2026-08-08)

1. **`/api/notify` adopts the box token in this build** — folded into §4.
2. **The coordinator is placed like any session** — `_ws_least_loaded`, no
   pinned account. (The four-homes skill install lane is what makes this
   safe: a swap can never strand it on an account without the skill.)
3. **Dogfood target confirmed: Build 4** run through the coordinator.

**Status: approved for planning and execution.**
