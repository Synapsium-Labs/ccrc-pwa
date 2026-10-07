# Delegation broker — every coordinator's work nests, and every worktree it leaves is cleaned up — Design

**Date:** 2026-10-04. **Status:** design approved in conversation, section by section (2026-10-01 to
2026-10-04), then revised after an independent four-lens review (fidelity, safety, fact check,
buildability). The revisions that change an approved decision are listed in §2.1 and need the operator's
confirmation in the review of this document. No implementation plan exists yet.

**Anchors** are `origin/main` at `698f679da`; they are snapshots — trust the shipped source's own comments
over a line number here. **Deviation numbers:** this spec defines none. Each wave's plan mints its own
block at run-open; a contingency named here is named by slug and minted when it fires.

**Amends:** `2026-09-22-child-workspace-reclamation-design.md` (its executor gains a second, session-less
target; child admission is untouched), `2026-09-24-workspace-lifecycle-design.md` (the single cleanup
switch also governs lease cleanup), the coordinator skill (one new clause), and `CLAUDE.md` (SAFETY
entries, the ccd-verb invariant, the box-token bullet, the clause count) — §13.

---

## 1. The incident

On 2026-09-28 a coordinator session took a four-item residue batch and finished it — five PRs merged,
two boxes deployed — by hand-rolling its own orchestration: it ran `git worktree add` into sibling
directories, drove generic `Workflow` and `Agent` workers in them, and never invoked the
`ccrc-coordinator` skill, never opened a run, never dispatched one.

Everything ccrc derives from a run was therefore missing:

- **No nesting.** The fleet tree draws exactly one edge, `run.claimedBy -> run.sessionId`
  (`pwa/src/fleet/nestFleet.ts:4`). No run, no edge; the worktrees were not even ccd sessions.
- **No child marker, no hold, no supervision.** `.child`, the hold, the run binding and the supervised
  session all come from `runs dispatch` (`server/src/coord/dispatch.ts`).
- **No history.** No run items, no wave-done fingerprint, no review run.
- **No cleanup owner.** Child reclamation admits only a workspace whose `.child` marker names a run whose
  claimant equals the server-supplied `--child-of` (`_ws_reclaim_eval`, `ccd/ccd:25588`;
  `server/src/ccdargv.ts:417`). Hand-made worktrees qualify for nothing; `ws-gc` only reports them, and
  its prune is human-only.

Nothing prevented this and nothing reported it. The skill's prose said what to do; prose did not make
the work visible. This design makes it visible and owned **without** forbidding the generic `Agent` and
`Workflow` tools, which the routing matrix deliberately permits
(`ccd/coordinator-skill/references/routing-matrix.md:35`).

### 1.1 The same gap on any busy day

Claude Code's own isolated workers leave worktrees too. Measured 2026-10-04 in the ccrc-pwa main
checkout's `.claude/worktrees/`: **19** worktrees — 12 `agent-<id>` (isolated `Agent` calls) and 7
`wf_<run>-<n>` (isolated `Workflow` workers), of which four belonged to a workflow still running. None
has an owner in ccrc; nothing ccrc runs will ever clean one.

## 2. Operator rulings

1. **Route 1 — a delegation broker plus reconciliation**, over "everything must be a run" and over a
   hooks-only approach.
2. **Ephemeral workers render as activity under their parent**, not as programme rows.
3. **Durable work started outside `runs dispatch` is auto-adopted and guided** toward promotion into a
   real run; never silently ignored, never forcibly converted.
4. **Coordinator identity is explicit intent plus inferred escalation.**
5. **Durable nesting lasts until the workspace is reclaimed**, not until a run closes.
6. **Ephemeral worker workspaces are cleaned up under the updated cleanup scheme** (the CCR-15 /
   workspace-lifecycle safety spine). "Ephemeral" names presentation and expected lifetime, not an
   exemption from cleanup.
7. **The new ccd verbs are workspace-lifecycle verbs, not coordination mutation** (2026-10-04). They sit
   beside `ws-reclaim`: server-composed, capability-gated, on the SAFETY list, named in no skill.
8. **Four corrections from measurement** (2026-10-04): ccrc never registers `WorktreeCreate` /
   `WorktreeRemove` (§5.3); the exact-identifier rung names its identifiers (§5.4); the lease carrier is
   written by a ccd verb, not the fleet agent (§5.10); the broker's records are `delegation_*`, not
   `lifecycle` (§5.2).

### 2.1 Revisions after review — each changes an approved decision and needs confirmation

| # | Approved in conversation | Revised to | Why |
|---|---|---|---|
| R1 | Promotion attaches a supervised ccd session to the lease's worktree in place | Promotion **dispatches an ordinary child workspace starting at the lease's tip** (`ws-add --base`), then the lease is cleaned as usual (§5.7) | `ccd start <wrapper> <project> <workdir>` reuses the project's own `<wrapper>-<project>` id (`ccd/ccd:2882`, `:21326`) — it would hijack the main session, and writes no workspace fields, so `ws-hold` refuses it (`:8767`). In-place attach needs a new adopt verb and a third population of leases-with-sessions (archive collisions, teardown, dual locks). Dispatching from the tip reuses everything that exists |
| R2 | A carrier with no server row is recovered as an obligation | **The server journal alone creates a lease.** A carrier corroborates; a carrier with no journal entry is shown as unowned work, never cleanup-eligible (§5.12) | Any fleet process can write a carrier file; recovery from carriers alone would let a stray file make a tree deletable |
| R3 | Rung 3: exact hook path; rung 4: unique before/after census | Rung 3 counts only events **emitted from inside the subagent**; a session's own `cwd` never links. Rung 4 counts only **the session's own before/after listing around one tool call, with no other session's window overlapping**; server-census brackets never link (§5.4) | Being in a directory is not creating it; a five-minute census bracket is a timestamp in disguise |
| R4 | The agent retains events until contiguously acknowledged | **Hour-bucketed append-only spool, retained 24 h**; the server owns the cursor; a bucket gone before it was read marks that interval `unmeasured` (§5.3) | The agent can write only under `~/.cc-clips`; size-triggered rotation is not lock-free under concurrent hooks |
| R5 | `ccd ws-audit --lease-clean` (a flag on `ws-audit`) | A separate read-only verb **`ws-lease-audit`**, its own capability; `lease-clean-v1` is execution only, and `ws-lease-clean` checks `$REG/lease-clean-live` itself (§5.11) | `ws-audit`'s grant and parser are `--session`-only; one token for shadow and live would make shadow tokens executable |
| R6 | Admission rung 6 for promoted leases (run/session ownership) | Removed — after R1 a lease never has a session. Replaced by **"no linked activity active, and no recent parent use of the tree"** (§5.11) | An adopted tree can be in active use with no process inside it between tool calls |
| R7 | Additive optional fields on the fleet frame | A **new `delegation` frame type** (§5.8) | Fleet-level facts travel as their own frames (`runs`, `coord`, `divergence`; `shared/api.ts:3724`) |
| R8 | Stage 4 adoption, stage 5 carriers | **Carriers (`ws-lease-mark`) and the read-only `ws-lease-audit` ship with adoption in stage 4**; a carrier is written when a lease is linked, not when it is adopted (§5.10, §7) | Promotion's first act advances the carrier; adoption's "changed" test and promotion's "dirty" test both need the read-only audit, and the audit needs a carrier |
| R9 | One level deep; a depth-1 session's delegation as a chip (not approved) | **Proposed:** a programme worker's durable leases nest under the top coordinator labelled "via <worker>"; its live activity is a chip on the worker row (§5.8) | One-level nesting must not hide a durable workspace |

