# Coordinator from the start: every session the operator creates is a full coordinator from its first turn

A session the operator creates is already its project's coordinator by derivation (no `.child` row), but on `main` it
behaves like one only once it chooses to: its start card says to load the coordinator skill "for work worth
splitting", its fleet card never says what it is, picking one field on the New session sheet drops the coordinator
route row, and a revived session is told nothing. This plan makes the role real from turn 1, in four parts (A to D).
Children, the run lanes' claim-based coordinator set and the server's run machinery are out of scope and unchanged.

## Deviations found

- **D-8142 (2026-11-09)** — every session the operator creates is a full coordinator from its first turn (operator
  ruling 2026-11-09). (A) Its start card tells a fresh coordinator to load the `ccrc-coordinator` skill now and to read
  its programme's goals and definition of done when its work belongs to one; this overturns D-5301's "a start-time
  sentence, not a kickoff … no eager skill load" (coordinator-first routing spec 2026-10-17 §8). (B) The fleet card
  shows the word `coordinator` as a role fact; this overturns D-5545's card rule for this one fact (the header keeps
  it, and the card stays a subset of the header). (C) A new row always gets the coordinator route row, and any field
  the operator picked (class, effort, workflow, subagent, browser) is laid over it instead of replacing it; a revival
  still never re-seeds a coordinator's considered fields. This amends the routing slice-4 rule "the argv wins over the
  default outright" and D-8121's browser-only special case, which the new rule subsumes. (D) A resumed or forked
  coordinator gets a shorter role reminder; this overturns D-5359's resume/fork silence. A dispatched child, a held
  row and the `ccrc-card-off` kill switch stay silent on every source. No kickoff mail is added.

## What was measured first

Read on `origin/main` at fe4c74c8e (file and symbol for every claim):

- **The role is derived.** `sessionRoleOf` (`shared/api.ts`) answers `coordinator` unless `$REG/<id>.child` exists.
  Only `ccd ws-add --no-rc --child <run>` writes `.child` (`cmd_ws_add`). The New session sheet
  (`pwa/src/fleet/NewSessionSheet.tsx`) calls `POST /api/sessions` (`CCD_ARGV.enable`/`start`, so `ccd enable` →
  `cmd_start`) or `api.workspaceAdd` (`ccd ws-add` without `--no-rc`). Every dispatch builder in
  `server/src/ccdargv.ts` passes `--no-rc`.
