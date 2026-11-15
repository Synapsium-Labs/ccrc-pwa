# Overlord W1: the `ccrc-overlord` skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the tree ships a fourth role skill, `ccrc-overlord`, in `ccd/overlord-skill/`. Its `SKILL.md` carries the
Overlord's contract: the twenty-two clauses of spec §11.3, verbatim, under `## The contract`, numbered `1..22`, behind
the compaction notice, with the whole file inside the 5,000-token restore budget. Its four references carry the
procedures: `starting.md`, `routing.md`, `answering.md` and `operator-model.md`. A pin suite holds the clauses, the
count word, the frontmatter, the references, the doors and their capability words, and the file's size. `ccrc update`'s
install spine stages the tree once on the fleet box, outside every account home, as the source the sandbox piece's
launch loads. Doctor's skills check measures and cures that staged copy, `deploy.sh`'s fallback stages it too, and the
session hook's role-skill deny keeps any subagent from loading it.

**Why:** the Overlord is a Claude Code session, and its contract is what it re-reads after a compaction or a renewal.
The skill is one of the W1 pieces that need nothing first: it is text and tests, it ships whole (§11.3: "It ships whole
in W1"), and every door it names that does not exist yet answers `capability-missing` with its wave's word. Landing it
early lets every other W1 piece cite its clauses by number, and lets the sandbox piece measure that the skill loads.

**Architecture:** no server, agent or PWA code. One skill directory (Markdown). One staging installer
(`ccd/install-overlord-skill.sh`, bash): the reviewer installer's guard, backup and atomic swap, with a references
guard and one destination instead of a loop over homes. It is the one writer of the staged copy, and the install spine,
doctor's fix and the deploy fallback all call it. One new pin suite, one new installer suite and one shared relation
helper live under `server/test/`. One cap entry, and one-word additions to the hand-kept lists that stage, check,
cure, remove or deny a skill tree, with the fixtures and pins that name them. Nothing is decided at run time, so no L1
decider is added and no `MUTANT_SETS` entry is needed. A mutation step proves each new guard by turning its test red.

**Tech Stack:** Markdown, bash (`ccd/ccrc`, `ccd/ccrc-doctor-checks`, `ccd/session-hook.sh`, the installer,
`deploy/deploy.sh`), vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`. Each section, and what this plan takes from it:

- §11.3: the twenty-two clauses, the four references, "Small enough to survive a compaction", "The contract comes
  first", "The constitution rides elsewhere", "Enabled by one profile", "It ships whole in W1".
- §3.3.3: "The skill stays small".
- §3.1: "No Overlord from below". The board answers 403 to anyone else.
- §3.3.5 and §3.3.11: probes, and the start states.
- §3.5 and §3.6: brain work only; no command tool in the main thread; "The role-skill deny"; the profile loads nothing
  from the account directory but the sign-in.
- §5.3: the routing procedure, Figure 4.
- §6.3: C18 to C21, H21, H34, the answering procedure.
- §6.6: C58, the decision brief.
- §6.8: the inbox's four bands, and probes first.
- §6.9: the sealed pick and the shared premise.
- §9.1 and §9.2: how entries are read, and Figure 7's feeds.
- §11.2: the gate order, for the refusal table.
- Tables 11.1d and 11.1e: the capability words, and the wave of each door.
- Table 11.6: the refusal words.
- §14: "The skills ship whole".

Table 13.1 has no `shape` call that needs this piece to create a table or a door. H1's "`ccrc-overlord` alone"
belongs to the launch profile, and H9's door process to its own piece. The W0 results
(`docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md`, W0-15 and W0-19) say why the skill is staged and
not installed per home: under pinned setting sources a project skill is listed and an account-level skill is not.

**The index:** `docs/superpowers/plans/2026-11-14-overlord-w1.md` (PR #2814), row "`ccrc-overlord` skill", lane G.

## Open questions and rulings

Each question carries the answer this plan builds. The coordinator ruled on all five at review 2081. The index's
questions 1 to 29 touch this piece in one place only: question 2 (`coordinator-clauses-by-name`) belongs to the
Overlord clause, a separate later piece, and nothing here numbers a coordinator clause.

1. **Where the skill is installed** (slug `overlord-skill-staged-not-per-home`; **ruled**, review 2081 F4).
   - **The facts.** W0-19 and W0-15 measured that under pinned setting sources an account-level skill is not listed.
     §3.6 says the Overlord's profile loads nothing from the account directory but the sign-in. So a copy in every home
     would serve nobody, and it would list a sixth "never use" skill in every other session.
   - **The ruling.** The skill ships in the tree and is staged once, at `$HOME/.cc-sessions/overlord-skill`, on every
     box `_inst_skills` serves (every role but server). That is outside every account home, where the spine already
     stages each skill tree. The sandbox piece (`w1-sandbox.md`) decides how the Overlord's launch loads it as a
     project skill.
   - **What this piece builds and leaves.** Doctor's skills check measures the staged copy against the shipped tree.
     Account provisioning and unprovisioning (`_acct_provision`, `_acct_unprovision`) and their pins are not touched:
     no home gets a copy. The role-skill deny still gains the fourth name, because no subagent anywhere may load it.
2. **How the skill names a door** (slug `skill-names-doors-by-name`; ruled: the recommendation, with F9's mapping
   rule).
   - **The facts.** The Overlord has no command tool. Its doors are typed tools the door process serves (§3.6), and the
     door-process piece names the tool list (index question 13).
   - **The rule.** The skill names each door once, in `references/starting.md`'s door table, by its door name:
     - the `ccrc-api` verb where one exists on `main` (`card`, `probe answer`, `note add`, `timer set`);
     - otherwise the name Table 11.1e gives the door (`inbox`, `messages`, `acknowledge`, `board`, `relay`,
       `attach-brief`).
   - **The mapping rule.** The door process serves each as one tool, whose name is the door name with each space
     replaced by `_` (`note_add`, `timer_set`). The door-process piece adopts that rule and adds a cross-check against
     its tool list in its own pull request.
   - **Spellings.** `inbox` here is the Overlord's inbox door, not `ccrc-api mail inbox`. The Overlord has no mail
     verb, and the table says so in one line. The skill never shows a shell command, which a test holds (Task 1).
3. **Clause 8 before `model-write` exists** (slug `preference-kept-only-as-the-message-row`; ruled, review 2081 F8).
   - **The facts.** Clause 8 says "Record every preference the operator states, at once, citing the message". The write
     door is W4's (`overlord-learn-v1`). In Figure 7, operator messages (S2) go straight to the Overlord's main thread
     through its `messages` read, and the distillation reads S1, S3 and S4 only.
   - **The rule.** `operator-model.md` says to call `model-write` and, on `capability-missing`, to do nothing more. A
     preference stated before `overlord-learn-v1` is kept only as its row of `operator_messages`. No stand-in note is
     written: a note would be a second, untrusted copy of the operator's words (§3.3.2), which H7 forbids.
   - **Left to W4.** Whether W4 reads those rows back is W4's plan. It is recorded as an open item for that plan, under
     this slug.
4. **The README and `CLAUDE.md` lines** (slug `overlord-skill-prose-in-readme-only`; ruled: the recommendation). This
   piece updates every README line that counts or names skills (Task 4), and adds one README paragraph. It leaves
   `CLAUDE.md` alone. The skill acts only under `overlord-v1`, so its `CLAUDE.md` bullet lands with the `overlord-v1`
   piece. That piece then adds the bullet to the count-word scan of `overlord-skill.test.ts`.
5. **Whole-file size** (slug `overlord-skill-whole-file-bound`; ruled: the recommendation). The pin suite asserts that
   the whole `SKILL.md` is at most 16,000 bytes. That is the ratchet's `CONTRACT_BUDGET_BYTES`, the same 5,000 tokens at
   3.2 bytes a token, beside the ratchet's contract rule. A later clause that would cross it moves prose to a reference
   first.

## What exists today

Measured on `origin/main` at `416b8f942`, and confirmed by review 2081 at `2126f46db`, which added the probe rows
(`sessions.probe`, `probe.answer`) to `ccd/ccrc-api`.

- **Role skills.** `ccd/coordinator-skill/`, `ccd/worker-skill/` and `ccd/reviewer-skill/` share one layout:
  - frontmatter of exactly `name` and `description`;
  - a title, then a bold notice ending "load this skill again";
  - `## The contract` as the first `## ` section;
  - `## Notes on the contract`, with an editing note (D-104: straight apostrophes, no double quote inside a clause).

  `ccd/history-skill/` and `ccd/linear-skill/` are skills without a contract. The `SKILL.md` sizes are 23,580 bytes
  for the coordinator, 35,581 for the worker and 15,025 for the reviewer.
- **Pin suites.** `server/test/reviewer-skill.test.ts` has one `describe('the reviewer skill: its contract')`. It holds:
  - a non-exported `CONTRACT` array of double-quoted literals;
  - "carries all ten clauses verbatim";
  - "numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps" (`/^(\d+)\. /gm`);
  - "spells that same count, as one derived word, everywhere prose states it" (`WORDS`, `COUNT_WORD =
    WORDS[CONTRACT.length]`). It scans `README.md` and `CLAUDE.md` for `<word> clauses` within 160 characters of each
    mention of the file, and needs at least one mention;
  - a references-layout case and the frontmatter case.

  There is no shared helper module: each suite reads its own `SKILL.md`.
- **The size ratchet.** `server/test/skill-size-ratchet.test.ts`, with `server/test/skill-size-caps.json`.
  - Its corpus is every path matching `SKILL_FILE` (`^ccd/[^/]+-skill/SKILL\.md$`) from `git ls-files --cached
    --others --exclude-standard`, so a new `SKILL.md` is picked up even untracked.
  - R1: every `SKILL.md` has a cap. R3: a cap new on this branch equals its file's size.
  - R6 (`contractPlace`): the contract is the first `## ` section, `CUT_NOTICE` stands before it, and the contract ends
    within `CONTRACT_BUDGET_BYTES` (16,000).
  - A `SKILL.md` new on the branch earns no clause allowance. Reference files are not capped.
- **The install spine.** `ccd/ccrc#_inst_skills` returns at once on a server-role box. Otherwise it loops
  `coordinator-skill worker-skill reviewer-skill history-skill linear-skill`, and for each tree:
  - `_inst_tree_copy` copies it into `$HOME/.cc-sessions/<name>`;
  - `_inst_atomic` places `ccd/install-<name>.sh` beside it, which then runs and converges every home from that copy.

  It echoes the list of `ccrc-*` names it put "in each account's skills directory".
- **The installers.** `ccd/install-reviewer-skill.sh` and its siblings work the same way:
  - They take `--homes <dir>…`, or loop the roster from `~/.ccrc/accounts.sh`.
  - They read `SRC="${CCRC_SKILL_SRC:-…}"` and check `REQUIRED_FILES=(SKILL.md)`.
  - They skip a converged home (`diff -r -q`), stage with `cp -a`, back up to `~/ccrc-backups/<ts>`, swap with `mv`, and
    roll back on failure.

  Only `ccd/install-coordinator-skill.sh` carries `REQUIRED_REFS`, and `wrapper-roster-fixture.test.ts` (its I8
  describe) holds that list equal to the real `references/` directory in both directions.
- **Uninstall.** `ccd/ccrc#_uninst_cc_sessions` removes each installer and each skill tree, and echoes "the five skill
  trees". `ccrc-uninstall.test.ts` pins it.
- **Doctor.** `ccd/ccrc-doctor-checks#_check_skills` checks that each shipped tree exists under `$BOX_TREE_DIR/ccd`,
  and that each home's copy matches it (`diff -r -q`). Its PASS line names the five skills, and its FAIL remedy spells
  each installer. `ccd/ccrc-doctor-checks#_fix_skills` is the `--fix` path: it re-runs each shipped tree's installer
  into each home. The check is pinned by `ccrc-doctor-fleet-box.test.ts` and by `ccrc-doctorFixture.ts`: its two
  symlink loops over the shipped trees and their installers, and `SHIPPED_SKILLS`, which pairs each tree with its
  per-home name.
- **The deploy fallback.**
  - `deploy/deploy.sh`'s agent arm first rsyncs the tree to `~/ccrc`. It then ships each skill in four lines (`mkdir`,
    `rsync --delete` into `.cc-sessions/<name>-skill/`, `install_atomic` of the installer, run it), coordinator first.
  - Each installer suite finds the rsync by the first line that spells `<name>-skill/`, so no comment in that arm may
    spell it.
  - `agent/test/deploy-verify.test.ts` holds a table of run lines, and `install-census.test.ts` requires `ccrc install`
    and `deploy.sh` to place the same paths.