## 3. What exists today (measured)

| Fact | Where |
|---|---|
| The only nesting edge is `run.claimedBy -> run.sessionId`; `emitRuns` carries every non-terminal run, so the edge disappears at `done` / `failed` | `pwa/src/fleet/nestFleet.ts:4`; `server/src/watch.ts` (`emitRuns` → `coord.runs()`) |
| Coordinators are derived from open runs' claimants; no durable coordinator identity | `server/src/coord/store.ts:3033` |
| The coordinator route row selects a model and defaults; it opens and parents nothing | `ROUTE_COORDINATOR_ROW`, `ccd/ccd:18047` |
| Child authority: `.child` + run claimant equal to the server's `--child-of`; no marker = ordinary workspace; unreadable = fail shut | `ccd/ccd:25588` (`_ws_reclaim_eval`); `server/src/ccdargv.ts:417`; `server/src/coord/childBind.ts:57` (the bind-side half) |
| A destructive verb is dispatched only on positive capability evidence | `server/src/ccdargv.ts:784` (`capSupported`), `:761` (`RECLAIM_CAP`) |
| The cleanup kill-switch is a file the destructive verb checks on the box | `ccd/ccd:25625` (`$REG/reclaim-paused`) |
| The destructive grammars are enrolled in a direct-entry boundary | `ccd/ccd:27-29`; `ccd/ccd-entry.py:121-124` (D-3696) |
| ccrc's installer registers ten events; `PreToolUse` separately with matcher `*`; no `WorktreeCreate`, `WorktreeRemove`, `SessionEnd` | `ccd/install-session-hooks.sh:37` |
| The hook's contract: exit 0 always, no network, no locks or waiting on the hot path (two declared exceptions, both in the compaction arms) | `ccd/session-hook.sh:3-15` |
| The hook keeps only a display name and start time per subagent, capped at 32, removed by name; `agent_id`, transcript path and isolation are discarded | `ccd/session-hook.sh` (subagent arm); `server/src/hookstate.ts:39` |
| A capture arm already records raw hook payloads for a session whose id ends `-hookcap` | `ccd/session-hook.sh:2917-2930` (D-3612) |
| The server reads each project's worktree admin records once a minute, through fleet IO, as `{name, path, headBranch}`; an unreadable record is silently skipped; a detached HEAD yields no sha | `server/src/coord/gitref.ts:272`, `:327-334`; `server/src/watch.ts:117` (`DIVERGENCE_SWEEP_MS`), `:2681` |
| The fleet agent may WRITE only under `~/.cc-clips` (non-atomically); it may READ the registry, the projects root and `~/.claude*`; its `stat` answers size and mtime only | `agent/src/whitelist.ts:137`, `:140-146`; `agent/src/fileops.ts` (`writeB64`); `agent/src/server.ts:234` |
| The exec surface is `tmux` and `ccd`; `git` is not executable by the server | `agent/src/whitelist.ts:192` |
| `$REG/<id>.uuid` mirrors the session's CURRENT Claude session UUID; Claude Code rotates it on `/clear` and compaction, and ccd keeps no history | `ccd/ccd:15806-15817` (`_sync_uuid`) |
| `ws-add` creates a new worktree from the main checkout; it takes no base ref | `ccd/ccd:6906` |
| `.lifecycle` is already a journal name | `shared/api.ts:7767` (`LC_DIR_NAME`) |
| Stage markers nothing in the tree writes, absence meaning shadow | `server/src/coord/stall.ts:104`, `:131` |

### 3.1 What Claude Code provides (measured 2026-10-04, binaries 2.1.281 to 2.1.289)

The fleet's lanes run 2.1.281 through 2.1.289, each lane its own version. Measured from binary strings
(spot-checked on 2.1.281, .285, .287, .289) and from on-disk artifacts:

- **`WorktreeCreate` and `WorktreeRemove` hooks REPLACE Claude Code's worktree handling.** The binary
  carries "WorktreeCreate hook failed: hook succeeded but returned no worktree path (command: echo the
  path to stdout; http/callback: return hookSpecificOutput.worktreePath)" and "no WorktreeRemove hook to
  remove the worktree … enable a WorktreeRemove hook and retry"; `/batch` says to configure both "for
  another version-control system". A record-only hook would break every isolated `Agent` and `/batch`.
- `SubagentStart {agent_id, agent_type}`; `SubagentStop {agent_id, agent_transcript_path, agent_type,
  last_assistant_message, stop_hook_active}`; `SessionEnd {reason}`; `PreToolUse {tool_name, tool_input,
  tool_use_id}`. A killed parent cannot fire `SessionEnd`.
- **Isolated `Agent`:** worktree `<main>/.claude/worktrees/agent-<id>`, branch `worktree-agent-<id>`;
  `<transcript dir>/<uuid>/subagents/agent-<id>.meta.json` carries `toolUseId`, `worktreePath` (the exact
  worktree path), `worktreeBranch` and `spawnedWithWorktree`.
- **Isolated `Workflow` worker:** worktree `wf_<run>-<n>`; `<transcript dir>/<uuid>/subagents/workflows/
  wf_<run>/agent-<id>.meta.json` carries `worktreePath`, `spawnedWithWorktree`, `workflowPhase` and **no
  `toolUseId`**.
- **Claude Code writes `<admin record>/CLAUDE_BASE`** (the creation base commit) for every `agent-*` and
  `wf_*` record measured; the first `logs/HEAD` line agrees.
- **Both kinds land in the MAIN checkout's `.claude/worktrees/`**, whichever ccd worktree the parent ran
  in. Directory location proves nothing about parentage.
