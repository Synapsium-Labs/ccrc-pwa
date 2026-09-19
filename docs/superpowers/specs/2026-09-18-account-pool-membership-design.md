# Account-pool membership — design

**Status:** design, awaiting operator review. No implementation plan yet.
**Date:** 2026-09-18
**Supersedes nothing.** Extends `2026-09-04-account-pools-design.md` §5.3, which designed the
account side as a roster field and gave it no writer. This spec gives it one.

---

## 1. The ask

A pool is a billing/tenancy grouping restricting which **accounts** may serve which **projects**.
The rule is unchanged and is not re-opened here: an account may serve a project iff either side is
untagged, or the names are equal. Untagged is unconstrained; tagging can only tighten; the verdict
is three-valued (`eligible` / `crossing` / `undecidable`) and must never collapse to a boolean.

The **project** half already works end to end and is reachable from a phone. The **account** half
has no UI *and no CLI verb* — tagging an account today means hand-editing `~/.ccrc/accounts.json`
on each box and running `ccrc install`. The operator wants to manage pools from the PWA.

The forcing constraint on the design is not today's fleet but the stated product direction: a
distributed ccrc for the employees of a company, each authenticating with their own credentials,
each with one account pinned to them plus a company-wide pool of shared accounts, with the fleet on
an EKS cluster of N ephemeral pods. **That future is out of scope to build here.** It is in scope
as the thing this design must not have to be migrated away from.

---

## 2. Operator rulings (settled in session, 2026-09-18)

1. **The UI ships in wave 1.** Not a follow-up wave.
2. **Row per edge, now.** Not a column on the account with a migration later.
3. **The org edition is a separate story and out of scope.** This spec references it only as the
   constraint that decides the storage shape.
4. Pool means what §1 says it means — a billing/tenancy grouping — confirmed against the operator's
   own reading, not assumed from the code.

---

## 3. What was measured

Every line below was read at `2985b9d1` + this branch. Line numbers are citations, not memories.

### 3.1 The agent cannot reach `~/.ccrc`, in either direction
`agent/src/whitelist.ts:79-88`. Write mode returns a path only when it is under
`$HOME/.cc-clips` — that is the entire write surface. Read mode allows `.cc-sessions`,
`.cc-limits`, `.cc-clips`, the projects root, and a `$HOME/.claude*` glob. `.ccrc` matches none of
them. **Consequence, and it is structural:** the registry is the only fleet-box location the server
can read back. Anything the server must *measure* on the fleet box has to live in `$REG`.

### 3.2 The sibling route refuses to echo, for exactly that reason
`server/src/server.ts:2318-2326`: *"THE 200 IS MEASURED, NOT ECHOED. Unlike
`$REG/coordinator-paused`, this file IS under the agent's read roots, so the truthful answer is
available before the reply leaves."* Same comment fixes the guard stance to copy: *"NOT in
`auth/gate.ts`'s EXEMPT table — session-gated when armed, open dark… NO BOX TOKEN: this is fleet
control."*

### 3.3 The agent already reads the roster projection
`agent/src/server.ts`'s `readRosterFp` (`:568`, not `:512` as first cited) does
`bodyDigest(readFileSync(path.join(home, '.ccrc', 'accounts.sh')))`
— its own internal read, not a client-driven frame. `accounts.json` carries credential *paths*,
never keys. So the server could be shown that roster; today it is shown only a hash of it.

### 3.4 There is exactly ONE agent connection, and the server dials it
`server/src/index.ts:80`: a single `connectFleet({ url: cfg.agentUrl, token: cfg.agentToken })`.
There is no set of connected agents to fan out to. **Any design claiming EKS-readiness by pushing
over the existing channel is wrong**; that channel addresses one configured host. This is the
single most load-bearing correction the design panel produced, and two of the three candidate
architectures were built on its negation.

### 3.5 coord.db already holds authoritative rows, with a doctrine for adding more
`server/src/coord/schema.ts:446` — *"claims are AUTHORITATIVE in coord.db"*; `:457` — *"D8'S RULING
on `ledger_alloc`: authoritative, WITH a flat-file ground truth so the re-measurement doctrine
holds without a special case."* So an authoritative table is not a new doctrine, it is an existing
one with a named shape: append-first journal, DB second, recovery takes the max.

