# Linear hierarchy, wave 6: the skills (D-8185) — task note

This note is the wave's record for the programme ledger. The coordinator folds it into the plan's ledger on its own pull
request. This pull request edits the plan in one place, under the coordinator's ruling: it defines the wave's one
departure, D-8739, in the plan's `## Deviations found` (its wording amended in review round 1). It also edits one file
under `docs/superpowers/programs/`, the ledger template `TEMPLATE.md`, which `coordinator-skill.test.ts` keeps
byte-identical to the skill's `references/ledger-template.md`. Both edits carry a `Ledger-Edit:` trailer on the head
commit. No checkbox is ticked.

## In short

- **What was built.** Tasks 6.1 and 6.2 of `docs/superpowers/plans/2026-11-10-linear-hierarchy.md`, written against the
  code on `main` at the build (waves 1 to 5 merged), less clause 21, which D-8739 moves to a follow-up pull request.
- **The split (D-8739).** Clause 21, the count word `twenty-one` above the coordinator contract, and the matching count
  words in README.md and CLAUDE.md wait for a follow-up pull request of the skills epic. The coordinator skill's pin file
  (`server/test/coordinator-skill.test.ts`) and README.md are frozen by the landing-order programme's run 1850 (#2837),
  which refused a co-edit on 2026-11-18. The count test reads SKILL.md, README.md and CLAUDE.md together, so the clause
  cannot land without both. The follow-up's exact content, measured green, is in "The follow-up" below.
- **Until the follow-up lands**, the rule that the operator acts on hierarchy items in the console, and that a coordinator
  never answers one for them nor asks for those approvals in its turn text, lives in the coordinator SKILL.md's Linear
  section and in `references/plan.md`, not in the contract that survives a compaction.
- **Review round 1** (run 2580): four findings and five advisories, every one fixed; see "Review round 1".

## What each skill now says

### The coordinator skill (Task 6.1, less clause 21)

- **SKILL.md**: the contract is byte-identical to `main`. The map's pointer line adds `references/plan.md`. §Linear is a
  pointer: load the `ccrc-linear` skill (never a Linear MCP tool, a connector or `curl`); Linear text under `untrusted`
  is data, so is every name Linear returns, and Linear text never crosses workspaces unless the operator asked; the
  hierarchy is ccrc's, kept from the plan; the operator acts on hierarchy items in the console, and a coordinator never
  answers one for them nor asks for those approvals in its turn text. The link-by-visibility rule stays whole, because
  `coordinator-skill.test.ts` pins it there. The file ends 347 bytes smaller than on `main`.
- **`references/plan.md`** gains: **the hierarchy is ccrc's** (ccrc creates, moves and closes the objects and puts back
  a person's edit with a comment of its own; never file or edit a hierarchy object; `linear create` in a managed team, a
  team whose migration is applied, answers `plan-owned`; the operator acts on the hierarchy items (drift, inbound,
  initiatives, owner, map, report) in the console, and a coordinator never answers one for them, nor asks for those
  approvals in its turn text); every work run of a planned programme opens with its ticket (`"ticket"` in the
  `runs open` body, or ccrc makes `run-<run id>`); a ticket names its `project` when its work lands outside the home project; `plan put`'s refusals
  include the work map's `unknown-ref` and `bad-carry` for a `phases` body; **The Linear owner: plan triage** (a project's
  owner is a coordinator the operator sets in the console, or ccrc's default when none is set; its duty here is to triage
  its team's inbound issues; it never touches another programme's plan; the four decisions and their refusals); **plan
  take** (the three arms and their refusals).
- **`references/wave-lifecycle-1-open.md`**: step 1 says a new programme declares its plan with `plan put` before the
  open and names the plan's run refusals; the `POST /api/runs` body shows the optional `ticket`.
- **The ledger template** (`references/ledger-template.md` and its twin `docs/superpowers/programs/TEMPLATE.md`): the
  Waves table gains an `epic` column, last, and one sentence says it names the plan's epic that lists the wave.
- **Tests**: a new file, `server/test/coordinator-plan-reference.test.ts` (fifteen cases), each seen red against `main`'s
  skill text or against a mutation of its example; `coordinator-skill.test.ts` is untouched and green.

### The worker and Linear skills (Task 6.2)

