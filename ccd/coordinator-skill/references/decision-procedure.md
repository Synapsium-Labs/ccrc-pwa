# The decision procedure

Clause 21 of SKILL.md is the rule: decide by default and keep going. This file is how. Read it before the first
question you would otherwise ask, and before you stop a thread. The classes below are the operator's rulings of
2026-11-09 (D-8126); the steps and tie-breakers are the author's calls built on them.

Every call named here is made exactly as SKILL.md's "How to call the API" sets it up.

## Which stops are allowed

A thread of work stops for two reasons only: a decision or act only the operator can make (O1 to O6), or a physical
block after the self-healing below has been tried (P1 to P4). Everything else is a fault to recover from, and
SKILL.md's "When something is wrong" gives the recovery.

One stopped thread never stops the programme. Park the thread, raise the item, then work every thread that is not
blocked. End the turn only when no unblocked work is left or children hold all of it, and say which in the turn's text.

Once a programme has a Goals pin, never open an AskUserQuestion dialog. Operator-only questions are items
(clause 20). Before the pin, in the brainstorm and spec phase, the operator is the source of the goals, and dialogs
stay allowed while no child is active (clause 19).

## What only the operator decides

In every class, raise one item with `ccrc-api items raise`, naming what, how and why. A `decide` item also names the
option you recommend and why it beats each alternative. Set the item `blocking` only when every thread is parked on it.
The item's tick mails you (clause 20), so a parked thread needs no other wake.

- **O1. Irreversible or outward-facing acts.** Acts the repository's SAFETY rules forbid to sessions, and acts on the
  live boxes: reaping, removing, expiring or reclaiming workspaces; touching units or tmux; account management;
  rolling or selecting a Claude Code build; `ccrc history` writes; deploys and rollouts; writing live box config,
  including touching a stall-watch or lane arming marker. Publishing: making a repository or package public, cutting a
  release, a public page. Messaging people. Comments on other people’s PRs and issues in public repositories, and
  tracker writes that mirror to public GitHub issues, are not in this class: they are routine (operator, 2026-11-09).
  Meanwhile: build and review everything up to the act. The PR is ready; the act waits.
- **O2. Spend beyond plan.** Usage credits, including any "Switch to usage credits" and any escalation to a model
  billed on credits. Paid services. New accounts. Meanwhile: continue on the plan’s own models and accounts.
- **O3. The programme’s goals, scope or definition of done.** Approving a spec. Changing a spec’s goals, scope or
  definition of done. Starting work outside the definition of done. Dropping or cutting a definition-of-done item.
  Accepting a known limit that leaves a definition-of-done item unmet. Starting a new programme. Choosing what the
  programme does next once its definition of done holds. Any other change to behaviour the spec describes is a big
  call (step 4), not O3. Meanwhile: work every item inside the current definition of done; when it holds, close the
  programme.
- **O4. Credentials and access.** Secrets (only through a `secret` item; a secret never reaches you). Sign-ins and
  account auth. Repository settings: rulesets, branch protection, merge methods, auto-merge (clause 15). Who may act on
  a programme: handing it to another session after a lost id (`resume.md`). Delegated worktrees: attaching a lease,
  saying a worktree is not delegated, and any act on a worktree in conflict (`delegated-worktrees.md`). Granting or
  removing people’s access. Meanwhile: route work to lanes and repositories you can use; the blocked thread waits.
- **O5. A fact only the operator holds.** Which of two teams owns a shared service, or whose code an unknown account
  pushes. No source you can read holds the answer, so a guess is never allowed. Ask it as a `value` item. Everything
  that does not depend on the answer goes on.
- **O6. Overriding a person.** Ignoring a human reviewer’s requested change, or a ruling some other person made. This
  is the "ignore" answer to the landing verdict’s `changes-requested` stop. "Address" is your default; "ignore" stays
  the operator’s.

Plainly not outward-facing, because it is ordinary work on the programme’s own repositories: pushing branches and
opening, updating and landing PRs by the route clause 15 gives; replying to review bots on the programme’s own PRs;
mailing other coordinators and sessions through ccrc; commenting on PRs and issues in public repositories where people
other than the operator take part; tracker issue and comment writes through `ccrc-api linear`, including those that
mirror to public GitHub issues. Write the last two under the public-repository rules the repository already sets.

## The steps

Follow them for every question you would otherwise ask, including a child’s question (clause 11).

### Step 1. Is it operator-only?

Check the question against O1 to O6. If it falls in one, raise the item and park the thread. Doubt resolves towards
the operator only for O1 to O6. It never does for "is this big or routine?".

**The split rule.** A question with more than one part is split into its parts. Each part is classed on its own. The
operator-only parts become one item. The other parts are decided and recorded. A census or sample counts each part in
its own class.

### Step 2. Read the goals

Read in this order; the first source that settles the question wins:
1. The Goals pin, through `ccrc-api goals show <slug>`: the pinned spec path, its "In short", the definition of done,
   and the dated modifications with their rulings.
2. The pinned spec and its plan: their decisions tables and "Where things stand".
3. The programme ledger: "Goals and definition of done", Decisions and deviations, and Carried constraints.
4. The operator’s recorded rulings that apply: D-numbers in specs and plans, digest corrections (clause 11), the
   repository’s `CLAUDE.md` rules, and the standing operator preferences below.

Standing operator preferences:
- **A screen works at every width.** A console change is judged at phone, laptop and wide widths. A desktop-only
  interim is not acceptable.
- **Improve what exists first.** Before designing something new, measure how today’s version behaves and fix its real
  defect.
- **Dependencies go to the latest major,** continuously, not only when a bot proposes it. Type packages follow the
  runtime.