- **One session's transcript folder can exist under several account homes** after swaps (one `wf_*`
  folder under eight); the parent key is the session, never the home.

## 4. Goals and non-goals

**Goals.** Every coordinator's delegated work is visible under it — live activity while it runs, a nested
workspace row for as long as a workspace or cleanup obligation exists. Durable work created outside
`runs dispatch` is adopted when its parent is provable and guided toward a real run. Isolated Agent and
Workflow worktrees acquire measured parentage, cleanup ownership, terminal evidence and an audited
cleanup through the existing safety spine. Nothing silent: unprovable work is shown as `unresolved`,
`conflicting` or `unmeasured`, never dropped.

**Non-goals.** Forbidding or rewriting `Agent` / `Workflow` calls; forcing isolation; making every
delegation a run; inferring ownership from names, branch prefixes, paths, ages, nesting, ancestry or a
session's working directory; widening `ws-reclaim` (child-only) or `ws-expire` (archive-only, unbuilt);
inventing runs for past work; non-git version control.

## 5. Design

### 5.1 Identity and authority

- **Explicit intent:** a durable `coordinator-intent` record per session, set and cleared with
  `ccrc-api coordinators intent set|clear --session <id>`. The caller must be that session (registry
  attribution, as `POST /api/claims` checks). The coordinator skill's new clause makes it the first act
  (§13). It creates no programme, run, hold or capacity slot.
- **Implicit:** opening or claiming a run establishes the same effective identity.
- **Inferred:** a session with a linked activity or lease becomes `coordination-active`; no programme,
  no run slot.
- **Persistence:** effective identity lasts while any run, lease, lineage edge or cleanup obligation
  names the session; clearing intent removes only the declaration.
- **Provenance:** every transition records `explicit`, `run-owner`, `delegation-inferred` or
  `retained-lineage`.
- **Parent key:** a parent is (ccd id, registry incarnation). Ids are `<wrapper>-<project>` or
  `<project>-<slug>` and can recur after `forget`; a lease whose parent's incarnation changed treats its
  parent as dead. The incarnation field is chosen by measurement (§11).
- **Non-ccd parents** (a Claude session outside a `cc-<id>` tmux session) produce no spool, cannot be
  linked or mailed, and are `unmeasured` by construction; their trees resolve through the operator
  (§5.14). Stage 1 measures their share.

### 5.2 Data model and state

One `coord.db` migration (wave 2) creates every table; later waves ship code only.

| Table | Holds |
|---|---|
| `delegation_sessions` | per session: explicit intent, effective identity, basis, the (ccd id → Claude session UUIDs) history observed in its spool |
| `delegation_attempts` | correlation attempts: inputs, rung reached, verdict, evidence ids |
| `delegation_activities` | activity id, parent, source kind, upstream ids, display metadata, execution state |
| `delegation_leases` | lease id + generation, parent (id + incarnation), activity, project, admin record, canonical path, creation base, source, disposition, clocks, cleanup population, cleanup evidence, carrier generation seen |
| `delegation_lineage` | open/closed edges parent → activity / lease / run, with close reason |
| `delegation_events` | append-only accepted events |

Every vocabulary is declared once in `shared/api.ts` and derived (`single-definition.test.ts` gains a
scan per vocabulary). Names are `delegation_*`; the server journal is `~/.ccrc/delegation-events.log`;
fleet state lives under the dotless `$REG/delegation/` — never `lifecycle`.

**Activity id** = server-computed hash of (parent id, parent incarnation, source kind, upstream id, the
journal id of the first event that named it) — deterministic on replay. Upstream ids: `agent_id`;
workflow run id + worker index; `tool_use_id` where present. Display names are metadata only.
"The first event that named it" is the first QUALIFYING event, the one that establishes the activity.
For an activity keyed by `agent_id`, that is the Agent launch response, a SubagentStart or an agent meta
naming that id. A tool event whose only delegation evidence is `agent_id` is not one: it is kept as
evidence and opens no activity, and it attaches to one only when a qualifying event for the same id
arrives later. No reader decides this by whether `agent_type` is present (amended 2026-10-07 from the
real-lane cross-check: ledger amendment `tool-agent-id-alone-is-unjoined-evidence`).

**Lease id** = a server-minted UUID plus a generation. Server-side identity: (project, admin record,
creation base, canonical path). Box-side fingerprint (computed by the verbs, never by the server): git
common dir, admin record name, admin dir and worktree root dev/inode, the `.git`-file ↔ `gitdir`
round trip, creation base. A reused path or name whose fingerprint differs never inherits a lease.

**State dimensions**, each a closed vocabulary with its own transition table:

| Dimension | Values | Transitions (driver) |
|---|---|---|
| execution | `active`, `ended`, `unknown` | active→ended (stop/completion event, or workflow-run-ended evidence); active→unknown (parent dead, gap); unknown→active/ended (later evidence) |
| parentage | `linked`, `unresolved`, `conflicting`, `unmeasured` | any→linked (a rung answers); linked→conflicting (a disagreeing rung); conflicting→linked only by operator resolution |
| workspace | `none`, `provisioning`, `present`, `absent`, `unmeasured` | provisioning→present (census); present→absent (missing from two consecutive successful listings); any→unmeasured (unreadable record) |
| disposition | `ephemeral`, `adopted`, `retained`, `promoted` | ephemeral→adopted (§5.6); adopted/ephemeral→retained (explicit Retain or operator attach); adopted/retained→promoted (§5.7) |
| cleanup | `not-due`, `pending`, `running`, `refused`, `reclaimed`, `unmeasured` | not-due→pending (clock, §5.11); pending→running (token minted and execution admitted); running→reclaimed / refused / pending (retryable) |

Ended activity is never a reclaimed workspace; a missing terminal event never authorises deletion.
**Populations:** `run-child` (existing) and `ephemeral-lease` (new, always session-less). They share the
executor; their admission proofs never merge.

### 5.3 Evidence capture

Hooks are evidence, never authority, and keep `session-hook.sh`'s hot-path contract: exit 0, no network,
no locks, no waiting, no extra forks on the probe path.

**Spool.** Each event is one line appended to `$REG/delegation/spool/<ccd-id>/<YYYYMMDDHH>.spool` (UTC
hour bucket). Every writer computes the same name; `>>` creates the bucket idempotently; one `write` per
line, each line under 4 KiB (oversized optional fields are dropped and the line marked `truncated`);
the line is built in the hook's existing single `jq` call. ccd creates the directory when it spawns a
session — the hook never forks `mkdir`; a missing directory means skip. The hook prunes its own buckets
older than 24 h at most once an hour; it removes nothing outside its own spool directory.

