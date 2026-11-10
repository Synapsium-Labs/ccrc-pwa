# Coordinators decide by default: autonomy as the standing rule

**Spec** · 2026-11-09 · Status: rev 3, approved by the operator on 2026-11-09. The rules in §2 to §4 are the operator's
rulings of 2026-11-09 (D-8126). The operator approved the spec with every "author's call" in it on 2026-11-09 and
answered three of the four questions of §15 the same day (recorded in §14 under D-8126); one question stays open (§15)
· Rev 3 (2026-11-09): the operator's answers written in · Rev 2 (2026-11-09): a builder's check applied. The answers it found
in the repository are written in, its smaller points are settled as author's calls, its contradictions and inventory
gaps are fixed, and what only the operator can answer is listed in §15 · Owner: the coordinator that drives the build
· Linear: none · Ledger entry: `docs/superpowers/plans/2026-11-09-coordinator-autonomy-default.md` defines D-8126
(§13, "The D-number rule") · Related: `ccd/coordinator-skill/SKILL.md` and its `references/`,
`docs/superpowers/specs/2026-10-31-programme-ledgers-design.md` (Goals and Waiting on you),
`docs/superpowers/specs/2026-10-20-fleet-capacity-and-worker-lifecycle-design.md` §3.5(e) and its plan
`docs/superpowers/plans/2026-10-20-fleet-capacity-w1.md` (D-6091 to D-6097),
`docs/superpowers/specs/2026-11-04-runs-screen-rebuild-design.md` (D-8115: end requests §10, the Resume door §9.5),
`server/src/coord/abandonDeadDispatch.ts` (D-7319, D-7563), `server/src/coord/stall.ts` (`coord-ball`,
`coord-blocked`, D-6942, D-3605), `server/src/idlenudge.ts` (D-5373), `server/src/auth/gate.ts` (D-149),
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
- **The skill.** A new contract clause 21 holds the rule, and a new reference file holds the decision procedure.
  Each of the skill's stop-and-report exits gets a recovery path or an explicit class (§7).
- **The server.** Each piece extends something that already exists:
  - the operator's goals read opens to coordinators the way D-149 opened the runs read, and the Goals pin stores a
    definition of done (§8.1);
  - one record of the calls coordinators make; design-level calls are surfaced so the operator can overturn them
    through the digest's existing correction door (§8.2, §6);
  - the `coord-ball` stall arm gains a rung that mails the coordinator before anyone pushes the operator, and the
    idle-compaction nudge counts a coordinator's open runs (§8.3);
  - the dead-dispatch pass (D-7319, D-7563) also takes the dispatches that answered `registry-unmeasurable` or
    `ambiguous-dispatch` (§8.3);
  - the 2026-10-20 "coordinator does it itself" ruling, which has never been built (§8.4).
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
| Operator-only | 21 | 563 | "Do you approve the spec?"; "Should I revoke these people's access?"; "Ship ordinary values now and leave the secret store for later?" (a cut to what "done" means); "May I make it public?"; "Which host should this model run on now that the current one is unavailable?" One 357 h wait was a programme kickoff before any goals existed. |
| Physically blocked | 3 | 21 | "The fleet volume is under its floor, so no workspace can start. Which of these should happen?" |
| Mixed | 2 | 5 | one message bundling routine and operator-only questions |

Routine and big calls together are **66 of 92 waits (72%) and 532 of 1,121 hours (47%)**. Set aside the one 357 h
kickoff and the hours share rises to 70%. The two mixed waits were counted whole, as their own class. From A1 on,
the census and the M4 sample split a mixed question by §5.1's rule and count each part in its own class. Twice in
the sample, the operator's whole reply to a list of questions was to ask for the coordinator's own recommendation
("Recommendation and why please", four times in one reply): the coordinator had asked without recommending, though
the goals already pointed one way.

### 1.3 Why it happens (measured from the skill and the code)

1. **The skill defaults to the operator.** Clause 11 tells a coordinator to decline any child question that "would
   require guessing rather than reading". Any "tradeoff nobody ruled on" goes to the operator. The skill never says
   "work it out from the goals".