### 3.6 The ownership line between `ccrc` and `ccd`
`ccrc` writes `accounts.json`, generates `accounts.sh`, and owns wrappers, config dirs and 0600
credential files. `ccd` only reads the projection; every `accounts.sh` reference in `ccd/ccd` that
is not a read is a **die message instructing the operator to run `ccrc install`** (`ccd:1321`,
`:1870`, `:6169`, `:7820`). `ccd` never repairs it. A design in which `ccd` regenerates the
projection crosses this line and is rejected on that basis alone.

### 3.7 The exec surface, and what a new verb costs
`EXEC_COMMANDS = ['tmux','ccd']` (`agent/src/whitelist.ts:134`) is closed; `FORBIDDEN_COMMANDS`
does not list `ccrc`, but the file's own comment makes granting deliberately expensive.
`REQUIRED_VERB_FLAG` (`:252-255`) has **five** entries today — `ws-reap`, `ws-rename`,
`coord-pause`, `project-pool`, `route` — so a gated `account-pool` is the **sixth**. **Correction:**
ruling R1/R2 (§11) means this wave never spends that slot — the sync is a sibling executable and the
write path execs nothing, so `REQUIRED_VERB_FLAG` stays at five.

### 3.8 The live fleet is greenfield for this feature
17 accounts (14 `generated`, 2 `external`, 1 `upstream`), **zero carrying a pool**, and no
`~/.cc-sessions/pools/` directory at all. No data to migrate, and every new refusal this design can
emit has a blast radius of zero on the live fleet at the moment it ships. That window is the
ordering argument for wave 1 and it is only available now.

### 3.9 The next free migration slot is 13
`MIGRATIONS` in `schema.ts` runs 1…12. **The plan must re-measure this against `origin/main`
immediately before merge** — a migration index is a cross-branch namespace and another in-flight
branch can take 13 first.

---

## 4. The fork: where account-pool membership lives

Three architectures were developed in full from different starting premises and judged under three
lenses by independent reviewers. Scores out of 10.

| | Approach | Future-fitness | Invariants | Cost |
|---|---|---|---|---|
| A | Registry marker, `ccd account-pool` the origin — symmetric with the project half | 4 | 7 | 6 |
| **B** | **`pool_edges` in coord.db, leased projection to the fleet** | **8** | **8** | **4** |
| C | Centralise the roster itself; membership stays a roster field with one home | 5.5 | 3.5 | 7.5 |

**Why not A.** It is the symmetric answer and it is the wrong one for the stated future: it makes a
company-wide configuration fact into node-local state on a box that, under EKS, does not exist.
Its first wave ships the EKS-doomed half and defers the surviving half. Judged 4/10 on future
fitness for precisely that.

**Why not C.** Pushing a roster to the fleet means the agent gains a write class its allowlist does
not describe, and the pushed bytes are credential *routing* — `generateAccountsSh` emits
`_ccrc_cfg_dir`. `ccrc`'s sole ownership of `accounts.json`/`accounts.sh` ends. Judged 3.5/10 on
invariants. It also assumes the fan-out of §3.4, which does not exist.

**Why B.** The authoritative bytes never live on a fleet node, so a pod dying loses nothing and a
cold pod holds nothing to be wrong about. EKS forces a *distribution* change (delete a nudge, keep
a timer), never a *store* move or a data migration — which is the only honest definition of
future-proof available given §3.4.

**Its known weakness is cost (4/10): the largest first wave of the three.** §11 addresses this by
ordering the wave, not by shrinking it — the operator has ruled the UI ships in wave 1.

**Grafts from the losers, applied below.** From A: the projection must live in `$REG` (§3.1) so the
route can measure rather than echo; the `_project_pool_state` reader copied predicate for
predicate; the `--account` gated flag. From C: `observedEpoch` on the existing `ready` handshake as
the convergence signal that scales past two boxes.

---

## 5. Architecture

### 5.1 Role matrix

| Actor | Role |
|---|---|
| coord.db (`pool_edges`, `pool_epoch`) | **Authoritative.** The only writer of membership. |
| `~/.ccrc/pool-edges.log` | Flat-file ground truth (D8), so a lost coord.db reconstructs. |
| Server | Writes the origin; forecasts and refuses from the DB directly; never places. |
| `$REG/pool-epoch` | A **leased projection**. A cache with a generation, never a source. |
| `ccd` | Placement authority, unchanged. Reads one local file; never the network at placement time. |
| `accounts.json`'s `pool` | **Declared default**, retained. Lowest precedence. See §5.6. |

### 5.2 The store — row per edge

New migration (slot 13, re-measured at merge):

