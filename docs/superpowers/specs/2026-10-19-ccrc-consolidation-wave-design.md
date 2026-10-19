# ccrc consolidation wave: one owner per job (design)

**Status:** DRAFT rev 1, for the operator's review. Rev 1 applies two reviews (log in §8). Nothing here is approved. No D-numbers yet: the plans allocate them. Every decision in §6 takes its recommendation only if the operator rules so.

**The request (operator, 2026-10-19):** "I also feel like we have a lot of separate mechanisms that try to do similar stuff, and we should do a consolidation and refactoring wave that also gets us to DDD/CLEAN/SOLID state plus consolidation of similar functionality."

- **Citations** are to `origin/main` `c7fe20a22` (rev 0 cited `d532903d2`; every [M] count was re-run on `c7fe20a22` for rev 1). Line numbers are hints, written `≈:`, and every citation also names its function, constant or file.
- **Measurements** come from five read-only inventories of `origin/main`: ccd and the box, the coordination server, the fleet watcher, the PWA, and the cross-cutting kernels. Each was re-counted by `git grep`/`wc` for this draft. **[M]** marks a measured figure and **[I]** an inferred one.
- **This spec extends `2026-08-10-architecture-ddd-clean-solid.md` and contradicts nothing in it.** The rings (L0–L5), the six contexts, the cross-cutting rules (a)–(e), the enforcement list and the Rejected list all stand. Where this wave touches a Rejected item (the FleetWatcher lane interface, a domain-event bus, a `FleetGateway` port over ccd, splitting `shared/api.ts`, a `MAIL_DELIVERY_TRANSITIONS`-style table, splitting `coord/routes.ts` per resource), §2.5 says how it stays on the right side of it, and §6 asks for a ruling wherever it would not.

**Date:** 2026-10-19 · **Branch:** `docs/consolidation-wave-spec` (rebased onto `origin/main` `c7fe20a22`)

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
- CCRCP-198: run↔session matching by id string, the bug class §3 K10 closes. Its immediate PWA fix is open as #762 (`runWords.ts`, D-5828), outside this wave.
- The ccrc history programme: #737 (5h-1 export hardening) and the W2-3, W2-4 and W2-decisions plans dated 2026-10-19. They own the history redactor (W2-D54) and edit `ccd/history/lib.mjs`, `shared/roster-json.mjs`, `shared/lifecycle.ts` and `single-definition.test.ts`.
- Other open PRs this wave yields to: #740 (launchd ProcessType: the plist writer in `ccd` and `ccrc`, plus a new `_launchd_class` twin), #722 (neutral fixture vocabulary, 100 files), #745 (Accounts connect A6).

## In short

- **ccrc has one job done many ways, again and again.**
  - Six server lanes, seven ccd verbs and five box collectors each own a slice of an end of life.
  - About nineteen predicates answer "is this session alive", and nine or more answer "is it idle".
  - Operator questions travel about eight routes and come back through about six answer doors [I].
  - Feed events are double-written by hand in sixteen places.
  - Secrets are masked by five redactors that use three different mask words. One of them (`coord/redact.ts`) is a security boundary and stays one.
  - The Claude Code pane is parsed in three languages.
  - A run is matched to its session by id string in about fifty places, and two of the PWA's rules for it disagree today [M].
- **The 08-10 spec already measured why this costs.** An invariant with one home took a one-line fix, while the same invariant with nine writers took four review rounds and was still open (its §"natural experiment"). This wave applies that result to *jobs* as well as invariants: one owner per job, one writer per fact.
- **The target is nine bounded contexts plus four shared kernels (§2).** The contexts are the 08-10 six, re-cut where the overlap shows the boundary was wrong, plus ARCH-02a's three. The kernels are clock and schedule, switches, redaction, and Claude Code grammar. Each context names its aggregates, the single writer of each invariant, the facts it records (journal rows, not a bus), and its ports.
- **Eighteen consolidation clusters (§3)** each collapse into one owner. Every cluster says what is deleted, where each consumer moves to and the measured overlap that justifies it, and marks the parts that look duplicated but are **legitimately different**. Examples: ccd re-deciding inside its lock and the server re-measuring at the act are TOCTOU guards, ccd's unanchored busy grep fails safe on purpose, the auto-swap gate is swap policy, the per-account disabled marker is an operator switch, and auto-swap must decide with the server down. Rev 1 narrows several clusters after review (K1–K4, K6, K7, K11, K15–K18).
- **The clusters map onto the remediation programme (§4).** Of the 35 open ARCH tickets, eleven are prerequisites, eleven are absorbed unchanged as a cluster's first step, two are re-scoped (ARCH-24, ARCH-29), eleven proceed independently, and none is cancelled. Six new epics add 38 tickets, ARCH-40 to ARCH-77.
- **Migration is ten strangler waves, W0, W1a, W1b, W2–W8 (§5).**
  - Every wave lands its characterization pins first and gates on counted ratchets (writers per fact, readers per switch, shared helpers, parity pins removed). Line counts are recorded as observations, not gates. Intended behaviour changes go in separate, ruled "behaviour commits". Rollback is a plain revert, with a stated horizon for each wire change.
  - The first wave is a sliced W0 plus W1a (switches and the feed funnel, without stop-done), after #397 merges. Scheduling (W1b) comes later.
  - **No wave before W7 edits any `pwa/` file**, and a CI path guard enforces it. The workspace-lifecycle wave waits for hibernation's shadow week, and the ccd waves wait for #435, #722, #740 and path-identity W1b.
  - Nothing blocks the skins chain, the Settings redesign, Accounts connect, the binary lifecycle, the history programme, or the auto-swap.
- **ccd stays bash at its OS edge.** That covers the supervisor tick, swap and carry (including the pool grammar the auto-swap reads), registry writes, locks, and the act-time re-check. Its destructive verbs share helpers *in bash* where the steps really match; they do not become one skeleton. The only bash-to-node move proposed is ccd's docs python redactor, at verb cadence. The cost argument is in §5.13, and the operator rules in §6 O2.

## 1. The problem in numbers

### 1.1 One job, many mechanisms

| Job | Mechanisms today | Where | Count |
|---|---|---|---|
| **End a workspace's life** (sleep, stop, retire) | server lanes: stop-done, hibernation, child reclaim, temp-root collect, archived expiry, dead-coordinator | `stopDone.ts`, `stopDoneSweep.ts`, `coord/hibernate.ts`, `hibernateSweep.ts`, `childReclaimSweep.ts`, `coord/childReclaim.ts`, `collectLane.ts`, `coord/collectTempRoot.ts`, `archivedExpiry.ts`, `coord/expireArchived.ts`, `deadCoordinator.ts`, `coord/endDeadCoordinator.ts` | 6 lanes, 12 files, **10,750 lines** [M] |
| | ccd destructive verbs: `ws-reap`, `ws-reclaim`, `ws-expire`, `ws-collect`, `ws-rm`, `ws-gc --prune`, `forget` | `ccd/ccd` regions ≈:11958–14360 (reap), ≈:29000–33750 (reclaim), ≈:33750–34614 (expire), ≈:34615–36700 (collect) | 7 verbs; four have their own eval/resume_eval/fork/audit/locked/tail family, about **10k lines** [M] |
| | registry deleters / stoppers | `_reg_purge` call lines, `_ws_unsupervise` call lines | 7 and 9 lines in `ccd/ccd` [M] |
| | switch readers of one pause | `reclaim-paused` | named in **12 server files** [M] (two of them, `ccdargv.ts` and `rundefs.ts`, define rather than parse), each with its own wording |
| | box collectors of artifact classes | `shared/lifecycle.ts` (the 2026-08-11 artifact-lifecycle manifest, a `collector` column per class) and its collectors `ccd-tmp-sweep`, `ccd-graph-sweep`'s stray sweep, `ccd-history-sweep`, `ccd-usage-sweep`, `ccd-scope-sweep` | 5 collectors under one L0 manifest that already exists |
| **Is this session alive** | ccd: `_session_probe`/`_alive`, `_session_state`, `_ws_unit_state`, `_svc_is_active`, `_ws_expire_presence`, `_ws_expire_cwd_users`, `_ws_path_users`, `_ci_rec_live`/`_ci_hold_live` | `ccd/ccd` | 8 [M] |
| | box: `ccd-tmp-sweep`'s own live-session predicate (`sessions/<pid>.json` + `/proc/<pid>` + hibernated ids) | `ccd/ccd-tmp-sweep` ≈:39–60 | 1 [M] |
| | server: `assembleFleet` ladder, `liveStatus`, `SessionStream.resolve` (its comment says "MIRRORED"), `turnverdict.liveRowFor`, `measureClaimant`, `claimProbe`, `deadCoordinator` | `fleet.ts`, `sessionws.ts`, `turnverdict.ts`, `coord/reclaim.ts`, `watch.ts` | 7 [M] |
| | PWA: `coordPresence`, `hibernatedSince`, `lifecycleQualifier`, `sessionFacts` dead/asleep, plus inline `status === 'dead'` | `coordWords.ts`, `hibernated.ts`, `lifecycleWords.ts`, `sessionFacts.ts`, `SessionActionsSheet` (6), `startProgramPolicy` (3), `ArchiveAllPlane`, `AccountsScreen`, `groupFleet`, `spawnWords` | 4 + 13 inline [M] |
| **Is it idle / mid-turn** | ccd: `_ws_status`, `_idle_for_keystroke`, `_swap_idle_gate`, hibernate's `turn.json`, collect's ctime | `ccd/ccd` | 5 |
| | server: `livestate`, `turnidle` (mail gate), `turnverdict`, `finished` edge, stall verdict, `hibernateVerdict` idle | | 6 |
| **Ask the operator** | routes out: asks, approvals, scraped dialogs, mail, feed, push, digest, ccd `notify.sh` banner | | about 8 routes [I] |
| | answer doors: `/api/asks/:id/answer`, `/api/sessions/:id/ask`, `/dialog{,/text,/multi,/tab}`, `/api/approvals/:id/rule` + `/release`, the hook polling `/ruling` | `coord/routes.ts`, `server.ts` | about 6 doors [I]; PWA has 3 answer paths (DialogSheet, EnvelopeSheet, `push-sw.js`). The **hold rule is already one function** (`coord/heldFor.ts`, "One decision, two lanes", D-5530, D-5531) |
| **Tell the operator something happened** | `log.record(…); coord.recordFeedEvent(log.epoch, ev)` written by hand | `routes.ts` ×5, `childReclaim.ts` ×3, `watch.ts` ×3, `server.ts`, `interruptlog.ts`, `stopDoneSweep.ts`, `endDeadCoordinator.ts`, `expireArchived.ts` | **16** call lines outside the store [M]; three record modes today (gated record+push, `recordAlways`, `recordOnly`); 2 read models (the ring, which is the catch-up authority, and `feed_events`, its archive) |
| **Mask a secret** | `redactCommand` (`[REDACTED]`), `redactDocsText` + ccd python `REDACT_RULES` (`***`), history `redact*` (`[redacted]`), bash `redact()` / `_upd_redact()` (deletes) | `coord/redact.ts`, `shared/docs.ts`, `ccd/ccd` ≈:37219, `ccd/history/lib.mjs`, `ccd/ccd-update-sync`, `ccd/ccrc` | 5 implementations, 3 mask words, the URL-userinfo rule written 4 times |
| **Read the Claude Code pane** | server `pane/dialog.ts` + `pane/statusline.ts` + `shared/ask-menu.ts`; ccd greps/awk; PWA `wrapScreen`, `askLive`, `drawerView`, `MessageBubble` | | 3 languages; SGR stripper declared **5×** [M]; 15 `esc to interrupt` lines in ccd |
| **Read the transcript** | TS `transcript/*`; ccd jq `CONTINUED_IN_JQ` (+ verbatim `def prompt` copy in `ccrc-doctor-checks`), python `_transcript_last_turn_ts`, `compact-card.mjs`, history | | 5 readers; 4 path resolvers |
| **Which run is this session's** | `runForSession` (newest id) vs `PrSheet.tsx:118` (first open run), `ArchiveSheet:134`, `RunsScreen`, `nestFleet`; server ~50 `sessionId`/`claimedBy` equality sites in ~25 files | | 2 PWA rules that **disagree** [M] |
| **Schedule work** | `FleetWatcher` `last*` fields, each lane's own throttle/single-flight/warn | `watch.ts` | **56** distinct `last*` names [M]: about **25 lane cadence clocks** (named in §5.4), the rest memos, diff caches, watermarks and warn latches; 12 single-flight flags; 3 constants **derived** from another lane's, each with a documented reason; a hand-rolled "warn once until it changes" latch at least 4 times (≈:1592, :1638, :1853, :1932) plus `registry.ts`'s `warnOnce` |
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