2. **The goals are stored but coordinators cannot read them back.** The Goals pin keeps a spec path, an "In short"
   and a list of modifications. The reader is `goalsFor` in `server/src/coord/ledgersStore.ts`. A coordinator can
   only write the pin (`goals pin`, `goals modify`, `goals merged`, through `POST /api/programmes/:slug/spec` and its
   siblings in `server/src/coord/ledgersRoutes.ts`). The one read, `GET /api/programmes/:slug/goals`, is registered
   among the session-gated operator routes, and coordinators carry the box token. No definition of done is stored
   at all. Only one ledger writes one down by convention (`docs/superpowers/programs/ccrc-history.md`, "Goals and
   definition of done").
3. **A decide item has no "go ahead unless overturned" path.** Clause 20 asks for a recommendation (D24 of the
   ledgers spec), and the coordinator then waits for a tick.
4. **About 25 refusal codes end in "stop and report".** Many are software faults, not operator decisions or physical
   limits. The skill's rule is "a program that stalls honestly is recoverable" (`SKILL.md`, "When something is
   wrong").
5. **The do-it-yourself ruling is not built.** On a `cap-concurrency` refusal the skill still says "stop, say so, and
   wait to be woken". Of the 2026-10-20 ruling's tasks (D-6091 to D-6097), only W1-1 and W1-1b (D-6091, D-6092) are
   built. W1-2 to W1-5 (D-6093 to D-6097) are not: there is no `inPlace` bind and no `admissionWaitSince` in
   `server/src`.
6. **Detectors report but never act.** The stall watch's `coord-blocked` arm "only reports" (D-6942). Its
   `coord-ball` arm sends one operator push after the coordinator has held the ball for 30 hours with no mail
   (`COORD_BALL_CAP_MS`), and never mails the coordinator. The idle-compaction nudge fires only when a session's task
   list has open items (D-5373), and a coordinator's open runs do not count as open items.
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
- **How R7 is enforced** (author's call). It starts as a skill rule only. M2 (§10) and the `coord-blocked` count are
  measured weekly. If M2 is still above 0 two weeks after the rollout mail, a later PR adds a `PreToolUse` deny in
  `ccd/session-hook.sh` on AskUserQuestion, for a session that claims a run of a pinned programme. A hook deny that
  nothing has yet shown to be needed is not built up front.

## 3. What only the operator decides (ruled)

The operator ruled four classes on 2026-11-09. Each row below gives the class, real examples, and what the coordinator
does while it waits. In every class the coordinator raises one item with `ccrc-api items raise`, naming what, how and
why. A `decide` item also names the option it recommends and why that option beats each alternative (D24). The item
is set `blocking` only when every thread is parked on it. The item's tick already mails the coordinator (clause 20),
so a parked thread needs no other wake.

| # | Class (ruled) | Includes | Examples from real items | Meanwhile |
|---|---|---|---|---|
| O1 | **Irreversible or outward-facing acts** | Acts the repository's SAFETY rules forbid to sessions (`CLAUDE.md`, "SAFETY — sacred, never violate"), and acts on the live boxes: reaping, removing, expiring or reclaiming workspaces; touching units or tmux; account management; rolling or selecting a Claude Code build; `ccrc history` writes; deploys and rollouts; writing live box config, including touching a stall-watch or lane arming marker. Publishing: making a repository or package public, cutting a release, a public page. Messaging people. Comments on other people's PRs and issues in public repositories, and tracker writes that mirror to public GitHub issues, are not in this class: they are routine (operator, 2026-11-09). | "May I write the landing config with `lineage=off` on the live box?"; "May I make it public?" | Builds and reviews everything up to the act. The PR is ready; the act waits. |
| O2 | **Spend beyond plan** | Usage credits, including any "Switch to usage credits" and any escalation to a model billed on credits. Paid services. New accounts. | "Should this design go to the credits-billed model per your policy?" | Continues on the plan's own models and accounts. The rest of the programme does not wait. |
| O3 | **The programme's goals, scope or definition of done** | Approving a spec. Changing a spec's goals, its scope or its definition of done. Approving or changing the definition of done. Starting work outside the definition of done. Dropping or cutting a definition-of-done item. Accepting a known limit that leaves a definition-of-done item unmet. Starting a new programme. Choosing what the programme does next once its definition of done holds. Any other change to behaviour the spec describes is a big call (§5.4), not O3. | "Do you approve the spec, with my calls D11 to D22?"; "Ship ordinary values now and leave the secret store until a feature needs it?"; "The next wave is outside your definition of done. Shall I start it?" | Works every item inside the current definition of done. When the definition of done holds, it closes the programme, as step 7 says. |
| O4 | **Credentials and access** | Secrets (only through a `secret` item; a secret never reaches a coordinator). Sign-ins and account auth. Repository settings: rulesets, branch protection, merge methods, auto-merge (clause 15). Who may act on a programme: handing it to another session after a lost id (`resume.md` §6). Delegated worktrees: attaching a lease, saying a worktree is not delegated, and any act on a worktree in conflict (`references/delegated-worktrees.md`, "The operator's acts"). Granting or removing people's access. | "A required approval is missing and the repo has no admin door" (outside D-8124's door); "This account's lane needs a sign-in" (`spawnState: login`); "Should I revoke these people's access?" | Routes work to lanes and repositories it can use; the blocked thread waits. |

**Two classes the author adds as plain readings of the rulings** (author's calls):

- **O5. A fact only the operator holds.** Examples: which of two teams owns a shared service, or whose code an unknown
  account pushes. No source the coordinator can read holds the answer, so a guess is never allowed (anti-goal A2).
  It is asked as a `value` item. Everything that does not depend on the answer goes on.
- **O6. Overriding a person.** Ignoring a human reviewer's requested change, or a ruling some other person made. This
  is the "ignore" answer to the landing verdict's `changes-requested` stop. "Address" is the coordinator's default
  (§7, row 42), and "ignore" stays the operator's.

**What is plainly not outward-facing** (author's call). The fleet's ordinary work on a programme's own repositories is
part of building, not publishing:
- pushing branches, and opening, updating and landing PRs by the route clause 15 gives;
- replying to review bots on the programme's own PRs;
- mailing other coordinators and sessions through ccrc;
- commenting on PRs and issues in public repositories where people other than the operator take part, such as an
  outside contributor's PR (operator, 2026-11-09);
- tracker issue and comment writes through `ccrc-api linear`, including those that mirror to public GitHub issues
  (operator, 2026-11-09).

Both of the last two are written under the public-repository rules the repository already sets.

## 4. Physically blocked (ruled), and the self-healing tried first

A coordinator may treat a thread as physically blocked only after it has tried the healing steps for that case. The
four cases are ruled. The steps are the author's calls, built on mechanisms that exist or are in flight. When a block
holds, the coordinator records it with its wake condition (§8.2, `class: block`), parks the thread (R6), and the
server wakes it when the condition clears.

| # | Case (ruled) | Self-healing first (author's calls) | Who wakes it |
|---|---|---|---|
| P1 | **No account has room** | (1) Auto-swap moves the session to an account with room; that is ccd's job (session continuity; swap rulings D1 to D7). (2) The limit watchdog forces a stuck rescue after 5 minutes (D-8123). (3) The coordinator never picks "Switch to usage credits" and never sends keys to the limit menu: that would be spend (O2). (4) Only when the watchdog reports that no account has room anywhere is the thread blocked. D-8123 then raises the Waiting on you item with its "Swap to…" control. | The swap or the home account's reset. ccd resumes the session; a resumed coordinator re-reads `runs list` and its goals (§9). |
| P2 | **The box is out of disk or memory** | (1) **Its own cleanup.** Remove its own sibling worktrees once their PR is pushed and their run is closed, never earlier, because fix rounds need the tree (§3.5(e)'s tree rule). Delete its own plain scratch files in its temp root; never a git repository there that holds unpushed commits (those are what scratch-rescue keeps, D-6632). Close finished runs, so the server reclaims their children (clause 3: the server reclaims and the coordinator never reaps). (2) **The memory gate.** Tests run only through `ccrc test` (clause 18), which queues heavy runs fleet-wide. Cold starts wait on memory pressure (D-8122). (3) **Lighter work.** Choose the lighter path a plan allows, such as a narrower suite or one worker at a time. (4) Never a SAFETY-listed verb, never a unit or tmux touch, never another session's files. | The capacity spec's wake-on-free mail (§3.5(e), D-6095) when headroom returns. The disk alarm clearing (§8.2). |
| P3 | **An external service is down** (GitHub, Linear, the ccrc server, a package registry) | Retry with backoff and jitter: 1, 2, 4, 8, 15 and 30 minutes, then every 30 minutes. Clause 7 forbids polling inside a turn, so each retry is a `block` call with `wakeOn: time:<epoch>`, and the lane schedule mails the coordinator at that time. Meanwhile it works every thread that does not need the service: ledger prose, reading, briefs, other repositories. Nothing is done by hand in the service's place. On `rate-limited` it waits as the answer says and never loops. After 4 hours it raises one non-blocking `do` item naming the service, and keeps a 30-minute time wake until the service answers or the operator ticks the item. When the ccrc server itself is down, nothing can be recorded there: the coordinator says so in its turn's text and ends the turn. | The lane schedule at the recorded time. When the server was the outage, the `coord-ball` arm's mail rung once the server is back (§8.3). |
| P4 | **A repository or tool is beyond its rights** | (1) Look for an allowed route: the server door for the act, a different ccd verb, the owning coordinator by mail, the claim holder's `expiresAt`. (2) Check whether the missing verb ships in a pending release (`unsupported`, `no-questions-door`, an old client, an older server's answer). (3) Never work round a hook deny or a SAFETY rule. Examples: a `ccd` build without a verb, a hook deny, a repository the fleet's identity cannot write, an older server that lacks a door. | The update that brings the verb: the block call records `wakeOn: update`. When the coordinator also raised an item, the item's tick mails it (clause 20); no other wake value is needed. |

## 5. The decision procedure

A coordinator follows these steps for every question it would otherwise ask, including a child's question (clause 11).
`references/decision-procedure.md` (new, §9.1) holds this section and §3's lists in the skill's words.

### 5.1 Step 1: is it operator-only?

Check the question against §3 (O1 to O6). If it falls in one of those classes, raise the item and park the thread (R6).
**Doubt resolves towards the operator only for O1 to O6. It never does for "is this big or routine?".**

**The split rule** (author's call; stated once, in `decision-procedure.md`, and used by the coordinator, the census
and the M4 sample alike). A question with more than one part is split into its parts. Each part is classed on its
own. The operator-only parts become one item. The other parts are decided and recorded. A census or sample counts
each part in its own class.

### 5.2 Step 2: read the goals

Read, in this order. The first one that settles the question wins:
1. **The Goals pin,** through `ccrc-api goals show <slug>` (§8.1): the pinned spec path, its "In short", the
   definition of done, and the dated modifications with their rulings.
2. **The pinned spec and its plan.** Their decisions tables and "Where things stand".
3. **The programme ledger.** "Goals and definition of done", Decisions and deviations, and Carried constraints.
4. **The operator's recorded rulings that apply.** D-numbers in specs and plans, digest corrections (clause 11), the
   repository's `CLAUDE.md` rules, and the standing operator preferences below.

**Standing operator preferences** (author's call: they live today only in the operator's private notes, so a
coordinator cannot read them; `decision-procedure.md` writes them down in plain words, and they are generic enough
for a public repository):
- **A screen works at every width.** A console change is judged at phone, laptop and wide widths. A desktop-only
  interim is not acceptable.
- **Improve what exists first.** Before designing something new, measure how today's version behaves and fix its
  real defect.
- **Dependencies go to the latest major,** continuously, not only when a bot proposes it. Type packages follow the
  runtime.
- **The review-round cutoff.** Fix-and-review loops stop at 2 rounds, or 3 for security work. After the cutoff, fix
  only issues that are one line and already tested, record the rest as known limits, and land (§5.7).
- **A card is a glance.** A card shows one legible context line in the user's terms, with no truncation and no
  duplicates. The detail view is the superset.

### 5.3 Step 3: decide

Pick the option that best serves the goals and the definition of done. When the goals do not tell the options apart,
use these tie-breakers, in order (author's calls):
1. **Reversible beats irreversible.**
2. **Smaller blast radius beats larger.**
3. **Extend what exists** before adding anything new (the repository's consolidation rule).
4. **The standing operator preferences** (§5.2).
5. **Cheaper in time and fleet capacity.**
6. **The option the coordinator would have recommended in a decide item.**

Two operator rulings that conflict are settled by the later one. The call names both (author's call). Example: the
operator's "Decision 2 (a)" against an older "a fresh install ends green".

### 5.4 Step 4: routine or big

**A big call** (author's call on the line) is a design-level choice. It is one of these:
- it changes behaviour the spec describes, without changing the spec's goals, scope or definition of done (those
  are O3);
- it changes a public contract: an API route, a wire shape, a stored schema or migration, a CLI verb;
- it changes what the operator will see in the console;
- it changes structure across more than one bounded context;
- it settles a cost or risk trade-off the spec left open;
- it departs from the plan in a way that changes what a later wave builds.

A big call that departs from the spec or the plan is also entered as a deviation in the plan's ledger, with a
D-number from the ledger allocator, as any deviation is today.

**A routine call** is everything about how to get there:
- sequencing and scheduling;
- dispatch, routing and which worker;
- landing, re-queueing, and a second landing attempt;
- one more review round within §5.7's rule (D-8125);
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
| "Lift the review cap so a fourth review can read fix round 3?" | 9 h, returned twice | Routine | Lift with a reason through D-8125's door when §5.7 says to, then open the review. A ledger line records it. |
| "Can you lift its review cap (run 1353) by one round? One more review is all that stands between it and the merge queue." | 3.1 h | Routine | The same. |
| "Shall I open the PR for the doctor warning, with or without the repair?" | 60.5 h and 10.7 h | Routine | With the repair: it is inside the goals and reversible. |
| "If you're happy with that order, I'll start item 1 and launch the item 4 code check in parallel." | 25.9 h | Routine | Start. Never ask for consent to a plan already inside the goals. |
| "Shall I queue all four?" | 0.6 h | Routine | Queue them by clause 15's route. |
| "Should I tell the other session where the version evidence is and correct those sections?" | 25 h | Routine | Mail it, then correct the sections. |
| "Does the plan capture what you want?" (a wave plan for an approved spec) | 0.7 h | Routine | Run the plan's review panel; on a clean report, dispatch. |
| "Should the delegation broker programme own that fix?" | 1.0 h | Routine | Mail that coordinator and agree it between the two of them. |
| "Which treatment makes it obvious which workers belong to which coordinator?" | 6.3 h | Big | Pick by the goals and "a card is a glance". Build it reversibly, surface the call, keep going. |
| "Should the coordinator rewrite the approved spec, or keep amendments beneath it?" | 5.5 h and 4.1 h | Big | Pick, surface, keep going. (The operator later ruled amendments; an overturn would have cost one edit.) |
| "Do you approve the spec, including my calls D11 to D22?" | 6.4 h | Operator-only (O3) | Raise the item; meanwhile prepare the plan. |
| "Should I revoke any of their access anyway?" | 7.8 h | Operator-only (O4) | Raise the item; do everything else on the list. |

### 5.5 Step 5: record

Each call gets one record through the new `ccrc-api calls record` (§8.2). The record holds the question, the options,
the choice, a one-line reason that cites the goal or ruling it rests on, whether the choice is reversible, and the
class (`routine` or `big`). The coordinator also writes one line in the ledger's Decisions section on its next ledger
commit. The ledger stays for humans and the server record is for counting and surfacing (author's call: the ledger
is parsed by nothing, so the measures in §10 need the server row).

### 5.6 Step 6: continue

The coordinator carries on in the same turn. A call never ends a turn. If the operator overturns a big call later,
the coordinator applies the overturn (§6) as it would apply any steer.

### 5.7 The review cap: lift, or land with known limits

The cap is lifted through D-8125's door: `ccrc-api runs review-rounds`, which calls `POST /api/runs/:id/review-rounds`.
It needs a reason of 16 to 300 characters, grants 3 more rounds, records each lift in `review_cap_lifts`, and closes
the operator's open ask on that run. When to use it (author's call, read from the 2026-10-30 review-round cutoff):
- **Lift** only when the last review's open findings are regressions, or gaps in what the PR claims to cover. The
  reason names them.
- **Otherwise apply the cutoff and land.** Fix only issues that are one line and already tested, record the rest as
  known limits in the PR body and the ledger, and land.
- **A known limit that leaves a definition-of-done item unmet is O3.** Raise the item; the PR may still land when the
  limit is reversible and the rest of the programme needs it.

The door's refusals (author's calls). Note (D-8165): the lift is now always on and `CCRC_REVIEW_CAP_COORD_LIFT` is retired, so `coord-lift-off` below is history; the code and the skill no longer have it.
- **`coord-lift-off`** (retired, D-8165): the operator has switched coordinator lifts off (`CCRC_REVIEW_CAP_COORD_LIFT`). That is the
  operator's choice, so lifting stays the operator's for that run. The run's thread parks behind the server's existing
  ask; other threads continue.
- **`cap-not-reached`**: nothing to lift. Open the review.
- **404** from an older server without the door: P4, recorded with `wakeOn: update`.

## 6. How big calls are surfaced and overturned

The operator sees big calls through mechanisms that already exist. No new list is added (author's calls, following
the repository's consolidation rule):

- **On the Waiting on you page, read the way Questions are read.** The ledgers spec §3.1 reads session questions
  through the one `OperatorQuestion` model and does not store them as items. Big calls work the same way. The page
  reads them from the calls record and shows them in a collapsed group, "Calls made for you (N)", under each
  programme. The group sits below the items that wait on the operator. Calls never push and never count as blocking.
  A call leaves the group when the operator marks it seen, or after 7 days, and moves to "Recently cleared".
- **In the daily digest.** The digest already lists "what coordinators decided in the operator's name"
  (`server/src/coord/digest.ts`, D-5300). It gains a line kind for big calls. It does not carry routine calls, not
  even as a count (author's call): the ruling says routine calls are not surfaced, and a count in a daily message is
  surfacing. The measures in §10 read the table directly.
- **One overturn door: the digest's correction route, extended.** `POST /api/digest/correct` (`correctDigestRow` in
  `server/src/coord/digest.ts`) queues a system mail to the coordinator and marks the row corrected. It gains a `call`
  row kind: `parseDigestCorrectBody` accepts it, and the call row gets its own predicate under the one-predicate-per-
  table rule. The one correction door stays one door (D-5493: the digest and the correction route can never disagree
  about what a coordinator decided).
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
- **Routine calls are never surfaced** (ruled, R4). Nothing puts them in front of the operator: no item, no digest
  line, no push. The operator can still look them up, unasked, in the ledger and on a run's page (§8.2), and can
  correct one through the same door if they come across it.

## 7. Inventory: every stop, decline and wait point, and its new disposition

**Dispositions:**
- **Keep (operator-only):** stays the operator's, by §3.
- **Physical:** a §4 case; heal first, then park.
- **Self-recover:** the coordinator handles it.
- **Guard:** not a stall. The session is not acting as a coordinator, or a safety rule holds.
- **Open:** waits on an answer in §15.

"Where" uses today's anchors on `main` at `47007038c`. The plan re-grounds each anchor by its text. Rows 56 to 62 were
added in rev 2.

| # | Where | Today | New disposition | The recovery path, or why it stays |
|---|---|---|---|---|
| 1 | `SKILL.md` clause 4; "When something is wrong" `paused`; `wave-lifecycle.md` §2 `paused` | Stop, report, touch nothing | Split by cause; under the operator's pause, non-dispatch work continues (operator, 2026-11-09) | Dispatch answers `paused` for two causes. The coordinator reads whether `$REG/coordinator-paused` exists (a read it may make). **Present:** the operator's pause, kept for dispatch: no dispatch, no in-place bind and no self-work on new waves (D-6096). Non-dispatch work continues: landing already-reviewed PRs, reviews, docs. **Absent:** the registry was unlistable, a fault: P3 backoff with a time wake, then dispatch again. |
| 2 | `wave-lifecycle.md` §2 `mail-disabled` | Stop, report | Keep (operator-only) | The operator's kill switch. |
| 3 | Clause 8; `resume.md` §2 and §6 `claimed-by-another` | Stop and report; the operator hands over from the console | Physical (P4), keeping the handover operator-only (O4) | Try the id-preserving revive first (`resume.md` §3). Otherwise park the thread and work the rest. The handover door is the runs rebuild's: the Resume door and its picker reach a programme with no open run (§9.5, A55, A56), and its lane raises the items with their controls (§10, A59, A62). Nothing new is built here. |
| 4 | Clause 11; the ask lane in `wave-lifecycle.md` ("decline … a NEW decision", "if answering would require guessing rather than reading") | Release to the operator | Self-recover | Rule from the goals (§5). Working an answer out from the goals is reading, not guessing. Release only O1 to O6. Clause 11's words change (§9.1). |
| 5 | Clause 11, a permission prompt that is not `ordinary` | Cannot be allowed; hand over | Guard | The default-escalate classifier stays (D-5299). Never relax it. |
| 6 | Clause 15, "every conflict among [the repository's rules] is a stop for the operator" | Stop | Keep (O4) | Repository settings belong to the operator. The thread parks and the rest continues. |
| 7 | Clause 15, "a refused merge is a stop, never retried" | Stop | Split | A transient refusal (5xx, a timeout, a rate limit) is P3: retry with backoff. A rule GitHub enforces is O4. `approval-missing` goes through D-8124's admin-merge door where it applies (§7, row 24). |
| 8 | Clause 19, "asks the operator in its closing turn text and ends the turn" | Ends the turn on a question | Self-recover | The question is decided by §5. Only O1 to O6 become items, and the turn goes on to other threads (R6). |
| 9 | Clause 19, AskUserQuestion when no child is active | Allowed | Removed once the Goals pin exists | R7. |
| 10 | Clause 20, raising items | Every operator need | Narrowed | Items only for O1 to O6 and P-blocks that need a human act. Big calls are records (§6), not decide items. |
| 11 | Step 4, `unknown-item`, `item-terminal` | Stop and report | Self-recover | Re-read the ids once (`runs items-list`). If still unknown, record and go on: the tally is display only. `item-terminal` is a no-op to record. |
| 12 | Step 5 and `wave-lifecycle.md` §4, `cap-review-rounds` | The server asks the operator; the coordinator waits | Self-recover (D-8125) | §5.7: lift through `runs review-rounds` when the open findings are regressions or gaps in the PR's own claim; otherwise apply the cutoff and land with known limits. The door's refusals (`coord-lift-off` is retired, D-8165: the lift is always on): `coord-lift-off` parks the thread behind the operator's ask; `cap-not-reached` opens the review; a 404 is P4. |
| 13 | Step 5, a bare `400` on a review open (an older server) | Wait for the next wake | Physical (P4) | Unchanged in substance; it is recorded with `wakeOn: update`. |
| 14 | Step 6, an ejection with no `pinned` entry on the landing line ("it stays a stop for the operator") | Stop | Self-recover | Send a conflict-sync request on the measured conflict (clause 15 allows one) as a plain `fix-round` mail with the conflicted paths and no `ejection` field. |
| 15 | Step 6, a dequeue with any other cause, a requested change among them | Stop for the operator | Self-recover, except "ignore" | Re-read the cause. An unreadable cause is P3 (retry), then re-enqueue once. A requested change is addressed by default; only "ignore" is the operator's (O6). |
| 16 | Step 6, an advance whose landing recorded no base ("report it to the operator") | Report | Self-recover | Read `runs list` for the run's state, then send a plain fix round and record it. |
| 17 | Step 6, "Different project": a missing or non-`done` row, a failed release, absent merge proof | Report, do not dispatch | Self-recover | Re-read with backoff. Absent merge proof means land the producer first (step 7), not report. |
| 18 | Crossing paragraph and "When something is wrong", `cap-concurrency`: "stop, say so, and wait to be woken" | Wait | Self-recover (R5) | The fleet-capacity spec §3.5(e): the in-place bind and a sibling worktree, unless one of its seven reasons applies. Then the wake-on-free mail (D-6095 to D-6097). |
| 19 | `hold-invalid` (400) and `hold-oversize` (413) | Stop and report | Self-recover | **On an open:** `hold-invalid` is a defect in the coordinator's own input (a wave, denominator or run id that is not a positive safe integer). Correct the input and resend; nothing was opened. `hold-oversize` cannot come from the open route today (the slug cap refuses first as `bad-request`). **On a stored row at dispatch or close:** the row never passed the open door and the coordinator cannot correct it, and an open of the same wave would return the same run (as row 34). Raise an end request for the run (runs rebuild §10, D-8115; a non-blocking `do` item until B6 ships), park the thread and work the rest. When the run reads abandoned, open the wave again; the open door's slug cap keeps the new row within limits. |
| 20 | Untyped answers: `unsupported`, `not-configured` | Stop and report | Physical (P4) | A tool or box fact. Record it with `wakeOn: update`. |
| 21 | A bare `{"ok":false,"stderr":…}` 502 | Stop and report; never retry | Self-recover, then physical | Read the stderr. Slug in use: choose another name. An `ensure` or `ws-hold` failure: retry with backoff, three times. Then P4. |
| 22 | `registry-unmeasurable` (502), possibly after `ws-add` ran | Stop; the operator resolves it | Self-recover through the existing pass | Park the thread; never a blind retry. The dead-dispatch pass (D-7319, D-7563), extended in §8.3 item 3, binds the returned child when exactly one `.child` marker names the run, or abandons the dead dispatch, and mails the coordinator either way. On that mail, re-read `runs list`: a bound run goes on; an abandoned one is opened again. |
| 23 | "When something is wrong": cannot reach the server | Stop and report | Physical (P3) | Backoff. The `coord-ball` arm's mail rung wakes it once the server is back (§8.3). |
| 24 | Clause 15 and §5b, "No `--admin`" | Never | Self-recover where D-8124 applies | Through D-8124's one gated verb: coordinators only, in repositories where ccrc has admin and no merge queue runs, with checks green on the exact head, no changes-requested review and no draft. The hook still denies a raw `--admin`. Everything else is O4. |
| 25 | Linear, `not-configured` | Tell the operator | Keep (O4) | A key is a credential. |
| 26 | Linear, untrusted text | Read as data | Guard | Unchanged. |
| 27 | The skill's description, "Never use it to do a wave's own work" | Forbidden | Changed (R5) | Allowed through §3.5(e)'s in-place bind only. W1-5's words (D-6097). |
| 28 | `wave-lifecycle.md` §1, `home-mismatch` | Stop and report | Self-recover | Read the stored programme's goals (`goals show <slug>`, §8.1) and compare its pinned spec path with this coordinator's own. Match: resend with the stored home (`by`). No match, or no pin: the slug names another programme, so open under a new slug. |
| 29 | §1, `claimant-is-a-worker` | Stop and report | Guard | The session is a worker, not a coordinator. |
| 30 | §1, `project-mismatch` because the caller's own registry row records no project | Stop and report | Self-recover | The missing project only stops rebinding an existing session; where a coordinator sits never refuses an open. Open the wave without `sessionId`, so it spawns fresh, and record the registry fault as a routine call. |
| 31 | §1 and §2, `spent-unmeasured` repeating | Stop and report | Physical (P3) | Retry the same open or dispatch with backoff, keeping `sessionId`: the reference says "do not drop `sessionId` on its account", and at dispatch the run is already bound. When the repeated `detail` shows the child's branch or tip does not resolve, the next run opens on a fresh child, as the reference already says. |
| 32 | §2, `ambiguous-dispatch` | Stop; the operator resolves it | Self-recover through the existing pass | As row 22: the extended dead-dispatch pass binds or abandons and mails. On a bind, go on. On an abandon, open again and dispatch with an explicit `slug`; a named spawn binds only `<project>-<slug>`. |
| 33 | §2, `hookstate-unmeasurable` or `status-unmeasurable` repeating | Retry once, then stop and report | Self-recover, then physical | Back off three times over about 15 minutes. Then close the run as failed and open fresh without `sessionId` (as row 36). Then P4. |
| 34 | §2, `project-mismatch` at dispatch | Stop and report | Keep (the abandon is the operator's), non-blocking | Opening fresh without `sessionId` returns the same still-planned run, still bound, and the next dispatch refuses the same way (`wave-lifecycle.md` §2). The abandon door is closed to sessions by decision. So: raise an end request for the wedged run (runs rebuild §10, D-8115; a non-blocking `do` item until B6 ships), park the thread and work the rest. When the run reads abandoned, open the wave again without `sessionId`. |
| 35 | §2, `intent-held` | Mail the holder; dispatch only on its word or the operator's | Self-recover | The two coordinators settle it between themselves. The holder's word decides. Silence parks the thread and the rest continues. Only a disagreement between them about cross-programme scope is the operator's (O3). |
| 36 | §2, `spawnState` `login` or `blocked` | Tell the operator; do not re-dispatch onto that lane | Split | The account is O4 and gets an item. The wave: close the dispatched run as failed (allowed for a dispatched run), then open it fresh without `sessionId`. Placement skips the lane, because ccd's placement filter (§8.3 item 4) skips a lane whose newest `spawnState` is `login` or `blocked`. |
| 37 | §2, `spawnState: narrow` | Ask the operator to widen the pane | Self-recover, then physical | Give it the ordinary window, then close as failed and open fresh as row 36. A `do` item is raised only if it repeats, and never as blocking. |
| 38 | §2, `skillState: absent` ("report before you treat the wave as briefed"; "running the installer is a human act") | Report first | Self-recover (operator, 2026-11-09) | The wave is briefed: the brief carries the branch line for exactly this case. The agent runs the skill installer on that home itself (§8.3 item 5). On `failed`, a non-blocking `do` item. Either way the coordinator goes on. |
| 39 | §2, the answer's `sessionId` differs from `<project>-<slug>` (older server) | Stop and report | Physical (P4) | Record it with `wakeOn: update`. |
| 40 | §4, `branch-unmeasurable` repeating | Needs a human | Self-recover, then physical | Back off (P3), then P4. |
| 41 | §4, `ejection-not-merging` | Report to the operator | Self-recover | Re-read the run and act on the state it is in. |
| 42 | §5b, the landing verdict's stops | Every stop goes to the operator | Split by reason | **Rule shape** (`unknown-rule-type`, `method-set-empty`, `rebase-only`, `queue-method-not-allowed`, `two-queue-methods`, `auto-merge-off`, `read-3b-unknowable`, `unverifiable`): O4, non-blocking. **Transient** (`unreadable`, `verdict-unread`, `checks-gate-unread`, `not-reported`): P3 backoff. `not-at-head`: re-measure and re-bind through the existing paths. `changes-requested`: address by default; "ignore" is O6. `approval-missing`: D-8124. `red-unreachable`: the new-head route where `main` is already fixed (D-7588); otherwise mail the red's owner and park. `github-refused`: O4, unless the refused rule is code scanning on the PR's own findings, which is a fix round. |
| 43 | §5, the landing line paused, the pin differs, the read fails | Report; leave the landing stopped | Split | A paused line is the operator's (keep). A failed read is P3. A different pin is re-measured, and re-pinned through the normal advance where the server's own pin is stale. |
| 44 | The ask lane, `child-unmeasurable` and `not-held` | Re-read; do not loop | Unchanged | Already self-recovering. |
| 45 | The ask lane, `no-questions-door` | Tell the operator | Physical (P4) | An older build without the door. Record it with `wakeOn: update`. |
| 46 | Clause 3 and §6, reaping | Never | Guard | A SAFETY rule. Never relaxed. |
| 47 | `resume.md` §6, the id is lost | Stop and report | Keep (O4) | The handover is the operator's, through the runs rebuild's Resume door and picker (row 3). Park the thread; nothing new is built here. |
| 48 | `resume.md` §2, the dead-coordinator lane | Armed by the operator | Unchanged | Already ruled. |
| 49 | `routing-matrix.md`, Debugging: "the third attempt is a rung a human chooses — the session reports the ceiling and stops" | Stop | Open (§15 Q4); the operator's instruction stands | Until the operator answers, the third attempt is a rung a human chooses: the ceiling stops that thread only (R6), raised as a `decide` item, and the rest of the programme goes on. Not built while Q4 is open: if D-8126 is ruled to supersede the 2026-09-22 instruction, only the jump to a credits-billed model would stay the operator's (O2), and the coordinator would continue with `max` by the mechanical rule, a fresh-context worker and a narrower reproduction before parking the item. |
| 50 | `peer-protocol.md`, a claim holder `deliverable: no:<reason>` ("escalate to the operator") | Escalate | Self-recover | Work the uncontested paths and wait for the claim's `expiresAt`. Only a claim that never expires is P4. |
| 51 | `mail-envelope.md`, parked mail | The operator is told after about 15 min | Unchanged | A delivery fault the server already reports; the sender keeps working. |
| 52 | Server, the stall watch's `coord-blocked` arm | Reports only (D-6942) | Unchanged, plus a count | It keeps reporting. Its push also counts an R7 breach when the hold is a pending dialog on a pinned programme (§10, M2). The acting rung is on `coord-ball` (row 59). |
| 53 | Server, the idle-compaction nudge | Fires only on open task-list items (D-5373) | Widened | §8.3, item 2. |
| 54 | Server, `cap-concurrency` and the future `capacity` refusal | Refuses; nothing wakes the coordinator | Built (R5) | Fleet-capacity W1-2 (D-6093), W1-3 (D-6094), W1-4 (D-6095), W1-4b (D-6096) and W1-5 (D-6097), in that plan's order. W1-1 and W1-1b (D-6091, D-6092) are already built. |
| 55 | `ccd/session-hook.sh`, `CARD_ROLE`: "…your own go to the operator." | Tells coordinators to ask | Changed | §9.2. |
| 56 | `wave-lifecycle.md` §5, native-queue landing: a coordinator whose own workspace carries a programme-wave hold or the child marker is refused its enqueue by the session hook ("ask the operator to enqueue, or disarm … and wait at `merging`") | Operator's manual act; landing blocked | Physical (P4), non-blocking | A hook deny is never worked round (A1). The coordinator raises one non-blocking `do` item naming the PR and the exact command, parks that run at `merging`, and works every other thread. A server or keeper door that enqueues for a coordinator is under "Later", in "Where things stand". |
| 57 | `wave-lifecycle.md` §5 and §5b: required checks still pending (exit 8, or `WAIT pending`, or the bounded wait spent on `not-reported`) after the landing attempt's bounded wait ("report the exit/line to the operator and leave the landing stopped") | Report; landing stopped | Physical (P3) | A `block` call with a time wake on the backoff schedule; on the wake, run the verdict again as a new landing attempt. After 4 hours, the non-blocking `do` item of P3. |
| 58 | Close answers `not-dispatched`: a planned run with no session that its coordinator knows is dead | No door; the run is forgotten | Keep (the abandon is the operator's), non-blocking | Raise an end request (runs rebuild §10, D-8115; a non-blocking `do` item until B6 ships). The dead-dispatch pass (D-7319) also abandons such runs once they are stale, under its switch. The thread parks. |
| 59 | Server, the stall watch's `coord-ball` arm (one operator push at 30 h, `COORD_BALL_CAP_MS`) and the `quiet` ladder's operator rung (rung 3) | Reports to the operator only | Acts first | §8.3, item 1: `coord-ball` gains a rung that mails the coordinator. The 30 h push and the `quiet` ladder stay as they are. |
| 60 | `references/delegated-worktrees.md`, "The operator's acts": attaching a lease, saying a worktree is not delegated, acting on a worktree in conflict | Never done by a session | Keep (O4) | The thread that needs it parks; the rest continues. |
| 61 | 403 `stale-uuid` on an ack or a mail | Stop and report | Self-recover | Derive the identity again (`ccrc-api whoami`) and resend once. A second `stale-uuid` is P4. |
| 62 | D-8125's lift door: `coord-lift-off`, `cap-not-reached`, 404 | Not covered | As §5.7 | `coord-lift-off` (retired, D-8165: the lift is always on, so this refusal no longer exists): was keep, park the thread. `cap-not-reached`: open the review. 404: P4. |

## 8. What the server must add

### 8.1 A goals read for coordinators, and a stored definition of done

- **The read** (author's call on the shape). Coordinators read goals through the operator's own route,
  `GET /api/programmes/:slug/goals`, which becomes exempt-but-authenticated in `server/src/auth/gate.ts`: it accepts
  the operator's session or the box token. That is the repository's pattern for a cookieless fleet caller of an
  operator read (D-149: `GET /api/runs`, `/api/feed` and `/api/runs/:id/items`). No second route is added.
  - **Client row:** `ccrc-api goals show <slug>`.
  - **Answer** (the same for both callers): `specPath`, `inShort`, `doneWhen` (below), the modifications with their
    rulings and merged state, the programme's open operator items (id, kind, title, needed-by), and its last 20 big
    calls. All of it comes from the one reader, `goalsFor`, widened.
  - **No ownership check on the read,** as on `GET /api/runs`: a coordinator reads goals as data, and row 28 needs to
    read another programme's pin to compare spec paths. Writes keep today's gate: box token, then attribution
    (`byId`, `byUuid`), then `claimsProgramme`, else 403 `not-your-programme`. Attribution is not authentication, a
    known limit that D-8125 also records ("Later", in "Where things stand").
- **The definition of done** (author's call). `goals pin` gains an optional `doneWhen`: a numbered list of at most
  12 conditions, each 1 to 2,000 characters, stored as a copy. Nothing parses the spec, exactly as `inShort` works
  (D17 of the ledgers spec).
  - `goals modify` can replace it. A change to it is operator-only (O3). The coordinator records only a change the
    operator has ruled, and cites that ruling.
  - The ledger template gains a "Goals and definition of done" section, the shape `programs/ccrc-history.md` already
    uses.
- **Programmes pinned before this** (author's calls).
  - **The spec already states its definition of done** (success criteria, or a "done when" list): the coordinator
    copies it verbatim into `doneWhen` with `goals modify`, citing D-8126. This changes nothing about what done
    means, so no item is raised.
  - **The coordinator has to infer it:** it drafts one from the spec into its ledger and raises one non-blocking
    `decide` item, "approve this definition of done" (O3). On approval it stores it with `goals modify`, citing the
    item. Until then it may use the draft for routine calls, never to justify a call that widens or narrows scope.
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
  | `question` | the question; nullable, and null for `block` rows |
  | `options` | JSON, at least two for `routine` and `big`; nullable, and null for `block` rows |
  | `chosen` | the option chosen; for a `block` row, what the thread waits on |
  | `why` | one line that cites the goal or ruling it rests on |
  | `reversible` | 0 or 1 |
  | `wakeOn` | `block` only: `capacity`, `account-room`, `disk`, `memory`, `time:<epoch>` or `update` |
  | `expiresAt` | `block` only: when the wake request lapses (below) |
  | `at` | when it was made |
  | `seenAt` | when the operator marked it seen |
  | `overturnedAt` | when it was overturned |
  | `overturnNote` | the operator's note |

  - The route is `POST /api/coord/programmes/:slug/calls`. It takes the box token, then attribution, then
    `claimsProgramme`, else 403 `not-your-programme`: the gate `goals pin` and D-8125's lift door use. The client row
    is `ccrc-api calls record`.
  - The route is the table's only writer. Every text passes `redactCommand` and is cut whole, as review-cap reasons
    are (D-8125).
  - **Migration slot.** D-8125 takes 48, so this migration takes 49 or the next free slot. The PR re-measures the
    slot with the grep the D-8125 plan uses, once before opening and again before merge.
- **Why `block` is a row kind and not a second wake mechanism** (author's call; the PR body records it). A parked
  thread's wake request is a decision the coordinator made ("this thread waits on X"), with the same writer, gate and
  audit as any call. A separate table would be a second writer for coordinator decisions. The server's existing wake
  paths send the mail when the condition clears:
  - capacity: the wake-on-free mail (D-6095);
  - account room: a resumed session after swap or reset;
  - disk or memory: the alarms clearing;
  - time: the lane schedule;
  - update: the roll finishing.

  This is a reason for the existing wake lanes to fire, not a new wake lane. Each wake goes through the wake budget's
  rate.
- **When a `block` row lapses** (author's call). A time wake expires at its time. A condition wake expires when its
  condition clears, or 24 hours after it was recorded if the condition never cleared. After that the `coord-ball`
  mail rung (§8.3) may fire for that coordinator again.
- **Reads.**
  - The goals read (§8.1): the last 20 big calls.
  - The operator's Waiting on you read: big calls only, not seen and not overturned, newest first.
  - The digest builder: big calls only (§6).
  - The run page: every call that carries its `runId`, in a collapsed "Calls" section the operator opens unasked.
  - The measures in §10: the table directly.

### 8.3 Detectors that act, and the faults the server already owns

1. **`coord-ball` gains a rung that mails the coordinator** (author's call; it extends the existing arm instead of
   adding a `coord-idle` arm, under the consolidation rule).
   - **When it fires.** A coordinator that claims an open run, reads `idle`, has no held mail, and has held the ball
     for 20 minutes. None of these may apply: an active child run (`dispatched` or `working`); an open review run; a
     run at `merging` with its PR queued; a blocking operator item; an unexpired `block` call; a `wait:` mail it sent.
   - **What it does.** One system mail through `queueSystemMail`: "You have open runs and nothing waits on the
     operator. Continue per coordinator clause 21; re-read `runs list` and `goals show`." If the coordinator is still
     idle 30 minutes later, one more mail. It follows `orphan-d`'s pattern of mailing the session first.
   - **What stays.** The arm's existing operator push at `COORD_BALL_CAP_MS` (30 h), in the same episode, and the
     `quiet` ladder. No new or earlier operator push is added.
   - **Arming.** The new rung ships dark: it records shadow rows until the operator touches `stall-watch-w2-live`, as
     every new stall act does (D-3605). Turning it live is the operator's act (O1, §13).
   - `coord-blocked` keeps reporting. For a coordinator holding mail behind a pending dialog on a pinned programme,
     its push also counts an R7 breach, for M2.
2. **The idle-compaction nudge counts open runs** (author's call). In `idleNudgeVerdict`, `tasks-unread` comes before
   `no-open-tasks`, and `tasks-stale` comes after it; a coordinator with no task list has `touchedAt === null`, so
   `tasks-stale` would still hold if only `no-open-tasks` changed. The change: for a session that claims a run in a
   non-terminal state that is not waiting on a blocking operator item, the verdict skips all three task holds and
   uses that run's latest `run_event` as the staleness clock in place of the task list's. Every other hold in
   `IDLE_NUDGE_HOLD_MAP` stays, and the nudge stays once per compaction.
3. **The dead-dispatch pass takes the orphaned spawns** (author's call; it extends `server/src/coord/abandonDeadDispatch.ts`
   instead of adding a reconciler). Today the pass abandons a planned run whose dispatch never came back (D-7319) and
   binds a returned child when exactly one `.child` marker names the run (D-7563), through `childBindGate`, under its
   switch in Settings, and mails the coordinator. The change: a dispatch that answered `registry-unmeasurable` or
   `ambiguous-dispatch` stamps the run as a candidate for the pass at once, rather than waiting for the stale bound.
   Every guard of the pass stays: its switch, its re-measure inside the serialiser, the child bind gate and its cap.
   This turns rows 22 and 32 into a wait for the pass's mail.
4. **ccd's placement skips a lane that cannot spawn** (author's call). `_ws_least_loaded` skips a lane whose newest
   recorded `spawnState` is `login` or `blocked`, until a later spawn on that lane reads otherwise. Without it, rows
   36 and 37's fresh open could land on the same lane again.
5. **The skill installs itself on a home where it is absent** (author's proposal; allowed by the operator,
   2026-11-09). When a dispatch's
   preflight measures `skillState: absent`, the agent gains a frame that runs the skill installer for that lane's
   home. The answer reports `installed` or `failed`. The skill installer is not a Claude Code build roll, so D-5696
   does not forbid it. `wave-lifecycle.md` calls running it "a human act"; the operator's answer supersedes that line,
   which A5 rewrites. On `failed`, row 38 raises a non-blocking `do` item.

The handover item that rev 1 proposed here is dropped: the runs rebuild already provides the coordinator-gone Resume
door with its picker (§9.5, A55, A56) and the lane items that carry a working control (§10, A59, A62).

### 8.4 The do-it-yourself ruling, built (R5)

Build the fleet-capacity plan's remaining tasks in its own order, keeping every gate that plan sets:
- **W1-2** (D-6093): a live resume or a send-back is never refused `cap-concurrency`. Gate: OA-F2 met.
- **W1-3** (D-6094): runs whose worker is dead, asleep or long idle stop filling the cap. Gates: W1-2 merged, OA-F2
  met, OA-F3 in the PR body.
- **W1-4** (D-6095): refused coordinators are mailed when the cap frees. Gates: W1-3 merged; `LANE_SCHEDULE` (C1h) and
  `dedupeKey` (C1f) are already on `main`.
- **W1-4b** (D-6096): the in-place bind and the `self-dispatch` refusal. Gate: W1-4 merged and the self-claimed-
  dispatch count measured at zero.
- **W1-5** (D-6097): the words in the refusal details and the skill: the tree rule, the in-place bind, the seven
  reasons, wake-on-free. Gates: W1-4 and W1-4b merged; OA-F4 (the skill installed on the box) after deploy.

W1-1 and W1-1b (D-6091, D-6092) are already built. OA-F2 and OA-F3 are read-only measurements a session may take.
Every deploy, and OA-F4, is the operator's (O1). All seven of §3.5(e)'s reasons stay. Reason 1 says a review is never
done inline. Reason 6 says the pause is the operator's stop; the operator's answer of 2026-11-09 reads it as a stop for dispatch, the
in-place bind and self-work on new waves, while non-dispatch work continues (row 1). D-6096's rule that the pause
binds the in-place bind holds, and W1-5 words reason 6 to match clause 4.

## 9. How the rule reaches running coordinators

### 9.1 The skill

- **Clause 21, a new contract sentence** (the operator approved these words on 2026-11-09, and
  `server/test/coordinator-skill.test.ts` pins them verbatim). "These twenty sentences" becomes "twenty-one", and
  that test's number-word list grows by one.

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
  - **Clause 4 and the `paused` entry:** split by cause (row 1). Under the operator's pause, dispatch, the in-place
    bind and self-work on new waves stay forbidden, and non-dispatch work continues: landing already-reviewed PRs,
    reviews, docs (operator, 2026-11-09).
  - **Clause 11:** "rule only from what you can read: the spec, the plan, the ledger, the branch, the programme's
    goals and definition of done, and your own prior rulings". Release only what clause 21 makes the operator's.
  - **Clause 19:** questions to the operator are items, never a turn ending on a question.
  - **Clause 20:** items are for the operator-only classes and for blocks that need a human act.
  - **Step 5:** the review cap, through D-8125 and §5.7.
  - **"When something is wrong":** each entry rewritten to §7's disposition.
  - **The description:** §3.5(e)'s exception.
- **The references move with the skill:** `wave-lifecycle.md` (§7, rows 1, 12 to 45 and 56 to 58), `resume.md` (rows
  3 and 47), `routing-matrix.md` (row 49: unchanged while §15 Q4 is open), `peer-protocol.md` (row 50) and `delegated-worktrees.md`
  (row 60, unchanged words). `references/decision-procedure.md` is new and holds §5 (with §5.1's split rule, §5.2's
  standing operator preferences and §5.7) and §3's lists, so the clause stays one paragraph.
- **Constraints on the skill text** (from the tests and pins that already exist):
  - No skill file contains the substring `review-cap` (D-8125's pin). §7's `cap-review-rounds` is a different string
    and is allowed.
  - `ws-reap`, `ws-rm` and `ws-gc --prune` are named only inside clause 3. `decision-procedure.md` and P2's text say
    "SAFETY-listed verbs" and never list them.
  - The skill never names the operator's doors: not `/api/digest/correct`, and not the goals route. It names the
    client verbs (`ccrc-api goals show`, `ccrc-api calls record`).
  - The "twenty" clauses are pinned verbatim, so clause 21's words land with their pin in the same PR.
- **The skill installer** carries it to every home, as it does today.

### 9.2 Re-injection after compaction

- **The roster card.** The hook's roster card (D4, #757), armed on the fleet, already re-reads a coordinator's open
  runs on compact, resume and clear. It gains one fixed line, a constant with no server bytes in it (author's call):
  "ccrc-autonomy: before asking the operator, read your goals (`ccrc-api goals show <slug>`), decide, record
  (`ccrc-api calls record`), continue; stop only for an operator-only act or a physical block (coordinator clause
  21)." `ROSTER_CARD_MAX_CHARS` is 2,048 in `ccd/session-hook.sh` and the body is clipped at that limit less 64, so the
  line (about 230 characters) is placed before the run list and counted inside the limit.
- **`CARD_ROLE`.** The text "your own go to the operator" becomes "your own you work out from the programme's goals
  first; only operator-only decisions go to the operator".

### 9.3 Coordinators already running

Idle coordinators pick up the new skill text on their own: under the 2026-10-29 roll rule, a coordinator takes a new
release, binary or skill text whenever it is idle, and rolls ignore claims (ruled 2026-10-30). For busy ones, when
the release carrying clause 21 rolls, the server sends one system mail to each claimant of an open run (author's
call): "The coordinator skill changed (clause 21). Re-read `ccrc-coordinator`, then `goals show` for your programme."
The mail goes through `queueSystemMail` under the wake budget's rate.

## 10. Measures of success

**The baseline** is taken in the plan's first task. The transcript census of §1.2 is re-run as a committed,
read-only script, and the server counts are read from `coord.db`. **Measuring** happens weekly, then at 30 days
after the rollout mail.

| # | Measure | Baseline | Target at 30 days |
|---|---|---|---|
| M1 | **Stall hours:** coordinator time idle or in a dialog waiting on the operator (§1.2's census) | 680 h typed-reply waits over an hour, plus 539 h of dialogs over an hour, per 14 days | Down 70% (the share §1.2 found answerable) |
| M2 | AskUserQuestion dialogs opened by coordinators on pinned programmes | 611 in 14 days (all programmes) | 0 (R7). Above 0 two weeks after the rollout mail adds the hook deny (R7) |
| M3 | Operator items per programme-day: items raised plus asks released to the operator, per day a programme has an open run | measured in the first task from `operator_items` and `asks` | Down by half |
| M4 | Items answerable from goals: of 30 items sampled each week, split by §5.1's rule, the share of parts a reviewer classes as routine or big against §3 and §5 | 72% of the long waits sampled in §1.2 | Under 10% |
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
- No new handover or end-request door: the runs rebuild (D-8115) owns both.

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
| Wider goals read | Any box-token caller can read any programme's goals | The same exposure `GET /api/runs` already has (D-149). Goals hold no secrets; secrets never reach a coordinator (O4) |
| The operator wants to be asked about some kind of call | Calls happen that the operator would have liked to weigh in on | An overturn with a note, recorded as a ruling (clause 11's digest rule), teaches the next call. A repeated pattern becomes an O-class by a later ruling |
| Rule conflicts with existing D-numbers | Old skill text keeps saying "stop" | §7's inventory is the full list, and §14 names what this spec supersedes. The plan rewrites each row in the same PR as clause 21 |
| The skill gets longer | A 634-line skill grows again | Clause 21 is one paragraph. The procedure lives in a new reference file. §7's rewrites replace text rather than add to it |

## 13. Build order, for the plan

The waves are listed in dependency order. Each wave is one PR. Every deploy and every arming marker is the operator's
act (O1); the plan names them per wave so the operator can schedule them.

| Wave | What it builds | Depends on | The operator's acts |
|---|---|---|---|
| A1 | The baseline: the committed census script (read-only, applying §5.1's split rule), the first M3 and M4 counts | nothing | none |
| A2 | Server: `doneWhen` on the pin; the goals read opened to the box token (D-149's pattern) and widened; `ccrc-api goals show` | nothing | server deploy |
| A3 | Server: `coordinator_calls` (migration 49 or later), its route and `ccrc-api calls record`, the digest's `call` line kind and correction arm | A2 | server deploy |
| A4 | Console: "Calls made for you" on Waiting on you, Overturn… and Seen on each call, the run page's calls section | A3 | server deploy (the console ships with it) |
| A5 | Skill: clause 21 and its pin, the clause 4, 11, 19 and 20 rewrites, `decision-procedure.md`, §7's rows in the skill and references | A2, A3, D-8125 merged; §15 Q1 to Q3 answered (2026-11-09); row 49 keeps today's words while Q4 is open | the skill install on the fleet box |
| A6 | Server: `coord-ball`'s mail rung (dark), the nudge's run-based holds, `block` wakes on the existing lanes and their expiry | A3 | server deploy; touching `stall-watch-w2-live` to make the rung send |
| A7 | Server and agent: the dead-dispatch pass takes the orphaned spawns; ccd's placement filter; the skill self-install (§8.3 item 5, allowed 2026-11-09) | none of the above | agent lane first, then server (the deploy order is agent-first); the pass's switch in Settings if it is not already on |
| A8 | Fleet-capacity W1-2, W1-3, W1-4, W1-4b and W1-5 (D-6093 to D-6097), in that plan's order and under its gates | that plan's own gates; OA-F2 and OA-F3 measured read-only | a server deploy per task; OA-F4 after W1-5 |
| A9 | Hook: the roster line and `CARD_ROLE`; the rollout mail | A5 | agent lane deploy |
| A10 | Measure at 30 days; adjust the routine-or-big line if M5 is over target; decide R7's hook deny from M2 | A1 to A9 | none |

D-8123, D-8124 and D-8125 are in flight and are not rebuilt here. A5 cites them and waits for D-8125's merge.

**The D-number rule.** `server/test/deviation-refs.test.ts` takes the high-water from definition lines in
`docs/superpowers/plans/*.md` only, and fails any tracked file that cites a higher number. This spec's PR therefore
carries `docs/superpowers/plans/2026-11-09-coordinator-autonomy-default.md`, which holds D-8126's definition line and
becomes the A1 plan once its tasks are written. With D-8126 defined there, the high-water is 8126 and the
spec's citations of D-8123 to D-8125 pass. This spec lands after the D-8123, D-8124 and D-8125 plans where it can,
so that each cited number already has its own entry.

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
  - **The operator's answers to §15, 2026-11-09:**
    1. **Approved as written,** with the author's calls R6, R7 and C1 to C25 and the words of clause 21 (§9.1). The
       agent may run the coordinator-skill installer itself where a dispatch measures `skillState: absent`: row 38
       self-heals, and §8.3 item 5 is built.
    2. **Under the operator's pause, non-dispatch work continues:** landing already-reviewed PRs, reviews, docs.
       Dispatch, the in-place bind and self-work on new waves stay forbidden. This sets clause 4, row 1 and the
       skill's `paused` entry.
    3. **Comments on other people's PRs and issues in public repositories, and tracker writes that mirror to public
       GitHub, are both routine,** not operator-only. This sets C2 and the O1 line.
    4. **Not yet answered:** whether D-8126 supersedes the 2026-09-22 debugging ceiling. Row 49 stays as the
       operator's instruction stands (the third attempt is a rung a human chooses), the change is not built, and the
       question stays in §15.

**What this spec supersedes or changes.** Each is named so that no older text is left saying the opposite:
- **Clause 11's "if answering would require guessing rather than reading, decline"** and its default of releasing
  any new decision to the operator (coordinator-first routing, D-5289 to D-5302). Superseded by D-8126: working an
  answer out from the goals is reading. The routing of children's questions to their coordinator is unchanged.
- **The skill's "a program that stalls honestly is recoverable"** and its stop-and-report exits, as §7 lists them.
  Superseded by D-8126's "everything else is a fault to recover from".
- **The skill's `cap-concurrency` entry, "stop, say so, and wait to be woken",** and the description's "never use it
  to do a wave's own work". Superseded by the 2026-10-20 ruling as built (D-6095 to D-6097).
- **Clause 19's turn ending on a question, and AskUserQuestion on a pinned programme.** Changed by R7.
- **`wave-lifecycle.md`'s "running the installer is a human act"** (row 38). Changed: the operator allowed the
  self-install on 2026-11-09.
- **`routing-matrix.md`'s 2026-09-22 debugging ceiling** (row 49). Not superseded: the question is open (§15 Q4) and
  the instruction stands.
- **Clause 4's reading of the pause as a full stop,** and fleet-capacity §3.5(e) reason 6's "reports and waits"
  (row 1). Changed: under the operator's pause, non-dispatch work continues (operator, 2026-11-09). Dispatch, the
  in-place bind and self-work on new waves stay forbidden, so D-6096 holds.
- **The autonomy-window proposals** #1628 and #1824. Superseded by R1.

Every "author's call" below was approved by the operator with the spec on 2026-11-09.

| # | Decision | Chosen | By |
|---|---|---|---|
| R1 | Default or opt-in | Default and always on; no window, mode or switch | Operator, 2026-11-09 |
| R2 | Before asking | Work it out from goals and the definition of done; decide; record; continue | Operator |
| R3 | When to stop | Operator-only (§3, O1 to O4) or physically blocked after healing (§4, P1 to P4) | Operator |
| R4 | What the operator sees | Big, design-level calls, each overturnable; routine calls not surfaced | Operator |
| R5 | The do-it-yourself ruling | Built (§8.4) | Operator |
| R6 | Scope of a stop | A thread, never the programme | Author's call |
| R7 | Dialogs | None once the Goals pin exists; allowed in the brainstorm phase; a skill rule first, a hook deny only if M2 stays above 0 after 2 weeks | Author's call |
| C1 | Extra operator-only classes | O5, a fact only the operator holds; O6, overriding a person | Author's call |
| C2 | What is plainly not outward-facing | Pushes, PRs, landing, replies to review bots, mail between sessions; comments on other people's PRs and issues in public repositories; tracker writes, including those that mirror to public GitHub | Author's call; the last two the operator, 2026-11-09 |
| C3 | Healing steps and backoff schedule | §4's steps; backoff of 1, 2, 4, 8, 15 and 30 min, then every 30 min, each a `block` call with a time wake; a non-blocking `do` item after 4 h | Author's call |
| C4 | Tie-breakers and rule conflicts | §5.3's order; the later of two conflicting rulings governs | Author's call |
| C5 | The routine-or-big line | §5.4's list; a change to goals, scope or done is O3, any other change to spec behaviour is big and a deviation | Author's call |
| C6 | Where calls are recorded | A server record (`coordinator_calls`) plus one ledger line; the ledger stays human-only | Author's call |
| C7 | How big calls are surfaced | Read into Waiting on you the way Questions are; a digest line kind; never pushed; 7-day expiry. Routine calls are in no digest, not even as a count | Author's call |
| C8 | The overturn door | The digest correction route, extended with a `call` row kind; Overturn… with a confirm; Seen in one tap | Author's call |
| C9 | The goals read | The operator's route made exempt-but-authenticated for the box token, as D-149 did for the runs read; no second route; no ownership check on the read | Author's call |
| C10 | The definition of done | A stored `doneWhen` copy on the pin; a ledger section; for older programmes a verbatim copy when the spec states one, else a draft plus an approval item | Author's call |
| C11 | Detectors that act | `coord-ball` gains a coordinator mail rung (20 min, again 30 min later), dark behind `stall-watch-w2-live`; the nudge's run-based holds; the dead-dispatch pass takes orphaned spawns; ccd's placement filter; the skill self-install where a dispatch measures it absent | Author's call; the self-install the operator, 2026-11-09 |
| C12 | Wakes for parked threads | `block` calls with a wake condition, served by the existing wake lanes; a time wake lapses at its time, a condition wake on clearing or after 24 h | Author's call |
| C13 | Delivery | Clause 21 plus a reference file; a fixed roster-card line; the `CARD_ROLE` text; the idle roll; one rollout mail | Author's call |
| C14 | Disposition of each stop point | §7's table | Author's call (rows 12, 18 and 24 follow D-8125, R5 and D-8124; rows 1 and 38 follow the operator's answers of 2026-11-09; row 49 waits on §15 Q4) |
| C15 | Measures and targets | §10 | Author's call |
| C16 | The pause | Split by cause (the pause file present or absent); under the operator's pause no dispatch, in-place bind or self-work on new waves, and non-dispatch work continues: landing already-reviewed PRs, reviews, docs | Author's call; what continues the operator, 2026-11-09 |
| C17 | The review cap | Lift only for regressions or gaps in the PR's own claim; otherwise the cutoff and known limits; the door's three refusals as §5.7 | Author's call |
| C18 | Standing operator preferences | Written in plain words into `decision-procedure.md` (§5.2) | Author's call |
| C19 | The split rule | One rule for the coordinator, the census and M4 (§5.1) | Author's call |
| C20 | Self-cleanup limits | Worktrees only after the PR is pushed and the run closes; scratch files only, never a repository with unpushed commits | Author's call |
| C21 | Wedged and unclosable runs | An end request through the runs rebuild, then a fresh open (rows 19, 34, 58), a non-blocking `do` item until B6 ships | Author's call |
| C22 | Lanes that cannot spawn | Close as failed, open fresh, and ccd's placement skips the lane (rows 36, 37) | Author's call |
| C23 | `home-mismatch` | Compare pinned spec paths before resending (row 28) | Author's call |
| C24 | `block` as a row kind | One table, one writer; `question` and `options` nullable for `block` rows; the reason recorded in the PR | Author's call |
| C25 | Deploy acts | Listed per wave (§13); every deploy and marker is the operator's | Author's call |

## 15. Open for the operator

Questions 1 to 3 were answered on 2026-11-09 and are recorded in §14 under D-8126. Question 4 stays open; until it is
answered, row 49 keeps the operator's instruction and its change is not built.

Answered 2026-11-09:

1. **Approve this spec, the words of clause 21, and the skill self-install.** Do you approve the spec with the
   author's calls R6, R7 and C1 to C25, and the words of clause 21 (§9.1), which the pinning test will hold verbatim?
   And may the agent run the skill installer on a lane's home when a dispatch measures `skillState: absent` (§8.3 item
   5)? `wave-lifecycle.md` calls running the installer "a human act" today. If yes, row 38 self-heals; if no, row 38
   stays a non-blocking `do` item and §8.3 item 5 is not built.
2. **Under the operator's pause, which threads continue?** The repository's `README.md` says the pause file "refuses every dispatch and
   stops nothing else". Clause 4, fleet-capacity §3.5(e) reason 6 ("That is the operator's stop; the coordinator
   reports and waits") and D-6096 (the pause binds the in-place bind) read it as a stop. Should landing
   already-reviewed PRs and other non-dispatch threads continue while the pause file is present, or should the
   coordinator stop every thread? In either answer, dispatch, the in-place bind and self-work stay forbidden. The
   answer sets clause 4, row 1 and the skill's `paused` entry.
3. **Where is the line for "messaging people" and "publishing" (O1)?** Two cases: comments on PRs and issues in a
   public repository where people other than the operator take part, such as an outside contributor's PR; and
   tracker issue and comment writes through `ccrc-api linear`, which mirror to public GitHub issues. Is either, or
   both, an operator-only act? The answer sets the routine/O1 line in the skill and C2.

Open:

4. **Does D-8126 supersede the 2026-09-22 debugging ceiling?** `references/routing-matrix.md` records the operator's
   instruction that "the third attempt is a rung a human chooses". This spec's row 49 would have the coordinator
   continue (max effort, a fresh-context worker, a narrower reproduction), keeping only the jump to a credits-billed
   model as the operator's (O2). Does D-8126 supersede the 2026-09-22 instruction except for that jump?

## Where things stand

### Agreed

- R1 to R5, the operator's rulings of 2026-11-09 (D-8126).
- The spec, with R6, R7, C1 to C25 and the words of clause 21, approved on 2026-11-09.
- §15 Q1 to Q3, answered on 2026-11-09: the skill self-installs where absent (row 38); non-dispatch work continues
  under the operator's pause (row 1); comments on others' PRs and issues and tracker writes that mirror to public
  GitHub are routine (C2, O1).

### Waiting on you

- §15 Q4: does D-8126 supersede the 2026-09-22 debugging ceiling (row 49)?

### Later

- **A door that enqueues for a coordinator.** Row 56 leaves the native-queue enqueue with the operator when the
  coordinator's own workspace carries a hold. A server or merge-keeper door could take it. Trigger: row 56's items
  appear more than once a week.
- **Big calls that need fast eyes.** A per-programme setting could push big calls of a chosen kind, for example
  console layout. Trigger: M5 shows overturns cluster in one kind.
- **A server-signed coordinator identity.** Attribution is not authentication, so a call record proves only "a
  process on this box". D-8125 records the same limit. Trigger: any call route gains an act that needs proof of who
  made it.