```sql
CREATE TABLE pool_edges (
  id          INTEGER PRIMARY KEY,
  subjectKind TEXT NOT NULL,      -- 'account' | 'project'  (both from day one)
  subjectId   TEXT NOT NULL,
  pool        TEXT NOT NULL,
  addedAt     INTEGER NOT NULL,
  addedBy     TEXT
);
CREATE UNIQUE INDEX pool_edges_one_per_account
  ON pool_edges(subjectId) WHERE subjectKind = 'account';

CREATE TABLE pool_epoch (            -- single row, `coordinator_state`'s own idiom (ruling R4)
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  epoch    INTEGER NOT NULL,
  issuedAt INTEGER NOT NULL,
  digest   TEXT NOT NULL
);
INSERT INTO pool_epoch (id, epoch, issuedAt, digest) VALUES (1, 0, 0, '');
```

**Row per edge, not a column** (operator ruling 2). `subjectKind` exists from day one even though
wave 1 writes only `'account'` rows, because the project half may later migrate into the same
table, and because the future's `user → pinned account` is a *different edge*, not a wider column.
Wave 1's "one pool per account" is a **partial unique index**, not a column shape: relaxing it to
multi-pool later drops an index and rewrites no rows and changes no wire shape, whereas widening a
column changes the rule in three languages at once.

### 5.3 The journal — D8's shape, not a new doctrine

`~/.ccrc/pool-edges.log`, NDJSON, on `server/src/coord/ledgerlog.ts`'s existing shape: the line is
appended **inside the tx and before the commit**, synchronously (`DatabaseSync` has no async, and
the no-async-wrapper invariant on `CoordStore` stands). Recovery replays the journal and takes
`MAX(journal, db)`, so a crash between the two skips an epoch and never reissues one.

This is what makes the table authoritative without a doctrine exception. It also fixes the failure
direction: a lost coord.db that could not reconstruct would answer "untagged", and untagged is
unconstrained — **the fail-open direction, which is the one outcome this whole design exists to
prevent.**

### 5.4 The projection — `$REG/pool-epoch`

**Corrections (rulings R1/R3, §11).** One document, always emitted even when empty, written by the
**sibling executable** `ccd-pool-sync` — never a `ccd` verb: `ccd/ccd` makes zero outbound network
calls by doctrine, and the sync joins `ccd-account-health`/`ccd-telemetry-keepalive` as a curl-using
sibling instead. It lands via a hand-built dot-leading tmp file, not `mktemp`, then a portable
rename: `mv -fT` is GNU-only and absent on Darwin, so the real idiom is `_plat_mv_notdir`'s doctrine
(here inlined, since the sibling does not source `ccd`). It lands in `$REG` and not `~/.ccrc` for the
reason in §3.1: `$REG` is the only place the server can read back, and the agent's write allowlist
stays `.cc-clips` only — **the projection is written by `ccd-pool-sync` on the box, never by an agent
write frame.**

**Line-oriented text, terminated, not JSON** (ruling R3) — `ccd` has no JSON parser and
`_acct_pool_state` is called once per candidate account, so this format mirrors
`_project_pool_state`'s own precedent rather than costing a parse per call:

```
epoch 43
issued 1758000000
lease 1758000900
acct acct-a pool-a
end
```

`acct` lines may be zero (a document with only `epoch`/`issued`/`lease`/`end` is legal and means
*synced, nothing tagged*). At most one `acct <id> <pool>` line per id today; multi-pool later adds
more lines for the same id, not a wire shape change. **The document carries the RESOLVED pool per
account — central if present, else the declared `accounts.json` default — never central edges
alone.** Emitting central edges only would drop a declared-only account from the document entirely,
which `ccd` reads as `untagged` and serves: the fail-open this design exists to close, arriving
through the new path instead of the old one it was written to shut (§5.6 rule 2).

**Absence is not untagged.** No `acct` line for an id means *synced, nothing tagged*. **No document
at all** means *this node has never synced* and reads `unreadable`. That is why the control plane
always emits the document even when empty — the same argument that makes `_ccrc_pool` emit an empty
`case`. Folding those two would silently lift every constraint on a node that has never synced, which
is the cold-pod case and therefore the EKS default.

### 5.5 The write path

```
PWA (session cookie)
  -> POST /api/pools/accounts/:id   { pools: string[] }
     · NOT in auth/gate.ts's EXEMPT table -> session-gated when armed, open dark   (§3.2's stance)
     · NO box token: fleet control, not a coordination write
     · POOL_NAME_RE imported from shared/roster.ts, never re-spelled -> 400 bad-pool-name
     · an id no rostered account carries -> warning 'unknown-account', NOT a refusal
  -> L1 decides the edge set
  -> L3 CoordStore.tx(): append journal line FIRST, write pool_edges + bump pool_epoch SECOND
  -> reply { ok, epoch }  (+ warning when no project carries that name — warning, never refusal)
```

