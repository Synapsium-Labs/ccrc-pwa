# The Linear hierarchy: programmes as initiatives, epics as projects, checkpoints as milestones (design)

**Spec** · 2026-11-10 · Status: draft for review, then the operator. The mapping (§3), its reach (every project), ccrc
creating and moving the Linear objects itself, and ccrc's plan as the source of truth are the operator's rulings of
2026-11-10. The drift rule, the one inbound path, the initiatives-off handling, the console acts, the per-project
settings and the migration strategy were proposed to the operator and confirmed the same day ("all looks correct").
Everything else marked **Design call** is the author's, for the operator to check (§16). Docs only: no code ships with
it. Facts about today's tree were read on `origin/main` `945834579` · Related:
`docs/superpowers/specs/2026-10-31-linear-central-key-design.md` (the proxy, the journal, the write-policy port; this
design **reverses its non-goal "initiatives"**, and keeps every anti-goal it lists),
`docs/superpowers/specs/2026-10-31-programme-ledgers-design.md` (Goals, Waiting on you),
`docs/superpowers/specs/2026-11-09-coordinator-autonomy-default-design.md` (the stored definition of done, coordinators
decide by default).

## In short

Linear is used as a flat pile today. Every level of work, from a whole stage of a programme down to one pull request,
is filed as an issue, so a team collects hundreds of open issues that cannot be sorted. This design gives ccrc's plan
two new levels inside a programme, the **epic** and the **checkpoint**, and has ccrc keep a matching Linear hierarchy:

| ccrc | Linear |
|---|---|
| product (a ccrc project, or several sharing a team key) | Team |
| programme | Initiative |
| epic | Project |
| checkpoint | Project milestone |
| ticket (a wave's run, a task, a bug, a follow-up) | Issue |

ccrc's plan is the source of truth. ccrc creates the Linear objects when a programme opens, moves them as waves land and
checkpoints are met, and closes them when the programme ends. People read Linear and do not edit it. If someone does,
ccrc puts its plan back and says so in a comment. A one-off migration reshapes every team's existing issues into the
hierarchy, one team at a time, each from a map the operator approves in the console. Nothing is deleted.

## 1. Why

### 1.1 The request

The operator, 2026-11-10: "tickets in linear are leaf items, and I've been using them to capture all levels of work,
so hundreds of tickets pile up without ability to sort and structure them properly. I want to start using linear
properly."

### 1.2 The pile, measured

The pilot team (the team of ccrc's own repository) on 2026-11-10:

| What | Count |
|---|---|
| Open issues | 220 |
| Open issues that are really a level, not a leaf: checkpoint rows of a programme ("CP-nn"), `[EPIC]` issues, operator acts | dozens |
| Open issues whose work had already finished, never closed | 16 |
| Open issues superseded by later work, never closed | 12 |

So more than a quarter of the open list is not open work at all, and the rest has no structure to sort it by.

### 1.3 Why it happens (read from the code)

- **ccrc has no level between a programme and a run.** The planning model is `programs` (slug, title, state, home
  project, spec pin, `doneWhen`) and `runs` (programme, wave, project, kind, state) in `server/src/coord/schema.ts`.
  The nearest thing to a stage is a wave number. So any stage, gate or operator act that a person wanted to see in
  Linear could only become an issue.
- **The proxy can only write issues.** `server/src/linear/ops.ts` holds the fixed GraphQL documents. Its only
  mutations are `issueCreate`, `issueUpdate`, `commentCreate` and `attachmentLinkURL`. Projects are read as
  `{id name}` only. There are no milestones or initiatives anywhere in `server/src/linear/`.
- **Nothing says when or where to file.** The coordinator and worker skills (`ccd/coordinator-skill/SKILL.md`
  §Linear, `ccd/worker-skill/SKILL.md` §Linear) say only that new tickets go in the team the project's team key names.
  No code files a ticket automatically, and no ccrc record holds a Linear id: tickets tie to runs only by the slug
  convention `key-123-…` (`server/src/linking/policy.ts`, `ticketRefOfBranch`).

## 2. Intent, goals, non-goals, anti-goals

**Intent.** A person opens Linear and sees each product's work as ccrc plans it: programmes, their stages, the gates
inside each stage, and the tickets under them, always current, with nobody maintaining it by hand.

**Goals.**
1. ccrc's plan has epics and checkpoints. A coordinator declares them, and every wave and run attaches to one.
2. For every project with a team key, ccrc creates, updates and closes the matching initiative, projects, milestones
   and issues itself, through its own Linear proxy.
3. ccrc is the source of truth. A Linear-side edit to anything ccrc manages is put back, with a comment, and repeated
   drift on one object reaches the operator as a Waiting on you item.
4. The one inbound path: an issue someone files straight into a managed team is taken into the owning coordinator's
   plan and placed.
5. A workspace with initiatives turned off still gets epics and checkpoints. The programme layer waits, and the
   operator is asked to turn the feature on.
6. Every existing team is reshaped into the hierarchy by a migration the operator approves per team, which loses no
   history, keeps every GitHub mirror and can be put back.
7. The operator acts only in the console. The programme and epic pages show the plan and link to Linear.
8. Any installer can use it. Everything is set per project in the console, and nothing in code names a team, a
   workspace or a machine.

**Non-goals.** Reading Linear changes back into the plan. Linear cycles, documents, roadmaps, custom views, project
updates (status posts) and webhooks. Estimates, assignees and priorities as plan fields. A Linear screen inside the
console: the console links to Linear's own views. Moving an issue between workspaces. Any change to Linear's own
GitHub integration.

**Anti-goals.** Each of these is a failure even if the rest works:
- A person has to fix Linear by hand to keep it right, at any point, the migration included.
- ccrc adopts a Linear-side edit into its plan, silently or otherwise. The only inbound path is §7.5.
- A migration loses history: an issue deleted, a comment lost, a GitHub mirror issue orphaned or a closed issue
  rewritten.
- An edit war: ccrc and a person or an integration rewriting the same field forever without anyone being told.
- Anything machine-specific or installer-specific in code: a team key, a workspace, a host or a path.
- A session holding the Linear key, a raw GraphQL passthrough, an MCP server, or a second fetch path beside
  `callLinear` (the central-key spec's anti-goals stand).
- A coordinator waiting on the operator for a filing decision its plan already answers.

## 3. The mapping (ruled)

| ccrc | What it is | Linear object | Created | Closed |
|---|---|---|---|---|
| **Product** | A ccrc project (a repository), or several projects that share one team key | **Team** | Never: the team exists; the project's team key names it | Never |
| **Programme** | A goal-sized body of work with a spec, a pinned "In short" and a done-when list | **Initiative** | When the programme's plan is first declared (§5.3) | When the programme is done or abandoned |
| **Epic** | One plan-sized stage of a programme. Examples: the history programme's W1 capture, W2 evaluation, W3 steering, W4 subagents; test-box connect; the runs rebuild | **Project** | With the programme, or when the coordinator adds it | When all its checkpoints are met and its tickets are closed, or when it is dropped |
| **Checkpoint** | A gate inside an epic: an acceptance row, an operator act, or a point measured and recorded. Example, history W3: cohort started, report, bars set, armed | **Project milestone** | With its epic | It has no closed state in Linear; ccrc marks it met (§6.2) |
| **Ticket** | A wave's work run, a task, a bug or a follow-up: something that becomes a pull request or is closed with a reason | **Issue**, in the epic's project and, when it serves one, the checkpoint's milestone | When the plan names it, or when its run opens | When its run lands, or when the plan drops it |

**Products of several repositories.** A product is not a new record. Projects that carry the same team key are one
product, because they file into one team. A programme's initiative lives in the workspace of its home project's team.
An epic whose runs touch projects of several teams in one workspace lists every one of those teams on its Linear
project. **Design call.**

## 4. ccrc's new model

### 4.1 The levels, and how they relate to what exists

- **Programme** is unchanged: `programs` keeps its slug, state, home project, spec pin and `doneWhen` list (1 to 12
  strings, `shared/ledgers.ts`, `DONE_WHEN_MAX_ITEMS`).
- **Epic** is new. A programme has an ordered list of epics. Each has a key (stable, slug grammar), a title, a one-line
  summary and a state: `planned`, `active`, `done` or `dropped`.
- **Checkpoint** is new. An epic has an ordered list of checkpoints. Each has a key, a title, a kind (`acceptance`,
  `operator-act`, `measured`), an optional list of the programme's done-when entries it proves (by index), and a state:
  `open`, `met` or `dropped`. A met checkpoint carries its evidence: a pull request number, an operator item id, or a
  repository path where the measurement is recorded.
- **Ticket** is new as a record. Today a ticket exists only in Linear. Each has a key, a kind (`work`, `task`, `bug`,
  `follow-up`), a title, a body, an epic, an optional checkpoint, a source (`plan`, `worker`, `inbound`) and a state:
  `open`, `started`, `done` or `dropped`.
- **Wave** stays a programme-wide number. Every run of one wave belongs to one epic, so an epic is a contiguous run of
  waves. A run opened into a wave whose earlier runs sit in another epic is refused (`wave-epic-mismatch`).
  **Design call:** waves keep their programme-wide numbering, so ledgers, branch names and the runs screen are
  unchanged.
- **Run.** A work run attaches to exactly one ticket. A review run is never filed: it attaches to the run it reviews,
  as today. A wave of three parallel work runs is three tickets. **Design call.**
- **The done-when list** stays the programme's definition of done. It becomes the initiative's description (§6.1).
  A checkpoint that proves a done-when entry says so, and the programme page shows which entries are proved and which
  are not. The programme's own state still moves only as it does today. Nothing closes a programme automatically.

How epic and ticket states move:

| Record | Moves to | When |
|---|---|---|
| Epic | `active` | Its first run opens |
| Epic | `done` | Every checkpoint is `met` or `dropped`, and no ticket is `open` or `started` |
| Epic | `dropped` | The coordinator drops it, with a reason |
| Checkpoint | `met` | The coordinator records it with evidence (`plan met`), or, for an `operator-act` checkpoint tied to an operator item, ccrc marks it when that item is done. **Design call** |
| Ticket | `started` | Its run is dispatched |
| Ticket | `done` | Its run closes with its pull request merged, or the coordinator closes it with a reason |
| Ticket | `dropped` | The plan drops it, or its run is abandoned and the coordinator does not re-plan it |

### 4.2 Where it is stored

In coord.db, by one new migration. **Design call:** one binding table for every Linear id, rather than a column on
each record, so that one reconciler walks one table.

| Table | Columns (sketch; the builder settles names) |
|---|---|
| `plan_epics` | `id`, `program`, `key`, `ordinal`, `title`, `summary`, `state`, `droppedWhy`, `openedAt`, `doneAt`; unique (`program`, `key`) |
| `plan_checkpoints` | `id`, `epicId`, `key`, `ordinal`, `title`, `kind`, `proves` (JSON array of done-when indexes), `state`, `metAt`, `evidence` (JSON), `itemId`; unique (`epicId`, `key`) |
| `plan_tickets` | `id`, `program` (null for the upkeep epic, §7.6), `epicId`, `checkpointId`, `key`, `kind`, `title`, `body`, `source`, `state`, `runId`; unique (`program`, `key`) |
| `runs` | gains `ticketId` (nullable) |
| `linear_bindings` | `localKind` (`programme`, `epic`, `checkpoint`, `ticket`), `localId`, `workspaceId` (slot UUID), `teamKey`, `linearId` (Linear's UUID), `identifier` (issues only), `fingerprint` (of the managed fields as last written), `syncedAt`, `state` (`pending`, `bound`, `failed`), `driftCount`, `driftSince`, `heldItemId` |
| `linear_migrations` | one row per team migration: `workspaceId`, `teamKey`, `state` (`proposing`, `proposed`, `approved`, `applying`, `applied`, `put-back`, `failed`), `map` (JSON), `itemId`, timestamps |
| `linear_migration_moves` | one row per Linear object the migration changed: `migrationId`, `linearId`, `identifier`, `before` (JSON), `after` (JSON), `appliedAt`, `revertedAt` |
| `project_linking` | gains `initiatives` (`on` or `off`, default `on`) |

A programme, epic or checkpoint that is not yet in Linear simply has no bound row. Bindings are never deleted: a
dropped epic keeps its row, and its Linear project is closed, not removed.

### 4.3 How a coordinator declares the plan

A new `ccrc-api plan` group of verbs, on the box token like `goals` and `items`, rows in `ccd/ccrc-api` and routes
under `/api/programmes/:slug/plan`:

| Verb | What it does |
|---|---|
| `plan put <slug> --json <f>` | Declares or revises the programme's epics and checkpoints, and any tickets already known, as one body keyed by `key`. The server diffs it against the store. A key that disappears is **dropped**, never deleted, and needs a `droppedWhy` |
| `plan show <slug>` | The plan with each record's state and Linear URL |
| `plan met <slug> <checkpoint> --json <f>` | Marks a checkpoint met, with its evidence |
| `plan ticket add <slug> --json <f>` | Adds a ticket to an epic (and a checkpoint) |
| `plan ticket move <slug> <ticket> --json <f>` | Moves a ticket to another epic or checkpoint, or drops it with a reason |
| `plan take <slug> <REF> --json <f>` | Takes an inbound Linear issue into the plan (§7.5) |
| `plan epic drop <slug> <epic> --json <f>` | Drops an epic with a reason |
| `plan map propose <team> --json <f>` | Proposes a team's migration map (§10.3) |

A `plan put` body, in short:

```json
{
  "epics": [
    { "key": "w3-steering", "title": "W3 steering", "summary": "…",
      "checkpoints": [
        { "key": "cohort-started", "title": "Cohort started", "kind": "measured" },
        { "key": "bars-set", "title": "Bars set", "kind": "operator-act", "proves": [2] }
      ],
      "tickets": [ { "key": "w3-1", "kind": "work", "title": "…", "checkpoint": "cohort-started" } ] }
  ]
}
```

Bounds, **Design call:** at most 24 epics in a programme, 16 checkpoints in an epic, and 200 tickets in one body.
Titles follow the Linear title bound in `ops.ts` (255 characters). Every text field passes the `linear-egress`
redactor profile before it is stored, so what is stored is what Linear will get.

**Runs attach.** `runs open` (`POST /api/runs`) gains an optional `ticket` key. A run opened with no ticket, in a
programme that has a plan, gets a new ticket in the epic of its wave, titled from the run's title. A run opened into a
programme with no epic is refused `plan-missing` when the programme was created after this build lands, and allowed
as today for an older programme until its team migrates (§10). **Design call:** that refusal is what makes new
programmes "born in the new shape" rather than a convention.

## 5. The Linear object lifecycle

### 5.1 Who writes

**Design call.** One server-side pass, the **plan sync**, writes every hierarchy object. No session creates or edits
an initiative, a project or a milestone. Sessions change the plan through `ccrc-api plan`, and the sync carries the
change to Linear. This puts the drift rule, the order of creation and the rate budget in one place, and it means a
coordinator that dies mid-wave leaves nothing half-filed.

The sync runs:
- shortly after any plan change, run transition or checkpoint change (debounced per programme; the builder sets the
  delay, a few seconds);
- after any failure, with backoff;
- in the drift pass (§7.2).

It takes every Linear call from the one rate service (`server/src/linear/rate.ts`, the central-key spec §6.7). It
writes through `callLinear`, the write-policy port and the `linear_events` journal like every other write (§8).

### 5.2 Open: when a programme's plan is first declared

In this order, each step binding its id before the next starts, so that a crash resumes and never duplicates:

1. **Initiative** in the home team's workspace, named after the programme, its description built from the pinned
   "In short" and the done-when list (§6.1). Skipped while initiatives are off (§9).
2. **One project per epic**, in the product's team (or teams, §3), linked to the initiative.
3. **One milestone per checkpoint**, in the epic's project, in plan order.
4. **One issue per known ticket**, in the epic's project and the checkpoint's milestone when it has one.

Every create carries a `requestId` (the central-key spec §6.6) built from the binding row, so a retry cannot create a
second object. Where Linear's create has no idempotency key, the sync first reads by its own marker before it creates
again. **Builder:** measure which of the four creates accept an idempotency key.

### 5.3 Move: as waves land and checkpoints are met

| ccrc event | Linear change |
|---|---|
| Plan revised (`plan put`) | New epics, checkpoints and tickets created; renamed ones updated; dropped ones closed (§5.4) |
| Run dispatched | Its issue moves to a started state |
| Run closes merged | Its issue moves to a completed state (often Linear's GitHub integration has already done this, §7.3) |
| Checkpoint met | The milestone's description gains a "Met on <date>: <evidence>" line, and its target date is set to that day |
| Epic `active` | Project status to a started status |
| Epic `done` | Project status to a completed status |
| Programme paused | Initiative description notes it; status unchanged |

**Design call:** a checkpoint has no gate issue of its own. A Linear milestone has no done flag, so "met" is written on
the milestone itself. Adding a gate issue per checkpoint would put levels back into the issue list, which is the pile
this design removes.

### 5.4 Close: at programme end

| ccrc state | Initiative | Projects | Open issues |
|---|---|---|---|
| Programme `done` | Completed | Every epic not already done or dropped is closed as completed | None should remain. Any that do are left open and raised to the coordinator, never closed blind |
| Programme `abandoned` | Completed, with "Abandoned on <date>: <why>" in its description | Canceled | Canceled, with a comment naming the reason |
| Epic `dropped` | — | Canceled, with the reason in its description | Moved by the plan first. Any left are canceled |

Linear statuses are looked up by **type** (`started`, `completed`, `canceled`), never by name, because each workspace
can rename them. **Builder:** confirm the initiative status set the API offers; this design assumes Planned, Active and
Completed, with no canceled initiative.

### 5.5 The ids ccrc stores

| Record | Ids in `linear_bindings` |
|---|---|
| Programme | workspace slot id, initiative UUID |
| Epic | workspace slot id, team key, project UUID |
| Checkpoint | workspace slot id, milestone UUID |
| Ticket | workspace slot id, team key, issue UUID and identifier |

The issue identifier is stored for display and links only. Every write goes by UUID, as `update` does today (the
central-key spec §4.5). An identifier that changes when an issue moves team is refreshed from the next read. ccrc never
writes an identifier into a repository file of a public repository; the linking rules stand
(`server/src/linking/policy.ts`).

## 6. What ccrc writes in Linear

### 6.1 Text

- **Initiative description:** the programme's "In short", then "Done when:" and the done-when list, each entry marked
  proved or not.
- **Project description:** the epic's summary, then its checkpoints as a list with their state.
- **Milestone description:** the checkpoint's kind and, once met, the met line.
- **Issue:** the ticket's title and body.

Every text passes the `linear-egress` redactor profile and ends with the server's fixed footer line, as session writes
do today. No text names a console URL, a host, a session or an account. **Design call:** text that lands on an issue
of a team whose project's linking mode is `public` or `unknown` follows the public-repository rules, because Linear's
GitHub sync can mirror the issue to a public repository.

### 6.2 What ccrc owns

| Object | Fields ccrc owns (drift if changed) | Fields ccrc leaves alone |
|---|---|---|
| Initiative | name, description, status, which projects are linked | everything else |
| Project | name, description, status category, teams, initiative link, which milestones exist and their order | lead, members, dates other than the ones ccrc sets, project updates |
| Milestone | name, description, target date once met, which project | — |
| Issue ccrc created or took in | title, description, team, project, milestone, parent, state **category**, labels ccrc set | assignee, priority, estimate, labels ccrc did not set, subscribers, reactions, attachments, comments |

**Design call:** ccrc owns a state's category, not its name. An issue in "In Progress" and one in "In Review" are both
`started`, so Linear's GitHub integration moving an issue between the two is not drift. Fields ccrc never sets are
never watched, so ccrc does not fight people over assignees or priorities.

## 7. The sync rule

### 7.1 ccrc is the source of truth

ccrc writes its plan to Linear. It never reads a Linear edit back into the plan. The plan changes only through
`ccrc-api plan` (a coordinator), the operator's console acts, and ccrc's own events (runs, items).

### 7.2 Drift detection

The **drift pass** runs per workspace every 30 minutes (**Design call**; the builder may tune it against the rate
service). It reads only what changed since the last pass: initiatives, projects, milestones and issues of managed
teams with an `updatedAt` after the pass's watermark. For each object it has a binding for, it compares the owned fields
(§6.2) with the plan:

- **Matches the plan:** nothing to do.
- **Differs from the plan, and the fingerprint shows ccrc wrote the current value:** the plan has moved and the sync
  has not caught up. The sync writes the plan.
- **Differs from the plan, and ccrc did not write it:** drift. The pass restores the plan's value and leaves a short
  comment.

The restore comment, for example: "ccrc restored this issue's project to *W3 steering*. It had been moved to *Backlog*
on 2026-11-12. ccrc's plan decides where work sits here. To change it, ask the coordinator or use the ccrc console."
On an issue it is an issue comment. **Builder:** confirm where Linear accepts a comment on an initiative, a project and
a milestone. Where it does not, the note goes in the object's description as a dated "Restored" line, kept to the last
three.

### 7.3 What is not drift

- A field ccrc does not own (§6.2).
- A state change inside the same category.
- An issue moved to a completed state by Linear's GitHub integration when ccrc's record shows the ticket's pull request
  merged. If ccrc has not yet recorded the merge, the pass waits one more pass before it calls it drift. **Design
  call.**
- Comments, from anyone. ccrc does not act on them, and their text is data, never instructions (the central-key spec
  §5.4).

### 7.4 Persistent drift

When one object is restored three times within seven days (**Design call**), ccrc raises a Waiting on you item:

- **What it shows:** the object, the field, each value it was changed to, when, and by which Linear user or
  integration (as Linear names them, shown as untrusted text).
- **Its acts:** *Hand to the coordinator* (the existing `hand-to-coordinator` door: the coordinator decides whether the
  plan should change and changes it through `plan`), or *Keep the plan* (ccrc goes on restoring).
- **While it is open,** ccrc still restores at most once per pass, and comments at most once a day on that object, so an
  edit war with an integration is bounded and visible, never silent and never endless in comments.

A restore that Linear refuses (for example a key without write access to the team) raises the same item at once.

### 7.5 The one inbound path

An issue in a managed team that ccrc has no binding for, created by anyone but ccrc's own key (a person, a colleague,
an integration, or a public GitHub issue synced in), is **inbound**. The drift pass finds it and mails the **owning
coordinator**: the coordinator of the project whose team key names that team. **Design call:** when several projects
share the team key, the owner is the project marked as the team's owning project in the console (default: the first
project that set the key). With no coordinator live, the issue waits and the project's row in the console counts it;
the next coordinator on that project gets it in its card.

The coordinator reads the issue as untrusted data and decides, by its own goals as the autonomy default says:
- **A bug or small task:** `plan take` places it in an epic and checkpoint of a live programme, or in the team's upkeep
  epic (§7.6). The sync re-parents it, and from then on ccrc owns its fields (§6.2). Its reporter's title and text are
  kept as the ticket's starting text.
- **A duplicate or not a fault:** the coordinator closes it with a comment, through `plan take` with a close reason.
- **A request that would change a programme's scope:** a `decide` item for the operator, because scope is operator-only.

This is the only way anything made in Linear enters ccrc's plan. An edit to a managed object never does.

### 7.6 The upkeep epic

**Design call.** Each managed team has one standing epic that belongs to no programme: **Upkeep**. Its Linear project
is in the team, outside any initiative, with no milestones. Bugs and follow-ups that no live programme owns go there.
It never closes. Its items, and any other item that belongs to no programme (map approvals §10.3, the initiatives-off
item §9), are raised under one reserved programme slug, `linear-sync`, that ccrc creates and the runs screen does not
list. **Builder:** `operator_items.program` is `NOT NULL`; the reserved slug is how such items get a programme without a
schema change to items.

### 7.7 Session writes in managed teams

`linear create`, and `linear update` on an issue ccrc has a binding for, are refused `plan-owned` with the remedy
"file it through `ccrc-api plan ticket add`" (**Design call**). Without this, a session's own `create` would be
treated as inbound, and its `update` as drift. `linear comment` and `linear link` stay as they are. Reads are
unchanged.

## 8. The proxy additions

All of it extends `server/src/linear/`. The central-key spec's rules stand: fixed documents only, a census test over
`LINEAR_DOCUMENTS`, every mutation the operation document of a write row and nowhere else.

### 8.1 New fixed GraphQL documents

| Kind | Documents |
|---|---|
| Reads | initiative by id (with its project links); project by id (with status, teams, initiatives, milestones); project statuses of a workspace (id, name, type); initiatives, projects, milestones and issues changed since a watermark, per workspace and team set; the initiatives capability probe (§9) |
| Writes | `initiativeCreate`, `initiativeUpdate`, `initiativeToProjectCreate`, `initiativeToProjectDelete`, `projectCreate`, `projectUpdate`, `projectMilestoneCreate`, `projectMilestoneUpdate`, `issueRelationCreate` (for "replaced by", §10.4) |
| Changed | `issueCreate` and `issueUpdate` inputs gain `projectMilestoneId`, set by the sync only |

There is no delete or archive document. Nothing in this design removes a Linear object. **Design call.**

### 8.2 Who may call them

**Design call.** The new writes are server-internal operations of the plan sync and the migration, not session verbs.
They live in `LINEAR_OPS`-style rows, so the census and the shaping rules cover them, but no proxy route exposes them,
and the client table in `ccd/ccrc-api` gains no `linear` row. Sessions see the hierarchy through `ccrc-api plan show`,
which carries the Linear URLs. The session `create` body gains no milestone field.

### 8.3 Write policy and journal vocabulary

- `LinearWriteAsk` (`server/src/linear/policy.ts`) gains an actor kind `{ kind: 'ccrc'; pass: 'plan-sync' |
  'drift-restore' | 'migration' | 'put-back' }` beside `session`, and its `op` gains `initiative-create`,
  `initiative-update`, `initiative-link`, `initiative-unlink`, `project-create`, `project-update`, `milestone-create`,
  `milestone-update` and `relation-create`. The resource gains the object's kind and UUID. The port's rule stands: the
  actor is attribution, never a grant.
- `LINEAR_JOURNAL_OPS` (`server/src/linear/journal.ts`) gains the same ops, each with its closed list of field names.
  A ccrc write records `sessionId` and `sessionUuid` null and `actor` as `ccrc:<pass>`. `target` gains the UUID grammar
  for the new object kinds (today it holds only an issue identifier), and `result` holds the created object's UUID, as
  it already does for comments and links. No new column: `op` is checked at run time and the table has no `CHECK` on
  it. The table still holds no free text.

### 8.4 The directory cache

`LinearDirectoryEntries` (`server/src/linear/ops.ts`) gains each workspace's project statuses (with type), its
initiative statuses, and whether initiatives are on. Projects gain their status and team keys. The refresher
(`server/src/linear/refresher.ts`) fills them on its existing ten-minute beat. The sync looks statuses up by type here
and never calls Linear for a name.

## 9. Workspaces with initiatives off

- **Detect.** The capability probe runs when a key is verified and on each directory refresh. **Builder:** one
  workspace has initiatives off today; measure on it which read answers "off" (a field, or a typed error on an
  initiatives read), and pin that answer in a test fixture.
- **Ask.** While a workspace is off and some programme there needs an initiative, ccrc raises one `do` item per
  workspace: "Turn on initiatives in this Linear workspace". It carries the steps and an act, *Check again*, which
  re-runs the probe. The item closes itself when a probe finds it on.
- **Partial operation.** Epics, checkpoints and tickets are created and kept as usual. The initiative step is skipped,
  and each project's description names its programme. When the feature comes on, the next sync creates the
  initiatives and links the existing projects. Nothing is re-created.
- **Off by choice.** A project whose "File into initiatives" setting is off (§11.1) runs the same partial operation and
  raises no item.

## 10. The migration

### 10.1 What it does

Two halves, done together for each programme:
- **Reshape Linear:** existing issues into initiatives, projects and milestones, and stale ones closed.
- **Reshape ccrc:** each live programme gets its epics and checkpoints, with the Linear ids attached.

The ccrc half comes first within a programme: the map declares the epics and checkpoints, the plan sync creates their
Linear objects from the plan, and then the migration moves the existing issues into them. So the migration never
builds Linear structure that ccrc does not hold.

### 10.2 Order

1. **The pilot team** (the team of ccrc's own repository) on its own. The operator reads its report before the next
   team starts.
2. **The remaining teams in the pilot's workspace**, one team at a time.
3. **The remaining teams in each other workspace**, one team at a time.

Only teams that some ccrc project names by its team key are migrated. A team no project names is not touched.
**Design call.**

### 10.3 Per team: map, approve, apply, report

1. **Map.** ccrc asks the team's owning coordinator (§7.5) to propose the map, through `ccrc-api plan map propose`. The
   map accounts for every open issue in the team, and nothing else. For each issue it says one of:

   | Class | Becomes |
   |---|---|
   | A programme-level issue | The programme's initiative (the issue is replaced, §10.4) |
   | An epic-level issue (`[EPIC]`, a stage) | An epic and its project (replaced) |
   | A checkpoint-level issue (a "CP-nn" row, an operator act, a measured gate) | A checkpoint and its milestone (replaced) |
   | A leaf of a live or past programme | A ticket, moved into its epic's project and milestone |
   | A leaf no programme owns | A ticket in the upkeep epic |
   | Finished but never closed | Closed as done, with its evidence (the merged pull request) |
   | Superseded | Closed as canceled, related to its successor |
   | Stale, no owner, no recent activity | Proposed for closing; closed only if the map approves it |
   | Unclear | Left where it is, listed for the operator |

   The map may also propose a **backlog programme** to hold a group of related open issues that no programme owns
   (created `paused`, no runs). **Design call:** that is a scope act, so it is visible on the map and approved with it.
   The server checks the map before it raises anything: every open issue is listed once, every target exists in the
   map or the store, and every count adds up.
2. **Approve.** ccrc raises a `decide` item under `linear-sync` with the map on it (§11.3). The operator approves with
   one tap and a confirm, or returns it with a note, which goes back to the coordinator.
3. **Apply.** The server applies the map, deterministically and idempotently, recording each change in
   `linear_migration_moves` before it makes it. Parts that belong to a live programme wait for its wave boundary
   (§10.5).
4. **Report.** When done, the item becomes a report: what was created, what moved, what closed, what was left, with
   counts first and the full list below, and a *Put back* act.

### 10.4 Nothing is deleted

- A replaced level issue is **closed**, as canceled, with a comment naming its new home, and an issue relation to the
  first ticket placed under that home where there is one. Its comments, history and attachments stay where they are.
- Its **GitHub mirror** stays: Linear's sync closes the mirror issue with it, and mirrors the comment. **Design call:**
  for a team whose repository is public, the comment names the new home by title only, with no Linear URL or
  identifier, so the mirrored text follows the public-repository rules.
- Closed issues are never moved or rewritten. Only open issues are reshaped.
- **Put back.** Every move has its `before`. *Put back* replays them in reverse: closed issues reopen to their old
  state, moved issues return to their old project, parent and milestone, and the projects and initiatives the migration
  created are canceled, not removed. The ccrc half is put back too: the programmes' epics and checkpoints are dropped
  with the reason "put back". Put back is offered until the team's next migration, and refuses an issue that has moved
  since (it lists them instead).

### 10.5 Live programmes and new programmes

- **Live programmes migrate at a wave boundary, never mid-run.** ccrc applies a live programme's part of the map only
  when the programme has no run dispatched or working. **Design call:** the boundary is read from run states, so no
  coordinator act is needed and none can be forgotten.
- **New programmes are born in the new shape** from the day the build lands (§4.3, `plan-missing`). They need no
  migration.
- **Programmes already done** are given a completed initiative only when they still own open issues to place.
  Otherwise their closed issues are left as they are. **Design call.**

### 10.6 Cost

The migration takes from the same rate service as everything else, at a lower share than the sync and the sessions, so
a large team can never starve the fleet's Linear use. **Builder:** size the share against the pilot team (about 220 open
issues, so a few hundred writes).

## 11. The console

### 11.1 Per-project setting

Settings > Security > Project linking (`pwa/src/screens/settings/ProjectLinkingCard.tsx`) gains, per project:
- **File into initiatives:** on (default) or off.
- **Owning project:** for a team key shared by several projects, which one owns inbound issues (§7.5).
- The team's **hierarchy state:** "Not migrated", "Map waiting for you", "Migrating", "Migrated on <date>" or "Put back
  on <date>", with a link to the item.

The add-project sheet gains the initiatives toggle beside the team key. Nothing else is configured anywhere else.

### 11.2 Programme and epic pages

- **Programme page** (`/programmes/<slug>`, `pwa/src/ledgers/ProgrammeScreen.tsx`) gains a **Plan** section: each epic
  with its state, its checkpoints met out of all, its open tickets, and an *Open in Linear* link; the done-when list
  with each entry marked proved or not; and *Open in Linear* for the initiative (or, with initiatives off, a note saying
  why there is none).
- **Epic page** (`/programmes/<slug>/epics/<key>`), new: the epic's checkpoints in order, each with its state, met date
  and evidence (a pull request link, an item link, or a repository path that opens in the Docs reader); its tickets with
  their runs; and *Open in Linear* for the project.
- The upkeep epic has a page under the project, reached from the project linking card.

### 11.3 Items

| Item | Kind | On the item | Acts |
|---|---|---|---|
| Approve a team's migration map | `decide` | The map: counts first (created, moved, closed, left), then each programme's epics and checkpoints, then every issue grouped by class | *Approve* (one tap, confirm), *Return* with a note |
| Migration report | `do` | What changed, counts first, then the full list | *Put back* (confirm), *Done* |
| Persistent drift | `decide` | Object, field, values, who, when | *Hand to the coordinator*, *Keep the plan* |
| Initiatives off | `do` | Which workspace, the steps | *Check again* |

Each item carries its control on the item, as ruled. New typed actions join `ItemAction` in `shared/ledgers.ts` beside
`end-run` and `close-refused`, written by the server alone.

### 11.4 Every width, both skins

| Surface | Phone | Laptop | Wide |
|---|---|---|---|
| Programme page, Plan section | One column. Each epic a card: title, state, "3 of 5 met", Linear link. Checkpoints open under the card | Plan beside Goals, epics as rows with checkpoint chips | Epics and their checkpoints in two columns, Goals alongside |
| Epic page | Checkpoints as a list, tickets below | Checkpoints and tickets side by side | Same, with each ticket's run state inline |
| Map approval item | Counts first, then one collapsed group per class; the approve control stays in view | Groups open, two columns of issues | Groups as a table: issue, class, target |
| Migration report | Counts, then collapsed groups; *Put back* at the end | Same, groups open | Table |

Both skins use the same components; nothing in this design is skin-specific.

## 12. The skills

- **Coordinator** (`ccd/coordinator-skill/SKILL.md` §Linear and its wave-lifecycle references): a new programme's plan
  is declared with `plan put` before its first run opens, epics plan-sized and checkpoints as the gates inside them;
  every run opens with its ticket; a checkpoint is recorded with `plan met` and its evidence when it is met; inbound
  mail is handled as §7.5; `linear create` is not used in a managed team. The ledger template's waves table gains an
  epic column. The epics themselves are read with `plan show`, so the ledger holds no second copy of the plan.
- **Worker** (`ccd/worker-skill/SKILL.md` §Linear): a follow-up is filed with `plan ticket add`, kind `follow-up`, into
  its own run's epic. The coordinator is told by mail and may move or drop it. **Design call:** a worker files into its
  own epic only, so it cannot change any other part of the plan.
- **Linear skill** (`ccd/linear-skill/SKILL.md`): the `plan-owned` refusal and its remedy; the rule that the hierarchy
  is ccrc's, and that its restore comments are ccrc's own.
- **Reviewer:** unchanged.

## 13. Reusability for other installers

- Everything is set per project in the console: the team key (exists), "File into initiatives", and the owning
  project. No team key, workspace, team name or status name is written in code. Statuses are found by type.
- The reserved programme slug and the upkeep epic's name are constants of ccrc, not of any installer.
- A project with no team key is untouched, as today.
- An installer with one workspace and one team gets the same behaviour. The migration's order (§10.2) is a rule over
  whatever teams the installer's projects name.
- Tests fake Linear at the `callLinear` boundary and need no workspace, key or network. They run in the fast lane.

## 14. Rollout

1. **Model and proxy:** the migration, the plan verbs, the new documents and ops, the journal and policy vocabulary,
   the directory additions. Inert until a plan exists.
2. **Plan sync and drift pass**, with the `plan-missing` refusal for programmes created from that day.
3. **Console:** the settings, the programme and epic pages, the items.
4. **Skills.**
5. **Migration:** the pilot team, its report read by the operator; then the remaining teams in its workspace; then
   the remaining teams in each other workspace.

## 15. Left to the builder

Each is a detail this design does not settle, named so it is not missed:
1. Which of the four creates accept an idempotency key, and the marker read where one does not (§5.2).
2. The initiative status set the API offers, and how an abandoned programme's initiative is closed if there is a
   canceled status after all (§5.4).
3. Where Linear accepts a comment on an initiative, a project and a milestone (§7.2).
4. Whether a milestone edit moves its project's `updatedAt`, and so how the drift pass reads changed milestones (§7.2).
5. The initiatives-off probe, measured on the workspace that has it off (§9).
6. Whether Linear's GitHub sync mirrors issue relations and attachments, which decides how much of §10.4's link
   reaches the mirror.
7. Table and column names, the debounce delay, and the migration's rate share (§4.2, §5.1, §10.6).
8. A pointer in the central-key spec's §2 to this design's reversal of its initiatives non-goal.
9. The D-numbers, defined in the plan, not here.

## 16. Design calls

Every call the author made without a ruling, for the operator to check:
1. Products of several repositories are projects sharing a team key; an epic lists every team its runs touch (§3).
2. Waves keep programme-wide numbering; all runs of one wave belong to one epic (§4.1).
3. One ticket per work run; review runs are never filed (§4.1).
4. An operator-act checkpoint tied to an item is marked met when the item is done (§4.1).
5. One binding table for every Linear id (§4.2).
6. Plan size bounds: 24 epics, 16 checkpoints per epic, 200 tickets per body (§4.3).
7. `plan-missing`: a programme created after the build cannot open a run without a plan (§4.3).
8. One server-side plan sync writes all hierarchy objects; no session does (§5.1).
9. A checkpoint has no gate issue; "met" is written on the milestone (§5.3).
10. Text on issues of public-mirrored teams follows public-repository rules (§6.1).
11. ccrc owns a state's category, not its name, and never watches fields it does not set (§6.2).
12. The drift pass runs every 30 minutes per workspace (§7.2).
13. An integration's completed state is not drift once ccrc records the merge, with one pass of grace (§7.3).
14. Persistent drift is three restores in seven days; while open, one restore per pass and one comment per day (§7.4).
15. The owning coordinator of a shared team key is the console's owning project (§7.5).
16. One standing upkeep epic per team, outside any initiative; programme-less items go under a reserved `linear-sync`
    slug (§7.6).
17. Session `create` and managed `update` are refused `plan-owned` in managed teams (§7.7).
18. No delete or archive document in the proxy (§8.1).
19. The hierarchy writes are server-internal, not session verbs (§8.2).
20. Only teams some project names are migrated (§10.2).
21. A migration map may propose paused backlog programmes, approved with the map (§10.3).
22. On public teams, the replacement comment names the new home by title only (§10.4).
23. A live programme's wave boundary is read from run states (§10.5).
24. Done programmes get an initiative only when they still own open issues (§10.5).
25. A worker files follow-ups into its own run's epic only (§12).