- **CCRCP-198.** The header names one run and the PR sheet names another. Part of that is two *different* queries with no names: `runForSession` (`runWords.ts` ≈:258) asks for the newest run naming the session, while `PrSheet.tsx` ≈:118 asks for the **open** run naming it (gated on `runsFrameSeen`). The other part is matching on the bare id string. The immediate fix is #762; K10 removes the class.
- **The account enumeration** (08-10 §"Bounded contexts" 1) was written eight times in three languages. A missing entry in one of them silently killed chat for six of 24 sessions. That is the same failure shape as this wave's clusters, at a smaller size.
- **`stopDoneVerdict`** (`stopDone.ts` ≈:160–215) is a near line-for-line copy of `hibernateVerdict` (`coord/hibernate.ts` ≈:180–221). They run on two clocks (60 s and 5 min), read `hibernate-after-hours` separately, and restate the same hold sentences. The lanes themselves are **not** duplicates: stop-done is live under its own switches by operator ruling (D-5370, D-5427), with a hand-only kill switch (`stop-done-disabled`), a 60 s cadence, at most 3 acts and 6 measures per pass, and a 1 h retry memory, while hibernation is shadow-only until `hibernate-live` (Task 19). Only the verdict is shared work.
- **"Someone is looking"** has two meanings, **on purpose**: D-5242's presence contract (`presence.ts` ≈:28) defines an *open* claim that holds sleep (hibernation and stop-done, D-5370) and a *visible* claim that gates pushes and the destructive lanes (child reclaim, expiry, collect). The duplication is that each lane restates which claim it reads. Expiry's deferral has "No ceiling" by explicit choice (`expireArchived.ts` ≈:81), and child reclaim has one; §6 O6 asks only whether that difference should stay.
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
  - **SessionReading** (new): a pure L1 function's output over facts (§3 K3, K4). Display and lane-selection readers use the tick's reading; destructive callers feed it a **fresh one-row read at the act**. Its parts are substrate (`present | absent | unmeasurable`), lifecycle (the `sessionLifecycle` word), turn (`busy | idle | shell | unknown`, with why), sleep (`awake | asleep since T`) and viewer (`none | open | visible`).