- **Fixtures that name each skill tree.** `server/test/installTreeFixture.ts` ("five SKILL TREES and their five
  installers"), `server/test/laneStateFixture.ts`, `ccrc-install-landing.test.ts` and `ccrc-install-tree.test.ts`.
- **Relation suites.** Two suites each carry their own copy of one harness (`FORMS`, `SITES`, `fnBody`, `agentArm`):
  - `install-linear-skill.test.ts`'s describe "every hand-kept skill-name site that names ccrc-history also names
    ccrc-linear" reads seven sites by function body: `_acct_provision`, `_acct_unprovision`, `_inst_skills`,
    `_uninst_cc_sessions`, `_check_skills`, `_fix_skills` and the deploy arm;
  - `install-history-skill.test.ts` holds the same relation for history.
- **The role-skill deny.**
  - `ccd/session-hook.sh` sets `ROLE_SKILLS="ccrc-worker ccrc-reviewer ccrc-coordinator"` under the comment block "THE
    ROLE-SKILL DENY (D-4934)". It denies a subagent's `Skill` call (a non-empty `agent_id`) whose name matches one of
    them, exactly or behind one `<ns>:` prefix. A main thread passes.
  - `server/test/session-hook-role-skill-deny.test.ts` builds its expectation from a literal `SKILL_FILES` map of three
    entries, read against each `SKILL.md`'s `name:`.
- **README lines that count or name skills.** These are the five skills that ship to every rostered account; the
  sentence that "All five skills ship to every rostered account's config dir"; and the sentence "None of the three role
  skills (`ccrc-coordinator`, `ccrc-worker` and `ccrc-reviewer`; not `ccrc-history`) is a subagent's to load", which
  `history-skill.test.ts` pins. A later sentence names the three role skills again, and one more names them unpinned.
  Task 4 Step 1 measures each by `grep`.
- **Corpus scans over skill text.** Each reads a hand-kept list of skill directories:
  - `ccrc-api-closed.test.ts#corpusFiles`: every executable `ccrc-api` example maps to a route row.
  - `dead-coordinator-prose.test.ts`, `expiry-lane-prose.test.ts` and `ws-expire-prose.test.ts` (`SKILLS`): no skill
    names a live-lane marker or the server-composed verb.
  - `auth-passkey.test.ts`, the sweep's `corpora`: every HTTP method word followed by an `/api/…` path in a skill `.md`
    must be in `EXEMPT`.
  - The role-skill-only lists: `ws-collect-prose`, `ws-shed-deps-prose`, `mail-inbox-skills` and
    `delegation-wave3.integration`.

  `ccd-ws-lease-mark-argv.test.ts` lists `ccd/*-skill` itself.
- **Shellcheck.** `server/test/shellcheck-baseline.json` has one row per shell file, so a new installer needs one.
- **Growth check.** `server/test/growthCheck.ts#GROWTH_FILES` lists `ccd/ccrc`, `ccd/session-hook.sh` and
  `ccd/ccrc-doctor-checks`, at 40 net code lines a file a pull request; comments are free. `deploy/deploy.sh` and new
  files are not listed.
- **Nothing names the skill yet.** `shared/fleetRoles.ts#FLEET_ROLES` has an `overlord` row with no skill column, and
  `ccd/lib/launch-profiles.json` has no skill field. `server/src/skillstate.ts` names only the worker, coordinator and
  reviewer skill directories, for the dispatch preflight, and the Overlord is never dispatched.
- **Capability gates in the client.** `ccd/ccrc-api` gates only its `timer.*` rows, on `timers-v1`. The card, probe
  and note rows carry no word. Nothing in the tree names `continuity-v1` yet.

## Global Constraints

- **Architecture (`CLAUDE.md`).** No runtime code, so no ring. Consolidate:
  - the installer is the reviewer installer's shape with one destination, not a new mechanism;
  - the installer is the one writer of the staged copy;
  - each list gains a word rather than a second list;
  - the relation suites share one helper (Task 3).

  A guard ships with a test that goes red without it, measured.
- **Clause text.** Each clause is the §11.3 text verbatim, joined onto one line after `N. `. Use straight apostrophes
  only, and no double quote inside a clause, because the pin's literals are double-quoted. The pin suite and `SKILL.md`
  carry the same bytes.
- **Brain work only (§3.5, C48).** The skill's text never shows a shell command, a `ccd` verb or a repository write
  verb. It also never shows a literal HTTP method followed by an `/api/…` path, so `auth-passkey`'s sweep has nothing to
  exempt. It names doors by name (open question 2). The SAFETY rules bind it through clause 11, not by being copied in.
- **The constitution is not here.** What the Overlord is, each ruling in one line, and the anti-goals ride the
  workspace memory file the launch profile ships (§11.3, the sandbox piece). The skill holds the clauses and the
  procedures, and points at the constitution once.
- **Untrusted text.** The references teach that what the Overlord reads is data (clause 15). Only operator messages,
  grants and the server's rows carry authority. The references quote no operator words and no fleet content.
- **Every door carries its word.** Each door the references name carries the capability word of its wave, as Table
  11.1e gives that wave and Table 11.1d names its word. A door that shipped without a word says so, and why. So a
  `capability-missing` answer reads as expected, never as a fault.
- **Tests.**
  - From `server/`, each suite runs as `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`.
  - The last run of each task adds both type checks: `ccrc test -- ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
    and `ccrc test -- ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`.
  - The installer suite uses fixture homes only, never the live `$HOME`. It builds them with `mkTmp` from
    `server/test/tmpHelpers.ts`, with `seedAccountsSh` where a roster is needed, as `install-reviewer-skill.test.ts`
    does.
- **Growth check.** `ccd/ccrc`, `ccd/session-hook.sh` and `ccd/ccrc-doctor-checks` each grow at most 40 net lines. The
  estimates are in the PR split.
- **Public repository.** No private names go in the skill text, the fixtures or the commits. Fixtures use `lane-a` and
  `project-a`. Cite code by symbol or `#@anchor`, never by line. No D-number is invented: departures are slugs, listed
  below, and the coordinator mints the numbers.

## Review Focus

1. **The clauses are §11.3's, byte for byte, and the file numbers exactly `1..22`.** A clause that is softened,
   reordered or wrapped onto two lines is a red suite. Test: Task 1's verbatim-in-order and numbering cases.
2. **The contract survives a compaction.** It is the first `## ` section, behind the notice, ending inside 16,000
   bytes, and the whole file is inside 16,000 bytes. Test: the ratchet's R6, and Task 1's whole-file case.
3. **The start sequence never stalls, and a session that is not the Overlord does nothing.** The steps, in order: no
   door tools means stop; read the card; answer the probe round; read the board. A `renewing` answer sends the session
   back to the probes. A `not-the-overlord` or `capability-missing` answer from the board stops it. Test: Task 2's
   start-sequence cases.
4. **No shell in the skill.** No fenced shell block, no `ccd ` verb, none of the four repository write verbs, and no
   HTTP method followed by an `/api/` path anywhere under `ccd/overlord-skill/`. Test: Task 1's and Task 2's brain-work
   cases.
5. **Every site that stages a skill tree names it, and doctor cures a lost staged copy.** Test: Task 3's relation case,
   and its doctor case, which starts red.
6. **A subagent cannot load it, and the main thread can.** Test: Task 4's deny cases.

## The PR split

| PR | Tasks | What it ships | Needs first | Growth-checked files, estimate |
|---|---|---|---|---|
| One | 1 to 4 | The skill, its references, its pin and cap, its staging through the install spine, doctor and deploy, the shared relation helper, and the role-skill deny | nothing: **ready to build** | `ccd/ccrc` about +3 (one staging line in `_inst_skills`, its echo, one word and the count in `_uninst_cc_sessions`); `ccd/ccrc-doctor-checks` about +8 (the staged-copy arm in `_check_skills` and its line in `_fix_skills`); `ccd/session-hook.sh` 0 (one word); `ccd/overlord-skill/SKILL.md` new, its cap equal to its size at merge (R3), about 9,000 to 12,000 bytes |

`deploy/deploy.sh` grows about two lines and is not growth-checked. The new installer, the two new suites and the
helper are new files, which the growth check does not list.

**Order inside the PR.** Task 1 comes first, so the ratchet sees a contract with its pin from the first commit. Task 3
comes after Task 2, because the installer's `REQUIRED_REFS` names the four references. Task 4 comes last, so the deny
names a skill that already ships.

---

### Task 1: The contract, its pin and its cap

**Files:**
- Create: `ccd/overlord-skill/SKILL.md`
- Create: `server/test/overlord-skill.test.ts`
- Modify: `server/test/skill-size-caps.json` (`"ccd/overlord-skill/SKILL.md": <its size at merge>`)

**`SKILL.md`'s shape, in order:**

1. **Frontmatter**, exactly `name: ccrc-overlord` and a `description`. The description says when to use the skill: "Use
   when this session is the designated Overlord: its launch profile enabled this skill alone and its doors are the door
   process's tools." It says when not to, in two sentences: "Never use it inside a subagent." and "Never use it in a
   session that is not the designated Overlord: a coordinator, a worker, a reviewer or a plain session stops at its
   first step."
2. **A title,** `# The Overlord`.
3. **The notice,** in the reviewer's shape: a compaction keeps only the start of this file. If you cannot see
   `## Where the procedures are` further down, load this skill again before you act.
4. **`## The contract`.** One sentence states the count: "These twenty-two clauses are the Overlord's contract. They
   are not advice." The twenty-two clause lines follow.
5. **`## Notes on the contract`.** First, the editing note: the pin suite, straight apostrophes, no double quotes, a
   clause is one line, numbers run `1..N`. Then one line per reference, naming the clauses whose procedure it carries.
   Every clause is in exactly one line:
   - `starting.md`: 6, 7, 10, 11, 15, 16 and 19;
   - `routing.md`: 2, 12 and 18;
   - `answering.md`: 3, 4, 13, 14, 17, 20, 21 and 22;
   - `operator-model.md`: 1, 5, 8 and 9.
6. **`## What you are`,** at most six lines:
   - one session, designated by the operator;
   - brain work only;
   - your doors are typed tools;
   - the constitution is your workspace memory file;
   - nothing you remember outlives a renewal unless a row holds it.
7. **`## Where the procedures are`:** the four references, one line each.

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
// The spec's four repository write verbs (§3.6), as literals: OVERLORD_DENY_RULES is not on `main`.
const WRITE_VERBS = ['git commit', 'git push', 'gh pr create', 'gh pr merge'] as const;
```

Clauses 2 and 3 name spec sections (§5.3, §6.3). The skill keeps that text verbatim, and `## Notes on the contract`
maps each clause to its reference. So the clause line stays §11.3's, and the procedure lives in the reference.

- [ ] **Step 1: Failing tests** in `server/test/overlord-skill.test.ts`, under one `describe('the Overlord skill: its
  contract')`:
  - "carries all twenty-two clauses verbatim, in order": the clause lines harvested from the `## The contract` section
    equal `CONTRACT` element by element, so a reworded, reordered or wrapped clause reds.
  - "numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps": harvested from the contract section only,
    as the coordinator's suite scopes it, so a numbered list in a later section is free.
  - "spells that same count in its own sentence": `SKILL.md` carries "These twenty-two clauses". The README half of
    the count-word case is added in Task 4, with the paragraph it reads.
  - "maps every clause to exactly one reference": each number from 1 to 22 appears in exactly one of the four lines of
    `## Notes on the contract`.
  - "has YAML frontmatter with exactly a name and a description that says when NOT to use it": `name: ccrc-overlord`,
    and both "Never use it" sentences.
  - "keeps the whole file inside the restore budget": `Buffer.byteLength(skill) <= WHOLE_FILE_BYTES`.
  - "shows no shell": over `SKILL.md`, none of these:
    - a fenced block tagged `bash`, `sh` or `shell`;
    - a line starting `$ `;
    - `ccd ` followed by a word;
    - any of `WRITE_VERBS`;
    - an HTTP method word followed by `/api/`.
  - "points at the constitution": `## What you are` names the workspace memory file as the constitution's carrier.
- [ ] **Step 2: Run.** Red, because the file does not exist.
- [ ] **Step 3: Write `SKILL.md`** to the shape above. Add its cap: run the ratchet once, read R1's message for the
  size, and write that number.
- [ ] **Step 4: Run** `test/overlord-skill.test.ts`, `test/skill-size-ratchet.test.ts` and both type checks. Green.
- [ ] **Step 5: Mutation.** Each mutation starts from a saved copy, restored after each, never by `git checkout`. Each
  must go red:
  - swap clauses 6 and 7;
  - change one word of clause 14;
  - wrap clause 4 onto two lines;
  - drop clause 11 from the notes' map;
  - move `## The contract` below `## What you are` (the ratchet's R6 reds);
  - add a `bash` fence to `## What you are`;
  - pad the file past 16,000 bytes.
- [ ] **Step 6: Commit.** `feat(skills): the ccrc-overlord skill's contract, its twenty-two clauses pinned and capped`

### Task 2: The four references

**Files:**
- Create: `ccd/overlord-skill/references/starting.md`, `routing.md`, `answering.md`, `operator-model.md`
- Modify: `server/test/overlord-skill.test.ts` (a second describe)

Each reference opens with one paragraph. It says which clauses the reference serves, and that the clause governs
wherever the two differ. None restates a clause. None quotes the spec at length: each step is one or two sentences,
with the spec section in brackets.

**`starting.md`** carries clauses 6, 7, 10, 11, 15, 16 and 19 (§3.1, §3.3.3, §3.3.5, §3.3.11, §3.6, §6.8, §11.2). The
order of steps 2 to 4 is a reading of §3.1 and clause 16 (slug `start-order-card-probes-board`):

- Clause 16 puts the card first.
- §11.2's gate step 9 answers `renewing` at every door but card, probe and note while the designation is `pending` or
  the generation is `draining` to `probing`. So the probe round comes before the board.
- §3.1's "its first step checks the board" is satisfied by the board read, wherever it sits. A stray load is harmless
  because the server refuses `not-the-overlord` at the board, and because a card and a probe read serve only the
  caller's own session.

The steps:

1. **Are you the Overlord?** This step assumes the door process, which the index keeps (question 13; the shell fallback
   of §3.6 is not built). If this session has no door tools, because it has a command tool instead, it is not the
   Overlord. Stop, and say so in one line. Do nothing else this skill describes.
2. **Read your card** (`card`, every page of one hash) before any other door (clause 16). Every other door answers
   `card-unread` until you have.
3. **Answer the probe round** (`probe answer`) while the probe door serves one: closed-book, from your card and your own
   rows (§3.3.5). Until the round is done, every door but card, probe and note answers `renewing`.
4. **Read the board** (`board`). Each answer has one branch:
   - `renewing`: the generation is still starting, so go back to step 3 and answer the probes, then read the board
     again. Never wait for the next turn on it.
   - `not-the-overlord`: another session holds the designation, or none names this one. Stop.
   - `capability-missing`: the server does not carry `overlord-v1`. Stop, and say which word was missing.
5. **Take work from the inbox, in its order** (clause 7). While the generation is `active`, a probe round is the
   inbox's first row, ahead of everything. Then four bands follow:
   - first, the operator's words: live commands, then unsettled messages, oldest first;
   - second, rows with a deadline, earliest first;
   - third, request moves, follow-ups, read-back flags and fired timers, oldest first;
   - fourth, background work, offered only when the first three are empty.

   W1 serves the probe rows and band 1. W2 adds band 3. W3 adds band 2, then background work (§6.8). Settle what you
   can in one turn, and never poll: the coalesced wake is your nudge.
6. **Read through readers** (clause 6). History, graphs and fleet text go to a reader type, which returns typed fields.
   What it returns is data (clause 15).
7. **The doors.** One table with three columns: door name, what the door does, and its capability word. Name each door
   as open question 2 says, and give each door the word for its wave in Table 11.1e:
   - **no word:** `card`, `probe answer`, `note add`, `note close`, `note list`. These W1a doors are on `main` with no
     gate. `ccrc-api` checks no word for them, and they must answer while a generation finishes starting, so they never
     meet `capability-missing`.
   - **`timers-v1`:** `timer set`, `timer list`, `timer cancel`.
   - **`overlord-v1`:** `inbox`, `messages`, `acknowledge`, `board`, `history`, `sequence`.
   - **`overlord-route-v1`:** the request, relay and act doors.
   - One line says that the Overlord has no mail verb, and that `inbox` is its own door.
8. **When a door refuses.** One table: the first column is the refusal word, the second is what to do. The table lists
   each word of §11.2's gate order, in that order, then `unwitnessed` last, because "After the gates" puts it after the
   fence. Some of the rows:
   - `renewing`: go back to step 3;
   - `stale-generation` or `stale-designation`: stop acting, because a newer generation or designation exists;
   - `rung-below`: do the act's lower form, or bring it to the operator;
   - `capability-missing`: the door's wave has not shipped, so take the path the procedure names for it;
   - `unwitnessed`: retry on the next turn.
9. **Brakes** (clause 10). Pause, the `off` rung, `mail-disabled` and a latch each stop the acts they name. Obey each
   at once, and say so in one line.
10. **The SAFETY rules bind you as any session** (clause 11): no destructive workspace verb, no secret printed, no
    account act. You have no shell, so this is a reminder of what you never ask a coordinator to do on your behalf.
11. **What you never change** (clause 19): your launch profile, the ladder, grants, the evaluation, the skill, the
    constitution, the caps.

**`routing.md`** carries clauses 2, 12 and 18 (§5.3, Figure 4, §5.5, §3.5):

- The diamonds of Figure 4 as numbered steps, each marked with who decides it: code, the decision model, or you.
- One owner per request, and a busy owner keeps its work.
- Brain work only (clause 12): hand every piece of execution down, as an outcome and never a method. A relay carries
  the operator's words as the server renders them, and your part as a call.
- A done test on every relay, and the read-back checked (clause 18).
- The start-and-widen rule: the cited words must name the project or programme.
- The doors: `relay`, `close-request`, `drop-request` and `nudge-owner` (`overlord-route-v1`); the start door
  (`overlord-start-v1`).
- Until `overlord-route-v1` ships, each step says its fallback: tell the operator in the chat, as the operator's own
  decision.

**`answering.md`** carries clauses 3, 4, 13, 14, 17, 20, 21 and 22 (§6.3, §6.6, §6.9):

- C18's steps in order: 1 (class and effect), 2 (goals and rulings), 2b (precedents), 3 (entries), 4 (ask or act),
  and 5 (decide, record and continue).
- State the classes and the ids before answering (clause 17).
- An answer is a call, not a ruling, unless a grant or a command stands behind it.
- The decision brief: where it sits first, the question in one line, the safe default, at most three options, and the
  recommendation only in the brief.
- Disagree once, with a prediction. On a proved command, comply and record the dissent (clause 14).
- Seal your own pick, never a guess at the operator's (clause 21).
- Ask a shared premise once (clause 22).

The doors, each with the word Table 11.1e's wave gives it:

- `attach-brief`, `propose-command`, `object` and `seal-prediction` (`overlord-brief-v1`, W3 step one);
- `propose-grant`, the answer doors, `escalate` and `return-over-asked` (`overlord-answer-v1`, W3 step two: each needs
  a hold or the grants door);
- `state-a-fact` and `raise-item` (W3, where Table 11.1e gives no step).

The reference names the last two "W3 (step not fixed by the spec)", and their test accepts either W3 word (slug
`w3-doors-without-a-step`, a spec fix). Until `overlord-brief-v1`, every decision goes to the operator through the
chat.

**`operator-model.md`** carries clauses 1, 5, 8 and 9 (§9.1, §9.2, §9.4):

- Read entries for the question in hand, never as a standing brief. Weigh them quoted in the third person, and cite
  their ids.
- Never quote an `overlord-only` entry outside the chat (clause 9).
- Write only your own part, and cite the operator's message rather than writing their words (clause 5).
- Record a stated preference through `model-write`, citing the message. Before `overlord-learn-v1`, do nothing more:
  the message row is the only record (open question 3).
- Talk in the operator's style, from the card's `style` entries, outcome first (clause 1).
- The doors: `model` and `model-write` (`overlord-learn-v1`), and `messages` (`overlord-v1`).

- [ ] **Step 1: Failing tests,** in `describe('the Overlord skill: its references')`:
  - "carries exactly the four references": `readdirSync('ccd/overlord-skill/references').sort()` equals the four
    names, and `SKILL.md`'s `## Where the procedures are` names each one.
  - "shows no shell": Task 1's case, run over each reference.
  - "gives each door the word of its wave".
    - The test reads Table 11.1e from the spec. It finds a door's row by a whole-word match of the door name's first
      word in the row's first cell, backticked or not. If that fails, it matches the stem before a `-`. So
      `probe answer` finds "Card, probe and note", `timer set` finds "The timer doors", and `drop-request` finds
      "drop".
    - It takes that row's Wave cell, honouring the cell's two bracket forms. A wave followed by a bracket that lists
      door names gives those doors that wave ("W1 (board, messages, history …)"). A door name followed by a wave
      inside a bracket gives that door that wave ("`propose-grant` W3 step two").
    - It maps each wave to its word by Table 11.1d's capability-word row. That row is the one beginning
      `| Capability words`, and each word in it is followed by its wave in brackets. A W3 with no step accepts either
      W3 word.
    - Every door row in every reference's door table must then carry that word. The door rows are `starting.md`'s
      table and each reference's doors line. The W1a doors of `starting.md` carry "no word", and Table 11.1e gives them
      W1a.
    - A door name the test cannot find in Table 11.1e fails, naming the door. The builder then fixes the reading, not
      the check.
  - "names only refusal words the spec defines": every word in the first column of `starting.md`'s refusal table is a
    first-column word of Table 11.6, read from the spec.
  - "covers the gate order".
    - Every Table 11.6 word that §11.2's "The gate order at an Overlord door" list names has a row in the refusal
      table. That list runs from its bold line to the next bold line.
    - The rows follow the list's numbered steps, by each word's first mention, except `unwitnessed`, which is the
      table's last row.
  - "starts without a stall".
    - The numbered steps 1 to 4 of `starting.md` name, in order: the door tools with "stop"; `card`; `probe answer`;
      `board`.
    - Step 4's `renewing` branch sends the session back to step 3 and never says to wait for a turn.
    - The refusal table's `renewing` row names step 3.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Write the four references.**
- [ ] **Step 4: Run** `test/overlord-skill.test.ts` and both type checks. Green.
- [ ] **Step 5: Mutation,** each from a saved copy. Each must go red:
  - drop `unwitnessed`'s row;
  - give `seal-prediction` the word `overlord-answer-v1`;
  - give `board` the word `overlord-route-v1`;
  - add a refusal word that is not in Table 11.6;
  - make step 4's `renewing` branch read "wait for the next turn";
  - swap steps 3 and 4 of `starting.md`;
  - add a fifth reference file.
- [ ] **Step 6: Commit.** `feat(skills): the ccrc-overlord skill's four procedures, each door marked with its wave`

### Task 3: The staged copy, doctor and deploy

**Files:**
- Create: `ccd/install-overlord-skill.sh`. It is the staging installer and the one writer of
  `$HOME/.cc-sessions/overlord-skill`:
  - `NAME=ccrc-overlord`;
  - `SRC="${CCRC_SKILL_SRC:-$HOME/ccrc/ccd/overlord-skill}"`;
  - `REQUIRED_FILES=(SKILL.md)`, and `REQUIRED_REFS=(answering.md operator-model.md routing.md starting.md)`, checked
    as the coordinator's installer checks its own;
  - one destination, `--dest <dir>` for tests, `$HOME/.cc-sessions/overlord-skill` by default;
  - the reviewer installer's convergence skip, backup to `~/ccrc-backups/<ts>`, `cp -a` stage, `mv` swap and rollback.
- Create: `server/test/install-overlord-skill.test.ts`.
- Create: `server/test/skillSiteRelations.ts`. It is the shared relation helper: the site readers (`fnBody` over
  `ccd/ccrc` and `ccd/ccrc-doctor-checks`, `agentArm` over `deploy/deploy.sh`), the four spellings (`FORMS`), and a
  data-driven `namedImpliesNamed(pairs)`. Each pair is `{ if, then, sites }`.
- Modify: `server/test/install-history-skill.test.ts` and `server/test/install-linear-skill.test.ts`. This is a move
  commit: each suite's relation describe reads the helper and its own pair, and its titles and expectations stay
  unchanged. Only its imports and the harness it no longer carries change.
- Modify: `ccd/ccrc`:
  - `_inst_skills`: one line after the per-home loop, which runs the staging installer from the shipped tree. Its echo
    gains "and ccrc-overlord staged at ~/.cc-sessions/overlord-skill".
  - `_uninst_cc_sessions`: the staged tree, and "the six skill trees".
- Modify: `ccd/ccrc-doctor-checks`:
  - `_check_skills`: the shipped tree's existence, and one arm that diffs the staged copy against the shipped tree. Its
    FAIL line names `ccrc-overlord` and the remedy `install-overlord-skill.sh`, and its PASS line names the staged copy.
  - `_fix_skills`: one line that runs the staging installer from the shipped tree, outside the per-home loop.
- Modify: `deploy/deploy.sh`. The agent arm runs the staging installer from `~/ccrc/ccd`, after the tree rsync and
  after the reviewer's lines, spelled as theirs. No comment may spell `overlord-skill/`.
- Modify: `server/test/shellcheck-baseline.json`: the installer's row, `{"count":0,"codes":{}}`.
- Modify: `server/test/wrapper-roster-fixture.test.ts`: an I8-shaped case that holds the new installer's
  `REQUIRED_REFS` equal to `ccd/overlord-skill/references/`, in both directions.
- Modify the fixtures and pins that name each staged skill tree, its installer or the doctor's lines:
  - `installTreeFixture.ts`: the tree and its installer;
  - `laneStateFixture.ts`: measure;
  - `ccrc-doctorFixture.ts`: both symlink loops (tree and installer), and a staged-copy entry beside `SHIPPED_SKILLS`,
    which stays per-home;
  - `ccrc-doctor-fleet-box.test.ts`: the PASS and FAIL strings;
  - `ccrc-uninstall.test.ts`, `ccrc-install-landing.test.ts` and `ccrc-install-tree.test.ts`;
  - `install-census.test.ts`;
  - `agent/test/deploy-verify.test.ts`: the run-line table.
- Not modified: `_acct_provision` and `_acct_unprovision` in `ccd/ccrc`, `account-markers-pin.test.ts` and
  `ccrc-account.test.ts`. No home gets a copy (open question 1).
- Modify the corpus scans that forbid text in skills, adding `ccd/overlord-skill`: `ccrc-api-closed.test.ts#corpusFiles`,
  `dead-coordinator-prose.test.ts`, `expiry-lane-prose.test.ts`, `ws-expire-prose.test.ts` (`SKILLS`) and
  `auth-passkey.test.ts` (the sweep's `corpora`; the skill carries no method-and-path literal, so nothing is
  exempted).
- Role-skill-only lists. Step 1 reads what each of `ws-collect-prose`, `ws-shed-deps-prose`, `mail-inbox-skills` and
  `delegation-wave3.integration` asserts:
  - a list that forbids text gains the directory;
  - a list that requires a role skill to teach something the Overlord does not do stays as it is (`mail-inbox-skills`
    requires `mail inbox`, a verb the Overlord does not have);
  - the commit message records each decision.

- [ ] **Step 1: Measure** the fixtures, pins and lists above with `grep -ln 'reviewer-skill\|ccrc-reviewer' server/test
  agent/test`. Every file whose hit is a list of staged trees, installers, doctor lines or forbidding corpora gains the
  word. List them in the commit message.
- [ ] **Step 2: Failing tests** in `server/test/install-overlord-skill.test.ts`, mirroring
  `install-reviewer-skill.test.ts` and `install-linear-skill.test.ts`, on fixture directories from `mkTmp`:
  - "stages the skill at its one destination", and "re-running converges";
  - "replaces a stale staged copy and backs the old one up first";
  - "refuses a source missing `SKILL.md` or any of the four references, and changes nothing";
  - "never writes outside its destination", and "writes into no account home";
  - "the deploy stages it too: the fleet lane", which checks the installer line comes after the tree rsync and the
    reviewer's lines;
  - "every site that stages a skill tree names overlord-skill". It uses the helper with one pair: if a site names
    `ccrc-linear` or `linear-skill`, it also names `overlord-skill`. The sites are `_inst_skills`,
    `_uninst_cc_sessions`, `_check_skills`, `_fix_skills` and the deploy arm.
  - "doctor converges a box that lost the staged copy", written as `install-linear-skill.test.ts`'s doctor case:
    1. remove the staged copy;
    2. assert the initial `FAIL skills: …` line names `ccrc-overlord` and the remedy `install-overlord-skill.sh`;
    3. run `ccrc doctor --fix`;
    4. assert the PASS line names the staged copy, and that the staged copy equals the shipped tree.
- [ ] **Step 3: Move commit first.** Make `server/test/skillSiteRelations.ts`, and switch the history and linear
  suites to it. Run both suites: green with unchanged expectations. Commit
  `test(skills): one relation helper for the hand-kept skill sites`.
- [ ] **Step 4: Run** the new suite. Red.
- [ ] **Step 5: Implement** the installer, the list words and the fixture updates.
- [ ] **Step 6: Run.** All of these, then both type checks, must be green:
  - the new suite;
  - `test/install-reviewer-skill.test.ts`, `test/install-linear-skill.test.ts`, `test/install-history-skill.test.ts`;
  - `test/install-census.test.ts`, `test/wrapper-roster-fixture.test.ts`, `test/ccrc-uninstall.test.ts`;
  - `test/ccrc-doctor-fleet-box.test.ts`, `test/ccrc-install-landing.test.ts`, `test/ccrc-install-tree.test.ts`;
  - `test/shellcheck-ratchet.test.ts`, `test/growth-check.test.ts`;
  - `test/ccrc-api-closed.test.ts`, `test/dead-coordinator-prose.test.ts`, `test/expiry-lane-prose.test.ts`,
    `test/ws-expire-prose.test.ts`, `test/auth-passkey.test.ts`;
  - `agent/`'s `test/deploy-verify.test.ts`.
- [ ] **Step 7: Mutation,** each from a saved copy. Each must go red:
  - drop the staging line from `_inst_skills` (the relation case reds);
  - drop the staged-copy arm from `_check_skills` (the doctor case's initial FAIL assertion reds);
  - drop the staging line from `_fix_skills` (the doctor case's PASS assertion reds);
  - drop `starting.md` from `REQUIRED_REFS` (the I8 case reds);
  - remove the installer's `REQUIRED_REFS` check (the missing-reference refusal case reds).
- [ ] **Step 8: Commit.** `feat(skills): ccrc update, doctor and deploy stage the ccrc-overlord skill once`

### Task 4: The role-skill deny, and the README

**Files:**
- Modify: `ccd/session-hook.sh`. `ROLE_SKILLS` gains `ccrc-overlord`. The comment block's "THE THREE NAMES" becomes
  four, and it cites §3.6's "The role-skill deny", in the spec the operator approved, as the ruling that adds the
  fourth.
- Modify: `server/test/session-hook-role-skill-deny.test.ts`. `SKILL_FILES` gains `'ccrc-overlord':
  'ccd/overlord-skill/SKILL.md'`. The titles and the near-miss loop that say "three" read the map's size instead.
- Modify: `README.md`, in every line that counts or names skills:
  - the line listing the five shipped skills, and the "All five skills ship to every rostered account's config dir"
    sentence: five per home, and `ccrc-overlord` staged once;
  - the pinned "None of the three role skills" sentence: four role skills;
  - each later line that names the three role skills.

  Add one paragraph on the Overlord skill: where it lives and where it is staged, `twenty-two clauses`, that it acts
  only under `overlord-v1`, that only the `overlord` launch profile loads it, and that a subagent cannot load it.
- Modify: `server/test/history-skill.test.ts` (its pin of the README sentence).
- Modify: `server/test/overlord-skill.test.ts`. The count-word case gains its README half: every mention of
  `ccd/overlord-skill/SKILL.md` in `README.md` carries `twenty-two clauses` within 160 characters, and there is at least
  one mention.

- [ ] **Step 1: Measure** the README lines: `grep -n 'ccrc-history\|ccrc-reviewer\|five skills\|three role' README.md`.
  List each line in the commit message.
- [ ] **Step 2: Failing tests:**
  - the deny suite refuses a subagent's load of `ccrc-overlord`, and of `x:ccrc-overlord`, naming that skill and no
    other;
  - the main thread's load passes;
  - the README sentence pin reads four role skills;
  - the count-word case's README half finds the paragraph.
- [ ] **Step 3: Run.** Red.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** All of these, then both type checks, must be green:
  - `test/session-hook-role-skill-deny.test.ts`;
  - the other `session-hook*` suites, because a changed `ccd/session-hook.sh` runs them on every fast pull request;
  - `test/history-skill.test.ts`, `test/overlord-skill.test.ts`, `test/growth-check.test.ts`.
- [ ] **Step 6: Mutation,** each from a saved copy. Each must go red:
  - drop `ccrc-overlord` from `ROLE_SKILLS` (the new deny case reds);
  - remove `twenty-two clauses` from the README paragraph (the count-word case reds).
- [ ] **Step 7: Commit.** `feat(hook): a subagent cannot load the ccrc-overlord skill`

**The PR ends here.**

## Deviations found

None yet. These are the decisions this plan takes, by slug. Each is also an open question above, or a reading of the
spec.

- **`overlord-skill-staged-not-per-home`.** The coordinator's ruling at review 2081 (F4). The skill is staged once, at
  `$HOME/.cc-sessions/overlord-skill`, by one installer. No account home gets a copy, and doctor measures the staged
  copy. The sandbox piece decides how the launch loads it.
- **`skill-names-doors-by-name`.** Doors are named by their `ccrc-api` verb, or by their Table 11.1e name where no verb
  exists. The door process serves each as a tool whose name is the door name with spaces as `_`.
- **`preference-kept-only-as-the-message-row`.** Before `overlord-learn-v1`, a stated preference is kept only as its row
  of `operator_messages`. Whether W4 reads those rows back is an open item for W4's plan.
- **`overlord-skill-prose-in-readme-only`.** The README lines ship here, and the `CLAUDE.md` bullet ships with
  `overlord-v1`.
- **`overlord-skill-whole-file-bound`.** The pin suite holds the whole `SKILL.md` inside 16,000 bytes, beside the
  ratchet's contract rule.
- **`start-order-card-probes-board`.** The start runs card, then the probe round, then the board, by a reading of §3.1
  and clause 16 against §11.2's gate step 9. A `renewing` answer at the board sends the session back to the probes.
- **`skill-words-read-from-the-spec`.**
  - Each door's capability word is checked against the wave Table 11.1e gives that door, mapped by Table 11.1d.
  - The refusal words are checked against Table 11.6's first column, and the gate order against §11.2's list. All of
    them are read from the spec file, not from a literal copy.
  - When the vocabulary piece lands, the refusal check may read `shared/refusal.ts`'s W1 group instead. That is the
    vocabulary piece's call.
- **`w3-doors-without-a-step`.** Table 11.1e gives `state-a-fact` and `raise-item` the wave W3 with no step. The
  reference says so, the test accepts either W3 word, and the spec's next fix should name the step.
- **`role-skill-deny-gains-a-fourth`.** The deny's comment records the operator's 2026-10-13 ruling as "those 3". The
  fourth name comes from §3.6, which the operator approved with the spec, and the comment says so.

## Where things stand

**Needs before it starts:** nothing beyond `main`. It is one of the eight pieces the index lists as ready to build.

**What depends on it:**
- The sandbox piece. Its start report checks that `ccrc-overlord` is the one skill loaded, and it decides how the
  Overlord's launch loads the staged copy as a project skill.
- The door-process piece. It serves the doors `starting.md` names, by the mapping rule, and adds the cross-check
  against its tool list.
- The Overlord clause (lane G, last), which reads the same ratchet.
- `overlord-v1`, which adds the `CLAUDE.md` bullet.
- W4's plan, which owns the open item `preference-kept-only-as-the-message-row`.
- Every W1 piece that cites a clause by number.

**What a merge arms:** nothing. No session loads the skill until the operator designates an Overlord, which the
console offers only under `overlord-v1`. No account home gains a skill. The fleet box gains one staged tree, which
doctor measures from the merge on.

**Review 2081 (fix round 1)** changed:
- Task 3: staged, not per home, with one installer as the single writer, and a doctor case that starts red.
- Task 2: the start order, with its `renewing` branch; per-door words from Table 11.1e; four inbox bands; all 22
  clauses mapped.
- Task 1: the count-word split, with its README half moved to Task 4, and the literal write verbs.
- Task 3: the full lists of fixtures and corpora, and the shared relation helper.
- Task 4: every README skill line.
- Both type checks are named.

**Open questions for the coordinator:** none. All five are ruled.

**Waiting on the operator:** nothing.
