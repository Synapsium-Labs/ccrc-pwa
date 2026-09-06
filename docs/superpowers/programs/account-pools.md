# Program: account-pools

Spec: `docs/superpowers/specs/2026-09-04-account-pools-design.md` (approved by the operator 2026-09-05)
Plan: six wave plans, written and numbered before the program opened —
`docs/superpowers/plans/2026-09-05-account-pools-wave{1-roster,2a-ccd-tag-placement,2b-ccd-swap-strand-crossing,3-server,4-pwa,5-docs}.md`
Workspace: `ccrc-pwa-clear-meadow` (workspace `clear-meadow`, branch `ws/clear-meadow`) — spawned by wave 1's dispatch, run 32; every later wave is dispatched fresh into it
Coordinator: `ccrc-pwa-amber-summit` (workspace `amber-summit`, branch `ws/amber-summit`) — operator-designated
2026-09-05 ("Subagent driven, and leverage CCRC capabilities fully"). Workspace-resident, not a main checkout.

The spec, the six plans and this ledger were merged to `main` BEFORE wave 1 was dispatched (docs PR from
`ws/amber-summit`), so every worker workspace is cut with its requirements in the tree — no ref-fetching.
This ledger keeps moving on `ws/amber-summit` (pushed after every wave) and lands on `main` with the final wave.

Execution shape, every wave: the worker invokes `superpowers:subagent-driven-development` on its own
workspace branch — fresh implementer subagent per task, task review after each, whole-branch review at the
end — then pushes, opens the PR and mails `wave-done`. The coordinator re-measures, reviews the PR with an
independent lens, merges, deploys (agent-first where the wave says so), and briefs the next wave.

Ledger block: **D-1663–D-1688** — minted in ONE allocator call on 2026-09-05 at plan time (floor 1689) and
FULLY DEFINED across the six plans (wave 4 defines none). It is not a reserve: a deviation found during
execution gets its own allocator call (see Decisions, "execution-time deviations").

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | Roster substrate: `AccountDef.pool` + `POOL_NAME_RE`, the bare-`node` mirror (closes D-1663), `_ccrc_pool()` in `accounts.sh`, `RosterWire.pool` + project-pool wire vocabulary, `shared/poolrule.ts` (D-1664), fixture table. NOT agent-first. | run 32, PR #57 (merged `07ce360e`) | **done 2026-09-06 11:11 UTC** — 19 commits, 15 files, +1572/-70; one fix round after a three-lens coordinator review; CI 5/5 on `bf2c66f4`; deployed SERVER LANE from the merge sha, `/health` reports `07ce360e`, unit stable. D-1663, D-1664 defined; D-1741, D-1742 (two rounds), D-1743 issued mid-wave |
| 2a | `ccd` reader + `project-pool` verb + `_pool_ok` + placement + agent grant + `POOLS_CAP` + doctor + `rehome`. AGENT-FIRST. | run 33 | opened 2026-09-06 11:11 UTC — same workspace `clear-meadow`, reclaimed; **dispatched 2026-09-06 11:12 UTC** — `resumed:true`, `/clear` injected, `briefQueued:true`, `skillState:present`, 9 items |
| 2b | `ccd` deciders: auto-swap tick, strand, crossing marker, four manual verbs. AGENT-FIRST. | — | not opened |
| 3 | Server L1/L3 (`pools.ts`, `poolrule.ts` wrapper), registry `stranded`, routes, watcher frame, health. | — | not opened |
| 4 | PWA: `accountPool`, `splitByPool`, `PoolSheet`, chips, sheets, store slot. Defines no deviation. | — | not opened |
| 5 | README, `CLAUDE.md`, `config.ts` / `ccd` comment corrections. | — | not opened |

## Decisions & deviations

- **Program shape (2026-09-05):** the operator chose subagent-driven execution and asked that ccrc's own
  capabilities be used fully. Ruling: the program runs through the coordination machinery — one run row per
  wave, a dispatched worker per wave in ONE workspace (resumed and `/clear`ed by dispatch from wave 2a on),
  briefs by mail, `wave-done` re-measured by the server, items settled only after `advance` answers `ok`.
  The worker runs SDD inside its wave; the coordinator never does a wave's own work. Costs if wrong: a
  dispatch machinery stall costs a wave's wall-clock, never its code — the plans stand on their own.
- **Docs merged first (2026-09-05):** the plans were finished and approved before execution, so they go to
  `main` in a docs-only PR ahead of wave 1 rather than living on the coordinator's branch for workers to
  fetch (the program-leverage/registry-durability precedent, D-108, existed because those plans were written
  per wave). Consequence: `deviation-refs` on every wave branch compares the same plan set against `main`
  — trivially green — and the plans' `Base: origin/main 2b15144e` line is provenance, not the base a wave is
  cut from (dispatch bases on `origin/HEAD` at spawn time).
