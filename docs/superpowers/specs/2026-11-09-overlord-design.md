# The Overlord: one coordinator above every coordinator, that the operator talks to

**Spec** · 2026-11-09 · Status: Draft, rev 5 (a builder's check applied), for the operator's review · Programme: Overlord (slug `overlord`) · Owner:
the Overlord programme's coordinator · Issue: #2491 · Related: `docs/superpowers/specs/2026-11-09-coordinator-autonomy-default-design.md` (D-8126, PR #2487,
not yet merged), D-8125 (PR #2490, a coordinator lifts its own review cap),
`docs/superpowers/specs/2026-10-17-coordinator-first-routing-design.md` and its round 2,
`docs/superpowers/specs/2026-10-31-programme-ledgers-design.md` (Goals and Waiting on you),
`docs/superpowers/specs/2026-10-20-fleet-operations-maintenance-mode-and-programme--design.md` §4 (programme-aware
placement, #749), `docs/superpowers/specs/2026-11-04-runs-screen-rebuild-design.md` (D-8115), `ccd/coordinator-skill/`

This document defines no D-numbers. The programme's plan allocates them when its run opens. Rulings are numbered R1 to
R13 (the operator's) and the author's calls C1 to C52, so the operator can approve or overturn each one by number.

## In short

The Overlord is one long-lived fleet session that sits above every ccrc coordinator. The operator talks to it, and
mostly only to it. It routes each request to the coordinator that owns it, or starts a new coordinator and programme
when none fits. It follows the work up and reports back. It answers the coordinators' operator-bound questions itself,
from the programme's goals and from a private, operator-reviewed database of how the operator works. It raises only
what is truly the operator's.

**What is decided.** The operator ruled the ticket's six open questions on 2026-11-09 (R1 to R6, §2), and ruled the
same day that there is one and only one Overlord (R7), which must live a very long time without memory loss (R8).
After rev 2 the operator ruled that the Overlord is the console's home (R9), that it may read everything (R10), and that
it oversees every project at once and never moves between them (R11). Like the operator, it does brain work, never
execution: every piece of execution goes down the chain to a coordinator (R12). After rev 4 the operator ruled that the
long-life fixes apply to coordinators too, not only to the Overlord (R13).
This spec turns each ruling into a design:
- **One Overlord.** Exactly one exists, for the whole fleet, and the server enforces it. It is one lasting identity,
  not a role that sessions take turns at, and nothing can create a second one (§3.1). It oversees every project at
  once and reads everything ccrc holds, every project's history included (R10, R11, C47).
- **A long life.** One Overlord, many generations. The server renews its context from canonical state before it grows
  long, re-anchors it on every start, proves it remembers with canaries and probes, and audits it daily from outside
  (§3.3). Coordinators get the same fixes through the same mechanism, with the Overlord as one role of it (R13,
  §3.3.9).
- **Its model and its accounts.** It runs Fable, the newest of the family, because the operator selected it (C45). It
  runs on a pool of accounts of its own, which no other session may use and which it never leaves (C46, §3.4).
- **Brain work only.** It understands, decides, routes, answers and follows up. It never executes: no edits, commits,
  pull requests, test runs or dispatches. Execution always goes to a coordinator, which handles it as it sees fit
  (R12, §3.5).
- **Authority.** Authority starts as D-8126's operator-only list, unchanged. It is relaxed one named act at a time
  through operator grants that the server enforces (§7).
- **Knowledge.** Knowledge of the operator is a private store on the server box. It is fed from rulings, from the
  operator's own prompts and from the Overlord chat. The operator reviews and corrects it on an "About you" screen
  (§9).
- **Questions.** Questions reach the Overlord before they reach the operator: one more tier on top of coordinator-first
  routing (§6).
- **Surface.** The Overlord is the console's home: the first screen it opens, with a button in the top menu that
  leads back to it from anywhere (R9, §4).
- **Spawning.** The Overlord spawns coordinators through the operator's own doors, with six named extras (§8).
- **Audit.** Every act lands in one audit log. Each row is marked reversible, compensable or irreversible, and that
  mark comes from the act's kind and never from the Overlord's own say-so (§10).

**What changes.** The changes are:
- one new skill, `ccrc-overlord`;
- one designation row;
- three new coordination tables and one new private store;
- one new hold tier in the question lanes;
- one new clause in the pool rule: an exclusive account serves only its own pool;
- Overlord doors beside the operator's doors;
- one console place;
- one new clause in the coordinator skill.

Everything extends an existing owner; §11 names each one.

**What you must check.** Check the author's calls (§13) and the questions in "Where things stand". This work builds on
D-8126, which is not merged yet: its calls record, its goals read and its decision procedure are prerequisites (§14).

## 1. Context

This section says why the Overlord exists and what it stands on.

### 1.1 The request

The operator's request (issue #2491, 2026-11-09), in short:
- One master coordinator above every coordinator. The operator talks to it, and it carries the operator's messages,
  ideas and wishes to the right coordinators.
- It **relays and routes**: it works out which programme a request belongs to, passes it on in that coordinator's terms,
  follows it up and reports back.
- It **spawns coordinators** when the existing ones are all busy or none fits.
- It **learns the operator**: habits, likes, how they work and how they decide.
- It **acts as the operator inside ccrc**, so most requests need no operator action at all.

Why: today the operator has to find the right coordinator, repeat the context, and answer the same kinds of question
many times. D-8126 measured the cost: over 14 days, coordinator waits on the operator came to more than 1,100 hours,
and about 72% of the long waits were questions the goals already answered. D-8126 makes each coordinator answer more of
its own questions. The Overlord answers most of the rest, and it turns many conversations into one.

### 1.2 What exists today (sourced from the tree at `f3559408e`)

| Piece | What it does today | Where |
|---|---|---|
| Coordinator role | A session is a programme's coordinator because it is `claimedBy` on a non-terminal run. No coordinator table exists. Nested coordinators are refused: `claimant-is-a-worker` | `CoordStore.programmeCoordinator`, `coord/openRun.ts` |
| Coordinator-first routing | A child's question or permission prompt is held for its run's claimant (180 s for asks, 60 s or 180 s for approvals). After that it is released to the operator, and a late answer still wins for asks. Escalation is single-hop | `coord/heldFor.ts`, `coord/questions.ts`, `askwindow.ts` |
| Waiting on you | The coordinator raises items with `items raise` (kinds `decide`, `do`, `value`, `secret`). Only the operator may `tick` or `dismiss`. A tick mails the coordinator in the same transaction | `coord/ledgersRoutes.ts`, `shared/ledgers.ts` |
| Goals | `goals pin`, `goals modify` and `goals merged` write the pin. The read, `GET /api/programmes/:slug/goals`, is session-gated. D-8126 §8.1 opens it to the box token and adds `doneWhen` | `ledgersStore.ts#goalsFor` |
| Operator's correction | `POST /api/digest/correct` queues system mail to a coordinator and marks the row corrected. D-8126 §6 extends it to big calls | `coord/digest.ts` |
| Mail | `POST /api/mail` takes the box token and attribution. Mail is idle-gated, and peer mail is capped at 3 outstanding per pair and 12 per hour. System senders (`operator`, `coordinator`) have no HTTP ingress, and `operator` is never a recipient | `coord/routes.ts`, `coord/rundefsTx.ts` |
| Spawning a coordinator | The operator's Start programme sheet composes `POST /api/sessions`, then `POST /api/sessions/:id/kickoff`. The new session opens its own run. Both routes are cookie-gated | `fleet/StartProgramSheet.tsx`, `coord/kickoff.ts` |
| Fleet reads | Box-token reads cover runs, peers, lifecycle, claims, asks, feed, mail, ledger and landing. `GET /api/fleet`, `/api/programmes`, `/api/waiting` and `/api/coord/caps` are cookie-only | `auth/gate.ts` |
| Operator history | `ccrc history` holds every session's text verbatim, tagged by provenance (`operator` for typed operator text), on the fleet box. Its read verbs are open to sessions, redacted on output | `ccd/history/lib.mjs` |
| An operator profile | None exists anywhere | measured by search, 2026-11-09 |

**Identity, measured.** All fleet sessions run as one UNIX user. Attribution (`id` plus a fresh `.uuid`) proves
freshness, not identity: the code says so, and so do D-8125 and D-8126 (their "Later" entries). The only strong operator
credential is the console's sign-in cookie. The Overlord's authority therefore rests on attribution, like a
coordinator's. §7.4 says what that allows and what it blocks.

## 2. The operator's rulings (2026-11-09), and what each one becomes

The rulings are settled; this spec only turns them into design.

| # | Ruling | What it becomes in this design |
|---|---|---|
| R1 | **Authority.** Start by inheriting D-8126's operator-only list unchanged: irreversible or outward-facing acts, spend beyond plan, goal and scope changes, credentials and access. Design it so the list can be relaxed step by step | An act catalogue that maps each act the Overlord could take to an O-class. The grants table starts empty, and the server refuses an operator-only act with no live grant. A grant names one act, a scope and conditions, and is revocable (§7) |
| R2 | **Knowledge of the operator.** A database distilled from everything about the operator: prompts, decisions, rulings, Waiting on you answers. Say how it is fed, reviewed, corrected and kept private | A private store on the server box with five feeds, a daily distillation, an "About you" review screen, stated-versus-inferred entries, and seven privacy rules (§9) |
| R3 | **Questions from coordinators.** The Overlord answers coordinators' operator-bound questions itself and raises only what is truly the operator's. No coordinator is ever stalled; every question is answered; work moves at speed | An Overlord tier in the question lanes. Items and released asks go to the Overlord first. Whatever falls in an O-class goes to the operator with the Overlord's recommendation. A lapse or a dead Overlord falls through to the operator at once, so the Overlord can never become the stall (§6) |
| R4 | **Surface.** Inside ccrc first and foremost. Mobile push, Telegram and Discord come later and are out of scope | A new Overlord place in the console: its chat, its open requests and its log. The existing web push stays exactly as it is. No new channel (§4) |
| R5 | **Spawning.** Think of it as the operator. It uses ccrc's own tooling the way the operator does, possibly with some extras. Spell out which extras, and why each one is needed | It uses the operator's doors through Overlord doors that log every act. Six extras (E1 to E6) are named with their reasons, and a list of what it explicitly does not get (§8) |
| R6 | **Audit.** A log of everything it relayed, decided and started. Not every item can be reversed, so the log marks which items can be overturned and which cannot | One table, `overlord_acts`, written in the same transaction as the act. Reversibility is derived from the act's kind. Overturns go through the one correction door (§10) |
| R7 | **One and only one Overlord** (the operator, 2026-11-09, after rev 1) | One identity for the whole fleet, enforced by the server. A second can never be started, designated, spawned or nested. Replacing its session is a handover of the same Overlord, never a second one (§3.1) |
| R8 | **Live a very long time** (the operator, 2026-11-09, after rev 1): no memory loss or the other known problems of long-running sessions; use every context, compaction and history technique ccrc has, and research more | One Overlord, many generations: the server renews its context from canonical state before it grows long, re-anchors it on every start, proves it remembers with canaries and probes, and audits it daily from outside (§3.3) |
| R9 | **The Overlord is the home screen** (the operator, 2026-11-09, after rev 2, answering Q1), with a button in the top menu to navigate to it | The console opens on the Overlord. Its door is first in the top menu of both desk skins and on the phone bar, and the wordmark leads to it. The Fleet keeps its own place (§4, C8) |
| R10 | **It can read everything and anything** (the operator, 2026-11-09, after rev 2, answering Q2) | Every read the operator's console has, plus every project's history in full, through Overlord read doors. The history store's "across projects: never" stays true for every other session. Credential stores stay closed (C47) |
| R11 | **It oversees every project at once** (the operator, 2026-11-09, after rev 2): it never moves from one project to another; it is omniscient within the operator's ccrc environment | There is no move between projects. Its session always runs in the dedicated `overlord` project, which is only where its pane lives. Replacing a lost session is a rebind inside that project (§3.1, C2) |
| R12 | **Brain work, not execution** (the operator, 2026-11-09, after rev 3): much like the operator, it is focused on brain work; execution is always handed down the chain to coordinators, who deal with it as they deem necessary | It never edits, commits, opens a pull request, runs a build or a test, opens a run or dispatches a worker. It hands work down as an outcome, never as a method, and does not second-guess how a coordinator executes. A skill clause, a server refusal and an accident guard hold the line (§3.5, C48) |
| R13 | **Coordinators too** (the operator, 2026-11-09, after rev 4): the gaps the research measured (a roll and a wake resume the same conversation, a bare `/compact`, an empty card for a session with no runs, recall barely used, the replay quiz never run) must be fixed for coordinators, not just the Overlord | One continuity mechanism for every long-lived role, the Overlord and coordinators as two rows of one table. Coordinators get renewal, write-through notes, a card that is never empty, role compaction instructions, recall steering and probes, and the Overlord as their outside judge. It ships in its own wave, W1a, before anything Overlord-specific (§3.3.9) |

## 3. What the Overlord is

The Overlord is an ordinary fleet session with a skill, a designation and a place in the console. Its durable state
lives on the server, not in its context window.

```mermaid
flowchart TB
  OP["Operator<br/>console: Overlord place"] <--> OV["The Overlord<br/>one and only one<br/>skill ccrc-overlord"]
  OV <--> SRV["ccrc server<br/>Overlord doors, audit log,<br/>operator model store"]
  SRV <--> C1["Coordinator A<br/>programme a"]
  SRV <--> C2["Coordinator B<br/>programme b"]
  SRV <--> C3["Coordinator C<br/>started by the Overlord"]
  C1 --> W1["workers and reviewers"]
  C2 --> W2["workers and reviewers"]
  C3 --> W3["workers and reviewers"]
  OP -. "still possible: talk to any session directly" .-> C2
```
*Figure 1. The operator talks to the Overlord. The Overlord reaches coordinators only through the server's doors, so
every act it takes is checked and logged. The dotted edge shows that nothing stops the operator from talking to a
coordinator directly.*

### 3.1 One and only one (R7)

There is exactly one Overlord. It is not one per project, per box or per programme, and there is no Overlord of a
subset of the fleet. It is one lasting identity, `overlord`, whose memory (requests, log, operator model, grants) is
the same from the day it starts. The session that runs it is that identity's current body: if the session is lost, the
same Overlord comes back, never a new one beside it. The server enforces this, not the skill:
- **One row, by construction.** `overlord_designation` is a singleton table (`id INTEGER PRIMARY KEY CHECK (id = 1)`).
  A second row cannot exist, so two Overlords cannot exist, whatever any caller does.
- **No second start.** "Start the Overlord" is offered only while no Overlord exists. While one exists, the door refuses
  `overlord-exists` and names it, and the console shows **Open the Overlord** instead.
- **No Overlord from below.** No session can make itself the Overlord: designation is the operator's door only. The
  Overlord's start door (E4) refuses a kickoff that names the `ccrc-overlord` skill, and a coordinator's dispatch never
  carries it, so the Overlord can never spawn a sub-Overlord and a coordinator can never become one. The skill installer
  ships `ccrc-overlord` to every home, so the skill is everywhere, but outside the designated session it refuses to act:
  its first step checks `GET /api/overlord/board`, which answers 403 to anyone else.
- **No Overlord that is also something else.** The designated session claims no runs (C4), cannot be dispatched as a
  child, and cannot be designated while it claims a run or carries a `.child` marker (`overlord-not-root`).
- **It never moves between projects (R11).** It oversees every project at once and reads all of them (C3, C47). Its
  session runs in the dedicated `overlord` project, which is only where its pane lives, never a limit on what it sees,
  so there is nothing to move it to.
- **Replacing a lost session is a rebind, never a second Overlord.** A restart (C23) keeps the same session id, so
  almost every recovery needs nothing. Only if the session itself is gone (a lost workspace) does the operator's
  **Rebind the Overlord** door point the one row at a replacement session, in one transaction: the old session's powers
  end in the same write that grants the new one's, and the new session starts by reading the same server state. The
  door refuses a session outside the `overlord` project (`overlord-wrong-project`).
- **What the operator sees.** The console shows the one Overlord everywhere: one place, one chat, one log. There is no
  list of Overlords and no picker.

### 3.2 Its parts

- **C1. A session, not a server process.** The Overlord is a Claude Code session running the new `ccrc-overlord` skill.
  - What this reuses: the console's chat, `ccrc history`, compaction, account swaps and the mail lane. §3.3 changes how
    compaction, swaps and rolls apply to it, and it is never hibernated (C4).
  - Rejected: an agent loop inside the server. It would be a second runtime with none of the fleet's tooling, and the
    server would start making judgements, which breaks "decide in L1, act in L4".
- **C2. Designated once, by the operator.** The singleton row, `overlord_designation`, holds the session id, when it
  was designated and the console device that did it. It binds the **session id**, not a `.uuid`: Claude Code rotates a
  session's uuid on every `/clear` and compaction (`_sync_uuid`), and a binding to the uuid would end the Overlord's
  powers at its first compaction. Each call proves freshness the usual way, by the registry's current uuid (C27).
  - Its one writer is a session-gated operator door with a step-up: `POST /api/overlord/designate` (create, refused
    `overlord-exists` when the row exists), `POST /api/overlord/rebind` (the recovery in §3.1), and `DELETE` to retire
    the Overlord entirely. Retiring keeps its requests, log, grants and model, so the next start is the same Overlord
    with the same memory.
  - "Start the Overlord" in the console composes the existing session-create door, then designates the new session.
    It always runs in the dedicated `overlord` project, which the start makes through the add-project door when it does
    not exist yet. The project is nearly empty, because the Overlord's state is on the server, and it is never a scope:
    the Overlord oversees every project (R11).
- **C3. It spans the whole fleet.** It reads and routes across every project the server measures at once (R11). It has
  no home project to see from: the `overlord` project only holds its pane. Mail and the Overlord doors already cross
  projects (the D-5530 cross-project ruling).
- **C47. It reads everything (R10).** Its read scope is every read the operator's console has, plus every project's
  history in full.
  - **The console's reads.** Overlord read doors mirror what the signed-in console reads: the sessions and their panes,
    runs, items, asks, approvals, mail bodies, programme ledgers and goals, the digest, documents and the Settings
    state. Each is the existing reader behind the Overlord's attribution check. No second reader is written.
  - **Every project's history.** `ccrc history`'s read verbs (search, describe, expand) over every project, every
    provenance: the operator's prompts and the sessions' replies and tool output alike. `decideScope` in
    `ccd/history/lib.mjs` gains one scope, `overlord`, which only a new read-only agent op on the fleet box may pass,
    reached only through the server's `GET /api/overlord/history`. A session's own `ccrc history` still refuses a
    cross-project read: the history store's "across projects: never" stays true for every session but the Overlord.
    Output passes the history store's own output belt.
  - **Reads are not acts.** A read changes nothing, needs no grant and writes no audit row. Reading goes through the
    Overlord's subagents (C44), which carry its attribution.
  - **Credential stores stay closed** (the author's reading of "everything", which the operator can overturn): account
    secrets, sign-in scratch, the operator's secret slots and the box token. They hold keys, not knowledge of the work,
    and reading them is account management, which the SAFETY rules keep the operator's for every session. Secrets a
    session once printed into its transcript reach the Overlord only masked, by the history store's belt.
- **C4. It claims no runs.** The Overlord is not any programme's coordinator. That avoids `claimant-is-a-worker` and
  the one-level bracket rule, and it keeps one coordinator per programme (clause 8). It reaches coordinators through its
  own doors and mail.
  - **It is never hibernated.** A session with no runs, claims or mail is what the hibernate lane (`coord/hibernate.ts`)
    puts to sleep, and a sleeping Overlord would release every hold (C23). The lane's eligibility reads the designation
    and skips the designated session: one predicate, one extra rung. The idle-sleep lane gets the same rung. As a second
    line, a hold taken for the Overlord wakes it through the mail lane's wake budget, as mail wakes any hibernated
    recipient today.
- **C5. Its durable state is on the server.** That state is the requests (§5), the audit log (§10), the operator model
  (§9) and the designation.
  - A compaction, a restart or a swap loses nothing.
  - On start, and after any compaction, the skill reads `GET /api/overlord/board` (§5.2) and its open requests before
    doing anything else.
  - The Overlord card (C38) re-anchors it at every start, and §3.3 says how it stays whole for months.
- **C6. Model.** It runs Fable at high effort, the model the operator selected for it (C45, §3.4). Long reading goes to
  subagents that name their model: Sonnet for reading and distilling, Haiku for listing. Its own context stays free for
  routing and judgement.
- **C7. It obeys every brake the operator has.**
  - Under `coordinator-paused` it starts nothing and dispatches nothing, though it still answers and relays.
  - Under `mail-disabled` it sends nothing.
  - A new kill switch, `overlord-disabled`, is a Settings row and a file. While it is set, every Overlord door refuses
    and routing reverts to today's.
  - The Overlord never sets or clears any of these.

### 3.3 Living a very long time (R8)

The operator, 2026-11-09: the Overlord must live for a very long time without memory loss or the other known problems
of long-running sessions, using every technique ccrc has for context, compaction and history, and researching what
else helps. This section is that design. The operator then ruled (R13) that coordinators need the same fixes, so the
machinery here is built once for every long-lived role, and §3.3.9 says what a coordinator gets. It rests on two pieces of research done for this spec on 2026-11-09:
- a survey of ccrc's own machinery;
- a survey of published work.

The sources are named where they are used. Claims about Claude Code settings are sourced from its documentation and
are verified against the installed version in the W0 spike (§14) before anything depends on them.

**What the research found.**
- **ccrc today guards a session against one event at a time:** a compaction, a restart or a swap. Nothing renews a
  session's context, and nothing measures memory loss or drift over weeks. Measured in the tree:
  - A roll (`rollLane.ts`) and a hibernation wake both resume the *same* conversation.
  - Auto-compact types a bare `/compact` with no instructions.
  - The roster card is empty for a session that claims no runs.
  - In a week, 7 of 368 session families used history recall at all.
  - The history replay quiz that would measure recall was built but never run.
- **Published work agrees on the failure modes** (sourced):
  - Output quality falls as the context grows, even on easy tasks (Chroma's "context rot" study, 18 models; Anthropic's
    context-engineering guidance).
  - Recall is weakest in the middle of a long context (Liu et al., 2024).
  - Models lose about 39% from single-turn to multi-turn work, because they commit to early assumptions
    (arXiv 2505.06120).
  - Summaries of summaries lose most of what they carry: 35% against 93% for tiered memory on one benchmark (MemGPT,
    as cited by Zep).
  - Goals drift over long horizons in every model tested (arXiv 2505.02709).
  - Sycophancy grows with alignment tuning (arXiv 2505.23840).
  - An agent grading its own work skews positive (Anthropic, harness design).
- **So one conversation compacted for months degrades by design.** Each compaction summarises the last one, and
  errors become canon.

The answer is **one Overlord, many generations**: the same session (R7), renewed from the server's canonical state
before its context grows long, with drift measured from outside.

```mermaid
flowchart TD
  A["Generation n<br/>works, writing every decision<br/>and open thread to the server"] --> B{"Renewal due?<br/>context ceiling, 2 compactions,<br/>failed probe, quiet window,<br/>new build"}
  B -- "no" --> A
  B -- "yes, and idle" --> C["Server checkpoints<br/>notes, last operator turns,<br/>advisory handover note"]
  C --> D["Server clears the conversation<br/>same session id, same Overlord"]
  D --> E["SessionStart injects the Overlord card<br/>rules, grants, open requests,<br/>programmes, operator brief, canaries"]
  E --> F{"Probes pass?"}
  F -- "yes" --> G["Generation n+1 works"]
  F -- "no" --> H["Re-read, probe again,<br/>then tell the operator"]
  G --> A
```
*Figure 2. One Overlord, many generations. The server decides when to renew and does it. The new generation starts
from the server's canonical state, never from a summary of a summary, and proves it before it acts.*

#### 3.3.1 Generations, not one immortal conversation

- **C36. Renewal is the server's act, in the same session.** A generation is one conversation of the one Overlord
  session. A renewal ends it and starts the next, in the same pane and under the same session id: R7's one Overlord,
  with a fresh context.
  - Claude Code rotates the uuid on `/clear`, and the registry follows it (`_sync_uuid`). The designation binds the
    session id (C2), so nothing else changes.
  - One L1 decider, `renewalDue`, rules on each tick, for every long-lived role (C49); the triggers below are the
    Overlord's row. An L4 lane acts: it checkpoints, then clears, then the
    SessionStart card rehydrates.
  - It renews only between turns: the session idle, and no held question with less than a minute left. Otherwise it
    waits. The holds' fall-through (C22) still protects every question while it waits.
- **Triggers** (each is a row in `renewalDue`'s table; the defaults are the author's calls):
  - Context above the ceiling: 250k tokens or 50% of the window, whichever is lower.
  - Two compactions within one generation.
  - A failed probe (§3.3.5) that a re-read did not fix.
  - The daily quiet window. The default is the operator's quietest hour, learned from the operator model, else 04:00
    UTC.
  - A new ccrc install or Claude Code build (the roll lane's "behind" test): the Overlord renews onto it instead of
    resuming the old conversation.
- **Every renewal is an act row** (`renew`, reversibility `reversible`, since nothing is lost). It carries the
  generation number, the card hash it started from, and why it was due. The Overlord place shows the generation
  number.

#### 3.3.2 Write-through: nothing lives only in its head

- **C37. Every decision, commitment and open thread is on the server at the moment it is made.** Decisions are already
  act rows (§10) and requests are rows (§5). What is left is the Overlord's working notes: what each open thread waits
  for and what it intends next. They go in `continuity_notes` (one table for every long-lived role, C49), one short row per
  thread, keyed to a request, a programme or nothing. The Overlord rewrites a note whenever its intent changes. A renewal or a crash loses at most the turn in
  progress. This is the structured note-taking and progress-file pattern of Anthropic's long-running harness work,
  with the server as the file.
- **The checkpoint at renewal is assembled by the server,** not written by the model:
  - the notes;
  - the last 10 operator turns and the Overlord's replies, verbatim from the transcript (the server's transcript
    reader), so tone and open threads carry over;
  - the generation's own handover note. The Overlord writes it at the end of a generation, at most 2,000 characters,
    and it is shown to the next generation marked **advisory**: canonical rows outrank it wherever they disagree.

#### 3.3.3 The Overlord card: who it is, re-anchored every time

- **C38. One server-rendered card**, `GET /api/sessions/:id/card` (C49), injected by the session hook at every
  SessionStart (startup, clear, compact and resume). This is the roster card's mechanism with one renderer per role; the
  Overlord's rendering is the one below. It fills the gap that a session claiming no runs gets an empty roster card,
  for every role (C51). The order is stable
  first and live last, so the cached prefix stays stable and the live state sits at the end of the context, where
  recall is strongest:
  1. **Constitution:** what it is, R1 to R13 in one line each, the anti-goals, the brakes and their state, and the
     rules version.
  2. **Authority:** the live grants.
  3. **Live state:** the open requests ranked by recency, importance and age; each programme in one line; the
     notes; and the acts of the last 24 hours ranked the same way (the Generative Agents retrieval score).
  4. **The operator brief:** the stated entries that apply now, phrased in the third person ("the operator prefers X,
     since date"), which the research ties to less sycophancy.
  5. **The checkpoint** (§3.3.2), at renewal only.
  6. **Canaries:** the card's hash and the rules version (§3.3.5).

  Budget: 15k tokens, enforced by the server, which trims live state by rank and never trims the constitution.
- **A one-line delta on every operator prompt.** A `UserPromptSubmit` hook adds the rules version, the card hash and the
  counts of open requests and holds. This is a cheap re-anchor at the end of the context, where recency helps.
- **The skill keeps its most important clauses first.** After a compaction, Claude Code restores a skill only up to
  5k tokens, cutting from the end (sourced). The constitution clauses of `ccrc-overlord` therefore come first, and
  the procedures live in references.

#### 3.3.4 Compaction: a bounded fallback, never the plan

- **C39. Renewal comes before compaction.** Compaction stays only as a fallback inside one generation.
  - The Overlord's route record sets ccd's auto-compact threshold above the renewal ceiling, so renewal fires first.
  - Claude Code's own auto-compact window is lowered for the Overlord. By default, on a 1M window it compacts only near
    967k tokens, deep in the zone where quality has already fallen (sourced: Claude Code model configuration).
  - Claude Code's idle compaction is switched off for the Overlord, where the installed version supports it. Today it
    compacts an idle session after about 55 minutes and starts no turn afterwards (D-5373 measured this).
- **When a compaction does happen,** three things protect what it keeps:
  - The PreCompact hook supplies the Overlord's own summary instructions: keep request and act ids, open commitments
    and the operator's recent corrections; drop tool output. Claude Code takes PreCompact output as the summary
    instructions (sourced; verified in W0).
  - The SessionStart(compact) card re-anchors it (§3.3.3).
  - The history line points at the lossless record.
- The second compaction in a generation makes renewal due.

#### 3.3.5 Knowing it remembers: canaries, probes and an outside audit

- **C40. Canaries.** Every Overlord door call carries the card hash and the rules version the Overlord last read.
  - A door refuses a stale rules version with `stale-card`. The Overlord then re-reads the card and retries.
  - A rule change, a new grant or a revoked one bumps the rules version, so a generation can never act on authority it
    has not read.
  - This is deterministic: no model judges it.
- **C41. Probes after every renewal and compaction.** The server picks 3 to 5 questions whose answers are in its own
  rows, one from each of the LongMemEval ability classes the research names as the weakest:
  - an extracted fact ("what is request 412 waiting on?");
  - a knowledge update (a preference that was superseded);
  - a temporal question ("which programme moved last?");
  - an abstention (a question with no answer on record).

  The Overlord answers through `ccrc-api probe` (one verb for every role, C49), and the server grades by exact match.
  - On a fail, the Overlord re-reads the card and is probed again.
  - On a second fail, renewal is due. A fail right after a renewal tells the operator: the card itself is missing
    something.
- **C42. A daily outside audit.** The agent that did the work is never the one that judges it (Anthropic's harness
  research).
  - Once a day a fresh reviewer session is dispatched by a server lane, on the reviewer skill's pattern. It reads a
    sample of the day's acts against the constitution, the goals and the operator model, and scores:
    - rule adherence;
    - goal alignment;
    - consistency: the same question answered the same way across generations;
    - sycophancy: a stance changed with no new evidence.
  - A **golden set** keeps the scores honest. These are past questions the operator answered personally; the auditor
    puts them to the Overlord and compares the answers with the operator's real ones. The shadow week (§14) seeds it.
  - The scores land in `overlord_audits`, on the Overlord place and in the digest. A drop of more than 10 points
    against the 14-day mean raises an operator item.

#### 3.3.6 Memory over months: five layers

| Layer | Holds | Lives in | Reaches the session |
|---|---|---|---|
| Constitution | What it is, R1 to R13, anti-goals, brakes, grants | the `ccrc-overlord` skill, `overlord_grants` | first in every card, and the skill's first clauses |
| Working | Open requests, programmes, notes, recent acts | `overlord_requests`, `continuity_notes`, `overlord_acts` | the card, ranked and capped |
| Episodic | Every act, request and conversation since the first day | `overlord_acts`, `ccrc history` (its family recall follows the session across clears) | on demand, through subagents |
| Semantic | The operator model | `operator-model.db` (§9) | the operator brief on the card, and `GET /api/overlord/model` |
| Procedural | How to route, answer, start, learn | the skill's references | when a procedure is needed |

- **C43. The operator model keeps time** (bi-temporal: the research's Zep result).
  - An entry gains `validFrom`, `invalidAt` and `supersedes`. A changed preference supersedes the old one, which stays
    on record.
  - The card shows only the valid rows. So the Overlord is never asked to *remember* that something changed: the change
    is a row.
- **Consolidation while it is quiet** (sleep-time compute). The daily distillation (§9.2) also does two things:
  - It writes a monthly episodic digest of acts and requests, so a question about last spring reads one page, not ten
    thousand rows.
  - It flags contradictions between entries. These go to the operator as items and are never resolved silently.
- **Nothing in the episodic layer is pruned.** The card is pruned; the record is not. The Overlord's history family
  stays within the history store's cap like any other.

#### 3.3.7 Keeping each generation lean

- **C44.**
  - **Every read goes through a subagent** that returns under 2k tokens: mail bodies, PR states, logs, documents. This
    is the Claude Code equivalent of the API's tool-result clearing, which Claude Code does not expose.
  - **One model and effort per generation.** No `/model` mid-generation, because it resets the cached prefix.
    Escalation goes through a subagent, or the next generation starts on the new model.
  - **The board and card reads are compact by construction:** ids and one-liners, never bodies.

#### 3.3.8 Swaps, rolls, sleep and restarts

- **A swap never lands the Overlord on a summary.** Today a swap landing resumes from Claude Code's summary, which is
  lossy (`ccd/ccd`). For the Overlord, a swap is followed by a renewal: the new generation rebuilds from the server, so
  a swap loses nothing by construction.
- **A roll is a renewal** (C36's last trigger), never a resume of an old conversation onto a new build.
- **It never hibernates** (C4). A restart keeps the session id and starts a generation from the card.
- **History stays whole.** The Overlord's own conversations are in `ccrc history` across every generation, and the
  history line on its card points at the last generation's node. The steering of W3 (`<ccrc-leaf>` blocks, once
  armed) applies to its compactions like any session's.

#### 3.3.9 Coordinators get the same fixes (R13)

The operator, 2026-11-09, after rev 4: the gaps the research measured must be fixed for coordinators too, not just the
Overlord. A coordinator lives for weeks across a programme's waves, and every gap applies to it: today a roll or a wake
resumes its long conversation, an auto-compaction summarises it with no instructions, its card is empty while it designs
before its first run, it rarely uses recall, and nothing measures what it has lost.

- **C49. One continuity mechanism for every long-lived role.** A role table, `CONTINUITY_ROLES` in
  `shared/continuity.ts` (L0), has two rows, `overlord` and `coordinator`. Each row names its renewal triggers, its card
  renderer, its compaction instructions and its probe set. There is one of everything else: the `renewalDue` decider,
  the renewal lane, `continuity_notes` (keyed by session and role), the card door `GET /api/sessions/:id/card` and the
  probe verb `ccrc-api probe`. The Overlord is a row, not a copy. A session is a coordinator by the existing reading: it
  claims a non-terminal run, or it has declared coordinator intent.

| Gap measured | What a coordinator gets | Who else gets it |
|---|---|---|
| A roll and a hibernation wake resume the same conversation | Renewal from canonical state (C50) | the Overlord |
| Auto-compact types a bare `/compact` | Coordinator compaction instructions (C51) | every session, by role |
| The card is empty for a session with no runs | A card that is never empty (C51) | every session |
| Recall is barely used (7 of 368 families in a week) | Recall steering: the card, the summary and clause 23 point at it (C52) | the Overlord; the card line for every session |
| The replay quiz was never run, and nothing measures loss or drift | Probes from its own rows, the replay quiz weekly, and the Overlord as its outside judge (C52) | the Overlord has its own audit (C42) |

*Table 3.3.9. The five gaps, and the fix each coordinator gets.*

- **C50. Coordinators renew too.** A coordinator's renewal is the Overlord's: checkpoint, clear in the same session,
  rehydrate from the card, probe.
  - **Its canonical state** is already on the server: its runs and their waves, the plan path each run names, the
    programme ledger (goals, items, decisions, modifications), its claims, its outstanding mail, its notes, and the last
    10 rulings it received (operator and Overlord mail and item answers), verbatim.
  - **Its triggers** (the coordinator row; the defaults are the author's calls):
    - context above the ceiling, 250k tokens or 50% of the window, whichever is lower;
    - two compactions within one generation;
    - a failed probe that a re-read did not fix;
    - a new ccrc install or Claude Code build: the roll lane renews it instead of resuming the old conversation;
    - a wake from hibernation, when the sleeping conversation is above half the ceiling (a short one simply resumes:
      it loses nothing);
    - a wave boundary, once wave N+1's run is open and wave N's is closed, when the conversation is above a quarter of
      the ceiling. A boundary is where a coordinator's working set changes most, so it is the cheapest point to renew.
  - **Only between turns:** the session idle, and no question of its own or its children's held for it with less than
    a minute left.
  - **What it does not get:** the Overlord's constitution and operator brief (a coordinator gets its goals and rulings
    instead), the daily outside reviewer (the Overlord is its judge), the hibernation exemption (a coordinator with
    nothing to do may still sleep, and its wake follows the rule above), and the exclusive pool.
- **C51. Every session's compaction gets instructions, and every card says something.**
  - **Instructions by role.** One L1 table, `compactInstructionsFor(role)`, holds the instructions for each role:
    `overlord`, `coordinator`, `worker`, `reviewer` and a plain session. The auto-compact lane types `/compact` followed
    by them, and the PreCompact hook prints the same text: one source, two carriers. A coordinator's keep its run ids,
    wave, plan path and step, claims, rulings with their dates, open asks and items, and the mail it has not answered;
    a worker's keep its plan path, task, failing test or command, deviations and branch tip. Tool output is dropped.
    These follow the operator's own standing compaction instructions.
  - **The card is never empty.** The card's role reading looks past runs: declared coordinator intent, claims, items
    the session raised, outstanding mail, and the programme ledger by slug. A coordinator between runs, designing or
    waiting on the operator, gets its programme's card. A session the server cannot place in any role gets an explicit
    line saying no runs, claims or intent were measured, never silence.
  - Workers and reviewers get only this call. Their life is one wave, and the wave is their renewal.
- **C52. Recall is steered, and memory is measured.**
  - **Steering.** The card's history line names the session's last node and the one verb to read it
    (`ccrc history describe <node>`). Every role's compaction instructions make the summary end with that node. The
    coordinator skill gains clause 23: after a compaction or a renewal, check anything you recall (a sha, a path, a
    ruling's words) against `ccrc history` or the server before you act on it.
  - **Probes.** C41's probes run for coordinators too, drawn from the coordinator's own rows: which wave is open, which
    run, which claims it holds, the last ruling on a named question, and one with no answer on record.
  - **The replay quiz runs.** W0 runs the history replay quiz once across live coordinators as the baseline. It is the
    history programme's tool, so the wave asks that programme's coordinator first. A server lane then runs it weekly,
    and the scores land beside the probe rows.
  - **The Overlord judges drift.** Judging results against goals is the Overlord's brain work (C48). Once a week it
    samples each live programme's decisions against that programme's goals and the operator's rulings. A finding goes to
    the coordinator as a call, or to the operator. Until the Overlord exists, probes and the quiz are the measure.
- **Each fix extends its owner,** and nothing is copied: the roll lane (`rollLane.ts`), the hibernate lane
  (`coord/hibernate.ts`), ccd's auto-compact, the session hook's card, `ccrc history` (recall and the replay quiz) and
  the coordinator skill (clause 23, pinned by `coordinator-skill.test.ts`). Before W1a starts, this programme mails the
  coordinators of the programmes that own those pieces and claims the files, by the peer protocol.

### 3.4 Its model and its accounts

The operator, 2026-11-09, after rev 1: the Overlord should run the Fable class, and it should probably have an account
pool of its own. Both fit what it is. Its work is judgement for the whole fleet, which is exactly the work the fleet's
model policy saves Fable for. And one session whose holds cover every coordinator should never wait behind workers for
an account, nor take theirs.

- **C45. It runs Fable, because the operator selected it.**
  - **The operator's choice, on the designation.** The designation row gains `model` (`fable` or `opus`). Only the
    operator's session-gated doors write it: designate, rebind, and a Settings row. This is the D-6790 rule kept whole:
    Fable runs only when the operator selects it, and every box-token write that names `fable` is still refused
    (`409 fable-operator-only`). The Overlord cannot pick its own model, and no other session can borrow the choice.
  - **A class, never a version.** It asks for the class `fable`. The class follows its family's newest model through
    the fleet's model-class auto-advance (the operator's ruling of 2026-10-07), so it runs the newest Fable today (5.2,
    as the operator says) and moves to the next one without anyone touching it. The move lands at a renewal, never
    inside a generation (C44).
  - **The server applies the choice at each renewal.** One L1 decider, `overlordModelFor`, answers the model for the
    next generation: the designated model when the pool has an account that can serve it, else `opus`. "Can serve" is
    the limits read the fleet already makes for each class: for Fable it is the sweep's estimate of the account's Fable
    share against its cap, so Fable's weekly cap is a fact the decider reads, not a failure the Overlord meets mid-turn.
    The renewal lane composes the class write itself, as the server does for the operator's console (the same path
    D-6791 leaves open outside a session's shell). Every change of model is a `renew` act row that names the model and
    why.
  - **Falling back never stalls it.** When Fable's cap is reached, the next generation runs Opus, and the first renewal
    after Fable is servable again returns to Fable. The daily quiet-window renewal (C36) makes that at most a day. If a
    turn fails on the cap before the renewal, the Overlord is not live for those minutes, and every hold falls through to
    the operator at once (C23), as for any outage.
  - **Its helpers are never Fable.** Its subagents run Sonnet, Haiku or Opus (C6, C44), and the session hook already
    denies a Fable subagent. The daily outside audit (C42) runs on Opus: a judge on another model shares fewer of the
    Overlord's blind spots.
  - **How a generation starts on another model** is measured in W0: the class write and a relaunch, or a `/model`
    typed after the clear and before the first prompt. The typed form saves the account's default model (the
    auto-advance spec's D19). That side effect is harmless here only because the accounts are the Overlord's alone
    (C46).
- **C46. A pool of accounts of its own, exclusive both ways.**
  - **Its side.** The Overlord lives in its own project (`overlord`, C2), and the operator tags that project
    with a pool that only the Overlord's project uses (written here as `<overlord-pool>`; real pool names are the
    operator's data and stay out of this repository). `ccd` already keeps a tagged project in its pool: placement,
    the auto-swap and every manual verb (the pools spec's ruling 6). The Overlord never crosses out of its pool.
  - **The other side is new: an exclusive account.** Today an untagged project may land on any account, a tagged one
    included ("untagged is unconstrained"), so a pool alone does not keep other sessions off the Overlord's accounts.
    An account's pool edge gains `exclusive`, off by default. An exclusive account serves only projects tagged with its
    own pool. An untagged project, another pool, the auto-swap's last-resort bracket and the overflow rotation never
    land on it. This adds one clause to the pool rule: "serve iff either side is untagged or the names agree, unless the
    account is exclusive, when the names must agree".
  - **One rule, written once on each side.** The clause goes in `ccd`'s one pool decider (`_pool_ok`) and in the
    server's twin (`server/src/pools.ts`), which every placement, swap and forecast already asks. The flag lives in
    `pool_edges` (one writer, the operator's membership door) and reaches the fleet box in `$REG/pool-epoch` like every
    edge. A `ccd` that predates it would ignore the flag and fail open, so the box advertises a capability word
    (`pool-exclusive`), and the server refuses to set `exclusive` while the fleet box does not advertise it
    (`pool-exclusive-unenforced`). Nothing is exclusive until it can be enforced.
  - **How many accounts.** At least two are recommended, so an account at its ceiling swaps to the other inside the
    pool, and each account carries its own Fable share. Which accounts, and how many, is the operator's choice in
    Settings; the spec names none. Account management stays the operator's: the Overlord never tags, untags or edits
    an account or a pool (§8, "does not get").
  - **When the pool is exhausted.** The pools spec's ruling 6 stands: stay in the pool, never cross, make it loud. For
    the Overlord, a stranded session is a session that is not live, so every hold falls through to the operator (C23),
    and an operator item says which accounts are at their ceilings and when the first resets. No coordinator waits.
  - **The coordinators it starts never use its accounts.** They are placed by their own projects' pools (C32), and the
    exclusive edge keeps them off the Overlord's pool even when their project is untagged.

### 3.5 Brain work, never execution (R12)

The operator, 2026-11-09, after rev 3: the Overlord, much like the operator, is focused on brain work, not execution.
Execution is always handed down the chain to coordinators, and they deal with it as they deem necessary.

- **C48. It thinks; coordinators execute.**
  - **Brain work is the Overlord's.** Understanding what the operator wants and why, deciding, prioritising, routing,
    answering operator-bound questions, following up, judging outcomes against goals, and learning the operator. Reading
    is brain work too (C47): it reads to decide, through subagents that read and summarise and never implement.
  - **Execution is never the Overlord's.** Anything that changes a repository or runs the work: editing a file, a
    commit, a branch, a pull request, a build, a test, a script, reproducing a bug, measuring something by running it,
    opening a run, dispatching a worker or a reviewer, reviewing a diff. All of it goes down the chain: to the
    coordinator that owns the work, or to a new coordinator it starts (E4).
  - **No task is too small to hand down.** A one-line fix goes to a coordinator like a wave does. There is no
    "quicker to do it myself" exception: the operator works this way, and so does the Overlord.
  - **It hands down outcomes, never methods.** A relay says what is wanted and why, what done looks like, the
    constraints and the priority. It carries no plan, task list or approach. The coordinator decides how, by its own
    skill and D-8126's decision procedure, "as it deems necessary".
  - **It does not second-guess execution.** It judges results against goals, not how the coordinator got there. When a
    coordinator's way of working breaks a goal or one of the operator's rules, the Overlord raises that with the
    coordinator as a call, or brings it to the operator. It never takes the work back.
  - **Its own memory is not execution.** Notes, requests, the operator model and act rows are written through its server
    doors (C37). They are how it thinks across generations, and they touch no repository.
- **How the line is held.**
  - **The skill.** A pinned clause (§11.3, clause 12) and anti-goal A9.
  - **The server.** It already claims no runs (C4), so the dispatch doors refuse it as they refuse any non-claimant. The
    run-open door gains one refusal, `overlord-not-a-coordinator`, when `claimedBy` names the designated session, so it
    can never become a coordinator by opening a run.
  - **An accident guard.** Its session is spawned with one more deny set, `OVERLORD_DENY_RULES` in `shared/api.ts`
    beside `ACCOUNT_DENY_RULES`: the file-editing tools, and the repository write verbs (`git commit`, `git push`,
    `gh pr create`, `gh pr merge`). Like every deny rule on this fleet, it stops an accident, not a determined shell
    (`bash -c` with an assembled string runs past it). The plan picks the carrier: the spawn's settings file for the
    `overlord` project, or the session hook's deny arm reading the designation. Every denial is counted (M12).
  - **A side benefit.** Brain work keeps its context lean: no diffs, no test output, no build logs. That is most of
    what C44 asks for, by construction.

## 4. Where the operator talks to it

R4 puts the surface inside the console, and R9 makes it the console's home.

- **C8. The Overlord is the home, and the first door in the top menu** (R9).
  - **It opens first.** The console's root opens the Overlord place. The Fleet screen keeps its own route and its
    phone-bar place, one tap away.
  - **A top-menu button.** The Overlord is first in `PLACES` (`pwa/src/lib/places.ts`), the one list every navigation
    reads, so its door appears first on Instrument's top bar, Refined's desk bar and the phone bar with no second edit.
    The wordmark, "the way home" (`TopBar`), now leads to it, and a "Go to the Overlord" command joins the registry.
  - **One decider picks the home.** An L1 `homePlace` answers the Overlord while one is designated and its kill switch
    is off, and the Fleet otherwise. The console never opens on an Overlord that cannot answer.
  - **The phone bar gains a seventh door.** A new door can overflow a bar in ways only the whole browser suite sees,
    so W1 runs it in full.
- **The place has three parts:**
  - **Chat.** The Overlord session's own conversation, drawn by the existing chat column (`ChatList`, `Composer`) on its
    session id. Typing to the Overlord is typing to that session, exactly as today.
    Renewals (§3.3) do not break the conversation for the operator: the chat shows a quiet "generation n" divider and
    scrolls back into earlier generations, read from their transcripts, so it reads as one long conversation.
  - **Requests.** The open requests (§5), each with its state, its target programmes, its last news and its age. A
    request that waits on the operator is marked and sorted first.
  - **Log.** The audit log (§10): the newest acts first, filterable by kind, by programme and by reversibility, each row
    with its Overturn control where one exists.
- **Waiting on you stays where it is.** It now shows only what the Overlord escalated, or what fell through to the
  operator (§6.4). Each escalated item carries the Overlord's recommendation and its reason for raising it ("O3: this
  changes the definition of done").
- **No new notification channel.** Escalated items push exactly as items push today, through `notify` and the existing
  web push. Telegram, Discord and a mobile app are out of scope (R4).
- **The Overlord answers in the operator's style.** It leads with the outcome and keeps it short. What it learns about
  how the operator likes to be told things is ordinary operator-model content (§9).

## 5. Requests: routing and follow-up

A request is one thing the operator asked the Overlord for. It is tracked from the moment it is understood until the
operator has been told it is done, or that it was dropped.

### 5.1 The request record

- **C9. One table, `overlord_requests`, written only through Overlord doors.** Its columns:
  - `id`;
  - `said` (the operator's words, redacted and capped);
  - `summary` (the Overlord's one line);
  - `state`;
  - `targets` (programme slugs and session ids);
  - `openedAt`;
  - `lastNewsAt`;
  - `followUpAt`;
  - `closedAt`;
  - `closeNote`.
- **States:** `received → routed → in-progress → done`. The side states are:
  - `needs-you`: it waits on an operator-only point, raised as an item;
  - `dropped`: the operator withdrew it, or the Overlord could not do it and said why.
- **Transitions:** one decider in L1, `nextRequestState`, in the style of `nextItemState`.

```mermaid
stateDiagram-v2
  [*] --> received: operator says it
  received --> routed: mail to an owning coordinator<br/>or a new programme started
  received --> done: the Overlord did it itself
  received --> needs_you: operator-only point
  routed --> in_progress: coordinator acks
  in_progress --> needs_you: operator-only point raised
  needs_you --> in_progress: operator answers
  in_progress --> done: coordinator reports done<br/>and the Overlord re-measures
  routed --> dropped: withdrawn or impossible
  in_progress --> dropped: withdrawn or impossible
  done --> [*]
  dropped --> [*]
```
*Figure 3. A request's life. "Done" needs the Overlord's own re-measurement, the same discipline a coordinator applies
to a wave-done claim. A request the Overlord can finish alone (a question about the fleet, a setting it may change)
goes straight to done.*

### 5.2 The board: what the Overlord reads to route

- **C10. One read, `GET /api/overlord/board`,** gated by the box token plus the designated Overlord's attribution. It
  answers, per programme:
  - slug, title and home project;
  - coordinator id and its live word (`idle`, `busy`, `shell`, `dead`);
  - goals "In short" and `doneWhen` (D-8126 §8.1);
  - open runs by state, with active runs counted as the cap counts them;
  - time of last movement (the runs rebuild's reader);
  - open items and stalls;
  - the Overlord requests it carries.

  It also answers the fleet's caps and their use, and the projects list. Every part comes from an existing reader
  (`programmesRead`, `goalsFor`, `capsUsage`, the fleet read model). The board composes them and decides nothing.

### 5.3 How a request is routed

The routing is the Overlord's judgement, written as a procedure in the skill (`references/routing.md`). The server
supplies the board and enforces the doors.

```mermaid
flowchart TD
  A["Request understood"] --> B{"Can the Overlord<br/>finish it alone?"}
  B -- "yes" --> Z["Do it, log it, tell the operator"]
  B -- "no" --> C{"Inside an existing<br/>programme's goals<br/>and definition of done?"}
  C -- "yes" --> D{"Owner can take it<br/>without starving<br/>its own work?"}
  D -- "yes" --> E["Relay to that coordinator"]
  D -- "no, and it splits cleanly" --> F["Agree a split with the owner,<br/>then start a sibling programme"]
  D -- "no, and it does not split" --> E
  C -- "no" --> G{"Does the operator's own<br/>request widen an existing<br/>programme's scope?"}
  G -- "yes, in so many words" --> H["Relay, with goals modify<br/>citing the operator's words"]
  G -- "no" --> I["Start a new programme<br/>for the request (§8)"]
```
*Figure 4. How a request finds its owner. A programme whose goals cover the work keeps it, even when it is busy:
two coordinators on one goal would conflict. A new programme is the answer when nothing covers the work, because the
operator's own request authorises starting it.*

- **C11. A busy owner keeps its work.** "All busy" (R5) starts a new coordinator only when the work splits cleanly from
  the owner's, and only after the owner agrees by mail. Otherwise the request queues with the owner, and the Overlord
  tells the operator the expected wait.
- **C12. The operator's request is the operator's ruling.** Starting a new programme and widening a programme's scope
  are both O3 in D-8126. When the operator *asks* for the work, that request is the O3 decision: the Overlord carries it
  out and cites it. The Overlord never starts a programme, or widens one, that the operator did not ask for. That stays
  O3 until a grant says otherwise (§7).
- **C13. A relay carries the operator's words verbatim.** It is system mail `fromId:'overlord'` (a new system sender
  beside `operator` and `coordinator`), sent through an Overlord door, so peer-mail quotas do not apply. Its body has
  two fenced parts:
  - **The operator said.** The verbatim quote. A coordinator treats this part as an operator steer, exactly as it treats
    an item answer today.
  - **The Overlord adds.** The outcome wanted and why, what done looks like, the constraints, the priority and the
    programme mapping, never a plan or a method (C48). This part is a call, not a ruling: the
    coordinator weighs it, may push back by mail, and never cites it as an operator ruling (D-8126 A7).

### 5.4 Follow-up

- **C14. Coordinators report to the Overlord.** A relayed request names its request id. The coordinator replies
  `toId:'overlord'`, a new role address that resolves to the designated session. It sends an ack, then the progress that
  matters, then done. The coordinator skill gains clause 22 for this (§11.4).
- **C15. The server nudges, the Overlord acts.** Each request carries `followUpAt`, which the Overlord sets when it
  routes. A new arm of the stall watch mails the Overlord `follow-up: request <n>` when `followUpAt` passes with no news
  from the target. The Overlord then reads the target programme's state and acts once: a mail, a revival (E5), or a
  note to the operator. A follow-up is never a poll loop (clause 7's rule, applied to the Overlord).
- **C16. Reporting back.** The Overlord tells the operator when a request is done, dropped or needs them, in its chat
  and on the Requests list. Other progress is shown on the list and never pushed. How much detail the operator wants is
  learned (§9).

## 6. Questions: the Overlord answers first

R3: no coordinator is ever stalled, every question is answered, and work moves at speed. This section adds one tier on
top of coordinator-first routing.

### 6.1 What reaches the Overlord first

| Channel | Today | With the Overlord (C17) |
|---|---|---|
| Waiting on you items raised by a coordinator (clause 20) | Straight to the operator's list; a blocking item pushes | Held for the Overlord first. It answers, escalates or lets it lapse (§6.3). `secret` items never hold: a secret is O4 and never reaches a session |
| A child's ask the coordinator released, or one that lapsed | Pushed to the operator | Held for the Overlord for one more window, then to the operator. A late answer still wins |
| A root session's own ask (a coordinator's AskUserQuestion dialog) | Pushed to the operator | Held for the Overlord. D-8126 proposes forbidding these dialogs on a pinned programme (its R7, awaiting the operator), so they should be rare |
| A coordinator's question-ending turn | Waits for the operator to type | Clause 20 already says to raise it as an item, so it takes the item row above |
| A child's permission prompt (approvals) | Coordinator first, then the operator | **Unchanged in this programme.** A 60 s main-thread window leaves no room for a second hop, and widening an allow beyond `ordinary` would change the signer and the hook's verifier. Later (see "Later") |
| A `forbidden`-class prompt | Straight to the operator | Unchanged: forbidden acts are O1 by definition |
| A review-cap ask | Operator's ask, pushed | Gone for coordinators once D-8125 lands. Where D-8125 refuses `coord-lift-off`, the operator switched coordinator lifts off, so it stays the operator's |

**How the holds are kept** (C31). These are two mechanisms, because today there are two kinds of row, and each one
extends its own owner:
- **Asks.** The hold decision lives in `coord/questions.ts`, which mints a row `held` for the claimant `heldFor` (in
  `coord/heldFor.ts`) names, or `released` with a reason. `heldFor` answers only for a child today, and a coordinator's
  own ask comes back `not-a-child`. It gains an Overlord tier: a root session's ask, or a row a coordinator released or
  let lapse, is held for the designated Overlord. The tier is one new answer of the same decider, `held-for-overlord`,
  read by the same mint and release code, and the `asks` row's `parentId` names the Overlord. This is not a second hold
  mechanism.
- **Items.** Items have no hold at all (`ITEM_TRANSITIONS`, `shared/ledgers.ts`), so this part *is* new. It is
  recorded as such, because no existing owner covers it. `operator_items` gains one nullable column, `overlordUntil`.
  - Raising an item sets the column when the Overlord is live and the item is not `secret`.
  - `GET /api/waiting` leaves out an open item whose `overlordUntil` is in the future, through one predicate,
    `itemReachesOperator`, which the push for a blocking item reads too.
  - The Overlord's answer moves the item through the existing decider, and its escalation clears the column.
  - No item state is added: an item held for the Overlord is `open`, and simply not yet the operator's to see.

### 6.2 The flow

```mermaid
sequenceDiagram
  participant W as Worker
  participant C as Coordinator
  participant S as Server
  participant O as Overlord
  participant P as Operator
  W->>S: ask (AskUserQuestion)
  S->>C: held for the coordinator (180 s)
  C->>S: release (a new decision, not its to make)
  S->>O: held for the Overlord (one more window)
  O->>S: rule from goals, rulings and operator model
  S->>W: answer typed into the dialog
  S->>C: system mail, the ruling and why
  Note over O,P: or, if the question is operator-only
  O->>S: escalate with recommendation and class
  S->>P: Waiting on you item and push, as today
```
*Figure 5. One more hop. A question the coordinator cannot settle goes to the Overlord before the operator. The
Overlord either rules or escalates with a recommendation. The operator sees only what the Overlord escalates, or what
lapses.*

### 6.3 How the Overlord decides

- **C18. The same procedure as D-8126 §5, with one more source.** The order is:
  1. Is it O1 to O6 (§7)? If so, escalate, unless a live grant covers the exact act.
  2. Read the programme's goals, `doneWhen`, ledger and recorded rulings.
  3. Read the operator model: entries scoped to this programme, then its project, then the fleet.
  4. Decide, record and continue.

  Doubt resolves towards the operator only for O1 to O6, never for "is this big or routine?".
- **C19. An Overlord answer is a call, not a ruling, unless a grant stands behind it.** It is recorded as an `answer`
  act (§10), and the coordinator receives it as system mail from `overlord`. The coordinator acts on it and records it.
  The operator can overturn it.
  - **Without a grant**, a coordinator never cites it as an operator ruling on an O-class matter (D-8126 A7).
  - **With a grant**, the grant *is* the operator's standing ruling for that act and scope. The answer mail names it
    (`grant 7`), and the coordinator cites the grant, not the Overlord, wherever D-8126 needs an operator ruling: a
    change to `doneWhen` or scope, or a spec approval. Without this, the O3 grants in §7.1 would have nothing they could
    change.
  - The Overlord signs as itself: it never writes as the operator, and nothing it sends is attributed `operator`.
- **C20. Escalation carries the work.** An escalated item reaches the operator with:
  - the Overlord's recommendation and why it beats each alternative (clause 20's D24 rule);
  - the O-class that makes it the operator's;
  - the operator-model entries it weighed, as links.

  The operator's answer then mails the coordinator as a tick does today. The Overlord also sees the answer and learns
  from it (§9.1).
- **C21. Items carry an O-class.** `items raise` gains an optional `operatorClass` (`O1` to `O6`). A coordinator sets it
  when D-8126's procedure classed the question operator-only.
  - The Overlord door refuses to answer an item whose class has no live grant (`operator-only`), so a mistaken Overlord
    cannot tick it.
  - The Overlord may raise an item's class, but never lower one. A wrong lowering would be a silent widening of its own
    authority.

### 6.4 Never the stall

- **C22. Windows, then fall-through.**
  - Items hold for the Overlord for at most 20 minutes (`OVERLORD_ITEM_HOLD_MS`).
  - Asks hold for one more `ASK_GRACE_MS` (180 s).
  - Then the row reaches the operator exactly as it does today, marked "the Overlord has not looked". A late Overlord
    answer to an ask still wins, as D-5289 rules for coordinators.
- **C23. A missing Overlord releases at once.** No hold is taken when the Overlord is not designated, not live
  (archived, stopped, measured dead, or hibernated and not woken within one wake-budget slot), or switched off. The row is minted `released` with the
  reason `overlord-not-live`, the predicate the dead-coordinator sweep uses. A dead Overlord also raises one operator
  push with a **Restart the Overlord** control (a re-kickoff of the same session id, `references/resume.md`'s path).
- **C24. A busy Overlord is a fault to fix, not a reason to wait.** The skill keeps the Overlord's turns short. Reading
  goes to background subagents, and the mail gate delivers on `shell`. The measure M3 (§12) watches hold lapses. If
  lapses run above 10% a week, the plan adds an Overlord-only delivery mode, not a longer window.

### 6.5 What it answers on day one

Once D-8126 is in force, a coordinator raises an item only for O1 to O6. The grants table starts empty (R1), and the
Overlord never lowers a class. So most items the Overlord sees on day one are the operator's, and the Overlord
escalates them. That is still worth having, for four reasons:
- **It catches over-asking.** Items a coordinator raised without needing to, by the C21 class test, are answered and
  sent back with the goal that answers them. Lapsed child asks and coordinators' own dialogs are answered the same way.
- **It does the operator's homework.** An escalation carries the recommendation, the class and the evidence (C20), so
  the operator's answer is one tap.
- **It ends stalls.** Revival, follow-up and routing (§5, E5) need no grant at all.
- **The grants door ships with the answering wave (W3, §14).** The operator can make the first relaxations as soon as
  the shadow week shows how the Overlord would have answered.

M1 (§12) is measured against that reality. It counts what reaches the operator *as a question they must think about*,
so an item that arrives with a recommendation the operator accepts unchanged counts as half.

## 7. Authority: the operator-only list, and how it relaxes

R1: start with D-8126's list, unchanged, and build it so it can be relaxed step by step.

### 7.1 The act catalogue

- **C25. Every act the Overlord can take is a row in one L0 table, `OVERLORD_ACT_KINDS` (`shared/overlord.ts`).** Each
  row gives:
  - the act's id;
  - its O-class, or `none`;
  - its reversibility (§10.1);
  - the server door that performs it;
  - whether a grant may ever cover it.

  The server and the console both read this table, and the single-definition guard pins it.

| Act kind | What it does | Class | Reversibility | Grantable |
|---|---|---|---|---|
| `relay` | Mail a coordinator the operator's request | none | compensable | not needed |
| `answer-item` | Answer a Waiting on you item | none, or the item's class | reversible | yes, per class, never for O2 or O4 |
| `answer-ask` | Answer a released or root ask | none | reversible | not needed |
| `escalate` | Send an item or ask on to the operator | none | reversible | not needed |
| `start-programme` | Start a coordinator for an operator request | none when requested; O3 otherwise | compensable | yes (unrequested starts) |
| `revive-coordinator` | Re-kick a dead coordinator, or reclaim its runs for a successor | none | compensable | not needed |
| `retire-coordinator` | Archive a finished coordinator it started | none | compensable | not needed |
| `approve-spec` | Tick an O3 "approve the spec" item | O3 | reversible until the plan dispatches | yes |
| `approve-dod` | Tick an O3 definition-of-done item | O3 | reversible | yes |
| `widen-scope` | Change a programme's scope beyond the operator's words | O3 | reversible | yes |
| `message-people` | Comment where people other than the operator take part | O1 or none, as D-8126 §15 Q3 is answered | irreversible | yes, after §7.4 |
| `publish` | Make something public, cut a release, promote to stable | O1 | irreversible | yes, after §7.4 |
| `deploy` | Roll the fleet | O1 | compensable | yes, after §7.4 |
| `spend` | Credits, paid services, new accounts | O2 | irreversible | no |
| `secret-or-access` | Secrets, sign-ins, repository settings, people's access | O4 | irreversible | no |

*The table is the first cut. The plan's wave 1 completes it from D-8126 §3 and the SAFETY list. An act missing from it
cannot be performed by any Overlord door.*

### 7.2 Grants: how the list relaxes

- **C26. A grant is one row in `overlord_grants`:**
  - `id`;
  - `act` (one act kind);
  - `scope` (`fleet`, `project:<p>` or `programme:<slug>`);
  - `conditions` (a small closed vocabulary: `reversible-only`, `max-per-day:<n>`, `only-when-recommended-by-coordinator`);
  - `grantedAt`;
  - `expiresAt` (optional);
  - `revokedAt`;
  - `note`.

  Its only writer is a session-gated operator door with a step-up, as the secret door has today:
  `POST /api/overlord/grants`, and `DELETE` to revoke. A revocation takes effect on the next door call.
- **The server enforces it.** Every Overlord door runs one L1 decider, `overlordMayAct(act, target, grants, now)`.
  - It answers `allow`, `allow-by-grant:<id>` or `operator-only`.
  - An `operator-only` answer is a 403 with the class named, and the door writes no act row.
  - The grant id, when one was used, is written on the act row (§10), so the operator can see what each grant was used
    for.
- **The Overlord may propose a grant, never take one.** When the operator model shows a steady pattern ("approved 12 of
  12 wave plans unchanged"), the Overlord raises a `decide` item proposing a narrow grant, with the evidence attached.
  Relaxing the list is always the operator's tap. Both the ruling and O4 say so.
- **What relaxing looks like** (an example, not a plan). First `approve-dod` for programmes the operator started. Then
  `start-programme` for follow-up work inside a project. Much later, `publish` for dev-channel prereleases. Each step is
  one grant the operator can revoke.

```mermaid
flowchart LR
  A["Overlord wants to act"] --> B["Door looks up the act kind"]
  B --> C{"Class is none?"}
  C -- "yes" --> D["Act, and log it"]
  C -- "no" --> E{"Live grant for this act,<br/>scope and conditions?"}
  E -- "yes" --> F["Act, and log it<br/>with the grant id"]
  E -- "no" --> G["403 operator-only<br/>the Overlord escalates"]
```
*Figure 6. Every Overlord door asks one decider. The grants table starts empty, so on day one the Overlord holds
exactly the authority D-8126 gives a coordinator, plus the extras of §8, and nothing on the operator-only list.*

### 7.3 What never relaxes

- The SAFETY list in `CLAUDE.md`. The Overlord is a session, so every verb forbidden to sessions is forbidden to it.
  A grant cannot name one, because no act kind maps to one.
- O2 (spend) and O4 (secrets, access, credentials): `Grantable` is "no". The operator ruled spend and credentials as
  theirs. A grant door that could hand them out would turn a brake into a setting.
- The operator's brakes (C7): pause, mail-disabled and the Overlord's own kill switch.

### 7.4 Identity, and why irreversible grants wait

- **C27. Version 1 rests on attribution, like a coordinator.** An Overlord door checks the box token, then that the
  caller's `id` is the one `overlord_designation` names and its `.uuid` is that session's current one (today's attribution). No new secret is minted: all sessions share one UNIX user, so
  a second token on the same disk would buy nothing over attribution. That is the reason D-282 gives for the ungated
  doors. Attribution stops accidents, such as a coordinator calling an Overlord verb, because the client fills in the
  caller's own pane id. It does not stop a hostile session that forges its id.
- **So irreversible acts cannot be granted yet.** The grant door refuses a grant whose act is `irreversible` or `deploy`
  with `identity-too-weak`. That refusal lifts only when a server-signed session identity exists, the item already in
  D-8125's and D-8126's "Later". The first time the operator asks for an irreversible grant, that request is the trigger
  to build it.
- **The blast radius of a forged Overlord in version 1** is what a forged coordinator can do today, plus the reversible
  and compensable acts in §7.1. Every one of those is logged and overturnable.

## 8. Spawning, and the extras

R5: the Overlord acts as the operator would, through ccrc's own tooling, with named extras. An extra is any power a
coordinator does not have today.

### 8.1 The extras

| # | Extra | Why it is needed | How (an Overlord door unless said otherwise) |
|---|---|---|---|
| E1 | **Read the whole board**: every programme's goals, runs, items, stalls and live words, plus the fleet's caps | Routing (§5.3) and follow-up need the cross-programme picture. Today `/api/programmes`, `/api/waiting`, `/api/fleet` and `/api/coord/caps` are cookie-only, and a coordinator sees only its own | `GET /api/overlord/board` (§5.2), composed from the existing readers |
| E2 | **Answer operator-bound questions in the operator's stead**, within §7 | R3. Today only the operator may tick an item, and only a run's claimant may answer an ask | `POST /api/overlord/items/:id/answer` runs the tick decider with actor `overlord`. `POST /api/overlord/questions/:id/rule` and `/escalate` admit the Overlord for rows held for it |
| E3 | **Mail any coordinator as the operator's relay**, as system mail `fromId:'overlord'`, and be addressable as `toId:'overlord'` | Relaying is the core job. Peer quotas (3 outstanding, 12 an hour) would throttle a fleet-wide relay, and a coordinator must be able to tell the operator's words from a peer's | `POST /api/overlord/relay` writes the mail and the act row in one transaction |
| E4 | **Start a coordinator**: create a session in any project and queue its kickoff | R5's spawning. The operator's doors (`POST /api/sessions`, `POST /api/projects/:project/workspaces`, `POST /api/sessions/:id/kickoff`) are cookie-gated | `POST /api/overlord/programmes` composes the same server functions behind the authority decider, the caps and the pool rules, and returns the new session id. Details in §8.2 (C32, C33) |
| E5 | **Revive a dead or stalled coordinator**: re-kick it, or reclaim its runs for a successor it starts | "No coordinator is ever stalled." Today the reclaim and re-kickoff doors are the operator's | `POST /api/overlord/coordinators/:id/revive` uses the reclaim door's own re-measurement (it refuses unless the claimant measures dead) and `ProgramKickoffResume` |
| E6 | **Retire a coordinator it started**, once its programme's runs are all closed and it has been idle 24 h | Without this, Overlord-started sessions pile up | `POST /api/overlord/coordinators/:id/retire` uses the archive door's `{programme:'end'}` path. Only for sessions whose `start-programme` act row names it; others get a suggestion item |

**What it does not get** (each stays the operator's, by R1 and the SAFETY rules):
- Settings switches;
- pause and unpause;
- caps;
- the update control plane;
- token rotation;
- claim breaks;
- accounts, secrets and sign-ins;
- every `ccd` verb on the SAFETY list;
- merges by any route other than clause 15's (the Overlord lands nothing itself: coordinators land their own PRs);
- any execution (R12, C48): editing files, commits, branches, pull requests, builds, tests, opening runs, and
  dispatching workers or reviewers;
- repository settings;
- any act in §7.1 whose class has no live grant.

### 8.2 Limits on what it starts

- **C28. Caps.** Every start counts against the fleet's existing limits: the dispatch cap, the memory-headroom
  admission, the pools and ccd's placement.
  - On top of those, a new Setting `overlordLiveProgrammes` caps how many live programmes the Overlord itself started
    (default 3, range 0 to 12; 0 means it may never start one).
  - Over the cap, the start door refuses `overlord-cap`. The Overlord then queues the request with a reason and tells the
    operator.
  - Starting never spends beyond plan (O2): no credits-billed model, and no new account.
- **C32. Which account.** `POST /api/sessions` needs a `wrapper`, and today the Start programme sheet works it out in
  the browser (`startProgramPlacement`). That policy moves to one L1 home that both the sheet and the Overlord's start
  door read (consolidation: one decider, two callers). The door takes no wrapper from the Overlord.
  - It picks the account the same way the sheet would: the project's pool, then the least-loaded lane the server
    forecasts, at parity with `ccd`'s own walk (`projectHome`).
  - It only ever chooses among the accounts already on the roster, under their plans. That is not spend (O2) and not
    access (O4).
  - `ccd` still places, and still refuses what its pool rule refuses. When programme-aware placement (#749) lands, its
    `--programme` marker comes for free.
- **C33. A named workspace, not a main checkout.** A session id is `<wrapper>-<project>`, so a second coordinator in a
  project whose main checkout already coordinates something would collide with it. The start door therefore always
  creates a **named workspace** (`POST /api/projects/:project/workspaces`'s server function, named after the programme
  slug) and never starts a main checkout.
- **C34. The kickoff says who sent it.** `coord/kickoff.ts` sends the kickoff as system mail `fromId:'operator'` from a
  fixed template (`programKickoffVerdict`). The start door would then tell the new coordinator that the operator wrote
  to it, which breaks C19 and A2. So the kickoff gains a third template, `overlordKickoff`, sent `fromId:'overlord'`.
  It carries the slug, the title and the request id, plus the operator's words verbatim in a fenced block. The words
  are cut whole to fit the mail cap (8 KiB), and the full text stays readable on the request row. The re-kickoff for a
  revived coordinator (E5) uses the existing `ProgramKickoffResume`, also sent as `overlord`.
- **A new programme's first hours.** The start door queues a kickoff that names the operator's request (verbatim), its
  request id and its slug. The new coordinator brainstorms with the Overlord as its source: the Overlord answers what
  the operator model and the request answer. It raises the operator-only rest, which by D-8126 always includes "approve
  the spec" (O3), as items with recommendations. This is exactly how this programme's own brainstorm was run.

## 9. Knowledge of the operator

R2: a database distilled from everything about the operator. This section covers what it holds, how it is fed, how
the operator reviews and corrects it, and how it stays private.

### 9.1 What it holds

- **C29. A private store, `operator-model.db`, on the server box.** It is a separate SQLite file beside `coord.db`, not
  tables inside it. Wiping, exporting and backing it up are then the operator's alone, and a `coord.db` snapshot shared
  for debugging never carries it. The tables:
  - **`entries`**, with these columns:
    - `id`;
    - `kind`: `preference`, `ruling`, `habit`, `dislike`, `fact` or `style`;
    - `scope`: `fleet`, `project:<p>` or `programme:<slug>`;
    - `statement` (at most 500 characters, plain words);
    - `basis`: `stated` (the operator said it, or ruled it) or `inferred`;
    - `confidence`;
    - `share`: `ccrc` or `overlord-only`, see §9.4;
    - `status`: `active`, `retired` or `superseded`;
    - `validFrom`, `invalidAt`, `supersedes` (C43);
    - `sources` (references, see below);
    - `createdAt`, `updatedAt`;
    - `lastUsedAt`, `useCount`.
  - **`entry_events`**: every change, with its actor (`overlord` or `operator`) and a note. This is the entries' journal.
  - **`cursors`**: one per feed, so each source is read once.
  - The store has its own `user_version` migrations and refuses to start rather than open empty, the `coord.db` rule.
- **Sources are references, not copies.** A source is an id such as `item:412`, `ask:9021`, `correction:77`,
  `act:1503`, `chat:<message id>` or `history:<node id>`. Each carries at most a 280-character quote. The store never
  becomes a second copy of the transcripts.
- **How it is used.** `GET /api/overlord/model?scope=&q=` returns the ranked entries: stated before inferred, the
  narrower scope before the wider, the recent before the old. Ranking uses FTS5 on `statement`. The Overlord cites the
  entry ids it weighed on every act row.

### 9.2 How it is fed

```mermaid
flowchart LR
  subgraph Sources
    S1["Rulings in coord.db<br/>item answers, ask and approval<br/>answers, digest corrections,<br/>overturns, goal changes"]
    S2["The Overlord chat<br/>what the operator tells it"]
    S3["Every project's history<br/>ccrc history, every provenance"]
    S4["Recorded rulings in docs<br/>specs' Agreed sections, ledgers"]
    S5["Corrections on the About you screen"]
  end
  S1 --> F["GET /api/overlord/feed<br/>cursor, one union reader"]
  F --> D["Daily distillation<br/>a Sonnet subagent of the Overlord"]
  S3 --> D
  S4 --> D
  S2 --> O["Overlord, as it talks"]
  D --> P["propose entries"]
  O --> P
  P --> M[("operator-model.db")]
  S5 --> M
  M --> R["About you screen<br/>review, correct, retire"]
  M --> U["Overlord decisions<br/>entries cited on each act"]
```
*Figure 7. Five feeds, one store. Rulings come through one server-side union reader. Every project's history comes
through `ccrc history`'s read verbs on the fleet box, under the Overlord's own scope. The chat and the operator's own corrections feed
it directly.*

- **Rulings** (S1) come through `GET /api/overlord/feed?after=<cursor>`. This is one union reader over the existing
  durable tables: `asks` and `approvals` rows the operator answered, `operator_items` with their answers and
  `operator_item_events`, digest corrections, act overturns (§10), `programme_modifications` and `run_events` caused by
  the operator. It adds no writer. Settings switches keep no history today, so changes to them are not a source until
  they do (Later).
- **The chat** (S2): when the operator states a preference, a rule or a correction, the Overlord records it at once as a
  `stated` entry. "Remember …" and "forget …" are plain requests to it.
- **Every project's history** (S3). The operator answered Q2: it can read everything (R10). The feed reads the history
  of every project through the Overlord's history door (C47), every provenance. The distillation learns most from the
  operator's own words, and reads the sessions' replies and tool output for what the operator accepted, corrected or
  overturned.
  - Every entry it yields from another project is `overlord-only` by default (§9.4), and the operator can switch any
    project off as a source.
- **Recorded rulings in documents** (S4): the specs' "Agreed" sections and the programme ledgers, where the operator's
  rulings are quoted with dates.
- **Distillation runs daily**, as a background Sonnet subagent of the Overlord. It runs under the Overlord's own
  attribution, so no other session can write the store.
  - It reads each feed from its cursor and proposes entries.
  - It checks each new entry against the existing and retired entries, so a retired entry is not proposed again.
  - It writes everything as `inferred` except rulings and the operator's own words, which are `stated`.

### 9.3 How the operator reviews and corrects it

- **An "About you" screen** in the Overlord place lists the entries, grouped by kind and scope. Each entry shows its
  statement, its basis, its sources (tap to open the item, the digest row or the chat message), when it was last used,
  and what it was used for: a link to the act rows that cited it.
  - **Confirm** makes an inferred entry `stated`.
  - **Edit** rewrites it in the operator's words and makes it `stated`.
  - **Retire** removes it from use, with an optional reason. It stays visible under "Retired", so the distillation
    does not propose it again.
  - **Scope** narrows or widens where it applies.
- **"Learned this week (n)"** heads the screen: inferred entries the operator has not looked at. It never pushes. The
  digest gains one weekly line with the count.
- **An overturn teaches.** When the operator overturns an act (§10.3), the Overlord marks the entries that act cited.
  If an entry was wrong, it proposes a correction, which the operator confirms on the screen.
- **C30. Inferred entries guide; they never authorise.** The Overlord may lean on an inferred entry for a routine call
  or a big call. It never cites an entry, stated or inferred, as the authority for an operator-only act: only a grant
  is that (§7). This is D-8126's A7, carried over to the model.

### 9.4 How it stays private

1. **Where it lives.** On the server box. In the two-box topology, fleet sessions have no filesystem path to it at all.
   On a single box, its path joins `ACCOUNT_SECRET_PATHS`, the deny list every session is spawned with (an accident
   guard, as for the operator secrets; note that the history store is *not* on that list, and history reads stay open to sessions).
2. **Who can read it.** Only the server reads the file. Three callers may ask the server: the designated Overlord (box
   token plus its attribution), the Overlord's own subagents (same attribution), and the operator's signed-in console.
   Every other caller gets 403.
3. **No secrets.** Every statement and quote passes the egress mask (`accounts/mask.ts`) on the way in. A statement the
   mask changes is refused, not stored masked, because a secret has no place in a preference.
4. **It never leaves ccrc.** Entries marked `overlord-only` are never quoted outside the Overlord's chat with the
   operator. Entries derived from S3 (other projects' history) are `overlord-only` by default. The skill forbids quoting
   any entry into a pull request, an issue, a commit, a tracker or a document. That rule is the skill's (C35): before
   any text leaves for a public place, the Overlord runs the fleet's existing local private-name scan, which reads the
   operator's own list on the fleet box. The server does not run the scan, because the scan's unpublished names live
   only in that local list, and copying it onto the server box would be a second copy of a private list.
5. **What reaches the model provider.** The Overlord reads entries into its context, as it reads everything else. That
   is the same exposure every session's transcript already has, and no wider.
6. **The operator's controls.** These sit in Settings, under Overlord:
   - pause learning (a switch);
   - exclude a project or a feed;
   - export everything as JSON;
   - wipe everything, behind a step-up;
   - an optional retention limit: inferred entries unused for N days are retired.
7. **Backups.** `ccrc backup` and `ccrc update` copy the file at mode 0600 beside `coord.db`. Restore follows the same
   rules. Test fixtures use neutral stand-ins only, as the public repository requires.

## 10. The audit log

R6: a log of everything the Overlord relayed, decided and started, marked by whether it can be overturned.

### 10.1 One table, written with the act

- **`overlord_acts`** has these columns:
  - `id`;
  - `at`;
  - `kind` (an act kind from §7.1);
  - `class`: `routine` or `big`, D-8126 §5.4's line, for `answer` acts;
  - `requestId`;
  - `targets` (programme, session, item, ask or run ids);
  - `summary`;
  - `why` (citing goals, rulings or entry ids);
  - `authority`: `own`, `operator-request:<id>` or `grant:<id>`;
  - `reversibility`;
  - `overturnable`;
  - `seenAt` (the operator's Seen tap, as D-8126 §6 has for calls);
  - `overturnedAt`, `overturnNote`;
  - `outcome`.
- **One writer.** Each Overlord door writes its act row in the same transaction as the act. An act that went through an
  Overlord door cannot be missing from the log, and a refused act leaves no row. Text passes `redactCommand` and is cut
  whole, as review-cap reasons are.
- **Reversibility is the server's, not the Overlord's.** It is read from the act kind's row in `OVERLORD_ACT_KINDS`.
  The words:
  - **reversible**: overturning it restores the before-state. An answer can be corrected before work depends on it; an
    escalation can be withdrawn.
  - **compensable**: it cannot be unmade, but another act undoes its effect. A relayed mail can be corrected but not
    unsent. A started coordinator can be retired, though the window it spent is gone.
  - **irreversible**: nothing undoes it, such as publishing or spending. No such act is possible until §7.4's
    condition holds. The column exists from day one so the log's meaning never changes.
- **Overlord answers are not also written as coordinator calls.** D-8126's `coordinator_calls` holds a coordinator's
  own calls. `overlord_acts` holds the Overlord's. These are two facts with two writers, and the readers that list
  "calls made for you" (Waiting on you, the digest, the run page) read both through one new reader, `callsFor`. It replaces D-8126's own read of `coordinator_calls` in each of those
  places, so the union is decided once.

### 10.2 What the operator sees

- **The Log tab** (§4) lists every act. Filters cover kind, programme, reversibility and "used a grant".
- **Waiting on you** shows the Overlord's `big`-class answers in D-8126's "Calls made for you" group, under each
  programme. Routine answers are not surfaced (D-8126 R4). They stay in the Log, unasked.
- **The digest** gains an Overlord section: requests opened and closed, programmes started and retired, big answers,
  grants used, overturns. It shows counts for routine answers. This differs from D-8126's "no routine count" for
  coordinators, because here the count is how the operator sees whether the Overlord is pulling its weight.

### 10.3 Overturning

- **One door.** `POST /api/digest/correct` gains an `overlord-act` row kind, beside D-8126's `call` kind. It marks the
  row overturned, then queues system mail to whoever must act on it:
  - for an answer, to the coordinator that received it, saying what to undo;
  - for a relay, to the same coordinator, with a correction;
  - for a start, the programme ends at once. The door's confirm sheet lists the programme's open runs. Confirm ends
    them through the archive door's `{programme:'end'}` path (the abandon door's own decision), and the Overlord is
    mailed the operator's note. E6's 24-hour idle rule is for the Overlord's own housekeeping, not for an overturn.

  Each overturn is also a ruling the Overlord learns from (§9.3).
- **Irreversible rows show no Overturn control.** They show "Cannot be undone, done at …" with the grant that allowed
  it.

## 11. What the server, the console and the skills gain

This section lists the build surface by bounded context, so each piece has one owner.

### 11.1 Contexts and rings

| Piece | Context | Ring | Extends |
|---|---|---|---|
| `shared/overlord.ts`: act kinds, reversibility words, request states, grant conditions | C5 Coordination | L0 | new vocabulary, pinned by single-definition |
| `overlordMayAct`, `nextRequestState`, the hold decision's Overlord tier, `itemReachesOperator` | C5, C6 | L1 | `heldFor` gains the `held-for-overlord` answer, read by `coord/questions.ts`'s mint and release. Items get `overlordUntil`, which is new: items had no hold (§6.1, C31) |
| `overlord_designation`, `overlord_requests`, `overlord_acts`, `overlord_grants` | C5 | L3 (`CoordStore`, synchronous) | `coord.db` migrations, next free slots after D-8125 and D-8126 |
| `operator-model.db` and its store | new context, **Operator Model** | L3 | its own file and migrations. Its reason to be a context of its own is privacy: one store, one reader, one deny path |
| Hibernate and idle-sleep eligibility skip the designated Overlord | C4 Workspace Lifecycle | L1 | one rung in each lane's eligibility, reading the designation |
| `overlordKickoff` template, `overlord` sender | C5 | L0 and L1 | `coord/kickoff.ts` beside the two existing templates |
| Overlord read doors, `GET /api/overlord/history`, the `overlord` history scope | C5, K (history) | L4 doors over the existing readers; L1 `decideScope` gains one scope | no second reader; the scope is passed only by the new read-only agent op (C47) |
| `homePlace`, the Overlord first in `PLACES` | C5 | PWA L1 | the one places list and the wordmark's door (C8) |
| `CONTINUITY_ROLES`, `renewalDue`, `compactInstructionsFor` | K (shared), C3 Session Conversation | L0, L1 | one role table; the Overlord and coordinators are rows (C49 to C51) |
| The renewal lane, `continuity_notes`, `GET /api/sessions/:id/card`, `ccrc-api probe` | C3, C5 | L3 and L4 | the roll and hibernate lanes call the renewal lane instead of resuming; the roster card gains role renderers (C49 to C52) |
| `OVERLORD_DENY_RULES`, the `overlord-not-a-coordinator` refusal | K (shared), C5 | L0, L1 | beside `ACCOUNT_DENY_RULES`; one refusal in the run-open decider (C48) |
| `overlordModelFor`, the designation's `model` | C5 | L1 and L3 | the renewal lane asks it; the limits read's per-class serviceability is its input (C45) |
| The exclusive account edge | C1 Fleet Registry & Accounts | L1 (`_pool_ok`, `pools.ts`), L3 (`pool_edges`) | one clause in the pool rule, one column, the `pool-exclusive` capability word (C46) |
| Start placement policy moved out of the PWA | C1 Fleet Registry & Accounts | L1 | `startProgramPlacement` gets one shared home for the sheet and the start door |
| Overlord doors (`/api/overlord/*`) | C5 | L4 | registered from a new `coord/overlordRoutes.ts`, a lane source of its own for the box-token census, `auth/gate.ts`'s `EXEMPT` table and the rings allowlist |
| `toId:'overlord'` role and the `overlord` system sender | C5 | L0 and L3 | `SYSTEM_MAIL_SENDER_MAP`, `MAIL_ROLE_IDS` |
| Follow-up arm, `overlord-not-live` release reason | C5, C6 | L1 and L4 | `sweepStalls`, the release reasons in `questions.ts` |
| Overlord place, Requests, Log, About you | C5 (and the new context for About you) | PWA L4, `*Words.ts` L1 | `PLACES`, the chat column, the ledgers screens |
| Settings: designate, kill switch, cap, grants, learning controls | K (settings) | PWA L4 | the Settings screen's sections |

### 11.2 Box-token surface

Every new `/api/overlord/*` route takes the box token, then attribution, then the designation check. They sit in
`auth/gate.ts`'s `EXEMPT` table with one reason each, like the claim lanes. The grant, designation and learning-control
routes are session-gated operator doors with a step-up, and they join the census's session-only set. The census tests
(`box-token-census.test.ts`, `coord-pause-route.test.ts`) and this repository's `CLAUDE.md` box-token paragraph are
updated in the same PR as each route.

### 11.3 The `ccrc-overlord` skill

The skill follows the coordinator skill's shape: a contract of numbered clauses, pinned verbatim by a test, and
references for the procedures (`routing.md`, `answering.md`, `starting.md`, `operator-model.md`). Its core clauses:
1. Talk to the operator in their style. Lead with the outcome and keep it short.
2. Route by §5.3.
3. Answer by §6.3.
4. Never act on an O-class without a grant.
5. Relay the operator's words verbatim and mark your own additions as yours.
6. Keep turns short and read through background subagents.
7. Never poll; mail and follow-up nudges wake you.
8. Record every stated preference at once.
9. Never quote the operator model outside the chat with the operator.
10. Obey every brake.
11. The SAFETY rules bind you as any session.
12. Do brain work only. Hand every piece of execution down to a coordinator, however small, as an outcome and never as
    a method, and let the coordinator decide how.

### 11.4 The coordinator skill

It gains clause 22: "An Overlord may stand above you."
- Your operator-bound items reach it first, so raise them exactly as clause 20 says, with `operatorClass` set when
  D-8126 classes them operator-only.
- Mail from `overlord` has two parts. The quoted operator words are the operator's steer. The rest is a call you may
  question.
- Reply to a relayed request `toId:'overlord'`: an ack, then the progress that matters, then done.
- An Overlord answer is a call: act on it, record it, and never cite it as an operator ruling. When the answer names
  a grant, cite the grant: it is the operator's standing ruling for that act.

It gains clause 23 too, in W1a, ahead of clause 22: "After a compaction or a renewal, check what you recall against
`ccrc history` or the server before you act on it. Keep your notes current: what each open thread waits for and what you
intend next" (C50, C52).

Clauses 22 and 23 are pinned verbatim by `coordinator-skill.test.ts`, like the others.

## 12. Measures of success

Success means fewer operator touches, faster answers, and no new stall.

| # | Measure | Target after four weeks | Read from |
|---|---|---|---|
| M1 | Questions the operator must think about, per programme-day: items and asks reaching the operator, where one that arrives with a recommendation the operator accepts unchanged counts half (§6.5) | half of the D-8126 baseline | `operator_items`, `asks`, `overlord_acts` |
| M2 | Time from an operator-bound question to an answer, median and 90th percentile | median under 10 min, 90th under 1 h, outside O-classes | the same |
| M3 | Overlord hold lapses (questions that fell through unread) | under 10% a week (C24) | the hold rows |
| M4 | Overturn rate of Overlord acts | watched, not targeted. A rise means the model or the procedure is wrong | `overlord_acts.overturnedAt` |
| M5 | Requests: time to first coordinator ack, and the share closed `done` | ack under 1 h | `overlord_requests` |
| M6 | Programmes with no movement for longer than the stall threshold | none that the Overlord did not report | the stall watch |
| M8 | Probe pass rate after renewal and compaction | 100% after one re-read | the probe rows |
| M9 | Outside audit scores, and agreement with the golden set | stable or rising; golden agreement at least 90% | `overlord_audits` |
| M10 | Context at renewal, and compactions per generation | under the ceiling; at most one compaction | `renew` act rows, the compactions journal |
| M11 | Generations on the designated model, and minutes stranded with no servable account | Fable for at least 90% of generations; stranded minutes watched | `renew` act rows, the pools journal |
| M12 | Execution attempts the guard denied, and relays that carried a method instead of an outcome | zero; each one is a skill defect, fixed in the skill | the hook's deny log, the outside audit's sample (C42) |
| M13 | Coordinators: probe pass rate after renewal and compaction, the weekly replay quiz score, empty cards, and the share of coordinator generations that used recall | probes 100% after one re-read; quiz above its W0 baseline; zero empty cards; recall in most generations | probe rows, the quiz lane, the card door, `ccrc history` |
| M7 | Inferred entries the operator retired or corrected, per week | watched. A high rate means the distillation over-reaches | `entry_events` |

## 13. Decisions (the author's calls)

The rulings are in §2. These are the calls the author made to build them. Each one waits on the operator's approval of
this spec and can be overturned by number.

| # | Call | Options considered | Chosen, and why | Status |
|---|---|---|---|---|
| C1 | What the Overlord is | a server agent loop, a session | A session: it reuses the chat, history, compaction and swaps, and the server stays free of judgement | Proposed |
| C2 | Who names it, and what it binds | self-declared, designated | Designated by the operator's door, bound to the session id so a compaction keeps it. The count is R7's: one, enforced by a singleton row | Proposed |
| C3 | Scope | one project, the fleet | The fleet, every project at once (R11); its own project only holds its pane | Proposed |
| C4 | Does it claim runs | yes, no | No: one coordinator per programme, and no nested-coordinator rule is bent | Proposed |
| C5 | Where its state lives | its context, the server | The server: it survives compaction and replacement | Proposed |
| C6 | Model | Opus, Fable | Fable at high effort, because the operator selected it (C45); subagents never Fable | Proposed |
| C7 | Brakes | its own, the operator's | All of the operator's, plus a kill switch of its own | Proposed |
| C8 | Surface | a new place, the home | The home (R9): first door in every navigation, the wordmark leads to it, one decider falls back to the Fleet when no Overlord can answer | Proposed |
| C9 | Request tracking | in its context, a table | A table: requests outlive compaction and the operator can see them | Proposed |
| C10 | The board | many reads, one composed read | One read composed from the existing readers, deciding nothing | Proposed |
| C11 | A busy owner | take the work away, keep it with the owner | Keep it, unless it splits cleanly and the owner agrees | Proposed |
| C12 | Starting or widening without being asked | allow, refuse | Refuse: it stays O3 until a grant | Proposed |
| C13 | Relay form | peer mail, system mail | System mail `overlord`, with the operator's words fenced apart from the Overlord's | Proposed |
| C14 | Reports to the Overlord | a new verb, mail | Mail to a new `overlord` role address | Proposed |
| C15 | Follow-up | polling, a stall-watch arm | A stall-watch arm that mails the Overlord when `followUpAt` passes | Proposed |
| C16 | What it reports to the operator | everything, the endings | Done, dropped and needs-you; the rest is on the list | Proposed |
| C17 | What holds for the Overlord | everything, items and asks | Items and asks. Approvals stay as today for now | Proposed |
| C18 | Its decision procedure | new, D-8126's | D-8126's, plus the operator model as a source | Proposed |
| C19 | What its answer is | a ruling, a call | A call, signed as the Overlord, overturnable. With a grant behind it, the grant is the operator's standing ruling | Proposed |
| C20 | Escalation | forward as is, with a recommendation | With a recommendation, the O-class and the entries weighed | Proposed |
| C21 | Item class | the Overlord judges, the item carries it | The item carries `operatorClass`; the Overlord may raise it, never lower it | Proposed |
| C22 | Hold windows | none, long, short | 20 min for items and 180 s for asks, then fall through | Proposed |
| C23 | A missing Overlord | queue for it, release at once | Release at once, and push the operator a restart control | Proposed |
| C24 | A busy Overlord | longer windows, shorter turns | Shorter turns, measured; a delivery mode only if M3 says so | Proposed |
| C25 | How authority is described | prose in the skill, a table | One L0 act table that the server enforces | Proposed |
| C26 | How the list relaxes | a mode, a trust level, per-act grants | Per-act grants with scope and conditions, operator-written, revocable | Proposed |
| C27 | Identity | a new token, attribution | Attribution, with irreversible grants refused until a signed identity exists | Proposed |
| C28 | Spawn limits | none, a cap | The fleet's limits plus a cap of 3 live Overlord-started programmes, adjustable in Settings | Proposed |
| C29 | Where the operator model lives | `coord.db`, its own file, the fleet box | Its own file on the server box, out of the sessions' reach | Proposed |
| C30 | What an entry may justify | anything, guidance only | Guidance only: it never authorises an operator-only act | Proposed |
| C31 | How holds are kept | a new hold service, extend each owner | Asks: a new `heldFor` answer. Items: one new column, `overlordUntil`, because items had no hold | Proposed |
| C32 | Who picks a started coordinator's account | the Overlord, the browser, one shared policy | One shared L1 placement policy, read by the sheet and the start door; roster accounts only | Proposed |
| C33 | Where a started coordinator lives | a main checkout, a named workspace | Always a named workspace, so ids never collide | Proposed |
| C34 | Who the kickoff is from | operator, overlord | `overlord`, with a new template that quotes the operator's words verbatim | Proposed |
| C35 | Where the private-name check runs | the server, the skill | The skill, with the fleet's local scan: the private list stays in one place | Proposed |
| C36 | How it lives for months | one compacted conversation, a new session per rollover, generations of the same session | Generations of the same session, renewed by the server from canonical state (R7 and R8 together) | Proposed |
| C37 | What a renewal may lose | the context, at most one turn | At most the turn in progress: every decision, commitment and open thread is written through | Proposed |
| C38 | How it is re-anchored | the skill alone, a server card at every start | A server-rendered card at every start, stable first and live last, 15k tokens, plus a one-line delta per prompt | Proposed |
| C39 | Compaction's role | the main mechanism, a fallback | A fallback: lowered window, idle compaction off, Overlord summary instructions, two then renew | Proposed |
| C40 | Stale-memory guard | none, canaries | Canaries: doors refuse a stale rules version | Proposed |
| C41 | Proving it remembers | trust, probes | Server-graded probes after every renewal and compaction | Proposed |
| C42 | Drift | self-assessment, an outside audit | A daily outside audit with a golden set of the operator's own answers | Proposed |
| C43 | Changing preferences | overwrite, bi-temporal | Bi-temporal entries: a change is a row, never something to remember | Proposed |
| C44 | Context hygiene | ad hoc, rules | Reads through subagents, one model per generation, compact reads | Proposed |
| C45 | How its model is chosen and kept | the session, the operator once, the operator plus the server | The operator's choice on the designation; the server applies it at each renewal, falls back to Opus at Fable's cap and returns after | Proposed |
| C46 | Its accounts | shared, a tagged pool, a tagged pool with exclusive accounts | A pool of its own, with an `exclusive` edge so no other session lands on its accounts; enforced on both boxes before it can be set | Proposed |
| C47 | What it may read | operator prompts only, everything | Everything the console reads plus every project's full history (R10); credential stores stay closed | Proposed |
| C48 | What it does itself | some small execution, none | None: brain work only (R12); every piece of execution goes to a coordinator as an outcome; skill clause, run-open refusal and a deny set hold the line | Proposed |
| C49 | How coordinators get the long-life fixes | a copy for coordinators, one mechanism | One role table; the Overlord and coordinators are rows; one decider, lane, notes table, card door and probe verb (R13) | Proposed |
| C50 | Coordinator renewal | none, the Overlord's triggers, their own | Their own row: ceiling, two compactions, failed probe, new build, a long wake, a long wave boundary | Proposed |
| C51 | Compaction instructions and empty cards | Overlord only, every session | Every session, by role: one instruction table, two carriers; a card that is never silent | Proposed |
| C52 | Recall and measuring loss for coordinators | none, probes, probes plus quiz plus a judge | Steering on the card and in summaries, clause 23, probes, the replay quiz weekly, and the Overlord as drift judge | Proposed |

## 14. Build order

This section gives the build order the plan should follow. Each wave ships something the operator can use, and each
depends only on the waves before it.

```mermaid
flowchart LR
  P0["Prerequisites<br/>D-8126 merged and built<br/>(calls record, goals read,<br/>decision procedure)<br/>D-8125 merged"] --> W1
  W0["W0 Longevity spike<br/>verify Claude Code knobs:<br/>PreCompact instructions,<br/>compact window, idle compaction,<br/>clear in place with a card,<br/>a model change at renewal,<br/>replay quiz baseline"] --> W1A
  W1A["W1a Continuity for every<br/>long-lived role<br/>role table, renewal lane,<br/>notes, cards, compaction<br/>instructions, probes,<br/>weekly quiz, clause 23"] --> W1
  W1["W1 Designate and talk<br/>exclusive account edge,<br/>designation with its model,<br/>skill v1, Overlord home and chat,<br/>board read, kill switch,<br/>the Overlord's card, canaries"] --> W2
  W2["W2 Route and follow up<br/>requests table, relay door,<br/>overlord mail role,<br/>follow-up arm, audit log"] --> W3
  W3["W3 Answer first<br/>Overlord hold tier for items<br/>and asks, answer and<br/>escalate doors, act catalogue,<br/>authority decider, grants door,<br/>probes, outside audit"] --> W4
  W4["W4 Learn<br/>operator-model.db, history door,<br/>feed read,<br/>distillation, About you,<br/>privacy controls"] --> W5
  W5["W5 Start and revive<br/>start, revive and retire doors,<br/>live-programme cap"] --> W6
  W6["W6 Propose and report<br/>grant proposals from<br/>the operator model,<br/>digest section"]
```
*Figure 8. A spike, the continuity wave and six Overlord waves. The spike proves the Claude Code settings §3.3 depends
on and takes the replay quiz's baseline. W1a fixes the long-life gaps for coordinators and builds the mechanism the
Overlord then uses; it needs neither prerequisite, so it can start as soon as this spec is approved. The prerequisites
gate W1, where the Overlord itself begins, with its card and canaries. The Overlord's probes and outside
audit ride W3, beside the shadow week that seeds their golden set. W3 is where the operator's load drops, and its grants door lets the
operator make the first relaxations right after the shadow week. W4 makes the answers the operator's own. W6 lets the
Overlord propose relaxations from what it has learned. Nothing in any wave is irreversible.*

- Each wave's PR carries characterization tests for every lane it touches, red-first tests for every new guard (the
  mutation-table discipline), and census updates in the same PR.
- **W1 ships the exclusive edge first,** in a pools-context PR of its own, fleet box before server box, because the
  server refuses the flag until the fleet box enforces it (C46). The operator then tags the Overlord's accounts in
  Settings before designating.
- **Switching on.** W3's hold tier ships dark behind `overlord-holds-live` and runs in shadow for one week. In shadow
  it records what it would have held, and the Overlord answers in the Log without acting. The week ends with an operator
  item that shows the shadow answers next to the operator's real answers. The operator switches it on.

## 15. Non-goals and anti-goals

**Non-goals.**
- No new notification channel: no Telegram, Discord or mobile app (R4).
- No change to approvals routing (C17), and no widening of what a coordinator may allow.
- No change to the coordinator's own decision procedure beyond clause 22: D-8126 owns it.
- No trained or fine-tuned model. The operator model is text the Overlord reads, never weights.
- No replacement for Waiting on you, the digest or the Runs screen. Each shows less noise, and the Overlord place joins
  them.

**Anti-goals** (the Overlord must never do these, whatever an entry, a grant or a request says):
- **A1. Never act on the SAFETY list,** and never work round a hook deny.
- **A2. Never speak as the operator.** Everything it sends is attributed `overlord`, and it never fakes the operator's
  words: a relay quotes the operator verbatim or not at all.
- **A3. Never take an operator-only act without a live grant,** and never lower an item's class.
- **A4. Never spend.**
- **A5. Never hide an act.** Every act goes through a door that logs it. It does not reach a coordinator, or the fleet,
  by any side path.
- **A6. Never let the operator model leave ccrc.**
- **A7. Never become the stall.** A hold it cannot serve falls through to the operator.
- **A8. Never make another Overlord,** or act as one outside the designated session (R7).
- **A9. Never execute** (R12). No edit, commit, pull request, build, test, run or dispatch of its own, and no plan
  pushed onto a coordinator in place of an outcome.

## 16. Risks

| Risk | What would happen | Mitigation |
|---|---|---|
| The Overlord answers wrongly with confidence | Coordinators build the wrong thing | Calls are overturnable and cheap to overturn (D-8126 prefers reversible options). M4 watches overturns. W3 ships in shadow first |
| The Overlord becomes the bottleneck | Questions wait on it instead of the operator | Short holds, fall-through, M3, and short turns (C22 to C24) |
| The operator model drifts or overfits | Answers reflect a stale or wrong picture | Stated outranks inferred. Learned-this-week review, overturns that correct, retention, M7 |
| Private content leaks into a public repo | A public, unerasable revision (GitHub keeps edits) | Section 9.4 rules 4 and 7, the private-name scan on every outbound text, and `overlord-only` by default for everything learned from another project. Reading everything (R10) widens what the Overlord could quote, not where it may quote it |
| A forged Overlord | A session acts with Overlord powers | Same exposure as a forged coordinator today, plus logged, overturnable acts. Irreversible grants are refused until §7.4's identity exists |
| Context load on one session | The Overlord loses the thread across many programmes | The board and the requests table are its memory. Reading goes to subagents. Compaction loses nothing (C5) |
| Too many coordinators | Window spend and box load rise | The live-programme cap (C28) and the fleet's own admission |
| Fable's weekly cap or window weight | The Overlord's accounts run out sooner than on Opus | The accounts are its own (C46), so the cost lands nowhere else. Reading goes to cheaper subagents (C44). Opus takes over at the cap and Fable returns after (C45). M11 watches it |
| The Overlord drifts into execution | It grows a context full of diffs and logs, and coordinators lose ownership | The skill clause, A9, the run-open refusal, the deny set, M12 and the outside audit's sample (C48) |
| The Overlord's pool is exhausted | No account can serve it | Holds fall through to the operator (C23), an operator item names the reset, and two or more accounts are recommended (C46) |

## Where things stand

### Agreed

- R1 to R6, the operator's rulings of 2026-11-09 on the six open questions of #2491 (§2).
- R7, the operator's ruling of 2026-11-09: there is one and only one Overlord (§3.1).
- R8, the operator's direction of 2026-11-09: it lives a very long time without memory loss (§3.3).
- R9, R10 and R11, the operator's rulings of 2026-11-09 after rev 2: the Overlord is the home screen with a top-menu
  button; it can read everything; it oversees every project at once and never moves between them (§2).
- R12, the operator's ruling of 2026-11-09 after rev 3: brain work only; execution always goes down the chain to
  coordinators (§3.5).
- R13, the operator's ruling of 2026-11-09 after rev 4: the long-life fixes apply to coordinators too (§3.3.9).
- The operator's direction of 2026-11-09, after rev 1: Fable, and an account pool of its own. C45 and C46 turn it into
  design (§3.4), and wait on approval with the other calls.

### Waiting on you

- **Approve this spec** with calls C1 to C52, or name the calls to change. C47 is where your "everything" stops: it
  keeps the credential stores closed.
- **Which accounts form the Overlord's pool.** You tag them in Settings once W1's exclusive edge is live; at least two
  are recommended (C46). Nothing in this spec names them.
- **The prerequisites.** D-8126 (PR #2487) and its four open questions, and D-8125 (PR #2490). The Overlord's W1
  starts when both have merged; W0 and W1a, the coordinators' fixes, do not wait for them.

### Later

- **Approvals through the Overlord.** Holding children's permission prompts for the Overlord, and letting a grant widen
  allows beyond `ordinary`. Trigger: M1 shows prompts as a large share of what still reaches the operator after W3.
- **A server-signed session identity.** The condition for granting irreversible acts (§7.4). Trigger: the operator's
  first request for an irreversible grant.
- **Other channels.** Mobile push beyond the web push, Telegram and Discord (R4). Trigger: the operator asks.
- **Settings history as a feed.** Switch changes have no history today. Trigger: the operator model needs them.
- **An Overlord-only mail delivery mode.** Trigger: M3 above 10% for two weeks (C24).
- **Programme-aware placement for the coordinators it starts.** This comes free when #749 lands.

---

*Written by Claude for the operator. Diagrams are Mermaid text. The Copy Mermaid button on the docserver copies the
source, which pastes into Lucid as editable shapes.*