**Cursor.** The server owns a cursor per (session, bucket) in `coord.db`, reads only to the last newline
(a torn line after a full disk is left for the next read; an unparseable complete line marks that
interval `unmeasured`), and ingests by polling through the agent's existing read ops. A bucket that
disappears before the cursor reached its last-seen size marks that interval `unmeasured`. Duplicate
ingestion is idempotent on `eventId`. A hook that fails to write leaves no trace; the census (§5.5) is
the backstop, so a lost event can delay or prevent a link, never create one.

**Envelope** (the reporter, never the parent — parentage is the server's to resolve):

```text
eventId  eventKind  observedAt  sessionId (ccd id; must equal the spool directory)  claudeSessionId
agentId?  agentType?  toolName?  toolUseId?  isolation?  cwd?  transcriptPath?  worktreePath?
listing?  (admin-record names, before/after a worktree-mentioning Bash call)  claudeVersion?
```

| Hook | Records | Never |
|---|---|---|
| `PreToolUse` (Agent, Task, Workflow, Bash) | intent: tool, `tool_use_id`, `tool_input.isolation`; for a Bash command whose text contains the token `worktree`, a bounded listing of the repo's `<git-common-dir>/worktrees/` names | rewrites input, forces isolation, blocks |
| `SubagentStart` / `SubagentStop` | `agent_id`, `agent_type`, `agent_transcript_path` | keys by display name |
| `PostToolUse` | completion / failure; the after-listing for the same `tool_use_id` | — |
| `SessionEnd` (newly registered) | a termination hint with `reason` | proves death |
| `WorktreeCreate` / `WorktreeRemove` | **never registered** (§3.1) | — |

Creation and removal are measured by the census, never reported by an event.

### 5.4 Correlation ladder

Rungs are tried in order. A `linked` answer decides. `conflicting` at any rung is final until an
operator resolves it. A later, higher-rung answer that disagrees with an existing link turns it
`conflicting` and halts its cleanup.

1. **Run-child agreement** — the existing `.child` + run + `--child-of` agreement, unchanged. A tree
   gaining a registry row or `.child` within two reconciliation passes is a ccd workspace being born,
   never a lease.
2. **Exact upstream identity.** For admin record `agent-<id>`: session S's spool carries
   `SubagentStart`/`Stop` with `agentId = <id>`, and `<S's transcript dir>/<uuid>/subagents/
   agent-<id>.meta.json` — `<uuid>` from S's own spool history, a point lookup, never a search —
   has `worktreePath` equal to the record's canonical path. For `wf_<run>-<n>`: a workflow
   meta under S's `subagents/workflows/wf_<run>/` whose `worktreePath` equals the canonical path. The same
   id in two sessions' evidence is `conflicting`. **A tree whose admin record is named `agent-*` or
   `wf_*` stops here**: without rung-2 evidence it is `unmeasured` (retried, and back-filled at a bounded
   rate through the per-session transcript resolver), never passed to rungs 3–4. The name only routes;
   it never links.
3. **The subagent's own path.** An event emitted from inside a subagent (non-empty `agentId`) of S
   whose `cwd` or `worktreePath` equals the canonical path, with that `agentId` claimed by no other
   session. The parent session's own `cwd` never links.
4. **The session's own creation delta.** One Bash tool call of S whose before- and after-listings
   (same `toolUseId`) differ by exactly one added admin record, while no other session's
   listing window on the same repository overlaps it in time. Overlap is `unresolved`. This is the rung
   that adopts a raw `git worktree add` — the incident's case.

**Never links:** a display name; a name pattern; a branch prefix; a timestamp or a server-census
bracket; process ancestry; directory nesting; a session's own working directory.

### 5.5 Reconciliation

The decisions live in a pure policy module (the correlation ladder, the state transitions, admission
pre-checks) fed with census, spool events, runs, holds, markers, the registry and transcript lookups.
The watcher only schedules and performs IO.

- **Census:** the existing once-a-minute admin-record read (`DIVERGENCE_SWEEP_MS`), extended additively
  with `headSha` (detached HEAD), `claudeBase` (`CLAUDE_BASE`, else the first `logs/HEAD` line), the
  `locked` flag, and explicit `unreadable` rows instead of silent skips. Its result is reused, never
  re-read on a faster cadence.
- **Cadence:** each ingestion poll and each census pass (proposed 60 s for both).
- **May:** complete a correlation; adopt provable work (stage 4+); surface unowned work; record measured
  absence; enqueue cleanup; repair projections; return a `transferring` lease with no dispatched run to
  its prior disposition; record a dispatched promotion as `promoted`.
- **May not:** invent a parent, start a promotion, delete, or weaken admission.
- **Closing a lease without cleanup** (`native-removed`): the admin record is absent from two consecutive
  successful listings, the lease branch has been measured, and no `lease-clean:<phase>` breadcrumb
  exists. Distinct from the cleanup outcome `reclaimed`.
- **Circuit breaker:** two or more parents first measured dead within 10 minutes, or an unreadable
  registry, suspends adoption and cleanup decisions for that pass and raises one attention item.

### 5.6 Auto-adoption and guidance

A `linked` lease is **adopted** when, after its activity's terminal evidence plus 5 minutes and two
stable passes, the worktree is still present and changed — commits beyond `claudeBase` or a dirty tree,
as `ws-lease-audit` measures it. **Where the audit cannot answer (no `lease-audit-v1` on the box, an
unreadable tree), the state counts as changed**, the safe direction. A rung-4 (raw) lease is adopted
when linked.

Adoption opens an `adopted-workspace` lineage edge, nests the row immediately, advances the carrier to
`adopted` (`ws-lease-mark`), starts the 7-day clock (§5.11) and assigns cleanup to the parent. Guidance is one
**digest mail per parent per pass** listing new adoptions with their expiry and the exact retain and
promote commands, plus one reminder 24 h before a lease falls due. Mail is idle-gated and
reference-based; non-ccd parents get none. Adoption needs positive proof and is idempotent — replay keeps
lease id and generation. It is enabled by the hand-touched marker `$REG/delegation-adopt`.

### 5.7 Promotion — a real run, dispatched from the lease's tip (revision R1)

Promotion is explicit only. The coordinator opens a run naming the lease (`POST /api/runs` gains an
optional `promotesLease`; `executionOrigin: 'promoted-lease'` and `promotedLeaseId` are additive run and
`RunSummary` fields, each with one reader) and dispatches it as usual. The claimant must be the lease's
parent, or — for a lease whose parent is a programme worker — that worker's coordinator; otherwise the
open is refused. The parent is mailed whenever its lease is promoted.

Dispatch of a promoting run:

1. **Transfer.** `ws-lease-mark` advances the carrier to `transferring` (generation + 1). Every audit
   token minted earlier is now stale (admission rung 10), and `ws-lease-clean` refuses a `transferring`
   lease.
2. **Measure.** `ws-lease-audit` reports the tree's tip and dirt. A dirty tree, or a linked activity
   still `active` or `unknown`, refuses with "commit or discard in the worktree first" and returns the
   carrier to its prior disposition.
3. **Dispatch.** The ordinary dispatch path, with one addition: `ws-add --child <run> --base <tip>`
   (a new additive flag, capability `ws-add-base-v1`, read with `capSupported`; composed only for a
   promoting run). The child workspace is a genuine child — its `.child` is minted by dispatch, never
   forged. Caps apply as for any dispatch; a refusal returns the carrier to its prior disposition.
4. **Record.** `ws-lease-mark` advances the carrier to `promoted`, naming the run and the child session.
   The lease's work now lives on the child's branch, so the lease becomes cleanup-due by the ephemeral
   rule (§5.11); a lease-created branch is pinned before removal, a pre-existing one preserved.

Each workspace has exactly one owner throughout: the old tree stays in the lease population, the new
one is a run child. A crash before step 3 leaves a `transferring` lease with no dispatched run, which
reconciliation returns to its prior disposition; a crash after it leaves a bound run, which
reconciliation records as `promoted`. Untracked and ignored files do not travel — promotion carries the
committed work.

### 5.8 Fleet projection and nesting

A new frame type `{type: 'delegation', activities, lineage, backlog}` with one reader. Absence means the
projection is unavailable, never "no delegated work"; the PWA then renders today's view and claims
nothing it did not measure. Existing frames and fields keep their meanings. Activity and lease rows are
new row kinds in `nestFleet` and the project card, not `FleetSession`s.

- **One level deep.** A coordinator's live non-isolated activity is a row under it that disappears when
  execution ends. Workspace-backed rows (leases, adopted workspaces, programme workers) persist while
  the workspace or a cleanup obligation exists.
- **Programme workers' delegation (proposed, R9):** live activity is a chip on the worker's row; durable
  leases nest under the top coordinator labelled "via <worker>".
- **Persistent lineage:** a terminal run's worker stays nested while its lineage edge is open — lineage
  edges join the run-derived edge rather than closed runs being emitted.
- **Precedence:** programme ownership wins over lease evidence for the same workspace.
- **Cross-repo** work nests on the coordinator's card with a source-project label.
- **Missing parent** → an "offline coordinator" group. **Unresolved / conflicting / unmeasured** work →
  an "unowned work" group per project, never cleanup-authorising.
- **Lineage closes only on:** `native-removed`; a cleanup outcome `reclaimed`; a transfer (close + open);
  an audited operator resolution. Never on ended activity, a terminal run, a missing process, an absent
  row, an expired event or a coordinator restart.

### 5.9 Accounting

| Counter | Rule |
|---|---|
| Programme capacity | unchanged (`ACTIVE_RUN_STATES`, `shared/api.ts:4280`; the daily dispatch cap) |
| Live activity | informational |
| Leases | informational, by disposition; consume no run slot |
| Cleanup backlog | pending / refused / unmeasured obligations; own concurrency (1 in stage 6) and health thresholds |

A promotion consumes capacity exactly as any dispatch does, when its run is dispatched.

### 5.10 The lease carrier and `ws-lease-mark`

One carrier per lease at `$REG/delegation/leases/<leaseId>.json` (dotless subdirectory, so no session id
can collide), written when the lease is linked (from stage 4) and advanced at every disposition change:

```text
leaseId  generation  state (ephemeral|adopted|retained|transferring|promoted|released)  journalSeq
parentId  parentIncarnation  activityId  source (agent|workflow|raw|attached)
project  adminRecord  canonicalPath  fingerprint  claudeBase
branch  branchCreatedByLease  promotedRun?  promotedSession?
```

Written only by `ccd ws-lease-mark --lease <id> --generation <n> --project <p> --admin-record <name>
--parent <id> --parent-incarnation <x> --activity <aid> --source <kind> --state <s> --journal-seq <n>
[--promoted-run <n> --promoted-session <id>]`, composed by the server after it has journalled the
event that mints the generation. No path in argv: the verb derives it from the admin record's `gitdir`
under the project's main checkout. It:

- requires the main checkout to be under the projects root; refuses the main worktree, a locked
  worktree, any path with a symlink component, a tree that contains or is contained by another admin
  record, registry workdir or lease (keyed on common dir + admin record, both directions);
- refuses a tree with a registry row or `.child`;
- computes the fingerprint and refuses a mismatch with an existing carrier;
- holds a per-lease `flock` across read, compare and rename; refuses a generation other than stored + 1
  (or 1 when new); writes a temporary file and renames it into place;
- has its own capability `lease-mark-v1`, a `REQUIRED_VERB_FLAG` entry (`--lease`), a grant prefix, a
  negative type fixture, and a place in the direct-entry boundary.

`released` is the terminal carrier state of a lease that closed without cleanup (`native-removed`,
transferred, or marked foreign); the verb that closes it is the same `ws-lease-mark`, and a later
cleanup or re-link of that tree needs a new lease. `journalSeq` names the server journal entry that
minted the generation; it is not a credential, but a
carrier whose `journalSeq` the journal does not hold is unowned (§5.12). Widening the agent's write
allowlist was rejected: it is the security boundary of the PWA → agent path.

### 5.11 Lease cleanup: `ws-lease-audit` and `ws-lease-clean` (revisions R5, R6)

```text
ccd ws-lease-audit --lease <id> --generation <n>                   # read-only: measures, mints the token
ccd ws-lease-clean --expect <token> --lease <id> --generation <n>  # destructive, server-composed
```

A sibling population to `ws-reclaim` on the `ws-expire` precedent — separate verbs, never a widening
flag. Capabilities `lease-audit-v1` and `lease-clean-v1`, each read with `capSupported`; a box without
one defers as `unsupported`, never falls back. The audit ships in stage 4, where it measures "changed"
for adoption and "dirty" for promotion; from stage 5 the server also asks it for tokens on due leases
(shadow). A token alone deletes nothing: execution needs `lease-clean-v1` and the live marker. Both enter `REQUIRED_VERB_FLAG` (`--lease`, `--expect`)
and the direct-entry boundary. The audit token binds the carrier generation and the parent incarnation.

**Admission ladder** — re-proved by the verb inside the lease lock:

1. the server journal holds the lease; broker row and carrier agree on id, generation, `journalSeq` and
   parent incarnation;
2. the lease is cleanup-due and its carrier state is not `transferring`;
3. no readable or unreadable `.child` / `.archived`, and no registry row whose workdir is the tree or
   inside or around it;
4. a non-main, unlocked git worktree of a main checkout under the projects root, matching the recorded
   identity;
5. no ccd session, hold or supervisor references the tree;
6. no linked activity is `active` or `unknown`, and no parent event names the tree as its `cwd` within
   the quiet window (proposed 24 h) — a `cwd` may defer cleanup, never link;
7. `$REG/reclaim-paused` absent and `$REG/lease-clean-live` present, else refuse `paused` / `shadow`;
8. no attachment, live process, busy tree, or the branch checked out elsewhere;
9. readable tree, containment in both directions, no symlink component, recomputed fingerprint matches;
10. the audit token still matches.

**Dirty work** is not a refusal: the shared executor's WIP commit, attic pin, ignored and
secret-shaped accounting and tombstone apply. A lease-created branch is removed only after pinning; a
pre-existing or unmeasurably-owned branch is preserved and reported. A lease has no session, so there is
no transcript to preserve and no clip to clean; its subagent transcripts belong to the parent and are
never touched.

**Clocks** (unreadable evidence → `unmeasured`, no clock):

| Lease | Cleanup-due |
|---|---|
| ephemeral, unchanged | native removal first; then after terminal evidence, ≥ 5 min and two stable passes |
| adopted / retained / raw | 7 days after the later of adoption and the last Retain; branch writes do not renew; rung 6 still defers while the tree is in use |
| promoted | when the child run is dispatched (§5.7 step 4), by the ephemeral rule |

Terminal evidence: the activity's stop or completion event; workflow-run-ended evidence for `wf_*`
leases (a paused workflow is not ended); or a parent proved dead — registry absent, or its supervisor
measured dead outside its restart window for two passes, or a changed incarnation. A missing
`SessionEnd` is never terminal evidence. `attached` and `tree-busy` defer and raise attention after
24 h.

**Executor.** The reap/reclaim executor is refactored to take a target record (path, branch, common
dir, lock key, tombstone home) instead of a session id. Lease locks, breadcrumbs (`lease-clean:<phase>`)
and tombstones live under `$REG/delegation/leases/.locks/` and `.reaped/`. Resume re-proves generation,
ownership, pause state and fingerprint; a missing worktree alone is not completion — git registration,
the lease branch, the carrier and any residue are each measured.

**Outcomes:** `pending | deferred | paused | refused | failed | reclaimed | unmeasured`, every attempt
journalled, refusal tokens classified gone / terminal / retry, retryable failures backed off, terminal
refusals on the backlog and the attention list. Only the server acts, only through the composed argv;
hooks never delete; no session invokes these verbs and no skill names them.

### 5.12 Transport, journal and durable recovery (revision R2)

- The server appends each accepted event to `~/.ccrc/delegation-events.log` before updating any
  projection (the `pool-edges.log` precedent), with a checkpoint of applied state.
- **The journal alone creates leases.** Reconstruction after a lost `coord.db` replays the journal and
  checkpoint, then corroborates against runs, holds, the registry, markers, the census, carriers, spools
  and transcripts. A carrier with no journal entry, or whose `journalSeq` the journal does not hold, is
  shown as unowned work with no clock and is never cleanup-eligible. A journal lease with no carrier is
  `unmeasured` until other evidence decides.
- **Restart:** resume from the persisted cursors; a parent crash makes execution `unknown`, not ended;
  adoption replay keeps id and generation; promotion recovery is §5.7's; a cleanup crash re-measures
  authority and fingerprint.
- **Retention (proposed):** the journal keeps ≥ 30 days and never drops an event an open lease or
  lineage edge references.

### 5.13 Compatibility and mixed versions

| Capability | Grants |
|---|---|
| `delegation-events-v1` | the spool grammar and ccd creating spool directories (hook registration is measured per home by the doctor, not attested by this token) |
| `lease-mark-v1` | `ws-lease-mark` |
| `ws-add-base-v1` | `ws-add --base` |
| `lease-audit-v1` | `ws-lease-audit` |
| `lease-clean-v1` | `ws-lease-clean` |

Observing never implies writing a carrier; auditing never implies executing.

- Old server + new fleet: spools fill and expire; no carriers, no cleanup.
- New server + old fleet: delegation evidence `unmeasured`; run-child behaviour unchanged.
- New PWA + old server: no `delegation` frame; today's view, no claim of measurement.
- Old PWA + new server: the new frame type is ignored.
- A missing capability disables its act; nothing substitutes a weaker path.
- `ws-reclaim` stays child-only; `ws-expire` (when built) stays archive-only. A lease never has a
  registry row, so `ws-archive` cannot reach one.
- Downgrade preserves carriers, journals, tombstones and obligations; disabling the broker never makes
  retained work ownerless or cleanup-authorised.
- Deploy order is agent-first.

### 5.14 Legacy, raw and non-ccd worktrees

- No ownership from path shape, branch prefix, nesting, ancestry, age or a working directory.
- Run-child agreement seeds programme lineage.
- Rung 2 or rung 4 evidence may establish a lease; everything else is `unresolved` or `unmeasured` in
  the "unowned work" group and never cleanup-eligible because it resembles an Agent or Workflow tree.
- **Operator resolution:** attach an unowned tree to a live parent (disposition `retained`, expiry shown
  when attaching, journalled) or mark it foreign (permanent, never cleaned, journalled).
- A Bash command containing the token `worktree` triggers the before/after listing; the text is a
  trigger, never authority.

## 6. Routes and doors

All registered in `server/src/coord/routes.ts`, so `box-token-census.test.ts` and
`coord-pause-route.test.ts` see them.

| Route | Credential | Attribution | Census |
|---|---|---|---|
| `POST /api/coordinators/:id/intent` (`set`/`clear`) | box token | caller is `:id` | box-token lane outside `/api/mail*`, `/api/runs*`: `CLAUDE.md` bullet, `auth/gate.ts` EXEMPT entry with reason, `ccrc-api` row, prose counts |
| `POST /api/runs` with `promotesLease` | box token (existing) | claimant is the lease's parent, or a worker-parent's coordinator | existing lane |
| `POST /api/leases/:id/retain` | box token | caller is the lease's parent | as the intent route |
| `POST /api/leases/:id/operator-retain` | session only | operator | `SESSION_ONLY`, with its argument |
| `POST /api/leases/:id/resolve` (attach / foreign) | session only | operator | `SESSION_ONLY`, with its argument |

## 7. Rollout

| Stage | Ships | Enabled by | Gate to leave it (proposed, not measured) |
|---|---|---|---|
| 1 Measure | capture rig on the `-hookcap` arm, fixture corpus, matrix | — | every §8.1 row filled for every version on the fleet |
| 2 Observe | hooks, spool, ingestion, the one migration, census extension, correlation and reconciliation (report-only), intent route, skill clause | `delegation-events-v1` | 7 days; < 1% of session-hours with an `unmeasured` interval |
| 3 Project | `delegation` frame, PWA rows | the PWA build | 7 days; no row the operator flags as wrong |
| 4 Adopt | `ws-lease-mark` and carriers, read-only `ws-lease-audit`, adoption, digest mail, retain, resolve, promotion with `ws-add --base` | `lease-mark-v1`, `lease-audit-v1`, `ws-add-base-v1`, `$REG/delegation-adopt` | 7 days; 0 adoptions the independent reader classifies wrong; adoption only for fixture-proven correlation classes |
| 5 Clean (shadow) | audit tokens requested for due leases, shadow rows | the stage-5 build (no new capability) | §8.6 |
| 6 Clean (live) | `ws-lease-clean` at concurrency 1 | `lease-clean-v1` + `$REG/lease-clean-live` (checked by the verb) | the kill rule (§8.6) stands while live |

## 8. Measurement, fixtures, tests and acceptance

### 8.1 Measurement matrix (stage 1)

One row per **event × source × Claude Code version**; sources: Agent, isolated Agent, Workflow worker,
isolated Workflow worker, a raw `git worktree add` from Bash. Columns: fires? · fields present · whose
`cwd` · ordering · native removal observed? · parent SIGKILL / OOM behaviour · tree left behind?

It must answer, per version:

1. do `SubagentStart` / `SubagentStop` fire for Workflow agents, and with what `agent_type`;
2. does `PreToolUse` carry `tool_input.isolation`; is the tool `Agent` or `Task`;
3. does `agent_id` equal the `<id>` in `agent-<id>`; are `worktreePath` and `CLAUDE_BASE` always written;
4. do events from inside a subagent carry the parent's `session_id` or their own, and a non-empty
   `agent_id`;
5. how a session's Claude session id changes across `/clear`, compaction, resume and account swaps, as
   seen in its own spool;
6. when native removal happens and when a tree is left (changed tree, interrupted agent, parent crash);
7. Workflow pause / resume and parent restart: are worker worktrees reused, and what events fire;
8. the cost of the before/after listing on the largest repo; the spool's write cost against the hook's
   p95 budget;
9. the share of leftover trees whose parent is not a ccd session;
10. the measured field that serves as a parent's registry incarnation (§5.1).

No contract depends on a field until its row is filled for every version the fleet runs; a new Claude
Code version is supported once its capture lands.

### 8.2 Fixture corpus

`server/test/fixtures/delegation/<version>/`: event payloads and on-disk shapes (meta files, admin
records, `CLAUDE_BASE`), captured through the existing `-hookcap` capture arm in a private-socket tmux
rig against a mock API — the rig is to be built; the steps are committed beside the fixtures with one
re-capture script. Fixtures speak only placeholder vocabulary (`topology-clean.test.ts`).

### 8.3 Test architecture

| Family | Reuses | Shape of |
|---|---|---|
| hook capture, spool, bucket pruning, concurrent appends | `session-hook.test.ts` helpers incl. `runConcurrent`; its p95 budget pin | the event-mapping cases |
| installer never registers Worktree* | `install-session-hooks.test.ts` | — |
| ingestion, cursors, gaps, torn lines, idempotency | `openCoordDb`, `mkTmp`, `testDeps` | `lifecycle-mirror`, `lifecycle-replay` |
| correlation ladder, state transitions | pure table-driven policy tests | `session-lifecycle.test.ts` |
| reconciliation, census extension | `FleetWatcher` with a fake clock (`rig` in `lifecycle-sweep.test.ts`) | `lifecycle-sweep.test.ts`, `divergence.test.ts` |
| adoption, promotion, attribution | `testDeps`, `CoordStore` | `child-reclaim-bind`, `child-reclaim-store` |
| `ws-lease-mark`, `ws-lease-audit`, `ws-lease-clean`, `ws-add --base` | `makeCcdHarness`, `childReclaimFixture` | `ccd-child-reclaim-audit`, `ccd-child-reclaim-verb`, `ccd-ws-add-child` |
| crash resume | `interrupted()` and the function-override fault seam | `ccd-child-reclaim-verb.test.ts` |
| capabilities, grants, entry boundary | `capsupported`, `KNOWN_CAPABILITY_TOKENS` (a test constant), `whitelist-structural`, the D-3696 rows | `RECLAIM_CAP` rows |
| wire and mixed versions | `fleet-build-skew.test.ts` (real agent and socket) | `child-reclaim-mark.test.ts` |
| nesting and rows | `nestFleet`, `fleet-screen`, `project-card` tests, with new row-kind builders | existing nesting cases |
| migration | one "already at user_version N" block | `coord-db.test.ts` |
| skill, prose and route pins | `coordinator-skill`, `box-token-census`, `coord-pause-route`, `auth-gate` | existing rows |

New source directories are traced by CI's selection map only after a merge rebuilds it; each wave's PR
carries its tests as new files so selection picks them up.

### 8.4 Mutation table (rows each plan must measure red)

Each mutation applied alone, restored from a saved copy, `ccd/ccd` re-stamped where touched; the
measured cell records the failing test and `N failed | M passed`.

| Guard | Mutation |
|---|---|
| a name, pattern, branch prefix, timestamp, census bracket, nesting, ancestry or session `cwd` never links | add an arm accepting each, one row each |
| an `agent-*` / `wf_*` tree without rung-2 evidence never reaches rungs 3–4 | let it fall through |
| rung 2 confirms `worktreePath` equality | drop the equality |
| one id in two sessions' evidence is `conflicting`; conflicting is final | take the first; let a lower rung relink |
| an overlapping listing window is `unresolved` | ignore other sessions' windows |
| a tree that gains a registry row or `.child` within two passes is not a lease | drop the wait |
| the installer never registers `WorktreeCreate` / `WorktreeRemove` | add either |
| the hook removes nothing outside its own spool directory | widen the prune glob |
| a vanished bucket before the cursor marks `unmeasured`; a torn line is not ingested | skip each check |
| an event whose `sessionId` differs from its spool directory is rejected | accept it |
| replay keeps lease id and generation | bump on replay |
| only the journal creates a lease; a carrier alone is never cleanup-eligible | recover a lease from a carrier |
| `ws-lease-mark`: atomic, generation-strict, flocked, both-direction containment, no symlink, no locked tree, root under the projects root, refuses registry rows | one row per refusal |
| promotion: claimant attribution, `transferring` stales tokens, dirty or active refuses, `.child` only via dispatch | one row each |
| ended activity is not reclaimed; a paused workflow is not ended; a restarting supervisor is not dead | one row each |
| native removal needs two successful listings and no breadcrumb; an unreadable record is not absence | one row each |
| lineage outlives its run; programme ownership wins; nesting is one level | close on run close; swap; recurse |
| leases consume no run slot | count them in the cap check |
| admission rungs 1–10 | delete each, one row per rung |
| shadow cannot execute: `ws-lease-clean` refuses without `$REG/lease-clean-live` | drop the check |
| a missing capability defers as `unsupported` | read the token with the verb reader |
| `ws-reclaim` stays child-only | let it admit a lease |
| the stage markers have no writer in the tree | add a writer |
| an absent `delegation` frame reads as unavailable | default it to empty |
| `ws-expire` stays archive-only | **exempt until `ws-expire` exists** |

### 8.5 Acceptance criteria

- Every §8.4 row measured red, except the one marked exempt.
- `single-definition` scans for each new vocabulary; `box-token-census`, `coord-pause-route`,
  `auth/gate.ts` EXEMPT and the prose route counts updated; `ccrc-api` rows added; the coordinator
  clause added and its count word updated everywhere the census finds it.
- `ccd/ccd` re-stamped (`shared/mark.mjs` `markGenerated`) and the citation census re-measured after
  every ccd edit; edits above the frozen anchor stay line-neutral or pay the S6-R11 procedure.
- Each new capability token joins `KNOWN_CAPABILITY_TOKENS`; each composed argv has its builder, grant
  prefix, `REQUIRED_VERB_FLAG` entry, negative type fixture and direct-entry boundary row.
- `topology-clean`, `deviation-refs` (after `git fetch origin main`) and the full server, agent and PWA
  suites green.

### 8.6 Shadow thresholds and kill rule (proposed, not measured)

- **False admission:** a token minted in shadow for a tree that has, at mint time or later, a live
  parent or activity; a ccd session, hold, `.child` or `.archived`; another population's owner;
  unpinned dirty work; or an operator classification "owned elsewhere".
- **Exit from stage 5:** zero false admissions (one resets the window); 100% precision on
  hand-classified links, with recall and the unresolved rate reported (`n/a` is not 100%); at least
  14 days and at least 50 would-clean candidates spanning ≥ 3 coordinators, both Agent and Workflow
  sources and ≥ 1 parent crash. Non-ccd parents are excluded from the precision and recall figures and
  reported separately.
- **Who rules:** an independent reader classifies every candidate against its transcript, a second
  reader cross-checks (the stall-watch review protocol), the operator rules.
- **Kill rule (stage 6):** any live false admission, or any refusal the reader classifies as unexpected,
  → the operator touches `$REG/reclaim-paused` by hand, then the cause is re-derived.

## 9. Observability and operator controls

- **Stage markers** `$REG/delegation-adopt` and `$REG/lease-clean-live`: touched by hand, no writer in
  the tree, absence = off / shadow, pinned by test.
- **The single cleanup switch** `$REG/reclaim-paused`, checked by the verb on the box, stops lease
  cleanup too.
- **`/api/fleet/health`** gains an optional `delegation` block: unmeasured-interval rate, unresolved,
  conflicting and unmeasured counts, cleanup backlog, oldest obligation. Absent reads unknown, never ok.
- **Doctor** `delegation-hooks`: PASS / WARN / FAIL / SKIP with a remedy line — hooks registered in each
  home, spool directory present, ccrc registers no Worktree* hook; WARN when a foreign Worktree* hook is
  installed, because the evidence model then no longer holds.
- **Feed rows** per adoption, promotion and cleanup outcome (the `recordChildReclaimFeed` idiom).
  **Attention entries** for terminal refusals, conflicts, leases past expiry and the circuit breaker.
- **Shadow records:** a `lease-clean-shadow:<outcome>:<lease>` row per would-clean plus one
  `console.warn('ccrc-server: …')` line; dedupe writers return a typed recorded / duplicate result.

## 10. Sequencing

One ccrc programme, run through `runs open` / `runs dispatch` — this design exists because that was
skipped — one wave per stage. Every `delegation_*` table lands in wave 2's single migration. Waves 1–4
depend on nothing unbuilt. Wave 6 sequences after CCR-15's fourth wave (the server-side reclaim sweep
and pause route) so lease cleanup reuses its sweep. Each wave can be disabled independently by its
capability or marker; reverts go in reverse order.