- **Execution-time deviations (2026-09-05):** coordinator clause 10 (a worker never calls the allocator
  mid-wave) and the plans' Global Constraint (an execution-time deviation is allocated the moment it is
  found) are reconciled as: the worker writes the full entry under `D-TBD-<slug>` in the wave plan's
  `## Deviations found`, mails the coordinator (`kind:status`, `subject:deviation-request`, the slugs and
  count, this wave's `runId`), the coordinator mints exactly that many with `ccrc-api ledger allocate` and
  mails the numbers back (`kind:answer`), and the worker substitutes before `wave-done`. `dtbd.test.ts`
  refuses any surviving placeholder, so a PR cannot go green with one. No spare numbers are pre-minted —
  a minted number is defined in the same act or not minted.
- **Concurrent program:** `battlescape-operational` (MekWarLive, run 31, wave 8/9) is active. Every
  `toId:'coordinator'` mail in this program MUST carry this wave's `runId`; the runId-less form resolves
  only when exactly one program is active. Briefs restate this.
- **Deploy after wave 1:** not agent-first. Server lane only, from the merge sha; `accounts.sh` regenerates
  with `_ccrc_pool` on the fleet box only when the agent lane ships (wave 2a), so `rosterAgreement` may read
  `divergent` between the two — spec §5.3 names this as expected and the banner's remedy stands.

- **Wave 1 pre-flight (worker, 2026-09-06 06:12 UTC):** before Task 1 was dispatched the worker audited the plan against the
  tree and found one blocker plus one important defect, both in SHIPPED source rather than plan prose, plus nine
  prose defects it corrected without ledgering. I minted **D-1741** and **D-1742** for the two (allocator call,
  project `ccrc-pwa`, count 2, floor now 1743) and mailed them back — the program's own D-1663–D-1688 block is
  fully defined and is never a reserve. **D-1741** — the purity scan the plan listed for `shared/poolrule.ts`
  blanked block comments with a lazy regex whose first `/*` sat inside a LINE comment, so it swallowed the
  `import type` line, found zero imports and reded on its own vacuity tripwire; the guard would have shipped
  measuring nothing, and the task's proving mutation produced no new red. Closed by rewording the module header;
  the tripwire stays, because it is what caught it. **D-1742** — the plan mandated a comment into
  `shared/roster-json.mjs` claiming its grammar copy is pinned equal "by text extraction rather than by hope";
  nothing pins that copy (wave 2a's parity test reads `ccd/ccd` and `ccrc-doctor-checks`, never a `.mjs`, and
  `single-definition`'s source filter is `/\.tsx?$/`). Closed by naming what actually holds it — behaviour, via
  the `gen-accounts` REJECT table — and adding a row one character past the 32-char cap, the one drift that
  separates the two spellings. Ruling: both are real and worth numbers; the nine prose corrections are not.
  Cost if wrong: two ledger numbers spent on findings a reviewer would have called plan-only.

- **Wave 1 review (coordinator, 2026-09-06 09:21 UTC):** three independent lenses on the branch package — contract/spec,
  test integrity, safety/topology — none shown the others' output. Contract and safety returned MERGE with
  nothing above Minor: all nine produced names exist with the spelling later waves import, `poolRule` decides
  all eight spec cases identically with the undecidable-before-untagged precedence measured, the wire is
  additive with `FLEET_PROTO` untouched, no real identifier reaches a tracked file, and the `ccd/`+`deploy/`
  diff is genuinely empty. Test integrity returned two I re-measured and confirmed myself, both the wave's own
  recurring class in its last unswept corner — a table whose `why` claims a discrimination its rows do not
  make. **(1)** `POOL_RULE_CASES`'s `mismatch-on-a-prefix` row claims to catch a TypeScript `startsWith`; it
  catches only the project-prefixes-account direction. Measured over all 13 rows: `a.startsWith(p)` and
  `a.includes(p)` both SURVIVE; only `p.startsWith(a)` reds. The account is the shorter string, so the mirror
  row is missing. Wave 2a drives its bash `_pool_ok` through this same table, so the hole is in two languages.
  **(2)** the `gen-accounts` REJECT block is the only thing holding `roster-json.mjs`'s hand-copied
  `POOL_NAME_RE` equal to the parser's — D-1742's own conclusion — and it does not hold: three tail-charset
  widenings of the mirrored literal survive every row, because every pool row fails on its FIRST character or
  on length or type and none pairs a legal first character with an illegal tail one. Each widening makes the
  mirror LAXER than the parser, which is `hidden`'s shape exactly (D-1663). Ruling: rows are the wrong
  mechanism — I measured that no single row closes it, the class of tail widenings being open — so the fix is
  the text extraction D-1742 stopped one step short of building: extract the `.mjs` literal and assert it
  equals `POOL_NAME_RE.source`. Run returned to `working`, findings mailed as 223, one fix round.
  **Ruled NOT a fix:** a hostile string pool reaching `generate.mjs`'s emitter unescaped. Both producers refuse
  shell metacharacters before a value can arrive, `id` and `hue` ship on identical terms in the same emitter,
  and the safety lens independently called it house style. Cost if wrong: an unescaped `case` arm behind two
  validators that both refuse the inputs that would reach it. Carried here rather than fixed.
  **Not findings:** unticked plan checkboxes are this repo's norm (the last two executed plans merged to `main`
  carry them unticked); the offline-snapshot revive gap is already implemented and mutation-pinned in wave 4's
  plan.

- **Wave 1 fix round, numbering ruling (2026-09-06 09:25 UTC):** the worker asked for ONE number, not two, and argued the
  difference. **D-1743** minted for the prefix row — it asked because the defect is not only in the shipped
  fixture but in the PLAN, which lists that row verbatim with the `why` that overclaims, making it D-1741's
  class (plan-mandated text whose guard measures less than its own sentence claims) rather than a fold-in.
  Agreed. For must-fix 2 it proposed taking NO new number and amending D-1742 with a round 2 instead, since
  that entry's subject is the finding "the mirrored grammar is held equal by a comment claiming a mechanism
  nobody built" — an entry closed twice on measurements nobody took is still one finding. **Ruling: endorsed.**
  A second number there would assert to a later reader that a distinct class was discovered, and none was; one
  number, one finding, the whole history in one place. Cost if wrong: a reader tracing D-1742 must read its
  two rounds to see the class was closed by text extraction and not by the rows its first two attempts
  claimed. The worker also ACCEPTED the out-of-scope ruling on the unescaped emitter arm on the argument
  rather than on authority, adding the better reason: making `pool` the one escaped value where `id` and `hue`
  are not would itself be the inconsistency. Numbers spent outside the plan-time block so far: D-1741, D-1742,
  D-1743.

- **Wave 1 fix round VERIFIED and CLOSED (2026-09-06 11:11 UTC).** The worker's fixes were re-measured by me in an isolated
  worktree pinned at `bf2c66f4`, not accepted on report. **D-1743:** the rule table now has 14 rows, and all
  three wrong comparisons red on a named row — `a.startsWith(p)` and `a.includes(p)` on the new
  `mismatch-on-a-project-prefix`, `p.startsWith(a)` on the original — while the correct equality survives, as
  it must. The worker also found a SECOND overclaim in that same sentence which neither I nor the review
  named: the row claimed to catch a bash `==` with an unquoted right side, and no fixture pool name carries a
  glob metacharacter, so nothing there could ever exercise it. Both rows now name that hazard as UNCOVERED and
  hand it to wave 2a as a quoting assertion against `ccd`. **D-1742 round 2:** the extraction block lifts
  `POOL_NAME_RE`, `ID_RE` and `LABEL_UNSAFE_RE` out of the TEXT of both files and requires each pair equal,
  `POOL_NAME_RE` against the imported object's `.source`/`.flags` so one row measures the regex the parser
  actually runs. I measured both directions: drifting the mirror to `^[a-z][a-z0-9.-]{0,31}$` — genuinely
  laxer than the parser, D-1663's own shape — leaves **107 of 108 green, every REJECT row included**, and
  reds only the extraction, with a message naming the deploy hazard; renaming the literal so the extractor
  finds nothing reds BY NAME on its vacuity tripwire rather than passing over nothing. That is the class
  closed, not three instances of it. The REJECT table is deliberately kept: text equality proves the two files
  hold the same pattern and says nothing about whether either side APPLIES it.
- **Merged with a hand-written squash body (2026-09-06 11:11 UTC).** Eight commit-message lines in the branch quote the
  `D-TBD-` slugs the two deviations carried before their numbers were issued, one of them a subject.
  `dtbd.test.ts` scans file CONTENTS, so CI was correctly green — but GitHub's default squash body would have
  landed superseded placeholders on `main`. Verified after merge: the body on `07ce360e` carries none.
  **This is a standing rule for every later wave of this program.**

- **D-1744 (wave 2a, 2026-09-06 11:35 UTC) — the project-pool reader folded three unreadable conditions into `untagged`.**
  `_project_pool_state`'s `[[ -e "$f" ]] || { echo untagged; }`, transcribed verbatim from spec §5.4.3, reads
  `-e` FALSE as absence. I reproduced all three counter-cases myself before minting: a broken symlink, a
  symlink LOOP, and a tag under a mode-000 directory each answer FALSE, indistinguishable from a path that
  does not exist. **Ruling: this is the `no overloaded null at a seam` invariant, not a transcription slip.**
  `untagged` means unconstrained and placement may go anywhere; `unreadable` means nobody knows and placement
  must refuse — so the fold does not lose information, it INVERTS the safe default, and the mode-000 case
  answers `untagged` for every project on the box at once, silently and totally. **The spec is the half that
  is wrong:** §10's failure table already commits to "unreadable != untagged pinned on both sides", and
  §5.4.3's own comment claims ELOOP is caught at the `cat` that `-e` has made unreachable. §5.4.3's BODY is
  the defect; §10 stands. Cost if wrong: a reader of §5.4.3 finds a body its own §10 contradicts, which is
  why the correction is attached to the number rather than left in a wave's transcript.
  **Carried to wave 5** (spec/README text: correct §5.4.3's body and its comment) and **to wave 3** (its
  `readProjectPools` mirrors these four states in TypeScript; `readFileMeasured` already tells absent from
  unreadable, so it has the mechanism — what it needs is to know the polarity question is live here and
  already settled. Restate in wave 3's brief; the worker has also written it into D-1744's own entry, so it
  arrives twice rather than depending on one file being read).
  Found by the worker's own sweep for "comments asserting a mechanism that is not there" — the class its
  brief told it to watch, caught in the code it was transcribing rather than reproduced into it.

- **D-1796 (wave 2a, 2026-09-06 15:13 UTC) — PARKED WITH DISCLOSURE, and the park is CONDITIONAL.** `read -d ''` returns
  non-zero for both end-of-file and a read FAILURE, so a failure past the `-f && -r` guard answers `malformed`
  where the truth is `unreadable`. The worker parked rather than fixed, and asked to be checked because it is
  the opposite call from D-1744 on a similar shape. **Endorsed, and the distinction is the durable rule: the
  overloaded-null invariant is about CALLERS, not vocabulary.** D-1744 folded into the PERMISSIVE direction
  across a seam whose sides are handled differently (`untagged` places freely, `unreadable` refuses); this
  folds into the REFUSING direction across a seam whose sides are handled identically. Same shape, opposite
  verdict. Closing it needs a distinction bash does not expose, i.e. a fork on the 5-second supervise path —
  the one round 3 removed — to improve a MESSAGE. Wrong trade; not spent.
  **Three corrections I required in the entry, no code.** (a) The load-bearing premise — "every decider maps
  both to rc 2" — rests on `_pool_ok`, which I measured as having ZERO definitions on the branch: Task 2 is
  unwritten. That is the wave's own recurring class (an argument resting on machinery that does not exist,
  stated as fact), except the owing wave is the worker's own next task, so it must re-measure and say so
  rather than hedge. (b) The two cases differ in SEVERITY and were filed under one heading: a zero-byte
  failure is a wrong MESSAGE (placement refuses either way), while a partial read that errors after delivering
  a grammatically valid prefix answers `named <prefix>` — a POSITIVE answer permitting placement onto a pool
  the file does not name, which is decision-level. (c) A park needs an unreachability ARGUMENT, not
  "unconstructed": after the `-f` type guard the path resolves to a regular file, and for a regular file on a
  local filesystem the kernel returns a short read at EOF rather than erroring mid-stream (the `/proc/self/mem`
  case delivers zero bytes; devices and FIFOs never open); and `$REG` is not a trust boundary — whoever can
  plant a partially-erroring path there can write a wrong pool name directly.
  **THE CONDITION, to be written as a trip-wire in the entry:** the park holds only while every decider maps
  `unreadable` and `malformed` to the SAME refusal. Different MESSAGES are fine and expected. A different
  DECISION in any later wave retroactively makes this a decision-level fold and the entry must be revisited.
  **Carried to wave 3** alongside D-1744 — that file now owes TWO polarity obligations, and its
  `readFileMeasured` has the mechanism bash lacks: a failed read is `unreadable`, never `malformed`, never a
  name. Both go in wave 3's brief so they arrive twice.
  Note: the allocator floor moved 1745 -> 1797 between this wave's two requests, so another lane published and
  swept in between. Never predict a number.
