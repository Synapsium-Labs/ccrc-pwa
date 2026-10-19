# ccrc consolidation wave: one owner per job (design)

**Status:** DRAFT rev 0, for the operator's review. Nothing here is approved. No D-numbers yet: the plans allocate them. Every decision in §6 takes its recommendation only if the operator rules so.

**The request (operator, 2026-10-19):** "I also feel like we have a lot of separate mechanisms that try to do similar stuff, and we should do a consolidation and refactoring wave that also gets us to DDD/CLEAN/SOLID state plus consolidation of similar functionality."

- **Citations** are to `origin/main` `d532903d2`. Line numbers are hints, written `≈:`, and every citation also names its function, constant or file.
- **Measurements** come from five read-only inventories of `origin/main`: ccd and the box, the coordination server, the fleet watcher, the PWA, and the cross-cutting kernels. Each was re-counted by `git grep`/`wc` for this draft. **[M]** marks a measured figure and **[I]** an inferred one.
- **This spec extends `2026-08-10-architecture-ddd-clean-solid.md` and contradicts nothing in it.** The rings (L0–L5), the six contexts, the cross-cutting rules (a)–(e), the enforcement list and the Rejected list all stand. Where this wave touches a Rejected item (the FleetWatcher lane interface, a domain-event bus, a `FleetGateway` port over ccd, splitting `shared/api.ts`), §2.5 says how it stays on the right side of it, and §6 asks for a ruling wherever it would not.

**Date:** 2026-10-19 · **Branch:** `docs/consolidation-wave-spec` (from `origin/main` `d532903d2`)

