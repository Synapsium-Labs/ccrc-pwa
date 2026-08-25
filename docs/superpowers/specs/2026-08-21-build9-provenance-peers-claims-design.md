# Build 9 — provenance, peers and claims (design)

Three operator requirements arrived together and turned out to share one substrate:

1. **Same-project sessions conflict and cannot coordinate.** A live session wrote: *"I can't reach it
   directly — the addressable peer list only shows sessions on other projects, so quiet-river (running
   under claude2) isn't visible from here. Coordination goes through you."*
2. **"Who spawned it — not recoverable from the registry.** We should be able to recover who has spawned
   and stopped what sessions and why."
3. **"We also need record of destruction/cleanup."**

This document settles the design. It was written from three read-only investigations of the live boxes
(16 agents) and a four-architect design panel scored by three adversarial judges. Every fact below marked
*measured* was re-measured on `<fleet-host>` and `<server-host>` on 2026-08-21.

**The spine.** *Every act a session or a human takes on the fleet leaves an append-only line that
`_reg_purge` cannot reach; the server mirrors those lines into `coord.db` by polling; and every new
coordination primitive — peer discovery, D-number allocation, hot-file claims — is a query against that
mirror plus one compare-and-swap that only the box with a database can perform.*

**The proof.** An operator, from a phone, can answer *"what happened to workspace X, who killed it, why,
and what was lost"* for a workspace that no longer exists; and two sessions that want the same file or
the same deviation number find out **synchronously, at the moment of asking**, not at merge.

---

## §0 What is actually broken (measured, not inferred)

**ccrc has no shared past tense and no shared present tense.**

**No past tense.** Every registry write goes through one truncating writer — `_reg_set`
(`ccd/ccd:435-441`: `printf > tmp; mv -fT`) — so nothing in `~/.cc-sessions` appends except `.prhistory`
and `swap.log`. The consequences compound:

- `.spawn` is `"<epoch> <rc>"` — no actor, no reason — and the epoch is the **last respawn**, because
  `Restart=always` plus `_spawn_settle` (`ccd:8387`) overwrite it every supervisor cycle. **There is no
  creation timestamp anywhere in the registry.**
- `.stopped` is `"<epoch> <surface>"`, where `surface` is a validated closed set (`cli|pwa|agent|ccd`,
  else `unknown`, `ccd:619`). ccd's own comment: *"it is a DECLARATION, not an authentication, and
  `--surface pwa` means only that the caller said so."* It names a software path, never a human or a
  session. It is deleted on four paths (`ccd:591, 8391, 8745, 8832`), which is why **1 `.stopped` file
  survives across 24 rows** — and that one was written by `ws-archive` about itself.
- `.archived`/`.archivedreason` are cleared only by `ws-restore` (`ccd:3082`) and `_reg_purge`
  (`ccd:555`), never by `start`/`ensure`. **Measured: 4 of 8 `.archived` rows are live and heartbeating
  right now** while stamped `merged:#N` — `ccrc-pwa-calm-mesa`, `custom-tools-brisk-ridge`,
  `data-internal-plain-harbor`, `data-internal-still-prairie`. The one field in the registry carrying a
  *why* is false on half the rows that have it. **A field that is silently false reads as authoritative,
  which is worse than absence.**
- `_reg_purge` (`ccd:458-556`) unlinks **every** `$REG/<id>.<field>` behind a deliberately future-proof
  suffix filter, at `ccd:2088` (ws-rm), `6774` (ws-reap), `7253` (ws-gc dead-reg), `9688` (forget).
  **A destruction record therefore cannot live in the per-session keyspace** — a new registry *field*
  would be destroyed by the loop the day it was added.
- Of 18 sessions this box has destroyed and that are still discoverable at all, **11 are documented and
  7 are not**, and *who* and *why* are answerable for **zero**.

**No present tense.** Session-to-session mail **already works at the wire** — `POST /api/mail` with
`{fromId, fromUuid, toId:"<any registry row>", runId:null}` is accepted; the recipient check in
`server/src/coord/routes.ts` is a pure existence test that already answers three ways. What is missing:

- **Discovery.** `GET /api/fleet` needs a PWA cookie a fleet-host session does not have; `GET /api/runs`
  is the only box-token-readable listing and shows only sessions already in a run — none of the four live
  `ccrc-pwa` sessions is. The only working discovery is `grep -l ccrc-pwa ~/.cc-sessions/*.project`: a
  convention, not an API. (`ccd ls` prints no project.)
- **Arbitration.** There is **no compare-and-swap anywhere in ccd**. `_reg_claim()` is literally
  `_reg_set "$1" started 1` (`ccd:457`) — an idempotent flag, and its name is a trap. No `O_EXCL`, no
  `noclobber`; the mkdir-mutex was tried for the reap lock and abandoned. The only durable claim is
  `.hold`: free text, parsed nowhere, no expiry, per-**session** not per-**resource**, and **zero
  instances exist on the box**.
- **Etiquette.** Zero hits for `peer`, `sibling`, `worker-to-worker` across both skill corpora.

**Why the peer list looks the way it does.** `ListAgents` is a Claude Code harness feature unrelated to
ccrc; its scoping predicate is one line — peers are the other live `<pid>.json` in *your own*
`$CLAUDE_CONFIG_DIR/sessions/`. There is no project filter anywhere. Same-project sessions are invisible
because ccrc's own load balancer **deliberately scatters a project's sessions across accounts to spread
rate limits**, and an account *is* a config dir. The two scoping decisions are anti-correlated by
construction. Note the asymmetry: transport is **not** partitioned — all 21 session sockets share one
`/run/user/1000/cc-socks/`. Only the index is split.