- **Wave 2a Task 1 took three fix rounds, and they were earned.** The spec's reader body was wrong three
  levels deep: the tag FILE (D-1744), then `$POOLS_DIR` and `$REG` one level up, then open(2) TYPE — a FIFO or
  a symlink to `/dev/zero` made the read BLOCK FOREVER, hanging `cmd_supervise` with no exit code and no word
  on stdout, which defeats the never-dies contract harder than dying would (a supervisor that exits gets
  noticed; one that blocks does not). All closed and reproduced, and round 3 removed a fork and a subshell
  from the hot path rather than adding any.

- **D-1796 AMENDED (2026-09-06 15:17 UTC) — the worker retracted a premise, and the replacement covers only one arm.**
  It mailed a correction before my ruling reached it (the mails crossed): its own "a condition neither of us
  could construct" was FALSE for two of three arms — an EIO via a symlink to `/proc/self/mem` under the pools
  directory is trivially constructible, and its round-4 test constructs it and runs green in 39 ms. The shape
  is worth more than the slip: the phrase propagated from the round-4 dispatch into a CODE COMMENT, where the
  scoped re-reviewer caught it and reded the round — so the overstatement was about to ship inside the
  disclosure written to prevent exactly that class. Corrected in three places by the worker, self-reported
  before I acted. **Not counted against the wave; this is the behaviour the process exists to produce.**
  **My amendment: it struck reachability wholesale, and reachability is load-bearing for the second arm.**
  Its re-derivation — `_pool_ok` maps `unreadable` and `malformed` alike to rc 2, so no decider distinguishes
  them — is structural and strictly stronger than a rarity argument, but ONLY for the zero-byte arm, where the
  read delivers nothing, the token is empty and the reader answers `malformed`. **The partial-read arm never
  reaches that argument at all:** a read erroring after delivering `pool-a` from a file holding `pool-abc`
  leaves a grammatically VALID token, so the reader answers `named pool-a` — rc 0, a positive answer, and
  `_pool_ok`'s rc-2 arm is never entered. Placement proceeds onto a pool the file does not name. The caller
  argument cannot carry an arm that never becomes a caller question, so striking reachability there left it
  parked on nothing.
  **Required: two arms, two justifications, labelled.** Zero-byte parks on the CALLER argument (reachable,
  constructed, costs a message and never a placement — the strongest form the park has). Partial-read parks on
  REACHABILITY in those words: decision-level, unconstructed rather than impossible, the weaker park, carrying
  the argument for why it is judged unreachable (after the `-f` guard the path is a regular file, and regular
  files short-read at EOF rather than erroring mid-stream; `$REG` is not a trust boundary). The worker's
  instinct that "a park needing the condition to be rare was not the park I meant to make" is right for the
  first arm and wrong for the second — the second IS a rarity park and the honest move is to label it one.
  **No round spent:** a fork cannot close arm two either, since `read` never reports a short read; it would
  need a size comparison, which is a bigger change than this deserves on the supervise path.
  **The trip-wire now covers both arms:** if any later wave makes `named` reachable from a failed read, or
  gives `unreadable` and `malformed` different DECISIONS, this entry is void and reopens.