- **The start card.** `_hook_role_card` (`ccd/session-hook.sh`, SessionStart arm) sets `CARD_ROLE` to "ccrc-role: You
  are a coordinator for this project. For work worth splitting, run the `ccrc-coordinator` skill and dispatch; your
  children's questions and permission prompts come to you first; your own go to the operator." It returns empty for
  `ccrc-card-off`, for `src` `resume`/`fork` (D-5359), for a `.child` that exists or is a dangling link, and for a
  `.hold`. The text is pinned verbatim in `server/test/session-hook-role-card.test.ts` (`SENTENCE`),
  `server/test/install-linear-skill.test.ts` (the coordinator row's whole envelope) and by prefix in
  `server/test/session-hook.test.ts` (the manual-session compact case, `/^ccrc-role: You are a coordinator for this
  project\./`). The spec §8 text and its D-5301 rationale (18 of 29 such sessions never dispatched; the skill costs
  about 10k tokens plus 22k for the wave lifecycle) are in
  `docs/superpowers/specs/2026-10-17-coordinator-first-routing-design.md`.
- **The card budget.** `CARD_DIFF_LIST_MAX_CHARS` is derived from `CARD_MAX_CHARS` (2400) less 903 (linked graphify)
  less 1107 (held case A 860 + co-tenant 245 + joins), on the argument that the role subject "is shorter than case A
  and never beside it". Any new role text must stay at or under 860 characters for that argument to keep holding.
- **The deny.** The PreToolUse role-skill deny (D-4934, `session-hook-role-skill-deny.test.ts`) refuses
  `ccrc-coordinator` only to a subagent (non-empty `agent_id`). The main thread may load it, so A needs no deny change.
- **The route seed.** `cmd_ws_add` writes `--route` pairs, then seeds `_route_seed_default` only when
  `! norc && ! _route_argv_routes`; `cmd_start` does the same on a mint (`-z $regw`). `_route_argv_routes` answers 0
  when any pair names a field other than `browser`. So an operator who picks Class alone gets `class` and nothing
  else: no `effort=high`, no `subagent=sonnet`, no `workflow=on`. The sheet's own note already promises "Unset fields
  take the routing matrix's default (Opus · high, Sonnet subagents, workflows on)", which today is false whenever any
  field is set. `_route_seed_default` returns early when `_route_any` (the row already has a routing record), and the
  revival arm writes argv only (controller ruling S4-R3). `ROUTE_COORDINATOR_ROW="class=opus effort=high
  subagent=sonnet workflow=on"`.
- **The card and the header.** `cardFacts` (`pwa/src/fleet/sessionFacts.ts`) returns name, status, context, marker,
  workingOn, delegated; `headerFacts` already carries `{key: 'role', text: COORDINATOR_WORD}` when `coordinatorRole`;
  `SessionDetails` shows the word in the details. `cardWithinHeader` checks the card ⊂ header rule.
  `SessionMeta` (card mode) draws two lines: the state line (`.sess-meta`, `overflow: clip`, no wrap, about 34
  characters at 360) and the context line (`.sess-meta--context`). Both skins render through `SessionLine`.
  `card-header-facts.test.tsx` caps the state line at three children.
- **D-8126 overlap.** The coordinator-autonomy plan (D-8126, not on `main` yet) Task A9-2 changes the same `CARD_ROLE`
  clause "your own go to the operator". This plan keeps that clause byte-for-byte as the last sentence of both new
  texts, so whichever lands second rebases by replacing that one sentence. `ccrc-api goals show` is not on `main`, so
  the card names the programme ledger, which is.

## Decisions taken in this plan (author's calls)

1. **The role fact sits on the card's context line, first**, never on the state line: the state line clips at 360,
   and `working · coordinator · needs you` would reach its limit. On the context line it reads `coordinator` alone,
   or `coordinator · PR #12`, or `coordinator · <branch>`, with the branch's short form budgeted down by the role's
   width so neither is cut. A child never has the fact, so the programme and wave line is unchanged.
2. **The two hook texts** (A and D), each under the 860 bound:
   - Fresh (startup, clear, compact, no source): "ccrc-role: You are this project's coordinator from your first
     turn. Load the `ccrc-coordinator` skill now, before anything else, and act as it says. When your work belongs to
     a programme, read its goals and definition of done in its ledger (`docs/superpowers/programs/<slug>.md`) before
     you plan or ask. Your children's questions and permission prompts come to you first; your own go to the
     operator."
   - Revival (resume, fork): "ccrc-role: You are still this project's coordinator. If the `ccrc-coordinator` skill
     is not loaded in this context, load it now. Your children's questions and permission prompts come to you first;
     your own go to the operator."
   Both are constants inside `_hook_role_card`, in the arm (D-5358: nothing new above the tail line).
3. **The seed lays the row under the argv.** `_route_seed_default id wrapper [k=v...]` writes every
   `ROUTE_COORDINATOR_ROW` pair whose field the argv does not name, and runs BEFORE the argv write, so the journal
   never records a value the argv then replaces (`class ∅ -> opus` then `class opus -> sonnet` would claim a write the
   operator never wanted). `_route_argv_routes` is removed with its two call sites.
4. **No kickoff mail.** The card is a direct instruction. Whether fresh coordinators follow it is measured after
   deploy (Open points); a mail is added only if they do not.

## Rules for every task

- Worktree `~/projects/wt.noindex/coordinator-from-start`, branch `feat/coordinator-from-start`.
  Every script runs under `set -euo pipefail` and asserts `git rev-parse --show-toplevel` equals the worktree before
  a commit. Add named files only; never `git add -A`, never stash, no push, no PR.
- Vitest with `--maxWorkers=2`, at most about 12 files per command; `npm ci` in a package first if it has no
  `node_modules`. Known Mac-only failures (push-copy, mail-sweep, history-replay, feed-writers-pin, agent
  deploy-verify D3b-e) are not regressions.
- When `pwa/src` changes: the browser leg for the touched rendering, the server pins that scan `pwa/src`, and
  `pwa/test/refusal-literal-ratchet.test.ts`.
- Comments cite symbol names, never line numbers. No tracker ids, hosts, emails, account or session names in files.
- Commits are authored and committed as the repo owner's noreply identity, cite D-8142 and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 0: this plan

**Files:** Create `docs/superpowers/plans/2026-11-09-coordinator-from-start.md`.

- [ ] Commit `docs(plan): coordinator from the start, the four parts (D-8142)`.

## Task 1 (C): the coordinator route row under every operator pick

**Files:** Modify `ccd/ccd` (`_route_seed_default`, `cmd_ws_add`'s routing record block, `cmd_start`'s
"ARGV ALWAYS, THE DEFAULT ONLY AT A MINT" block; delete `_route_argv_routes`), `ccd/contexts.tsv` (drop the
`_route_argv_routes` row), `ccd/contexts-edges.tsv` (drop `cmd_start -> _route_argv_routes` and
`cmd_ws_add -> _route_argv_routes`). Test `server/test/ccd-route-argv.test.ts`; re-run
`server/test/ccd-place-class.test.ts`, `server/test/ccd-workspaces.test.ts`, `server/test/ccd-die-containment.test.ts`,
`server/test/ccd-contexts.test.ts`, `server/test/routing-references.test.ts`, `server/test/growth-check.test.ts`.

- [ ] **Step 1: the failing tests** in `ccd-route-argv.test.ts`:
  - New `describe('an operator pick lays over the coordinator row (D-8142)')`:
    - `an operator ws-add with --route class=sonnet keeps effort high, subagent sonnet and workflow on`:
      `cmd_ws_add --route class=sonnet demo` → `record('demo-quiet-mesa')` is `['sonnet', 'high', 'sonnet', 'on']`;
      `routeRows()` has 4: rows 0 to 2 `{actor: 'spawn', reason: 'coordinator row (default)'}` for effort, subagent,
      workflow; row 3 `{actor: 'ws-add', reason: 'argv'}` with detail `class: ∅ -> sonnet` (never `opus -> sonnet`).
      Red today: `['sonnet', null, null, null]` and 1 row.
    - `an operator ws-add with --route effort=low --route workflow=off keeps class opus and subagent sonnet`:
      record `['opus', 'low', 'sonnet', 'off']`; the composed spawn argv contains `--model opus` and `--effort low`.
    - `a minting start with --route subagent=haiku gets class opus, effort high and workflow on`:
      `cmd_start --route subagent=haiku claude demo` → `['opus', 'high', 'haiku', 'on']`.
    - `a dispatched worker (--no-rc) with --route class=sonnet still gets that field alone` (guard, green today):
      `['sonnet', null, null, null]`, 1 row.
    - `a revival with --route effort=low on a coordinator whose record says class=sonnet effort=medium writes effort
      only`: mint with `--route class=sonnet --route effort=medium`, then `cmd_start --route effort=low claude demo`
      → class `sonnet`, effort `low`, subagent and workflow as minted; exactly one new route row (never a re-seed).
  - Change the cases the old rule pinned:
    - `an explicit --route on an operator ws-add wins over the coordinator row…` → renamed `…is laid over the
      coordinator row, and the DECLARED actor is the one journaled`: record `['sonnet', 'high', 'sonnet', 'on']`,
      4 rows, the last `{actor: 'run:7 dispatch', reason: 'argv'}`.
    - `a --route that names only browser keeps the coordinator row (D-8121)`: same record; rows 0 to 3 are the
      default, row 4 the `browser` argv (the order flips: seed first).
    - `browser beside a routing field is the caller's answer: no coordinator row` → `browser beside a routing field
      rides over the coordinator row too`: `['sonnet', 'high', 'sonnet', 'on']`, 5 rows.
    - `a minting start with --route browser=off…`: still 5 rows then 6; row order seed first.
    - `start takes --route, writes after the mint…`: the subagent=haiku mint now has 4 rows (row 3 the argv);
      `enable --route workflow=off claude-a demo` mints with 4 more (row 7 the argv); the second bare start of the
      existing row still adds none, and `class` is now `opus` (seeded at the mint), never re-written.
    - `start and enable WRITE --route on a session that ALREADY has a row…`: 4 rows after the mint, 5 after the
      revival, the revival's detail still `class: sonnet -> opus`; `routeLog` gains the three seed lines first.
    - `enable --route on a LIVE session…` and `the other condition on the same branch…`: counts 4 then 5, and 4.
    - Re-read every other `routeRows()`/`routeLog()` count in the file against the new order (the forged-actor case
      included); a case that measures a dispatched worker stays as it is.
- [ ] **Step 2: run red** `cd server && npx vitest run --maxWorkers=2 test/ccd-route-argv.test.ts`: the new and
  changed cases fail on the record and the row counts.
- [ ] **Step 3: implement.**
  - `_route_seed_default() {   # id wrapper [k=v...] — the coordinator row for an OPERATOR spawn, under the argv's pairs`:
    keep `_route_any "$1" && return 0`; collect the field names the remaining positionals name; build `seed` from
    `$ROUTE_COORDINATOR_ROW`'s pairs whose field is not among them; return 0 on an empty `seed`; else
    `_route_argv_write "$1" spawn "coordinator row (default)" "${seed[@]}"`. Comment: D-8142, the argv lays over the
    row; a field the argv names is never seeded first, so the journal never shows a value the operator did not want.
  - `cmd_ws_add`: `(( ! norc )) && _route_seed_default "$id" "$hw" "${lc_route[@]}"` BEFORE
    `(( ${#lc_route[@]} )) && _route_argv_write …`. Rewrite the block comment: an operator spawn always gets the row,
    the argv laid over it; a dispatched worker (`--no-rc`) gets only what its argv names.
  - `cmd_start`: `[[ -z "$regw" ]] && _route_seed_default "$id" "$wrapper" "${route[@]}"` BEFORE the argv write;
    the "DEFAULT IS STILL MINT-ONLY" paragraph stays; the D-8121 line is replaced by the D-8142 rule.
  - Delete `_route_argv_routes` and its contexts rows and edges. Keep `_route_any`'s browser exclusion (a stray
    browser file is still not a routing record).
  - If `growth-check` measures `ccd/ccd` past its limit, add a waiver file
    `server/test/growth-waivers/D-8142-ccd-ccd.json` with the measured delta (expected net negative or near zero).
