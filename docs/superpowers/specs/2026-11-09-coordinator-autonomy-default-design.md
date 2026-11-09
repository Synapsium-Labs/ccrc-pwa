# Coordinators decide by default: autonomy as the standing rule

**Spec** · 2026-11-09 · Status: draft for the operator's review. The rules in §2 to §4 are the operator's rulings of
2026-11-09 (D-8126); everything marked "author's call" waits on the operator's approval of this spec · Owner: the
coordinator that drives the build · Linear: none · Related: `ccd/coordinator-skill/SKILL.md` and its `references/`,
`docs/superpowers/specs/2026-10-31-programme-ledgers-design.md` (Goals and Waiting on you),
`docs/superpowers/specs/2026-10-20-fleet-capacity-and-worker-lifecycle-design.md` §3.5(e) (D-6091 to D-6097),
`docs/superpowers/plans/2026-10-26-coordinator-blocked-stall.md` (D-6942), `server/src/idlenudge.ts` (D-5373),
`docs/superpowers/specs/2026-09-23-session-continuity-design.md`, D-8123, D-8124, D-8125. Supersedes the
autonomy-window proposals #1628 and #1824.

## In short

A coordinator working a programme stops for one reason only: a decision or act that only the operator can make, or
being physically blocked after it has tried to heal itself. Everything else is the coordinator's to decide. Before it
asks the operator anything, it reads the programme's goals and definition of done, works out the answer, records the
call and keeps going in the same turn. This is the default and is always on. It is not a mode and not a time window.

**Why.** Coordinators ask the operator low-level questions the goals already answer, and then sit idle until a reply
comes. In the 14 days to 2026-11-09, coordinator turns that ended on a question and waited for a typed reply cost
680 hours across 32 waits of over an hour. Blocking AskUserQuestion dialogs cost another 539 hours across 116. By the
author's reading of the longest 92 waits, 66 of them (72%) were questions the coordinator could have settled itself
(§1.2). The operator's example: "Lift the review cap so a fourth review can read fix round 3?" sat on the Waiting on
you list for 9 hours and bounced twice. The operator's verdict: "a total waste of my time; it's OBVIOUS we should do
one more review round."

**Only the operator decides** (ruled): irreversible or outward-facing acts; spend beyond plan; changes to the
programme's goals, scope or definition of done; credentials and access (§3). **Physically blocked** (ruled), and only
once self-healing has been tried: no account has room; the box is out of disk or memory after its own cleanup and the
memory gate; an external service is still down after retries with backoff; a repository or tool is beyond the
coordinator's rights (§4).

**What changes:**
- **The skill.** A new contract clause 21 holds the rule. Each of the skill's stop-and-report exits gets a recovery
  path or an explicit class (§7).
- **The server.**
  - A goals read that coordinators can call, with a definition of done stored in the Goals pin.
  - A record of each call a coordinator makes. Design-level calls are surfaced so the operator can overturn them.
  - Detectors that wake a coordinator instead of only reporting it.
  - The 2026-10-20 "coordinator does it itself" ruling, which has never been built (§8).
- **Delivery.** The rule reaches running coordinators through the skill installer, a fixed line in the roster card
  re-injected after compaction, and one rollout mail (§9).

**Success:** coordinators stall for far fewer hours, the operator gets fewer items per programme-day, and items
the goals could have answered fall to almost none. The overturn rate of surfaced calls is watched as the guard (§10).

## 1. Why

### 1.1 The request

The operator, 2026-11-09, on a Waiting on you item that asked them to lift a review cap:

> "This, for example, is a total waste of my time and the coordinator's time. It's OBVIOUS we should do one more
> review round, and the coordinator should be able to decide and execute that as it sees fit."

The operator's two complaints, as ruled the same day:

1. **Coordinators ask too much.** They put low-level questions to the operator and wait, when the answer is easy to
   work out from the programme's goals.
2. **Coordinators stop too easily.** A coordinator working a programme must stop for one reason only: a decision or
   act that only the operator can make, or being physically blocked. Otherwise it never stalls, stops or pauses. It
   uses maximum autonomy, self-healing and resilience to take the programme to completion.

### 1.2 What it costs today (measured)

| What was measured | Window | Result | Source |
|---|---|---|---|
| Child mail held behind a coordinator's open question to the operator | 14 days to 2026-10-25, 19 coordinators | 20 episodes, about 102 h; three ran over 10 h overnight | D-6942's census, the `COORD_BLOCKED_HELD_MS` comment in `server/src/coord/stall.ts` |
| Mail to a coordinator held 30 min or more, any cause | same | about 77 coordinator-hours, roughly 5 a day | same |
| Coordinator turns that ended on a question and sat idle until the operator typed a reply | 14 days to 2026-11-09, 246 coordinator sessions | 137 waits. 32 lasted over an hour, 680 h in all. Median 3 min, 90th percentile 6.3 h | this spec's transcript census (below) |
| AskUserQuestion dialogs opened by coordinators | same | 611 dialogs, 598 h in all. 116 lasted over an hour, 539 h in all | same |
| Coordinators stood down on a usage limit that ccd misread as an unsent draft | 2026-11-07 | 34 to 271 min each | D-8116, D-8123 |
| The review-cap item in the operator's complaint | 2026-11-09 | open 9 h, returned twice | the operator |

**How the transcript census was taken (2026-11-09).** It was a read-only scan of the Claude Code transcripts on the
fleet box that changed in the 14 days to 2026-11-09.
- **A coordinator session** is a transcript that opened or dispatched a run, and either loaded the coordinator skill
  or declared coordinator intent.
- **Duplicates.** A transcript is copied when its session follows an account swap. The census removed the copies by
  message id.
- **A question-ending turn** is a finished turn with a question mark in the last 700 characters of its text. It counts
  as a wait on the operator only when the next prompt the session got was typed by the operator. A mail nudge, a
  system nudge or a compaction does not count. In that case nothing else woke the coordinator for the whole span.
- **An AskUserQuestion wait** runs from the dialog opening to its answer.
- **Spans are upper bounds.** They include nights, and they count sessions in all of the fleet's projects, not only
  this repository.

**What the long waits were about.** The author read the question behind every typed-reply wait over an hour (32)
and behind the 60 longest dialogs, and sorted each one against the lists in §3 and §4:

| Class | Waits | Hours | Examples (paraphrased) |
|---|---|---|---|
| Routine: the goals and the plan answer it | 45 | 404 | "Shall I open the PR for the doctor warning, with or without the repair?" (60.5 h, and 10.7 h on a second asking); "If you're happy with that order, I'll start item 1" (25.9 h); "Lift its review cap?" (several); "Shall I queue all four?"; "Shall I start a second landing attempt?"; "Should I ask the flaky test's owner to look at it?" |
| Big call: a design-level choice the coordinator can make and surface | 21 | 129 | "Which treatment makes it obvious which workers belong to which coordinator?"; "Should the coordinator rewrite the approved spec, or keep amendments beneath it?"; "Which structural fix should govern the final change?" |
| Operator-only | 21 | 563 | "Do you approve the spec?"; "Should I remove these people from the organisation?"; "Ship ordinary values now and leave the secret store for later?" (a cut to what "done" means); "May I make it public?"; "How should this model run, now that the cloud account's policy blocks its region?" One 357 h wait was a programme kickoff before any goals existed. |
| Physically blocked | 3 | 21 | "The fleet volume is under its floor, so no workspace can start. Which of these should happen?" |
| Mixed | 2 | 5 | one message bundling routine and operator-only questions |