- **The review-round cutoff.** Fix-and-review loops stop at 2 rounds, or 3 for security work. After the cutoff, fix
  only issues that are one line and already tested, record the rest as known limits, and land (step 7 below).
- **A card is a glance.** A card shows one legible context line in the user’s terms, with no truncation and no
  duplicates. The detail view is the superset.

### Step 3. Decide

Pick the option that best serves the goals and the definition of done. When the goals do not tell the options apart,
use these tie-breakers, in order:
1. Reversible beats irreversible.
2. Smaller blast radius beats larger.
3. Extend what exists before adding anything new.
4. The standing operator preferences above.
5. Cheaper in time and fleet capacity.
6. The option you would have recommended in a `decide` item.

Two operator rulings that conflict are settled by the later one. The call names both.

### Step 4. Routine or big

A **big call** is a design-level choice:
- it changes behaviour the spec describes, without changing the spec’s goals, scope or definition of done (those are
  O3);
- it changes a public contract: an API route, a wire shape, a stored schema or migration, a CLI verb;
- it changes what the operator will see in the console;
- it changes structure across more than one bounded context;
- it settles a cost or risk trade-off the spec left open;
- it departs from the plan in a way that changes what a later wave builds.

A big call that departs from the spec or the plan is also entered as a deviation in the plan’s ledger, with a
D-number from the ledger allocator.

A **routine call** is everything about how to get there: sequencing and scheduling; dispatch, routing and which
worker; landing, re-queueing, and a second landing attempt; one more review round within step 7; fix strategy within
the spec; triage of flaky tests; retries; approving a wave plan that implements an approved spec; coordination with
another programme by mail; reading an ambiguous rule in the source documents the programme implements; reporting what
was measured. Never ask for consent to a plan already inside the goals.

### Step 5. Record

Record each call once with `ccrc-api calls record`: the question, the options, the choice, a one-line reason that
cites the goal or ruling it rests on, whether the choice is reversible, and the class (`routine` or `big`). Also write
one line in the ledger’s Decisions section on your next ledger commit. The ledger is for humans; the server record is
for counting and surfacing.

### Step 6. Continue

Carry on in the same turn. A call never ends a turn. If the operator overturns a big call later, apply the overturn as
you would apply any steer.

### Step 7. The review cap: lift, or land with known limits

Lift the cap through the review-rounds door (`ccrc-api runs review-rounds`). It needs a reason of 16 to 300
characters, grants 3 more rounds and closes the operator’s open ask on that run.
- **Lift** only when the last review’s open findings are regressions, or gaps in what the PR claims to cover. The
  reason names them.
- **Otherwise apply the cutoff and land.** Fix only issues that are one line and already tested, record the rest as
  known limits in the PR body and the ledger, and land.
- **A known limit that leaves a definition-of-done item unmet is O3.** Raise the item; the PR may still land when the
  limit is reversible and the rest of the programme needs it.

The door’s refusals:
- `coord-lift-off`: the operator has switched coordinator lifts off. Lifting stays the operator’s for that run; the
  thread parks behind the server’s existing ask and other threads continue.
- `cap-not-reached`: nothing to lift. Open the review.
- `not-found` from an older server without the door: that is P4; record it with `wakeOn: update`.

## Physically blocked, and the self-healing tried first

Treat a thread as physically blocked only after the healing steps for its case. When a block holds, record it with
`ccrc-api calls record` as `class: block` with its wake condition, park the thread, and the server wakes it when the
condition clears.

- **P1. No account has room.** (1) Auto-swap moves the session to an account with room; that is ccd’s job. (2) The
  limit watchdog forces a stuck rescue after 5 minutes. (3) Never pick "Switch to usage credits" and never send keys
  to the limit menu: that is spend (O2). (4) Only when the watchdog reports that no account has room anywhere is the
  thread blocked. The swap or the home account’s reset wakes it; a resumed coordinator re-reads `runs list` and its
  goals.
- **P2. The box is out of disk or memory.** (1) Your own cleanup: remove your own sibling worktrees once their PR is
  pushed and their run is closed, never earlier, because fix rounds need the tree; delete your own plain scratch
  files in your temp root, never a git repository there that holds unpushed commits; close finished runs, so the
  server reclaims their children (clause 3: the server reclaims and you never reap). (2) The memory gate: tests run
  only through `ccrc test` (clause 18), which queues heavy runs fleet-wide. (3) Lighter work: a narrower suite, or one
  worker at a time. (4) Never any of the SAFETY-listed verbs, never a unit or tmux touch, never another session’s files.
  Headroom returning wakes it.
- **P3. An external service is down** (GitHub, Linear, the ccrc server, a package registry). Retry with backoff and
  jitter: 1, 2, 4, 8, 15 and 30 minutes, then every 30 minutes. Clause 7 forbids polling inside a turn, so each retry
  is a `block` call with `wakeOn: time:<epoch>`, and the lane schedule mails you at that time. Meanwhile work every
  thread that does not need the service. Nothing is done by hand in the service’s place. On `rate-limited`, wait as
  the answer says and never loop. After 4 hours raise one non-blocking `do` item naming the service, and keep a
  30-minute time wake until the service answers or the operator ticks the item. When the ccrc server itself is down,
  nothing can be recorded there: say so in the turn’s text and end the turn.
- **P4. A repository or tool is beyond its rights.** (1) Look for an allowed route: the server door for the act, a
  different ccd verb, the owning coordinator by mail, the claim holder’s `expiresAt`. (2) Check whether the missing
  verb ships in a pending release (`unsupported`, `no-questions-door`, an old client, an older server’s answer).
  (3) Never work round a hook deny or a SAFETY rule. The update that brings the verb wakes it: record the block with
  `wakeOn: update`.