**Correction (ruling R2) — no nudge, dropped entirely, not merely deferred to EKS.** §3.4 already
condemned it as the wrong shape; measurement went further and removed it now. The route execs
nothing: `EXEC_COMMANDS` stays `['tmux','ccd']` unchanged, `EXEC_WHITELIST.ccd` gains no verb, and
`REQUIRED_VERB_FLAG` stays at five (§3.7). Convergence is owned wholly by `ccd-pool-sync.timer`'s
pull (§5.4); the reply above is immediate and exact regardless (the server forecasts from coord.db
directly, §5.7), and only the fleet's own enforcement lags ≤`OnUnitActiveSec`. An EKS migration
changes nothing about this path at all, not merely its latency.

### 5.6 Precedence — three rules, and one deliberate departure from the panel's winner

1. **Projected beats declared.** `$REG/pool-epoch` (origin `central`) outranks
   `accounts.json`'s `pool`, which outranks untagged.

2. **The roster field is RETAINED as the declared default.** The winning candidate proposed making
   a `pool` key in `accounts.json` a boot `RosterError`. **This spec reverses that**, on two
   findings from the judging panel:
   - *Fail-open partial deploy.* If `pool` left the roster, `generateAccountsSh` would stop
     emitting `_ccrc_pool`, and an old `ccd` against a new server would read **every account as
     untagged** — silently lifting every constraint. Keeping the field means an old `ccd` keeps
     enforcing *something*, and skew is fail-shut rather than fail-open.
   - *Wire discipline.* Turning a previously-valid, absence-permitting optional key into a boot
     refusal is a breaking change dressed as validation, against this repo's additive-only rule.

   The cost is two carriers of one fact, which rule 3 answers.

3. **The wire says which carrier decided,** per entry, via `origin`. This is what stops the UI
   lying the first time an operator clears a central tag and the roster's declared value takes over.
   `accountPool()` in `pwa/src/lib/accounts.ts` is already the single reader every surface goes
   through — measured (corrected): **8** call sites across `NewSessionSheet.tsx`, `SessionLine.tsx`,
   `SwapSheet.tsx` and **one** lib file (`pools.ts`) — so the precedence is folded in exactly once
   and no surface can render a value the API would refuse.

The roster field is **deprecated in documentation, not in code.** Retiring it is a later wave with
its own skew analysis.

### 5.7 The read path, and the rule's ordering

`ccd` reads one local file at placement time and never the network. A new `_acct_pool_state <id>`
mirrors `_project_pool_state` predicate for predicate and answers, always rc 0:

`named <n>` | `untagged` | `unreadable` | `malformed` | `stale`

`stale` does **not** fold into `unreadable`: both mean nobody decides, but one's remedy is file
permissions and the other's is the control-plane link, and the die message and the chip each need
to say which. An adapter may not narrow a distinction it received.

`_pool_ok` gains the account-side undecidable arm and keeps its three exit codes. Verdict order:

```
project unreadable/malformed        -> undecidable
project untagged                    -> serve      (no constraint to be ignorant of)
account unreadable/stale/malformed  -> undecidable
account untagged                    -> serve
pool(project) ∈ pools(account)      -> serve, else mismatch
```

Undecidable outranks mismatch: a 409 offering `--cross-pool` over a constraint nobody read is worse
than a 503. **The project-untagged short-circuit comes before the account state is consulted**, and
it is what bounds the blast radius in §5.8.

The server's own forecast does **not** consult the projection — it reads coord.db directly, so
every 409/503 it issues is immediate and exact.

### 5.8 Offline, and the lease

Within the lease nothing changes: `ccd` decides from the local document as if online, and the PWA
shows the fleet lagging (`epoch 43 / observed 42`). Past it, the account axis answers `stale` →
undecidable → refuse, never a crossing offer.

**The blast radius is the constrained set and nothing else**, and it falls out of the rule ordering
rather than a special case: project-untagged short-circuits first, so a control-plane outage stops
new placement only into projects someone deliberately tagged. Every project on the fleet today is
untagged. Running sessions are never affected — placement is decided at create/swap, not
re-evaluated under a live session. A cold node with no document reads `unreadable`, not `untagged`:
it refuses into tagged projects until its first successful pull. **That is the single most
important fail-shut in the design, and the EKS default path.**