## 11. Open questions, closed by measurement

Every item in §8.1, plus: the spool retention (24 h proposed) and line cap; whether the census extension
fits the agent's existing read ops; the quiet window of admission rung 6 (24 h proposed); the
reconciliation cadence. None changes an authority rule in this document; each sets a constant or names a
field.

## 12. Out of scope

Fabricating runs for past work; forcing isolation; nesting deeper than one level; cleaning worktrees
whose parentage is unproved; any change to `ws-reclaim`'s or `ws-expire`'s populations; carrying
untracked files through promotion; non-git version control.

## 13. Amendments this design makes to other documents

- **`CLAUDE.md`**:
  - Coordination invariants: after "Zero new ccd verbs for coordination mutation", add that
    workspace-lifecycle verbs and flags (`ws-reclaim`, `ws-lease-mark`, `ws-lease-audit`,
    `ws-lease-clean`, `ws-add --base`, and `ws-expire` when built) act on workspaces, not on coordination
    state, are server-composed only, and are not covered by that rule.
  - SAFETY: add `ws-lease-mark` and `ws-lease-clean` beside `ws-reclaim` as forbidden to every session.
  - The box-token bullet: name the `/api/coordinators/…` and `/api/leases/…` lanes.
  - The coordinator clause count.
- **Coordinator skill:** one clause appended at the next number (the seventeenth on `698f679da`) —
  declare coordinator intent before delegating — pinned verbatim in `coordinator-skill.test.ts`, plus a
  reference section on adopted workspaces, promotion and the "unowned work" group. It must not
  contradict the routing matrix's "workflow mode on while orchestrating"; generic Agent and Workflow use
  stays permitted. No skill names the lease verbs.
- **Child-reclaim design:** its executor takes a target record; child admission is unchanged.
- **Workspace-lifecycle design:** `reclaim-paused` governs lease cleanup too.