- **Writers:**
  - The roster: `ccrc account` → `deploy/account-op.mjs`. The roster's kind fields (`homeAble` …) say what kind of account a lane is.
  - The per-account switch `$REG/<w>-disabled` is **not** a roster projection. It is an operator switch (`_acct_mark_off`, `ccd/ccrc` ≈:7059–7070: "Collapsing them would make a measured, working lane permanently unplaceable"; `_lane_enabled`, `ccd/ccd` ≈:1773: "operator kill-switch"), and the Accounts connect spec defined that split. Only its **write primitive** is consolidated: one staged-rename writer that `_acct_mark_off`, the UI's Enable control and the hand path all go through.
  - Auth-dead: one ccd primitive, `_authdead_mark`/`_authdead_clear`. Its callers are `ccd-account-health`, the swap tick and `_authdead_clear_on_spawn`; today it has three hand-written writes.
  - Registry fields: `_reg_set`/`_reg_purge` in ccd, and the hook's documented fields in `session-hook.sh`. A field schema (ARCH-34's manifest plus a field table) names each field's writer.
  - `SessionReading`: one L1 function, `readSession(facts)`. The watcher's tick calls it over the tick's listing; act-time callers call it over a fresh row.
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
  archived ──retire(merged)──▶ retired              (ws-reap: refuses not-archived)
  archived ──retire(archive-expired)──▶ retired     (ws-expire)
  live|asleep ──retire(child-spent)──▶ retired      (ws-reclaim: retires a live idle child; its tail kills the pane)
  ? ──retire(operator-rm)──▶ retired                (ws-rm, ws-gc --prune, forget: sources read from their refusals by ARCH-41)
  (no row) ──collect(temp-orphan)──▶ quarantined    (ws-collect: a rowless temp root renamed into quarantine; no registry row, no tombstone)
  ```

  Each edge carries **today's** precondition, taken from the verb's refusal, and the characterization table (ARCH-41) is written from those refusals before the table is.
- **Why a table earns its place here** (08-10 Rejected: "A `MAIL_DELIVERY_TRANSITIONS` table"): `RUN_TRANSITIONS` earns its place by encoding many edges that clients read as refusals. `WORKSPACE_TRANSITIONS` must meet the same test: every edge above is a refusal some client reads today (`not-archived`, `not-idle`, `has-row` …). If ARCH-41's census finds fewer than about ten client-read refusals, the table is dropped and each verb keeps one enforcement point.
- **It extends the artifact-lifecycle manifest, not beside it.** `shared/lifecycle.ts` (2026-08-11 policy) is already the L0 table of artifact classes and their collectors (`ccd-tmp-sweep`, `ccd-graph-sweep`, `ccd-history-sweep`, `ccd-usage-sweep`, `ccd-scope-sweep`). Workspace transitions are a different aggregate (a session's workspace, not an artifact class), so they are a second table, and §3.19 records why. The workspace row in `lifecycle.ts` names `WORKSPACE_TRANSITIONS` as its collector policy.
- **Policies, not lanes.** "Sleep a long-idle session" and "sleep a finished worker" are two **idle policies** of one transition, each with its own arming marker, kill switch, cadence, per-pass cap and retry memory (§3 K1). "Reap merged", "reclaim a spent child", "expire archived", `ws-rm`, `ws-gc --prune` and `forget` are **reasons** of one `retire` transition; collecting an orphaned temp root is a different act (a quarantine move with no row). Each reason keeps its own evidence rule: a child marker plus `--child-of` agreeing, an archive epoch, witnesses, a merged PR.
- **Writers:**
  - One L1 decider per transition: `decideSleep(facts, policy)` and `decideRetire(facts, reason)`.
  - One L4 executor per transition, which composes the ccd verb on the coord serialiser and `KeyedQueue`, **re-measures at the act** (switches nearest the argv, registry record, store, presence; D-5428, expiry step 6, the child-reclaim generation check) and records one feed notice through the funnel (§3 K6).
  - On the ccd side, shared refusal, lock and audit-token helpers (§3 K2), with each verb keeping its own tail and its act-time re-check.
- **Facts recorded:** lifecycle journal rows (`intent`/`done`/`fail`/`refuse`) and `.reaped/<id>.json` tombstones. The ccd lock and tombstone are already shared.
- **Bindings, read once.** "Is this workspace bound by coordination" (open runs, claims, outstanding mail, reviews) is asked by nine sites today. It becomes one store query, `bindingsOf(sessionId)`, owned by C5 and read by C4.

- **The PR lifecycle stays here too.** 08-10's C4 was "Workspace & PR Lifecycle". The re-cut keeps the PR half in C4: `sweepPr`, merge detection and the PR ledger are evidence for the `merged` retire reason, and C4 owns them. They do not move to C5.

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
  - Notices: one funnel, `notify(event, mode)`, which writes the ring, `feed_events` and push in that order (§3 K6). Its three modes are today's: `push` (presence-gated record and push), `record-always` (recorded whatever the presence, pushed when no one looks) and `record-only` (never pushed: "every reclaim lands in the feed; no push per reap", `childReclaim.ts` ≈:1679). The ring stays the catch-up authority (`{epoch, seq}`), and `feed_events` stays its archive; a box with no coord.db still has a working ring and catch-up (`watch.ts` ≈:3103).
  - Questions: one module, `coord/questions.ts`, over today's two tables (§6 O5).
  - The approval signing path (`approvalsign.ts`, `approval-verify.mjs`) is untouched. It is a security boundary with its own threat model (coordinator-first §6).
  - The egress command redactor (`coord/redact.ts`, D-5299, D-5360) is the other security boundary here. It gates what untrusted child input puts into approval rows, coordinator mail, digests and surfaces. K7 treats it as one: band 3, pinned byte for byte.
  - The question doors stay **inside `coord/routes.ts`**, behind its one auth gate (08-10 Rejected: splitting routes.ts per resource; D-36/D-39).
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
| **Clock and schedule** | `LANE_SCHEDULE` (L0 data: name, cadence, single-flight, warn-once) plus one L4 `runLane(name, fn)` in `watch.ts`; an injected `now()` for L1. **Cadence is separate from safety intervals** (the twice-observed window, the backoff base), and a derived interval stays a declared reference to its source, never a second literal. The **throttle and single-flight** run on the monotonic clock; **verdicts keep wall-clock** (expiry's `expiresAt`, stop-done's grace from `closedAt`, hibernate's marker stamps). ccd: `_now_s` only | about 25 cadence clocks among 56 `last*` names, 12 flags; 54 raw `date +%s` in ccd [M] |
| **Change latch** | one `changeLatch(key)` helper ("warn once until it changes") | at least 4 hand-rolled latches in `watch.ts` plus `registry.ts`'s `warnOnce` |
| **Switchboard** | `SWITCHES` (L0 data: name, marker or settings row, default, owner context, meaning) plus one reader `readSwitches(listing)`. The tick's listing feeds the **decision**; every executor calls the same reader **again at the act**, over a fresh listing, nearest the argv | ~15 marker files read per sweep, `reclaim-paused` re-parsed in 12 files, `MAIL_DISABLED_MARKER` defined twice |
| **Redaction** | `shared/redact.mjs`, the `models.mjs` pattern: one implementation, a `.ts` re-export, callable from bash through node. It has one rule table and named **profiles** (egress `[REDACTED]`, docs `***`, history index `[redacted]`, log-line userinfo). Each profile lists its rule subset **explicitly**; no profile inherits rules by default. The egress profile is a security boundary (§3 K7) | 5 implementations |
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
| A `MAIL_DELIVERY_TRANSITIONS` table | `WORKSPACE_TRANSITIONS` is held to the same test: it lands only if ARCH-41's census shows its edges are refusals clients read (C4). Otherwise each verb keeps its one enforcement point. |
| Splitting `coord/routes.ts` one file per resource (D-36/D-39) | K5's `/api/questions/:id/*` doors stay in `coord/routes.ts`, behind its one auth gate. `coord/questions.ts` holds the policy and store calls only, never a route or an auth check. |

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
  - one `sleepExecutor` and one `retireExecutor` in L4. Each takes the tick's switch snapshot and listing **for the decision**, then **re-measures at the act**: it reads the switches again nearest the argv (today's expiry step 6: "an operator who raised the pause … meanwhile is obeyed now, not on the next pass"), re-reads the registry record, row, store, presence, live word and turn marker inside the coord serialiser and asks the verdict again (D-5428, D-5370, "held-at-act"), and re-checks the child-reclaim generation key. It checks `ccdCan` once and writes one notice through the funnel in the reason's mode.
  - **Per-policy rows.** Each sleep policy and each retire reason is a row with its own arming marker, kill switch, cadence, per-pass cap and retry memory. `run-done` keeps `stop-done-disabled`, 60 s, 3 acts and 6 measures per pass, and 1 h retry, and it stays live (D-5370, D-5427). `idle-hours` keeps `hibernate-live` and 5 min, and it stays shadow until Task 19 arms it. Merging the rows' code never merges their arming or their herd budget.
- **Deleted:**
  - `stopDone.ts`'s copy of the hibernate verdict;
  - `stopDoneSweep.ts`'s lane skeleton, which becomes the `run-done` row on the sleep lane (its switches, caps and cadence move with it unchanged);
  - the four executors' private `reclaim-paused` parsers, registry listings, capability checks and feed writers (`coord/childReclaim.ts` ≈:1013/1123/1692–1758, `coord/expireArchived.ts` ≈:130/287, `coord/collectTempRoot.ts` ≈:252/357–365, `coord/endDeadCoordinator.ts` ≈:161/195/280).
- **Consumers move:** `watch.ts` `sweepStopDone`/`sweepHibernate` become one `sweepSleep`, and `sweepChildReclaim`/`sweepArchivedExpiry`/`sweepTempRootCollect` become three `retire` reasons on one schedule row each. `close.ts`'s fire-and-forget reclaim calls `retireExecutor`. The PWA's three coord-frame attention parsers (`childReclaimWords`, `expiryWords`, `deadCoordinatorWords`) read one `AttentionRow[]` shape.
- **Overlap:**
  - 6 lanes in 12 files, 10,750 lines [M];
  - `reclaim-paused` read in 12 files [M];
  - `stopDoneVerdict` ≈ `hibernateVerdict`, line for line;
  - "is it bound by coordination" assembled 9 ways (moves to C5's `bindingsOf`);
  - each lane restating which presence claim it reads (the two claims themselves are D-5242's contract).
- **Verdict:**
  - **Real:** the shape of the executors, the switch reads, the bindings query, the stop-done/hibernate verdict, and the feed writes.
  - **Legitimately different:** each retire reason's **evidence**, the PR ledger for a spent child, the 7-day epoch, witnesses for a temp root. These stay as per-reason policy rows and are not merged.
  - **Legitimately different:** the dead-coordinator lane acts on runs, so it moves to C5's decider set and shares only `SessionReading` and the funnel.
  - **Legitimately different and kept:** the act-time re-measure on the server (D-5428, expiry step 6, the generation check). The tick snapshot is a pass old by the time the serialiser runs, and `reclaim-paused` is the fleet's emergency stop. The characterization pins include "a pause raised between the pass and the act holds".
  - The viewer rule is stated **once per transition**, as D-5242 already defines it: sleep defers on `open`, retire defers on `visible`. Whether expiry keeps its deliberate "No ceiling" is the only open question (§6 O6).

### K2. A workspace's end of life, ccd side → shared helpers where the steps match; each verb keeps its tail

- **What is already shared.** `ws-reclaim` and `ws-expire` are **one family today**: `_ws_reclaim_ladder` (`ccd/ccd` ≈:29920) is "SHARED by `_ws_reclaim_eval` and `_ws_expire_eval`", and `_ws_reclaim_tail` (≈:32753) serves both, with expire setting its noun and done key. So there are three families, not four: reap, reclaim/expire, collect.
- **One owner, for what really matches:**
  - one set of refusal helpers (`_reap_refuse` ≈:11956 and `_ws_collect_refuse` ≈:35264 are byte-identical; ARCH-14's `refusal-v1` token lands in the shared one);
  - one lock and audit-token plumbing (mint, check, the existing `.reap-<id>.lock`);
  - the reap↔reclaim tail **steps** that really are the same (the attic pin, `_reg_purge`, the tombstone, the journal line), as named helpers that both tails call.
- **Deleted:** the byte-identical refusal helpers, the duplicated token plumbing, and ws-reap's stale header line "the ONLY destructive verb".
- **Consumers move:** none on the server. The argv and the JSON envelopes stay byte-compatible.
- **Overlap:** the four regions are about 10k lines [M], but most of that is per-reason evidence and pinning (classify, attic, reflog keep), which this cluster keeps. The overlap is the helper set above, counted in §5.8's exit. 7 `_reg_purge` lines and 9 `_ws_unsupervise` lines [M].
- **Verdict:**
  - **Real:** the refusal helpers, the token and lock plumbing, and the matching tail steps.
  - **Legitimately different and kept:** the **act-time re-evaluation inside the lock**. ws-audit mints a token, and the destroyer recomputes the verdict inside the lock. The decider runs twice by design, as a TOCTOU guard.
  - **Legitimately different and kept:** the two tails. `_ws_reclaim_tail` is "Its OWN arm (spec §5.6), never `_ws_reap_tail`": reap's tail refuses `not-archived` and skips unsupervise and the pane kill on resume, while reclaim retires a live idle child and kills its pane. Their resume semantics differ.
  - **Legitimately different and kept:** `ws-collect`. It renames a rowless temp root into a quarantine with dev:ino/btime proofs (`_ws_collect_move` ≈:34942); `_ws_collect_rows_clear` (≈:35106) requires that **no** registry row exists. It never calls `_reg_purge`, the tombstone or unsupervise. It shares only the refusal helper and the token plumbing.
  - **Kept:** each reason's evidence (`.child` + `--child-of`, archive epoch, witnesses, merged PR state).

### K3. "Is it alive" → one pure `readSession`, fed per tick for display and fresh at the act for destruction

- **One owner:** C1's `readSession(facts)`, a **pure L1 function over facts**. Who supplies the facts depends on the caller:
  - **display and lane selection** (the fleet frame, sessionws, claims, lane candidate lists) use the tick's reading, built from the tick's one listing, one tmux verdict per session, one status-file read and the lifecycle mirror;
  - **destructive callers** (the programme reclaim door, the dead-coordinator lane, `heldFor`'s claimant hold, `turnverdict` at the act) feed it a **fresh one-row read at the act**, including the extra re-listing that D-1144 pays for (`coord/reclaim.ts` ≈:134: a listed-but-unassembled row is a live coordinator mid-write, so it must never read `dead`).
- **First step (ARCH-47): widen `SingleRead` per D-1145.** `measureClaimant` re-splits `SingleRead`'s `absent` by hand today, and D-1145 records that the next consumer must widen `SingleRead` (listed-unassembled → `unmeasurable`) rather than re-split. `readSession` is that consumer. The substrate word becomes `present | absent | unmeasurable` with the D-1144 case inside `unmeasurable`, and the liveness truth table has a row for it.
- The fleet frame carries the display result, with two new wire fields:
  - `presence: 'alive' | 'asleep' | 'dead' | 'unknown'` replaces the PWA's `coordPresence`;
  - `deadSince` is set only when lifecycle is in `LIFECYCLE_DEAD`.
- **Deleted:**
  - `liveStatus` (`fleet.ts` ≈:381);
  - `SessionStream.resolve`'s mirrored ladder (`sessionws.ts` ≈:724–770);
  - `turnverdict.liveRowFor`'s one-row `assembleFleet`;
  - `commands.ts` ≈:56 and `coord/routes.ts` ≈:4297 raw reads;
  - `claimProbe`'s `status === 'dead'` reading;
  - `measureClaimant`'s private ladder, which becomes a fail-shut policy over a **fresh** `readSession` (three arms; doubt is never dead; hibernated counts as alive, as today);
  - PWA `coordPresence` and the 13 inline `status === 'dead'` checks.
- **Consumers move:**
  - fleet assembly, sessionws, turnverdict (at-act re-read becomes `readSession` on one row), claims, the reclaim door, the dead-coordinator lane and the stall lane;
  - PWA `orphanWords`, `RunRow`, `SessionScreen`, `SessionActionsSheet`, `startProgramPolicy`, `ArchiveAllPlane`, `AccountsScreen`, `groupFleet` and `spawnWords` read `session.presence`.
- **Overlap:** 19 liveness predicates across four places [M] (ccd 8, `ccd-tmp-sweep` 1, server 7, PWA 4 + 13 inline). "Hibernated is not dead" is coded separately in `coordPresence` and `measureClaimant`.
- **Verdict:**
  - **Real** for every server and PWA reader.
  - **Legitimately different:** the act-time fresh read for destructive callers (D-1144). Only the function is shared, not the reading.
  - **Legitimately different:** `ccd-tmp-sweep`'s predicate is box-side and runs without the server; it stays, and ARCH-47's truth table gets its rows so a drift is visible.
  - **Legitimately different:** ccd's `_session_probe` is the OS edge and must work without the server. It stays, and `_session_state` stays its pinned twin (`ccd-session-lifecycle` test). Viewer presence (`presence.ts`) is a **different fact under the same word**. It is renamed `viewer` in TS so the collision with "presence" ends, and its meaning does not change.

### K4. "Is it idle" → one `TurnReading` with per-caller safety direction

- **One owner:** the `turn` part of `SessionReading`: `busy | idle | shell | unknown`, plus `why`, from the status file first and the pane second. Each consumer applies a **named policy** to it:
  - `mail-gate`: hold unless `idle`;
  - `keystroke`: refuse unless `idle`, and treat `unknown` as busy;
  - `sleep`: require `idle` for N hours;
  - `stall`: an `unknown` that persists is the signal.
- In ccd, `_ws_status` and `_idle_for_keystroke` collapse onto one `_turn_reading` that returns the same four words. Each caller keeps its own policy line, and the ARCH-24 corpus holds every column.
- **`_swap_idle_gate` is out of this cluster.** It is the auto-swap decision gate (`ccd/ccd` ≈:19267, D-5240: "ONE GATE, TWO CALLERS", `_auto_swap_check` and `cmd_swap`'s re-run at the act) and carries swap-only policy: the narrow-pane stand-down (D-5349), the status-file `idle` check, the `SWAP_CEIL_QUIET` quiet window and the tick-diet memo. Its own comment records that an earlier "identical" claim was falsified by the merge. At most, after a behaviour-identical pin of its verdict table, it may call a shared pane-measurability primitive. Its body is not rewritten.
- **Deleted:** the server's `turnidle.ts` and `turnverdict.ts` duplicate reads (their policies stay; `turnverdict` at the act reads fresh, per K3); the busy-to-idle edge in `finished.ts`, which reads the tick's previous `TurnReading`; and one of ccd's two non-swap predicates' bodies.
- **Overlap:** 5 ccd and 6 server idle deciders.
- **Verdict:**
  - **Real** for the reading.
  - **Legitimately different** for the policies, and on purpose. ccd's unanchored `esc to interrupt` makes false-busy the safe error where the act is "type a key". TS anchored `BUSY_RE` because a false busy held mail. ARCH-24's per-caller columns **record** that divergence; this wave does not erase it.
  - **Legitimately different:** `_swap_idle_gate` (D-5240, D-5349). It sits on the auto-swap path, which is never blocked (§7), and §7's swap pin covers its verdict table.

### K5. Operator questions → one OperatorQuestion module and one answer door family

- **One owner:** `coord/questions.ts`:
  - the hold rule, which is **already one function** (`heldFor.ts`: "One decision, two lanes", D-5530, D-5531). It is credited, not counted as overlap;
  - one lapse/release/late-answer/retention sweep (`sweepQuestions`), replacing `sweepAsks` and `sweepApprovals`. Today ask retention is pruned inside `sweepApprovals` (`pruneAskQuestions`);
  - one answer door family `POST /api/questions/:id/{answer,release}`, which carries `kind`. It lives in `coord/routes.ts` behind the existing auth gate (§2.5).
- A scraped dialog on a session that is **not** a child keeps today's raise-to-operator path; only the route it is stored and answered through changes.
- The PWA gets one answer reducer (ARCH-29), shared by `DialogSheet`, `EnvelopeSheet` and `push-sw.js`'s notification answer. **That half is in W7**, after the skins chain, because those files are skins-chain files.
- `askLive.ts`'s pairing of a hook envelope with a scraped dialog moves server-side: the server ships one question.
- **Deleted:** `watch.ts`'s in-memory `heldAsks` map and the approvals `dialogIds` map, which become rows in the module's own table view; five of the six answer doors, kept as thin redirects until the new family has been the **only** door the PWA uses for at least two releases (or the PWA gates on a server cap token), then removed; and, in W7, the client-side pairing.
- **Consumers move:** watch's `detectDialogs` hands a parsed dialog to `questions.raise`; the hook's `POST /api/approvals` becomes `questions.raise({kind:'approval'})`; routes, digest and push read questions.
- **Overlap:** about 8 routes out and about 6 doors in [I; W0's census counts them], 3 PWA answer paths, 2 in-memory maps, 2 retention sweeps.
- **Verdict:**
  - **Real** for routing, hold, retention and doors.
  - **Legitimately different:** an **approval's signed ruling** (Ed25519, nonce, digest; `approval-verify.mjs`), which the child's hook verifies. That stays its own path, unchanged; the module only stores and routes the question.
  - **Legitimately different:** a scraped dialog with no hook envelope is answered by keystrokes and a hook ask by a file. That is the `kind`'s adapter, not a second route.
  - Two tables or one is §6 O5.

### K6. "Tell the operator" → one `notify(event)` funnel and one read model

- **One owner:** `notify(event, mode)`, which grows out of `pushOne` (`watch.ts` ≈:3106). It owns the presence gate, the ring record, the `feed_events` write and the push, in one order. Writers outside `watch.ts` get it through a narrow port.
- **Its modes are explicit**, because the 16 hand-written pairs are not copies of `pushOne`'s default (which drops the record when the session is visible):
  - `push`: presence-gated record and push (today's default);
  - `record-always`: recorded whatever the presence (`recordAlways`);
  - `record-only`: recorded, never pushed (`recordOnly`), which carries the operator's ruling "every reclaim lands in the feed; no push per reap" (`childReclaim.ts` ≈:1679). Each writer's mode is pinned per writer.
- **The ring stays the catch-up authority.** `{epoch, seq}` is the cursor `pwa/src/lib/api.ts` consumes, and `feed_events` stays its archive. coord.db stays an independently optional third sink: "a box with no coordination database still gets a working ring and catch-up" (`watch.ts` ≈:3103). The catch-up wire is **byte-compatible**, so W1a touches no PWA file. Inverting the authority is put to the operator as §6 O11 and is not assumed.
- **Deleted:** 16 hand-rolled `log.record(…); coord.recordFeedEvent(…)` pairs [M] (15 in W1a; `stopDoneSweep.ts`'s waits for W4); `pushRelease`'s direct `sender.notify`; and the use of `hasFeedEvent`/`hasMailWithSubject` as idempotency keys. Each lane that needs once-only gets a `dedupeKey` column on the notice, which ends a SEAM overload. Replacing those keys is a **behaviour commit** (§5.1 rule 1b), because a dedupe key and a subject match can disagree on a re-sent row.
- **Overlap:** 16 writers, 2 read routes, and 2 sources of "run" feed rows (the `pushNewRuns` watermark and the executors).
- **Verdict:**
  - **Real** for the pairs' shape and ordering (ring, then db, then flush), which moves into the funnel once.
  - **Legitimately different and kept:** the three modes and the "no push per reap" ruling, the ring as the cursor authority, and the no-coord.db box.

### K7. Redaction → `shared/redact.mjs` with profiles

- **One owner:** one rule table (URL userinfo, `?token=`, `gh*_`, `sk-`, Authorization headers, secret assignments, program flags) and four **profiles** that choose a mask word and rule subset: `egress` (`[REDACTED]`), `docs` (`***`), `history-index` (`[redacted]`) and `log-line` (userinfo removed, `$HOME` → `~`).
- **Deleted:**
  - the TS `redactDocsText` body, which re-exports;
  - ccd's python `REDACT_RULES` (≈:37219–37275), which call `node redact.mjs --profile docs` once per docs verb;
  - `coord/redact.ts`'s rule regexes (its egress helpers stay as callers). **This is a security boundary** (coordinator-first's command redactor for untrusted child input, D-5299, D-5360, nine review rounds of shell-grammar rules). The move is band 3, native. Its first commit pins `redactCommand`'s output over a corpus byte for byte, and the pin stays green across the move, the way W3 pins `approval-verify.mjs`. The egress profile's rule subset is listed explicitly, so command-grammar rules cannot over-redact docs prose and prose rules cannot leak into egress;
  - the duplicate rule regexes in `ccd/history/lib.mjs`, **only after the history programme's W2 merges and with that programme coordinator's ack**. History's redaction is a ruled design (`redactField`, `makePairIndex`, the `redactDisplayWindow` ban, the W2-D54 order). Its pair index, belt and `redactField` call order are out of scope, and only the rule table is shared;
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

- **One owner:** in TS, `transcript/` as today. For bash, `ccd/lib/transcript.jq`, a jq library file holding `def prompt`, continuation and limit-banner. It is loaded with `jq -L` by `ccd` and `ccrc-doctor-checks`.
- **The python reader's port must keep its tolerance.** `_transcript_last_turn_ts` (`ccd/ccd` ≈:23685) skips malformed lines one by one (`json.loads` in try/except), which matters because `tail -n` can cut a partial first line. It also truncates stamps to 19 characters to sidestep fractional seconds. The jq port uses `jq -R 'fromjson?'` and the same 19-character truncation before `strptime`, and its fixtures include a partial first line and a fractional timestamp. `compact-card.mjs` reads a different rule (the `compact_boundary` row) and is out of scope. Transcript path resolution happens once in ccd (`_transcript_path`) and once in TS (`resolve.ts`).
- **Deleted:** the verbatim `def prompt` copy (`ccrc-doctor-checks` ≈:4032), `_ci_transcript_path` (≈:16243), the duplicate in `_transcript_matches` (≈:25095), and the python `_transcript_last_turn_ts` (≈:23685–23737), which becomes a jq call against the library.
- **Overlap:** 5 readers and 4 resolvers. Two parity pins (`continued-in-parity`, `continued-in-successor-parity`) cover three readers today and will cover two after.
- **Verdict:**
  - **Real** inside bash (three copies become one).
  - **Legitimately different** across languages: TS and jq stay, held by the pins, because ccd must read transcripts on the swap and carry path without the server. A node call per carry is affordable (carry is not per tick), but the continuation rule is also read on the tick by `_sync_uuid`, so it stays jq (§5.13).
  - #435 (continuity 4b) edits these readers, so this cluster waits for it.

### K10. Run↔session binding → one `RunBinding` keyed on the worker's incarnation

- **One owner:** C5's `bindingOf(sessionId, generation)` in L1 over the store, and the wire field `FleetSession.run` computed once by the server. **Two queries, named:** `session.run` is the newest run naming this incarnation, in any state; `session.openRun` (or `run.state` on that summary) is the open one. `PrSheet`'s merged-note claim keeps its open-only filter as a named policy over the binding, gated on `runsFrameSeen`, so CCRCP-198 cannot come back as "which of the two did you mean". The coordinator side is `childrenOf(coordinatorId)`. `Incarnation` is the one new branded value (§2.5): session id plus registry generation, so a recycled id cannot inherit a closed run.
- **Deleted:**
  - PWA `runForSession`'s matching loop, `PrSheet.tsx:118`'s inline open-run find (its policy stays, over `session.openRun`), `ArchiveSheet:134`'s claimedBy filter, the `RunsScreen` ≈:129/254 lookups and the client-accumulated `childRunsSeen` (`useColdRuns` ≈:175). All read `session.run` and `run.childIds`;
  - command palette `fleetOrder`'s inline re-composition (`commands.ts` ≈:31–40), which calls `fleetTree`;
  - on the server, the ~50 equality sites route through `bindingOf`/`childrenOf` over a series. The store's twelve near-duplicate readers (`resolveCoordinator`, `resolveWorker`, `parentOfSession`, `openClaimantsOf`, `openRunsForSession`, `runsNamingSession`, `lastRunBySession` …) shrink to the two plus the queries that are genuinely different (open-only vs any, last-closed).
- **Overlap:** 2 unnamed PWA queries that look like one rule [M]; ~50 server sites [I; W0's census defines and counts them]; CCRCP-198 (its immediate fix is #762, outside this wave).
- **Verdict:**
  - **Real.**
  - **Legitimately different and kept:** ccd's `.child` marker, as a projection with one writer, because ccd's reclaim verifies it under its lock offline.
  - The coordinator↔child durability investigation decides the binding's durability. This cluster fixes only the key and the writer, and **waits for** that investigation and for #397 (path identity's id gate).

### K11. Scheduling → one `LANE_SCHEDULE` table and `runLane` helper; timers stay systemd

- **One owner:**
  - In `watch.ts`, one table row per lane (cadence, single-flight, warn-once key) and `runLane(name, fn)`, which owns throttle, single-flight, catch and warn-once. The throttle and single-flight use the monotonic clock. **Verdicts keep wall-clock**, because lanes decide against wall-clock instants (expiry's `expiresAt`, stop-done's grace from `closedAt`, hibernate's marker stamps).
  - **Safety intervals are their own rows, not cadences.** `CHILD_RECLAIM_SWEEP_MS` is a cadence *and* the twice-observed safety window *and* the failure-backoff base; `COLLECT_OBSERVE_INTERVAL_MS` is "DERIVED from it, never a second literal" (`watch.ts` ≈:256). `STALL_SWEEP_MS = CLAIM_SWEEP_MS` and `DELEGATION_SWEEP_MS = DIVERGENCE_SWEEP_MS` give the same "for that constant's reason" rationale. The table keeps each derivation as a declared reference, so nobody can change a cadence without seeing the safety window it implies.
  - On the box, the systemd `.timer` files are the one source. `ccrc`'s launchd plists are **generated** from them at install, and `ccrc-doctor-checks` reads the cadence from the unit file instead of restating it.
- **Deleted:** the about 25 cadence-clock `last*` fields (named in §5.4) and 12 flags [M]; the **throttle's** wall-clock gate in expiry and dead-coordinator for a constant that child reclaim throttles on monotonic time (a behaviour commit, §5.1 rule 1b); the doctor's restated cadences (the `ccrc-doctor.test` pin goes away). The other `last*` names (memos, diff caches, watermarks) stay where they are, and the warn latches move to the change-latch kernel (§2.3).
- **Overlap:** about 25 hand-kept cadence clocks, two clocks for one throttle, 14 timers in 2–3 places each.
- **Verdict:**
  - **Real** inside each process.
  - **Legitimately different:** server lanes and systemd timers run on different hosts and in different processes. One scheduler for both would put the box's OS edge behind the server, which is exactly what auto-swap and the timers must not depend on. Usage scanning on both sides (`USAGE_SWEEP_MS` reads sidecars; `ccd-usage-sweep` writes them) is reader and writer, not duplication.

### K12. Switches → one `SWITCHES` table and one reader per tick

- **One owner:** L0 `SWITCHES`. Each row has a name, its storage (a marker path, or a settings table and column), a default, the owning context, the operator meaning and the route that writes it (or "hand-only", as for `stop-done-disabled` and `collect-lane-live`). `readSwitches(listing)` is the one reader. The tick's snapshot feeds the decision, and **every executor reads again at the act**, nearest the argv, through the same reader (today's expiry step 6). "Pause raised between the pass and the act holds" is a characterization row.
- **Deleted:** the private `reclaim-paused` parsers (10 of the 12 files that name it; `ccdargv.ts` and `rundefs.ts` define it); the duplicate `MAIL_DISABLED_MARKER` (`rundefs.ts` ≈:50, `watch.ts` ≈:678); the mail lane's mode lookup through `stallResolveNow`. `collect-lane-live` is **kept**: it is the legacy arm of the collect switch, which still arms the lane while it stands and its latch is unset (`collectLane.ts` ≈:32), and it becomes a row.
- **Added:** a per-reason **off** switch for child reclaim (a hand-touched `child-reclaim-disabled` marker or a `SWITCHES` row whose absence means armed, so deploying it changes nothing), because today child-spent has only the shared `reclaim-paused`, which also pauses expiry, collect and the coordinator reclaim (ARCH-77). The three opt-outs `no-hibernate`, `hold` and coordinator-paused become three rows with distinct meanings. They are not merged, because each means something different: `no-hibernate` is one session's opt-out of sleep, `hold` is a workspace declared mid-programme (it blocks sleep and retire), and coordinator-paused is a fleet-wide pause of coordination lanes.
- **Overlap:** ~15 markers plus 3 tables, read per sweep.
- **Verdict:**
  - **Real** for the readers.
  - **Legitimately different:** storage. A marker file is what ccd and the hook can read with the server down, while a db settings row carries the operator's audit trail. Both stay as storage, with one table describing them.

### K13. Fleet read model → one registry listing per tick, and sessionws subscribes

- **One owner:** the tick's `FleetReadModel`, one object that replaces `assembleFleet`'s ~12 positional caches. `GET /api/fleet`, `/ws/fleet` and every lane's **selection** reads it; destructive acts re-measure at the act (K1, K3). `SessionStream` keeps the transcript tail it owns and **subscribes** to the watcher's per-session dialog, hookstate, tasks, workflows and mail frames instead of polling them every 2 s per socket.
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

### K15. Placement → the server's projected home for new-session suggestions; swap suggestions stay their own question

- **One owner:** for *new-session* suggestions, `limits.ts projectHome`, which mirrors ccd's `_ws_least_loaded`. Any PWA copy that answers "where would a new session in this project land" is deleted. For *acts*, ccd's `_ws_least_loaded`/`_swap_target` remain.
- **Not merged:** the PWA's `accountPicker.leastLoaded`, whose only caller is `SwapSheet.tsx` ≈:169 over `split.eligible`. It suggests a swap target for one existing session, which is `_swap_target`'s question, not `_ws_least_loaded`'s. It stays as it is. A server-computed swap suggestion that mirrors `_swap_target` is a possible later step, offered under §6 O12, and is not part of the wave.
- **Verdict:**
  - **Real** for any PWA new-session placement copy.
  - **Legitimately different:** swap-target suggestion vs project placement, in the PWA exactly as in ccd. Changing it would change what the account-switching UI suggests.
  - **Legitimately different** in ccd. Auto-swap and `ws-add` must place with the server down, and the operator ruled that account switching is never blocked. The ccd/TS twin stays, pinned by `projected-home.test`; `_share_pct`/`shares.ts` and `_serviceable`/`serviceability.ts` stay pinned as well. The three ccd placement walks (`_ws_least_loaded`, `_place_for_class`, `_swap_target`/`_rescue_target`) share one scoring function, `_limit_score`, and keep their own candidate filters.

### K16. Account and box markers with two writers → one primitive each

- **One owner:**
  - `_authdead_mark`/`_authdead_clear` (C1);
  - `<w>-disabled`: one staged-rename **write primitive** that `_acct_mark_off`, the UI's Enable control and the hand path all go through. It stays an operator switch, separate from the roster's kind fields (§2.2 C1). It is never re-projected from the roster, so a hand-raised switch is never erased;
  - usage sidecars deleted only by `_usage_purge` (`ccd-usage-sweep --reap-orphans` calls it);
  - `FleetState.ccdVerbs` written by `onReady`, with `refreshCaps` asking through the same setter and its epoch guard;
  - pane scopes: `_panescope_record` records, `ccd-cap-scopes` caps, and `ccd-scope-sweep` stops. These are three acts on one fact, and they share one reader of `$REG/<id>.panescope`.
- **Verdict:**
  - **Real** for the writers.
  - **Legitimately different:** the roster's kind fields vs the per-account operator switch (Accounts connect spec; `_acct_mark_off`'s own comment).
  - **Legitimately different:** the two 60 s pane-scope timers. Capping and stopping are different acts with different failure costs, so merging their units would couple a cap failure to a stop. They share the reader only.

### K17. Journals and spawns → shared helpers where the shape is the same

- **Journal-to-db mirrors.**
  - The lifecycle mirror (`mirror.ts`/`mirrorplan.ts`/`journalparse.ts`) and the collect-lane generation journal share one cursor, gap and generation helper.
  - The **delegation journal stays separate.** It is the hash-chained authority, and coord.db is its projection, the reverse direction from the lifecycle mirror. **Legitimately different.**
  - The log-first-then-db idiom of `ledgerlog`, `pooledgelog` and `updateintentlog` gets one `appendThenApply` helper.
- **Process spawn.**
  - **Real:** the agent's `makeUpdateSpawn` and the server's `update/spawn.ts` body are twins. They move into one `shared/spawn.mjs` that both packages import, and `update-spawn-twin-bodies` goes away.
  - **Legitimately different and kept:** `update/spawn.ts` stays separate from `exec.ts`. It says so itself ("a SEPARATE runner from `exec.ts`'s shared `Runner`/`realRunner`, which tmux and ccd use and which stay as they are"): it runs a detached process group, kills the whole group at its bound and has a drain deadline. `exec.ts`'s Runner carries the `CcdArgv` ACL (C2), and giving it process-group options would widen a security-relevant runner for an unrelated job.
  - **Audited one at a time, not assumed:** `localcaps.ts` and `accounts/ops.ts`. Each folds onto `exec.ts` only if its audit shows no option `exec.ts` lacks.

### K18. Byte-identical helpers in the hook → generated from ccd's, through the existing `ccrc:generated` mechanism

- **Scope, narrowed.** Only helpers that are **already byte-identical and already pinned** are generated: `_hook_epoch_ms` (`session-hook.sh` ≈:41) and the `CCRC_PROJ_CLASS`/`MAX` and `ID_MAX` constants, which today are spelled in three files with a comment saying "widen the other two by hand".
- **Mechanism, not invented.** `ccd/ccd` already carries `# ccrc:generated 1 sha256=…` on line 2, with the `ccrc restamp` regenerator and its ownership and install tests. K18 extends that mechanism to the hook's generated region. It does not add a second codegen beside it. It is still a byte-copy and not a `source`, because ARCH-02b's proposed rule rejects runtime-sourced siblings.
- **Not generated: the hook's compaction-lock region.** It differs from ccd's on purpose:
  - `_hook_lock_still_canonical` (≈:1389) was "built for `_reg_purge` and then REFUSED on the measurement" for ccd, under "WHY THERE IS NO ccd TWIN, MEASURED RATHER THAN OMITTED" (≈:1364);
  - the hook has an absolute exit-0 contract and its own rc-2 fail-closed arms;
  - `ccd-lifecycle-sites.test.ts` forbids the hook file from containing any lifecycle-emitter identifier, comments included, so a byte-copy of ccd's region would red it or import ccd's behaviour;
  - the function names differ (`_compact_lock_same` vs `_hook_lock_same`).
- **Also in scope:** #740's new `_launchd_class` twin in `ccd` and `ccrc`. It moves inside the shared platform block that `macos-platform.test` already holds byte-identical, after #740 merges.
- **Verdict:** **real** for the already-identical helpers and constants. **Legitimately different** for the lock region.

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
| the server's act-time re-measure (D-5428, expiry step 6, child-reclaim generation check) | TOCTOU guard on the server side, the twin of ccd's in-lock re-eval; the tick snapshot is a pass old by the act (K1, K12) |
| `measureClaimant`'s fresh read vs the tick's `SessionReading` | destructive doors need an act-time, fail-shut read with D-1144's split; only the function is shared (K3) |
| `_swap_idle_gate` vs `_ws_status`/`_idle_for_keystroke` | swap decision gate with swap-only policy (D-5240, D-5349); auto-swap is never blocked (K4) |
| roster kind fields vs `<w>-disabled` | what kind of account vs an operator switch (Accounts connect spec; `_acct_mark_off`) (K16) |
| stop-done vs hibernation lanes | one is live by ruling (D-5370, D-5427), one shadow until Task 19; separate arming, kill switch, cadence, caps and retry (K1) |
| open vs visible presence | D-5242's contract: open holds sleep, visible gates push and destruction (K1) |
| the feed's three record modes; ring vs `feed_events` | "no push per reap" ruling; the ring is the cursor authority and works with no coord.db (K6) |
| reap tail vs reclaim tail; `ws-collect` | different resume semantics; collect is a quarantine move with no row (K2) |
| hook lock region vs ccd's | measured "no ccd twin"; the hook's exit-0 contract and `ccd-lifecycle-sites` (K18) |
| derived cadence constants | safety-window derivations, declared not aliased (K11) |
| SwapSheet's swap suggestion vs `projectHome` | swap target vs new-session placement (K15) |
| `update/spawn.ts` vs `exec.ts` | process-group runner vs the `CcdArgv` ACL runner (K17) |
| `WORKSPACE_TRANSITIONS` vs `shared/lifecycle.ts` | a session's workspace vs artifact classes; the manifest's workspace row points at the table (C4) |
| egress redactor vs the other profiles | security boundary for untrusted child input (K7) |

## 4. Mapping onto the remediation programme

### 4.1 What happens to each existing ARCH ticket

The programme's 36 tickets: one is done (ARCH-11a), and 35 are in backlog. The wave **cancels none of them**.

| Fate | Tickets | Meaning |
|---|---|---|
| **Prerequisite** (lands before the wave that needs it, unchanged) | ARCH-00 (parser), ARCH-01 (god-file growth vs merge-base), ARCH-02a (spec v2: contexts 7–9, timer rule, PWA rings), ARCH-02b (the ruling, §6 O4/O9), ARCH-03 (consumer-side ports), ARCH-04 stage 1–2 (ring scanner), ARCH-06 (symbol-keyed pins: every cluster moves code that literal pins read), ARCH-08b (`readdirMeasured`), ARCH-10 (runner says whether ccd ran: the retire executor must tell transport failure from refusal), ARCH-23 (ccd harness integrity: K2 needs honest stubs), ARCH-34 (ccd function-to-context manifest: K2/K18 need the map) | 11 |
| **Absorbed** (becomes the first ticket of a cluster, scope unchanged) | ARCH-36 → K1 (the archive decider is C4's first decider); ARCH-35 → K1 (`decideClose` queues the retire); ARCH-25 → K2 (the reaping breadcrumb is the shared tail step's tombstone grammar); ARCH-14 → K2 (refusal-v1 lands in the one shared refusal helper); ARCH-09 → K13 (mail ingress reads the registry once); ARCH-19 → K5 (mail policy into `coord/` before questions move); ARCH-13a → K5; ARCH-26 → K9 (jq held to TS by set equality, the same shape); ARCH-28 → K14; ARCH-30 → K14; ARCH-13b → K14 | 11 |
| **Re-scoped** (grows; the original acceptance criteria stay and more are added) | **ARCH-24** → K8: the corpus also owns the module exports (one SGR stripper, one prompt glyph) and the PWA's move to parsed facts. **ARCH-29** → K5: the reducer serves all three answer paths, including `push-sw.js`, and the server-side pairing | 2 |
| **Independent** (no cluster depends on it; it proceeds on its own schedule) | ARCH-05, ARCH-07, ARCH-08, ARCH-11b, ARCH-12, ARCH-15, ARCH-16, ARCH-20, ARCH-21, ARCH-22, ARCH-33 | 11 |

**Housekeeping found while mapping.**
- ARCH-21 (CCRCP-120) is still Backlog in Linear, but its deliverable landed as `openRunPreconditions` (CCRCP-138, done; the coordinator-first plan's D-5384). It should be closed against that PR.
- ARCH-17, -18, -27, -31 and -32 do not exist in the project. The numbering has gaps, and nothing is missing.

### 4.2 New epics and tickets

There are six new epics in the same Linear project. Tickets continue the ARCH numbering from ARCH-40, and each is one reviewable PR or a short series. The sizes are first estimates: XS < 100 changed lines, S < 300, M < 800, L > 800.

| Epic | Ticket | Cluster | Size |
|---|---|---|---|
| **ENF** (existing) | ARCH-40 `writers` pin: **extends `single-definition.test.ts`'s existing writer and holder scans** ("deploy.sh is the only writer…", the O13 scans) with each §2.2 fact's writer set, from AST plus the ccd manifest; the sets may only shrink. Also lands the census scripts every GATE exit uses (§5.1 rule 3) | all | M |
| **LIFE** Workspace lifecycle | ARCH-41 `WORKSPACE_TRANSITIONS` in L0 with a derived list and `is*` guard. First commit: a census of today's verbs' client-read refusals as rows, with each edge's precondition. The table lands only if the census justifies it (§2.5) | K1 | S |
| | ARCH-42 `bindingsOf(sessionId)` store query; the nine readers move one per commit | K1/C5 | M |
| | ARCH-43 `decideSleep` + `sleepExecutor` with per-policy rows (arming, kill switch, cadence, per-pass cap, retry); stop-done becomes the `run-done` row, still live; its feed pair and switch read move here (after hibernation's Task 19) | K1 | M |
| | ARCH-44 `decideRetire` + `retireExecutor` with the act-time re-measure; reasons migrate one PR each: `temp-orphan`, then `archive-expired`, then `child-spent` (that PR's first commit lands ARCH-77) | K1 | L (3 PRs) |
| | ARCH-45 ccd shared refusal helper, token/lock plumbing and the matching reap↔reclaim tail steps; one PR per helper, each with its callers | K2 | M (3 PRs) |
| | ARCH-46 one `_reg_retire` helper for the purge/tombstone/journal steps that `ws-rm`, `ws-gc --prune` and `forget` already repeat | K2 | S |
| **LIVE** One reading of a session | ARCH-47 first widen `SingleRead` per D-1145 (listed-unassembled → `unmeasurable`); then `readSession` + `SessionReading` in L1; truth-table characterization over today's 7 server ladders plus `ccd-tmp-sweep`'s rows and D-1144's case | K3 | M |
| | ARCH-48 wire `presence`/`deadSince` (additive); display readers move to the tick's reading (`liveStatus`, `resolve`, `claimProbe`); destructive readers (`measureClaimant`, `liveRowFor` at the act) move to a fresh `readSession` | K3 | M |
| | ARCH-49 PWA reads `presence`; `coordPresence` and 13 inline checks go (after skins W3) | K3 | S |
| | ARCH-50 `TurnReading` + named policies (server); ccd `_turn_reading` for `_ws_status` and `_idle_for_keystroke` only, **never `_swap_idle_gate`** (after tick-diet budget fixtures) | K4 | M + M |
| | ARCH-51 `FleetReadModel` + one registry listing per tick | K13 | M |
| | ARCH-52 `SessionStream` subscribes; its four polls go | K13 | M |
| | ARCH-53 rename viewer presence (`presence.ts` → `viewer`) in TS | K3 | XS |
| **ATTN** Attention routing | ARCH-54 `notify(event, mode)` funnel with three explicit modes; a per-writer pin of mode, order and the "no push per reap" ruling first; 15 pairs migrate one file per commit (`stopDoneSweep.ts`'s goes with ARCH-43); catch-up wire byte-compatible | K6 | M |
| | ARCH-55 `dedupeKey` on notices; `hasFeedEvent`/`hasMailWithSubject` stop being idempotency stores (a behaviour commit) | K6 | S |
| | ARCH-56 `coord/questions.ts`: one hold/lapse/retention sweep over both tables | K5 | L |
| | ARCH-57 answer door family in `coord/routes.ts` + redirects for at least two releases (server, W3); the PWA reducer (ARCH-29 re-scoped) in W7 | K5 | M |
| | ARCH-58 envelope↔dialog pairing server-side, additive (W3); `askLive` client pairing goes in W7 | K5 | M |
| | ARCH-59 `notify.sh` banner becomes a funnel notice | K5/K6 | S |
| **BIND** Run binding | ARCH-60 `Incarnation` value + `bindingOf`/`childrenOf` (after the durability investigation and #397) | K10 | M |
| | ARCH-61 wire `session.run`, `run.childIds`; PWA matchers and `childRunsSeen` go; `fleetOrder` calls `fleetTree` | K10 | M |
| | ARCH-62 server's ~50 equality sites → `bindingOf`, one file per commit; the store's twelve readers shrink | K10 | L |
| **GRAM** Claude Code grammar | ARCH-63 one SGR stripper / prompt glyph / guard export; 4 declarations and 3 guard copies go (ARCH-24 re-scoped carries the corpus) | K8 | S |
| | ARCH-64 PWA receives parsed facts (compaction kind, prompt flag); `COMPACTION_RE`, `showsPrompt` go | K8 | M |
| | ARCH-65 `ccd/lib/transcript.jq`; the doctor copy, `_ci_transcript_path` and the python reader go (after #435) | K9 | M |
| **KERNEL** Shared kernels | ARCH-66 `shared/redact.mjs` + profiles with explicit rule subsets; TS callers move. **Band 3, native**: the egress profile's corpus pin first. The history-index profile lands only after history W2 merges, with its coordinator's ack | K7 | M |
| | ARCH-67 ccd docs python redactor → `node redact.mjs`; one bash `log-line` function | K7 | S |
| | ARCH-68 `LANE_SCHEDULE` + `runLane`; cadence separated from safety intervals, derivations declared; throttle and single-flight on the monotonic clock, verdicts on wall-clock | K11 | M |
| | ARCH-69 launchd plists generated from the `.timer` files; the doctor reads unit files | K11 | M |
| | ARCH-70 `SWITCHES` + `readSwitches`; the snapshot feeds decisions and executors re-read at the act; "pause raised between pass and act holds" pinned | K12 | M |
| | ARCH-71 `ccdCan(row)` with a `default` column in `CCD_ARGV` (SEAM overload) | K12 | M |
| | ARCH-72 single write primitives: auth-dead, the disabled switch's staged-rename writer (no roster projection), usage sidecars, `ccdVerbs` | K16 | M |
| | ARCH-73 journal cursor helper + `appendThenApply`; `shared/spawn.mjs` for the update-spawn twin only; `localcaps`/`accounts/ops` audited one at a time | K17 | M |
| | ARCH-74 the hook's already-identical helpers and constants generated through `ccrc:generated`/`ccrc restamp`; `_launchd_class` into the platform block after #740 | K18 | S |
| | ARCH-76 one `changeLatch` helper; the ≥4 `watch.ts` latches and `registry.ts`'s `warnOnce` move to it | kernel | S |
| | ARCH-77 a per-reason off switch for child reclaim, default armed | K12/K1 | XS |
| **PWA** (existing) | ARCH-75 `BUCKET_ORDER` in `shared/`; "archived" by bucket; `useEnsure`; `sessionPath`; storage port; visibility clock; feed/runs/projects single readers; PWA new-session placement copies go (K15; SwapSheet's `leastLoaded` stays) | K14/K15 | L (5 PRs) |

That is 38 new tickets (ARCH-40 to ARCH-77) in six new epics plus two existing ones.

## 5. Migration: strangler waves

### 5.1 Rules every wave follows

1. **Characterization first.**
   - A series' first commit adds a test that is green on `main` against the **old** code. The test pins inputs to outputs: verdicts, refusal words and statuses, composed `CcdArgv`, feed rows and their record mode, wire frames.
   - The test records one mutant: deleting or reordering a guard turns it red, which is 08-10's mutant duty.
   - **Move commits** change the test only in its imports. They can do that because ARCH-06's symbol-keyed pins replace literal source-text pins. A move commit that edits a characterization assertion is refused in review.
   - **1b. Behaviour commits.** An intended output change is its own commit class: never squashed with a move, it changes the characterization assertions in that commit only, lists the before/after rows in the PR body and cites the operator's ruling. The wave's known behaviour commits are K6's `dedupeKey` replacing `hasFeedEvent`/`hasMailWithSubject`, K11's monotonic throttle where expiry and dead-coordinator throttle on wall-clock today, anything §6 O6 or O11 rules, and any K3 truth-table row that a ruling changes.
   - **1c. Skew tests.** A pin in one process cannot see cross-process ordering or deploy skew. Every wire change carries a skew test: the old client against the new server, and the new client against the old server.
2. **Strangler order.** The new owner lands beside the old one. Consumers move one per commit, and the old owner is deleted last, in its own commit. During a wave, wire changes are **additive**.
3. **Exits are GATES or OBSERVATIONS.**
   - A **GATE** is a ratchet count from a committed census script landed in W0 (ARCH-40), which may only shrink: writers per fact, readers per switch, call lines, named clocks, shared helpers, parity pins, PWA match sites. A wave is done when its GATEs are met **and** its old owner is gone.
   - An **OBSERVATION** is a number recorded at exit that gates nothing: lines out of a god file, lines in a region.
   - Every census names its query, so "~50 sites" becomes a defined count before the wave that moves them starts.
4. **Rollback is a revert, with a stated horizon.** No wave needs a data migration that cannot be reversed. The one schema change, the `dedupeKey` column (W1a), is additive: a revert leaves an unused column. ccd changes roll back through `ccrc rollback` to the previous release. **Each wire change states its rollback horizon.** A door or field that goes away is removed only after the new one has been the only reader for at least two releases, or after the client gates its use on a server cap token. Until then, a server rollback past the release that introduced it leaves the PWA working.
5. **Deploys.**
   - Agent-first, from a fresh `origin/main` worktree, as the operator's runbook says.
   - No wave requires a supervisor restart or a roll of its own. ccd changes ride the next ordinary release, so **no wave adds a herd restart**.
   - The existing `try-restart claude-session@*` sweep in `ccrc update` (≈:21424) is a separate, known herd risk. It is not in this wave's scope; §7 names it.
6. **One `watch.ts` series at a time, and the wave yields.**
   - Before every commit, the series checks per-file line-disjointness against each open PR that edits the same files (today #397, #435, #722, #737, #740, #745 and the Settings, skins, CB and history plans' PRs). **The wave rebases; the programme PR never does.**
   - Every ccd PR conflicts on the `# ccrc:generated sha256=` stamp on line 2. The resolution is `ccrc restamp` after the rebase, never a hand edit.
   - Landing goes through the queue (`gh pr merge --match-head-commit`).
7. **Routing.**
   - Characterization tests and literal moves (one consumer per commit) are band 1–2 `/handoff` material.
   - Deciders, the ccd helpers, the egress redactor, and anything on the swap, approval or destructive path are band 3: native, with the orchestrator reviewing every diff.
8. **No `pwa/` file before W7.** Each series before W7 carries a CI path guard that fails on any `pwa/` change, so the skins chain, Settings and Accounts PWA work never rebase on this wave.

### 5.2 W0: the pins the next wave needs (docs and tests only)

- **W0 is sliced.** It lands only what W1a needs, then grows a slice ahead of each later wave.
  - **W0 now:** ARCH-01 (growth check), ARCH-06 for the files W1a touches, ARCH-40 (writers, extending `single-definition.test.ts`, plus the census scripts), and two characterization pins: each feed writer's mode, order and presence gate, and each `reclaim-paused` reader's verdict including "pause raised between pass and act holds".
  - **W0 later slices**, each before the wave that needs it: ARCH-00, -02a, -02b (ruling), -04 stages 1–2, -23, -34; the pane corpus (ARCH-24) before W2; the liveness truth table (ARCH-47's first commit, with D-1144's row) before W2; the retire-verdict table over ccd's evals before W5.
- **Exit (GATES):**
  - every pin is green on `main`;
  - the growth check is active for `ccd/ccd`, `ccd/ccrc`, `watch.ts`, `coord/store.ts`, `coord/routes.ts`, `server.ts`, `sessionws.ts` and `pwa/src/lib/api.ts`;
  - ARCH-34's manifest maps **every function defined in `ccd/ccd` at its series' merge-base**, checked by a test (not a fixed number; #435 and #740 add functions);
  - zero production bytes change, and the ccd launcher SHA-256 is unchanged.
- **Waits for:** nothing for W0 now. The fixture corpora (later slices) adopt #722's neutral vocabulary after it merges. ARCH-02a's CLAUDE.md edit rides #434 if that PR is still open.

### 5.3 W1a: switches and the feed funnel (K12, K6)

- **Tickets:** ARCH-70, -54, -55.
- **Exit (GATES):**
  - `recordFeedEvent` call lines outside the store: 16 → 2 (the funnel, and `stopDoneSweep.ts`'s, which moves in W4);
  - private `reclaim-paused` parsers: 10 → 1 (`stopDoneSweep.ts`, which moves in W4);
  - `MAIL_DISABLED_MARKER` definitions: 2 → 1;
  - each writer's record mode unchanged (the W0 pin);
  - catch-up wire bytes unchanged (no `pwa/` file touched).
- **Waits for:**
  - #397 (path identity W1a) to merge. It edits `watch.ts`, `childReclaim.ts`, `expireArchived.ts`, `coord/routes.ts`, `server.ts`, `stall.ts` and `coord/reclaim.ts`, which are exactly W1a's feed and switch sites;
  - the Settings redesign's server tasks (`coord/routes.ts`, `server.ts`), merged or line-disjoint per rule 6;
  - coordinator-first's remaining server tasks and CB W1 observe's server half, for any shared lane.
- **Does not wait for** hibernation Task 19. `stopDoneSweep.ts` and `hibernateSweep.ts` are not touched, so the shadow measurement runs on unchanged code, and W1a's exit does not depend on an undated operator act.

### 5.4 W1b: schedule, latches, one listing, `ccdCan`, the TS redactor (K11, K13's listing, K12's `ccdCan`, K7's TS half)

- **Tickets:** ARCH-68, -76, -51, -09, -71, -66.
- **Exit (GATES):**
  - cadence clocks, by name (the census list): `lastTaskSweep`, `lastUsageSweep`, `lastPrSweep`, `lastCapsAt`, `lastCatalogueAt`, `lastInventoryAt`, `lastServerCapsAt`, `lastNameSweep`, `lastDivergenceSweep`, `lastChildReclaimSweep`, `lastCollectSweep`, `lastLifecycleSweep`, `lastClaimRenew`, `lastClaimLapse`, `lastStallSweep`, `lastApprovalPrune`, `lastDigestBeat`, `lastArchivedExpirySweep`, `lastAskSweep`, `lastDeadCoordinatorSweep`, `lastLedgerReconcile`, `lastMailSweep`, `lastReadinessSweep`: 23 → 0. `lastHibernateSweep` and `lastStopDoneSweep` move in W4 (25 → 0 overall);
  - safety intervals declared as references to their source cadence: 3 of 3;
  - hand-rolled change latches: ≥4 → 0 (`changeLatch`);
  - registry listings per tick: ≤ 1, counted by an instrumented fake FleetIO;
  - `verbSupported`/`capSupported` choices at call sites → one `ccdCan(row)`;
  - TS redactor rule tables: 3 → 1 module with profiles. The egress corpus pin is unchanged byte for byte. The history-index profile is deferred until history W2 merges.
- **OBSERVATION:** `watch.ts` lines, recorded at exit.
- **Waits for:** W1a; the history programme's W2 for ARCH-66's history profile; rule 6 for any open lane PR.

### 5.5 W2: one reading of a session (K3, K4 server half, K13)

- **Tickets:** ARCH-47 (widening `SingleRead` first), -48, -50 (server), -52, -53.
- **Exit (GATES):**
  - server status-derivation ladders: 7 → 1 function (`readSession`), with display readers on the tick's reading and destructive readers on a fresh one;
  - `SessionStream` polls: 4 → 0;
  - dialog frames per change per socket: 2 → 1;
  - the "MIRRORED" comment is gone, replaced by the truth-table test;
  - idle decisions: 6 readers → 1 reading plus 4 named policies.
- **OBSERVATION:** `sessionws.ts` lines.
- **Waits for:** W1b (the one listing, `runLane`); #397, because `readSession` consumes the server's id gate.
- **PWA half:** ARCH-49 moves to W7.

### 5.6 W3: attention routing, server only (K5)

- **Tickets:** ARCH-19 and ARCH-13a first, then ARCH-56, the server halves of -57 and -58, and -59.
- **Exit (GATES):**
  - the `/api/questions/:id/*` family exists in `coord/routes.ts`, behind its one auth gate;
  - the old doors stay as redirects (rule 4: two releases as the only reader, or a cap token), and are removed in W7's tail;
  - in-memory question maps: 2 → 0;
  - retention sweeps: 2 → 1;
  - the approval signing bytes are unchanged. A pin holds `approval-verify.mjs`'s SHA and a signed-ruling fixture.
- **Waits for:**
  - coordinator-first's remaining approval and ask tasks (it is live, so the wave must not move its tables mid-rollout);
  - ARCH-15 (the guarded delivery writer);
  - W1a's funnel.
- **PWA half:** the answer reducer (ARCH-29) and `askLive`'s client pairing removal move to W7. They edit `SessionScreen.tsx`, `lib/api.ts` and `session/*` (`AskParts`, `DialogSheet`, `EnvelopeSheet`), which skins W2 and W3, CB W1 observe and Settings also edit.

### 5.7 W4: workspace lifecycle, server (K1)

- **Tickets:** ARCH-36, -35, -41, -42, then -43 (sleep, with its per-policy rows, the stop-done feed pair and switch read, and the two sleep-lane clocks), then -44's three reasons, one PR each. The `child-spent` PR's first commit is ARCH-77.
- **Exit (GATES):**
  - end-of-life lanes: 6 → 2 deciders + 2 executors, with the dead-coordinator lane in C5's set;
  - `stopDone.ts`'s copy of the verdict deleted;
  - feed writers in the executors: 0 (funnel only); `recordFeedEvent` call lines outside the store: 2 → 1;
  - private `reclaim-paused` parsers: 1 → 0;
  - cadence clocks: 2 → 0;
  - "bound by coordination" readers: 9 → 1;
  - every executor re-measures at the act (the pin's "pause raised between pass and act holds" row stays green).
- **OBSERVATION:** the 12 files' 10,750 lines, recorded at exit.
- **Waits for:**
  - hibernation Task 19 (shadow week, then the operator's arming act), because ARCH-43 changes the lane it measures;
  - W1a, W1b (switches, funnel, schedule) and W2 (`SessionReading`, viewer).
- **Rollback per reason:** the old executor stays until the last reason has moved. `expire-lane-live`, `collect-lane-live`, `dead-coordinator-lane-live`, `hibernate-live`, `stop-done-disabled` and ARCH-77's child-reclaim switch are unchanged in meaning, so the operator can disarm **any one** reason without a deploy.

### 5.8 W5: ccd in place (K2, K9's bash half, K7's docs half, K16, K18, K4's ccd half)

- **Tickets:** ARCH-14, -25, then ARCH-45's helpers, then -46, -65, -67, -72, -74, then -50 (ccd half).
- **Exit (GATES):**
  - byte-identical refusal-helper pairs: 0, with `refusal-v1` in the one helper;
  - audit-token and lock plumbing copies: → 1;
  - shared reap↔reclaim tail-step helpers: the named list in ARCH-45, each with at least two callers;
  - `_reg_purge` call lines outside named helpers: counted by the census, and the count only shrinks;
  - the doctor's `def prompt` copy: 0;
  - continued-in readers: 3 → 2;
  - python redactor: 0;
  - auth-dead writers: 3 → 1 primitive; `<w>-disabled` writers: → 1 write primitive;
  - the hook's already-identical helpers and constants come from `ccrc:generated`/`ccrc restamp`, pinned; the lock region is unchanged;
  - the server's inject suites, run against a fixture ccd, pass unchanged. That proves argv and envelope compatibility.
- **OBSERVATION:** lines in the four destructive regions.
- **Waits for:**
  - #435 (continuity 4b, which edits `_ci_*`, the transcript readers and pressure reap);
  - path identity W1b (#735);
  - #722 (neutral vocabulary in `ccd`, `ccrc`, the hook and the doctor) and #740 (the plist writer and `_launchd_class`);
  - Accounts connect's ccd account-verb tasks (#745 and successors) for ARCH-72's auth-dead and disabled parts;
  - CB W2/W3's ccd roll/install verbs for any shared helper they touch;
  - the tick-diet budget fixtures for ARCH-50's ccd half (any tick-path line).
- **Never touches:** `_auto_swap_check`'s decision logic, `_swap_idle_gate`, `cmd_swap`, `_swap_target`, the pool grammar, or the strand path. Only the auth-dead write call is swapped for the primitive, behaviour-identical and pinned.

### 5.9 W6: run binding (K10)

- **Tickets:** ARCH-60, -61 (server half), -62.
- **Exit (GATES):**
  - server equality sites: the W0 census count → all through `bindingOf`/`childrenOf`;
  - the store's twelve binding readers: ≤ 4;
  - a CCRCP-198 fixture (two runs naming one worker; a recycled id; the open-vs-newest pair) goes red on old code and green on new.
- **Waits for:**
  - the coordinator↔child durability investigation;
  - #397 and path identity W2 (#436);
  - ARCH-22 and ARCH-35, because the binding's writers become deciders first.
- **Not waited for:** #762 is the immediate CCRCP-198 PWA fix and lands on its own.

### 5.10 W7: PWA, one owner per fact (K14, K15, and K3/K5/K8/K10's PWA halves)

- **Tickets:** ARCH-28, -30, -13b, -49, -29 (the answer reducer), the PWA halves of -57, -58 and -61, -64, -75. Its tail removes W3's redirected doors once rule 4's horizon has passed.
- **Exit (GATES):**
  - `/api/accounts` pollers: 5 → 1;
  - poll skeletons: 4 → 1;
  - `visibilitychange` listeners: 14 → 1;
  - storage wrappers: 8 → 1;
  - inline `status === 'dead'`: 13 → 0;
  - PWA run↔session matchers: 5 → 0, with the open-run policy named;
  - PWA answer paths: 3 → 1 reducer; `askLive` client pairing: 0;
  - `sessionPath` call sites: inline `/s/${…}` 9 → 0;
  - `BUCKET_ORDER` definitions: 2 → 1.
- **OBSERVATION:** `lib/api.ts` lines.
- **Waits for:**
  - the skins W2 shells and W3 screens chain (it edits `app.tsx`, `shell.css`, `FleetScreen`, `SessionHeader`, `SessionScreen`, `session/*`, `lib/api.ts`, `fleet.css`), which must be fully merged;
  - the Settings redesign (`SettingsScreen`, `AccountsScreen`, `lib/api.ts`);
  - Accounts connect's PWA tasks (`AccountsScreen`, the pickers);
  - CB W1 observe's PWA half (`lib/api.ts`);
  - W2, W3 and W6, for the wire fields and doors.
- **This is the only wave that edits `pwa/`**, and rule 8's guard enforces it for every wave before it.

### 5.11 W8: kernel tail (K11's box half, K17)

- **Tickets:** ARCH-69, -73. These can run in parallel with any wave after W0, because they touch only `ccd/ccrc`'s plist generation, the doctor and isolated helpers.
- **Exit (GATES):**
  - restated cadences in the doctor: 14 → 0;
  - update-spawn implementations: 2 (server + agent twin) → 1 `shared/spawn.mjs`; `update-spawn-twin-bodies` removed;
  - `localcaps.ts` and `accounts/ops.ts`: each folded or kept, per its audit.
- **Waits for:** CB W2/W3 (they edit `update/spawn.ts`); #740 (the plist writer in `ccd` and `ccrc`, which ARCH-69 rewrites).

### 5.12 Sequencing at a glance

```
W0 now ─▶ W1a switches+funnel (after #397, Settings server tasks) ─▶ W1b schedule+listing ─▶ W2 one reading ─┬─▶ W4 workspace lifecycle (after Task 19)
   │                                                                                                         ├─▶ W3 attention, server (after coordinator-first tasks, ARCH-15)
   │                                                                                                         └─▶ W6 binding (after durability investigation, #397, #436)
   ├─▶ W5 ccd in place (after #435, #722, #735, #740, A-task ccd verbs, tick-diet fixtures)
   ├─▶ W8 kernel tail (after CB W2/W3, #740)
   └──────────────────────────────────────────────▶ W7 PWA (after skins W2+W3, Settings, Accounts PWA, CB W1 PWA; W2+W3+W6 server halves)
W0 later slices land ahead of W2 (pane corpus, truth table) and W5 (retire-verdict table, manifest).
```

### 5.13 ccd's bash: what stays, what gets a typed boundary, what moves to TS

**What stays bash, and why.**
- **The supervisor loop and every per-tick check:** `_sync_uuid`, `_auto_stale_check`, `_auto_swap_check`, `_auto_compact_check`, `_route_apply_check`.
  - **Cost argued [I]:** node starts in about 0.05 s and spawns in 50–80 ms under load [M]. One node exec per tick per session at 55 sessions every 5 s is about 11 execs/s × 0.05 s ≈ **0.55 core** of start-up alone, before any work.
  - The tick-diet programme is removing forks that cost 3.84–4.10 cores [M], so a per-tick node call would spend its savings. The event-gated observer is the road to less tick work, and this wave does not compete with it.
- **Swap, carry, auto-swap, rescue and strand, and the pool name/tag/epoch grammar they read.** They must work with the server down, and the operator ruled that account switching is never blocked. The pool grammar is **on the hot path**: `_auto_swap_check` (`ccd/ccd` ≈:18691) calls `_project_pool_state` (and with it `_pool_name_valid`) before its cooldown gates, again inside `_swap_target`, and twice more on a strand tick, "up to four calls on the tick's worst path" (≈:18776), per session every 5 s. A node call there would cost up to four times the 0.55-core estimate above, and a "node absent → refuse" rule would make auto-swap refuse. It stays bash-authoritative, with its twin pinned.
- **The registry primitives, the locks, the tombstones, and the tmux/systemd/launchd edges.**
- **The destructive verbs, including their act-time re-check.** They share helpers *in bash* where the steps really match (K2).
  - **Cost argued:** about 10k lines of incident-hardened code would have to be rewritten. A TS rewrite re-opens every recorded fix and needs a node runtime inside the lock.
  - Shared helpers get the real win (the refusal, token and lock plumbing, the matching tail steps) at a fraction of the risk, and K2's characterization table makes a later port mechanical if one is ever wanted.

**What gets a typed boundary** (the ACL's outbound half):
- ARCH-14's `refusal-v1` token on every refusal;
- `--json` envelopes whose shapes are declared in `shared/` and decoded by one TS function each. ARCH-23's harness runs ccd's **real** output through that decoder;
- a registry field table (name, writer, reader, format), which ARCH-40's pin checks against the ccd manifest and the hook.

**What moves to a single `.mjs` that bash calls** (the `shared/models.mjs` pattern). Only one thing qualifies, because it is off the hot path, pure and already twinned:
- ccd's docs python redactor (`REDACT_RULES`, ≈:37219), which becomes `node redact.mjs --profile docs`, called once per docs verb.

The cost of this move:
- node is already required on fleet boxes, because the hook runs `approval-verify.mjs` and `compact-card.mjs` [M];
- 0.05 s per call at docs-verb cadence is negligible;
- the new failure mode is "node absent", and the **docs verb** must then refuse loudly, never fall back to a stale bash copy. No swap, carry, tick or destructive path gains a node dependency.

**Not ccd logic, so not part of this question:** `base-url` is a TS ↔ bare-node twin (`server/test/base-url.test.ts`), and roster exec kinds live only in `shared/roster-json.mjs`/`roster.ts` (ccrc only cites them). Making the `.mjs` the one implementation with a `.ts` re-export is a kernel item (TS ↔ mjs). The roster half waits for the history programme's W2, which edits `shared/roster-json.mjs`. Neither removes a ccd parity pin.

**What does not move:**
- the retire deciders, which stay in ccd at act time (ARCH-02b's proposed rejection of moving them server-side holds);
- the auto-swap decision, its gate (`_swap_idle_gate`) and the pool grammar it reads;
- the continuation reader on the tick.

**Splitting the `ccd/ccd` file** is not in this wave. ARCH-34's manifest comes first, runtime-sourced siblings are proposed for rejection (ARCH-02b), and build-time assembly is a later operator decision.

## 6. Decisions for the operator

Each decision lists its options and marks one **recommended**. Nothing here is decided until the operator rules.

**O1. The scope of the first wave.**
- (a) Rev 0's W0 + W1: every prerequisite pin, then all the server funnels (switches, funnel, schedule, listing, redactor) as one wave. W0 alone is 9 tickets plus a whole-file manifest and three corpora, and W1 is 8 tickets in the busiest file, blocked behind #397. Its largest count (the cadence clocks) removes the least risk.
- (b) W0 + W4 first, because the workspace end of life is the overlap the operator has felt most. It has to wait for hibernation Task 19 anyway, and without W1a's funnel and switches it would build a fifth executor shape first.
- (c) Start every wave whose wait-list is empty, in parallel. This is the fastest calendar, but it puts several series in `watch.ts` at once, against §5.1 rule 6.
- (d) **A sliced W0 (only the pins W1a needs), then W1a: `SWITCHES` and the `notify` funnel, without stop-done, after #397 merges.** Scheduling, latches, the one listing, `ccdCan` and the TS redactor follow as W1b. It removes the duplicates that have caused incidents (a pause read ten ways; sixteen hand-written feed writes) soonest, touches no PWA file and no ccd byte, does not depend on Task 19, and is about four PRs. The CCRCP-198 PWA disagreement is already being fixed on its own (#762), so it does not need to wait for W6. **Recommended.**

**O2. Does ccd logic move to TS?**
- (a) No. Consolidate everything in bash and keep every cross-language twin pinned.
- (b) **One bash-to-node move only: ccd's docs python redactor becomes `node redact.mjs --profile docs`, at docs-verb cadence.** Everything on the tick, swap, carry and destructive paths stays bash, including the pool grammar, which the auto-swap reads up to four times a tick (§5.13). **Recommended.** It removes one three-language rule set (and `docs-parity`'s python leg) at about 0.05 s per docs verb. It also needs the operator to confirm that "a single `.mjs` called from bash" is *not* the "compiling policy across languages" that ARCH-02b proposes to reject. (The base-url and roster consolidations are TS ↔ mjs, not ccd logic, and are not part of this question.)
- (c) Move the retire and placement deciders to the server and keep ccd as a pure actuator. This contradicts ARCH-02b's proposed rejection, would make retire and auto-swap depend on the server being up, and would rewrite about 10k lines of incident-hardened bash. **Not recommended.**

**O3. How much in-flight work pauses?**
- (a) **Nothing pauses.** Every wave waits behind the programmes it would collide with (§5.12), and the only cost is calendar time. **Recommended.**
- (b) Freeze new lanes in `watch.ts` (any PR adding a `last*` field or a feed pair) from the day W1a starts until it ends, so the counts stop growing. This is cheap and could be combined with (a) as an amendment.
- (c) Pause hibernation's arming until W4 lands, so the armed lane is the consolidated one. This delays a measured memory win, so it is not recommended.

**O4. One scheduler, or a scheduler per context?**
- (a) **One `LANE_SCHEDULE` table and `runLane` helper inside `FleetWatcher`**, with the deciders in per-context L1 modules. This keeps 08-10's "no lane interface" and ARCH-02b's proposed re-affirmation. **Recommended.**
- (b) One scheduler class per context (Workspace, Coordination, Attention, …), each owning its lanes. This reads well, but it reopens the rejected lane interface, and ARCH-02b says DECIDE would then be re-planned.
- (c) Leave scheduling as it is and do only the deciders. This leaves the about 25 hand-kept cadence clocks and the restated timer cadences.

**O5. Asks and approvals: one table or two?**
- (a) **One module and one aggregate type over the two existing tables.** No coord.db migration while coordinator-first is live. **Recommended.**
- (b) Merge them into one `questions` table with a `kind` column. This is cleaner, but it needs a data migration and a rollback story for a live feature.
- (c) Leave them as two lanes. This leaves the 6 doors and the retention-in-the-wrong-sweep.

**O6. Expiry's viewer ceiling.** Sleep defers on *open* and retire on *visible*, as D-5242 already defines; that is not in question. Stop-done becomes the `run-done` row of the sleep lane with its own arming, kill switch, cadence, caps and retry (K1), so it stays live and hibernation stays shadow; that is not in question either. The one open point: expiry defers on a visible viewer with "No ceiling" (`expireArchived.ts` ≈:81), while child reclaim has a ceiling.
- (a) **Keep expiry's unbounded deferral.** It was an explicit choice, an archived workspace someone is looking at costs only disk, and changing it is a behaviour commit with no incident behind it. **Recommended.**
- (b) Give every retire reason one bounded ceiling. This is uniform, but it is a behaviour change to a deliberate choice.

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

**O11. The catch-up authority.**
- (a) **The ring stays the `{epoch, seq}` authority and `feed_events` its archive.** Catch-up keeps working on a box with no coord.db, and the wire is unchanged. **Recommended.**
- (b) Invert it: catch-up reads `feed_events` and the ring becomes its cache. This gives one store, but it breaks catch-up on a box without coord.db unless a resync story is built, and it changes a PWA-facing contract, which would move the change into W7.

**O12. A server-computed swap suggestion.**
- (a) **Not in this wave.** SwapSheet keeps `leastLoaded` as its own question (K15). **Recommended.**
- (b) Add a server field that mirrors ccd's `_swap_target` for one session, so the PWA's swap suggestion and ccd's act agree by construction. That is new behaviour on the account-switching UI and belongs to the Accounts programme, not here.

## 7. Risks, and what must not break

**Operator rulings, held by tests:**
- **Account switching and the auto-swap are never blocked.**
  - No wave adds a gate, refusal, node call or server dependency to `_auto_swap_check`, `_swap_idle_gate`, `_swap_target`, the pool grammar, the strand path, `cmd_swap`, `swap-self` or the swap routes.
  - W5 touches only the auth-dead write call on that path, and replaces it with a behaviour-identical primitive.
  - A pin asserts that the swap path's refusal set **and `_swap_idle_gate`'s verdict table** (including the D-5349 narrow-pane stand-down and the quiet window) are unchanged by every wave.
  - The per-account `<w>-disabled` switch keeps its meaning as an operator switch; no wave re-projects it from the roster. The PWA's swap suggestion (SwapSheet) is unchanged.
- **No herd restarts.** No wave requires a supervisor restart or its own roll; ccd changes ride ordinary releases. The existing `try-restart claude-session@*` sweep in `ccrc update` (≈:21424) is a herd risk this wave neither fixes nor worsens. It deserves its own ticket.
- **Agent-first deploys.** The only agent-touching change (`shared/spawn.mjs`, K17) deploys agent lane first, like every release.
- **Recorded rulings this wave keeps:** stop-done live under its own switches (D-5370, D-5427); hibernation shadow until Task 19; "every reclaim lands in the feed; no push per reap"; D-5242's open/visible presence contract; expiry's "No ceiling" unless §6 O6 rules otherwise; the history redactor's W2-D54 order.
- **ccrc SAFETY rules.** No wave runs `ws-*`, `ws-expire`, `ws-reclaim` or `ws-reap`, or touches units or tmux, on a fleet box as part of its testing. Characterization runs against fixture registries, the source seam and containers. Arming any changed lane stays an operator act, named under the SAFETY rule in the ask.
- **Improve what exists before inventing.** Every owner in §3 grows out of an existing mechanism: `pushOne` → `notify`, `heldFor` → questions, `_ws_reclaim_ladder`/`_ws_reclaim_tail` → the shared ccd helpers, `RUN_TRANSITIONS` and `shared/lifecycle.ts` → `WORKSPACE_TRANSITIONS`, `models.mjs` → `redact.mjs`, `ccrc:generated`/`ccrc restamp` → the hook's generated helpers, `single-definition.test.ts` → the writers pin. None is a new subsystem.
- **Public repo.** Nothing committed by any wave names a host, an IP, an account or lane name, or a private id. The fixture registries use neutral ids (the vocabulary of #722).

**In-flight programmes:**
- **The skins chain (W2 shells, W3 screens):** **no wave before W7 edits any `pwa/` file**, held by §5.1 rule 8's CI path guard. That covers `app.tsx`, `shell.css`, `FleetScreen`, `SessionHeader`, `SessionScreen`, `session/*`, `lib/api.ts` and `fleet.css`. W3's PWA half and K6's catch-up stay off the PWA until W7, after the chain has merged.
- **The Settings redesign:** W1a waits for its server tasks (`coord/routes.ts`, `server.ts`) or is line-disjoint from them; W7 waits for its PWA tasks.
- **Accounts connect:** W7 waits for its PWA tasks. W5's account parts wait for the A-tasks' ccd verbs and their deny guard, and the disabled switch keeps the split that programme defined.
- **The Claude Code binary lifecycle (CB):** W8 waits for its spawn and roll edits, W1a/W1b yield to its server lane edits, and W7 waits for CB W1's `lib/api.ts` edits.
- **Coordinator-first approvals (live):** the signed-ruling path and the egress redactor are pinned byte for byte, and W3 waits for its remaining tasks.
- **Hibernation:** W4 waits for Task 19's shadow week and arming. No earlier wave touches `stopDoneSweep.ts` or `hibernateSweep.ts`.
- **The ccrc history programme (#737, W2-3, W2-4, W2-decisions):** ARCH-66's history profile and any `shared/roster-json.mjs` change wait for its W2 and its coordinator's ack; `lib.mjs`'s pair index, belt and `redactField` order are out of scope.
- **#397/#436/#735 (path identity):** W1a and W2 wait for #397, W6 for #436, and W5 for #735.
- **#435 (continuity), #722 (vocabulary), #740 (launchd class):** W5 waits for all three, W8 for #740, and W0's later corpora for #722.
- **#762 (CCRCP-198's immediate fix):** lands on its own; W6's fixture includes its case.

**Technical risks:**
- **Consolidation erases an intended difference.**
  - Mitigation: §3.19's table, per-caller verdict columns (K4, K8), and per-reason policy rows (K1, K2).
  - A reviewer asks, for every merged pair: which caller relied on the difference?
- **The funnel changes push timing or order** (K6). Mitigation: the characterization pin records the ring/db/push order and the presence gate for each of the 16 writers before any moves.
- **`SessionReading` changes a lane's verdict at a boundary** (an `unknown` read differently). Mitigation: the truth table over the old ladders is the acceptance test, and any intended change is listed and ruled.
- **A shared ccd helper breaks a destructive verb.** Mitigations:
  - helpers land one per PR, each with all its callers, refusal helper first, tail steps last;
  - the retire-verdict table is run against each;
  - the tombstone and lock are unchanged;
  - the server's inject suites prove argv and envelope compatibility;
  - rollback through `ccrc rollback`.
- **Scanner coverage silently drops when code moves** (08-10 rule e). Mitigation: ARCH-04's visit-count pins and ARCH-06's symbol-keyed pins land in W0.
- **The wave stalls halfway, leaving two owners.** Mitigation: each cluster's old owner is deleted inside its own series. The ratchets make a half-done state visible and stop it growing. Pausing between clusters is safe; pausing *inside* a series is not, so series are kept short (one consumer per commit, at most about 8 commits).
- **Cheap-worker routing stalls on deep ccd edits** (recorded `/handoff` quirk). Mitigation: only literal one-consumer moves and characterization rows go to workers. The skeleton, deciders and swap- or approval-adjacent edits are native.

## 8. Review log (rev 0 → rev 1)

Two reviews of rev 0. Each finding was checked against `origin/main` `c7fe20a22` before it was applied. "Applied" means the correction is in rev 1, and the "Where" column says where. The [M] census was re-run on `c7fe20a22`: `recordFeedEvent` call lines 16, files naming `reclaim-paused` 12, `ccd/ccd` 40,671 lines and 644 functions, `watch.ts` 11,298 lines and `single-definition.test.ts` 7,250 lines are unchanged. The `last*` count was wrong in rev 0 (56 distinct names, not 24).

| # | Sev | Finding (short) | Checked against | Outcome | Where |
|---|---|---|---|---|---|
| R1-1 | high | `<w>-disabled` is an operator switch, not a roster projection | `_acct_mark_off` ≈:7059–7070 (ccrc); `_lane_enabled` ≈:1773 | Applied: write primitive only; listed as legitimately different | C1, K16, §3.19, ARCH-72, §7 |
| R1-2 | high | K4 rewrote `_swap_idle_gate`, the auto-swap gate | ccd ≈:19267 ("ONE GATE, TWO CALLERS", D-5240, D-5349, "falsified") | Applied: out of K4 and ARCH-50; its verdict table pinned | K4, §3.19, ARCH-50, W5, §7 |
| R1-3 | high | executors "do not re-read" deleted the act-time re-measure | `expireArchived.ts` ≈:37/:107 ("NEAREST THE ARGV"); D-5428 in `hibernateSweep.ts` | Applied: the snapshot decides, the act re-measures; "pause between pass and act" pinned | K1, K12, C4, §2.3, §3.19, W0, W4 |
| R1-4 | high | `measureClaimant` fed a stale per-tick reading; D-1144/D-1145 lost | `coord/reclaim.ts` ≈:61–134 | Applied: pure `readSession`; destructive callers read fresh; widen `SingleRead` first | C1, K3, ARCH-47/48, §3.19 |
| R1-5 | med | K6 ignored record modes, the "no push per reap" ruling and the ring authority | `childReclaim.ts` ≈:1679; `watch.ts` ≈:1738, :3103 | Applied: three explicit modes; the ring stays the authority; inversion offered as O11 | C6, K6, ARCH-54, §6 O11 |
| R1-6 | med | K2 overstated; collect is a quarantine move; C4 edges wrong | `_ws_reclaim_ladder` ≈:29920, `_ws_reclaim_tail` ≈:32753, `_ws_collect_move`/`_rows_clear` | Applied: K2 re-scoped to shared helpers; counted-helper exit; edges carry preconditions | K2, C4, ARCH-45/46, W5 |
| R1-7 | med | the K18 lock region differs on purpose | `session-hook.sh` ≈:1364/:1389; `ccd-lifecycle-sites.test.ts` | Applied: codegen limited to identical helpers and constants | K18, ARCH-74, §3.19 |
| R1-8 | med | stop-done "on one clock" un-arms or arms; D-5242 is intended | `stopDone.ts` ≈:74–94; `presence.ts` ≈:28 | Applied: per-policy rows; §1.4 cites D-5242; O6 asks only about expiry's ceiling | §1.4, K1, ARCH-43, §6 O6 |
| R1-9 | med | the aliases are documented derivations; monotonic only for the throttle | `watch.ts` ≈:256–260, :339, :9297 | Applied: safety intervals separate, derivations declared; throttle monotonic, verdicts wall-clock | §2.3, K11, ARCH-68, §6 O4 |
| R1-10 | med | PWA `leastLoaded` answers a swap question, not placement | `SwapSheet.tsx` ≈:169 is its only caller | Applied: kept; server swap suggestion offered as O12 | K15, ARCH-75, §6 O12, §7 |
| R1-11 | med | `update/spawn.ts` is deliberately separate from `exec.ts` | `update/spawn.ts` line 2 | Applied: only the update-spawn twin consolidates; the others are audited | K17, ARCH-73, W8 |
| R1-12 | med | the egress redactor is a security boundary | `coord/redact.ts` header (D-5299, D-5360) | Applied: band 3, byte-for-byte corpus pin, explicit profile subsets | C6, §2.3, K7, ARCH-66, §5.1 rule 7 |
| R1-13 | med | §2.5 is missing two Rejected items; PR lifecycle has no home | 08-10 "Rejected" list | Applied: both rows added with their tests; the PR lifecycle stays in C4 | header, §2.5, C4, C6, K5 |
| R1-14 | low | CCRCP-198's two PWA rules are two different queries | `PrSheet.tsx` ≈:118; `runWords.ts` ≈:258 | Applied: `session.run` and `session.openRun` are named | §1.4, K10, W6 |
| R1-15 | low | heldFor is already one function; route counts unmeasured | `heldFor.ts` line 3 | Applied: credited; counts marked [I] for W0's census; non-child dialogs keep raise-to-operator | §1.1, K5 |
| R1-16 | low | the python reader skips bad lines and truncates to 19 characters | ccd ≈:23685–23750 | Applied: `fromjson?` and truncation required, with fixtures | K9 |
| R1-17 | low | re-count on current origin/main | `c7fe20a22` | Applied: re-counted; only `last*` changed | header, §1.1, this log |
| R2-1 | high | the pool grammar is on the auto-swap hot path; base-url and roster are not ccd twins | ccd ≈:18691, :18776–18784; `base-url.test.ts` | Applied: the pool grammar stays bash; O2(b) narrowed to the docs redactor | In short, §5.13, §6 O2, §7 |
| R2-2 | high | W1 collides with #397 and Settings | `gh pr view 397` (69 files, incl. `watch.ts`, `childReclaim.ts`, `expireArchived.ts`, `coord/routes.ts`, `server.ts`, `stall.ts`, `reclaim.ts`) | Applied: W1a waits for #397 and the Settings server tasks; rule 6 disjointness check | W1a, §5.1 rule 6, §7 |
| R2-3 | high | W3 and K6 touch skins-chain PWA files | the skins W2/W3, CB W1 and Settings plans | Applied: W3 server-only, PWA half in W7; catch-up byte-compatible; rule 8 path guard | K5, K6, W3, W7, §5.1 rule 8, §7 |
| R2-4 | med | the history programme is in flight and unnamed | #737; the 2026-10-19 history W2 plans (roster-json, lifecycle.ts, W2-D54) | Applied: added to Related, §7 and the waits for ARCH-66 and roster-json | header, K7, ARCH-66, W1b, §5.13, §7 |
| R2-5 | med | #740 and #722 are missing from the waits; stamp-line conflict | `gh pr view 740/722` | Applied: W5 and W8 wait for #740; W0's corpora and W5 wait for #722; `ccrc restamp` rule | K18, W0, W5, W8, §5.1 rule 6 |
| R2-6 | med | W1's exit depends on Task 19 | the Settings plan: Task 19 is an operator act with no PR | Applied: W1a never touches stop-done; its pair and reader are counted in W4 | W1a, W4 |
| R2-7 | med | many `last*` fields are not lane clocks | census: 56 names, about 25 cadence clocks | Applied: clocks enumerated by name; latches counted separately | §1.1, §2.3, K11, W1b |
| R2-8 | med | no commit class for intended behaviour changes; no skew test | §5.1 rule 1 | Applied: rule 1b behaviour commits, rule 1c skew tests | §5.1, K6, K11 |
| R2-9 | med | `[I]` line targets and undefined censuses gate nothing | §5 exits | Applied: GATE vs OBSERVATION; census scripts in W0; manifest at merge-base | §5.1 rule 3, every wave |
| R2-10 | med | missed duplicates: `lifecycle.ts`, the tmp-sweep predicate, `ccrc:generated`, latches, ARCH-40 vs single-definition | `shared/lifecycle.ts`; `ccd-tmp-sweep` ≈:39; ccd line 2; `watch.ts` latches | Applied: all five folded in (C4, K3, K18, ARCH-76, ARCH-40) | §1.1, C4, §2.3, K3, K18, ARCH-40/76 |
| R2-11 | low | child-spent cannot be disarmed alone | no child-reclaim live marker in `server/src` | Applied: ARCH-77 off switch, default armed | K12, ARCH-77, W4 |
| R2-12 | low | the rollback horizon after door removal is unstated | §5.1 rule 4 | Applied: per-wire horizon; two releases or a cap token | §5.1 rule 4, K5, W3, W7 |
| R2-13 | low | W0 + W1 is not the smallest high-value first wave; fix CCRCP-198 now | §6 O1 | Applied: O1(d) sliced W0 + W1a is recommended. **Rejected in part:** the standalone CCRCP-198 fix is already open as #762, so the wave adds nothing for it | §6 O1, W0, W1a, W6 |

Found while checking and also corrected: rev 0 called `collect-lane-live` "legacy, ignored". It is the legacy arm of the collect switch, and it still arms the lane (`collectLane.ts` ≈:32). It is kept as a `SWITCHES` row (K12).