Refresh is a pull: `ccd-pool-sync.timer` — `OnBootSec=45s`, `OnUnitActiveSec=60s`,
`AccuracySec=10s`, copied verbatim from `deploy/systemd/ccd-cap-scopes.timer` rather than invented,
so the fleet gains no new timer cadence to reason about.

**Open parameter:** lease length. It is the whole dial between "an outage stops tagged placement"
and "a stale node enforces yesterday's membership", and no value is right for both. Proposed
default 15 minutes — fifteen missed pulls before refusing. Wave 1 ships it configurable.

### 5.9 PWA surfaces (wave 1, per operator ruling 1)

- **Accounts screen:** each account row gains a pool chip, read from `accountPool()` with the
  §5.6 precedence, showing its `origin` when it is the declared default rather than central.
- **The chip is the editor door**, mirroring `ProjectCard`'s pool chip: tap → a sheet listing pool
  names, plus free text. The account side is where a pool name is *created* (§5.10), so unlike
  `PoolSheet` this one must accept a name no account yet carries, validated against `POOL_NAME_RE`.
- **Fleet head:** `epoch N / observed M` when they differ, so a lagging fleet is visible rather
  than mysterious.
- `PoolsEnforcement` gains an `accountPools` field with the same `enforced | unavailable | unknown`
  three-state, sourced from the verb's presence in `ccd caps`.

### 5.10 What "creating a pool" becomes

Today a pool exists iff some account carries the name, and `PoolSheet` deliberately has no free
text because a name no account carries would strand the project. Under this design the **account
editor is the creating surface** and the project sheet stays a picker over
`poolOptions(edges ∪ roster)`. That asymmetry is now principled rather than accidental: you create
a pool by putting an account in it, which is the only act that can make it servable.

---

## 6. Future fit — and what is NOT built here

Out of scope (operator ruling 3), recorded so the shape can be checked against it:

- **`user → pinned account` and `org → shared pool`** land in a *separate* table,
  `principal_grants(principalKind, principalId, subjectKind, subjectId, grantKind)` with
  `grantKind ∈ {'pinned','shared'}`. No change to `pool_edges`, no migration of existing rows.
  Placement then requires a conjunction of two independently three-valued verdicts —
  `mayUse(principal, account) ∧ poolRule(account, project)` — each preserving `undecidable`.
  Today is that table with one implicit principal, and wave 1 writes no rows in it.
- **Multi-pool accounts:** drop the partial unique index. The wire already carries `pools: string[]`.
- **EKS:** pods hold only a leased projection. The one thing that breaks is the server dialing the
  agent (§3.4) — which this design already treats as an optimisation. Delete the nudge, keep the
  timer, report `observedEpoch` per pod on the existing `ready` handshake beside `rosterFp`.

---

## 7. What this gives up — stated, not buried

- **Per-box autonomy.** An operator can no longer express an account pool by editing the box in
  front of them and having it take effect. One writer is the point, and it is a real loss.
- **Availability for the constrained set.** A control-plane outage longer than the lease stops new
  placement into tagged projects fleet-wide. Untagged projects and running sessions are unaffected.
- **Convergence, not serialization.** Two nodes can decide under different epochs in the same
  second. A placement is correct-as-of-an-epoch and nothing reconciles two that disagree beyond the
  stamps. A new tag is not enforced on a node until its next refresh.
- **The chokepoint is still a contract, not an OS wall.** A session invoking `ccd` directly on the
  box can place under a stale epoch, exactly as this fleet already lives with elsewhere.
- **HA.** `DatabaseSync` plus the no-async-wrapper invariant means the control plane is
  `replicas=1` on an RWO volume. Multi-replica HA needs leader election, and moving to Postgres is
  the one future step that cannot preserve the synchronous `CoordStore` interface.
- **`rosterAgreement`'s digest keeps covering `_ccrc_pool`** (because §5.6 retains the field), so
  unlike the panel's winner this design does not shrink divergence detection. The cost is that the
  digest can now disagree for a reason that is no longer authoritative; the banner copy must say so.

---

## 8. Invariants

**Kept:** `ccd` is the placement authority and the server never places. `ccrc` keeps sole ownership
of `accounts.json`, `accounts.sh`, wrappers, config dirs and credentials — `ccd` writes none of
them. `EXEC_COMMANDS` stays closed. The agent write allowlist stays `.cc-clips` only. `CoordStore`
stays synchronous. The pool verdict stays three-valued. No overloaded null at a seam.