- **D-1798 (wave 2a, 2026-09-06 16:05 UTC) — `pools-v1` is advertised one wave before `--cross-pool` exists. RULED: keep the
  token in 2a, and the window is closed by MECHANISM, not by wave ordering.** The worker escalated rather than
  decided, correctly: this is a cross-wave contract. Its analysis of the hazard was right — the token gates
  exactly one server decision (may the server build a `--cross-pool` argv, wave 3), `capSupported` refuses on
  no evidence precisely because a wrong guess is a SILENT SUCCESS, and 2a advertises the token while unable to
  honour the flag. Its conclusion that only wave ORDERING stands in the way was wrong.
  **What actually closes it is the flag's POSITION.** Spec §5.6 puts `--cross-pool` LEADING, before the
  positionals, and wave 3's plan already pins that token-for-token with the reason attached: a trailing flag on
  an old ccd's `start w p wd` is a silently ignored fourth positional, while a leading one lands in a slot
  `_is_valid_wrapper` refuses. **I measured all three verbs on the worker's branch rather than trusting the
  plan:** `swap --cross-pool <id> <w>` puts the flag in `id` and the session id in `target`; `start` and
  `enable` put it in `wrapper`. All three die nonzero, so `runCcdOr502` renders a loud 502 — never the silent
  200. That holds on every ccd that has ever shipped, which is stronger than anything this program could add.
  **Required of 2a: the PIN.** The mechanism exists but the wave that CREATES the exposure measures nothing —
  wave 3 pins that its builders emit a leading flag, and nobody pins that today's ccd refuses one. Different
  claims; only the second makes the early token safe. Three assertions, no code change. The wave that creates
  an exposure owes the proof it is safe rather than borrowing one from a wave not yet written.
  **Nuance found while measuring:** `cmd_enable` runs `_lc_done enable "$id" ""` BEFORE delegating to
  `cmd_start`, so a skewed enable writes a limits-ledger entry for a bogus id and only then dies. Harmless, no
  fix, but "dies before doing anything" would be false of that verb — recorded because this program has twice
  been bitten by a disclosure claiming slightly more than it measured.
  **Option (a) — move the token to 2b — declined on the merits, not on cost:** with the position mechanism
  measured it buys nothing the flag order does not already buy, and would rewrite two other plans and this
  wave's pinned rows. The worker also fixed a comment above `echo pools-v1` that asserted `_pool_ok` runs at
  "every account decision" and that `--cross-pool` exists: measured, `_pool_ok` has ZERO call sites at
  `ccd/ccd:1279` and all three `--cross-pool` hits are comment text; it gains exactly one caller this wave.