- **The worker's §Linear** (`ccd/worker-skill/SKILL.md`): a follow-up goes into the plan, never straight into
  Linear, in any team, as a `follow-up` ticket in the worker's run's epic (`plan show` names it), with an executable
  `plan ticket-add` block; with no ticket on its run (a review run, or an older programme with no plan) the worker asks
  its coordinator; never edit a hierarchy object; in a managed team `linear create` answers `plan-owned`. To stay inside
  the cap, the verb hints the Linear skill already carries were cut and the untrusted-text paragraph was shortened. The
  file ends one byte smaller than on `main`.
- **The Linear skill** (`ccd/linear-skill/SKILL.md`): **The hierarchy is ccrc's** (in a managed team, a team whose
  migration is applied, ccrc creates, moves and closes the hierarchy and puts back edits; a restore comment is ccrc's
  own; never edit one by hand; never `linear create` a hierarchy object or ticket there; change the plan instead). The
  `plan-owned` row points at it. To stay inside R5 (a SKILL.md with no contract may not grow), the intro's repeated
  sign-in sentence and the closing `--workspace` hint were cut, and the write paragraph was shortened. The file ends 47
  bytes smaller than on `main`.
- **Tests**: three cases in `server/test/worker-skill.test.ts`, each seen red against `main`'s skill text; the example
  body is parsed by the route's own `parsePlanTicketAdd`.
- **Caps**: no cap changes in this pull request; every skill file is under or at its cap and no larger than on `main`.

## Review round 1 (run 2580)

| Item | Ruling | Done |
|---|---|---|
| F1 | the console-only rule where a coordinator reads it | One sentence in the coordinator SKILL.md's Linear pointer, pinned in the new file; D-8739 and this note now say the rule lives there and in `plan.md`. |
| F2 | the worker's follow-up rule, conditioned (superseded by round 2's F1) | "In a managed team"; a run with no ticket (a review run, or an older programme with no plan) asks its coordinator. Paid for inside the section; the pin moved with the text, seen red on the old wording. |
| F3 | a managed team is a team whose migration is applied | The Linear skill and `plan.md` define it so (design §7.1, `managedTeams`), pinned in both test files. |
| F4 | the follow-up package carries the caps hunk and is measured | Added (coordinator cap 23580 to 23872, the measured size); the pin file's last hunk keeps only its clause case; measured green below. |
| A1 | `unknown-ref` and `bad-carry` | Named in `plan put`'s refusal list (a `phases` body), and dropped from `NOT_MET`. |
| A2 | the two dropped Linear rules | One sentence in the coordinator SKILL.md's Linear pointer, pinned. |
| A3 | the owner's duty sentence | "Its duty here is to triage its team's inbound issues", pinned. |
| A4 | a ticket names its `project` | One sentence in `plan.md`'s `plan put` section, pinned. |
| A5 | the triage and take example bodies | Parsed by `parsePlanTriage` and `parsePlanTake` in the new file (seen red on a mutated `decision` and a mutated `why`); `ticket-done` stays in `WORK_MAP_VERBS`, with the reason in its comment: WM1's row (#2997), not on `main` yet, listed so its landing does not red this file before WM5 documents it. |

## Review round 2 (run 2590)

| Item | Ruling | Done |
|---|---|---|
| F1 | the worker's follow-up rule holds in any team (design §12, ruling 29; plan Task 6.2), correcting round 1's F2 | "A follow-up goes into the plan, never straight into Linear", "in any team"; the no-ticket case (ask your coordinator) stays; "managed team" now conditions only the `plan-owned` refusal. Paid for inside the section (one byte smaller than before); three pins moved, each seen red on the round 1 wording. No departure: this is the plan's text. |
| A1 | only a work run of a planned programme opens with a ticket | `plan.md`: "Every work run of a planned programme opens with its ticket" (`openRun.ts` gives a review run none, and an older programme opens with none); the pin moved, seen red on the old wording. |
| A2 | the follow-up's caps hunk, said as measured | D-8739 and this note: the hunk sets the coordinator cap to the file's measured size with clause 21 (23872); this PR shrinks the file below `main`'s cap first, so the cap moves by 292 bytes, less than the clause's 639. |

Not taken: naming `plan met` and `plan close` in the final-merge and boundary steps (a split vote); clause 21's follow-up
carries them.