Routine and big calls together are **66 of 92 waits (72%) and 532 of 1,121 hours (47%)**. Set aside the one 357 h
kickoff and the hours share rises to 70%. Twice in the sample, the operator's whole reply to a list of questions was
to ask for the coordinator's own recommendation ("Recommendation and why please", four times in one reply): the
coordinator had asked without recommending, though the goals already pointed one way.

### 1.3 Why it happens (measured from the skill and the code)

1. **The skill defaults to the operator.** Clause 11 tells a coordinator to decline any child question that "would
   require guessing rather than reading". Any "tradeoff nobody ruled on" goes to the operator. The skill never says
   "work it out from the goals".
2. **The goals are stored but cannot be read back.** The Goals pin keeps a spec path, an "In short" and a list of
   modifications (`server/src/coord/ledgersRoutes.ts`). A coordinator can only write it (`goals pin`, `goals modify`,
   `goals merged`). The one read, `GET /api/programmes/:slug/goals`, is session-gated: it is the operator's door, and
   coordinators carry the box token. No definition of done is stored at all. Only one ledger writes one down by
   convention (`docs/superpowers/programs/ccrc-history.md`, "Goals and definition of done").
3. **A decide item has no "go ahead unless overturned" path.** Clause 20 asks for a recommendation (D24 of the
   ledgers spec), and the coordinator then waits for a tick.
4. **About 25 refusal codes end in "stop and report".** Many are software faults, not operator decisions or physical
   limits. The skill's rule is "a program that stalls honestly is recoverable" (`SKILL.md`, "When something is
   wrong").
5. **The do-it-yourself ruling is not built.** On a `cap-concurrency` refusal the skill still says "stop, say so, and
   wait to be woken". The 2026-10-20 ruling (fleet-capacity spec §3.5(e), D-6095 to D-6097) is unbuilt: there is no
   `inPlace` bind and no `admissionWaitSince` in `server/src`.
6. **Detectors report but never act.** The stall watch's `coord-blocked` arm "only reports" (D-6942). The
   idle-compaction nudge fires only when a session's task list has open items (D-5373), and a coordinator's open runs
   do not count as open items.
7. **Autonomy lived only in one-off ledger directions.** "Autonomy mode for 12h" in `programs/ccrc-history.md` and
   "autonomy for nine hours" in `programs/desktop-polish.md` are examples. Each lapsed with its session.

## 2. The standing rule (ruled)