- **D-1847 (wave 2a, 2026-09-06 16:12 UTC) — `project-pool --clear` reports success over a tag it did not remove.** The
  `rm` is guarded by `[[ -e "$POOLS_DIR/$project" ]]`, and `-e` is FALSE for a dangling symlink, so the removal
  is skipped, nothing fails for `|| die` to catch, the verb prints `untagged` and exits 0 — while the symlink
  survives, the reader still answers `unreadable`, `_pool_ok` still refuses, and placement stays BLOCKED with
  the operator told the constraint is gone. Reproduced. **The worker's framing is the right one and is why it
  earned a number: an adapter narrowing a distinction it received** — the repo's own highest-yield rule. The
  verb computes `oldstate=$(_project_pool_state "$project")` on line 14 and is HOLDING the word `unreadable`
  when it reaches the `-e` test on line 18. The reader learned this under D-1744 two lines away; the writer
  never did.
  **My addition, measured before ruling: the obvious fix does not close the class.** `[[ -e … || -L … ]]`
  leaves an identical false success one shape over — a tag under an unsearchable `$POOLS_DIR` answers FALSE to
  BOTH, since neither can stat through a mode-000 directory, so the `rm` is skipped again and the verb exits 0
  again. It would have shipped as a fixed bug. **Ruling: decide from `$oldstate`, not from any fresh filesystem
  test.** The defect is not that `-e` is the wrong predicate but that the verb asks the filesystem a SECOND
  time with different semantics, having already asked through the one reader whose job is that question — two
  readers of one fact, disagreeing, where spec §5.1 makes ccd (and so `_project_pool_state`) the authority.
  Branching on the word gives the verb one reader, closes both shapes and every shape the reader already
  handles, and inherits future reader fixes for free. Required red: the mode-000 case specifically, so the
  next person to touch it does not reach for `-L` for the same good reason.
  **Wave 3 obligation, sharpened:** its route re-reads through the agent and would answer a measured
  `unreadable` while ccd exited 0. The entry must say which side is wrong — the SERVER is right, the VERB is
  wrong, and the server's correctness is not a mitigation because a shell operator never sees the server.
- **A habit, not five slips (wave 2a, 2026-09-06 16:12 UTC).** Five present-tense comments asserting later-wave machinery in one
  wave, three of them in text the worker's own dispatches dictated. Diagnosis: dictated comment text is written
  BEFORE the code exists, so the present tense is natural and wrong at the moment of writing. The remedy is
  structural — write dictated comments in the obligation tense by default and let the wave that lands the
  machinery flip them — not more care. **Carried to wave 2b, whose plan dictates comments the same way.**

- **THE PROGRAM'S SHARPEST LESSON SO FAR (2026-09-06 16:46 UTC), from wave 2a's worker, adopted in its words:** *a false
  success is not fixed by choosing a better PREDICATE, nor even by deciding from the right AUTHORITY, until
  the ACT's result is measured against that same authority.* Three rungs, discovered one shape at a time in
  D-1847: `-e` was the wrong predicate (shape 1); `$oldstate` was the right authority and still only chose the
  right ACTION (shape 2); and `rm -f` returns 0 for a real removal, for ENOTDIR through a regular file at
  `$POOLS_DIR`, and for ENOENT through a dangling symlink there — **measured, three cases one exit code** — so
  the RESULT was still inferred from a status that cannot carry it (shape 3). Remedy: re-measure with
  `_project_pool_state` after the act and refuse unless it answers what was asked. **Carried to wave 2b and
  wave 3**, both of which ship write paths.
  I also required the ladder be applied to the verb's SET arm or its exemption argued in the entry: its
  `mkdir -p` / `printf` / `_plat_mv_notdir` chain each report failure honestly and I could construct no defect,
  but the third rung is about the exit code meaning "the state you asked for now obtains", which today means
  "three syscalls returned 0". An unexamined asymmetry between two arms of one verb is where the next shape
  hides.