## Differences from the plan's text

| Plan text | Built | Why |
|---|---|---|
| Task 6.1: clause 21 and its pin in this PR | moved to a follow-up PR (D-8739) | The pin file and README are frozen by run 1850 (#2837). |
| Task 6.1's tests in `coordinator-skill.test.ts` | in `coordinator-plan-reference.test.ts` | The same reason. |
| Task 6.1: "`skill-size-caps.json` (raised by clause 21's bytes only)" | not changed here; in the follow-up's package | No clause in this PR; every file shrank or kept its size. |
| Task 6.2: "`ccrc-api-closed.test.ts` (the worker's `plan ticket-add` block joins its pinned list)" | not changed | `plan.ticket-add` is already in the list, from `references/plan.md`; the census is a set of keys. |
| Task 6.1: "`references/plan.md` names `ticket-required` once WM6 has landed" | not written here | That line is #3001's (desktop-polish WM1r), as the brief rules. |
| Task 6.1: "the ledger template's waves table has an epic column" | the column is LAST | `reconstruction-drill.test.ts` documents a reading of scope, PRs and state as the first three columns after `#`. |
| "names every plan verb registered by wave 6" | every `plan.*` row but the work map's (`phase-ref`, `ticket-done`) | The work map's WM5 writes its own verbs into `references/plan.md`. |
| "every PLAN_REFUSALS word a coordinator meets" | every word but five, each named with where it is answered: `map-rewrites-plan`, `map-incomplete`, `migration-in-flight`, `not-managed` (wave 7), `item-act-mismatch` (the console) | A word added to `PLAN_REFUSALS` later reds the test until `plan.md` names it or the table says where it is answered. |

## Consents

- Run 2459 (CLAUDE.md, claim 5081): yes to the one count word (2026-11-18). It covers the follow-up only if still current then.
- Run 2538 (skill size caps, claim 5099): no clash; not edited in this PR. This wave consented to run 2538's three
  worker-skill hunks and its worker pin literals under this wave's claim 5157 (disjoint from the Linear section).
- Run 2481 (the closed-client pin file, claim 5039): no clash; not edited.
- Run 1850, through its relay (the coordinator pin file, claim 5136, and README.md, claim 4953): recorded an exact
  package of eight pin-file hunks and one README hunk and refused consent on all nine (2026-11-18).
- Run 2245 (#2919, the recall clause): the second to land renumbers its clause (21 or 22), moves the count word on and
  merges `main` once; this wave's clause is now the follow-up's, so the same rule binds the follow-up.

## The follow-up (D-8739)

One commit, all five patches together: the SKILL.md clause line and count word, the size-caps hunk that sets the
coordinator cap to the file's measured size with the clause (23872; this pull request shrank the file below `main`'s cap
first, so the cap moves by less than the clause's bytes), the pin file's hunks,
and README's and CLAUDE.md's one word each. The SKILL.md and caps patches are against this pull request's files; the
pin-file, README and CLAUDE.md patches against `main` commit 21d136c9c23af977aa19570bba6d9e245b2a8cb6, where those three
files are as on this pull request. The pin-file patch differs from the package run 1850 recorded in one place only: its
last hunk keeps only the clause case ("is the twenty-first clause…"), without the six cases that now live in
`coordinator-plan-reference.test.ts` and without their `PLAN_REFUSALS` import. If #2919 lands first, the clause is 22, the
count words are `twenty-two`, and the pin file's comment, count-word list and harvest regexes are already on `main`.
Rebuild each hunk against the follow-up's own base and send the holder a fresh exact request.

**Measured (review round 1):** all five applied cleanly to a scratch copy of this round's tree; the coordinator, worker
and reviewer skill pins, `coordinator-plan-reference.test.ts` and the size ratchet (R1 to R6, against `origin/main`) ran
green, 440 tests, with the coordinator file at 23872 bytes, equal to its new cap.

SKILL.md:

```diff
--- a/ccd/coordinator-skill/SKILL.md
+++ b/ccd/coordinator-skill/SKILL.md
@@ -13,7 +13,7 @@
 
 ## The contract
 
-These twenty sentences are the boundary between "a coordinator" and "an agent
+These twenty-one sentences are the boundary between "a coordinator" and "an agent
 with a shell on the fleet host". They are not advice.
 
 1. Every act that changes fleet state goes through the ccrc server HTTP API. This session never runs `ccd` to change fleet state.
@@ -36,6 +36,7 @@
 18. A workflow script, a worker brief or a test step never sets `TMPDIR` to a path inside a work tree and never writes scratch inside one: it uses the temp root this session was started with (`TMPDIR`, or `CCRC_SESSION_TMPDIR` where `TMPDIR` has been overridden). Long command output goes to a file there, or through `tail`, never into the work tree. Work, scratch repositories, reports and build output never go under the `projects/` transcript folders of a Claude config dir (`~/.claude*/projects/`): they belong in the workspace or in that temp root. Every test and typecheck runs through `ccrc test -- <command>` (for example `ccrc test -- npx vitest run --maxWorkers=2 test/foo.test.ts` or `ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json`), which runs it in the fleet test slice and queues heavy runs fleet-wide; never run one bare, and never under a `systemd-run` of your own, which the session hook denies.
 19. Workflows are not a default. This session launches a workflow only for short, self-contained work that needs nothing from its own children and finishes in minutes: a review, a verification or an audit, or at least three independent items worth running in parallel. Each such workflow carries a time cap, its agents run at `medium` effort, and its vitest runs pass `--maxWorkers=2`. Nobody uses a workflow for a mechanical edit: a D-number substitution, a PR body edit, a rebase or a re-pin. This session never holds its turn open on anything that waits for its own children: it dispatches, ends its turn, and wakes on mail. Mail to a coordinator is held while it reads busy or waiting, so child mail has sat undelivered for hours behind a background workflow that died still reading busy and behind an operator question left open overnight. While any child is active, this session asks the operator in its closing turn text and ends the turn, never with an AskUserQuestion dialog, which reads waiting and holds every child mail behind it (`POST /api/mail` takes no `operator` recipient), and it never leaves a blocking question open while a child waits. A background workflow that stops, for any reason, is a wake: on its task notification, read the held mail (`GET /api/mail?to=<your id>`) in that turn.
 20. The operator's own work is on the Waiting-on-you list. As soon as this session can see the operator will be needed, it raises an item with `ccrc-api items raise`, saying what, how and why, and a `decide` item names the option this session recommends and why it beats each alternative, a link to a document is its repository path, which the console opens in the Docs reader, never an artifact page or another document server, and it sets the item blocking only when work has stopped on it. A question this session asks the operator in its closing turn text is raised as an item too. When the operator ticks an item, this session re-measures the result before `ccrc-api items confirm`, and if the result does not hold it returns the item with what it found. A secret never reaches this session: it asks for one with a `secret` item and reads only whether it is set. When the operator approves a spec, this session pins it with `ccrc-api goals pin` and raises an item for each open point in the spec's own "Waiting on you" box. Whenever the operator steers, this session rewrites the spec on its ledger PR, records the change with `ccrc-api goals modify`, and marks it with `ccrc-api goals merged` once that PR reads MERGED.
+21. A new programme's plan is declared with `ccrc-api plan put` before its first run opens: epics plan-sized, each with its waves when it runs in waves, checkpoints as the gates inside them; every run opens with its ticket; a met checkpoint is recorded with `plan met` and its evidence; the programme ends with `plan close`; this session never files or edits a hierarchy object, and never files a ticket in a managed team with `linear create`. The operator acts on hierarchy items in the console: this session never answers a drift, inbound, initiatives, owner, map or report item, and never asks for those approvals in its turn text.
 
 ## Where the procedures live
 
```

`server/test/skill-size-caps.json`:

```diff
--- a/server/test/skill-size-caps.json
+++ b/server/test/skill-size-caps.json
@@ -1,6 +1,6 @@
 {
   "files": {
-    "ccd/coordinator-skill/SKILL.md": 23580,
+    "ccd/coordinator-skill/SKILL.md": 23872,
     "ccd/history-skill/SKILL.md": 10677,
     "ccd/linear-skill/SKILL.md": 11354,
     "ccd/overlord-skill/SKILL.md": 4503,
```

The coordinator pin file:

```diff
--- a/server/test/coordinator-skill.test.ts
+++ b/server/test/coordinator-skill.test.ts
@@ -113,7 +113,7 @@
   return out.join('\n');
 };
 
-// The twenty clauses, verbatim. Kept as a literal array rather than a regex per
+// The twenty-one clauses, verbatim. Kept as a literal array rather than a regex per
 // clause: the point is that the SENTENCE is the contract, so a paraphrase must
 // fail exactly as a deletion does.
 //
@@ -160,10 +160,13 @@
   // Programme ledgers PL7 (D-7715), operator-approved text. Its two apostrophes are straight, in `operator's` and `spec's`; its two
   // double quotes are escaped here and typed straight in SKILL.md.
   "The operator's own work is on the Waiting-on-you list. As soon as this session can see the operator will be needed, it raises an item with `ccrc-api items raise`, saying what, how and why, and a `decide` item names the option this session recommends and why it beats each alternative, a link to a document is its repository path, which the console opens in the Docs reader, never an artifact page or another document server, and it sets the item blocking only when work has stopped on it. A question this session asks the operator in its closing turn text is raised as an item too. When the operator ticks an item, this session re-measures the result before `ccrc-api items confirm`, and if the result does not hold it returns the item with what it found. A secret never reaches this session: it asks for one with a `secret` item and reads only whether it is set. When the operator approves a spec, this session pins it with `ccrc-api goals pin` and raises an item for each open point in the spec's own \"Waiting on you\" box. Whenever the operator steers, this session rewrites the spec on its ledger PR, records the change with `ccrc-api goals modify`, and marks it with `ccrc-api goals merged` once that PR reads MERGED.",
+  // Linear hierarchy wave 6 (D-8185): the plan clause, as the plan's Task 6.1 amends it, with the operator's console rule.
+  // Its one apostrophe is straight, in `programme's`; no quote.
+  "A new programme's plan is declared with `ccrc-api plan put` before its first run opens: epics plan-sized, each with its waves when it runs in waves, checkpoints as the gates inside them; every run opens with its ticket; a met checkpoint is recorded with `plan met` and its evidence; the programme ends with `plan close`; this session never files or edits a hierarchy object, and never files a ticket in a managed team with `linear create`. The operator acts on hierarchy items in the console: this session never answers a drift, inbound, initiatives, owner, map or report item, and never asks for those approvals in its turn text.",
 ];
 
 describe('the coordinator skill: its contract', () => {
-  it('carries all twenty clauses verbatim', () => {
+  it('carries all twenty-one clauses verbatim', () => {
     for (const clause of CONTRACT) {
       expect(skill, `missing contract clause: ${clause.slice(0, 48)}…`).toContain(clause);
     }
@@ -233,7 +236,7 @@
    *  corpus spells out in prose three times (SKILL.md, README.md, CLAUDE.md). */
   const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
     'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
-    'eighteen', 'nineteen', 'twenty'];
+    'eighteen', 'nineteen', 'twenty', 'twenty-one'];
   const COUNT_WORD = WORDS[CONTRACT.length];
 
   it('numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps', () => {
@@ -258,7 +261,7 @@
     // wrong word named rather than with a missing string. The filter against
     // WORDS is what keeps a stray "protocol sentences" (SKILL.md's own clause
     // 5 discussion) from counting as a hit.
-    const stated = [...skill.matchAll(/\b([a-z]+) (?:clauses|lines|sentences)\b/g)]
+    const stated = [...skill.matchAll(/(?<![a-z-])([a-z]+(?:-[a-z]+)?) (?:clauses|lines|sentences)\b/g)]
       .map((m) => m[1]!).filter((w) => WORDS.includes(w));
     expect(stated.length, 'SKILL.md no longer states its own clause count in prose')
       .toBeGreaterThanOrEqual(1);
@@ -274,7 +277,7 @@
       const text = readFileSync(path.join(root, rel), 'utf8');
       let hits = 0;
       for (let i = text.indexOf(marker); i >= 0; i = text.indexOf(marker, i + 1)) {
-        const m = /\b([a-z]+)\s+clauses\b/.exec(text.slice(i, i + 160));
+        const m = /(?<![a-z-])([a-z]+(?:-[a-z]+)?)\s+clauses\b/.exec(text.slice(i, i + 160));
         expect(m, `${rel} names ${marker} without stating how many clauses it has`).not.toBeNull();
         expect(m![1], `${rel} says ${m![1]} clauses where the CONTRACT pins ${CONTRACT.length}`)
           .toBe(COUNT_WORD);
@@ -648,7 +651,7 @@
   const CLAUSE_17 = CONTRACT[16]!;
 
   it('is the seventeenth clause, and SKILL.md numbers it so', () => {
-    expect(CONTRACT).toHaveLength(20);
+    expect(CONTRACT).toHaveLength(21);
     expect(CLAUSE_17.startsWith('Before delegating, declare coordinator intent for this session with ')).toBe(true);
     expect(skill).toContain(`\n17. ${CLAUSE_17}\n`);
   });
@@ -4599,6 +4602,21 @@
   });
 });
 
+// Linear hierarchy wave 6 (D-8185, plan Task 6.1; the follow-up of D-8739): clause 21, the plan clause. What the plan
+// reference, the open step and the ledger template say is pinned in `coordinator-plan-reference.test.ts`.
+describe('the coordinator skill: clause 21, the plan (D-8185)', () => {
+  const CLAUSE_21 = CONTRACT[20]!;
+
+  it('is the twenty-first clause, SKILL.md numbers it so, and every verb it names has a client row', () => {
+    expect(skill).toContain(`\n21. ${CLAUSE_21}\n`);
+    const keys = clientRoutes().map((r) => r.key);
+    for (const verb of ['plan.put', 'plan.met', 'plan.close', 'linear.create']) expect(keys, verb).toContain(verb);
+    for (const word of ['drift', 'inbound', 'initiatives', 'owner', 'map', 'report']) expect(CLAUSE_21).toContain(word);
+    expect(CLAUSE_21).toContain('in the console');
+    expect(CLAUSE_21).toContain('never asks for those approvals in its turn text');
+  });
+});
+
 describe('landing order wave 5h: the worker-starting re-run beside an intent-held answer (review 1660, A1)', () => {
   it('the intent-held row of the dispatch reference says the first pass may already have started or woken the pane', () => {
     const row = flat(readFileSync(path.join(skillDir, 'references', 'wave-lifecycle-2-dispatch.md'), 'utf8'));
```

README.md:

```diff
--- a/README.md
+++ b/README.md
@@ -4909,7 +4909,7 @@
 replacement for them, and a lost `coord.db` reconstructs from them.
 
 **The skill's contract.** A coordinator is an ordinary fleet session running
-the `ccrc-coordinator` skill (`ccd/coordinator-skill/SKILL.md`), and its twenty
+the `ccrc-coordinator` skill (`ccd/coordinator-skill/SKILL.md`), and its twenty-one
 clauses are pinned verbatim by `server/test/coordinator-skill.test.ts` — a
 softened clause is a red suite, not a silent drift. **A worker is the same
 shape:** the `ccrc-worker` skill (`ccd/worker-skill/SKILL.md`), twenty clauses,
```

CLAUDE.md:

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -706,7 +706,7 @@
   (`resolveCoordinator(runId)` reads that run's `claimedBy`, no program-state predicate) — which is the
   documented recovery for an already-retired program.
 - The coordinator is an ordinary fleet session running the `ccrc-coordinator` skill
-  (`ccd/coordinator-skill/SKILL.md`); its twenty clauses are pinned VERBATIM by
+  (`ccd/coordinator-skill/SKILL.md`); its twenty-one clauses are pinned VERBATIM by
   `server/test/coordinator-skill.test.ts` — a softened clause is a red suite. Pause kill-switches are FILES
   (`$REG/coordinator-paused`, `$REG/mail-disabled`). `mail-disabled` has **no writer in the tree** — touch/rm by
   hand only. `coordinator-paused` does: Build 4's whitelisted `ccd coord-pause --state on|off`, driven by
```

## For #3021 (the wave 4 follow-ups)

`no-linear-owner` is an item-act refusal, not a `PLAN_REFUSALS` word, so the plan reference's test needs nothing from
#3021. For a coordinator's sake, `references/plan.md` should then say: "`plan take` and `plan triage` are refused
`capability-missing` by the client when the server does not advertise `plan-inbound-v1`; an issue that left the managed
teams is retired `moved-out` and answers `issue-not-inbound`." Whoever lands second writes it.