**Related:**
- `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, the architecture spec. This document is its consolidation chapter.
- The Linear project "ccrc architecture remediation" and its eight epics: ENF (CCRCP-88), TEST (CCRCP-89), SEAM (CCRCP-90), REF (CCRCP-91), STORE (CCRCP-92), DECIDE (CCRCP-93), CCD (CCRCP-94) and PWA (CCRCP-95). It holds 36 ARCH tickets; ARCH-11a is done. ARCH-02a (#528) adds contexts 7–9 and the PWA ring map. ARCH-02b (#537) asks for the ruling on the Rejected list and the standalone-PR allowance that §6 O1 and O9 depend on.
- `2026-10-13-supervisor-tick-diet-design.md` and `2026-10-13-event-gated-fleet-observer-design.md`. These are the budget for anything on ccd's 5 s tick.
- `2026-10-16-working-state-and-interruptions-design.md` and its plan. Hibernation is Task 17a/18, and Task 19 (shadow week, then arming) is pending.
- `2026-10-17-coordinator-first-routing-design.md`, which is live and holds the asks and approvals hold rule.
- `2026-09-23-session-continuity-design.md`. Wave 4b is open as #435, with its plan as #409.
- `2026-10-12-path-identity-design.md`. W1a is open as #397, the W1b correction as #735 and the W2 plan as #436.
- `2026-10-15-ccrc-two-skins-design.md` with the W2 shells and W3 screens plans; `2026-10-18-settings-redesign-design.md`; `2026-10-18-accounts-connect-design.md` (#745 is open); `2026-10-18-claude-binary-lifecycle-design.md` with plans W1–W5 (#744 is open).
- `2026-07-21-ccrc-attention-feed-design.md` and `2026-08-06-attention-ux-design.md`, the attention surfaces this wave routes into.
- CCRCP-198: run↔session matching by id string, the bug class §3 K10 closes.

## In short

- **ccrc has one job done many ways, again and again.**
  - Six server lanes and seven ccd verbs each own a slice of a workspace's end of life.
  - About eighteen predicates answer "is this session alive", and nine or more answer "is it idle".
  - Operator questions travel eight routes and come back through six answer doors.
  - Feed events are double-written by hand in sixteen places.
  - Secrets are masked by five redactors that use three different mask words.
  - The Claude Code pane is parsed in three languages.
  - A run is matched to its session by id string in about fifty places, and two of the PWA's rules for it disagree today [M].
- **The 08-10 spec already measured why this costs.** An invariant with one home took a one-line fix, while the same invariant with nine writers took four review rounds and was still open (its §"natural experiment"). This wave applies that result to *jobs* as well as invariants: one owner per job, one writer per fact.
- **The target is nine bounded contexts plus four shared kernels (§2).** The contexts are the 08-10 six, re-cut where the overlap shows the boundary was wrong, plus ARCH-02a's three. The kernels are clock and schedule, switches, redaction, and Claude Code grammar. Each context names its aggregates, the single writer of each invariant, the facts it records (journal rows, not a bus), and its ports.
- **Eighteen consolidation clusters (§3)** each collapse into one owner. Every cluster says what is deleted, where each consumer moves to and the measured overlap that justifies it, and marks the parts that look duplicated but are **legitimately different**. Examples: ccd re-deciding inside its lock is a TOCTOU guard, ccd's unanchored busy grep fails safe on purpose, and auto-swap must decide with the server down.
- **The clusters map onto the remediation programme (§4).** Of the 35 open ARCH tickets, eleven are prerequisites, eleven are absorbed unchanged as a cluster's first step, two are re-scoped (ARCH-24, ARCH-29), eleven proceed independently, and none is cancelled. Six new epics add 36 tickets, ARCH-40 to ARCH-75.
- **Migration is nine strangler waves, W0–W8 (§5).**
  - Every wave lands its characterization pins first, measures its exit criteria by count (lines out of god files, writers per fact, parity pins removed), and rolls back as a plain revert.
  - The server-only funnels go first because they touch no in-flight PWA file.
  - The workspace-lifecycle wave waits for hibernation's shadow week, and the ccd waves wait for #435 and path-identity W1b.
  - Nothing blocks the skins chain, the Settings redesign, Accounts connect, the binary lifecycle, or the auto-swap.
- **ccd stays bash at its OS edge.** That covers the supervisor tick, swap and carry, registry writes, locks, and the act-time re-check. Its four destructive families consolidate *in bash* onto one skeleton. Only off-hot-path pure policy that has a twin today moves to a single `.mjs` implementation that bash calls (the `shared/models.mjs` pattern). The cost argument is in §5.12, and the operator rules in §6 O2.

## 1. The problem in numbers

### 1.1 One job, many mechanisms

| Job | Mechanisms today | Where | Count |
|---|---|---|---|
| **End a workspace's life** (sleep, stop, retire) | server lanes: stop-done, hibernation, child reclaim, temp-root collect, archived expiry, dead-coordinator | `stopDone.ts`, `stopDoneSweep.ts`, `coord/hibernate.ts`, `hibernateSweep.ts`, `childReclaimSweep.ts`, `coord/childReclaim.ts`, `collectLane.ts`, `coord/collectTempRoot.ts`, `archivedExpiry.ts`, `coord/expireArchived.ts`, `deadCoordinator.ts`, `coord/endDeadCoordinator.ts` | 6 lanes, 12 files, **10,750 lines** [M] |
| | ccd destructive verbs: `ws-reap`, `ws-reclaim`, `ws-expire`, `ws-collect`, `ws-rm`, `ws-gc --prune`, `forget` | `ccd/ccd` regions ≈:11958–14360 (reap), ≈:29000–33750 (reclaim), ≈:33750–34614 (expire), ≈:34615–36700 (collect) | 7 verbs; four have their own eval/resume_eval/fork/audit/locked/tail family, about **10k lines** [M] |
| | registry deleters / stoppers | `_reg_purge` call lines, `_ws_unsupervise` call lines | 7 and 9 lines in `ccd/ccd` [M] |
| | switch readers of one pause | `reclaim-paused` | read in **12 server files** [M], each with its own wording |
| **Is this session alive** | ccd: `_session_probe`/`_alive`, `_session_state`, `_ws_unit_state`, `_svc_is_active`, `_ws_expire_presence`, `_ws_expire_cwd_users`, `_ws_path_users`, `_ci_rec_live`/`_ci_hold_live` | `ccd/ccd` | 8 [M] |
| | server: `assembleFleet` ladder, `liveStatus`, `SessionStream.resolve` (its comment says "MIRRORED"), `turnverdict.liveRowFor`, `measureClaimant`, `claimProbe`, `deadCoordinator` | `fleet.ts`, `sessionws.ts`, `turnverdict.ts`, `coord/reclaim.ts`, `watch.ts` | 7 [M] |
| | PWA: `coordPresence`, `hibernatedSince`, `lifecycleQualifier`, `sessionFacts` dead/asleep, plus inline `status === 'dead'` | `coordWords.ts`, `hibernated.ts`, `lifecycleWords.ts`, `sessionFacts.ts`, `SessionActionsSheet` (6), `startProgramPolicy` (3), `ArchiveAllPlane`, `AccountsScreen`, `groupFleet`, `spawnWords` | 4 + 13 inline [M] |
| **Is it idle / mid-turn** | ccd: `_ws_status`, `_idle_for_keystroke`, `_swap_idle_gate`, hibernate's `turn.json`, collect's ctime | `ccd/ccd` | 5 |
| | server: `livestate`, `turnidle` (mail gate), `turnverdict`, `finished` edge, stall verdict, `hibernateVerdict` idle | | 6 |
| **Ask the operator** | routes out: asks, approvals, scraped dialogs, mail, feed, push, digest, ccd `notify.sh` banner | | 8 routes |
| | answer doors: `/api/asks/:id/answer`, `/api/sessions/:id/ask`, `/dialog{,/text,/multi,/tab}`, `/api/approvals/:id/rule` + `/release`, the hook polling `/ruling` | `coord/routes.ts`, `server.ts` | 6+ doors; PWA has 3 answer paths (DialogSheet, EnvelopeSheet, `push-sw.js`) |
| **Tell the operator something happened** | `log.record(…); coord.recordFeedEvent(log.epoch, ev)` written by hand | `routes.ts` ×5, `childReclaim.ts` ×3, `server.ts`, `interruptlog.ts`, `stopDoneSweep.ts`, `endDeadCoordinator.ts`, `expireArchived.ts`, `watch.ts` ×2 | **16** callers outside the store [M]; 2 read models (ring catch-up, `feed_events`) |
| **Mask a secret** | `redactCommand` (`[REDACTED]`), `redactDocsText` + ccd python `REDACT_RULES` (`***`), history `redact*` (`[redacted]`), bash `redact()` / `_upd_redact()` (deletes) | `coord/redact.ts`, `shared/docs.ts`, `ccd/ccd` ≈:37219, `ccd/history/lib.mjs`, `ccd/ccd-update-sync`, `ccd/ccrc` | 5 implementations, 3 mask words, the URL-userinfo rule written 4 times |
| **Read the Claude Code pane** | server `pane/dialog.ts` + `pane/statusline.ts` + `shared/ask-menu.ts`; ccd greps/awk; PWA `wrapScreen`, `askLive`, `drawerView`, `MessageBubble` | | 3 languages; SGR stripper declared **5×** [M]; 15 `esc to interrupt` lines in ccd |
| **Read the transcript** | TS `transcript/*`; ccd jq `CONTINUED_IN_JQ` (+ verbatim `def prompt` copy in `ccrc-doctor-checks`), python `_transcript_last_turn_ts`, `compact-card.mjs`, history | | 5 readers; 4 path resolvers |
| **Which run is this session's** | `runForSession` (newest id) vs `PrSheet.tsx:118` (first open run), `ArchiveSheet:134`, `RunsScreen`, `nestFleet`; server ~50 `sessionId`/`claimedBy` equality sites in ~25 files | | 2 PWA rules that **disagree** [M] |
| **Schedule work** | `FleetWatcher` `last*` fields, each lane's own throttle/single-flight/warn | `watch.ts` | **24** `last*` fields [M], 12 single-flight flags; 3 constants aliased across unrelated lanes; `CHILD_RECLAIM_SWEEP_MS` gated on two different clocks |
| | systemd timers, restated as launchd plists and again in `ccrc-doctor-checks` | `deploy/systemd/*.timer`, `ccd/ccrc` ≈:5760 | **14** timers [M], each cadence in 2–3 places |
| **Switch a lane off** | marker files + db settings tables | | ~15 markers + 3 tables; 46 marker-name literals in `server/src` [M] |
| **Poll the accounts** | fleet store, `AccountsStrip`, `useProjectedHome`, `useAccountUsage`, `AccountsScreen` | `pwa/src` | **5** pollers on 20 s clocks [M] |

### 1.2 Things that live twice, and the pins that hold them

- **13 named parity/twin test files** [M] exist only because one rule lives in two languages: `ccdargv-dash-id-parity`, `ccdargv-dec-parity`, `continued-in-parity`, `continued-in-successor-parity`, `deliverability-parity`, `docs-parity`, `keepalive-freshness-parity`, `lifecycle-constants-twin`, `pool-epoch-numeric-parity`, `pool-name-parity`, `pool-tag-parity`, `roster-exec-parity` and `update-spawn-twin-bodies`.
- At least six more pins sit inside other tests: `ccd-session-lifecycle`, `ccd-serviceable`, `ccd-ctx-row` (statusline), `base-url`, `projected-home` and `ccrc-doctor` (timer cadences).
- `ccd/ccd` names about 26 TS twins in comments, and `ID_RE` alone is restated three times in ccd.
- `server/test/single-definition.test.ts` is **7,250 lines** [M], a text scanner that exists because duplicates keep coming back.

A pin like this is the right answer when the two copies have to live in two languages. It is the wrong answer when the second copy exists only because nobody gave the first copy a home. §3 marks each pin as one or the other.

### 1.3 God files

| File | Lines [M] | What it mixes |
|---|---|---|
| `ccd/ccd` | 40,671 (644 functions) | every ccd context plus embedded python (docs, carry, PR) and jq |
| `ccd/ccrc` | 24,429 | install, update, rollout, accounts, doctor glue, the platform block (byte-identical to ccd's) |
| `shared/api.ts` | 11,693 | all wire vocabulary. **Stays one file**: 08-10 Rejected |
| `server/src/watch.ts` | 11,298 | ~30 lanes, `DelegationLane`, collector internals, `claimProbe`, the tick |
| `ccd/ccrc-doctor-checks` | 9,467 | health checks that restate timer cadences and a jq reader |
| `server/src/coord/store.ts` | 8,888 | ~15 contexts' tables in one class (one class is right, 08-10 Rejected; one *file* is not required) |
| `ccd/session-hook.sh` | 5,061 | turn mark, join, compaction lock (a second implementation), approval wait, cards |
| `server/src/coord/routes.ts` | 4,731 | mail, runs, claims, ledger, asks, approvals, switches |
| `server/src/server.ts` | 3,823 | ~40 inline session routes |
| `pwa/src/lib/api.ts` | 1,377 | transport, refusal tables, error text |
| `server/src/sessionws.ts` | 1,301 | transcript re-pointing plus its own 2 s poll of dialog, tasks, workflows, mail, hook ask |

### 1.4 What duplication has cost, measured

- **CCRCP-198.** The header names one run and the PR sheet names another, because two rules pick "the" run.
- **The account enumeration** (08-10 §"Bounded contexts" 1) was written eight times in three languages. A missing entry in one of them silently killed chat for six of 24 sessions. That is the same failure shape as this wave's clusters, at a smaller size.
- **`stopDoneVerdict`** (`stopDone.ts` ≈:160–215) is a near line-for-line copy of `hibernateVerdict` (`coord/hibernate.ts` ≈:180–221). They run on two clocks (60 s and 5 min), read `hibernate-after-hours` separately, and restate the same hold sentences.
- **"Someone is looking"** has two meanings that are used inconsistently. Child reclaim, expiry and collect defer on `Presence.isVisible`; hibernate and stop-done defer on `Presence.isOpen`. Expiry defers without a ceiling, child reclaim with one.
- **The busy grammar disagrees across the seam.** ccd's grep is unanchored, so scrollback reads busy, while the TS `BUSY_RE` is anchored. ARCH-24 records that this split is intended, but nothing tells a reader which copy is authoritative for which decision.

## 2. The target: contexts, kernels, writers, ports

### 2.1 How this extends the 08-10 spec

- **The rings are unchanged.** L0 shared kernel, L1 policy, L2 ports, L3 adapters, L4 delivery, L5 composition root. Ring membership is still a property of a file's imports.
- **ARCH-02a's wording is adopted as written:** a deadline timer inside one adapter call is L3, schedulers and pollers are L4, the `.mjs` carve-out lists its `node:*` modules, and the PWA rings are `*Words.ts`/policy/pure lib = L1, `lib/api.ts` = L3, stores/hooks/components/screens = L4.
- **Two cross-cutting rules are added** to 08-10's (a)–(e):
  - **(f) One writer per fact.** Every fact this spec names in §2.2 has a declared writer set, and a `writers` pin (§5.1) lists it. The set may only shrink. "Writer" means the function that performs the write, not the callers that ask for it: two lanes may ask one primitive to write.
  - **(g) A schedule is data.** A lane's cadence, clock and single-flight rule are a row in one table. They are not fields on a class or a constant aliased from another lane. This is **not** a lane interface (see §2.5).
- **A context is a row in ARCH-34's manifest and ARCH-04's context map**, not a directory. No file moves just to sit in a context's folder. 08-10 rule (e) says moving files silently deletes scanner coverage, so files move only where a cluster already deletes or splits them.

### 2.2 The context map

The 08-10 six are kept and re-cut in two places: Workspace takes the whole end of life, and Attention takes every operator question. ARCH-02a's three are added. "Writer" names the single writer of each invariant after this wave. Each "Facts recorded" entry is a journal or table row with one writer; it is **not** a bus (08-10 rejects a domain-event bus).

#### C1. Fleet Registry & Accounts
- **Aggregates:**
  - **Account**: a roster entry. Account = wrapper, as 08-10 defines it.
  - **SessionRow**: a registry row `$REG/<id>.*` with its `generation`.
  - **SessionReading** (new): one value per session per tick, built once (§3 K3, K4). Its parts are substrate (`present | absent | unmeasurable`), lifecycle (the `sessionLifecycle` word), turn (`busy | idle | shell | unknown`, with why), sleep (`awake | asleep since T`) and viewer (`none | open | visible`).
- **Writers:**
  - The roster: `ccrc account` → `deploy/account-op.mjs`. `$REG/<w>-disabled` becomes a projection of the roster that the same verb writes. ccd still reads only the marker, so no ccd reader changes.
  - Auth-dead: one ccd primitive, `_authdead_mark`/`_authdead_clear`. Its callers are `ccd-account-health`, the swap tick and `_authdead_clear_on_spawn`; today it has three hand-written writes.
  - Registry fields: `_reg_set`/`_reg_purge` in ccd, and the hook's documented fields in `session-hook.sh`. A field schema (ARCH-34's manifest plus a field table) names each field's writer.
  - `SessionReading`: one L1 function, `readSession(facts)`, called by the watcher's tick.
- **Facts recorded:** the ccd lifecycle journal (`$REG/.lifecycle`, mirrored into `lifecycle_events`).
- **Ports:**
  - the registry, through FleetIO's `readRegistryMeasured`, which must tell an absent row from an unmeasurable one (SEAM);
  - the agent link (`remote/client.ts`, `FleetState`);
  - Claude Code's status file (`livestate.ts`).

#### C2. Fleet Mutation (unchanged)
- `CCD_ARGV`, the `CcdArgv` brand, the agent whitelist, exec/pty/tmux.
- **ccd is this context's anti-corruption layer.** ccd is the only component that names tmux, systemd and Claude Code's on-disk layout. The server names only verbs.
- The wave adds two things on the outbound side:
  - **typed envelopes:** ARCH-14's `refusal-v1` token, and `--json` outputs whose shapes are declared in `shared/`;
  - **one capability predicate:** today `verbSupported` (absent permits) and `capSupported` (absent refuses) are chosen per call site, 33 and 39 sites. After the wave each `CCD_ARGV` row declares its default once, and one `ccdCan(row)` reads it.
- **Not** a `FleetGateway` port. That is rejected in 08-10 and stays rejected.

#### C3. Session Conversation
- **Aggregates:**
  - Transcript (resolve, rotate, tail);
  - **PaneReading** (new): one grammar's tokens over a capture (§3 K8);
  - the injection queue (`inject/*`, `KeyedQueue`).
- **Writers:**
  - Pane tokens come from one module, `server/src/pane/`. For ccd's own reads, ccd's grammar file, held to the same fixture corpus (ARCH-24).
  - The transcript reader is one per language: TS `transcript/`, plus one jq library file for ccd and the doctor (§3 K9).
- **Ports:** Claude Code panes (tmux capture via the runner) and Claude Code transcripts (FleetIO).

#### C4. Workspace Lifecycle (re-cut: was "Workspace & PR Lifecycle")
- **Aggregate: Workspace**, with a state machine in L0, `WORKSPACE_TRANSITIONS`, written the way `RUN_TRANSITIONS` is:

  ```
  live ──idle-policy──▶ asleep ──wake──▶ live
  live ──stop──▶ stopped ──ensure──▶ live
  live|stopped|asleep ──archive──▶ archived ──restore──▶ live
  any-not-live ──retire(reason)──▶ retired          (tombstone; registry purged)
  reason ∈ merged | child-spent | archive-expired | temp-orphan | operator-rm | dead-row
  ```

  An absent edge is a refusal, and clients read it, as with `RUN_TRANSITIONS`.
- **Policies, not lanes.** "Sleep a long-idle session" and "sleep a finished worker" are two **idle policies** of one transition. "Reap merged", "reclaim a spent child", "expire archived", "collect an orphaned temp root", `ws-rm`, `ws-gc --prune` and `forget` are seven **reasons** of one `retire` transition. Each reason keeps its own evidence rule: a child marker plus `--child-of` agreeing, an archive epoch, witnesses, a merged PR.
- **Writers:**
  - One L1 decider per transition: `decideSleep(facts, policy)` and `decideRetire(facts, reason)`.
  - One L4 executor per transition, which composes the ccd verb on the coord serialiser and `KeyedQueue` and records one feed notice through the funnel (§3 K6).
  - On the ccd side, one retire skeleton (§3 K2) that every reason runs through, keeping its act-time re-check.
- **Facts recorded:** lifecycle journal rows (`intent`/`done`/`fail`/`refuse`) and `.reaped/<id>.json` tombstones. The ccd lock and tombstone are already shared.
- **Bindings, read once.** "Is this workspace bound by coordination" (open runs, claims, outstanding mail, reviews) is asked by nine sites today. It becomes one store query, `bindingsOf(sessionId)`, owned by C5 and read by C4.

#### C5. Coordination
- **Aggregates:**
  - Programme; Run (`RUN_TRANSITIONS`); WorkItem;
  - **Lease**: today's "path claim" (`claims`/`claim_paths`), renamed in TS words only;
  - **RunBinding** (new, §3 K10): the one coordinator↔worker link, keyed on the worker's **incarnation** (session id plus generation), not the bare id string;
  - **StallObservation**, moved out of `run_events`, where stall observations sit today as rows with `fromState == toState`.
- **Writers:**
  - Store primitives, one per invariant (STORE epic: ARCH-15, ARCH-16).
  - `RunBinding` is written by `openRun`/`dispatchRun`/`closeRun`/`reclaimProgram`, and by nothing else.
  - ccd's `.child` marker becomes a **projection** of the binding that `ws-add` writes at dispatch. ccd keeps it because its reclaim must verify the link under its own lock with the server down. It remains a legitimate second copy, but a derived one.
- **Mail stays here** (08-10's boundary fix, ARCH-19): sweepMail's delivery policy moves into `coord/` as an L1 decider.
- **The dead-coordinator lane stays here.** It acts on *runs* (abandon), not on workspaces, so it is not part of C4. It shares C1's `SessionReading` with the programme reclaim door, which today asks `measureClaimant` a slightly different question.
- **Facts recorded:** `run_events` (transitions only), `mail_deliveries`, `lifecycle_*` mirrors and the delegation journal. The delegation journal is an **authority**, not a mirror, so it stays separate (§3 K17).
- **Input pending.** The coordinator↔child durability investigation running now will feed `RunBinding`'s durability rule. This spec fixes only its key and its single writer.

#### C6. Attention & Notification (re-cut: takes every operator question)
- **Aggregates:**
  - **OperatorQuestion** (new): one type for a held Claude Code question, with `kind: ask | approval | dialog`. It has one hold rule (`heldFor.ts`, the claimant first, then the operator; coordinator-first's ruling), one release/lapse/retention sweep, and one answer door family.
  - **Notice**: one operator-facing event.
- **Writers:**
  - Notices: one funnel, `notify(event)`, which writes the ring, `feed_events` and push in that order (§3 K6).
  - Questions: one module, `coord/questions.ts`, over today's two tables (§6 O5).
  - The approval signing path (`approvalsign.ts`, `approval-verify.mjs`) is untouched. It is a security boundary with its own threat model (coordinator-first §6).
- **Channels are read models.** Push, the feed screen, the digest and catch-up project from the notices and questions. They are not routes with their own decisions. Today ccd's `notify.sh` banner reaches the server through `POST /api/notify` as a bus notice; it becomes a notice through the funnel.
- **Ports:** `PushService`, `NotifyLog` (ring cache) and coord.db.

#### C7. Update control plane (ARCH-02a)
- Catalogue, inventory, intent, dispatch/converge leases, server-caps, and the Claude Code binary roll and install (CB-tasks).
- The server-caps file is written by `update/serverCaps.ts` on server nodes and by `ccd-update-sync` on fleet nodes. That is one fact per node with one writer per node kind, which is legitimately different, but it is pinned.

#### C8. Auth & box token (ARCH-02a)
`auth/`, `token/`, WebAuthn, the box token. The wave does not touch it except to move its redaction calls onto the kernel.

#### C9. Docs (ARCH-02a)
`docs/`, `shared/docs.ts`, and ccd's docs verbs. The wave moves only its redactor (§3 K7).

### 2.3 Shared kernels: one implementation, no context

These are not contexts, because they hold no aggregate. Each is one implementation with its consumers named.

| Kernel | Home after the wave | Replaces |
|---|---|---|
| **Clock and schedule** | `LANE_SCHEDULE` (L0 data: name, cadence, clock kind, single-flight, warn-once) plus one L4 `runLane(name, fn)` in `watch.ts`; an injected `now()` for L1. ccd: `_now_s` only | 24 `last*` fields, 12 flags, 3 aliased constants, 2 clocks for one constant; 54 raw `date +%s` in ccd [M] |
| **Switchboard** | `SWITCHES` (L0 data: name, marker or settings row, default, owner context, meaning) plus one reader `readSwitches()` over the tick's one registry listing | ~15 marker files read per sweep, `reclaim-paused` re-parsed in 12 files, `MAIL_DISABLED_MARKER` defined twice |
| **Redaction** | `shared/redact.mjs`, the `models.mjs` pattern: one implementation, a `.ts` re-export, callable from bash through node. It has one rule table and named **profiles** (egress `[REDACTED]`, docs `***`, history index `[redacted]`, log-line userinfo) | 5 implementations |
| **Claude Code grammar** | the pane grammar `server/src/pane/` (one SGR stripper, one prompt glyph, one busy row) and a fixture corpus `server/test/fixtures/panes/` with **per-caller verdict columns** (ARCH-24); a transcript jq library for ccd | 3 pane grammars, 5 SGR declarations, 5 transcript readers |

### 2.4 Ports

| Port | Adapter (L3) | Failure contract the wave requires |
|---|---|---|
| Agent link / FleetIO / Runner | `io.ts`, `remote/io.ts`, `exec.ts`, `remote/runner.ts` | ARCH-08b's `readdirMeasured`; ARCH-10: the runner says whether ccd ran |
| ccd (the ACL) | `CcdArgv` + runner | ARCH-14: refusal-v1 token before prose; typed `--json` envelopes |
| Claude Code pane | tmux capture via the runner | a capture that failed is `unmeasurable`, never an empty pane |
| Claude Code transcript / status file | FleetIO + `transcript/resolve.ts`, `livestate.ts` | an absent file is not an idle session |
| coord.db | `CoordStore` (synchronous: no repository interface, 08-10 Rejected) | every guarded writer returns `{changed, state}` (ARCH-15) |
| Push | `push.ts` | a send failure is recorded, never thrown past the funnel |
| Clock | `now()` injected into L1 | none (pure) |

### 2.5 Staying inside the Rejected list

| 08-10 Rejected item | How the wave stays clear of it |
|---|---|
| Decomposing `FleetWatcher` into a lane interface | `LANE_SCHEDULE` is a data table and `runLane` a helper on the same class. Lanes stay methods; the deciders leave for L1 (DECIDE), which is ARCH-02b's own prescription. A per-context scheduler class would reopen this item, so §6 O4 asks for a ruling instead of assuming one. |
| A domain-event bus | "Facts recorded" are rows with one writer each. The funnel is a function, not a bus. |
| A `FleetGateway` port over ccd | ccd stays reached only through `CcdArgv`. The ACL is ccd itself plus typed envelopes. |
| Splitting `shared/api.ts` | It is not split. `WORKSPACE_TRANSITIONS`, `SWITCHES` and `LANE_SCHEDULE` go in the existing one-concern-per-module files (`shared/workspace.ts`, `shared/switches.ts`); the wire types stay in `api.ts`. |
| A repository over `CoordStore` | Not proposed. `store.ts` may be split into files per context **inside one class** (partial-class mixins, or `store/*.ts` functions bound to the one `DatabaseSync`), and only if §6 O1 wants it. |
| Branded value objects for every id | Only one new value is proposed: the `Incarnation` key for `RunBinding`, where CCRCP-198 is the recorded bypass. That is the 08-10 test for a brand. |
| Use-case classes, a DI container, ISP over `Deps` | Not proposed. Deciders are functions and deps stay consumer-declared. |
| Splitting `CCD_ARGV` per context | Not proposed. One flat table gains a `default` column for `ccdCan`. |

ARCH-02b's three proposed **new** Rejected entries:
- **runtime-sourced ccd siblings:** respected. The wave does not split `ccd/ccd` at runtime.
- **moving ccd rotation and reap decisions server-side:** respected. The retire decision stays in ccd at act time.
- **compiling policy across languages:** respected. A single `.mjs` that bash executes is one implementation, not a compiled one. §6 O2 asks the operator to confirm that reading.

## 3. The consolidation catalogue

Each cluster gets the same five lines:
- **One owner:** the single thing it collapses into.
- **Deleted:** what goes.
- **Consumers move:** where each caller goes.
- **Overlap:** the measured duplication that justifies the work.
- **Verdict:** each part is marked **real duplication** (collapse it) or **legitimately different** (keep it, and say why). Most clusters have both.

### K1. A workspace's end of life, server side → C4's two deciders and two executors

- **One owner:**
  - `decideSleep(facts, policy)`, with policies `idle-hours` (today's hibernation) and `run-done` (today's stop-done);
  - `decideRetire(facts, reason)`, with reasons `child-spent`, `archive-expired` and `temp-orphan`;
  - one `sleepExecutor` and one `retireExecutor` in L4, each reading switches once, taking the tick's registry listing, checking `ccdCan` once and writing one notice through the funnel.
- **Deleted:**
  - `stopDone.ts`'s copy of the hibernate verdict;
  - `stopDoneSweep.ts` as a lane, which becomes a policy row on the sleep lane;
  - the four executors' private `reclaim-paused` parsers, registry listings, capability checks and feed writers (`coord/childReclaim.ts` ≈:1013/1123/1692–1758, `coord/expireArchived.ts` ≈:130/287, `coord/collectTempRoot.ts` ≈:252/357–365, `coord/endDeadCoordinator.ts` ≈:161/195/280).
- **Consumers move:** `watch.ts` `sweepStopDone`/`sweepHibernate` become one `sweepSleep`, and `sweepChildReclaim`/`sweepArchivedExpiry`/`sweepTempRootCollect` become three `retire` reasons on one schedule row each. `close.ts`'s fire-and-forget reclaim calls `retireExecutor`. The PWA's three coord-frame attention parsers (`childReclaimWords`, `expiryWords`, `deadCoordinatorWords`) read one `AttentionRow[]` shape.
- **Overlap:**
  - 6 lanes in 12 files, 10,750 lines [M];
  - `reclaim-paused` read in 12 files [M];
  - `stopDoneVerdict` ≈ `hibernateVerdict`, line for line;
  - "is it bound by coordination" assembled 9 ways (moves to C5's `bindingsOf`);
  - viewer deferral split between `isVisible` and `isOpen`.
- **Verdict:**
  - **Real:** the shape of the executors, the switch reads, the bindings query, the stop-done/hibernate verdict, and the feed writes.
  - **Legitimately different:** each retire reason's **evidence**, the PR ledger for a spent child, the 7-day epoch, witnesses for a temp root. These stay as per-reason policy rows and are not merged.
  - **Legitimately different:** the dead-coordinator lane acts on runs, so it moves to C5's decider set and shares only `SessionReading` and the funnel.
  - The viewer rule becomes **one per transition**: sleep defers on `open`, retire defers on `visible` with one bounded ceiling. The operator confirms it (§6 O6), because expiry's unbounded deferral is a behaviour change.

### K2. A workspace's end of life, ccd side → one `_ws_retire` skeleton with per-reason policy tables

- **One owner:**
  - `_ws_retire <reason> <id> [--token …]`, which runs one skeleton: eval → fork/contained → audit token → lock (the existing `.reap-<id>.lock`) → **re-eval inside the lock** → tail (unsupervise, attic pin, tmproot removal, `_reg_purge`, tombstone, journal);
  - the verbs `ws-reap`, `ws-reclaim`, `ws-expire` and `ws-collect` stay as **public names** that call it, because the server composes them through `CCD_ARGV`;
  - `ws-rm`, `ws-gc --prune` and `forget` call the same tail through `_reg_retire`.
- **Deleted:** four copies of the eval/resume_eval/fork/fork_contained/audit/locked/tail family; byte-identical refusal helpers such as `_reap_refuse` (≈:11956) and `_ws_collect_refuse` (≈:35264); ws-reap's stale header line "the ONLY destructive verb".
- **Consumers move:** none on the server. The argv and the JSON envelopes stay byte-compatible, and ARCH-14's refusal-v1 token is introduced in the same series.
- **Overlap:** about 10k lines in four regions [M]. 7 `_reg_purge` lines and 9 `_ws_unsupervise` lines [M]. The two `ws-reclaim`/`ws-expire` regions already share `_ws_reclaim_ladder`/`_ws_reclaim_tail`, so the pattern is proven in place.
- **Verdict:**
  - **Real:** the skeleton and the refusal helpers.
  - **Legitimately different and kept:** the **act-time re-evaluation inside the lock**. ws-audit mints a token, and the destroyer recomputes the verdict inside the lock. The decider runs twice by design, as a TOCTOU guard. It is not a decide-twice smell, and the skeleton makes it structural instead of per-verb.
  - **Kept:** each reason's evidence (`.child` + `--child-of`, archive epoch, witnesses, merged PR state).

### K3. "Is it alive" → one `SessionReading`, computed once per tick and shipped on the wire

- **One owner:** C1's `readSession(facts)` in L1, fed by the tick's one registry listing, one tmux verdict per session, one status-file read and the lifecycle mirror. The fleet frame carries the result, with two new wire fields:
  - `presence: 'alive' | 'asleep' | 'dead' | 'unknown'` replaces the PWA's `coordPresence`;
  - `deadSince` is set only when lifecycle is in `LIFECYCLE_DEAD`.
- **Deleted:**
  - `liveStatus` (`fleet.ts` ≈:381);
  - `SessionStream.resolve`'s mirrored ladder (`sessionws.ts` ≈:724–770);
  - `turnverdict.liveRowFor`'s one-row `assembleFleet`;
  - `commands.ts` ≈:56 and `coord/routes.ts` ≈:4297 raw reads;
  - `claimProbe`'s `status === 'dead'` reading;
  - `measureClaimant`'s private ladder, which becomes a policy over `SessionReading` (hibernated counts as alive, as today);
  - PWA `coordPresence` and the 13 inline `status === 'dead'` checks.
- **Consumers move:**
  - fleet assembly, sessionws, turnverdict (at-act re-read becomes `readSession` on one row), claims, the reclaim door, the dead-coordinator lane and the stall lane;
  - PWA `orphanWords`, `RunRow`, `SessionScreen`, `SessionActionsSheet`, `startProgramPolicy`, `ArchiveAllPlane`, `AccountsScreen`, `groupFleet` and `spawnWords` read `session.presence`.
- **Overlap:** 18 liveness predicates across three layers [M]. "Hibernated is not dead" is coded separately in `coordPresence` and `measureClaimant`.
- **Verdict:**
  - **Real** for every server and PWA reader.
  - **Legitimately different:** ccd's `_session_probe` is the OS edge and must work without the server. It stays, and `_session_state` stays its pinned twin (`ccd-session-lifecycle` test). Viewer presence (`presence.ts`) is a **different fact under the same word**. It is renamed `viewer` in TS so the collision with "presence" ends, and its meaning does not change.

### K4. "Is it idle" → one `TurnReading` with per-caller safety direction

- **One owner:** the `turn` part of `SessionReading`: `busy | idle | shell | unknown`, plus `why`, from the status file first and the pane second. Each consumer applies a **named policy** to it:
  - `mail-gate`: hold unless `idle`;
  - `keystroke`: refuse unless `idle`, and treat `unknown` as busy;
  - `sleep`: require `idle` for N hours;
  - `stall`: an `unknown` that persists is the signal.
- In ccd, `_ws_status`, `_idle_for_keystroke` and `_swap_idle_gate` collapse onto one `_turn_reading` that returns the same four words. Each caller keeps its own policy line, and the ARCH-24 corpus holds every column.
- **Deleted:** the server's `turnidle.ts` and `turnverdict.ts` duplicate reads (their policies stay); the busy-to-idle edge in `finished.ts`, which reads the tick's previous `TurnReading`; and two of ccd's three predicates' bodies.
- **Overlap:** 5 ccd and 6 server idle deciders.
- **Verdict:**
  - **Real** for the reading.
  - **Legitimately different** for the policies, and on purpose. ccd's unanchored `esc to interrupt` makes false-busy the safe error where the act is "type a key". TS anchored `BUSY_RE` because a false busy held mail. ARCH-24's per-caller columns **record** that divergence; this wave does not erase it.
  - `_swap_idle_gate` keeps its exact behaviour. It sits on the auto-swap path, which is never blocked (§7).

### K5. Operator questions → one OperatorQuestion module and one answer door family

- **One owner:** `coord/questions.ts`:
  - one hold rule (today's `heldFor.ts`, coordinator-first's ruling);
  - one lapse/release/late-answer/retention sweep (`sweepQuestions`), replacing `sweepAsks` and `sweepApprovals`. Today ask retention is pruned inside `sweepApprovals` (`pruneAskQuestions`);
  - one answer door family `POST /api/questions/:id/{answer,release}`, which carries `kind`.
- The PWA gets one answer reducer (ARCH-29), shared by `DialogSheet`, `EnvelopeSheet` and `push-sw.js`'s notification answer.
- `askLive.ts`'s pairing of a hook envelope with a scraped dialog moves server-side: the server ships one question.
- **Deleted:** `watch.ts`'s in-memory `heldAsks` map and the approvals `dialogIds` map, which become rows in the module's own table view; five of the six answer doors, kept as thin redirects for one release and then removed; and the client-side pairing.
- **Consumers move:** watch's `detectDialogs` hands a parsed dialog to `questions.raise`; the hook's `POST /api/approvals` becomes `questions.raise({kind:'approval'})`; routes, digest and push read questions.
- **Overlap:** 8 routes out, 6+ doors in, 3 PWA answer paths, 2 in-memory maps.
- **Verdict:**
  - **Real** for routing, hold, retention and doors.
  - **Legitimately different:** an **approval's signed ruling** (Ed25519, nonce, digest; `approval-verify.mjs`), which the child's hook verifies. That stays its own path, unchanged; the module only stores and routes the question.
  - **Legitimately different:** a scraped dialog with no hook envelope is answered by keystrokes and a hook ask by a file. That is the `kind`'s adapter, not a second route.
  - Two tables or one is §6 O5.

### K6. "Tell the operator" → one `notify(event)` funnel and one read model

- **One owner:** `notify()`, which grows out of `pushOne` (`watch.ts` ≈:3106). It owns the presence gate, the ring record, the `feed_events` write and the push, in one order. Writers outside `watch.ts` get it through a narrow port.
- `GET /api/notifications/catchup` reads the same source as `GET /api/feed`: the ring becomes a cache of `feed_events`, not a second store.
- **Deleted:** 16 hand-rolled `log.record(…); coord.recordFeedEvent(…)` pairs [M]; `pushRelease`'s direct `sender.notify`; and the use of `hasFeedEvent`/`hasMailWithSubject` as idempotency keys. Each lane that needs once-only gets a `dedupeKey` column on the notice, which ends a SEAM overload.
- **Overlap:** 16 writers, 2 read routes, and 2 sources of "run" feed rows (the `pushNewRuns` watermark and the executors).
- **Verdict:** **real duplication**, with no legitimately different part. The one ordering subtlety (ring, then db, then flush) moves into the funnel once.

### K7. Redaction → `shared/redact.mjs` with profiles

- **One owner:** one rule table (URL userinfo, `?token=`, `gh*_`, `sk-`, Authorization headers, secret assignments, program flags) and four **profiles** that choose a mask word and rule subset: `egress` (`[REDACTED]`), `docs` (`***`), `history-index` (`[redacted]`) and `log-line` (userinfo removed, `$HOME` → `~`).
- **Deleted:**
  - the TS `redactDocsText` body, which re-exports;
  - ccd's python `REDACT_RULES` (≈:37219–37275), which call `node redact.mjs --profile docs` once per docs verb;
  - `coord/redact.ts`'s rule regexes (its egress helpers stay as callers);
  - the duplicate rule regexes in `ccd/history/lib.mjs` (its pair-index/belt machinery stays: that is indexing, not masking);
  - `_upd_redact`/`redact()`, which become one bash function in the platform block both scripts already share byte-for-byte.
- **Overlap:** 5 implementations, 3 mask words, the userinfo rule ×4. `docs-parity` exists only for the redact twin.
- **Verdict:**
  - **Real** for the rules.
  - **Legitimately different** for the mask words. Docs, history and egress each have readers who rely on their word, so they become profiles, not one word.
  - `pwa typedFrame.sanitizeTyped` strips control characters. It is **not redaction** and stays out.
  - The bash `log-line` profile stays bash, because `say` runs per line and a node exec per line costs about 0.05 s. It is held to the same fixture rows by a test.
  - Redaction moves to **ingest where possible.** `coord/store.ts` already redacts at write (≈:5633/5682), and egress re-redaction stays only where the source is not the store.

### K8. Claude Code pane grammar → one module and one corpus with per-caller verdicts (extends ARCH-24)

- **One owner:** `server/src/pane/` exports the SGR stripper, the prompt glyph, the busy row, menu rows (with `shared/ask-menu.ts`) and the statusline. A ccd grammar file (the bash functions `_pane_*`, gathered in one region with no logic change) is held to the corpus columns. The PWA receives **parsed** facts: a compaction event kind, a prompt-showing flag and dialog rows. It does not re-parse pane text for decisions.
- **Deleted:**
  - four of the five SGR declarations (`watch.ts` ≈:214, `sessionws.ts` ≈:27, `inject/send.ts` ≈:129, `transcript/parse.ts` ≈:58);
  - three `hasMenu(strip)?parseDialog:null` guard copies;
  - `send.ts`'s three `startsWith('❯')`;
  - PWA `askLive` `WRAP_BAR_RE`/`titleMatches` (moved server-side with K5), `MessageBubble` `COMPACTION_RE` (replaced by the transcript's event kind) and `drawerView.showsPrompt` (replaced by the wire flag).
- **Overlap:** 3 grammars, SGR ×5 [M], 15 ccd busy lines.
- **Verdict:**
  - **Real** for detection.
  - **Legitimately different and kept:** `wrapScreen`'s box-character sets in the PWA. They lay out the terminal drawer, which is rendering, not parsing for a decision.
  - **Kept, recorded:** ccd's busy greps, per K4.

### K9. Transcript readers → one TS reader, and one jq library for ccd and the doctor

- **One owner:** in TS, `transcript/` as today. For bash, `ccd/lib/transcript.jq`, a jq library file holding `def prompt`, continuation and limit-banner. It is loaded with `jq -L` by `ccd` and `ccrc-doctor-checks`. `compact-card.mjs` reads a different rule (the `compact_boundary` row) and is out of scope. Transcript path resolution happens once in ccd (`_transcript_path`) and once in TS (`resolve.ts`).
- **Deleted:** the verbatim `def prompt` copy (`ccrc-doctor-checks` ≈:4032), `_ci_transcript_path` (≈:16243), the duplicate in `_transcript_matches` (≈:25095), and the python `_transcript_last_turn_ts` (≈:23685–23737), which becomes a jq call against the library.
- **Overlap:** 5 readers and 4 resolvers. Two parity pins (`continued-in-parity`, `continued-in-successor-parity`) cover three readers today and will cover two after.
- **Verdict:**
  - **Real** inside bash (three copies become one).
  - **Legitimately different** across languages: TS and jq stay, held by the pins, because ccd must read transcripts on the swap and carry path without the server. A node call per carry is affordable (carry is not per tick), but the continuation rule is also read on the tick by `_sync_uuid`, so it stays jq (§5.12).
  - #435 (continuity 4b) edits these readers, so this cluster waits for it.

### K10. Run↔session binding → one `RunBinding` keyed on the worker's incarnation

- **One owner:** C5's `bindingOf(sessionId, generation)` in L1 over the store, and the wire field `FleetSession.run` (the current run summary id, or `null`) computed once by the server. The coordinator side is `childrenOf(coordinatorId)`. `Incarnation` is the one new branded value (§2.5): session id plus registry generation, so a recycled id cannot inherit a closed run.
- **Deleted:**
  - PWA `runForSession`'s matching loop, `PrSheet.tsx:118`'s first-open rule, `ArchiveSheet:134`'s claimedBy filter, the `RunsScreen` ≈:129/254 lookups and the client-accumulated `childRunsSeen` (`useColdRuns` ≈:175). All read `session.run` and `run.childIds`;
  - command palette `fleetOrder`'s inline re-composition (`commands.ts` ≈:31–40), which calls `fleetTree`;
  - on the server, the ~50 equality sites route through `bindingOf`/`childrenOf` over a series. The store's twelve near-duplicate readers (`resolveCoordinator`, `resolveWorker`, `parentOfSession`, `openClaimantsOf`, `openRunsForSession`, `runsNamingSession`, `lastRunBySession` …) shrink to the two plus the queries that are genuinely different (open-only vs any, last-closed).
- **Overlap:** 2 PWA rules that disagree [M]; ~50 server sites; CCRCP-198.
- **Verdict:**
  - **Real.**
  - **Legitimately different and kept:** ccd's `.child` marker, as a projection with one writer, because ccd's reclaim verifies it under its lock offline.
  - The coordinator↔child durability investigation decides the binding's durability. This cluster fixes only the key and the writer, and **waits for** that investigation and for #397 (path identity's id gate).

### K11. Scheduling → one `LANE_SCHEDULE` table and `runLane` helper; timers stay systemd

- **One owner:**
  - In `watch.ts`, one table row per lane (cadence, clock `monotonic` for every lane, single-flight, warn-once key) and `runLane(name, fn)`, which owns throttle, single-flight, catch and warn-once.
  - On the box, the systemd `.timer` files are the one source. `ccrc`'s launchd plists are **generated** from them at install, and `ccrc-doctor-checks` reads the cadence from the unit file instead of restating it.
- **Deleted:** 24 `last*` fields and 12 flags [M]; the aliasing `STALL_SWEEP_MS = CLAIM_SWEEP_MS`, `COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS` and `DELEGATION_SWEEP_MS = DIVERGENCE_SWEEP_MS`; the wall-clock gate in expiry and dead-coordinator for a constant that child reclaim gates on monotonic time; the doctor's restated cadences (the `ccrc-doctor.test` pin goes away).
- **Overlap:** two clocks for one constant, three aliases, 14 timers in 2–3 places each.
- **Verdict:**
  - **Real** inside each process.
  - **Legitimately different:** server lanes and systemd timers run on different hosts and in different processes. One scheduler for both would put the box's OS edge behind the server, which is exactly what auto-swap and the timers must not depend on. Usage scanning on both sides (`USAGE_SWEEP_MS` reads sidecars; `ccd-usage-sweep` writes them) is reader and writer, not duplication.

### K12. Switches → one `SWITCHES` table and one reader per tick

- **One owner:** L0 `SWITCHES`. Each row has a name, its storage (a marker path, or a settings table and column), a default, the owning context, the operator meaning and the route that writes it. `readSwitches()` reads the tick's one registry listing, and executors receive the snapshot. They do not re-read.
- **Deleted:** 12 files' `reclaim-paused` parsing; the duplicate `MAIL_DISABLED_MARKER` (`rundefs.ts` ≈:50, `watch.ts` ≈:678); `collect-lane-live` (legacy, ignored); the mail lane's mode lookup through `stallResolveNow`. The three opt-outs `no-hibernate`, `hold` and coordinator-paused become three rows with distinct meanings. They are not merged, because each means something different: `no-hibernate` is one session's opt-out of sleep, `hold` is a workspace declared mid-programme (it blocks sleep and retire), and coordinator-paused is a fleet-wide pause of coordination lanes.
- **Overlap:** ~15 markers plus 3 tables, read per sweep.
- **Verdict:**
  - **Real** for the readers.
  - **Legitimately different:** storage. A marker file is what ccd and the hook can read with the server down, while a db settings row carries the operator's audit trail. Both stay as storage, with one table describing them.

### K13. Fleet read model → one registry listing per tick, and sessionws subscribes

- **One owner:** the tick's `FleetReadModel`, one object that replaces `assembleFleet`'s ~12 positional caches. `GET /api/fleet`, `/ws/fleet` and every lane read it. `SessionStream` keeps the transcript tail it owns and **subscribes** to the watcher's per-session dialog, hookstate, tasks, workflows and mail frames instead of polling them every 2 s per socket.
- **Deleted:**
  - the re-listings in `sweepHookStates`, `sweepTasks`, `sweepNames`, `sweepMail`, `sweepPr` and `detectDialogs`;
  - `SessionStream`'s `checkDialog`/`checkTasks`/`checkHookAsk`/`checkMail` polls;
  - the double dialog frame (`watch.ts` ≈:8355/8469 over the bus and `sessionws.ts` `frame()`);
  - the 4th tasks reader.
- **Overlap:** up to 7 listings per tick, 2 pollers per open session.
- **Verdict:** **real.** Latency is unchanged: tick and socket poll are both 2 s. The bus already carries `session:<id>` frames.

### K14. PWA: one owner per server fact (extends the PWA epic)

- **One owner per fact:**
  - accounts: the fleet store's one poll (ARCH-28);
  - one `usePoll` and one wire-guard kit (ARCH-30);
  - feed: the store's read (MailScreen subscribes);
  - closed runs: one `useColdRuns` (MailScreen subscribes);
  - projects: `store.projects`, the one loader, which `NewSessionSheet` and `useProjectList` read;
  - "archived": the wire `bucket`, so `archivedAt !== null` checks go;
  - the bucket order: one `BUCKET_ORDER` in `shared/` (`sortFleet.RANK` and `statusGroups` disagree today);
  - restart/wake: one `useEnsure`;
  - refusal text: tables out of `lib/api.ts` (ARCH-13b);
  - one `sessionPath(id)`;
  - one storage port, replacing 8 wrappers and 2 `StorageLike` types;
  - one visibility/online clock, replacing 14 listeners.
- **Deleted:** 4 of 5 accounts pollers, 3 of 4 poll skeletons, the second feed write, the second runs read, two project loaders, `session/sessionFacts.ts` (dead code with a clashing name) and `formatReset` vs `resetClock` (one survives).
- **Verdict:**
  - **Real.**
  - **Legitimately different:** the per-device `seen` acks (what this device has looked at) vs the notify watermark (what the socket has replayed) vs server viewer presence (push gate). These are three facts, and they get three names.
  - `accountPicker.leastLoaded` is K15.

### K15. Placement → the server's projected home for suggestions; ccd's walk stays

- **One owner:** for *suggestions*, `limits.ts projectHome` (the PWA's `leastLoaded` is deleted, so the "+" and the pickers agree). For *acts*, ccd's `_ws_least_loaded`/`_swap_target` remain.
- **Verdict:**
  - **Real** in the PWA.
  - **Legitimately different** in ccd. Auto-swap and `ws-add` must place with the server down, and the operator ruled that account switching is never blocked. The ccd/TS twin stays, pinned by `projected-home.test`; `_share_pct`/`shares.ts` and `_serviceable`/`serviceability.ts` stay pinned as well. The three ccd placement walks (`_ws_least_loaded`, `_place_for_class`, `_swap_target`/`_rescue_target`) share one scoring function, `_limit_score`, and keep their own candidate filters.

### K16. Account and box markers with two writers → one primitive each

- **One owner:**
  - `_authdead_mark`/`_authdead_clear` (C1);
  - `<w>-disabled` written only by `ccrc account`, as a projection of the roster;
  - usage sidecars deleted only by `_usage_purge` (`ccd-usage-sweep --reap-orphans` calls it);
  - `FleetState.ccdVerbs` written by `onReady`, with `refreshCaps` asking through the same setter and its epoch guard;
  - pane scopes: `_panescope_record` records, `ccd-cap-scopes` caps, and `ccd-scope-sweep` stops. These are three acts on one fact, and they share one reader of `$REG/<id>.panescope`.
- **Verdict:**
  - **Real** for the writers.
  - **Legitimately different:** the two 60 s pane-scope timers. Capping and stopping are different acts with different failure costs, so merging their units would couple a cap failure to a stop. They share the reader only.

### K17. Journals and spawns → shared helpers where the shape is the same

- **Journal-to-db mirrors.**
  - The lifecycle mirror (`mirror.ts`/`mirrorplan.ts`/`journalparse.ts`) and the collect-lane generation journal share one cursor, gap and generation helper.
  - The **delegation journal stays separate.** It is the hash-chained authority, and coord.db is its projection, the reverse direction from the lifecycle mirror. **Legitimately different.**
  - The log-first-then-db idiom of `ledgerlog`, `pooledgelog` and `updateintentlog` gets one `appendThenApply` helper.
- **Process spawn.** Four server spawns (`exec.ts`, `localcaps.ts`, `update/spawn.ts`, `accounts/ops.ts`) collapse onto `exec.ts`'s runner with options. The agent's `makeUpdateSpawn` twin moves into a `shared/spawn.mjs` that both packages import, and `update-spawn-twin-bodies` goes away. **Real.**

### K18. Compaction lock and generation in the hook → one implementation that both scripts source

- **One owner:** the lock and generation helpers get one source region. Today `ccd` and `ccrc` carry the platform block byte-identically (`macos-platform.test`), while `session-hook.sh` keeps deliberate *local copies* (its header ≈:38 says so). The wave makes the hook's copy **generated** from ccd's region by a committed codegen script, with a test that fails when the committed copy differs, instead of hand-kept. The generated text is committed, so the launcher bytes stay what ships; build-time assembly stays deferred until ARCH-34's manifest, as its own `not_doing` says. The hook's `_hook_lock_*` (≈:1113–1398) and its "twinned literal" wait bound go.
- The `CCRC_PROJ_CLASS`/`MAX` and `ID_MAX` constants, which today are spelled in three files with a comment saying "widen the other two by hand", become one block in the same shared region.
- **Verdict:** **real.** It is still a byte-copy and not a `source`, because ARCH-02b's proposed rule rejects runtime-sourced siblings. The copy is generated and pinned, not hand-kept.

### 3.19 What the catalogue does not collapse, and why

| Looks duplicated | Why it stays |
|---|---|
| ccd re-deciding inside the lock | TOCTOU guard; the token is minted from one state and the act must see the current one (K2) |
| ccd busy greps vs `BUSY_RE` | opposite safety directions, recorded per caller (K4, ARCH-24) |
| ccd placement vs server projection | offline safety; auto-swap is never blocked (K15) |
| `_session_probe` vs `SessionReading` | OS edge vs read model (K3) |
| marker files vs settings rows | readable with the server down vs audited (K12) |
| systemd timers vs server lanes | different hosts and processes (K11) |
| delegation journal vs lifecycle mirror | authority vs projection (K17) |
| egress vs docs vs history mask words | each word has readers (K7) |
| path leases vs run claims | different aggregates; renamed, not merged (C5) |
| programme reclaim door vs child reclaim | transfer of ownership vs removal of a workspace; the TS word for the second becomes "retire" while ccd's `ws-reclaim` verb keeps its public name |
| approval signing vs question routing | security boundary (K5) |

## 4. Mapping onto the remediation programme

### 4.1 What happens to each existing ARCH ticket

The programme's 36 tickets: one is done (ARCH-11a), and 35 are in backlog. The wave **cancels none of them**.

| Fate | Tickets | Meaning |
|---|---|---|
| **Prerequisite** (lands before the wave that needs it, unchanged) | ARCH-00 (parser), ARCH-01 (god-file growth vs merge-base), ARCH-02a (spec v2: contexts 7–9, timer rule, PWA rings), ARCH-02b (the ruling, §6 O4/O9), ARCH-03 (consumer-side ports), ARCH-04 stage 1–2 (ring scanner), ARCH-06 (symbol-keyed pins: every cluster moves code that literal pins read), ARCH-08b (`readdirMeasured`), ARCH-10 (runner says whether ccd ran: the retire executor must tell transport failure from refusal), ARCH-23 (ccd harness integrity: K2 needs honest stubs), ARCH-34 (ccd function-to-context manifest: K2/K18 need the map) | 11 |
| **Absorbed** (becomes the first ticket of a cluster, scope unchanged) | ARCH-36 → K1 (the archive decider is C4's first decider); ARCH-35 → K1 (`decideClose` queues the retire); ARCH-25 → K2 (the reaping breadcrumb is the skeleton's tombstone grammar); ARCH-14 → K2 (refusal-v1 lands with the skeleton); ARCH-09 → K13 (mail ingress reads the registry once); ARCH-19 → K5 (mail policy into `coord/` before questions move); ARCH-13a → K5; ARCH-26 → K9 (jq held to TS by set equality, the same shape); ARCH-28 → K14; ARCH-30 → K14; ARCH-13b → K14 | 11 |
| **Re-scoped** (grows; the original acceptance criteria stay and more are added) | **ARCH-24** → K8: the corpus also owns the module exports (one SGR stripper, one prompt glyph) and the PWA's move to parsed facts. **ARCH-29** → K5: the reducer serves all three answer paths, including `push-sw.js`, and the server-side pairing | 2 |
| **Independent** (no cluster depends on it; it proceeds on its own schedule) | ARCH-05, ARCH-07, ARCH-08, ARCH-11b, ARCH-12, ARCH-15, ARCH-16, ARCH-20, ARCH-21, ARCH-22, ARCH-33 | 11 |

**Housekeeping found while mapping.**
- ARCH-21 (CCRCP-120) is still Backlog in Linear, but its deliverable landed as `openRunPreconditions` (CCRCP-138, done; the coordinator-first plan's D-5384). It should be closed against that PR.
- ARCH-17, -18, -27, -31 and -32 do not exist in the project. The numbering has gaps, and nothing is missing.

### 4.2 New epics and tickets

There are six new epics in the same Linear project. Tickets continue the ARCH numbering from ARCH-40, and each is one reviewable PR or a short series. The sizes are first estimates: XS < 100 changed lines, S < 300, M < 800, L > 800.

| Epic | Ticket | Cluster | Size |
|---|---|---|---|
| **ENF** (existing) | ARCH-40 `writers` pin: one test file lists each §2.2 fact's writer set, from AST plus the ccd manifest; the sets may only shrink | all | M |
| **LIFE** Workspace lifecycle | ARCH-41 `WORKSPACE_TRANSITIONS` in L0 with a derived list and `is*` guard (characterization first: today's verbs' refusals as rows) | K1 | S |
| | ARCH-42 `bindingsOf(sessionId)` store query; the nine readers move one per commit | K1/C5 | M |
| | ARCH-43 `decideSleep` + `sleepExecutor`; stop-done becomes the `run-done` policy (after hibernation's Task 19) | K1 | M |
| | ARCH-44 `decideRetire` + `retireExecutor`; reasons migrate one PR each: `temp-orphan`, then `archive-expired`, then `child-spent` | K1 | L (3 PRs) |
| | ARCH-45 ccd `_ws_retire` skeleton; verbs migrate one PR each in the order collect, expire, reclaim, reap | K2 | L (4 PRs) |
| | ARCH-46 `_reg_retire` for `ws-rm`, `ws-gc --prune`, `forget` | K2 | S |
| **LIVE** One reading of a session | ARCH-47 `readSession` + `SessionReading` in L1; truth-table characterization over today's 7 server ladders | K3 | M |
| | ARCH-48 wire `presence`/`deadSince`; server readers move (`liveStatus`, `resolve`, `liveRowFor`, `claimProbe`, `measureClaimant`) | K3 | M |
| | ARCH-49 PWA reads `presence`; `coordPresence` and 13 inline checks go (after skins W3) | K3 | S |
| | ARCH-50 `TurnReading` + named policies (server); ccd `_turn_reading` (after tick-diet budget fixtures) | K4 | M + M |
| | ARCH-51 `FleetReadModel` + one registry listing per tick | K13 | M |
| | ARCH-52 `SessionStream` subscribes; its four polls go | K13 | M |
| | ARCH-53 rename viewer presence (`presence.ts` → `viewer`) in TS | K3 | XS |
| **ATTN** Attention routing | ARCH-54 `notify()` funnel; the 16 pairs migrate one file per commit | K6 | M |
| | ARCH-55 `dedupeKey` on notices; `hasFeedEvent`/`hasMailWithSubject` stop being idempotency stores | K6 | S |
| | ARCH-56 `coord/questions.ts`: one hold/lapse/retention sweep over both tables | K5 | L |
| | ARCH-57 answer door family + one-release redirects; the PWA reducer (ARCH-29 re-scoped) | K5 | M |
| | ARCH-58 envelope↔dialog pairing server-side; `askLive` pairing goes | K5 | M |
| | ARCH-59 `notify.sh` banner becomes a funnel notice | K5/K6 | S |
| **BIND** Run binding | ARCH-60 `Incarnation` value + `bindingOf`/`childrenOf` (after the durability investigation and #397) | K10 | M |
| | ARCH-61 wire `session.run`, `run.childIds`; PWA matchers and `childRunsSeen` go; `fleetOrder` calls `fleetTree` | K10 | M |
| | ARCH-62 server's ~50 equality sites → `bindingOf`, one file per commit; the store's twelve readers shrink | K10 | L |
| **GRAM** Claude Code grammar | ARCH-63 one SGR stripper / prompt glyph / guard export; 4 declarations and 3 guard copies go (ARCH-24 re-scoped carries the corpus) | K8 | S |
| | ARCH-64 PWA receives parsed facts (compaction kind, prompt flag); `COMPACTION_RE`, `showsPrompt` go | K8 | M |
| | ARCH-65 `ccd/lib/transcript.jq`; the doctor copy, `_ci_transcript_path` and the python reader go (after #435) | K9 | M |
| **KERNEL** Shared kernels | ARCH-66 `shared/redact.mjs` + profiles; TS callers move | K7 | M |
| | ARCH-67 ccd docs python redactor → `node redact.mjs`; one bash `log-line` function | K7 | S |
| | ARCH-68 `LANE_SCHEDULE` + `runLane`; aliases end, every lane on the monotonic clock | K11 | M |
| | ARCH-69 launchd plists generated from the `.timer` files; the doctor reads unit files | K11 | M |
| | ARCH-70 `SWITCHES` + `readSwitches`; executors receive the snapshot | K12 | M |
| | ARCH-71 `ccdCan(row)` with a `default` column in `CCD_ARGV` (SEAM overload) | K12 | M |
| | ARCH-72 single writer primitives: auth-dead, disabled, usage sidecars, `ccdVerbs` | K16 | M |
| | ARCH-73 journal cursor helper + `appendThenApply`; `shared/spawn.mjs` | K17 | M |
| | ARCH-74 hook lock/generation region generated from ccd's (codegen + check) | K18 | S |
| **PWA** (existing) | ARCH-75 `BUCKET_ORDER` in `shared/`; "archived" by bucket; `useEnsure`; `sessionPath`; storage port; visibility clock; feed/runs/projects single readers; `leastLoaded` goes (K15) | K14/K15 | L (5 PRs) |

That is 36 new tickets (ARCH-40 to ARCH-75) in six new epics plus two existing ones.

## 5. Migration: strangler waves

### 5.1 Rules every wave follows

1. **Characterization first.**
   - A series' first commit adds a test that is green on `main` against the **old** code. The test pins inputs to outputs: verdicts, refusal words and statuses, composed `CcdArgv`, feed rows, wire frames.
   - The test records one mutant: deleting or reordering a guard turns it red, which is 08-10's mutant duty.
   - The move commits that follow change the test only in its imports. They can do that because ARCH-06's symbol-keyed pins replace literal source-text pins.
   - A move commit that edits a characterization assertion is refused in review.
2. **Strangler order.** The new owner lands beside the old one. Consumers move one per commit, and the old owner is deleted last, in its own commit. During a wave, wire changes are **additive**. A field or door that goes away is removed one release after its last reader moves, because server, agent and PWA deploy independently.
3. **Measured exit.** Each wave's exit criteria are counts held by ratchets that may only shrink:
   - ARCH-01's growth check against the merge-base;
   - ARCH-40's writer sets;
   - a census row per counted smell (feed pairs, switch readers, `last*` fields, pollers, parity pins, PWA match sites).
   
   A wave is done when its counts are met **and** its old owner is gone.
4. **Rollback is a revert.** No wave needs a data migration that cannot be reversed. The one schema change, the `dedupeKey` column (W1), is additive: a revert leaves an unused column. ccd changes roll back through `ccrc rollback` to the previous release.
5. **Deploys.**
   - Agent-first, from a fresh `origin/main` worktree, as the operator's runbook says.
   - No wave requires a supervisor restart or a roll of its own. ccd changes ride the next ordinary release, so **no wave adds a herd restart**.
   - The existing `try-restart claude-session@*` sweep in `ccrc update` is a separate, known herd risk. It is not in this wave's scope; §7 names it.
6. **One `watch.ts` series at a time.** Rebases go through the landing queue (`gh pr merge --match-head-commit`). A wave series yields to any in-flight programme PR that edits the same lane.
7. **Routing.**
   - Characterization tests and literal moves (one consumer per commit) are band 1–2 `/handoff` material.
   - Deciders, the ccd skeleton and anything on the swap, approval or destructive path are band 3: native, with the orchestrator reviewing every diff.

### 5.2 W0: pins and prerequisites (docs and tests only)

- **Tickets:** ARCH-00, -01, -02a, -02b (ruling), -04 stages 1–2, -06, -23, -34, -40. Plus three characterization corpora:
  - the pane corpus (ARCH-24);
  - a liveness truth table over today's seven server ladders (the first commit of ARCH-47);
  - a retire-verdict table that runs each of ccd's four evals over fixture registries through the source seam the ccd tests already use.
- **Exit:**
  - every pin is green on `main`;
  - the growth check is active for `ccd/ccd`, `ccd/ccrc`, `watch.ts`, `coord/store.ts`, `coord/routes.ts`, `server.ts`, `sessionws.ts` and `pwa/src/lib/api.ts`;
  - the manifest maps all 644 ccd functions;
  - zero production bytes change, and the ccd launcher SHA-256 is unchanged.
- **Waits for:** nothing. ARCH-02a's CLAUDE.md edit rides #434 if that PR is still open.

### 5.3 W1: server funnels (K6, K12, K11, K13's listing, K7's TS half)

- **Tickets:** ARCH-54, -55, -70, -71, -68, -51, -09, -66.
- **Exit:**
  - `recordFeedEvent` callers outside the store: 16 → 1 (the funnel);
  - files that parse `reclaim-paused`: 12 → 1;
  - `watch.ts` `last*` fields: 24 → 0 (one `LANE_SCHEDULE`);
  - aliased cadence constants: 3 → 0;
  - registry listings per tick: ≤ 1, counted by an instrumented fake FleetIO;
  - `MAIL_DISABLED_MARKER` definitions: 2 → 1;
  - TS redactors: 3 → 1 module with profiles;
  - `watch.ts` shrinks; the target is at least 800 lines out [I], and the measured number is recorded at exit.
- **Waits for:**
  - any open PR that edits the same lane in `watch.ts` (coordinator-first server tasks, CB W1 observe's server half);
  - the commits that touch `stopDoneSweep.ts`/`hibernateSweep.ts` (their feed write and switch read) wait until hibernation Task 19's shadow week has ended, so the shadow measurement runs on unchanged code.
- **Never blocks:** the PWA chains, because W1 touches no `pwa/` file.

### 5.4 W2: one reading of a session (K3, K4 server half, K13)

- **Tickets:** ARCH-47, -48, -50 (server), -52, -53.
- **Exit:**
  - server status-derivation ladders: 7 → 1 (`readSession`);
  - `SessionStream` polls: 4 → 0;
  - dialog frames per change per socket: 2 → 1;
  - `sessionws.ts` loses at least 300 lines [I];
  - the "MIRRORED" comment is gone, replaced by the truth-table test;
  - idle decisions: 6 readers → 1 reading plus 4 named policies.
- **Waits for:** W1 (the one listing, `runLane`); #397, because `readSession` consumes the server's id gate.
- **PWA half:** ARCH-49 moves to W7.

### 5.5 W3: attention routing (K5)

- **Tickets:** ARCH-19 and ARCH-13a first, then ARCH-56, -57, -58, -59.
- **Exit:**
  - answer doors: 6 → 1 family, plus redirects for one release, then 0;
  - in-memory question maps: 2 → 0;
  - retention sweeps: 2 → 1;
  - PWA answer paths: 3 → 1 reducer;
  - `askLive` pairing: client → server;
  - the approval signing bytes are unchanged. A pin holds `approval-verify.mjs`'s SHA and a signed-ruling fixture.
- **Waits for:**
  - coordinator-first's remaining approval and ask tasks (it is live, so the wave must not move its tables mid-rollout);
  - ARCH-15 (the guarded delivery writer);
  - W1's funnel.

### 5.6 W4: workspace lifecycle, server (K1)

- **Tickets:** ARCH-36, -35, -41, -42, then -43 (sleep), then -44's three reasons, one PR each.
- **Exit:**
  - end-of-life lanes: 6 → 2 deciders + 2 executors, with the dead-coordinator lane in C5's set;
  - their 12 files and 10,750 lines → at most 7 files and 7,000 lines (target [I]; measured at exit);
  - `stopDone.ts` deleted;
  - feed writers in the executors: 0 (funnel only);
  - "bound by coordination" readers: 9 → 1.
- **Waits for:**
  - hibernation Task 19 (shadow week, then the operator's arming act), because ARCH-43 changes the lane it measures;
  - W1 (switches, funnel) and W2 (`SessionReading`, viewer).
- **Rollback per reason:** the old executor stays until the last reason has moved. The shadow/live markers are unchanged, so the operator can disarm one reason without a deploy.

### 5.7 W5: ccd in place (K2, K9's bash half, K7's bash half, K16, K18, K4's ccd half)

- **Tickets:** ARCH-14, -25, then ARCH-45's four verbs (collect, expire, reclaim, reap), then -46, -65, -67, -72, -74, then -50 (ccd half).
- **Exit:**
  - eval/fork/audit/locked/tail families: 4 → 1 skeleton plus 4 policy tables;
  - the four destructive regions, about 10k lines → at most 6k (target [I]);
  - `_reg_purge` call sites outside `_reg_retire`: 7 → 0;
  - byte-identical refusal-helper pairs: 0;
  - the doctor's `def prompt` copy: 0;
  - continued-in readers: 3 → 2;
  - python redactor: 0;
  - auth-dead writers: 3 → 1 primitive;
  - the hook's hand-kept lock copy becomes a generated copy, pinned;
  - the server's inject suites, run against a fixture ccd, pass unchanged. That proves argv and envelope compatibility.
- **Waits for:**
  - #435 (continuity 4b, which edits `_ci_*`, the transcript readers and pressure reap);
  - path identity W1b (#735);
  - Accounts connect's ccd account-verb tasks (#745 and successors) for ARCH-72's auth-dead and disabled parts;
  - CB W2/W3's ccd roll/install verbs for any shared helper they touch;
  - the tick-diet budget fixtures for ARCH-50's ccd half (any tick-path line).
- **Never touches:** `_auto_swap_check`'s decision logic and `cmd_swap`. Only the auth-dead write call is swapped for the primitive, behaviour-identical and pinned.

### 5.8 W6: run binding (K10)

- **Tickets:** ARCH-60, -61 (server half), -62.
- **Exit:**
  - server equality sites: ~50 → all through `bindingOf`/`childrenOf`, counted by an AST census;
  - the store's twelve binding readers: ≤ 4;
  - a CCRCP-198 fixture (two runs naming one worker; a recycled id) goes red on old code and green on new.
- **Waits for:**
  - the coordinator↔child durability investigation;
  - #397 and path identity W2 (#436);
  - ARCH-22 and ARCH-35, because the binding's writers become deciders first.

### 5.9 W7: PWA, one owner per fact (K14, K15, K3/K8/K10's PWA halves)

- **Tickets:** ARCH-28, -30, -13b, -49, -61 (PWA half), -64, -75.
- **Exit:**
  - `/api/accounts` pollers: 5 → 1;
  - poll skeletons: 4 → 1;
  - `visibilitychange` listeners: 14 → 1;
  - storage wrappers: 8 → 1;
  - inline `status === 'dead'`: 13 → 0;
  - PWA run↔session matchers: 5 → 0;
  - `sessionPath` call sites: inline `/s/${…}` 9 → 0;
  - `lib/api.ts`: 1,377 lines → at most 800 [I];
  - `BUCKET_ORDER` definitions: 2 → 1.
- **Waits for:**
  - the skins W3 screens chain (it edits `app.tsx`, `shell.css`, `FleetScreen`, `SessionHeader`, `fleet.css`), which must be fully merged;
  - the Settings redesign (`SettingsScreen`, `AccountsScreen`);
  - Accounts connect's PWA tasks (`AccountsScreen`, the pickers);
  - W2 and W6, for the wire fields.
- **This is the only wave that edits files in the skins chain, and it starts after the chain lands.**

### 5.10 W8: kernel tail (K11's box half, K17)

- **Tickets:** ARCH-69, -73. These can run in parallel with any wave after W0, because they touch only `ccd/ccrc`'s plist generation, the doctor and isolated helpers.
- **Exit:**
  - restated cadences in the doctor: 14 → 0;
  - spawn implementations: 4 + 1 agent twin → 1 plus `shared/spawn.mjs`;
  - `update-spawn-twin-bodies` removed.
- **Waits for:** CB W2/W3 (they edit `update/spawn.ts`).

### 5.11 Sequencing at a glance

```
W0 pins ─┬─▶ W1 server funnels ─▶ W2 one reading ─┬─▶ W4 workspace lifecycle (after hibernation Task 19)
         │                                         ├─▶ W3 attention (after coordinator-first tasks, ARCH-15)
         │                                         └─▶ W6 binding (after durability investigation, #397, #436)
         ├─▶ W5 ccd in place (after #435, #735, A-task ccd verbs, tick-diet fixtures)
         ├─▶ W8 kernel tail (after CB W2/W3)
         └───────────────────────────────▶ W7 PWA (after skins W3, Settings, Accounts PWA; W2+W6 wire fields)
```

### 5.12 ccd's bash: what stays, what gets a typed boundary, what moves to TS

**What stays bash, and why.**
- **The supervisor loop and every per-tick check:** `_sync_uuid`, `_auto_stale_check`, `_auto_swap_check`, `_auto_compact_check`, `_route_apply_check`.
  - **Cost argued [I]:** node starts in about 0.05 s and spawns in 50–80 ms under load [M]. One node exec per tick per session at 55 sessions every 5 s is about 11 execs/s × 0.05 s ≈ **0.55 core** of start-up alone, before any work.
  - The tick-diet programme is removing forks that cost 3.84–4.10 cores [M], so a per-tick node call would spend its savings. The event-gated observer is the road to less tick work, and this wave does not compete with it.
- **Swap, carry, auto-swap, rescue and strand.** They must work with the server down, and the operator ruled that account switching is never blocked.
- **The registry primitives, the locks, the tombstones, and the tmux/systemd/launchd edges.**
- **The destructive verbs, including their act-time re-check.** They are consolidated *in bash* (K2).
  - **Cost argued:** about 10k lines of incident-hardened code would have to be rewritten. A TS rewrite re-opens every recorded fix and needs a node runtime inside the lock.
  - The skeleton gets the structural win (4 families → 1) at a fraction of the risk, and K2's characterization table makes a later port mechanical if one is ever wanted.

**What gets a typed boundary** (the ACL's outbound half):
- ARCH-14's `refusal-v1` token on every refusal;
- `--json` envelopes whose shapes are declared in `shared/` and decoded by one TS function each. ARCH-23's harness runs ccd's **real** output through that decoder;
- a registry field table (name, writer, reader, format), which ARCH-40's pin checks against the ccd manifest and the hook.

**What moves to a single `.mjs` that bash calls** (the `shared/models.mjs` pattern). This applies only to logic that is off the hot path, pure, and already twinned:
- the docs redaction profile (once per docs verb);
- the pool name/tag/epoch grammar (`ccd-pool-sync`'s 60 s timer and the `project-pool` verb), which removes three-language pins;
- roster exec kinds (`roster-json.mjs` becomes the implementation, with `roster.ts` re-exporting it);
- `base-url`.

The cost of this move:
- node is already required on fleet boxes, because the hook runs `approval-verify.mjs` and `compact-card.mjs` [M];
- 0.05 s per call at verb or 60 s cadence is negligible;
- the new failure mode is "node absent", and the verb must then **refuse loudly**, never fall back to a stale bash copy. ccd's preflight check covers it.

**What does not move:**
- the retire deciders, which stay in ccd at act time (ARCH-02b's proposed rejection of moving them server-side holds);
- the auto-swap decision;
- the continuation reader on the tick.

**Splitting the `ccd/ccd` file** is not in this wave. ARCH-34's manifest comes first, runtime-sourced siblings are proposed for rejection (ARCH-02b), and build-time assembly is a later operator decision.

## 6. Decisions for the operator

Each decision lists its options and marks one **recommended**. Nothing here is decided until the operator rules.

**O1. The scope of the first wave.**
- (a) **W0 + W1: pins, then the server-only funnels.** It has the highest count of duplicates removed per line changed (16 feed pairs, 12 switch parsers, 24 clocks, 7 listings), touches no PWA file and no ccd byte, and needs no in-flight programme to pause. **Recommended.**
- (b) W0 + W4 first, because the workspace end of life is the overlap the operator has felt most. It has to wait for hibernation Task 19 anyway, and without W1's funnel and switches it would build a fifth executor shape first.
- (c) Start every wave whose wait-list is empty, in parallel. This is the fastest calendar, but it puts several series in `watch.ts` at once, against §5.1 rule 6.

**O2. Does ccd logic move to TS?**
- (a) No. Consolidate everything in bash and keep every cross-language twin pinned.
- (b) **Only off-hot-path pure policy that already has a twin** (docs redaction profile, pool grammar, roster exec kinds, base-url) moves to a single `.mjs` that bash executes. Everything on the tick, swap and destructive paths stays bash (§5.12). **Recommended.** It removes about five parity pins at a cost of about 0.05 s per verb call. It also needs the operator to confirm that "a single `.mjs` called from bash" is *not* the "compiling policy across languages" that ARCH-02b proposes to reject.
- (c) Move the retire and placement deciders to the server and keep ccd as a pure actuator. This contradicts ARCH-02b's proposed rejection, would make retire and auto-swap depend on the server being up, and would rewrite about 10k lines of incident-hardened bash. **Not recommended.**

**O3. How much in-flight work pauses?**
- (a) **Nothing pauses.** Every wave waits behind the programmes it would collide with (§5.11), and the only cost is calendar time. **Recommended.**
- (b) Freeze new lanes in `watch.ts` (any PR adding a `last*` field or a feed pair) from the day W1 starts until it ends, so the counts stop growing. This is cheap and could be combined with (a) as an amendment.
- (c) Pause hibernation's arming until W4 lands, so the armed lane is the consolidated one. This delays a measured memory win, so it is not recommended.

**O4. One scheduler, or a scheduler per context?**
- (a) **One `LANE_SCHEDULE` table and `runLane` helper inside `FleetWatcher`**, with the deciders in per-context L1 modules. This keeps 08-10's "no lane interface" and ARCH-02b's proposed re-affirmation. **Recommended.**
- (b) One scheduler class per context (Workspace, Coordination, Attention, …), each owning its lanes. This reads well, but it reopens the rejected lane interface, and ARCH-02b says DECIDE would then be re-planned.
- (c) Leave scheduling as it is and do only the deciders. This leaves the 24 clocks and the aliasing bugs.

**O5. Asks and approvals: one table or two?**
- (a) **One module and one aggregate type over the two existing tables.** No coord.db migration while coordinator-first is live. **Recommended.**
- (b) Merge them into one `questions` table with a `kind` column. This is cleaner, but it needs a data migration and a rollback story for a live feature.
- (c) Leave them as two lanes. This leaves the 6 doors and the retention-in-the-wrong-sweep.

**O6. Stop-done and the viewer rule.**
- (a) **Stop-done becomes the `run-done` policy of one sleep lane, on one clock.** Sleep defers on `viewer: open`, and retire defers on `viewer: visible` with one bounded ceiling for every reason. Today expiry's deferral is unbounded, so this is a behaviour change, and it is called out. **Recommended.**
- (b) Keep two lanes but share one verdict function. This halves the duplication and keeps both clocks.

**O7. Where is "alive / asleep / dead" decided for the PWA?**
- (a) **The server computes it once (`presence` on the wire) and the PWA renders it.** **Recommended.**
- (b) A shared L0 function runs on both sides. This is fewer wire fields, but two processes still decide, and they can drift through deploy skew.

**O8. Where do the tickets live?**
- (a) **Six new epics inside the existing "ccrc architecture remediation" project, numbered from ARCH-40.** **Recommended.**
- (b) A separate "consolidation wave" project linked to it.

**O9. May consolidation PRs land standalone?** The 08-10 spec says increments "each ride queued work, none is a standalone refactor PR".
- (a) **Standalone is allowed for any series whose first commit is a characterization pin and whose exit criteria are counted (§5.1).** Everything else still rides. This extends ARCH-02b's proposed allowance for enforcement-only PRs. **Recommended.**
- (b) Every series rides a feature. This is safer by the old rule, but most clusters have no feature to ride, so the wave would not happen.

**O10. Renames.**
- (a) **Rename in TS words only:** "path claim" → "lease", child "reclaim" → "retire", viewer "presence" → "viewer". ccd verb names (`ws-reclaim` …) keep their public spelling. **Recommended.**
- (b) Rename ccd verbs too, with aliases. This is a churn cost across `CCD_ARGV`, the whitelist and the agent, for a word.

## 7. Risks, and what must not break

**Operator rulings, held by tests:**
- **Account switching and the auto-swap are never blocked.**
  - No wave adds a gate, refusal or server dependency to `_auto_swap_check`, `cmd_swap`, `swap-self` or the swap routes.
  - W5 touches only the auth-dead write call on that path, and replaces it with a behaviour-identical primitive.
  - A pin asserts that the swap path's refusal set is unchanged by every wave.
- **No herd restarts.** No wave requires a supervisor restart or its own roll; ccd changes ride ordinary releases. The existing `try-restart claude-session@*` sweep in `ccrc update` (≈:21423) is a herd risk this wave neither fixes nor worsens. It deserves its own ticket.
- **Agent-first deploys.** The only agent-touching change (`shared/spawn.mjs`, K17) deploys agent lane first, like every release.
- **ccrc SAFETY rules.** No wave runs `ws-*`, `ws-expire`, `ws-reclaim` or `ws-reap`, or touches units or tmux, on a fleet box as part of its testing. Characterization runs against fixture registries, the source seam and containers. Arming any changed lane stays an operator act, named under the SAFETY rule in the ask.
- **Improve what exists before inventing.** Every owner in §3 grows out of an existing mechanism: `pushOne` → `notify`, `heldFor` → questions, `_ws_reclaim_ladder` → `_ws_retire`, `RUN_TRANSITIONS` → `WORKSPACE_TRANSITIONS`, `models.mjs` → `redact.mjs`. None is a new subsystem.
- **Public repo.** Nothing committed by any wave names a host, an IP, an account or lane name, or a private id. The fixture registries use neutral ids (the vocabulary of #722).

**In-flight programmes:**
- **The skins chain (W2 shells, W3 screens):** no wave edits `app.tsx`, `shell.css`, `FleetScreen`, `SessionHeader` or `fleet.css` until the chain has merged (W7 only).
- **The Settings redesign and Accounts connect:** W7 waits for both. W5's account parts wait for the A-tasks' ccd verbs and their deny guard.
- **The Claude Code binary lifecycle (CB):** W8 waits for its spawn and roll edits, and W1 yields to its server lane edits.
- **Coordinator-first approvals (live):** the signed-ruling path is pinned byte for byte, and W3 waits for its remaining tasks.
- **Hibernation:** W4 and W1's sleep-lane commits wait for Task 19's shadow week, so its measurement is not disturbed.
- **#435 (continuity) and #397/#436/#735 (path identity):** W5, W2 and W6 wait for them, and none of their files is touched first.

**Technical risks:**
- **Consolidation erases an intended difference.**
  - Mitigation: §3.19's table, per-caller verdict columns (K4, K8), and per-reason policy rows (K1, K2).
  - A reviewer asks, for every merged pair: which caller relied on the difference?
- **The funnel changes push timing or order** (K6). Mitigation: the characterization pin records the ring/db/push order and the presence gate for each of the 16 writers before any moves.
- **`SessionReading` changes a lane's verdict at a boundary** (an `unknown` read differently). Mitigation: the truth table over the old ladders is the acceptance test, and any intended change is listed and ruled.
- **The ccd skeleton breaks a destructive verb.** Mitigations:
  - verbs migrate one per PR, in the least-dangerous-first order: collect, expire, reclaim, reap;
  - the retire-verdict table is run against each;
  - the tombstone and lock are unchanged;
  - the server's inject suites prove argv and envelope compatibility;
  - rollback through `ccrc rollback`.
- **Scanner coverage silently drops when code moves** (08-10 rule e). Mitigation: ARCH-04's visit-count pins and ARCH-06's symbol-keyed pins land in W0.
- **The wave stalls halfway, leaving two owners.** Mitigation: each cluster's old owner is deleted inside its own series. The ratchets make a half-done state visible and stop it growing. Pausing between clusters is safe; pausing *inside* a series is not, so series are kept short (one consumer per commit, at most about 8 commits).
- **Cheap-worker routing stalls on deep ccd edits** (recorded `/handoff` quirk). Mitigation: only literal one-consumer moves and characterization rows go to workers. The skeleton, deciders and swap- or approval-adjacent edits are native.