- **D-1847 extended, not split (2026-09-06 16:46 UTC).** The worker asked whether shape 3 warranted its own number, since the
  mechanism differs (`-f` swallowing an error versus `-e` being false). **Ruled: extend.** Same defect, same
  verb, same act, found by the review OF its own fix — and this is the identical call as D-1742's round 2,
  already the ledger's standing shape. Splitting would tell a future reader three bugs were found where one
  defect had three shapes and taught one lesson.
- **D-1798's lock claim was MINE and it was wrong (2026-09-06 16:46 UTC).** I measured `swap --cross-pool <id> <w>` with a
  session id that is not a roster id, watched `_is_valid_wrapper` refuse the shifted target, and wrote
  "refused by `_is_valid_wrapper`" into mail 236 as a general mechanism claim — one measurement generalised
  into a ledger sentence, in the same mail that told the worker not to do that. The worker inherited it in good
  faith and its round-2 re-reviewer caught it. **Corrected:** on the swap arm the flag lands in the `id` slot,
  which is never wrapper-validated; the refusal comes from `_is_valid_wrapper` only when the shifted TARGET is
  not a roster id, and otherwise from `no registry for '--cross-pool'`. The conclusion stands — every path
  exits nonzero, the 502 is loud, the early token is safe — but by a CONJUNCTION, not one lock, so both paths
  are now pinned rather than whichever one the fixture happened to trip. D-1798's entry names the coordinator
  as the source of the wrong claim; a ledger that hides where a claim came from teaches nothing.

## Carried constraints

- Fixture pool names are `pool-a`, `pool-b` (`pool-ab` once, wave 1 Task 5) — never a real pool or account
  name in any tracked file. `topology-clean` and `single-definition` scan the whole tracked tree.
- `FLEET_PROTO` stays 1; every new field is additive with ONE reader; older-peer omission tolerated.
- No overloaded null at a seam: `unreadable` / `malformed` / `untagged` stay distinct everywhere.
- `EXEC_COMMANDS = ['tmux','ccd']` stays closed; no `gh` grant, ever.
- L0 `shared/*.ts` imports nothing (not even `node:*` types); `shared/poolrule.ts` imports only types from `./api.js`.
- Every guard ships with a test measured RED on its deletion — before and after, not asserted.

## Next-wave brief

**Wave 2a is dispatched as run 33** — its brief is reproduced below the wave-1 one, which is kept as the
record of what that worker read.

**Wave 1 brief, as dispatched 2026-09-05 23:46 UTC (run 32, worker `ccrc-pwa-clear-meadow`)** — the text below is what the worker read, after dispatch's own `ccrc-worker` prefix:

> Program `account-pools`, WAVE 1 of 6, run 32. You are its dispatched worker; I (`ccrc-pwa-amber-summit`) am the coordinator and I am asleep until your mail wakes me.
>
> WHAT THIS WAVE IS. The roster substrate for account pools: `AccountDef.pool` + `POOL_NAME_RE` in `shared/roster.ts`; the bare-`node` mirror `shared/roster-json.mjs` learns `pool` and closes its `hidden` gap (D-1663); `shared/generate.mjs` emits `_ccrc_pool()` into `accounts.sh` always; `shared/api.ts` gains `RosterWire.pool` and the project-pool wire vocabulary; new L0 `shared/poolrule.ts` spells the rule once (D-1664); the fixture table `server/test/fixtures/poolRule.ts`. Six tasks, Task 6 is the whole-branch gate. Nothing under `ccd/` moves — this wave is NOT agent-first and you do not deploy anything.
>
> YOUR REQUIREMENTS, in this order of authority: the wave plan `docs/superpowers/plans/2026-09-05-account-pools-wave1-roster.md` (in your tree — it was merged to `main` before you were spawned), then the spec it argues from, `docs/superpowers/specs/2026-09-04-account-pools-design.md`. The program ledger is `docs/superpowers/programs/account-pools.md`. Read the plan's Global Constraints and its Wave map once; the map tells you what later waves import from you by exact name, so do not rename anything it lists.
>
> EXECUTION SKILL: invoke `superpowers:subagent-driven-development` and run it as written — the plan's own header requires it. Fresh implementer subagent per task (Tasks 1–6), a task review after each, the fix loop bounded at five rounds, a whole-branch review at the end on the most capable model available to you, rulings ledgered in `.superpowers/sdd/<plan-basename>/progress.md`, never a stall on a question the spec answers. Model selection is yours per that skill; the plan text carries complete code for most steps, so most implementers are transcription-tier. Implementers never spawn subagents or reviewers.
>
> BRANCH: commit on THIS workspace's own branch (`ws/<your slug>` — `git rev-parse --abbrev-ref HEAD`), never a separate feature branch. When `superpowers:finishing-a-development-branch` offers its choice at the end, take "push and open a pull request" — never merge; merging is mine. Base your diff on `origin/main` (`git fetch origin` first), never a local `main`.
>
> DONE MEANS: all six tasks complete with the SDD final review clean or its residuals parked with rulings; the plan's Task 6 gates green (full server/agent/pwa suites in the FOREGROUND with timeout >= 600000 ms, `cd pwa && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`, `deviation-refs` against a fetched `origin/main`, `single-definition` + `topology-clean` + `dtbd`, the five touched suites in isolation, `git diff --stat origin/main...HEAD -- ccd/ deploy/` EMPTY); branch pushed; PR opened against `main` with `gh pr create` from your shell (works there — it is the PWA-to-agent path that has no `gh` grant), title `feat(pools): wave 1 — the roster's pool field, its two mirrors, and the rule spelled once (D-1663, D-1664)`, body naming the plan by repo path and listing the rulings your SDD controller made; all four CI checks green (`test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`). Then mail me `wave-done`.
>
> WAVE-DONE MAIL: `kind:"status"`, `subject:"wave-done"`, `toId:"coordinator"`, `runId` 32, body = prose plus the fingerprint as JSON exactly in this shape: `{"branchTip":"<40-hex>","prNumber":<n>,"prPhase":"open","handoffCommit":"<the same 40-hex>"}` — both shas identical, the tip you measured with `git rev-parse HEAD` after your last push. After sending it, STOP PUSHING; a new commit makes your own claim stale. Prose in that mail: commits count, suites run with counts, deviations (numbers or TBD slugs), the rulings list from your SDD ledger, anything a later wave must know that its plan cannot see.
>
> MAIL RULES SPECIFIC TO THIS PROGRAM: another program is active on this fleet, so EVERY mail you send to `coordinator` carries `"runId": 32` — the runId-less form will not resolve. A question only I can answer (a plan/spec conflict you cannot rule on, a gate that reds for a reason outside your diff) is `kind:"question"` to me with the runId; do not wait on it idle — work what does not depend on the answer. Questions for the OPERATOR ride AskUserQuestion, as your skill says; use that only for a decision neither the spec nor I can settle. Also send me one `kind:"status"` `subject:"underway"` mail once Task 1's implementer is dispatched, so I can advance the run to `working` — one line is enough.
>
> DEVIATIONS: the program's block D-1663–D-1688 is FULLY DEFINED across the six plans; this wave's two, D-1663 (Task 2) and D-1664 (Task 5), are defined in the plan's `## Deviations found` and referenced by its `LEDGER:` lines — cite them, do not redefine them. You never call the allocator. A deviation you FIND during execution: write its full entry in the plan's `## Deviations found` under `D-TBD-<short-slug>`, keep working, and mail me `kind:"status"` `subject:"deviation-request"` with the slugs and the count; I mint exactly that many and mail the numbers back (`kind:"answer"`); you substitute before `wave-done`. `dtbd.test.ts` refuses a surviving placeholder, so the PR cannot go green with one — batch the request if you can, but never invent a number and never take one from a gap.
>
> SAFETY, restated because it is cheap: tests run against FIXTURE homes only (`mkTmp`, `seedRoster`, `seedAccountsSh`, `makeCcdHarness`), never the live `$HOME`; never run any `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit; never print a secret file's contents; no real account, pool, host or IP anywhere — fixture pool names are `pool-a`, `pool-b`, `pool-ab`. The repo's pre-push hook refuses a blob carrying the operator's username or an absolute worktree path: write repo-relative paths in anything you commit.
>
> GRAPH: if your SessionStart card names a knowledge graph for this tree, weigh its freshness clause per your clause 12 and query it before grepping; search tools may be gated until your first `graphify query`. If the card says nothing, there is no graph here yet — proceed without one, never build one.
>
> Do not update `docs/superpowers/programs/account-pools.md` — the ledger is mine. Do not deploy. Do not merge.

---

**Wave 2a brief, as dispatched 2026-09-06 11:12 UTC (run 33, same worker `ccrc-pwa-clear-meadow`, resumed and cleared):**

> Program `account-pools`, WAVE 2a of 6, run 33. Same workspace, fresh wave — dispatch cleared your context, so everything you knew is in the files below, not in your head.
>
> WHAT THIS WAVE IS. The tag on the fleet box and the one predicate every account decision will ask: `$REG/pools/<project>` storage, `_project_pool_state` (four words, never dies — it runs inside the long-lived `cmd_supervise` loop), `_pool_ok` with its THREE exit codes, the `ccd project-pool` writer verb, the agent grant and the two `CCD_ARGV` builders, fresh placement (`_ws_least_loaded [project]`, `cmd_ws_add`'s refusal), `POOLS_CAP`, the doctor check, and the `rehome` lifecycle act in all three vocabularies. Nine tasks; Task 9 is the whole-branch gate AND the agent-first deploy order.
>
> THIS WAVE IS AGENT-FIRST. It touches `ccd/`, so the fleet host ships before the server. You do NOT deploy — report the fingerprint and I run both lanes in order. Task 9 states the order; read it, do not perform it.
>
> YOUR REQUIREMENTS: the plan `docs/superpowers/plans/2026-09-05-account-pools-wave2a-ccd-tag-placement.md`, then the spec `docs/superpowers/specs/2026-09-04-account-pools-design.md`. Program ledger: `docs/superpowers/programs/account-pools.md`. Read the plan's Global Constraints and Wave map once.
>
> WAVE 1 IS MERGED — fetch `origin/main` and build on it. What it produced that you consume, by exact name, none of which you may re-spell: `POOL_NAME_RE` in `shared/roster.ts` (your bash literal is pinned against `POOL_NAME_RE.source`), `AccountDef.pool`, `_ccrc_pool()` in the generated `~/.ccrc/accounts.sh` (your `_acct_pool` reads it), `POOL_RULE_CASES` and `POOLED_TEST_ROSTER` in `server/test/fixtures/poolRule.ts`, and `poolRule` in `shared/poolrule.ts` — the TypeScript spelling your bash `_pool_ok` must agree with case for case, driven through the SAME table.
>
> FOUR THINGS FROM WAVE 1 YOUR PLAN CANNOT SEE:
> 1. `POOLED_TEST_ROSTER` now THROWS at import if a `POOL_BY_ID` key names an id absent from `DEFAULT_TEST_ROSTER`. It was added because a silent miss would have cost your `seedAccountsSh` coverage one `_ccrc_pool` arm invisibly. A mutated fixture fails at COLLECTION with the guard's own message, not as a wrong assertion downstream.
> 2. `accounts.sh` now emits SIX functions, up from five. TWO comments under `ccd/` still say five: `ccd/ccrc-wrapper-shape:41-43` and `ccd/ccrc:1030`. Wave 1 could not touch them — its own gate required an EMPTY `ccd/` diff. **You are in `ccd/` anyway: fix both, this wave.** Wave 5's plan names neither file, so if you skip them nobody else is scheduled to.
> 3. The pool rule's precedence is load-bearing and easy to get wrong invisibly: `unreadable`/`malformed` are decided FIRST, before either untagged shortcut. An unreadable tag over an untagged ACCOUNT still answers undecidable — the constraint is unknown, not absent. Every other row of the table hides this ordering mistake.
> 4. **A hazard wave 1 could not measure and handed you deliberately.** `POOL_RULE_CASES`'s two prefix rows say in their own text that they do NOT cover a bash `==` with an unquoted right side: no fixture pool name carries a glob metacharacter, and the no-real-names constraint means none ever can. You are the wave that can measure it — assert the QUOTING in `_pool_ok` directly rather than hoping a table row reaches it.
> 5. `deviation-refs` green does NOT mean "this block is this branch's alone" — the plans are already on `main`, so the same file defines the same numbers on both sides. Green means no OTHER plan defines an allocator-era number you also define.
>
> EXECUTION SKILL: invoke `superpowers:subagent-driven-development` and run it as written — fresh implementer per task, a review after each, the fix loop capped at five rounds, a whole-branch review at the end, rulings ledgered. Wave 1 ran ~110 findings across seven rounds with every finding handed to an independent refuter; roughly half were refuted. That refutation step is why its guards ended up measuring something. Keep it.
>
> WATCH FOR WAVE 1'S RECURRING DEFECTS, which cost it four fix rounds: (a) guards that measure NOTHING — a scan whose regex ate the line it counts, a row floor one below the row count, a predicate whose mutation left every suite green; prove each guard by MUTATING its subject, not by deleting the gate; (b) comments asserting later-wave machinery as present fact — if wave 2b or 3 owes it, write it as an obligation naming the owing wave, not as a report.
>
> BRANCH: commit on THIS workspace's own branch, never a separate feature branch. Base on `origin/main` after `git fetch origin`. At the end take "push and open a pull request" — never merge; merging is mine.
>
> DONE MEANS: all nine tasks complete, the SDD final review clean or its residuals parked with rulings, Task 9's gates green, branch pushed, PR opened against `main`, all CI checks green. Then mail me `wave-done`.
>
> WAVE-DONE MAIL: `kind:"status"`, `subject:"wave-done"`, `toId:"coordinator"`, `runId` 33, body = prose plus the fingerprint JSON exactly: `{"branchTip":"<40-hex>","prNumber":<n>,"prPhase":"open","handoffCommit":"<the same 40-hex>"}` — both shas identical, measured after your last push. Then STOP PUSHING. Say what waves 2b/3/4/5 need that their plans cannot see.
>
> MAIL: every mail to `coordinator` carries `"runId": 33` — another program is active and the runId-less form will not resolve. Send one `subject:"underway"` line when Task 1's implementer is dispatched. Deviations found during execution: write `D-TBD-<slug>` in full in the plan's `## Deviations found`, mail me `subject:"deviation-request"` with the slugs and count, I mint and mail back, you substitute before wave-done. Never invent a number; the program's D-1663–D-1688 block is fully defined and is not a reserve. Numbers spent so far outside it: D-1741, D-1742 (two rounds), D-1743 — all wave 1.
>
> SAFETY: fixture HOMEs only (`makeCcdHarness`, `mkTmp`, `seedRoster`, `seedAccountsSh`) — never the live `$HOME`, never a `ccd` verb against the live host, never tmux, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit. Never print a secret file's contents. `EXEC_COMMANDS` stays `['tmux','ccd']`; no `gh` grant, ever. No real account, pool, host or IP in any tracked file — fixture pools are `pool-a`, `pool-b`, `pool-ab`. Write repo-relative paths in anything you commit; the pre-push hook refuses a blob carrying an absolute worktree path.
>
> ONE RULE FOR YOUR PR, learned at wave 1's merge: eight of that wave's commit messages quoted `D-TBD-` slugs from before the numbers were issued, one as a subject. `dtbd.test.ts` scans file CONTENTS, not messages, so CI is green either way — but a default squash body lands superseded placeholders on `main` forever. Keep placeholder slugs out of commit SUBJECTS, and expect me to write the squash body by hand.
>
> Do not update the program ledger — it is mine. Do not deploy. Do not merge.