**R1. Default and always on.** The rule is how every coordinator works, on every programme, at every hour. It is not
a mode, a setting or a window, and nothing turns it off. It supersedes the earlier autonomy-window idea (#1628,
#1824). (Ruled, 2026-11-09.)

**R2. Work it out before asking.** Before asking the operator anything, a coordinator works the answer out from the
programme's goals and definition of done: the Goals pin, the spec it pins, the programme ledger, and the operator's
recorded rulings. It decides, records the call and keeps going. (Ruled.)

**R3. Stop for two reasons only.** A coordinator stops a thread of work only for a decision or act that only the
operator can make (§3), or when it is physically blocked after self-healing has been tried (§4). Everything else is a
fault to recover from. The coordinator skill's stop-and-report refusals get recovery paths (§7). (Ruled.)

**R4. Surface only the big calls.** Design-level choices reach the operator, and each one can be overturned. Routine
calls are not surfaced. (Ruled.)

**R5. Build the do-it-yourself ruling.** The 2026-10-20 ruling that a refusal never strands work (fleet-capacity spec
§3.5(e), D-6091 to D-6097) is built as part of this work. (Ruled.)

**R6. One stopped thread never stops the programme** (author's call, read from R3). A coordinator that hits an
operator-only point or a physical block parks that thread only. It raises the item, then works every thread that is
not blocked. It ends its turn only when no unblocked work is left or children hold all of it, and the turn's text
says which. "Stopped" means the programme has nothing left that the coordinator may do.

**R7. Never a blocking dialog on a pinned programme** (author's call). Once a programme has a Goals pin, its
coordinator never opens an AskUserQuestion dialog. Clause 19 already forbids one while a child is active, because a
dialog makes the coordinator read `waiting` and holds every child mail behind it. Operator-only questions go on the
Waiting on you list as items (clause 20). Before the pin, in the brainstorm and spec phase, the operator *is* the
source of the goals. Questions there are operator-only by definition, and dialogs stay allowed.

## 3. What only the operator decides (ruled)

The operator ruled four classes on 2026-11-09. Each row below gives the class, real examples, and what the coordinator
does while it waits. In every class the coordinator raises one item with `ccrc-api items raise`, naming what, how and
why. A `decide` item also names the option it recommends and why that option beats each alternative (D24). The item
is set `blocking` only when every thread is parked on it.

| # | Class (ruled) | Includes | Examples from real items | Meanwhile |
|---|---|---|---|---|
| O1 | **Irreversible or outward-facing acts** | Acts the repository's SAFETY rules list as forbidden to sessions, and acts on the live boxes: reaping, removing, expiring or reclaiming workspaces; touching units or tmux; account management; rolling or selecting a Claude Code build; `ccrc history` writes; deploys and rollouts; writing live box config. Publishing: making a repository or package public, cutting a release, a public page. Messaging people. | "May I write the landing config with `lineage=off` on the live box?"; "May I make it public?"; "Should I remove these members from the organisation?" | Builds and reviews everything up to the act. The PR is ready; the act waits. |
| O2 | **Spend beyond plan** | Usage credits, including any "Switch to usage credits" and any escalation to a model billed on credits. Paid services. New accounts. | "Should this design go to the credits-billed model per your policy?" | Continues on the plan's own models and accounts. The debug ceiling's next rung waits; the rest of the programme does not (§7, row 49). |
| O3 | **The programme's goals, scope or definition of done** | Approving a spec or a change to one. Approving or changing the definition of done. Starting work outside the definition of done. Dropping or cutting a definition-of-done item. Accepting a known limit that leaves a definition-of-done item unmet. Starting a new programme. Choosing what the programme does next once its definition of done holds. | "Do you approve the spec, with my calls D11 to D22?"; "Ship ordinary values now and leave the secret store until a feature needs it?"; "The next wave is outside your definition of done. Shall I start it?" | Works every item inside the current definition of done. When the definition of done holds, it closes the programme, as step 7 says. |
| O4 | **Credentials and access** | Secrets (only through a `secret` item; a secret never reaches a coordinator). Sign-ins and account auth. Repository settings: rulesets, branch protection, merge methods, auto-merge (clause 15). Who may act on a programme: handing it to another session after a lost id (`resume.md` §6). Granting or removing people's access. | "A required approval is missing and the repo has no admin door" (outside D-8124's door); "This account's lane needs a sign-in" (`spawnState: login`) | Routes work to lanes and repositories it can use; the blocked thread waits. |

**Two classes the author adds as plain readings of the rulings** (author's calls):

- **O5. A fact only the operator holds.** Examples: who the data-protection officer is, or whose code an unknown
  account pushes. No source the coordinator can read holds the answer, so a guess is never allowed (anti-goal A2).
  It is asked as a `value` item. Everything that does not depend on the answer goes on.
- **O6. Overriding a person.** Ignoring a human reviewer's requested change, or a ruling some other person made. This
  is the "ignore" answer to the landing verdict's `changes-requested` stop. "Address" is the coordinator's default
  (§7, row 42), and "ignore" stays the operator's.

**What is not outward-facing** (author's call). The fleet's ordinary work on a programme's own repositories is part
of building, not publishing:
- pushing branches, and opening, updating and landing PRs by the route clause 15 gives;
- commenting on the programme's own PRs and issues, and replying to review bots;
- mailing other coordinators and sessions through ccrc.

So "may I add this to the issue as another case?" is routine. Messaging a person outside ccrc and its PR threads
(email, chat, a tracker comment addressed to someone) is O1.

## 4. Physically blocked (ruled), and the self-healing tried first

A coordinator may treat a thread as physically blocked only after it has tried the healing steps for that case. The
four cases are ruled. The steps are the author's calls, built on mechanisms that exist or are in flight. When a block
holds, the coordinator records it with its wake condition (§8.2, `class: block`), parks the thread (R6), and the
server wakes it when the condition clears.

| # | Case (ruled) | Self-healing first (author's calls) | Who wakes it |
|---|---|---|---|
| P1 | **No account has room** | (1) Auto-swap moves the session to an account with room; that is ccd's job (session continuity; swap rulings D1 to D7). (2) The limit watchdog forces a stuck rescue after 5 minutes (D-8123). (3) The coordinator never picks "Switch to usage credits" and never sends keys to the limit menu: that would be spend (O2). (4) Only when the watchdog reports that no account has room anywhere is the thread blocked. D-8123 then raises the Waiting on you item with its "Swap to…" control. | The swap or the home account's reset. ccd resumes the session; a resumed coordinator re-reads `runs list` and its goals (§9). |
| P2 | **The box is out of disk or memory** | (1) **Its own cleanup.** Remove its own sibling worktrees once their PRs are pushed (§3.5(e)'s tree rule). Delete its own scratch in its temp root. Close finished runs, so the server reclaims their children (clause 3: the server reclaims and the coordinator never reaps). (2) **The memory gate.** Tests run only through `ccrc test` (clause 18), which queues heavy runs fleet-wide. Cold starts wait on memory pressure (D-8122). (3) **Lighter work.** Choose the lighter path a plan allows, such as a narrower suite or one worker at a time. (4) Never a SAFETY-listed verb, never a unit or tmux touch, never another session's files. | The capacity spec's wake-on-free mail (§3.5(e), D-6095) when headroom returns. The disk alarm clearing (§8.2). |
| P3 | **An external service is down** (GitHub, Linear, the ccrc server, a package registry) | Retry with backoff and jitter: 1, 2, 4, 8, 15 and 30 minutes, then every 30 minutes for up to 4 hours. Meanwhile it works every thread that does not need the service: ledger prose, reading, briefs, other repositories. Nothing is done by hand in the service's place. On `rate-limited` it waits as the answer says and never loops. When the ccrc server itself is down, nothing can be recorded there: the coordinator says so in its turn's text and ends the turn. | Its own backoff timer, kept as a recorded wake time. Or, when the server was the outage, the `coord-idle` arm once the server is back (§8.3). |
| P4 | **A repository or tool is beyond its rights** | (1) Look for an allowed route: the server door for the act, a different ccd verb, the owning coordinator by mail, the claim holder's `expiresAt`. (2) Check whether the missing verb ships in a pending release (`unsupported`, `no-questions-door`, an old client). (3) Never work round a hook deny or a SAFETY rule. Examples: a `ccd` build without a verb, a hook deny, a repository the fleet's identity cannot write, a stored programme row the server refuses (`hold-oversize`, `hold-invalid`). | The item's tick, or the update that brings the verb. |

## 5. The decision procedure

A coordinator follows these steps for every question it would otherwise ask, including a child's question (clause 11).

### 5.1 Step 1: is it operator-only?

Check the question against §3 (O1 to O6). If it falls in one of those classes, raise the item and park the thread (R6).
**Doubt resolves towards the operator only for O1 to O6. It never does for "is this big or routine?".** If a question
mixes an operator-only part with routine parts, split it: ask only the operator-only part, and decide the rest.

### 5.2 Step 2: read the goals

Read, in this order. The first one that settles the question wins:
1. **The Goals pin.** The new coordinator read (§8.1): the pinned spec path, its "In short", the definition of done,
   and the dated modifications with their rulings.
2. **The pinned spec and its plan.** Their decisions tables and "Where things stand".
3. **The programme ledger.** "Goals and definition of done", Decisions and deviations, and Carried constraints.
4. **The operator's recorded rulings that apply.** D-numbers in specs and plans, digest corrections (clause 11), and
   the repository's `CLAUDE.md` rules. Examples: "UI must work at every width", "improve what exists first",
   "deps to the latest major", the review-round cutoff.

### 5.3 Step 3: decide

Pick the option that best serves the goals and the definition of done. When the goals do not tell the options apart,
use these tie-breakers, in order (author's calls):
1. **Reversible beats irreversible.**
2. **Smaller blast radius beats larger.**
3. **Extend what exists** before adding anything new (the repository's consolidation rule).
4. **The operator's stated preferences** (step 2, item 4).
5. **Cheaper in time and fleet capacity.**
6. **The option the coordinator would have recommended in a decide item.**

Two operator rulings that conflict are settled by the later one. The call names both (author's call). Example: the
operator's "Decision 2 (a)" against an older "a fresh install ends green".

### 5.4 Step 4: routine or big

**A big call** (author's call on the line) is a design-level choice. It is one of these:
- it changes behaviour the spec describes;
- it changes a public contract: an API route, a wire shape, a stored schema or migration, a CLI verb;
- it changes what the operator will see in the console;
- it changes structure across more than one bounded context;
- it settles a cost or risk trade-off the spec left open;
- it departs from the plan in a way that changes what a later wave builds.

**A routine call** is everything about how to get there:
- sequencing and scheduling;
- dispatch, routing and which worker;
- landing, re-queueing, and a second landing attempt;
- one more review round (D-8125);
- fix strategy within the spec;
- triage of flaky tests;
- retries;
- approving a wave plan that implements an approved spec;
- coordination with another programme by mail;
- reading an ambiguous rule in the source documents the programme implements;
- reporting what was measured.

**Real items, and what they would have been:**

| Question as it reached the operator | Wait | Class | The call the coordinator makes instead |
|---|---|---|---|
| "Lift the review cap so a fourth review can read fix round 3?" | 9 h, returned twice | Routine | Lift with a reason through D-8125's door, then open the review. A ledger line records it. |
| "Can you lift its review cap (run 1353) by one round? One more review is all that stands between it and the merge queue." | 3.1 h | Routine | The same. |
| "Shall I open the PR for the doctor warning, with or without the repair?" | 60.5 h and 10.7 h | Routine | With the repair: it is inside the goals and reversible. |
| "If you're happy with that order, I'll start item 1 and launch the item 4 code check in parallel." | 25.9 h | Routine | Start. Never ask for consent to a plan already inside the goals. |
| "Shall I queue all four?" | 0.6 h | Routine | Queue them by clause 15's route. |
| "Should I tell the other session where the version evidence is and correct those sections?" | 25 h | Routine | Mail it, then correct the sections. |
| "Does the plan capture what you want?" (a wave plan for an approved spec) | 0.7 h | Routine | Run the plan's review panel; on a clean report, dispatch. |
| "Should the delegation broker programme own that fix?" | 1.0 h | Routine | Mail that coordinator and agree it between the two of them. |
| "Which treatment makes it obvious which workers belong to which coordinator?" | 6.3 h | Big | Pick by the goals and the "card = glance" ruling. Build it reversibly, surface the call, keep going. |
| "Should the coordinator rewrite the approved spec, or keep amendments beneath it?" | 5.5 h and 4.1 h | Big | Pick, surface, keep going. (The operator later ruled amendments; an overturn would have cost one edit.) |
| "Do you approve the spec, including my calls D11 to D22?" | 6.4 h | Operator-only (O3) | Raise the item; meanwhile prepare the plan. |
| "Should I remove any of them from the organisation anyway?" | 7.8 h | Operator-only (O1, O4) | Raise the item; do everything else on the list. |

### 5.5 Step 5: record

Each call gets one record through the new `ccrc-api calls record` (§8.2). The record holds the question, the options,
the choice, a one-line reason that cites the goal or ruling it rests on, whether the choice is reversible, and the
class (`routine` or `big`). The coordinator also writes one line in the ledger's Decisions section on its next ledger
commit. The ledger stays for humans and the server record is for counting and surfacing (author's call: the ledger
is parsed by nothing, so the measures in §10 need the server row).

### 5.6 Step 6: continue

The coordinator carries on in the same turn. A call never ends a turn. If the operator overturns a big call later,
the coordinator applies the overturn (§6) as it would apply any steer.

## 6. How big calls are surfaced and overturned

The operator sees big calls through mechanisms that already exist. No new list is added (author's calls, following
the repository's consolidation rule):

- **On the Waiting on you page, read the way Questions are read.** The ledgers spec §3.1 reads session questions
  through the one `OperatorQuestion` model and does not store them as items. Big calls work the same way. The page
  reads them from the calls record and shows them in a collapsed group, "Calls made for you (N)", under each
  programme. The group sits below the items that wait on the operator. Calls never push and never count as blocking.
  A call leaves the group when the operator marks it seen, or after 7 days, and moves to "Recently cleared".
- **In the daily digest.** The digest already lists "what coordinators decided in the operator's name"
  (`server/src/coord/digest.ts`, D-5300). It gains a line kind for big calls and a one-line count of routine calls
  per programme.
- **One overturn door: the digest's correction route, extended.** `POST /api/digest/correct` already corrects a
  coordinator's ruling on an ask or an approval. It gains a `call` row kind, so the one correction door stays one door
  (D-5493: the digest and the correction route can never disagree about what a coordinator decided).
- **One tap plus a confirm, on the item** (the 2026-11-04 action-on-the-item ruling). Each call row carries an
  **Overturn…** control. It opens a confirm sheet that lists the options the coordinator weighed, with the chosen one
  marked, plus a note field. Confirm sends the correction. **Seen** is one tap with no confirm, because it changes
  nothing.
- **What the coordinator does on an overturn.** The correction mails the owning coordinator, as a digest correction
  does today. The coordinator then:
  1. records the overturn as a ruling (`goals modify` when it steers the goals);
  2. undoes or adapts the work, the same way it handles any steer;
  3. writes the reason into the ledger.

  Big calls prefer reversible options (§5.3) so that an overturn stays cheap.
- **Routine calls are never surfaced one by one** (ruled, R4). The operator can still read them in the ledger and the
  digest's count, and can correct one through the same door if they come across it.

## 7. Inventory: every stop, decline and wait point, and its new disposition

**Dispositions:**
- **Keep (operator-only):** stays the operator's, by §3.
- **Physical:** a §4 case; heal first, then park.
- **Self-recover:** the coordinator handles it.
- **Guard:** not a stall. The session is not acting as a coordinator, or a safety rule holds.

"Where" uses today's anchors on `main` at `47007038c`. The plan re-grounds each anchor by its text.

| # | Where | Today | New disposition | The recovery path, or why it stays |
|---|---|---|---|---|
| 1 | `SKILL.md` clause 4; "When something is wrong" `paused`; `wave-lifecycle.md` §2 `paused` | Stop, report, touch nothing | Keep (operator-only) | The pause file is the operator's. While paused, the coordinator does every non-dispatch thread (ledger, landing already-reviewed PRs, briefs) and dispatches nothing (author's call). |
| 2 | `wave-lifecycle.md` §2 `mail-disabled` | Stop, report | Keep (operator-only) | The operator's kill switch. |
| 3 | Clause 8; `resume.md` §2 and §6 `claimed-by-another` | Stop and report; the operator hands over from the console | Physical (P4), keeping the handover operator-only (O4) | Try the id-preserving revive first (`resume.md` §3). The server raises the handover item itself, with its evidence and a one-tap control (§8.3, item 5). |
| 4 | Clause 11; the ask lane in `wave-lifecycle.md` ("decline … a NEW decision", "if answering would require guessing rather than reading") | Release to the operator | Self-recover | Rule from the goals (§5). Working an answer out from the goals is reading, not guessing. Release only O1 to O6. Clause 11's words change (§9.1). |
| 5 | Clause 11, a permission prompt that is not `ordinary` | Cannot be allowed; hand over | Guard | The default-escalate classifier stays (D-5299). Never relax it. |
| 6 | Clause 15, "every conflict among [the repository's rules] is a stop for the operator" | Stop | Keep (O4) | Repository settings belong to the operator. The thread parks and the rest continues. |
| 7 | Clause 15, "a refused merge is a stop, never retried" | Stop | Split | A transient refusal (5xx, a timeout, a rate limit) is P3: retry with backoff. A rule GitHub enforces is O4. `approval-missing` goes through D-8124's admin-merge door where it applies. |
| 8 | Clause 19, "asks the operator in its closing turn text and ends the turn" | Ends the turn on a question | Self-recover | The question is decided by §5. Only O1 to O6 become items, and the turn goes on to other threads (R6). |
| 9 | Clause 19, AskUserQuestion when no child is active | Allowed | Removed once the Goals pin exists | R7. |
| 10 | Clause 20, raising items | Every operator need | Narrowed | Items only for O1 to O6 and P-blocks that need a human act. Big calls are records (§6), not decide items. |
| 11 | Step 4, `unknown-item`, `item-terminal` | Stop and report | Self-recover | Re-read the ids once (`runs items-list`). If still unknown, record and go on: the tally is display only. `item-terminal` is a no-op to record. |
| 12 | Step 5 and `wave-lifecycle.md` §4, `cap-review-rounds` | The server asks the operator; the coordinator waits | Self-recover (D-8125) | The coordinator lifts the cap with a reason through `runs review-rounds`. The operator's own lift and the server's ask behave as D-8125 sets out. |
| 13 | Step 5, a bare `400` on a review open (an older server) | Wait for the next wake | Physical (P4) | Unchanged in substance; it is recorded with a wake time. |
| 14 | Step 6, an ejection with no `pinned` entry on the landing line ("it stays a stop for the operator") | Stop | Self-recover | Send a conflict-sync request on the measured conflict (clause 15 allows one) as a plain `fix-round` mail with the conflicted paths and no `ejection` field. |
| 15 | Step 6, a dequeue with any other cause, a requested change among them | Stop for the operator | Self-recover, except "ignore" | Re-read the cause. An unreadable cause is P3 (retry), then re-enqueue once. A requested change is addressed by default; only "ignore" is the operator's (O6). |
| 16 | Step 6, an advance whose landing recorded no base ("report it to the operator") | Report | Self-recover | Read `runs list` for the run's state, then send a plain fix round and record it. |
| 17 | Step 6, "Different project": a missing or non-`done` row, a failed release, absent merge proof | Report, do not dispatch | Self-recover | Re-read with backoff. Absent merge proof means land the producer first (step 7), not report. |
| 18 | Crossing paragraph and "When something is wrong", `cap-concurrency`: "stop, say so, and wait to be woken" | Wait | Self-recover (R5) | The fleet-capacity spec §3.5(e): the in-place bind and a sibling worktree, unless one of its seven reasons applies. Then the wake-on-free mail (D-6095 to D-6097). |
| 19 | `hold-oversize`, `hold-invalid` | Stop and report | Physical (P4) | A stored row the coordinator may not correct. Raise a `do` item; other programmes and threads continue. |
| 20 | Untyped answers: `unsupported`, `not-configured` | Stop and report | Physical (P4) | A tool or box fact. Record it with a wake on the update. |
| 21 | A bare `{"ok":false,"stderr":…}` 502 | Stop and report; never retry | Self-recover, then physical | Read the stderr. Slug in use: choose another name. An `ensure` or `ws-hold` failure: retry with backoff, three times. Then P4. |
| 22 | `registry-unmeasurable` (502), possibly after `ws-add` ran | Stop; the operator resolves it | Self-recover after the server reconciles | The server adopts or records the orphan itself (§8.3, item 3). The coordinator retries once the server's answer says the run is reconciled. |
| 23 | "When something is wrong": cannot reach the server | Stop and report | Physical (P3) | Backoff. The `coord-idle` arm wakes it once the server is back (§8.3). |
| 24 | Clause 15 and §5b, "No `--admin`" | Never | Self-recover where D-8124 applies | Through D-8124's one checked door. Everything else stays as ruled there. |
| 25 | Linear, `not-configured` | Tell the operator | Keep (O4) | A key is a credential. |
| 26 | Linear, untrusted text | Read as data | Guard | Unchanged. |
| 27 | The skill's description, "Never use it to do a wave's own work" | Forbidden | Changed (R5) | Allowed through §3.5(e)'s in-place bind only. W1-5's words (D-6097). |
| 28 | `wave-lifecycle.md` §1, `home-mismatch` | Stop and report | Self-recover | Resend with the stored home (`by`). If the slug turns out to name another programme, open under a new slug. |
| 29 | §1, `claimant-is-a-worker` | Stop and report | Guard | The session is a worker, not a coordinator. |
| 30 | §1, `project-mismatch` with no project on the caller's row | Stop and report | Physical (P4) | A registry fault. Raise a `do` item. |
| 31 | §1 and §2, `spent-unmeasured` repeating | Stop and report | Self-recover | After one retry, open without `sessionId` when the next wave depends only on merged code. Step 6 already says dropping it is safe. Otherwise back off (P3). |
| 32 | §2, `ambiguous-dispatch` | Stop; the operator resolves it | Self-recover | Once the server has reconciled (§8.3, item 3), dispatch again with an explicit `slug`. A named spawn binds only `<project>-<slug>`. |
| 33 | §2, `hookstate-unmeasurable` or `status-unmeasurable` repeating | Retry once, then stop and report | Self-recover, then physical | Back off three times over about 15 minutes. Then dispatch a fresh child where §31's rule allows. Then P4. |
| 34 | §2, `project-mismatch` at dispatch | Stop and report | Self-recover | Open fresh without `sessionId`, as the crossing rule already says. |
| 35 | §2, `intent-held` | Mail the holder; dispatch only on its word or the operator's | Self-recover | The two coordinators settle it between themselves. The holder's word decides. Silence parks the thread and the rest continues. Only a disagreement between them about cross-programme scope is the operator's (O3). |
| 36 | §2, `spawnState` `login` or `blocked` | Tell the operator; do not re-dispatch onto that lane | Split | The account is O4 and gets an item. The wave is re-routed to another lane at once. |
| 37 | §2, `spawnState: narrow` | Ask the operator to widen the pane | Self-recover, then physical | Give it the ordinary window, then dispatch fresh. A `do` item is raised only if it repeats, and never as blocking. |
| 38 | §2, `skillState: absent` ("report before you treat the wave as briefed") | Report first | Self-recover | The wave is briefed: the brief carries the branch line for exactly this case. The server installs the skill (§8.3, item 4), or else a non-blocking `do` item. |
| 39 | §2, the answer's `sessionId` differs from `<project>-<slug>` (older server) | Stop and report | Physical (P4) | Record it with a wake on the update. |
| 40 | §4, `branch-unmeasurable` repeating | Needs a human | Self-recover, then physical | Back off (P3), then P4. |
| 41 | §4, `ejection-not-merging` | Report to the operator | Self-recover | Re-read the run and act on the state it is in. |
| 42 | §5b, the landing verdict's stops | Every stop goes to the operator | Split by reason | **Rule shape** (`unknown-rule-type`, `method-set-empty`, `rebase-only`, `queue-method-not-allowed`, `two-queue-methods`, `auto-merge-off`, `read-3b-unknowable`, `unverifiable`): O4, non-blocking. **Transient** (`unreadable`, `verdict-unread`, `checks-gate-unread`, `not-reported`): P3 backoff. `not-at-head`: re-measure and re-bind through the existing paths. `changes-requested`: address by default; "ignore" is O6. `approval-missing`: D-8124. `red-unreachable`: the new-head route where `main` is already fixed (D-7588); otherwise mail the red's owner and park. `github-refused`: O4, unless the refused rule is code scanning on the PR's own findings, which is a fix round. |
| 43 | §5, the landing line paused, the pin differs, the read fails | Report; leave the landing stopped | Split | A paused line is the operator's (keep). A failed read is P3. A different pin is re-measured, and re-pinned through the normal advance where the server's own pin is stale. |
| 44 | The ask lane, `child-unmeasurable` and `not-held` | Re-read; do not loop | Unchanged | Already self-recovering. |
| 45 | The ask lane, `no-questions-door` | Tell the operator | Physical (P4) | Record it with a wake on the update. |
| 46 | Clause 3 and §6, reaping | Never | Guard | A SAFETY rule. Never relaxed. |
| 47 | `resume.md` §6, the id is lost | Stop and report | Keep (O4), automated | The server raises the handover item itself (row 3). |
| 48 | `resume.md` §2, the dead-coordinator lane | Armed by the operator | Unchanged | Already ruled. |
| 49 | `routing-matrix.md`, Debugging: "reports the ceiling and stops" | Stop | Split | Only the jump to a credits-billed model is O2. The coordinator continues: `max` by the mechanical rule, a fresh-context worker, a narrower reproduction. Failing all of those, it parks the item and goes on with the rest of the programme. |
| 50 | `peer-protocol.md`, a claim holder `deliverable: no:<reason>` ("escalate to the operator") | Escalate | Self-recover | Work the uncontested paths and wait for the claim's `expiresAt`. Only a claim that never expires is P4. |
| 51 | `mail-envelope.md`, parked mail | The operator is told after about 15 min | Unchanged | A delivery fault the server already reports; the sender keeps working. |
| 52 | Server, the stall watch's `coord-blocked` arm | Reports only (D-6942) | Acts first | §8.3, item 1. |
| 53 | Server, the idle-compaction nudge | Fires only on open task-list items (D-5373) | Widened | §8.3, item 2. |
| 54 | Server, `cap-concurrency` and the future `capacity` refusal | Refuses; nothing wakes the coordinator | Built (R5) | W1-4 (D-6095), W1-4b (D-6096) and W1-5 (D-6097). |
| 55 | `ccd/session-hook.sh`, `CARD_ROLE`: "…your own go to the operator." | Tells coordinators to ask | Changed | §9.2. |

## 8. What the server must add

### 8.1 A goals read for coordinators, and a stored definition of done

- **The read** (author's call on the shape). A coordinator reads its own programme's goals with
  `ccrc-api goals show <slug>`, a new client row. It calls `GET /api/coord/programmes/:slug/goals`.
  - **Gate:** the box token plus attribution (`byId`, `byUuid`), the same gate as `goals pin`. Ownership is
    `claimsProgramme`, refused otherwise as `not-your-programme`.
  - **Answer:** `specPath`, `inShort`, `doneWhen` (below), the modifications with their rulings and merged state, the
    programme's open operator items (id, kind, title, needed-by), and its last 20 calls.
  - **Why a second route:** the operator's session-gated `GET /api/programmes/:slug/goals` keeps its door. The
    legitimately-different reason is the security boundary: the box token versus the operator's session. Both answer
    from the one `coord.goalsFor` reader.
- **The definition of done** (author's call). `goals pin` gains an optional `doneWhen`: a numbered list of at most
  12 conditions, 1 to 2,000 characters, stored as a copy. Nothing parses the spec, exactly as `inShort` works (D17
  of the ledgers spec).
  - `goals modify` can replace it. A change to it is operator-only (O3). The coordinator records only a change the
    operator has ruled, and cites that ruling.
  - The ledger template gains a "Goals and definition of done" section, the shape `programs/ccrc-history.md` already
    uses.
- **Programmes pinned before this** (author's call).
  - The coordinator drafts a definition of done from the spec into its ledger and raises one `decide` item:
    "approve this definition of done" (O3). The item is non-blocking.
  - Until the operator approves it, the coordinator may use the draft for routine calls. It may not use the draft to
    justify a call that widens or narrows scope.
  - A programme with no spec at all is still in its brainstorm phase. R7's exception applies there.

### 8.2 The coordinator call record

- **One table, one writer** (author's calls). The table is `coordinator_calls`:

  | Column | Holds |
  |---|---|
  | `id` | the row's id |
  | `program` | the programme's slug |
  | `runId` | the run, nullable |
  | `madeBy` | the coordinator that made the call |
  | `class` | `routine`, `big` or `block` |
  | `question` | the question |
  | `options` | JSON, at least two for `routine` and `big` |
  | `chosen` | the option chosen |
  | `why` | one line that cites the goal or ruling it rests on |
  | `reversible` | 0 or 1 |
  | `wakeOn` | `block` only: `capacity`, `account-room`, `disk`, `memory`, `time:<epoch>` or `update` |
  | `at` | when it was made |
  | `seenAt` | when the operator marked it seen |
  | `overturnedAt` | when it was overturned |
  | `overturnNote` | the operator's note |

  - The route is `POST /api/coord/programmes/:slug/calls`. It takes the box token plus attribution plus ownership.
    The client row is `ccrc-api calls record`.
  - The route is the table's only writer. Every text passes `redactCommand` and is cut whole, as review-cap
    reasons are (D-8125).
  - It is one numbered migration. The plan re-measures the slot.
- **Reads.**
  - The coordinator's goals read (§8.1).
  - The operator's Waiting on you read: big calls only, not seen and not overturned, newest first.
  - The digest builder: big calls, plus routine counts per programme.
  - The run page: calls that carry its `runId`.
- **`block` rows** are how a parked thread asks to be woken. The server's existing wake paths send the mail when the
  condition clears:
  - capacity: the wake-on-free mail (D-6095);
  - account room: a resumed session after swap or reset;
  - disk or memory: the alarms clearing;
  - time: the lane schedule;
  - update: the roll finishing.

  This is a reason for the existing wake lanes to fire, not a new wake lane. Each wake goes through the wake budget's
  rate.

### 8.3 Detectors that act

1. **The stall watch gains an act rung for coordinators: a `coord-idle` arm** (author's call).
   - **When it fires.** A coordinator that claims an open run, reads `idle`, has no held mail and has been idle for 20
     minutes. None of these may apply: an active child run (`dispatched` or `working`); an open review run; a run at
     `merging` with its PR queued; a blocking operator item; an unexpired `block` call; a `wait:` mail it sent.
   - **What it does.** It sends one system mail through `queueSystemMail`: "You have open runs and nothing waits on
     the operator. Continue per coordinator clause 21; re-read `runs list` and `goals show`." The mail follows
     `orphan-d`'s pattern of mailing the session first.
   - **Escalation.** Only if the coordinator is still idle 30 minutes after the wake does the operator get a push.
   - `coord-blocked` keeps reporting. For a coordinator holding mail behind a pending dialog, the push also counts a
     breach of R7, for §10.
2. **The idle-compaction nudge counts open runs** (author's call). For a session that claims an open run, the lane's
   `no-open-tasks` hold also clears when the claimant has a run in a non-terminal state that is not waiting on a
   blocking operator item. This changes one hold in `server/src/idlenudge.ts`. The nudge stays once per compaction,
   and every other hold stays.
3. **The registry reconciler for an orphaned spawn** (author's call). When dispatch answers `registry-unmeasurable`
   after `ws-add` ran, or `ambiguous-dispatch`, the server records the attempt on the run. On its next readable
   registry listing, it binds the one workspace that spawn created, or hands any extra one to the server's own orphan
   lane. It never uses a session's verb. The run's answer then reads `reconciled`. This turns rows 22 and 32 of §7
   from operator stops into retries.
4. **The skill installs itself on a home where it is absent** (author's call; the operator may prefer to keep this a
   human act). When a dispatch's preflight measures `skillState: absent`, the agent runs the skill installer for that
   home. The skill installer is not a Claude Code build roll, so D-5696 does not forbid it. The answer reports
   `installed` or `failed`.
5. **The handover item raises itself** (author's call). When an open call answers `claimed-by-another` and the claimant
   it names has had no registry row for longer than the dead-coordinator window, the server raises one `do` item with
   the evidence and a one-tap "Hand to <caller>" control behind a confirm. The act stays the operator's (O4).

### 8.4 The do-it-yourself ruling, built (R5)

Build fleet-capacity W1-4 (D-6095, wake refused coordinators), W1-4b (D-6096, the in-place bind and the
`self-dispatch` refusal) and W1-5 (D-6097, the words in the refusal details and the skill), as that plan sets them
out, and keep all seven of §3.5(e)'s reasons. Reason 1 says a review is never done inline, and stays.

## 9. How the rule reaches running coordinators

### 9.1 The skill

- **Clause 21, a new contract sentence** (author's draft; the operator approves the words, and
  `server/test/coordinator-skill.test.ts` pins them verbatim). "These twenty sentences" becomes "twenty-one", and
  that test's number list grows by one.

  > 21. This session decides by default and keeps going. It stops a thread of work only for a decision or act only
  > the operator can make — an irreversible or outward-facing act (a SAFETY-listed destructive or live-box act,
  > publishing, messaging people), spend beyond plan (usage credits, paid services, new accounts), a change to the
  > programme's goals, scope or definition of done, or credentials and access — or when it is physically blocked after
  > its self-healing has been tried: no account has room, the box is out of disk or memory after its own cleanup and
  > the memory gate, an external service is down after retries with backoff, or a repository or tool is beyond its
  > rights. Before asking the operator anything else, it reads the programme's goals and definition of done
  > (`ccrc-api goals show <slug>`, the ledger, the spec), decides, records the call with `ccrc-api calls record` — a
  > design-level call as `big`, which the operator sees and may overturn, every other call as `routine` — and continues
  > in the same turn. A parked thread never parks the programme: it raises the item and works every unblocked thread,
  > and ends its turn only when none is left or its children hold the work. It never opens an AskUserQuestion dialog
  > on a pinned programme, never guesses an operator-only answer, and never relaxes a SAFETY rule.

- **The clauses that change with it:**
  - **Clause 11:** "rule only from what you can read: the spec, the plan, the ledger, the branch, the programme's
    goals and definition of done, and your own prior rulings". Release only what clause 21 makes the operator's.
  - **Clause 19:** questions to the operator are items, never a turn ending on a question.
  - **Clause 20:** items are for the operator-only classes and for blocks that need a human act.
  - **Step 5:** the review cap, through D-8125.
  - **"When something is wrong":** each entry rewritten to §7's disposition.
  - **The description:** §3.5(e)'s exception.
- **The references move with the skill:** `wave-lifecycle.md` (§7, rows 28 to 45), `resume.md` (rows 3 and 47),
  `routing-matrix.md` (row 49) and `peer-protocol.md` (row 50). `references/decision-procedure.md` is new and holds
  §5 and §3's lists, so the clause stays one paragraph.
- **The skill installer** carries it to every home, as it does today.

### 9.2 Re-injection after compaction

- **The roster card.** The hook's roster card (D4, #757), armed on the fleet, already re-reads a coordinator's open
  runs on compact, resume and clear. It gains one fixed line, a constant with no server bytes in it (author's call):
  "ccrc-autonomy: before asking the operator, read your goals (`ccrc-api goals show <slug>`), decide, record
  (`ccrc-api calls record`), continue; stop only for an operator-only act or a physical block (coordinator clause
  21)." The line counts inside `ROSTER_CARD_MAX_CHARS`.
- **`CARD_ROLE`.** The text "your own go to the operator" becomes "your own you work out from the programme's goals
  first; only operator-only decisions go to the operator".

### 9.3 Coordinators already running

When the release carrying clause 21 rolls, the server sends one system mail to each claimant of an open run
(author's call): "The coordinator skill changed (clause 21). Re-read `ccrc-coordinator`, then `goals show` for your
programme." The mail goes through `queueSystemMail` under the wake budget's rate. Coordinators that are idle roll onto
the release anyway under the 2026-10-29 roll policy.

## 10. Measures of success

**The baseline** is taken in the plan's first task. The transcript census of §1.2 is re-run as a committed,
read-only script, and the server counts are read from `coord.db`. **Measuring** happens weekly, then at 30 days
after the rollout mail.

| # | Measure | Baseline | Target at 30 days |
|---|---|---|---|
| M1 | **Stall hours:** coordinator time idle or in a dialog waiting on the operator (§1.2's census) | 680 h typed-reply waits over an hour, plus 539 h of dialogs over an hour, per 14 days | Down 70% (the share §1.2 found answerable) |
| M2 | AskUserQuestion dialogs opened by coordinators on pinned programmes | 611 in 14 days (all programmes) | 0 (R7) |
| M3 | Operator items per programme-day: items raised plus asks released to the operator, per day a programme has an open run | measured in the first task from `operator_items` and `asks` | Down by half |
| M4 | Items answerable from goals: of 30 items sampled each week, the share a reviewer classes as routine or big against §3 and §5 | 72% of the long waits sampled in §1.2 | Under 10% |
| M5 | Overturn rate of big calls (the guard) | none yet | Under 15%. Above it, the routine-or-big line or the tie-breakers are wrong and get revisited |
| M6 | Coordinator-hours flagged by `coord-blocked` per week (D-6942) | about 38 coordinator-hours a week | Halved |
| M7 | Time from a cleared block to the coordinator acting again | not measured | Under 10 minutes |
| M8 | Safety: operator-only acts taken by a coordinator, and SAFETY-rule breaches | 0 | 0, audited from the calls record and the hook's deny log |

## 11. Non-goals and anti-goals

**Non-goals.**
- No time window, mode or switch: R1 rules that out.
- No change to how children's questions are routed to their coordinator (D-5289 to D-5302). Only clause 11's
  grounds for a ruling change.
- No automatic answering by a trained or typed-decision model. Coordinators decide with their own judgement.
- No change to the review panel or to clause 14: every wave is still read by a held-out review run.
- No change to the merge safeguards beyond D-8124's door.
- No new operator list: big calls join Waiting on you and the digest.

**Anti-goals** (the coordinator must never do these, whatever a call says):
- **A1. Never relax a SAFETY rule.** Self-healing never uses a verb the repository's SAFETY rules forbid to
  sessions, never touches units, tmux or another session's files, and never works round a hook deny.
- **A2. Never guess an operator-only answer.** An O1 to O6 question is asked. The coordinator does not decide it
  provisionally and act on that.
- **A3. Never spend.** No usage credits, no keys sent to the limit menu, no paid service, no new account.
- **A4. Never hide a big call** by recording it as routine. M4 and M5 watch for it.
- **A5. Never review its own work.** The do-it-yourself path keeps §3.5(e)'s reason 1.
- **A6. Never retry without backoff.** Retries are spaced and jittered and go through the wake budget. A fleet-wide
  herd of restarts is a fault of its own.
- **A7. Never treat a recorded call as an operator ruling** on an operator-only matter, and never cite one as such.

## 12. Risks

| Risk | What could happen | Mitigation |
|---|---|---|
| Wrong calls compound | A routine call that was really big shapes several waves before anyone sees it | Reversible options first (§5.3); the held-out review on every wave; the M4 sample; big calls surfaced the same day |
| The class drifts towards "routine" | Coordinators under-surface to avoid friction | M4's weekly sample and M5's overturn rate; the routine-or-big line is in the skill's reference, not left to taste |
| Goals are vague or missing | Calls rest on a guess dressed as reading | §8.1's definition of done and its approval item. Without one, the coordinator may not widen or narrow scope |
| Retries load a box already in trouble | Backoff loops and self-work deepen a memory stall | §3.5(e)'s reason 7 (box in distress); A6; P2's lighter-path step; the memory gate |
| Prompt injection through stored goals | Text in the pin steers a coordinator | The pin's text is written only by the owning coordinator and the operator, and is read as data. Linear text stays untrusted. The roster line is a constant |
| The operator wants to be asked about some kind of call | Calls happen that the operator would have liked to weigh in on | An overturn with a note, recorded as a ruling (clause 11's digest rule), teaches the next call. A repeated pattern becomes an O-class by a later ruling |
| Rule conflicts with existing D-numbers | Old skill text keeps saying "stop" | §7's inventory is the full list. The plan rewrites each row in the same PR as clause 21 |
| The skill gets longer | A 634-line skill grows again | Clause 21 is one paragraph. The procedure lives in a new reference file. §7's rewrites replace text rather than add to it |

## 13. Build order, for the plan

The waves are listed in dependency order. Each wave is one PR.

| Wave | What it builds | Depends on |
|---|---|---|
| A1 | The baseline: the committed census script (read-only), the first M3 and M4 counts | nothing |
| A2 | Server: `doneWhen` on the pin, the coordinator goals read, its client row | nothing |
| A3 | Server: the calls record, its route and client row, the digest's `call` line kind and correction arm | A2 |
| A4 | Console: "Calls made for you" on Waiting on you, Overturn… and Seen on each call, the run page's calls | A3 |
| A5 | Skill: clause 21, the clause 11, 19 and 20 rewrites, the new reference file, §7's rows 1 to 51 in the skill and references, the pinning test | A2, A3, D-8125 merged |
| A6 | Server: the `coord-idle` arm, the nudge's open-runs hold, `block` wakes on the existing lanes | A3 |
| A7 | Server: the spawn reconciler, the skill self-install, the handover item | none of the above |
| A8 | Fleet-capacity W1-4, W1-4b and W1-5 (D-6095 to D-6097) | that plan's own gates |
| A9 | Hook: the roster line and `CARD_ROLE`; the rollout mail | A5 |
| A10 | Measure at 30 days; adjust the routine-or-big line if M5 is over target | A1 to A9 |

D-8123, D-8124 and D-8125 are in flight and are not rebuilt here. A5 cites them and waits for D-8125's merge.

## 14. Decisions and deviations

- **D-8126 (2026-11-09)** — the operator's rulings on coordinator autonomy as the default.
  - **Complaints:**
    1. Coordinators ask the operator low-level questions and wait, when the answer is easy to work out from the
       programme's goals.
    2. A coordinator working a programme must stop for one reason only: a decision or act that only the operator
       can make, or being physically blocked. Otherwise it never stalls, stops or pauses. It uses maximum autonomy,
       self-healing recovery and resilience to take the programme to completion.
  - **Rulings:**
    - **Always on.** The rule is the default. It is not a time window, and it supersedes the earlier autonomy-window
      idea.
    - **Work it out first.** Before asking the operator anything, a coordinator works the answer out from the
      programme's goals and definition of done (the Goals pin and the ledgers), decides, records the call and keeps
      going.
    - **Only the operator decides:**
      - irreversible or outward-facing acts: SAFETY-listed destructive or live-box acts, publishing, messaging
        people;
      - spend beyond plan: usage credits, paid services, new accounts;
      - changing the programme's goals, scope or what "done" means;
      - credentials and access.
    - **Physically blocked,** a stop allowed only after self-healing was tried:
      - no account has room;
      - the box is out of disk or memory after its own cleanup and the memory gate;
      - an external service is down after retries with backoff;
      - a repository or tool it cannot use within its rights.
    - **Surfacing.** Only the big, design-level calls reach the operator, and each one can be overturned. Routine
      calls are not surfaced.
    - **Everything else is a fault to recover from.** The coordinator skill's stop-and-report refusals get recovery
      paths, and the 2026-10-20 "coordinator does it itself" ruling (fleet-capacity spec §3.5(e), D-6091 to D-6097)
      is built.
  - **Related, in flight:** D-8125 (coordinators lift review caps themselves), D-8123 (the limit watchdog), D-8124
    (the admin-merge door).

| # | Decision | Chosen | By |
|---|---|---|---|
| R1 | Default or opt-in | Default and always on; no window, mode or switch | Operator, 2026-11-09 |
| R2 | Before asking | Work it out from goals and the definition of done; decide; record; continue | Operator |
| R3 | When to stop | Operator-only (§3, O1 to O4) or physically blocked after healing (§4, P1 to P4) | Operator |
| R4 | What the operator sees | Big, design-level calls, each overturnable; routine calls not surfaced | Operator |
| R5 | The do-it-yourself ruling | Built (§8.4) | Operator |
| R6 | Scope of a stop | A thread, never the programme | Author's call |
| R7 | Dialogs | None once the Goals pin exists; allowed in the brainstorm phase | Author's call |
| C1 | Extra operator-only classes | O5, a fact only the operator holds; O6, overriding a person | Author's call |
| C2 | What is not outward-facing | Pushes, PRs, landing, comments on the programme's own PRs and issues, mail between sessions | Author's call |
| C3 | Healing steps and backoff schedule | §4's steps; backoff of 1, 2, 4, 8, 15 and 30 min, then every 30 min up to 4 h | Author's call |
| C4 | Tie-breakers and rule conflicts | §5.3's order; the later of two conflicting rulings governs | Author's call |
| C5 | The routine-or-big line | §5.4's list | Author's call |
| C6 | Where calls are recorded | A server record (`coordinator_calls`) plus one ledger line; the ledger stays human-only | Author's call |
| C7 | How big calls are surfaced | Read into Waiting on you the way Questions are; a digest line kind; never pushed; 7-day expiry | Author's call |
| C8 | The overturn door | The digest correction route, extended with a `call` row kind; Overturn… with a confirm; Seen in one tap | Author's call |
| C9 | The goals read | A box-token, attribution-checked route beside the operator's, both on one reader | Author's call |
| C10 | The definition of done | A stored `doneWhen` copy on the pin; a ledger section; a draft plus an approval item for older programmes | Author's call |
| C11 | Detectors that act | The `coord-idle` arm (20 min idle, a wake mail, then a push 30 min later); the nudge's open-runs hold; the spawn reconciler; skill self-install; the auto-raised handover item | Author's call |
| C12 | Wakes for parked threads | `block` calls with a wake condition, served by the existing wake lanes | Author's call |
| C13 | Delivery | Clause 21 plus a reference file; a fixed roster-card line; the `CARD_ROLE` text; one rollout mail | Author's call |
| C14 | Disposition of each stop point | §7's table | Author's call (rows 12, 18 and 24 follow D-8125, R5 and D-8124) |
| C15 | Measures and targets | §10 | Author's call |
| C16 | While paused | Non-dispatch threads continue; nothing is dispatched | Author's call |

## Where things stand

### Agreed

- R1 to R5, the operator's rulings of 2026-11-09 (D-8126).

### Waiting on you

- **Approve this spec**, including the author's calls R6, R7 and C1 to C16, or name the ones to change. The
  recommendation is to approve as written. The calls follow the rulings closely, reuse the Waiting on you list, the
  digest and the existing wake lanes rather than adding new ones, and each can be changed later by a ruling without
  undoing the rest.
- **The words of clause 21** (§9.1), which the pinning test will hold verbatim.
- **C11's skill self-install** (§8.3, item 4) is the one call that moves an act from a human to the agent. The
  recommendation is to allow it, because the installer is not a Claude Code build roll. If you prefer to keep it
  human, row 38 of §7 stays a non-blocking `do` item.

### Later

- **Big calls that need fast eyes.** A per-programme setting could push big calls of a chosen kind, for example
  console layout. Trigger: M5 shows overturns cluster in one kind.
- **A server-signed coordinator identity.** Attribution is not authentication, so a call record proves only "a
  process on this box". Trigger: any call route gains an act that needs proof of who made it.