**The honest limit on messaging.** Mining the actual conflict record produced nine classes ranked by
measured cost. A message solves **two**: PR merge-ordering (the quoted example) and duplicated effort
(PR #50 shipped another spec's mechanism under a different name). The three most expensive are not
communication failures — stale premise about `main`, semantic conflict on a shared module, and D-number
collision (`bb47c9e`: 30 files, 394 D-ref lines rewritten under merge pressure). And class 8 is the
disproof of the messaging thesis outright: two sessions collided on shared scratch **twice**, and one of
them *was* the coordinator that launched the other. Awareness did not prevent it. **That is why this
design ships a claim and an allocator alongside the message, and why the claim conflict response is
itself an address.**

---

## §1 Decisions

### D1 — The journal is a dot-prefixed *directory*, and that is what makes the feature possible

`$REG/.lifecycle/journal-<19-digit-epochNs>.ndjson`, greatest name is live; `.rotate.lock`; `errors`.

`_reg_purge`'s one-dot suffix filter is future-proof on purpose, so a registry field cannot hold a
destruction record. A dotted directory matches no `$REG/$id.*` glob (ids never begin with `.`) and no
`*.uuid` listing. **Precedent, already load-bearing:** `$REG/.reaped/` has survived since Aug 6 with
**zero deleters in 9,815 lines**, and `$REG/.reap-<id>.lock` likewise.

**The generation is in the filename**, not a header line. `readdir` alone then tells the mirror the whole
generation set with no second read; a rotation is *"a new name appeared"*, never *"the same file got
smaller"*; and a shrink on an immutably-named generation is unambiguously a truncation.

**NDJSON, UTF-8, one event per line, LF-terminated, `LC_LINE_MAX` = 2048 bytes.** One
`printf '%s\n' "$line" >> "$f"` per event. On Linux an `O_APPEND` write to a regular file is serialised
under the inode lock, so concurrent writers cannot interleave. **The precedent is measured, not assumed:**
`$REG/swap.log` — 141,762 B, 1,317 lines, 13 concurrent write sites, 49 days, **zero corruption**.

**The one defect of `swap.log` that this does not copy:** ~30% of its lines are untimestamped
because `ccd:7568` and `ccd:9423` redirect a *child's* stdout+stderr into it. Rule here, and it is
scanned: **nothing but `_lc_emit` may write into `.lifecycle/`.**

### D2 — Identity is three sibling families that never merge

Per the operator's ruling R3. `obs` / `dec` / `meas` are three objects on the wire, three column families
in the mirror, and three panes in the PWA. **Nothing computes a single "who".**

| Family | Fields | Source | Trust |
|---|---|---|---|
| **`obs`** — kernel-observed | `cg` (`ActorClass`), `cgraw` (the `0::` path verbatim, never dropped), `pid`, `ppid`, `pane`, `paneWhy`, `tty`, `ssh` | `/proc/self/cgroup`; ppid-ancestry via `/proc/<pid>/status` `PPid:` (**never `stat` field 4 — `comm` can contain spaces**) intersected with `tmux list-panes -a -F '#{session_name} #{pane_pid}'`; `[[ -t 0 ]]`; `$SSH_CONNECTION` | Unforgeable by env |
| **`dec`** — declared | `surface` (ccd:619's closed set; `"none"` when no flag), `actor`, `reason` (≤512 B) | `--surface` / `--actor` / `--reason` argv | Self-asserted |
| **`meas`** — measured about the *subject* | `project`, `workspace`, `branch`, `uuid`, `wrapper`, `tip`, `attic`, `archivedAt`, `archivedReason`, `held` | `_reg_get` + git, read **before** any destruction | Measured; `null` = not measured |

`obs.cg` resolves as `app.slice/ccrc-agent.service` → `agent`; `app.slice/tmux-spawn-<uuid>.scope` →
`pane`; `app.slice/claude-session@<id>.service` → `supervisor`; `user.slice/session-N.scope` → `login`.
**The systemd unit names the id in the cgroup path — that is respawn provenance nothing on this box has
today.** A double fork makes a caller *anonymous* (`ppid 1`), never *someone else*.

Exactly one pure L0 function, `corroboration(obsClass, decSurface)`, may relate the families. Its output
is `agrees | disagrees | not-comparable | unmeasured`, and a `disagrees` raises
`divergence.provenance-mismatch`. **A disagreement is a fact the operator sees, never a silently picked
winner.** ccd cannot refuse on identity — single UNIX user, attribution not authentication — and does not
pretend to. The record is the mechanism.

### D3 — The `_reg_purge` backstop: a future verb cannot destroy silently

A line is emitted **inside `_reg_purge` itself, before the unlink loop**, while `meas` is still readable.
Every destruction path on the box terminates there. A destructive verb added later that forgets to
journal itself still leaves a record; **a silent destruction has to defeat two independent emit sites.**

### D4 — Destructive verbs write an intent/outcome pair

`ws-rm`, `ws-reap`, `ws-gc --prune` and `forget` write one line before the irreversible act and one after,
sharing a `tx`. An `intent` with a `failed` sibling is a half-destroyed workspace; **an `intent` with no
sibling at all is a process that died mid-destroy** — precisely the measured hole (`$REG/.reap-<id>.lock`:
12 files, one with a lock and no tombstone, a reap attempted and refused, recorded nowhere). Orphan
detection is derived by the reader, never stored.

### D5 — Poll, do not tail

Three of the four architect drafts reached for `tailOpen`/`tailClose`, and every judge found a
silent-loss bug in some draft's tail seam — all different bugs in the same three places: `resync()`
jumping to EOF (`remote/io.ts:182-198`), `tail.ts:52-57` self-stopping on shrink, and a carry buffer
shared between a backfill and a live stream.

Lifecycle acts run ~100/day. **Paying a permanent silent-loss risk for latency nobody will perceive is a
bad trade.** `JournalMirror.sweep()` rides `FleetWatcher`'s existing tick, gated to `LC_SWEEP_MS` (5 s).
No new frames, no new grants, no `FLEET_PROTO` bump. If sub-second latency ever proves necessary, a tail
can be added **as a wakeup edge only** — its arrival schedules a sweep, its payload is never framed —
without disturbing any correctness reasoning here.

**Framing is complete inside one call.** `readFileFrom` returns `[cursor, size)` in one shot; a trailing
partial line is not consumed and the cursor advances only to the end of the last complete line. **There is
no cross-call carry buffer anywhere in the mirror, so there is no splice class.**

### D6 — Idempotency is intrinsic, not positional

`uid` = `<epochNs>.<BASHPID>.<seq>`, `UNIQUE`, inserted `OR IGNORE`. Positional identity
(`gen`,`startOffset`) was rejected: it is not a function of the bytes when the consumer does not own the
tail's offset, and a shifted offset silently collides under `OR IGNORE`.

Consequences: re-reading a generation from offset 0 is always no-op-or-catch-up; the cursor is an
**optimisation, never a correctness input** (advanced only inside the same `tx()` as its rows, so it can
never move past uncommitted data); and a truncation is **recoverable** rather than fatal.

**Gaps are recorded, never silently skipped.** A generation that disappears while undrained writes
`lifecycle_gaps{reason:'rotated-away'}`; a shrink writes `{reason:'shrank'}` and re-reads from 0. **A line
that does not parse is inserted** as `act:'unknown'` with `raw` holding the bytes verbatim: *a byte we saw
and could not model is a different fact from a byte that was never there.*

### D7 — The journal is best-effort and never gates an act

`_lc_emit` returns 0 on every path. A failed append bumps a counted `$REG/.lifecycle/errors` file
(temp+rename) surfaced in `/api/fleet/health`.

The doctrinal alternative — a destructive `intent` that fails to land makes the verb `die`, so *"ccrc
never destroys unrecorded"* — is **rejected, and this is the decision most worth challenging.** The disk
is at **92%** — it was 89% an hour earlier the same day — and journald is already vacuuming. The condition that makes a journal write fail is exactly
the condition in which `ws-rm`, `ws-gc --prune` and `ws-reap` are the recovery tools, and rotation cannot
rescue it because rotation needs a write too. **One unrecorded destruction is a gap in a record; a fleet
that cannot clean up is an outage.** The mitigations are the counted errors file, the `lifecycle.newestAt`
staleness signal, and the D3 backstop.

`_lc_rotate` caps the journal at 4 MiB per generation, 4 generations, hard ceiling 16 MiB, oldest-first,
**rename/mint-and-recreate, never truncate** (`agent/src/tail.ts:52-57` stops on shrink; a truncate would
silently end the mirror). Measured sizing: ~100 acts/day × ~350 B ≈ 35 KB/day ⇒ one generation ≈ 3 months,
four ≈ a year. **Retention is a ceiling, not a schedule** — which is the answer to *"is the flat file
really still ground truth?"*

### D8 — One ruling per table on re-measurement, each defended

`CLAUDE.md` says coord.db *"is a server-side RE-MEASUREMENT of ccd's flat files … a lost coord.db
reconstructs from them."* This is where a provenance log collides with doctrine, so it is ruled per table.

**`lifecycle_events` / `lifecycle_generations` / `lifecycle_gaps` — RE-MEASUREMENT, provably.**
`parseJournalLine` is pure and total: no clock, no lookup, no registry, no other row. The only
server-owned value is `ingestedAt`, explicitly labelled the server's clock and **never read as an event
time**. Replay from offset 0 is idempotent and total (D6). `raw` holds the line **verbatim**, so the drill
is byte equality rather than resemblance — and a field a *newer* ccd writes that this build cannot model
is therefore not lost: a later build re-projects from `raw` without re-reading the fleet box.
`server/test/lifecycle-replay.test.ts` executes the drill.

*The horizon, stated rather than papered over:* 4 × 4 MiB ≈ one year is the reconstruction window. Beyond
it the mirror holds history the file no longer does — the same standing `feed_events` has to
`NotifyLog`'s ring: **a durable archive behind a bounded live buffer.** Reported as `lifecycle.horizon`.

**Never pruned.** `feed_events` prunes to 2000 because it backs a UI ring; this table *is* the record
`WsTombstone`'s own docstring calls *"the record that OUTLIVES the workspace"*. ~90 MB/year, on the server
box (not the 92% one), inside the `VACUUM INTO` snapshot `deploy.sh` already takes. Row count and size are
reported so the operator sees it coming.

**`ledger_alloc` — authoritative, and given a flat-file ground truth so the doctrine holds without a
special case.** Every allocation is appended to `~/.ccrc/ledger-alloc.log` **first** and committed
**second**; recovery takes `MAX(file, db)`, so a number is **skipped, never reissued**. Gaps cost nothing
(the ledger is prose, parsed by nothing); a reissue costs 394 rewritten D-ref lines across 30 files under
merge pressure.

**`claims` — authoritative, and its loss is FREE by construction.** There is no flat file to re-measure;
manufacturing one would require widening the agent's write whitelist beyond `.cc-clips` — the one
structural guarantee keeping the agent from corrupting the files it reads — and would re-open the
naming-sweep trap (D12) the moment anyone reached for `ws-hold`. Losing coord.db expires every claim at
once, which is exactly the pre-feature state: **sessions lose protection, never work**, and re-claim on
their next attempt. The lease is what earns that reading, and it is why claims got a lease before they got
a table. Written into the migration's own docstring so nobody later files it as a doctrine violation.

### D9 — Discovery reports the contradiction instead of resolving it

`GET /api/peers?project=<slug>` or `?of=<sessionId>` (exactly one), authenticated by **a live PWA cookie
OR the box token** — verbatim the `GET /api/runs` dual arm (D-149).

The route **does not filter on `.archived` at all**, and there is no boolean called `addressable`:

- `archivedAt` is reported verbatim and decides nothing. **A field that is silently false must not be
  laundered into a filter.**
- `deliverable` is decided by `peerDeliverable()` (L1) from the **structural** rungs of `sweepMail`'s own
  ladder — registry row measured → tmux verdict → pane pid → lifecycle not `stopped`/`orphan`/
  `never-started`. The **transient** rungs (120 s cooldown, single-flight latch, unanswered ask, quiet
  ≥60 s) stay in `sweepMail`: those are lane state, and reporting them here would tell a caller a *busy*
  peer is unreachable — the exact lie R2 forbids. `'unknown'` (registry unmeasurable) is **not** `'no'`.
- `archivedStale` **names** the contradiction (an adapter may not narrow a distinction it received) and
  the same predicate feeds `divergence.archived-but-live` — the four measured rows go from silently false
  to loudly flagged with **zero ccd semantic change**.

`projects[]` — every project measured this pass — replaces a `projectKnown` boolean. A typo'd project is
this feature's central failure mode (a worker gets `[]`, concludes *"I am alone"*, and conflicts), and the
obvious fix, one `io.stat` of the project dir, is built on the one call the tree already knows lies: the
agent's `stat` answers EACCES as `{missing:true}` (D-114). `projects[]` is a measurement the route already
performed, is free, and tells a typo from an empty project without asking a question whose answer is
unreliable.

**`sweepMail` is not refactored.** Instead `server/test/deliverability-parity.test.ts` drives both
implementations over one fixture table and asserts they agree on every structural rung — the
`_session_state`/`sessionLifecycle` two-implementations-one-fixture precedent. Single-definition of the
*decision*, zero edits to the most load-bearing loop on the box.

### D10 — The idle gate is untouched, and the synchronous 409 is what makes that acceptable

Per R2. No priority tier, no `replaceDraft`, no interrupt path, no new `MailKind` (a new member is a
cross-language edit through the `KIND_WORD`/`KIND_GLYPH` total maps for something `toId` already says).
A busy peer gets its mail when it next idles.

This is only tolerable because **a session never learns it lost a race by mail.** It learns from the 409
it is already reading, synchronously, mid-request, while awake.

Four holes a second mail producer opens are closed first (Wave 0):

| Hole (measured) | Fix |
|---|---|
| `hasOutstandingMail` is `WHERE m.runId = ?` (`store.ts:1160`) — a bound NULL equals nothing, so the dedupe guard **structurally cannot fire** for peer mail | `m.runId IS ?`, signature widens to `number \| null`. SQLite `IS` is null-safe both arms, so still **one** query, one reader |
| No quota; nothing in the tree ever DELETEs from `mail`/`mail_deliveries` | For `runId === null` only: 3 outstanding per pair, 12/hour per sender → `429 peer-quota`; same `(fromId,toId,subject)` outstanding → `409 duplicate`. Both recorded in `mail_rejections`. **Bound the producer, never the record** |
| `markIngested` (`store.ts:1330`) lacks the terminality guard, shielded today only by its single caller's query filter | `AND state NOT IN ('acked','rejected')` |
| `bumpReplayCount` (`store.ts:1319`) same, **and returns a bare `number`** | Guard added **and the return becomes a union** `{state:'counted',replayCount} \| {state:'terminal'}`. Adding the guard while still returning a count hands the caller an unchanged number that reads as *"not yet at the ceiling"* for a row already parked — two conditions, one value, at a seam. **The union is the fix; the guard alone is not** |

### D11 — CAS lives in `tx()`, and the async prohibition is why it is correct

Not in ccd, and none is added there (§0). CAS lives in `coord.db` inside `tx()` (`BEGIN IMMEDIATE`),
sound for two reasons that hold only there: there is exactly one server process, and `DatabaseSync` has
**no async surface**, so a whole transaction runs without yielding the event loop.
**`CLAUDE.md`'s "do not wrap it async" is not a style preference here — it is the reason the allocator is
correct.**

Two mechanisms, and the order is the ruling:

1. **The in-transaction read is the CAS.** `POST /api/claims` expires lapsed rows, reads *all* live
   conflicting paths (exact match **and** directory-prefix containment — `shared/` vs `shared/api.ts`,
   which no index can express), then inserts.
2. **The partial unique index `claim_one_owner` and `ledger_alloc`'s `PRIMARY KEY (project,n)` are the
   backstop:** if a future refactor ever loses the transaction, the failure is a **loud constraint
   violation**, never a duplicate. Commented in that order so a reviewer does not assume one is redundant.

### D12 — Claims are advisory, all-or-nothing, and the conflict response is an address

**Advisory, never enforcing**, and that is a red suite: `server/test/claims-advisory.test.ts` scans
`ccd/ccd` for any claim reference (must be zero) and asserts the only readers of `activeClaims` in
`server/src` are the routes, `peers.ts` and `divergence.ts`. An **enforcing** claim on `ccd/ccd`
(15 concurrent branches measured) or `shared/api.ts` (18) is the permanent wedge.

**All-or-nothing.** Five paths, one conflict ⇒ zero acquired, and the 409 names **every** conflicting
path, not the first. Partial acquisition is how two workers each end up holding half of what the other
needs. A claim on `.` or `''` is refused `bad-path` — claiming the whole repo *is* the module wedge.

**The 409 carries `heldBy`, `heldByUuid`, the holder's stated `intent`, `runId`, `expiresAt`,
`deliverable`, and a pre-addressed `mailHint`.** Conflict classes 4 and 7 are *"solved by a message"*, and
class 8 proves awareness alone does not prevent a collision — so the mechanism does not stop at telling
you; it hands you the envelope. `deliverable:'no:<reason>'` degrades the hint to *"escalate to the
operator"*, never to a silent send.

**No session-side heartbeat.** *A protocol a model must remember is a protocol that will be forgotten, and
the failure is a wedged module.* `renewClaims()` rides `FleetWatcher`'s existing tick off records it has
already read: holder measured running ⇒ renew; measured gone ⇒ lapse at the standing `expiresAt` with
`endedBy:'session-gone'`; **registry unmeasurable ⇒ doubt reads as HELD** (matching ccd's four `-e` hold
readers and `registry.ts`'s `HOLD_UNREADABLE`) so a fleet-box hiccup cannot mass-expire every claim;
`hardExpiresAt` (8 h) is **never renewed**, so doubt cannot hold forever and every claim must be
periodically re-declared. Run close releases that run's claims in the close transaction. Expiry is also
applied in the same transaction as every claim attempt — the `feed_events` prune-on-write idiom — so a
claim route never sees a stale row even if the watcher is wedged.

**Lapse, do not delete.** An expired claim becomes `state='lapsed'` with `endedAt`/`endedBy`; the row
survives and `GET /api/claims?all=1` shows *"held by X until it died"*. A destroyed claim is destroyed
history.

**Refcounting is a query, not a counter.** The measured failure (class 6) was a hold keyed on session, not
resource. Path claims need none — one owner per `(project,path)` by construction. For the workspace hold,
`releaseIsSafe(siblings)` over `openRunsForSession(id, excludingId)` already answers it at
`close.ts:176`; this program adds only the alarm `divergence.claim-orphan`. **A counter you can increment
twice is a counter you can leak; a query over rows cannot.**

**The naming-sweep trap, answered head-on.** `sweepNames` skips a row when it is held or in an open run —
so the best *"what is this session doing"* signal on the fleet **freezes the moment a workspace is held**,
and the obvious design (write the claim into `$REG/<id>.hold`, reuse `ws-hold`) would silently freeze the
ai-title of every claiming session for the life of the workspace. Three rulings: **(1)** a claim writes
nothing to the registry — no `.hold`, no run, no verb, no grant; **(2)** the sweep's freeze stays, because
it is correct for what it guards (`ws-rename` renames the *branch*, and a branch renamed mid-wave breaks
the coordinator's ledger); **(3)** the signal is **replaced, not merely spared** — `intent` (≤512 B,
re-writable at any moment by re-POSTing the same paths, which also renews) is rendered on `PeerSummary`,
the `HotFilesStrip` and the session line. *A branch name is written once; an intent can be written every
ten minutes.* Pinned by `claims-no-hold.test.ts`, whose third assertion exercises the **real** sweep,
because asserting a file's absence alone would stay green the day someone "simplifies" claims onto
`ws-hold`.

### D13 — The allocator self-seeds, then fails shut

`POST /api/ledger/deviations` (box token) → `201 {numbers, floor}`. `sweepLedgerFloor` (hourly) reads
`docs/superpowers/{plans,specs}/*.md` through the already-granted `io.readdir`/`io.readFile`, takes
`max(D-<n>)` and writes `floor = max + LEDGER_SEED_GAP (50)` with evidence naming the file and the number.
**The floor only ever rises.** Until seeded, allocation answers `409 not-seeded` — `openCoordDb`'s own
*"refuse to start rather than open empty"* rule, one level up.

**The 50-number gap is not decoration:** numbers allocated but not yet written into any plan are invisible
to the scan, and re-issuing one *is* the `bb47c9e` failure. Burning 50 integers costs nothing.

`sweepLedgerReconcile` (15 min) marks `allocated → landed` when the number appears in a plan in the **main
checkout**, so `landed` genuinely means merged — the signal the incident lacked, since the authoritative
record sat on an unmerged ref for 15 hours. A `stale` number (7 days, never landed) is reported and
**never reclaimed**.

**Allocator prevents; a scanner detects.** `server/test/deviation-refs.test.ts` fails when one `D-<n>`
carries two different subject lines in two different plans — the exact `bb47c9e` shape, caught by a red
suite with no server involved.

**Server-down is a loud mechanical blocker, not a judgement call.** A session that cannot reach the
allocator **must not invent a number** — inventing is the root cause. The coordinator pre-allocates the
program's block at run-open (clause 10), so a wave in flight never calls the allocator; and a worker that
genuinely finds an unplanned deviation writes `D-TBD-<slug>`, which `server/test/dtbd.test.ts` turns into
a red suite on any diff that tries to land one.

### D14 — One deviation namespace (operator ruling)

The legacy build-scoped forms (`D-282 (was D-B4-9)`, `D-309 (was D-B8-13)`) are **reconciled into the single global sequence**
rather than frozen as a second namespace.

**This must not destroy history.** `CLAUDE.md` is explicit that D-refs in source comments are authoritative
history and are not to be deleted, so reconciliation is a *rename with a preserved alias*, never a
rewrite that loses the original:

1. Enumerate every `D-B<k>-<m>` ref across `docs/superpowers/**` and tracked sources, in stable order.
2. Allocate one global number per legacy ref through the allocator, so the mapping itself is recorded in
   `ledger_alloc` (with `title` carrying `was D-B4-9`) and in `~/.ccrc/ledger-alloc.log`.
3. Rewrite each ref as `D-<n>` and record the mapping in a committed table,
   `docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md`. Source comments carry
   `D-<n> (was D-B4-9)` on **first occurrence per file**, so a reader following an old citation lands.
4. `floorFromScan` recognises both forms during the transition; `deviation-refs.test.ts` gains an
   assertion that no bare legacy form remains once the wave lands.

**Consequence stated loudly:** this wave touches D-ref comments across the tree and will conflict with any
in-flight branch — it is itself a conflict-generating change, which is exactly what the rest of this
program exists to prevent. It runs **last**, in an operator-announced quiet window, and it cannot protect
itself with a claim (claiming `.` is refused by D12). **Do not schedule it concurrently with a wave.**

### D15 — Destructive-semantics changes (operator ruling R4)

**R4-1 · `ws-rm` takes an attic pin before deleting.** In `cmd_ws_rm` (`ccd:1953`), after the full
refuse-first ladder and **before** `_ws_unsupervise` at `ccd:2039`: resolve the tip from the worktree, else
from the registry branch, then call `_ws_attic_pin` (`ccd:5283`) verbatim with all four arguments —
`cmd_ws_rm` already has them in scope, and the helper's own header licenses this. **Unconditional:** the
pin happens even when `git branch -d` later refuses, because that is the case where the commits matter
most. Today a detached-HEAD `ws-rm` leaves commits referenced by nothing on git's default 2-week fuse,
while `ws-gc` refuses that exact case — the sharpest reversibility gap found.

*Deliberate asymmetry, a measurement rather than a fabricated zero:* an unreadable tip with the directory
**present** is a refusal (`ws-rm`'s contract is *"refuses anything it might destroy"*); an unreadable tip
with the directory **already gone** is `atticsrc:'none'`, recorded and allowed — refusing there would
wedge cleanup on a workspace with nothing left to protect.

**No `_ws_tombstone` call from `ws-rm`.** It dereferences seven `REAP_*` globals set only inside
`_ws_reap_eval`, under `set -uo pipefail` (`ccd/ccd:7`): the subshell dies, `ws-rm` proceeds, and the
promised record is **silently absent**. The `destroy` line carrying `tip`/`attic`/`branch` **is** ws-rm's
tombstone. `WsTombstone` stays reap's and gets its first *consumer* instead — `GET /api/lifecycle` joins a
`ws-reap` row to `$REG/.reaped/<id>.json` through the already-whitelisted read.

**R4-2 · `ws-restore` supersedes rather than erases.** Emit a `restore` line carrying `archivedAt`,
`archivedReason` and `manifestBytes` **inline**, immediately before the `rm -f` at `ccd:3082`, **inside the
flock region already held** (`ccd:3072-3076`) so the values read are the ones being erased. Today
archive → restore is a clean forgery of history. **No new registry field:** a 25th per-session field costs
a `SessionRecord` field, a `reviveFleetSession` literal change and 24 extra agent round-trips per 2 s
tick, for a fact the journal already carries and `_reg_purge` deletes anyway. *Disclosed residual:* the
manifest is preserved only as a byte total.

**R4-3 · Refused destructions get a record.** `_lc_refuse verb id token message` emits
`outcome:'refused'` then `die`s, so **refusal and death cannot drift**. Call sites live **only** inside the
destructive verbs, never inside `die` itself — that would fabricate a *"refused destruction"* for every
usage error on every verb. `ws-reap` gets **one** emit at the single point where `REAP_VERDICT` becomes
JSON (not 36 call sites) plus one on the `flock -n` decline, which closes the measured hole exactly.

*The `SENTENCES` ruling.* `server/test/wsaudit.test.ts:53-95` pins `wsaudit.ts`'s `SENTENCES` **set-equal
in both directions** to tokens grepped from ccd by four regexes. `_lc_refuse` changes **no stdout and no
exit contract**, so it produces no `verdict`/`refused` JSON — the boundary that test's own docstring
already draws for `die` failures. Therefore **no `SENTENCES` entry is added** (one would red the
stale-copy direction); journal-only tokens get their PWA word from `LC_REFUSAL_WORD` in L0. **`wsaudit.test.ts`
must stay green with no edit — that is itself an assertion of this program.** And the journal field is
spelled `"refusal"`, never `"refused"`, so the emitter's format string cannot poison that test's scan.

### D16 — `GET /api/lifecycle` is readable with the box token (operator ruling)

A worker can ask *"what happened to my workspace"* without a browser. It becomes an
**exempt-but-authenticated** route on the D-149 pattern (cookie **or** box token), which has two forced
consequences, both accepted:

- `auth/gate.ts`'s `EXEMPT` map gains **seven** entries rather than six.
- `coordinator-skill.test.ts` requires every registered route to be **named in the corpora** minus its own
  `EXEMPT` set. So `GET /api/lifecycle` **must be named in both skill corpora**, and that set grows only
  3 → 4 (`POST /api/claims/:id/break` alone stays unnamed — the `POST /api/runs/:id/abandon` shape: a door
  the claimant is not the one to walk through).

### D17 — Etiquette lives in the route response first, the skills second

| Home | Content | Why there |
|---|---|---|
| **The route response** (`etiquette`, from `PEER_ETIQUETTE`, L0) | The five rules, verbatim | **The primary home, and D-107 is why:** a skill reaches a config dir only once its installer has run there, and none of the four live `ccrc-pwa` sessions is in a run. A session that can discover peers is handed the rules in the same answer, installer or no installer — and the text cannot go stale relative to the route |
| **Worker clause 11**, appended at END | claim before you edit; a 409 names the holder and *is* the address; discovery is `GET /api/peers?of=<your id>`; history is `GET /api/lifecycle`; read each row's own `lifecycle`, not its archive stamp; peer mail is human-timescale; never invent a deviation number | `CONTRACT[7]` is index-addressed, so appending is safe. Literals are double-quoted ⇒ **no `"` character, straight apostrophes only** (D-104) |
| **Coordinator clause 10**, appended at END | allocate the program's D-block at run-open and name it in the brief; ask `GET /api/claims?project=` before splitting the work; a wave that dispatches two workers onto overlapping claims is a defect in the ledger | Single-quoted literals ⇒ **curly apostrophes**. The three most expensive conflicts are coordinator failures |
| **`coordinator-skill/references/peer-protocol.md`** | Long form: curl shapes, reading a 409, what a good peer question looks like, what to do when you lose a race | The worker skill may never grow `references/` (`expect(readdirSync(skillDir)).toEqual(['SKILL.md'])`) and points at the coordinator's, as it already does |
| **`WORKER_KICKOFF_PREFIX`** | **Zero bytes** | 102 of 8192, and the 8090 effective ceiling is arithmetic-pinned: every byte reds that test and shrinks **every** brief forever. Standing protocol is precisely what the prefix must not carry — its job is to invoke the skill that carries it |

**Route-parity accounting, because it is what forces the rollout order.** `coordinator-skill.test.ts:158`
scans `server/src/coord/routes.ts` only, matching `app\.(get|post)\(`. Therefore: **all 8 new routes are
registered in `coord/routes.ts`**, guarded by `coord-routes-single-file.test.ts` (with a scanner-coverage
floor, because a scan over an empty list passes everything); and **no `DELETE` routes anywhere** — the
scanner's regex knows only get/post, so a DELETE route would be registered and named nowhere. Release is
`POST /api/claims/:id/release`.

---

## §2 Component map

**`shared/` (L0, imports nothing).** `LIFECYCLE_ACT_MAP` (total; `LIFECYCLE_ACTS = Object.keys(...)`
derived — the `PR_REASON_MAP` idiom), `LIFECYCLE_OUTCOMES`, `ACTOR_CLASS_MAP`, `corroboration()`,
`LifecycleEvent`/`Obs`/`Dec`/`Meas`, `LC_REFUSAL_WORD` (deliberately disjoint from `wsaudit`'s
`SENTENCES`), `PeerSummary`/`PeerDeliverable`/`PEER_ETIQUETTE`, `ClaimSummary`/`ClaimConflict`/
`CLAIM_STATES`/`DeviationAllocation`, `MAIL_REJECT_CODES += duplicate | peer-quota`, and the constants.
**`StopSurface`, `WsTombstone` and `FLEET_PROTO` are unchanged** — no fifth surface word, no proto bump.

**`ccd/` (the substrate).** `_lc_emit` (the one writer), `_lc_intent`/`_lc_done`/`_lc_refuse`/`_lc_fail`,
`_lc_obs` (memoised once per process), `_lc_live`/`_lc_rotate`, `_LC_ACTS`, `cmd_caps += lifecycle-v1,
actor-flags-v1`, and 20 call sites. **No carry globals** — `tip`/`attic`/`tx` are arguments, because the
`LC_TIP=` idiom dies under `set -u` on the first call in a process, appending a blank line nobody notices.
**Not emitted from `_reg_set`** (thousands/hour, no forensic value) **nor from `session-hook.sh`** (hot
path of every tool call; its exit-0-on-every-path contract is absolute). `_spawn_settle` emits
**change-only** — a differing rc, or >300 s since this id's last `spawn` line — because without that rule
`Restart=always` × 18 sessions is the whole disk budget.

**`agent/` — zero code changes, zero new grants, zero new frames.** `~/.cc-sessions` is already
read-whitelisted (`whitelist.ts:83-84`) and `canonicalize` walks up to the longest existing prefix, so
`$HOME/.cc-sessions/.lifecycle/…` is read-allowed **before the directory exists**. The only agent-side
delta is a **test**: `agent/test/whitelist.test.ts` pins the journal path `read`-allowed and
`write`-**forbidden** — the agent structurally cannot corrupt the log it reads. `whitelist-subset.test.ts`
staying green **with no edit** is the proof of the zero-grants property.

**`server/`.** L1 pure: `journalparse.ts` (`parseJournalLine`), `mirrorplan.ts` (`planSweep` — decides,
does not act), `peers.ts` (`peerDeliverable`, `archiveContradicted`), `claims.ts` (`decideClaim`,
`claimExpiry`; declares `interface LivenessProbe` as an L2 port, by the consumer), `ledger.ts`
(`decideAllocation`, `floorFromScan`). L3: `mirror.ts`, `schema.ts` (`MIGRATIONS[2]`, `MIGRATIONS[3]`;
`COORD_SCHEMA_VERSION = MIGRATIONS.length` derives), `store.ts`, `ledgerlog.ts`, `ccdargv.ts`
(`capSupported` generalises `stopSurfaceSupported` with the same inverted no-evidence default). L4:
`coord/routes.ts` (all 9 registrations, each a union→status map with a `default: never` totality guard),
`watch.ts` (sweeps on the **existing** tick — no new timer, `sweepMail` untouched), `server.ts`,
`gate.ts`. L5: `index.ts`, composition only.

**`pwa/` (L4, last wave, deliberately small).** `HistoryTab.tsx` (one session's timeline; `obs` and `dec`
side by side, `disagrees` in its own colour), `HotFilesStrip.tsx`, `journalWords.ts` (consumes
`LIFECYCLE_ACT_MAP`), two typed fetchers. **No decisions.**

---

## §3 Failure modes

| Condition | Behaviour |
|---|---|
| **Agent WS drops mid-sweep** | The mirror holds no subscription. `readdir`/`readFileFrom` answer `null`, no cursor advances, the next tick resumes at the same offset. **No loss, no duplicates, no reset dance** — the whole reason for D5. `lifecycle.lastOk` makes a persistent drop visible |
| **`coord.db` lost** | `lifecycle_events` **rebuilds by replay** from retained generations, bounded by the ~1-year horizon, with any older loss recorded as a gap. `ledger_alloc` rebuilds from `~/.ccrc/ledger-alloc.log` as `MAX(file, db)` — numbers **skipped, never reissued**. `claims` are gone and self-heal (every lease ≤45 min; the pre-feature state is "no claims"). `runs`/`mail`/`programs` recover by the existing drill |
| **Server down, a session wants a D-number** | It does not get one and **must not invent one**. Coordinator pre-allocation means a wave in flight never calls the allocator; `D-TBD-<slug>` plus `dtbd.test.ts` turns the outage into a red suite rather than a judgement call |
| **Two sessions race the allocator** | Serialised by `BEGIN IMMEDIATE`; `DatabaseSync` cannot yield inside it. `PRIMARY KEY (project,n)` makes any future loss of the transaction a loud constraint error, retried 3× in-request. `ledger-race.test.ts` fires 20 concurrent allocations and asserts 20 distinct contiguous numbers |
| **A session dies holding a claim** | Lapses within 45 min, `endedBy:'session-gone'`, row retained; run close releases immediately; the 8 h hard cap is what no measurement can extend. **An unmeasurable session releases nothing — not-knowing is not death** |
| **Older ccd, newer server** | No `lifecycle-v1` ⇒ the mirror never sweeps and every surface says *"this box's ccd does not write the lifecycle journal"* — a **measured absence, never an empty history**. No `actor-flags-v1` ⇒ `capSupported` is **false on no evidence**, so no flag is appended: the wrong guess here costs a **silent success** (an old ccd parses `--surface pwa` as a workdir, exits 0, and `runCcdOr502` reports `200 {ok:true}`) |
| **Newer ccd, older server (incl. rollback)** | ccd writes; nobody reads; it self-bounds at 16 MiB. An unknown act degrades to `'unknown'` with `raw` verbatim, so a re-upgrade re-projects without touching the fleet box. A rolled-back server meeting a higher `user_version`: `db.ts:105` rule 3 warns, reads, and refuses only to migrate; `SELECT *` is banned in `coord/`, so unknown columns are ignored |
| **Journal deleted** | `readdir` stops listing it ⇒ `gap{reason:'rotated-away'}`, cursor retired. The next emit mints a fresh generation — just a new name to ingest. Everything mirrored is safe |
| **Journal truncated in place** | `size < cursor` on an immutably-named generation ⇒ `gap{reason:'shrank'}`, cursor reset to 0, re-read; `uid` dedupes. Only genuinely-lost bytes are lost, **and the loss is a row, not a silence**. The agent structurally cannot do it (write whitelist is `.cc-clips` only; `FleetIO` has no unlink) |
| **Disk fills (92% today, 24G free, rising)** | The append fails, `errors` is bumped, **the act proceeds** (D7). Rotation caps the journal at 16 MiB oldest-first, so the journal cannot be what fills the disk — and `ws-rm`/`ws-gc --prune`/`ws-reap` remain the tools that fix a full disk rather than its first casualties. `lifecycle.writeErrors` and `lifecycle.newestAt` make a silently-stopped journal visible rather than indistinguishable from a quiet fleet |
| **A caller lies about `--surface`** | The kernel field contradicts it, `corroboration()` says `disagrees`, `divergence.provenance-mismatch` raises it. ccd cannot refuse on identity and does not pretend to |
| **A destroyer edits the log** | Not preventable on a single-uid box; made **tamper-evident**: mirrored cross-box within one sweep (≤5 s), unreachable by `_reg_purge`, `_json_str` means `--reason` cannot forge a field, and a truncation is itself an alarm row. **Stated ceiling: a destroyer erases at most the last five seconds of its own tracks, and the erasure is visible** |

---

## §4 Test strategy — every guard has a mutant that reds it

Doctrine: *"A comment is a request; a red suite is a mechanism."* TDD red-first; each guard measured
before/after, not asserted in a comment.

| Guard | Mutant | Test |
|---|---|---|
| `ws-rm` attic pin | delete the `_ws_attic_pin` call | `ccd-ws-rm-attic.test.ts` — 3-commit unmerged fixture, then `git for-each-ref refs/ccrc/attic/<id>/` |
| …and its **ordering** | move the pin after `git worktree remove` | same — the reflog read needs `$workdir`; **this is the mutant that matters** |
| `ws-restore` supersede | move the emit below the `rm -f`, or delete it | `ccd-ws-restore-supersede.test.ts` — archive `merged:#42`, restore, assert `meas.archivedReason === 'merged:#42'` |
| …and its **flock scope** | emit outside the flock region | `ccd-restore-reap-lock.test.ts` — a concurrent reap can change `archived` between read and unlink |
| Refusal records | revert any `_lc_refuse` to a bare `die` | `ccd-refusal-record.test.ts` — 5 ws-rm + 2 reap refusals, each exactly one `outcome:'refused'` line with the exact token |
| …and the **next editor** | add a *new* unrecorded `die` to a destructive verb | `ccd-refusal-scan.test.ts` — slices the four function bodies, asserts every `die "` is reached through `_lc_refuse`/`_lc_fail`, **with a scanner-coverage assertion that the bodies were found and are non-empty** (precedent: `ccd:2123-2125`) |
| `wsaudit` non-poisoning | emitter spells `"refused":"` | `ccd-wsaudit-nonpoison.test.ts`; and `wsaudit.test.ts` must stay green **with no edit** |
| Re-measurement | — | `lifecycle-replay.test.ts`: ingest, `DELETE FROM lifecycle_events`, sweep again, assert identical modulo `id`/`ingestedAt` |
| Claims never touch the registry | "simplify" claims onto `ws-hold` | `claims-no-hold.test.ts` — third assertion exercises the **real** `sweepNames` |
| Claims never enforce | any ccd reference to claims | `claims-advisory.test.ts` — source scan, must be zero |
| Allocator atomicity | lose the transaction | `ledger-race.test.ts` — 20 concurrent, 20 distinct contiguous |
| Deliverability single-definition | the two ladders drift | `deliverability-parity.test.ts` — two implementations, one fixture table |
| Agent cannot write the journal | widen the write whitelist | `agent/test/whitelist.test.ts` — journal path read-allowed, write-forbidden |
| Cross-language act vocabulary | ccd emits an act L0 does not declare | `lifecycle-vocabulary.test.ts` — set equality; ccd writes `act:"unknown"` + `badact` rather than an undeclared token, so equality holds by construction |
| Route parity | a route registered outside `coord/routes.ts` | `coord-routes-single-file.test.ts`, with a scanner-coverage floor |

**Fixture HOMEs only.** Every ccd test runs under `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`)
with cleanup in `tmpHelpers.ts`; `ghContainedEnv()` plants a poisoned `gh`. **No test may touch the live
`$HOME`, the live registry, or run a destructive verb outside a fixture.**

---

## §5 Rollout

**Agent-first is forced:** anything touching `ccd/`, `session-hook.sh` or `ccd/*-skill/` ships
`bash deploy/deploy.sh agent <host>` **before** `bash deploy/deploy.sh`. Executables land via
`install_atomic`; the server lane's final gate is `/health` reporting the shipped sha.

| Wave | Package | Contents | Dark? |
|---|---|---|---|
| **0** | server | Mail hardening **before any second producer exists**: both terminality guards, `bumpReplayCount`'s union return, `runId IS ?`, the two new reject codes + quotas | Dark |
| **1** | shared (L0) | All `shared/api.ts` additions in one commit | Dark (types only) |
| **2** | **ccd — agent-first** | `_lc_*` helpers, `_LC_ACTS`, all 20 call sites **including the `_reg_purge` backstop**, `caps += lifecycle-v1` | **Dark: the journal fills, nothing reads it.** Zero server dependency, zero skew risk |
| **3** | **ccd — agent-first** | D15: attic pin, supersede, refusal/failure records incl. the `flock` decline; `--reason` on `ws-rm`/`forget` | Dark |
| **4** | server | `MIGRATIONS[2]`, `journalparse`/`mirrorplan`/`mirror`, store methods, `GET /api/lifecycle`, the `/api/fleet/health` block, `divergence.provenance-mismatch` + `archived-but-live` | **Problems 2 + 3 solved and queryable** |
| **5** | **ccd — agent-first** | `--surface`/`--actor`/`--reason` flag loops on `ws-archive`/`ws-restore`/`ws-hold`/`ws-release`/`ws-rename` — validated `--flag`s, closed sets, **never positionals** (`ccd:8780-8791` is the paid lesson: a second positional on `ensure` reached a bash arithmetic context where a command substitution **executes**); `caps += actor-flags-v1` | Dark until 6 |
| **6** | server | `capSupported`, `ccdargv` threading, `GateDecision.device` | **`archiveMerged`'s timer and a human's `ws-rm` stop being byte-identical** |
| **7** | server | `MIGRATIONS[3]`, `peers`/`claims`/`ledger`/`ledgerlog`, the 7 remaining routes, `renewClaims`/`lapseClaims`/`sweepLedgerFloor`/`sweepLedgerReconcile`, `divergence.claim-orphan`, the `deviation-refs`/`dtbd` detectors | **Problem 1 solved** |
| **8** | **ccd skills — agent-first**, then server | Coordinator clause 10 + `references/peer-protocol.md`; worker clause 11 | **Last, and forced to be** — `coordinator-skill.test.ts` requires every route a corpus names to already be registered, so naming `POST /api/claims` before wave 7 is a red suite. *That parity test is the ordering mechanism* |
| **9** | pwa | `HistoryTab`, `HotFilesStrip`, `journalWords`, two fetchers | The operator surface |
| **10** | docs + sources | **D14 namespace reconciliation.** Operator-announced quiet window; must not run concurrently with any wave | — |

**Four of ten waves ship dark**, deliberately: the risky half — touching every destructive verb in a
9,815-line bash script — lands and bakes on the fleet host before one line of server code depends on it.

**Caps tokens negotiate a *server decision*, not a file.** `lifecycle-v1` decides *sweep at all*; absent ⇒
`state:'unavailable'`, because **an old ccd's silence must not read as a quiet fleet**. `actor-flags-v1`
decides *append the flags*; **false on no evidence**, because the wrong guess is a silent success. Both are
verb-shaped so they need no new parsing — the argument that put `stop-surface` on that channel.
`ccd-archive.test.ts`'s caps↔dispatcher parity list moves from "exactly one token" to an exact 3-member
set, a deliberate visible edit in waves 2 and 5.

**Rollback both directions.** ccd waves roll back via `install_atomic`; the server observes the token
vanish and degrades along the negotiated path. Server waves roll back by redeploying the previous build,
which meets a higher `user_version`: `db.ts:105` rule 3 warns, reads, and refuses only to migrate. The one
irreversible step is a migration that has run — rolling back leaves the tables in place and unread.
Harmless.

---

## §6 Deliberately excluded

`tailOpen`/`tailClose` (D5). A `_ws_tombstone` for `ws-rm` (D15). Touching `_ws_unsupervise`'s stamp,
arity or its four surfaceless callers — the choke point's erasure of the verb is repaired **upward**, in
the journal. **Any agent change** — no frame, no grant, no capability; zero grants is the design's
headline property. `POST /api/lifecycle/rebuild` — a route that deletes the provenance store is
`ws-restore`'s forgery rebuilt as HTTP; the replay drill is a test. Pruning `lifecycle_events` or `mail` —
**bound the producer, never the record**. A new `MailKind`, a priority tier, `replaceDraft`, any interrupt
path (R2). **A new ccd verb, read or write** — a read-only verb still costs a whitelist grant, and the
server already reads `$REG` through a granted path. Enforcing, shared, glob or queued claims, and deadlock
detection — the measured conflicts are 2-3 sessions on a handful of files, not a scheduler problem.
Retroactive reconstruction from the 8,651 transcripts — a reconstructed line would be indistinguishable
from an observed one in the same table, and coverage is structurally partial (account `gpt` writes no
transcript at all). systemd-journal integration — 18.5 days, size-capped, vacuuming at 92%, and a 30-day
grep of `ws-reap|ws-rm|ws-gc|ws-archive` returns **0 hits**: it records the death, never the killer.
Server-side request logging — strictly less evidence than the journal, plus a new unbounded file on the
92% disk. Signing or hash-chaining — single uid: a key on the same box proves nothing an attacker with a
shell cannot reproduce; cross-box mirroring within 5 s buys strictly more, for free. Retiring `swap.log`.
Moving `.hold` into coord.db. **Bumping `FLEET_PROTO`.**

---

## §7 Open items

1. **`cc-socks` governance.** All 21 session sockets share `/run/user/1000/cc-socks/` — the transport is
   wider than the index, and it is unknown to ccrc and ungoverned. Out of scope per R2; nothing here
   sanctions or blocks it. It deserves a ruling of its own, because a fleet-wide unauthenticated
   session-to-session channel sitting beside a coordination design this careful is an odd pairing.
2. **The four archived-but-live rows.** `divergence.archived-but-live` will flag them from wave 4. Whether
   to *also* clear the stale triple on `start`/`ensure` is a separate ccd semantics question — note that
   clearing it destroys the archive record exactly as `ws-restore` does today, which is why this design
   journals the fact rather than mutating the field.
3. **Account `gpt` writes no Claude Code transcript** (`exec.kind: external`), so it is invisible to the
   retroactive lane by construction. Not closable; recorded so nobody re-discovers it as a bug.

## Provenance of this document

Three read-only investigations (peer discovery / mail+coord / ccd registry / skills / conflict history /
PWA surface; registry writers / actor taxonomy / existing logs / coord.db fit; destructive verbs /
tombstone survivability / who-can-destroy), then four independent architect drafts (minimal-diff,
doctrine-purist, forensics-first, failure-first) scored by three judges (correctness+doctrine,
operability, risk-to-the-live-fleet), synthesised into one design. Operator rulings R1-R4 were taken
before the panel ran; the `GET /api/lifecycle` and namespace-reconciliation rulings (D16, D14) were taken
after and are folded in above.