- [ ] **Step 4: green** the six suites above.
- [ ] **Step 5: commit** `feat(ccd): an operator spawn always gets the coordinator route row, picked fields laid over
  it (D-8142)` with the named files.

## Task 2 (A and D): the role card loads the skill now, and speaks on revival

**Files:** Modify `ccd/session-hook.sh` (`_hook_role_card`, its comment block, and the `CARD_DIFF_LIST_MAX_CHARS`
comment's "the role subject is shorter than case A" clause, which now cites the 860 pin). Test
`server/test/session-hook-role-card.test.ts`, `server/test/install-linear-skill.test.ts`,
`server/test/session-hook.test.ts`; re-run `server/test/session-hook-roster-card.test.ts`,
`server/test/session-hook-role-skill-deny.test.ts`, `server/test/session-hook-turnmark.test.ts`,
`server/test/delegation-spool.test.ts`, `server/test/growth-check.test.ts` and the compaction-card corpus pins
(`grep -l "compaction-card corpus\|@anchor" server/test/*.ts`).

- [ ] **Step 1: the failing tests.**
  - `session-hook-role-card.test.ts`: replace `SENTENCE` with `FRESH` and `REVIVED` (the two texts of decision 2,
    without the `ccrc-role: ` prefix, verbatim) and a `ROLE = 'ccrc-role:'` probe for silence.
    - `renders the fresh card for a row with neither marker…`: startup context contains `FRESH` once and not
      `REVIVED`; it names `` `ccrc-coordinator` `` and the word `now`; it does not contain `For work worth
      splitting`. Red today.
    - clear, source-less and compact cases: `FRESH` once.
    - `says nothing on a resumed SessionStart…` → `a resumed SessionStart gets the shorter reminder (D-8142
      overturns D-5359)`: resume context contains `REVIVED` once and not `FRESH`; hookstate `done` (control). Red today.
    - fork: the same. Red today.
    - child (file, directory, dangling link), hold (content, empty, directory) and `ccrc-card-off`: each run on
      `startup` AND on `resume` and `fork`, context does not contain `ROLE`. The resume/fork legs are new and must
      stay green.
    - `the role card fits the budget CARD_DIFF_LIST_MAX_CHARS assumes`: `('ccrc-role: ' + FRESH).length` and the
      revival's are each at most 860 (held case A's bound in that constant's argument). Red only if the text grows.
    - `writes no marker` stays, run on startup and on resume.
  - `install-linear-skill.test.ts`: the coordinator row's envelope is `ccrc-role: ` + the fresh text, verbatim.
  - `session-hook.test.ts`, the manual-session compact case: the prefix regex becomes
    `/^ccrc-role: You are this project's coordinator from your first turn\./`.
- [ ] **Step 2: run red** the three files.
- [ ] **Step 3: implement** in `_hook_role_card`: the kill switch, `.child` and `.hold` guards first, unchanged;
  then `case "$src" in resume|fork) CARD_ROLE="<revival text>" ;; *) CARD_ROLE="<fresh text>" ;; esac`. Rewrite the
  comment block: D-8142 (the role from the first turn, overturning D-5301's no-eager-load and D-5359's
  resume/fork silence), still derived, still no marker, still mutually exclusive with every held sentence, and both
  texts under the 860 bound the budget argument needs. No other subject moves; the join order stays graph, hold,
  role, ccrc.
- [ ] **Step 4: green** the files above; `session-hook.test.ts` is a known load flake, so re-run a red case alone
  before calling it.
- [ ] **Step 5: commit** `feat(hook): the role card tells a new coordinator to load its skill now, and reminds a
  revived one (D-8142)`.

## Task 3 (B): the word `coordinator` on the session card

**Files:** Modify `pwa/src/fleet/sessionFacts.ts` (`CardFacts.role`, `cardFacts`, `cardWithinHeader`, the branch
short budget when the role is present), `pwa/src/fleet/SessionMeta.tsx` (card mode: a `sess-role` cell first on the
context line), `pwa/src/fleet/fleet.css` (`.sess-role`: secondary ink, `white-space: nowrap`, `flex: none`). Test
`pwa/test/card-header-facts.test.tsx`; create `pwa/browser/role-fact.browser.test.ts`; re-run
`pwa/test/stale-run-attribution.test.tsx`, `pwa/test/refusal-literal-ratchet.test.ts`, and the server pins that scan
`pwa/src` (`grep -l "pwa/src" server/test/*.ts`, at most 12 per command; `pools-prose`, `hibernate-census` and
`single-definition/ask-digest` among them).

- [ ] **Step 1: the failing tests.**
  - `card-header-facts.test.tsx`, the model block:
    - `a coordinator's card names its role; a child's never does`: for the `programme coordinator` and `bright-lake`
      cases `cardFacts(f).role` is `{key: 'role', text: 'coordinator'}`; for every `role: 'child'` case it is `null`;
      for a session with `role` absent or null (an older server) it is `null`. Red today (no field).
    - `every card fact is a header fact` (the loop) now also covers `role`, through `cardWithinHeader`'s list.
  - The rendered block, both skins: for a coordinator case the card's `.sess-meta--context` begins with
    `coordinator`, exactly one `.sess-role` exists, and the header's visible text contains it; a child case has no
    `.sess-role`. The state line's three-child cap is unchanged. Red today.
  - `a coordinator with a long branch keeps both whole on the card`: the `bright-lake` case's context line holds
    `coordinator` and the branch's short form, whose length plus the role's stays within `NAME_BUDGET`.
  - `pwa/browser/role-fact.browser.test.ts` (new), over the production build like `row-fit.browser.test.ts`:
    REFINED and INSTRUMENT (status and project modes), PHOSPHOR and light, at 360, 390, 1280, 1470 and 1920: a
    coordinator row with a 60-character branch and one with a PR show `.sess-role` with text `coordinator`, its
    `scrollWidth <= clientWidth` (no cut), its box inside the row, the context line on one line, the page with no
    horizontal overflow and no page error; a child row shows none. Red today (no element).
- [ ] **Step 2: run red** `cd pwa && npx vitest run --maxWorkers=2 test/card-header-facts.test.tsx` and the browser
  file with `CCRC_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/role-fact.browser.test.ts`.
- [ ] **Step 3: implement.** `CardFacts` gains `readonly role: Fact | null`, set from `f.coordinatorRole` to
  `{key: 'role', text: COORDINATOR_WORD, title: "this session is its project's coordinator"}`. `cardWithinHeader`
  adds `card.role` to `shown` (the header's `role` fact already matches by prefix). `contextFact` stays the ONE
  context fact; when the role is present `cardFacts` shortens a branch context with `NAME_BUDGET` less the role's
  width (a named constant, `ROLE_CELL_CHARS`, derived from `COORDINATOR_WORD.length` plus the separator).
  `SessionMeta` card mode renders the context line when `glance.role !== null || context !== null`, the role first
  (`<span className="sess-role" title=…>coordinator</span>`), the existing middot rule separating it from the
  context. Update the header comment's D-5545 paragraph: the card adds the role fact (D-8142).
- [ ] **Step 4: green** the files above, the browser file at every width, skin and theme, the `pwa/src` server pins
  and the ratchet. Judge the screenshots at each width: one legible fact, no truncation, nothing on the state line
  moved.
- [ ] **Step 5: commit** `feat(pwa): the session card says coordinator (D-8142)`.

## Task 4: the sheet's comments and the docs that state the old behaviour

**Files:** Modify `pwa/src/fleet/NewSessionSheet.tsx` (the routing-row state comment and the route-row JSX comment:
unset fields take the coordinator row and any picked field is laid over it, D-8142; the visible note's words are
already true and stay), `README.md` (the routing paragraph's "An operator spawn with nothing chosen gets the
coordinator row" → every operator spawn gets it with any chosen field laid over it; the D-5545 card paragraph gains
the role fact; the coordinator paragraph says a session the operator creates is told at start to load the skill and
is reminded on revival), `docs/superpowers/specs/2026-10-17-coordinator-first-routing-design.md` §8 (an
"Overturned 2026-11-09 by D-8142" note under the start-time-sentence bullet, quoting the new texts), and any other
line `grep -rn "worth splitting\|nothing chosen gets\|says nothing there" README.md docs ccd --include='*.md'`
finds stating the old behaviour. Test: re-run `pwa/test/new-session-sheet.test.tsx` and the README pins
(`grep -l "README.md" server/test/*.ts`, at most 12 per command).

- [ ] **Step 1:** the edits; no behaviour changes, so no new red test.
- [ ] **Step 2:** green the re-runs.
- [ ] **Step 3: commit** `docs: coordinator from the start in the README, the routing spec and the sheet (D-8142)`.

## Open points

- **Whether the card alone is followed.** After the agent lane deploys, count the fresh operator-made sessions whose
  first turn loads `ccrc-coordinator` (the delegation spool's SessionStart records against the first `Skill` call).
  If most do not, a kickoff mail is the next step; that is a separate change.
- **D-8126 rebase.** Whichever of this plan's Task 2 and D-8126 Task A9-2 lands second replaces only the final
  sentence of each role text.
