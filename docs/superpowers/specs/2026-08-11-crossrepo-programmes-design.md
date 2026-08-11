# Cross-repo programmes — a programme has a home project, its waves may work anywhere, its sessions may write to each other

**Status:** design, 2026-08-11 — drafted against the operator ruling of the
same date, which supersedes the earlier open framing. Task #33. Scoped from
two read-only scouts against `d0c44df` (main, unmodified) while build4 run 1
was live on the fleet; every file:line below was measured, not assumed.

**Inherits:** Build 7's fleet-coordination design
(`docs/superpowers/specs/2026-08-07-build7-fleet-coordination-design.md`) —
its nouns, its storage rules, its non-goals — and Build 2.5's
programme/ledger discipline
(`docs/superpowers/specs/2026-08-06-workspace-hold-programs-design.md`).
House rules honoured: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`
(decision split from acting; typed result unions, no `reply` in L1) and the
artifact lifecycle policy (2026-08-11) — **this spec introduces no new
artifact class**, so it declares no new lifecycle; see §6.

**Intended path:** `docs/superpowers/specs/2026-08-11-cross-repo-programmes-design.md`
(this draft is unwritten to the repo — the drafting session was read-only on a
live fleet).

---

## 1. The ruling, as the model

The operator (2026-08-11, verbatim): *"maybe the ability to work cross-repo if
a programme is initiated inside a specific project is actually sufficient, and
we won't need cross-repo projects in the future, but we should certainly
enable the [easy] two fully"* — with an explicit go-ahead for cross-repo work.

So this is not an options paper. The model is three sentences:

1. **A programme has a HOME PROJECT.** It is initiated there; its spec, plan
   and ledger (`docs/superpowers/programs/<slug>.md`) live there and nowhere
   else; its coordinator session sits there for the programme's whole life.
2. **A wave may dispatch its run into any project.** `runs.project` is already
   per-row; a wave's run works in that repo's checkout, opens that repo's PRs,
   and is verified against that repo's git.
3. **Any session may mail any session, across repos.** The bus is routed by
   session id and knows nothing about projects; the work here is
   discoverability, not mechanism.

Nothing else is enabled. No new noun (§6).

### 1.1 What already works, unmodified

Measured end to end for a hypothetical run(wave 2, `project:'data-internal'`)
under a programme whose wave 1 was `ccrc-pwa`:

- **`runs.project` is a genuine per-row column** (`server/src/coord/schema.ts:70`),
  validated on the wire (`server/src/coord/routes.ts:667-670`) and written by
  `CoordStore.openRun` (`server/src/coord/store.ts:186-239`, INSERT at
  `:234-237`). Nothing about a programme's identity is project-scoped: the
  one-coordinator guard (`store.ts:199-207`) and the idempotent-retry check
  (`store.ts:221-225`) are keyed on `program` alone.
- **Fresh-spawn dispatch is correctly project-scoped**: `CCD_ARGV.wsAdd(run.project)`
  (`server/src/coord/dispatch.ts:150`) and the registry-diff candidate filter
  `r.project === run.project` (`dispatch.ts:171`). A wave that spawns a fresh
  session in another repo works today, hold and all.
- **`verifyDone` measures the right repo.** `readBranchTip(deps.io, deps.cfg.projectsRoot, run.project, branch)`
  (`server/src/coord/fingerprint.ts:164` → `server/src/coord/gitref.ts:61-72`)
  joins one global root (`projectsRoot`, default `/data/projects`,
  `server/src/config.ts:73`) with the **run's own** project. `closeRun` re-runs
  it with `run.project` too (`server/src/coord/close.ts:110`). No fix needed.
- **The close/archive path has no project bug** — asked for, not found. There is
  no autonomous run-close sweep at all; the one autonomous sweep,
  `archiveMerged` (`server/src/watch.ts`), is registry-scoped and already
  handles N projects (per-project PR sweep at `watch.ts:1651-1679`,
  project-count-aware push decoration at `watch.ts:950-955`).
- **Mail is project-agnostic**: `POST /api/mail`, `GET /api/mail` and
  `sessionws.ts` never mention `project`. Routing is by session id, exactly as
  Build 7 designed it. Cross-repo mail therefore needs **zero code**.
- **Caps are deliberately global** (`store.ts:576-618`, one `coordinator_state`
  row) — whole-box concurrency and daily budget. Not broken by projects; see §5
  for what a crossing costs.

**The assumption this all rests on, stated once:** every repo lives on one box,
under one UNIX user, under one `projectsRoot`. `/data/projects/data-internal`
is a sibling of `/data/projects/ccrc-pwa` today, which is why the join above
resolves and why §2's absolute-path mechanism works at all. Cross-box relay
remains a non-goal (Build 7 §10, "tailnet is the boundary"). If the fleet ever
spans boxes, §2 is the first thing that breaks, and it breaks loudly (a path
that does not exist), not silently.

### 1.2 The seams to close

**F1 — the session-reuse path never checks `project`.** The wave ≥ 2 branch
(`dispatch.ts:183-267`) reads the registry record for the reused session
(`dispatch.ts:229`) but never compares `record.project` to `run.project` —
contrast `dispatch.ts:171`, four dozen lines above, which does exactly that for
a fresh spawn. `SessionRecord.project` exists (`server/src/registry.ts:17`) and
is simply unread. The open route has the same hole: `POST /api/runs`
(`routes.ts:660-709`) accepts a `sessionId` to reclaim a workspace
(`routes.ts:694-702`) without ever checking that session's real project against
the `project` it validated two lines earlier (`routes.ts:670`).

This is mechanical, not cosmetic. A ccd workspace is a git worktree permanently
bound to the repo `ws-add` created it against; none of the five whitelisted
verbs (`routes.ts:620-623`) can re-point one. And the coordinator SKILL invites
the mistake in as many words — `ccd/coordinator-skill/references/wave-lifecycle.md`
§1 step 1 ("For wave ≥ 2 … add `"sessionId"`") and SKILL.md's D-1 idiom present
"same sessionId, same workspace" as the default. A coordinator following that
literally while moving a wave to `data-internal` passes wave 1's ccrc-pwa-bound
session id alongside `project:'data-internal'`; nothing refuses it; the brief is
queued unconditionally onto the cleared session (`dispatch.ts:308-310`); a
worker starts working **in the wrong repo's checkout**, and the mismatch first
surfaces one advance later as an opaque `tip-unmeasurable` from
`fingerprint.ts:153-166`.

**Smallest fix — one new typed refusal, checked in two cheap places:**

- New code `project-mismatch` added to `RunRefuseCode`
  (`shared/api.ts:1891-1901`, both the union and `RUN_REFUSE_CODE_MAP`) and to
  the `Extract<…>` list in `DispatchOutcome` (`dispatch.ts:48-51`). It rides the
  existing `refused` shape, so `sendDispatchOutcome` (`routes.ts:106-113`) sends
  it as **409 `{ok:false, refused:'project-mismatch'}`** with no map change, and
  the open route sends the same 409 shape it already uses for
  `claimed-by-another` (`routes.ts:686`).
- **At open (`routes.ts`, immediately after the body validation at `:670-676`,
  BEFORE `coord.openRun`)** — a pure SQL check, no new I/O: if any prior run
  carries this `sessionId` with a different `project`, refuse. Placed before the
  insert so a refusal leaves no `planned` orphan (the hazard `store.ts:221-225`
  was written for). One new read-only store method (`sessionProject(sessionId)`),
  no schema change.
- **At dispatch (`dispatch.ts`, immediately after `recordIdentity` is measured
  at `:229-233`)** — the registry backstop, for a session this programme has
  never seen: `record !== undefined && record.project !== run.project` → refuse.
  It must sit **before** the hold, before `/clear`, and before `markDispatched`,
  for the same reason the identity ladder above it does: past that point the run
  row carries the mis-binding forever and a live worker's context is already
  destroyed. `record === undefined` on a listable registry stays tolerated
  exactly as today (the honest-stale case) — the DB check above already covered
  the coordinator's own idiom, and refusing on a fact we did not measure would
  be the same error in the other direction.

**F2 — the ledger path cannot say which repo.** `POST /api/runs` answers a bare
relative `ledgerPath: docs/superpowers/programs/${program}.md` (`routes.ts:706`),
and its own docstring says the ledger lives "in the project's own repo"
(`routes.ts:646-653`) — singular, written before per-run `project` existed. In
practice "the project's own repo" cashes out as "the coordinator's one fixed
repo": `_ws_least_loaded` picks an account, never a project (Build 7 operator
ruling 2, spec `:294-302`), and nothing in `routes.ts`/`dispatch.ts`/`close.ts`
ever moves the coordinator. True by accident whenever every wave shares one
project; false the moment one does not.

**Smallest fix — one additive nullable column and one optional field:**

- `programs.homeProject TEXT` (nullable — "an older build lacked it", the exact
  shape Build 7 §2 sanctions; forward-only idempotent migration at open, and the
  `user_version` bump).
- `POST /api/runs` accepts an optional `homeProject`; `openRun` writes it on
  first insert, **defaulting to that run's own `project`**. Every existing
  single-project programme therefore gets the right answer with no caller change,
  and a cross-repo programme states its home once, at wave 1.
- The open response gains `ledgerRepo` and `ledgerAbsPath`
  (`<projectsRoot>/<homeProject>/docs/superpowers/programs/<slug>.md`) alongside
  the existing `ledgerPath`, which keeps its shape. The absolute one is what
  §2's briefs cite.
- The docstring at `routes.ts:646-653` and the SKILL's §1 step 1 stop saying
  "the project's own repo" and say "the programme's **home** repo".

*Rejected alternative, recorded so it is not relitigated:* deriving the home
project from `claimedBy` + the registry needs no column, but makes a fact the
programme carries forever depend on a live read that can be degraded and on a
session that may be archived. `dispatch.ts:200-215` already draws exactly this
line for `workspace`/`branch`: a value persisted onto the run row stops being a
transient read and becomes a fact. Same reasoning, same answer.

**F3 — the SKILL's default idiom must learn the project boundary.** In
`references/wave-lifecycle.md` §1 and SKILL.md's D-1 prose: reuse `sessionId`
**only when the next wave stays in the same project**; a wave that changes
project opens **without** `sessionId` and spawns fresh in the target repo
(`dispatch.ts:134-182`, which already works). Consequence to state in the same
paragraph: such a programme now holds two live workspaces, both counted by the
global caps (§5), and the wave-1 workspace stays held until its own final merge.

**F4 — the board never says which repo.** `RunSummary.project` is on the wire
(`shared/api.ts:1922`, populated by `toRunSummary`) and never rendered:
`RunRow` shows `run.workspace ?? run.branch ?? String(run.id)`
(`pwa/src/screens/RunsScreen.tsx:96`) with no project anywhere, and grouping is
programme-only (`pwa/src/fleet/runWords.ts:108-116`, header at
`RunsScreen.tsx:341-345`). An operator watching a programme whose wave 2 landed
in another repo — including via F1's silent mis-bind — gets no signal from the
board at all. Fix in §4.

---

## 2. Briefs for foreign-repo workers

**The mechanism, and it is the whole mechanism:** every repo is on one box under
one UNIX user, so a worker in project B can *read* the home project's plan and
ledger by absolute path — `/data/projects/<homeProject>/docs/superpowers/plans/<plan>.md`
— with no replication, no sync, no new artifact. Plan visibility across repos is
already solved by the filesystem; it was only ever unstated. Briefs therefore
**cite absolute paths into the home repo** rather than carrying content.

Limits, stated honestly:

- It assumes the one-box fleet (§1.1). Cross-box is a non-goal.
- The home checkout is a **live main that moves**. A citation is only true at a
  sha, so a brief cites `path @ <sha>` (or "as of `<sha>`") whenever the content
  matters. This is the same discipline the ledger already has: handoffs are
  commits.
- It is **read-only**. A foreign-repo worker has no worktree in the home repo and
  must not acquire one; everything it writes goes to its own repo, and its
  handoff commit lands there. The ledger is updated by the **coordinator**, in
  the home repo, as it always was.
- The 8KB brief cap (`MAIL_BODY_MAX_BYTES`, `shared/api.ts:1800`, enforced
  identically at `routes.ts:337-339` and `dispatch.ts:97-98`) is not a problem
  for citations. It *is* a problem for documents: of six real cross-repo briefs
  measured in the wild, one fits (6.4KB) and the rest run 9.3–38.7KB. Mail
  carries pointers and excerpts. It does not carry documents. That is the design
  (Build 7 §1: artifacts are **paths, not payloads**), not a limitation to work
  around.

**The contract-excerpt pattern.** For a cross-repo interface — a column set, an
S3 key prefix, a CSV header, a Jira field id — the brief inlines the contract
**verbatim** rather than citing it, and never paraphrases it. The evidence this
is the right split is field-measured: a real seat-roster design documented the
export header as `seat type` when the actual exported header is `Seat Tier` —
a hand-transcribed contract that had already drifted before anyone built against
it; and two teams independently read Jira `customfield_10263` as "severity" and
as `howAffected` (severity is `customfield_12075`), discovered only when one
side audited the other's code. Prose survives a paraphrase. Identifiers do not.
So: **cite prose by path, inline identifiers verbatim, and name the file and sha
the excerpt was copied from** so the next reader can check the copy rather than
trust it.

**Producer-merges-first sequencing.** Where a wave in repo A produces what a
wave in repo B consumes:

1. The producer wave runs and closes. `verifyDone` re-measures its branch tip and
   PR phase against **A's** git (`fingerprint.ts:164`) — the existing
   done-authority, unchanged and now doing real cross-repo work.
2. The consumer wave is opened only after the producer run is `done`, and its
   brief re-copies the contract excerpt **from the merged file at the merge sha**,
   not from the pre-merge brief. Review can and does change a contract between
   brief and merge; a consumer built against the brief is built against a draft.
3. The consumer wave opens **without** `sessionId` (F3) whenever it crosses
   projects.

Failure modes and what refuses:

| failure | what happens today | what refuses |
|---|---|---|
| consumer dispatched before producer merged | consumer builds against a contract that does not exist; in the storage-cutover shape, **silent, permanent data loss** | nothing mechanical — coordinator discipline (see below) |
| consumer given the producer's workspace id to "save a spawn" | worker runs in the producer's repo | **`project-mismatch`** (F1), at open and at dispatch |
| producer's contract drifted in review | consumer implements the draft | discipline: excerpt re-copied at the merge sha, and the brief names it |
| producer merged, consumer never told | the pre-ccrc status quo: copy-paste, or nothing | mail (§3) — addressed, recorded, replayed until acked |

**On the missing mechanical gate, deliberately:** the server has no cross-run
dependency edge, and this spec does not add one. `work_items.blockedBy` is
DAG-lite **within** a run (Build 7 §3). Adding cross-run gates would mean the
server deciding programme order, which is the coordinator's job and the ledger's
record. YAGNI holds until the dogfood produces a real near-miss — that is
open question 2, and the storage-cutover class of change is the case that would
force it.

---

## 3. The interim briefing — zero build, this week

Cross-repo mail already works. Nothing in §1.2 blocks it. What is missing is that
nobody knows it is there, so real cross-repo traffic still moves by rendering a
doc to a URL and hoping a human carries it. The live pair is
**custom-tools ↔ data-internal** (28 commits in the claude-usage area since
2026-07-01; six brief/contract documents addressed cross-repo by header
convention). These flows are mail-shaped **today**, with no build:

- **The asks/notes briefs** (dashboard asks, collector new fields, identity
  resolution, warehouse rates migration 060). Each says outright that nothing is
  time-sensitive and that there is no coupling between the two sides' release
  cadences. One-directional, non-blocking, no return path — exactly what a mail
  is. Mail the pointer plus the identifier excerpt; the receiving side schedules
  its own work, as it already does.
- **Publishing a finished consumer contract** the other way (data-internal →
  custom-tools: "the marts are live, here is the schema"). A same-day mail on
  merge beats the current pattern where the other side finds out later and cites
  the doc after the fact.
- **Corrective facts that currently rot in a doc nobody re-reads** — the Jira
  `customfield_10263`/`12075` semantic split; a runbook of Tailscale hostnames
  most of which is dead because a PR in the *other* repo closed the network path,
  kept alive by banner edits that reach nobody. A mail fired when the fact
  becomes true (or false) reaches the current readers instead of the next audit.
- **"It landed, you're unblocked" triggers** — provided the trigger really is
  "start your independent next step", not "change your code in lockstep".

**The briefing itself, and where it lives:** one section added to the existing
`ccd/coordinator-skill/references/mail-envelope.md` — no new file, no new
artifact class — saying, in three lines: find the recipient's session id
(`ccd ls`, or the board), `POST /api/mail` with `{fromId, fromUuid}` read from
`$REG/<id>.uuid`, `toId` the recipient, `kind: 'finding' | 'status'`, body under
8KB, **artifacts as absolute paths** to the doc in your own repo. Delivery is
idle-gated and replays until acked, so the sender gets a record rather than a
hope. The same three lines belong in the ordinary session's onboarding path,
because the senders here are mostly not coordinators.

What this does **not** replace: the documents themselves. They stay in the
producing repo, where they are written and reviewed. Mail carries the pointer,
the excerpt, and the fact that it exists.

**What still needs real waves** (not a briefing) — recorded so §7's dogfood has
company: a phased storage cutover whose own design names silent data loss if the
consumer phase lands before the producer phase; a CSV/S3 contract whose column
casing had already drifted in writing; an irreversible one-way switch gated on
five acceptance criteria in the other repo. These are the cases where "a person
reads a mail and eyeballs it" is the weak link.

---

## 4. Surfaces — programme grouping beats project grouping

**The rule, when they conflict: programme wins, project is a badge.** A run
belongs to exactly one programme; that is its group. Its project is a property of
the row, never a second grouping level. Rationale: the operator watches a
programme as one thing moving through waves — splitting a programme's rows into
per-project sections would break the one grouping that carries the story, to
show a fact that fits in six characters.

- `runsByProgram` / `programWave` (`runWords.ts:108-131`) are already correctly
  project-agnostic. **No change.**
- `RunRow` (`RunsScreen.tsx:65-124`) gains a project badge next to
  `run.workspace ?? run.branch` (`:96`). Shown when the row's project differs
  from the programme's `homeProject`, or when the group spans more than one
  project — the same "decorate only when it disambiguates" discipline the push
  copy already follows (Build 7 §6: "project-decorated only when >1 project
  active"). Mono voice, no glow; runs are not living panes.
- The group header (`RunsScreen.tsx:341-345`) names the home project once,
  beside `wave N/M`.
- **Task #32 (nest worker workspaces under their programme) extends unchanged:**
  a foreign-repo worker still nests under its programme, not under its project,
  with the project on the nested row. That badge is the operator's only signal
  that a wave crossed — including when it crossed by accident before F1 lands.

---

## 5. Caps and safety at programme scope

- **Caps stay global and unchanged** (`store.ts:576-618`): `maxConcurrentWorkers`,
  `maxSessionsPerDay`, one `coordinator_state` row, whole-box. No per-programme
  cap, no per-project cap — YAGNI, and a per-project budget would be the wrong
  unit anyway (the constraint is the box, not the repo).
- **What a crossing actually costs, stated so it is not a surprise:** a wave that
  changes project spawns fresh rather than reusing (F3), so a cross-repo
  programme holds **two** live workspaces and consumes two slots of concurrency
  and two of the daily budget. An operator who sees `cap-concurrency` during a
  cross-repo programme is seeing this, not a bug.
- **The pause file is global and still stops everything**: `$REG/coordinator-paused`,
  read before any dispatch, operator-owned, no route, no self-unpause. Unchanged.
- **The hold reason is unchanged and still names no project**
  (`server/src/coord/rundefs.ts:60`, `program:<slug> wave:N/M`) — display-only,
  never parsed. A cross-repo programme's two workspaces carry the same reason in
  two repos, which is correct: the reason names the programme, and the run row
  carries the project.
- **`project-mismatch` is the one new mechanical guard** in this spec. Everything
  else remains what Build 7 said it was: attribution not authentication, reap
  human-only by convention plus a speed bump, one coordinator per programme.
- A foreign-repo worker's workspace is an ordinary ccd worktree in that repo, so
  archive, PR sweep and push decoration already handle it (`watch.ts:1651-1679`,
  `:950-955`).

---

## 6. Non-goals — the rejected nouns, so nobody relitigates

- **No "cross-repo project" noun.** No entity that owns several repos. The
  operator's ruling is explicit that this may never be needed.
- **No shared programmes home, no replicated ledger, no ledger sync.** One ledger,
  in the home repo, committed, parsed by nothing. Foreign waves read it by
  absolute path (§2) and never write it.
- **No multi-repo workspace.** A workspace is one worktree in one repo. The five
  whitelisted verbs cannot re-point one and will not learn to.
- **No cross-box anything.** Inherited from Build 7 §10; §2's mechanism depends on
  the single box and says so.
- **No cross-run dependency edges or server-side gates** (§2). `blockedBy` stays
  within a run.
- **No server-side contract registry, schema store, or interface parser.** The
  contract excerpt is prose in a brief and a file in the producing repo.
- **No documents in mail bodies.** Paths, not payloads; 8KB stands.
- **No home-project derivation from the registry** (§1.2 F2, rejected with
  reason).
- **No new artifact class** — therefore no new lifecycle declaration is owed under
  the 2026-08-11 policy. The ledger stays programme-bound (class P); briefs stay
  mail rows; the SKILL additions are edits to files that already exist.

---

## 7. Dogfood

**First cross-repo programme: intake-platform ↔ data-internal**, after Build 4
completes and after F1 and F3 land. Honest sequencing note: that pair is today a
documented *future* dependency, not live traffic — intake's own board design
gates its Phase 3 on a data-internal field, migration and backfill that do not
exist yet, and a grep for "intake" across all of data-internal's docs returns
zero hits. So the dogfood is real work whose start date belongs to that
programme, not to this build. Meanwhile the live pair (custom-tools ↔
data-internal) is served this week by §3's briefing, which needs no build at all.

**Acceptance, when it runs:** wave 1 in data-internal (producer: field,
migration, backfill), wave 2 in intake-platform (consumer), opened without
`sessionId`; the wave-2 brief cites the home repo's plan by absolute path at a
sha and inlines the field contract verbatim from the merged file; the board shows
the crossing on the wave-2 row; the ledger's wave table records both PRs across
two repos; **no content moved by copy-paste**; and `project-mismatch` never
fires in anger — its proof is a test, not an incident.

**Order of work:** F1 (server + shared, with the refusal-table test extended both
directions) → F3 (SKILL, ships via the four-homes install lane) → F2 (migration,
route response, docstring, SKILL) → F4 (PWA badge, under the standing design
gates). F1 before F3 deliberately: the guard must exist before the SKILL starts
telling coordinators to cross repos.

---

## Mail addressing at programme scale (operator dialogue, 2026-08-11 — proposed ruling, folded post-draft)

Raised by the operator: with programmes multiplying (and two able to share a project), who consumes
what mail, how does anyone know which mail belonged to whom — and is an addressee field needed at all?

**The answer separates what today's `toId` conflates.** DELIVERY needs exactly one live session at
injection time (replay-until-ack and the draft-guard hang off it). ADDRESSING is who a message is *for*
in programme terms — a **role**, not a session. The run row already knows both role-holders: its worker
(`sessionId`) and its coordinator (`claimedBy`). So for run-attached mail the addressee is fully
derivable from `{runId, role}` — and `'coordinator'` already resolves exactly this way today.

**Proposed ruling:**
1. Programme mail addresses `to: 'coordinator' | 'worker'` + `runId`. Raw session-id addressing remains
   only for ad-hoc, non-programme mail.
2. Resolution moves from send time to **delivery time** — each sweep resolves the role against the run
   row's *current* occupant. This closes a latent bug: today's frozen `toId` keeps replaying at a dead
   worker's ghost after a re-dispatch; role addressing means a replacement worker inherits its
   predecessor's undelivered mail automatically. Disposable sessions, applied to mail.
3. Consumption stays exactly-one: the resolved role-holder acks; the ack stops replay. Everyone else
   OBSERVES via the programme-filtered feed (`GET /api/mail?program=` and the same filter on
   `/api/feed`, both served by the existing `mail.runId → runs.program` join; the `/mail` screen groups
   by programme).
4. The `runId` discipline becomes load-bearing the moment two programmes are active anywhere: a
   runId-less `'coordinator'` mail already refuses (`unknown-recipient`, no guessing) — the SKILL states
   the rule so workers never meet the refusal.

Motivating scenario (operator's): two programmes in one project — routing already fails shut on
ambiguity; the programme filter and role addressing are what make it *convenient* rather than merely safe.
