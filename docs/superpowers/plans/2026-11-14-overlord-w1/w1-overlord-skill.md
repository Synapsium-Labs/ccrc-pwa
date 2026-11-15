# Overlord W1: the `ccrc-overlord` skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the tree ships a fourth role skill, `ccrc-overlord`, in `ccd/overlord-skill/`. Its `SKILL.md` carries the
Overlord's contract: the twenty-two clauses of spec §11.3, verbatim, under `## The contract`, numbered `1..22`, behind
the compaction notice, with the whole file inside the 5,000-token restore budget. Its four references carry the
procedures: `routing.md`, `answering.md`, `starting.md` and `operator-model.md`. A pin suite holds the clauses, the
count word, the frontmatter, the references and the file's size. `ccrc update`'s install spine puts it in every
rostered home, doctor's skills check measures and cures it, `deploy.sh`'s fallback ships it, and the session hook's
role-skill deny keeps a subagent from loading it.

**Why:** the Overlord is a Claude Code session, and its contract is what it re-reads after a compaction or a renewal.
The skill is the only W1 piece that needs nothing first: it is text and tests, it ships whole (§11.3: "It ships whole
in W1"), and every door it names that does not exist yet answers `capability-missing` with its wave's word. Landing it
early lets every other W1 piece cite its clauses by number, and lets the sandbox piece measure that the skill loads.

**Architecture:** no server, agent or PWA code. One skill directory (Markdown), one installer (bash, a copy of the
reviewer's shape with a references guard), one new pin suite and one new installer suite under `server/test/`, one
cap entry, and one-word additions to each hand-kept skill list (the install spine, account provisioning and
uninstall, doctor's check and fix, the deploy arm, the role-skill deny) with the fixtures and pins that name them.
Nothing is decided at run time, so no L1 decider is added and no `MUTANT_SETS` entry is needed. Each new guard is
proved by a mutation step that turns its test red.

**Tech Stack:** Markdown, bash (`ccd/ccrc`, `ccd/ccrc-doctor-checks`, `ccd/session-hook.sh`, the installer,
`deploy/deploy.sh`), vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §11.3 (the twenty-two clauses, the four references,
"Small enough to survive a compaction", "The contract comes first", "The constitution rides elsewhere", "Enabled by
one profile", "It ships whole in W1"), §3.3.3 ("The skill stays small"), §3.1 ("No Overlord from below": its first
step checks the board, which answers 403 to anyone else), §3.5 and §3.6 ("The role-skill deny"; brain work only; no
command tool in the main thread), §5.3 (the routing procedure, Figure 4), §6.3 (C18 to C21, H21, H34: the answering
procedure), §6.6 (C58, the decision brief), §6.8 (the inbox's order), §9.1 and §9.2 (how entries are read and fed),
§11.2 (the gate order, for the refusal table), Table 11.1d (the capability words), Table 11.6 (the refusal words),
§14 ("The skills ship whole"). Table 13.1 has no `shape` call that this piece creates a table or a door for: H1's
"`ccrc-overlord` alone" belongs to the launch profile, and H9's door process to its own piece.

**The index:** `docs/superpowers/plans/2026-11-14-overlord-w1.md` (PR #2814), row "`ccrc-overlord` skill", lane G.

## Open questions

Each carries a recommendation, which this plan builds unless the coordinator or the operator rules otherwise. The
index's questions 1 to 29 touch this piece in one place only: question 2 (`coordinator-clauses-by-name`) is the
Overlord clause's, a separate later piece, and nothing here numbers a coordinator clause.

1. **Where the skill is installed** (slug `overlord-skill-in-every-home`). `ccd/ccrc#_inst_skills` puts every role skill
   in every rostered home, so every session on the fleet box can see `ccrc-overlord` in its skill list. The spec
   accepts that: "Only the `overlord` launch profile enables the skill", and outside the designated session "it
   refuses to act: its first step checks `GET /api/overlord/board`, which answers 403 to anyone else" (§3.1). The
   profile also "loads nothing from that directory but the sign-in" (§3.6), so the Overlord itself may not read the
   home's copy at all. **Recommendation:** install it like every role skill, as the brief says, so doctor measures one
   set and `ccrc update` converges one set. The skill's own first step makes a stray load harmless (Task 2,
   `starting.md`). How the Overlord's own launch reaches the skill (a home, the staged tree at
   `~/.cc-sessions/overlord-skill`, or a source the profile names) is the sandbox piece's call (`w1-sandbox.md`), and
   its start report lists the skills the session loaded. This plan ships the tree that piece reads.
2. **How the skill names a door** (slug `skill-names-doors-by-verb`). The Overlord has no command tool: its doors are
   typed tools the door process serves (§3.6), and the door-process piece names the tool list (index question 13).
   **Recommendation:** the skill names each door by its `ccrc-api` verb (`card`, `probe`, `note add`, `inbox`,
   `messages`, `acknowledge`, `board`, `history`, `timer set`), in one table in `references/starting.md`. The door
   process serves each verb as a tool of that name, so the skill and the door process share one vocabulary, and the
   door-process piece adds the cross-check against its tool list in its own pull request. The skill never shows a
   shell command, which a test holds (Task 1).
3. **Clause 8 before `model-write` exists** (slug `preference-waits-for-model-write`). Clause 8 says "Record every
   preference the operator states, at once, citing the message", and the write door is W4's (`overlord-learn-v1`).
   **Recommendation:** no stand-in carrier. `operator-model.md` says to call `model-write` and, on
   `capability-missing`, to do nothing more: the operator's message is already a server row of `operator_messages`,
   and W4's distillation reads that feed from its start (Figure 7, feed S2). A note would be a second, untrusted copy
   of the operator's words (§3.3.2), which H7 forbids.
4. **The README and `CLAUDE.md` lines** (slug `overlord-skill-prose-in-readme-only`). Each role skill has a `CLAUDE.md`
   bullet that states its clause count, pinned by its suite. **Recommendation:** this piece adds the README paragraph
   and updates the README sentence on role skills that `history-skill.test.ts` pins, and leaves `CLAUDE.md` alone.
   The skill acts only under `overlord-v1`, so its `CLAUDE.md` bullet lands with the `overlord-v1` piece, which then
   adds the bullet to the count-word scan of `overlord-skill.test.ts`.
5. **Whole-file size** (slug `overlord-skill-whole-file-bound`). The ratchet holds the contract's end within 16,000
   bytes and stops growth. §3.3.3 and §11.3 also say the `SKILL.md` as a whole "stays under 5,000 tokens".
   **Recommendation:** the pin suite asserts the whole file is at most 16,000 bytes, the ratchet's
   `CONTRACT_BUDGET_BYTES` at the same 3.2 bytes a token. A later clause that would cross it moves prose to a
   reference first.

## What exists today

Measured on `origin/main` at `416b8f942`.

- **Role skills.** `ccd/coordinator-skill/`, `ccd/worker-skill/` and `ccd/reviewer-skill/`, each with frontmatter of
  exactly `name` and `description`, a title, a bold notice ending "load this skill again", then `## The contract` as
  the first `## ` section, then `## Notes on the contract` with an editing note (D-104: straight apostrophes, no double
  quote inside a clause). `ccd/history-skill/` and `ccd/linear-skill/` are skills without a contract. Sizes: the
  coordinator's `SKILL.md` 23,580 bytes, the worker's 35,581, the reviewer's 15,025.
- **Pin suites.** `server/test/reviewer-skill.test.ts`, one `describe('the reviewer skill: its contract')`: a
  non-exported `CONTRACT` array of double-quoted literals; "carries all ten clauses verbatim"; "numbers exactly as many
  clauses as the CONTRACT pins, 1..N with no gaps" (`/^(\d+)\. /gm`); "spells that same count, as one derived word,
  everywhere prose states it" (`WORDS`, `COUNT_WORD = WORDS[CONTRACT.length]`, and a scan of `README.md` and
  `CLAUDE.md` for `<word> clauses` within 160 characters of each mention of the file); a references-layout case; and
  the frontmatter case. No shared helper module: each suite reads its own `SKILL.md`.
- **The size ratchet.** `server/test/skill-size-ratchet.test.ts` with `server/test/skill-size-caps.json`. Its corpus is
  every path matching `SKILL_FILE` (`^ccd/[^/]+-skill/SKILL\.md$`) from `git ls-files --cached --others
  --exclude-standard`, so a new `SKILL.md` is picked up untracked. R1: every `SKILL.md` has a cap. R3: a cap new on
  this branch equals its file's size. R6 (`contractPlace`): the contract is the first `## ` section, `CUT_NOTICE`
  stands before it, and it ends within `CONTRACT_BUDGET_BYTES` (16,000). A `SKILL.md` new on the branch earns no
  clause allowance. Reference files are not capped.
- **The install spine.** `ccd/ccrc#_inst_skills` loops `coordinator-skill worker-skill reviewer-skill history-skill
  linear-skill`: `_inst_tree_copy` into `$HOME/.cc-sessions/<name>`, `_inst_atomic` of `ccd/install-<name>.sh`, then
  runs it, and echoes the list of `ccrc-*` names. It returns at once on a server-role box. The coordinator goes first
  because the worker and the reviewer point into its `references/`.
- **The installers.** `ccd/install-reviewer-skill.sh` and its siblings take `--homes <dir>…` or loop the roster from
  `~/.ccrc/accounts.sh`, read `SRC="${CCRC_SKILL_SRC:-…}"`, check `REQUIRED_FILES=(SKILL.md)`, skip a converged home
  (`diff -r -q`), stage with `cp -a`, back up to `~/ccrc-backups/<ts>`, swap with `mv`, and roll back on failure. Only
  `ccd/install-coordinator-skill.sh` carries `REQUIRED_REFS`, which `wrapper-roster-fixture.test.ts` (its I8
  describe) holds equal to the real `references/` directory in both directions.
- **Account provisioning and uninstall.** `ccd/ccrc#_acct_provision` loops a literal installer list and reports
  `provisioned:[…]` (pinned by `account-markers-pin.test.ts` and `ccrc-account.test.ts`);
  `ccd/ccrc#_acct_unprovision` loops the installed `ccrc-*` names (pinned by `ccrc-account.test.ts`);
  `ccd/ccrc#_uninst_cc_sessions` removes each installer and skill tree, and echoes "the five skill trees" (pinned by
  `ccrc-uninstall.test.ts`).
- **Doctor.** `ccd/ccrc-doctor-checks#_check_skills` checks each tree exists and each home's copy matches it
  (`diff -r -q`), with a PASS line naming the five skills and a FAIL remedy spelling each installer;
  `ccd/ccrc-doctor-checks#_fix_skills` is the `--fix` path. Pinned by `ccrc-doctor-fleet-box.test.ts` and by
  `ccrc-doctorFixture.ts#SHIPPED_SKILLS`.
- **The deploy fallback.** `deploy/deploy.sh`'s agent arm ships each skill in four lines (`mkdir`, `rsync --delete`,
  `install_atomic` of the installer, run it), coordinator first. Each installer suite finds the rsync by the first
  line spelling `<name>-skill/`, so no comment in that arm may spell it. `agent/test/deploy-verify.test.ts` holds a
  table of run lines, and `install-census.test.ts` requires `ccrc install` and `deploy.sh` to place the same paths.
- **Fixtures that name each skill tree.** `server/test/installTreeFixture.ts` ("five SKILL TREES and their five
  installers"), `server/test/laneStateFixture.ts`, `ccrc-install-landing.test.ts`, `ccrc-install-tree.test.ts`.
- **Relation suites.** `install-linear-skill.test.ts`'s describe "every hand-kept skill-name site that names
  ccrc-history also names ccrc-linear" reads seven sites by function body (`_acct_provision`, `_acct_unprovision`,
  `_inst_skills`, `_uninst_cc_sessions`, `_check_skills`, `_fix_skills`, the deploy arm), and
  `install-history-skill.test.ts` holds the same for history.
- **The role-skill deny.** `ccd/session-hook.sh` sets `ROLE_SKILLS="ccrc-worker ccrc-reviewer ccrc-coordinator"` under
  the comment block "THE ROLE-SKILL DENY (D-4934)", and denies a subagent's `Skill` call whose name matches one, exactly
  or behind one `<ns>:` prefix. `server/test/session-hook-role-skill-deny.test.ts` builds its expectation from a literal
  `SKILL_FILES` map of three entries, read against each `SKILL.md`'s `name:`. The README sentence "None of the three
  role skills (`ccrc-coordinator`, `ccrc-worker` and `ccrc-reviewer`; not `ccrc-history`) is a subagent's to load" is
  pinned by `history-skill.test.ts`.
- **Corpus scans over skill text.** `ccrc-api-closed.test.ts` (`corpusFiles`, every executable `ccrc-api` example in
  the skill directories maps to a route row), `dead-coordinator-prose.test.ts` and `expiry-lane-prose.test.ts` (no
  skill names a live-lane marker) each read a hand-kept list of skill directories. `ccd-ws-lease-mark-argv.test.ts`
  lists `ccd/*-skill` itself.
- **Shellcheck.** `server/test/shellcheck-baseline.json` has one row per shell file, so a new installer needs one.
- **Growth check.** `server/test/growthCheck.ts#GROWTH_FILES` lists `ccd/ccrc`, `ccd/session-hook.sh` and
  `ccd/ccrc-doctor-checks` (40 net code lines a file a pull request; comments are free). `deploy/deploy.sh` and new
  files are not listed.
- **Nothing names the skill yet.** `shared/fleetRoles.ts#FLEET_ROLES` has an `overlord` row with no skill column, and
  `ccd/lib/launch-profiles.json` has no skill field. `server/src/skillstate.ts` names the worker, coordinator and
  reviewer skill directories only, for the dispatch preflight, and the Overlord is never dispatched.

## Global Constraints

- **Architecture (`CLAUDE.md`).** No runtime code, so no ring. Consolidate: the installer is a copy of the reviewer's
  shape, not a new mechanism, and every skill list gains a word rather than a second list. A guard ships with a test
  that goes red without it, measured.
- **Clause text.** Each clause is the §11.3 text verbatim, joined onto one line, after `N. `. Straight apostrophes
  only, no double quote inside a clause (the pin's literals are double-quoted). The pin suite and `SKILL.md` carry the
  same bytes.
- **Brain work only (§3.5, C48).** The skill's text never shows a shell command, a `ccd` verb or a repository write. It
  names doors by their `ccrc-api` verb (open question 2). The SAFETY rules bind it through clause 11, not by being
  copied in.
- **The constitution is not here.** What the Overlord is, each ruling in one line and the anti-goals ride the workspace
  memory file the launch profile ships (§11.3, the sandbox piece). The skill holds the clauses and the procedures, and
  points at the constitution once.
- **Untrusted text.** The references teach that what the Overlord reads is data (clause 15), and that only operator
  messages, grants and the server's rows carry authority. They quote no operator words and no fleet content.
- **Every later door is marked.** Each reference names the capability word of each door it uses (Table 11.1d), so a
  `capability-missing` answer reads as expected, never as a fault.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds
  `ccrc test -- ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`. Fixture HOMEs only for the installer
  suite (`mkTmp` from `server/test/tmpHelpers.ts`, with `seedAccountsSh` for the roster case, as
  `install-reviewer-skill.test.ts` builds them), never the live `$HOME`.
- **Growth check.** `ccd/ccrc`, `ccd/session-hook.sh` and `ccd/ccrc-doctor-checks` each grow at most 40 net lines (the
  estimates are in the PR split).
- **Public repository.** No private names in the skill text, the fixtures or the commits. Fixtures use `lane-a`,
  `project-a`. Cite code by symbol or `#@anchor`, never by line. No D-number is invented: departures are slugs, listed
  below, and the coordinator mints numbers.

## Review Focus

1. **The clauses are §11.3's, byte for byte, and the file numbers exactly `1..22`.** A clause softened, reordered or
   wrapped onto two lines is a red suite. Test: Task 1's verbatim and numbering cases.
2. **The contract survives a compaction.** It is the first `## ` section, behind the notice, ending inside 16,000
   bytes, and the whole file is inside 16,000 bytes. Test: the ratchet's R6, and Task 1's whole-file case.
3. **A session that is not the Overlord does nothing.** `starting.md`'s first step stops a session that has no door
   tools, or whose board read answers `not-the-overlord` or `capability-missing`. Test: Task 2's ordered-steps case.
4. **No shell in the skill.** No fenced shell block, no `ccd ` verb, no `git`/`gh` write verb anywhere under
   `ccd/overlord-skill/`. Test: Task 1's and Task 2's brain-work cases.
5. **Every hand-kept skill list names it, and doctor cures a home that lost it.** Test: Task 3's relation case and its
   doctor case.
6. **A subagent cannot load it, and the main thread can.** Test: Task 4's deny cases.

## The PR split

| PR | Tasks | What it ships | Needs first | Growth-checked files, estimate |
|---|---|---|---|---|
| One | 1 to 4 | The skill, its references, its pin and cap, its install through every list, the role-skill deny | nothing: **ready to build** | `ccd/ccrc` about +1 (one word in each of four loops, one echo); `ccd/ccrc-doctor-checks` about +2 (one word in each loop, one more remedy clause); `ccd/session-hook.sh` 0 (one word); `ccd/overlord-skill/SKILL.md` new, its cap equal to its size at merge (R3), about 9,000 to 12,000 bytes |

`deploy/deploy.sh` grows four lines and is not growth-checked. The new installer and the two new suites are new files,
which the growth check does not list.

**Order inside the PR.** Task 1 first, so the ratchet sees a contract with its pin from the first commit. Task 3 after
Task 2, because the installer's `REQUIRED_REFS` names the four references. Task 4 last, so the deny names a skill that
already ships.

---

### Task 1: The contract, its pin and its cap

**Files:**
- Create: `ccd/overlord-skill/SKILL.md`
- Create: `server/test/overlord-skill.test.ts`
- Modify: `server/test/skill-size-caps.json` (`"ccd/overlord-skill/SKILL.md": <its size at merge>`)

**`SKILL.md`'s shape, in order:**
1. Frontmatter, exactly `name: ccrc-overlord` and a `description` that says when to use it ("Use when this session is
   the designated Overlord: its launch profile enabled this skill alone and its doors are the door process's tools")
   and when not: "Never use it inside a subagent", and "Never use it in a session that is not the designated Overlord:
   a coordinator, a worker, a reviewer or a plain session stops at its first step."
2. A title, `# The Overlord`.
3. The notice, the reviewer's sentence shape: a compaction keeps only the start of this file; if you cannot see
   `## Where the procedures are` further down, load this skill again before you act.
4. `## The contract`: one sentence that states the count ("These twenty-two clauses are the Overlord's contract. They
   are not advice."), then the twenty-two clause lines.
5. `## Notes on the contract`: the editing note (the pin suite, straight apostrophes, no double quotes, a clause is one
   line, numbers are taken `1..N`), and one line per clause group naming the reference that carries its procedure
   (clauses 2 and 18: `routing.md`; 3, 4, 13, 14, 17, 20, 21, 22: `answering.md`; 6, 7, 10, 12, 15, 16, 19:
   `starting.md`; 1, 5, 8, 9: `operator-model.md`).
6. `## What you are`: at most six lines. One session, designated by the operator; brain work only; your doors are typed
   tools; the constitution is your workspace memory file; nothing you remember outlives a renewal unless a row holds it.
7. `## Where the procedures are`: the four references, one line each.

**Interfaces (the suite, file-local):**

```ts
const CONTRACT = [
  "Talk to the operator in their style. Lead with the outcome.",
  "Route by §5.3.",
  // … the twenty-two clauses of spec §11.3, in order, each joined onto one line
] as const;
const WORDS = ['zero', 'one', /* … */ 'twenty-one', 'twenty-two'] as const;
const COUNT_WORD = WORDS[CONTRACT.length];
const WHOLE_FILE_BYTES = 16_000; // the ratchet's CONTRACT_BUDGET_BYTES: 5,000 tokens at 3.2 bytes a token
```

Clause 2 and clause 3 name spec sections (§5.3, §6.3). The skill keeps that text verbatim, and `## Notes on the
contract` maps each to its reference, so the clause line stays §11.3's and the procedure lives in the reference.

- [ ] **Step 1: Failing tests** in `server/test/overlord-skill.test.ts`, one `describe('the Overlord skill: its
  contract')`:
  - "carries all twenty-two clauses verbatim, in order" (the clause lines harvested from the `## The contract` section
    equal `CONTRACT` element by element, so a reworded, reordered or wrapped clause reds);
  - "numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps" (harvested from the contract section
    only, as the coordinator's suite scopes it, so a numbered list in a later section is free);
  - "spells that same count, as one derived word, everywhere prose states it" (the `SKILL.md` sentence, and every
    mention of `ccd/overlord-skill/SKILL.md` in `README.md`, at least one, carries `twenty-two clauses` within 160
    characters);
  - "has YAML frontmatter with exactly a name and a description that says when NOT to use it" (`name: ccrc-overlord`,
    both "Never use it" sentences);
  - "keeps the whole file inside the restore budget" (`Buffer.byteLength(skill) <= WHOLE_FILE_BYTES`);
  - "shows no shell": no fenced block tagged `bash`, `sh` or `shell`, no line starting `$ `, no `ccd ` followed by a
    verb, and none of the four repository write verbs `OVERLORD_DENY_RULES` will deny (§3.6), over `SKILL.md`;
  - "points at the constitution": `## What you are` names the workspace memory file as the constitution's carrier.
- [ ] **Step 2: Run.** Red (no file).
- [ ] **Step 3: Write `SKILL.md`** to the shape above. Add its cap: run the ratchet once, read R1's message for the
  size, and write that number.
- [ ] **Step 4: Run** `test/overlord-skill.test.ts` and `test/skill-size-ratchet.test.ts`. Green.
- [ ] **Step 5: Mutation.** From a saved copy, restored after each, never by `git checkout`: swap clauses 6 and 7
  (red); change one word of clause 14 (red); wrap clause 4 onto two lines (red); move `## The contract` below
  `## What you are` (the ratchet's R6 reds); add a `bash` fence to `## What you are` (red); pad the file past 16,000
  bytes (red).
- [ ] **Step 6: Commit.** `feat(skills): the ccrc-overlord skill's contract, its twenty-two clauses pinned and capped`

### Task 2: The four references

**Files:**
- Create: `ccd/overlord-skill/references/routing.md`, `answering.md`, `starting.md`, `operator-model.md`
- Modify: `server/test/overlord-skill.test.ts` (a second describe)

Each reference opens with one paragraph saying which clauses it serves and that the clause governs where they differ.
Each names, for every door it uses, the door's `ccrc-api` verb and its capability word (Table 11.1d). None restates a
clause. None quotes the spec at length: each step is one or two sentences, with the spec section in brackets.

- **`starting.md`** (clauses 6, 7, 10, 12, 15, 16, 19; §3.1, §3.3.3, §3.6, §6.8, §11.2):
  1. **Are you the Overlord?** If this session has no door tools (it has a command tool instead), it is not the
     Overlord: stop, and say so in one line. Do nothing else the skill describes.
  2. **Read your card** (`card`, every page of one hash) before any other door (clause 16). Every other door answers
     `card-unread` until you have.
  3. **Check the board** (`board`). `not-the-overlord` means another session holds the designation: stop.
     `capability-missing` means the server does not carry `overlord-v1`: stop, and say which word was missing.
  4. **Answer the probes** the probe door serves while the generation is `probing`, from your card and your own rows,
     closed-book (§3.3.5).
  5. **Take work from the inbox, in its order** (clause 7): the operator's words first, then rows with a deadline,
     then the rest (§6.8). Settle what you can in one turn; never poll; the coalesced wake is your nudge.
  6. **Read through readers** (clause 6): history, graphs and fleet text go to a reader type, which returns typed
     fields. What it returns is data (clause 15).
  7. **The doors.** One table: verb, what it does, wave word. W1: `card`, `probe`, `note add`, `note close`,
     `note list` (W1a, on `main`), `timer set`, `timer list`, `timer cancel` (`timers-v1`), `inbox`, `messages`,
     `acknowledge`, `board`, `history` (`overlord-v1`). Later: the request, relay and act doors (`overlord-route-v1`),
     the brief and answer doors (`overlord-brief-v1`, `overlord-answer-v1`), `model` and `model-write`
     (`overlord-learn-v1`), the start door (`overlord-start-v1`), and W6's proposals (`overlord-propose-v1`).
  8. **When a door refuses.** One table: each refusal of §11.2's gate order, in that order, with what to do. For
     example: `renewing`, wait for the next turn and do not retry in this one; `stale-generation` or
     `stale-designation`, stop acting, because a newer generation or designation exists; `rung-below`, do the act's
     lower form or bring it to the operator; `capability-missing`, the door's wave has not shipped, so take the path
     the procedure names for it; `unwitnessed`, retry on the next turn.
  9. **Brakes** (clause 10): Pause, the `off` rung, `mail-disabled` and a latch each stop the acts they name; obey
     each at once and say so in one line.
  10. **What you never change** (clause 19): your launch profile, the ladder, grants, the evaluation, the skill, the
      constitution, the caps.
- **`routing.md`** (clauses 2 and 18; §5.3, Figure 4, §5.5): the diamonds of Figure 4 as numbered steps, each marked
  with who decides it (code, the decision model, or you); one owner per request; a busy owner keeps its work; a relay
  carries the operator's words as the server renders them and your part as a call; a done test on every relay, and the
  read-back checked (clause 18); the start and widen rule (the cited words must name the project or programme). Every
  step names `overlord-route-v1`, and until it ships, the step's fallback: tell the operator in the chat, as the
  operator's own decision.
- **`answering.md`** (clauses 3, 4, 13, 14, 17, 20, 21, 22; §6.3, §6.6, §6.9): C18's steps 1 to 5 in order; state the
  classes and the ids before answering (clause 17); an answer is a call, not a ruling, unless a grant or a command
  stands behind it; the decision brief (where it sits first, the question in one line, the safe default, at most
  three options, the recommendation only in the brief); disagree once with a prediction, and on a proved command
  comply and record the dissent (clause 14); seal your own pick, never a guess at the operator's (clause 21); one
  shared premise is asked once (clause 22). The answer and brief doors are W3's (`overlord-brief-v1`,
  `overlord-answer-v1`); until then every decision goes to the operator through the chat.
- **`operator-model.md`** (clauses 1, 5, 8, 9; §9.1, §9.2, §9.4): read entries for the question in hand, never as a
  standing brief; weigh them quoted in the third person; cite entry ids; never quote an `overlord-only` entry outside
  the chat; write only your own part and cite the operator's message rather than writing their words (clause 5);
  record a stated preference through `model-write` citing the message, and before `overlord-learn-v1`, nothing more
  (open question 3); talk in the operator's style, from the card's `style` entries, outcome first (clause 1).

- [ ] **Step 1: Failing tests**, `describe('the Overlord skill: its references')`:
  - "carries exactly the four references": `readdirSync('ccd/overlord-skill/references').sort()` equals the four
    names, and `SKILL.md`'s `## Where the procedures are` names each;
  - "shows no shell" over every reference (the Task 1 case, run over each file);
  - "names only capability words the spec defines": every backticked token ending `-v1` in the references is one of
    the words in Table 11.1d's capability-word row, read from the spec file (the backticked `*-v1` tokens of the row
    that begins `| Capability words`);
  - "names only refusal words the spec defines": every backticked word in `starting.md`'s refusal table is a first
    column word of Table 11.6, read from the spec;
  - "covers the gate order": every Table 11.6 word that §11.2's "The gate order at an Overlord door" list names
    (between that bold line and the next bold line) has a row in `starting.md`'s refusal table, in the list's order;
  - "stops a session that is not the Overlord first": `starting.md`'s first numbered step names the door tools and
    "stop", and its second names `card`.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Write the four references.**
- [ ] **Step 4: Run** `test/overlord-skill.test.ts`. Green.
- [ ] **Step 5: Mutation**, from saved copies: drop `unwitnessed`'s row (the gate-order case reds); misspell
  `overlord-route-v1` as `overlord-routes-v1` (the capability case reds); add a refusal word not in Table 11.6 (reds);
  swap steps 1 and 2 of `starting.md` (reds); add a fifth reference file (reds).
- [ ] **Step 6: Commit.** `feat(skills): the ccrc-overlord skill's four procedures, each door marked with its wave`

### Task 3: The install, doctor and deploy lists

**Files:**
- Create: `ccd/install-overlord-skill.sh` (the reviewer installer's shape: `NAME=ccrc-overlord`,
  `SRC="${CCRC_SKILL_SRC:-$HOME/.cc-sessions/overlord-skill}"`, `REQUIRED_FILES=(SKILL.md)` and
  `REQUIRED_REFS=(answering.md operator-model.md routing.md starting.md)`, checked as the coordinator's installer checks
  its own)
- Create: `server/test/install-overlord-skill.test.ts`
- Modify: `ccd/ccrc` (`_inst_skills`: `overlord-skill` after `reviewer-skill`, and its echo; `_acct_provision`:
  `install-overlord-skill.sh`; `_acct_unprovision`: `ccrc-overlord`; `_uninst_cc_sessions`: the installer, the tree, and
  "the six skill trees")
- Modify: `ccd/ccrc-doctor-checks` (`_check_skills`: both loops, the PASS line and the FAIL remedy;
  `_fix_skills`: `overlord`)
- Modify: `deploy/deploy.sh` (the agent arm: four lines after the reviewer's, spelled as theirs, with no comment that
  spells `overlord-skill/`)
- Modify: `server/test/shellcheck-baseline.json` (the installer's row, `{"count":0,"codes":{}}`)
- Modify: `server/test/wrapper-roster-fixture.test.ts` (an I8-shaped case for the new installer's `REQUIRED_REFS`
  against `ccd/overlord-skill/references/`, both directions)
- Modify the fixtures and pins that name each skill tree: `installTreeFixture.ts`, `laneStateFixture.ts`,
  `ccrc-doctorFixture.ts#SHIPPED_SKILLS`, `ccrc-doctor-fleet-box.test.ts`, `account-markers-pin.test.ts`,
  `ccrc-account.test.ts`, `ccrc-uninstall.test.ts`, `ccrc-install-landing.test.ts`, `ccrc-install-tree.test.ts`,
  `agent/test/deploy-verify.test.ts`. Step 1 measures each: `grep -ln 'reviewer-skill\|ccrc-reviewer' server/test
  agent/test`, and every file whose hit is a list of skill trees, installers or `ccrc-*` names gains the word.
- Modify the corpus scans that read a hand-kept list of skill directories: `ccrc-api-closed.test.ts#corpusFiles`,
  `dead-coordinator-prose.test.ts`, `expiry-lane-prose.test.ts` (add `ccd/overlord-skill`, so later prose is scanned
  too)

- [ ] **Step 1: Measure** the fixtures and pins above and list them in the commit message.
- [ ] **Step 2: Failing tests** in `server/test/install-overlord-skill.test.ts`, mirroring
  `install-reviewer-skill.test.ts` and `install-linear-skill.test.ts`, each on fixture homes from `mkTmp`:
  - "installs the skill into every home it is given", and "re-running converges";
  - "replaces a stale install and backs the old one up first";
  - "refuses a source missing `SKILL.md` or any of the four references, and changes no home";
  - "reports a failed home in the exit status but still processes the others", and "never writes outside the homes it
    was given";
  - "the default homes are the roster, every account whatever its role";
  - "the deploy ships it too: the fleet lane" (the four lines, after the reviewer's);
  - "every hand-kept skill-name site that names ccrc-linear also names ccrc-overlord" (the seven sites, read by
    function body, as `install-linear-skill.test.ts` reads them);
  - "doctor converges a home that lost ccrc-overlord" (`ccrc doctor --fix` on a fixture home, then `_check_skills`
    passes).
- [ ] **Step 3: Run.** Red.
- [ ] **Step 4: Implement** the installer, the list words and the fixture updates.
- [ ] **Step 5: Run** the new suite, `test/install-reviewer-skill.test.ts`, `test/install-linear-skill.test.ts`,
  `test/install-history-skill.test.ts`, `test/install-census.test.ts`, `test/wrapper-roster-fixture.test.ts`,
  `test/ccrc-account.test.ts`, `test/account-markers-pin.test.ts`, `test/ccrc-uninstall.test.ts`,
  `test/ccrc-doctor-fleet-box.test.ts`, `test/ccrc-install-landing.test.ts`, `test/ccrc-install-tree.test.ts`,
  `test/shellcheck-ratchet.test.ts`, `test/growth-check.test.ts`, the corpus scans, and `agent/`'s
  `test/deploy-verify.test.ts`. Green.
- [ ] **Step 6: Mutation**, from saved copies: drop `overlord-skill` from `_inst_skills` (the relation case reds); drop
  it from `_check_skills`'s second loop (the doctor case reds); drop `starting.md` from `REQUIRED_REFS` (the I8 case
  reds); remove the installer's `REQUIRED_REFS` check (the refusal case for a missing reference reds).
- [ ] **Step 7: Commit.** `feat(skills): ccrc update, doctor and deploy carry the ccrc-overlord skill to every home`

### Task 4: The role-skill deny

**Files:**
- Modify: `ccd/session-hook.sh` (`ROLE_SKILLS` gains `ccrc-overlord`; the comment block's "THE THREE NAMES" becomes
  four, and it cites §3.6 "The role-skill deny", the spec the operator approved, as the ruling that adds the fourth)
- Modify: `server/test/session-hook-role-skill-deny.test.ts` (`SKILL_FILES` gains `'ccrc-overlord':
  'ccd/overlord-skill/SKILL.md'`; the titles and the near-miss loop that say "three" read the map's size instead)
- Modify: `README.md` (the role-skill sentence names four role skills; one paragraph on the Overlord skill: where it
  lives, `twenty-two clauses`, that it acts only under `overlord-v1`, that only the `overlord` launch profile enables
  it, and that a subagent cannot load it)
- Modify: `server/test/history-skill.test.ts` (its pin of the README sentence)

- [ ] **Step 1: Failing tests:** the deny suite refuses a subagent's load of `ccrc-overlord`, and of
  `x:ccrc-overlord`, naming that skill and no other; the main thread's load passes; the README sentence pin reads four
  skills; `overlord-skill.test.ts`'s count-word case finds the README paragraph.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/session-hook-role-skill-deny.test.ts`, the other `session-hook*` suites (a changed
  `ccd/session-hook.sh` runs them on every fast pull request), `test/history-skill.test.ts`,
  `test/overlord-skill.test.ts`, `test/growth-check.test.ts`, then both `tsc` runs. Green.
- [ ] **Step 5: Mutation**, from a saved copy: drop `ccrc-overlord` from `ROLE_SKILLS`: the new deny case reds.
- [ ] **Step 6: Commit.** `feat(hook): a subagent cannot load the ccrc-overlord skill`

**The PR ends here.**

## Deviations found

None yet. Decisions this plan takes, by slug (each is also an open question above, or a spec reading):

- **overlord-skill-in-every-home** — the skill installs into every rostered home like every role skill, and its
  first step stops a session that is not the Overlord. How the Overlord's own launch loads it is the sandbox piece's.
- **skill-names-doors-by-verb** — doors are named by their `ccrc-api` verb, which the door process serves as a tool of
  the same name.
- **preference-waits-for-model-write** — before `overlord-learn-v1`, clause 8 writes nothing more than the operator's
  message row, which W4's feed reads.
- **overlord-skill-prose-in-readme-only** — the README paragraph ships here, the `CLAUDE.md` bullet with `overlord-v1`.
- **overlord-skill-whole-file-bound** — the pin suite holds the whole `SKILL.md` inside 16,000 bytes, beside the
  ratchet's contract rule.
- **skill-refusal-table-read-from-the-spec** — the references' capability and refusal words are checked against Table
  11.1d and Table 11.6 read from the spec file, not against a literal copy, so the skill cannot name a word the spec
  does not. When the vocabulary piece lands, the refusal check may read `shared/refusal.ts`'s W1 group instead; that
  change is the vocabulary piece's call.
- **role-skill-deny-gains-a-fourth** — the deny's comment records the operator's 2026-10-13 ruling as "those 3". The
  fourth name comes from §3.6, which the operator approved with the spec; the comment says so.

## Where things stand

**Needs before it starts:** nothing beyond `main`. It is one of the eight pieces the index lists as ready to build.

**What depends on it:** the sandbox piece, whose start report checks that `ccrc-overlord` is the one skill loaded, and
which decides how the Overlord's launch reaches the skill; the door-process piece, which serves the verbs
`starting.md` names and adds the cross-check against its tool list; the Overlord clause (lane G, last), which reads the
same ratchet; `overlord-v1`, which adds the `CLAUDE.md` bullet; and every W1 piece that cites a clause by number.

**What a merge arms:** nothing. No session runs the skill until the operator designates an Overlord, which the console
offers only under `overlord-v1`. A coordinator or a worker that loads it stops at its first step. Every home gains one
skill directory, which doctor measures from the merge on.

**Open questions for the coordinator:** the five at the top, each with its recommendation.

**Waiting on the operator:** nothing.