**Changed, deliberately:** `ccd`'s placement gains a freshness dependency it has never had.
`_project_pool_state` answers from a file whose absence honestly means "nobody tagged anything";
`_acct_pool_state` answers from a file whose absence means "I have not synced". A local,
self-contained decision now has a clock and a remote antecedent in it. This is the price of a
central origin and it should be named in `CLAUDE.md`, not discovered.

**Reversed from the panel's winner:** the roster `pool` key stays valid (§5.6 rule 2).

---

## 9. Test and mutation obligations

Every guard ships with a test measured RED before and after, per mutation-table discipline. Non-
exhaustive, the ones that are easy to omit:

| Property | Guard |
|---|---|
| Absence ≠ untagged | Delete the document → `_acct_pool_state` answers `unreadable`, placement into a tagged project refuses |
| `stale` ≠ `unreadable` | Two distinct words, two distinct die messages; folding either reds |
| Fail-shut on a cold node | Fresh `$REG`, no document, tagged project → refuse, never serve |
| Project-untagged short-circuit | Control plane down + untagged project → placement proceeds |
| The route measures, never echoes | Route reply reflects a re-read, not the request body |
| Journal before commit | Kill between append and commit → recovery takes MAX, epoch skipped not reused |
| `EXEC_COMMANDS` unchanged | `whitelist-subset.test.ts`; a `ccrc` grant is a compile error and a boot refusal |
| Agent write allowlist unchanged | `checkPath('<REG>/pool-epoch','write') === null` stays pinned |
| One reader for the precedence | `accountPool()` remains the single PWA reader; a second reader reds |
| Bash/TS rule parity | `POOL_RULE_CASES` gains a row per new state pair; text-extraction parity test |

Deviation numbers are **not allocated in this document.** **Correction:** not at plan time either —
the implementation plan allocates its block from `POST /api/ledger/deviations` **after the
whole-wave review**, and defines every departure in that same act, because you cannot define a
departure you have not yet found (CLAUDE.md's ledger discipline; the two most recent shipped plans
both do this).

---

## 10. Wire discipline

**Correction: two wires, not one.** `FLEET_PROTO` (PWA↔server, `shared/api.ts`) is **not** bumped:
`AccountPoolWire`, `pools: string[]`, `origin` and `accountPools` on `PoolsEnforcement` are additive
and absence-permitting on it. `observedEpoch` on the `ready` handshake is a **different** wire —
`shared/agent-protocol.ts` (agent↔server) — and `FLEET_PROTO` does not cover it at all; it gets the
same additive treatment on its own terms. An older peer omitting any field on either wire reads as it
does today, through a single reader per field.

---

## 11. Plan shape

One wave, **agent-first**, because `ccd` and the timer must be in place before the server mints its
first epoch. The wave is large — the cost lens scored this architecture 4/10 on exactly that — and
the operator has ruled the UI ships inside it. The mitigation is ordering, not scope reduction, and
it works only because §3.8 makes every new refusal a no-op on the live fleet at ship time.

1. **Fleet (ships first, against a control plane that does not yet answer):** `ccd-pool-sync` — a
   **sibling executable, not a `ccd` verb** (ruling R1) — `_acct_pool_state`, `_pool_ok`'s account
   arm, the `account-pools` capability token in `ccd caps`, `ccd-pool-sync.timer`. Every account
   reads `unreadable` → undecidable → refusals only into tagged projects, of which there are none.
2. **Shared:** `AccountPoolWire`, `poolRule` re-signature (**five** existing production callers carry
   it — `server/src/poolrule.ts`, `pwa/src/lib/pools.ts` — not a zero-call-site rename), `POOL_RULE_CASES`
   rows, bash parity.
3. **Server:** migration (slot re-measured), `PoolEdgeLog`, `GET /api/pools/epoch` (dual-credential
   — session for the PWA, box token for `ccrc-api`, the `GET /api/feed` shape),
   `POST /api/pools/accounts/:id` (execs nothing — ruling R2 drops the nudge), `accountPools`,
   `observedEpoch`.
4. **PWA:** the account pool chip, its editor sheet, `epoch/observed` in the fleet head.
5. **Docs:** `CLAUDE.md`'s pool invariants, the freshness dependency named in §8, the roster field
   marked deprecated-not-removed.

Rollback is `DELETE` of the edges and letting the lease expire; nothing moves, and untagged is
unconstrained.
