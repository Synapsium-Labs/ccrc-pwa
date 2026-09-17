# ccd-queue — program ledger

**Run 42** (`ccrc-pwa`, wave 1 of 1), coordinator `ccrc-pwa-amber-summit`.
Plan: `docs/superpowers/plans/2026-09-09-ccd-queue-platform-shim-and-doctor-coverage.md`,
merged to `main` as **PR #79 → `297a0a81`** (2026-09-10 11:27Z).

Deviations already allocated AND defined in that plan: **D-2187–D-2193, D-2224** (Parts A–C, reported
from outside this program by `claude-OpenClawHetzner`) and **D-2347, D-2376–D-2381** (Part D).

---

## 2026-09-10 11:2x — plan on main, run opened, **dispatch REFUSED on the concurrency cap**

Operator ruling of 2026-09-09 was to spawn this workspace once #69 merged. #69 merged at 07:21Z, #78 at
`29e634b3`, and the plan reached `main` at `297a0a81` — worker workspaces are cut from `main`, so the
plan had to land first or the brief would name a document the worker cannot read.

`POST /api/runs` → **run 42**, `planned`. `POST /api/runs/42/dispatch` → **refused**:

    {"ok":false,"refused":"cap-concurrency","limit":7,"running":7}   HTTP 409

**The cap is right and I am not raising it.** Measured at the moment of the refusal:

| | |
|---|---|
| load average | **112.62 / 137.55 / 97.06** |
| live tmux sessions | 30 |
| slots | 7 of 7 |

The seven: run 31 `battlescape-operational` (MekWarLive), run 35 `account-pools` (this program's own
worker, finishing wave-3 Tasks 11–12), run 36 `crossrepo-programmes`, and **four runs of
`bug-fix-waves`, all "wave 1/6", all claimed by `expoAI-assistant-still-river`** (37, 38, 39, 40), with
a fifth (41) `planned` behind them.

`POST /api/coord/caps` would let me raise `maxConcurrentWorkers`, and doing it at load 112 would be
using a session-gated route to defeat the one mechanism protecting the box. **The cap is
`dispatch.ts`'s step 2, ahead of any spawn, and its refusal carries both numbers on purpose** — *"a cap
that refuses without saying what it is is indistinguishable from a bug"*. It said what it is. That is
the mechanism working, not an obstacle.

**Run 42 stays `planned`, which costs nothing** — `planned` rows are not counted in `usage.running`
(the seven above are `dispatched`+`working`), so nothing is held and no slot is reserved. The brief and
its 25 items are composed and measured (5362 bytes against the 8090 ceiling; 25 items against 32) and
will dispatch unchanged the moment a slot frees.

**Not mine to rule on, but worth recording:** one program holding four of seven slots for the same
wave number, one session, is the shape that makes this cap bind for everyone else. If that is
deliberate it is fine; if it is four rows where one was meant, it is worth someone's look.

## 20:5x UTC — the Part D census is adjudicated, and the blocker was the sum, not the sites

Run 42 was held on two things: the concurrency cap, and my own unresolved reading of Part D's site
count. The second is now settled and the plan is corrected at `ws/amber-summit`.

**Ruled: the sites are right, the total is wrong.** Counting what Part D enumerates — D1 one, D2 five,
D3 one, D4 two, D5 one — gives **ten mandatory**, and D8 then names four further groups, two of which
D8 itself makes conditional and one of which (`cmd_supervise`'s darwin arm) is dead on a Linux fleet.
Ten plus four is fourteen; twelve is reachable only by silently choosing two of D8's four, and the
document never says which. That is the whole of the "12 versus 14" question I had been carrying.

**Measured, not reasoned** (`origin/main`, 2026-09-10, by symbol because every line anchor in Part D
predates #69/#78/#79 and has drifted): `[[ -e "$REG/$id.hold" ]]` returns **six** gates, and exactly
**five** of them are followed by a `cat` of that same path. The sixth is `_auto_swap_check`, which
reads nothing after its gate and is correctly out of class. **D2's five is measured-correct** — the
defect was never in a group, only in the sum.

**The correction** (D-2475, allocator-issued): the headline no longer quotes a number, D7's mutation
table takes one row per site the worker's own census returns, and D-2376's "twelve open sites"
sentence now points at D-2475 rather than being rewritten — the per-group findings stand.

**What this changes for dispatch.** The brief is unchanged and still measures inside both ceilings.
Run 42 remains `planned` and now waits on ONE thing, capacity, not two. The worker will be told to
derive the census itself and navigate by symbol; it must not carry a total out of the plan.

## 23:3x UTC — a slot freed and I am STILL not dispatching, for a reason the cap was hiding

Capacity dropped to 6 of 7, so the blocker I recorded two entries ago is gone. Run 42 stays `planned`
anyway, on two grounds, and the second one only became visible once the first stopped masking it.

**1. The corrected plan is on a branch the worker would never read.** D-2475 corrected Part D's
headline and its mutation table on `ws/amber-summit`. A dispatched worker cuts its workspace from
`origin/main`, where the plan still says **twelve guard sites** and still carries the drifted line
anchors. Dispatching now would hand a worker the exact document I just ruled wrong, and the brief
saying otherwise does not help: the plan is what a worker executes task-by-task, and a brief that
contradicts its own plan is the coordinator asking someone to hold two stories at once. The
correction has to reach `main` first — which puts it behind the same review-approval gate #81 is
stuck on, so it is one blocker, not two.

**2. The last slot belongs to the primary program.** account-pools wave 5/6 is the next dispatch on
this fleet's critical path. Opening it costs nothing (`planned` rows are not counted), but
dispatching it needs a slot, and the handoff is tight: open wave 5, close run 35 to free
`clear-meadow`, dispatch wave 5. Spending the one free slot on the secondary program before that
sequence runs would be me creating the cap refusal I complained about two entries ago.

**Standing position, so the next reader does not have to re-derive it:** run 42 dispatches when the
Part D correction is on `main` AND the account-pools wave-5 handoff has taken its slot — in that
order. The brief and its 25 items are unchanged and still measure inside both ceilings.

## 2026-09-15 14:2x UTC — condition (b) is met; condition (a) goes to main as PR #113

The standing position above had two conditions. **(b) is met**: account-pools' wave 6 (run 47)
dispatched 13:30 UTC into a freed slot; usage 6 of 7. **(a) was never going to happen by itself** —
D-2475's correction (`c2921c4c`) sat on `ws/amber-summit`, a ledger branch no PR carries, for four
days, and the position named the blocker without naming who moves it. Moved: **PR #113**, a fresh
branch off `origin/main` (`47eff69a`) carrying the plan file alone — 23+/4−, exactly the D-2475 delta
(headline, D7, D-2376's pointer, the D-2475 entry). `deviation-refs` 31/31 on that branch; CI green;
MERGEABLE, BLOCKED on approval.

**Run 42 stays `planned` until #113 merges** — a worker cuts from `origin/main`, and dispatching
before that hands it the twelve-site headline this ledger ruled wrong. Once it merges, the seventh
slot is a judgment surfaced to the operator, not taken: the fleet would sit at 7/7 until #108's cap
change (idle states stop counting) deploys, after which the question dissolves.

**Ruling:** carry D-2475 by a one-file PR, not by a PR from the 146-commit ledger branch. Costs if
wrong: one more docs PR to review.

## 2026-09-16 10:5x UTC — condition (a) is MET: D-2475 is on `main`

**PR #113 merged as `f6be1fef`** at 10:06:55 UTC. The correction that sat on `ws/amber-summit` for five
days — Part D's headline no longer quotes a cardinal, D7 takes one mutation row per site the worker's
own census returns, D-2376 points at D-2475, and D-2475 is defined — is now on the ref a worker cuts
its workspace from. **Both standing conditions are now satisfied**: (a) here, (b) on the 15th when
account-pools' wave 6 took its slot.

**Run 42 stays `planned` on capacity alone, and capacity alone.** The fleet reads 7/7, but that is the
OLD cap formula: #108 (review runs) merged nine minutes before #113 and is **not deployed**, and run 64
sits at `awaiting-review` still counting. The merged formula treats `awaiting-review` as idle. So the
real blocker is one server deploy, not a wave.

**Standing position, restated so the next reader does not re-derive it:** dispatch run 42 the moment
`capsUsage().running` measures below the limit. Nothing else is outstanding — the brief and its 25 items
are unchanged and still measure inside both ceilings (5362 bytes against 8090; 25 items against 32), and
the worker will derive Part D's census itself rather than carry a total out of the plan.

**One thing that DOES change for any wave after this one:** `homeProject` becomes required on every
`POST /api/runs` once programme `home-project-flip` deploys (peer mail 1405). ccd-queue's stored home was
backfilled to `ccrc-pwa` this morning; run 42 is already open so the flip cannot strand it, but a
successor wave's open must carry `"homeProject":"ccrc-pwa"` by hand.

## 2026-09-16 23:0x UTC — RUN 42 IS DISPATCHED. The blocker was already gone, and not by anything I did.

**`sessionId: ccrc-pwa-bright-canyon`, fresh spawn (`resumed:false`), `briefQueued:true`.** The
standing position said dispatch the moment `capsUsage().running` measures below the limit. It does,
and it has for hours — the dispatch route's own cap check is the measurement, and it passed.

**WHY IT WAS ALREADY UNBLOCKED, measured rather than assumed.** This ledger has said since the 15th
that the real blocker was one server deploy of #108's cap change. **That deploy has happened** — not
as a deploy of `main`, which is why nobody noticed. Both boxes report build `97ceb87b` on ref
`ws/ccrc-token-optimization-strategy` (server `/health` and `ccd version`, built 15:42 and 15:49 UTC
today): **PR #116's unmerged branch**, which is based on `main` at `dba672ac` and therefore CONTAINS
#108. I did not infer that from ancestry alone — I read the deployed tree's own source:
`git show 97ceb87b:server/src/coord/store.ts` line 2717 is
`state NOT IN ${INACTIVE_RUN_STATES_SQL}`, the D-2803 narrowing. So the live server has been
counting only dispatched ACTIVE runs since 15:49.

Running at dispatch time, by that formula: **4 of 7** — runs 59, 64 and 67 `working` and 68
`dispatched`. Runs 47 and 62 sit at `awaiting-review` and are IDLE, which is exactly the change that
freed the slot; 42, 65 and 66 were `planned` and never counted.

**A standing position whose condition nobody owned went stale in the other direction.** The ledger
recorded "one server deploy frees this" and surfaced it to the operator for days. The deploy arrived
from a different programme, for its own reasons, and satisfied the condition silently. Nothing
re-measured it until now. That is the same defect as the original — the condition had a measurement
and no owner — and the remedy is the same: re-measure a standing condition on every wake, never carry
its last reading forward.

**The brief gained one paragraph before dispatch and nothing else.** Clause 13 wants the wave's
routing named, so the brief now places this wave on the matrix's *worker executing a spec\'d plan*
row — main loop Opus at `high`, workflow mode OFF, Sonnet `high` implementers, an Opus `high`
per-task reviewer, Haiku scouts — and says so in prose because **the server has no reader for a
`route` object on `main`** (no `RunRoute`, no route parser anywhere in `shared/` or `server/src` at
`f27c8a86`); that shipped in #116\'s branch, which is deployed but unmerged. Sending `route` would
have been journalled as omitted. Brief 6220 bytes against the 8090 ceiling, 25 items against 32.

**Costs if wrong:** the wave runs a rung low and a fix round corrects it; the cap refusal, had I
misread it, would have refused the dispatch outright rather than overcommitting the box.

## 2026-09-16 23:2x UTC — first deviation request of run 42: **D-2925 issued**, four rulings, two anchor corrections

Worker `ccrc-pwa-bright-canyon` mailed a `deviation-request` (1540) within minutes of dispatch: one
number requested, three plan/tree disagreements needing none, one thing disclosed and not touched.
It followed the brief's protocol exactly — `D-TBD-<slug>` in the plan, a request mail to me, and an
explicit refusal to invent a number if none arrives (worker clause 11). Full artifact:
`bright-canyon/.superpowers/sdd/2026-09-09-ccd-queue-platform-shim-and-doctor-coverage/deviation-request-wave1.md`.

**I verified the finding in their worktree at `f27c8a86` before minting rather than taking it.**
`/bin/grep -n '\*\.project' ccd/ccd` returns EXACTLY ONE hit — 6906 — so `cmd_project_pool` really is
the only `.project` consumer that opens by glob; the comment at 6903-6904 really does reason about
the glob's own literal text on an empty registry, which guards a DIAGNOSTIC and not a type; and the
plan really is silent, its one `_project_pool_state` mention (line 106) naming it as the pattern to
TRANSCRIBE rather than as this site.

**D-2925 issued** (`count:1`, floor moved to 2926) — `cmd_project_pool` (`ccd/ccd:6775`) proves a
project exists through an unguarded `$REG/*.project` glob that `grep` opens BY NAME, so one FIFO or
symlink-to-`/dev/zero` among the registry rows blocks `ccd project-pool --pool` for ever. D-2376's
FIRST class, not the second class Part D must not widen into. Fix is the shape Part D already
transcribes (`_project_pool_state`, `ccd/ccd:1470`): loop the glob, skip anything failing
`[[ -f && -r ]]`. **The definition text went to the worker verbatim in the same mail as the number**
(1543) so number and definition land in one commit — an issued number whose definition never commits
raises this project's floor and buys nothing. Costs if wrong: one helper, one call site, one revert.

**Four rulings.** (1) **D5 is landed and pinned** — approved, and their method is the right one:
close it by MUTATING the existing guard and measuring the EXISTING pin go red, which is the only
thing that separates a live pin from a present one. (2) **A4 must mirror into `ccd/ccrc`** — approved
and folded into the A2/A3 commit; correcting one half of a byte-identical block reds
`macos-platform.test.ts:51`, so it is not a scope decision. (3) **D-2380's cardinal is short by one**
— confirmed here, three opens at 4172/4335/4362; its SUBJECT is `_pr_py`'s opens, so this is a stale
count, not a new subject: correct in place, no number, exactly as D-2475 was. (4) **The "four hold
readers" comments against six gates** — disclose in prose, do not touch; that is the widening Part D
forbids.

**Two anchor corrections I measured and they did not.** The D-2370 guard is at **15539**, not 15538
(15538 is `local f="$1" line state=0`), and there is a **SECOND identical guard at 15565** in the
same region. I told them to mutate BOTH and report each separately: if 15565 is unpinned that is a
finding of exactly the class D5 exists to close, and emptying one of two twins is how a half-pinned
pair reads as fully pinned.

**And one standing instruction, because it has cost this fleet twice today:** cite a `ccd` line with
its COPY. `ccd/ccd:<n>` is `origin/main`'s; `~/.local/bin/ccd:<n>` is the deployed build, which is
PR #116's unmerged branch and sits 68 lines lower above `is_ours`.

## 2026-09-16 23:3x UTC — Part A is blocked by a required-lane pin. **Ruled: ship (c), narrowed to the weakest honest form.**

The worker (mail 1542, artifact `partA-conflict.md`) found that **A2's prescribed fix is forbidden by
a guard on a REQUIRED lane**. A2 says: when `"$2"` is a symlink to a directory, `rm -f -- "$2"` before
the `mv -f`. `ccd-reg-set-atomic.test.ts` scans `_plat_mv_notdir`'s body as TEXT and asserts
`not.toMatch(/rm\s+[^\n]*"\$2"/)` — *"the helper must never unlink its destination"*, inside the
`it(… D-112 rests on this)` case. A regex on a body cannot see a guard, so an `rm` nested inside
`if [ -L "$2" ] && [ -d "$2" ]` reds it exactly as an unconditional one does.

**I measured three things before ruling, because a recommendation is a claim.** (1) The pin is real and
says what they said. (2) **The permitted `rm` really is unreachable from `_reg_set`** — `/bin/grep -n
'ln -s' ccd/ccd ccd/ccrc` returns ten hits and NOT ONE creates a symlink at `$REG/<id>.<field>`; they
are comments about `pools/` and `swap.log` plus `ccrc`'s memory-store `ln -sfn`. So on the registry
path the new arm is dead code and D-112's invariant is untouched. (3) **Even adversarially the
narrowing is the safer side:** if something outside ccd planted a symlink-to-dir at a registry field,
TODAY `mv -f` follows the link, writes INSIDE the directory and returns 0 — a silent wrong write with
the name resolvable throughout. After the fix a reader sees a transient ENOENT instead, and a
transient absence readers already tell from unreadable beats a silent write to the wrong place.

**(a) REJECTED** — dropping `! -L` makes Darwin refuse a rename GNU performs, and `ccd/ccd:66-68`
considered exactly that and rejected it ("`-L` BEFORE `-d` … is the whole correctness of the Darwin
arm"). A4 authorises correcting the ATOMICITY paragraph, not rewriting the rejected-alternative
paragraph above it. **(b) REJECTED**, and the worker refused it unprompted — widening a guard until
your own change passes is the false green this repo mints rules against.

**THE CONDITION ON (c), AND IT IS THE POINT.** A regex over a function body **cannot decide whether an
`rm` sits INSIDE a guarded arm** — it can only see that `rm "$2"`, `[ -L "$2" ]` and `[ -d "$2" ]` all
appear in the same text; an unconditional `rm` with the guard three lines away passes it. So the pin
is narrowed to the WEAKEST honest form and **its own failure message must say it detects a CHANGE and
does not prove the `rm` is guarded**. The guarantee lives where it can actually be observed, and the
plan already asks for it: **A1** drives `CCD_OS=darwin` on Linux with `dest` a symlink-to-directory
and asserts 0 only if `src` is now AT `dest`; its sibling case — `dest` a REAL directory → return 1,
destination untouched — goes in the same act. **A5 now carries three mutation rows**: delete the `rm`
→ A1's symlink case RED; delete `[ -d "$2" ]` from the new guard → the narrowed scan RED; **move the
`rm` OUTSIDE the guarded arm → A1's real-directory case RED while the scan stays GREEN**, to be
reported whatever it measures, because that row is the honest statement of what the scan cannot see.

This is account-pools wave 6's ruling applied to its first case outside the wave that earned it: pin a
claim mechanically only where the code names what the prose names, and where it does not, say so in
the guard's own message rather than letting a regex imply a proof it has not got.
**Costs if wrong:** one guard narrowed on a path measured to be dead, and a behavioural case that
would have caught it either way.

**Also ruled:** claim-extend to `ccd-reg-set-atomic.test.ts` before touching it (their own proposal —
right). **D-2189's cardinal is six of eight, not four of five** — it counted `ccd/ccd` alone and missed
`ccd/ccrc:748`, `:5672`, `:6839`; SUBJECT unchanged, so correct in place, no number, the D-2475 shape
for the second time in this wave. A4 names the eight. **Open question, not a requirement:** if BSD `mv`
has a flag that replaces a symlink-to-directory as a NAME the way `-T` does, it beats the `rm` outright
and leaves the pin untouched — untestable from Linux, the macOS leg is 40 minutes and not required, so
answer it in the wave-done or record it unanswered.

## 2026-09-17 02:5x UTC — second deviation request: **REFUSED, and that is the finding.** It is D-71, already general.

Worker mail 1556: a TAB-delimited row protocol in `ccrc-doctor-checks` collapses empty fields, because
**tab is bash IFS *whitespace* whatever IFS is set to** — a run of them is one delimiter and every
field after an empty column shifts left. Found by the Part C implementer, reproduced by the reviewer,
reproduced a third time by the worker before asking. **I reproduced it myself on bash 5.2.21 before
ruling:** `printf 'id\tOK\t\t0\t\n' | IFS=$'\t' read -r a b c d e` gives `c=[0] d=[] e=[]`, and the
`\x1f` form gives `c=[] d=[0] e=[]`, which is the intended parse.

**Ruled: NO NEW NUMBER. This is `D-71`, and D-71 is already stated in the GENERAL form.** From
`2026-08-15-stage2b-ccrc-cli-and-doctor.md:52`: *"**Any tab-delimited record with possibly-empty
fields must not use `read` with `IFS` alone** — this idiom appears wherever a bash reader parses a
generated record."* That is not narrower than the worker's proposed subject; it IS the subject, written
thirteen months ago and restated twice — `2026-08-17-stage2c-wrapper-generation.md:83` and
`2026-09-07-account-connections-wave1-fleet-box.md:3716`, **the second of which already enumerates the
worker's `_wrap_parse_shape` site with four siblings**. Minting would be a duplicate definition of a
live subject and would raise the floor for nothing. Costs if wrong: the entry cites an older number
than it might have, and the fix is unchanged either way.

**The finding is worth MORE as a recurrence, and that is what goes in the plan.** The idiom is banned
in three plans and at least six in-file comments — `ccrc-doctor-checks:2372` says in so many words that
it *"must not come back"* — and I counted **THIRTEEN live `IFS=$'\t' read` call sites** across
`ccd`, `ccrc`, `ccrc-doctor-checks` and `ccrc-adopt` at `origin/main` `03ecda65`. A rule stated six
times in prose and violated thirteen times in code is not a knowledge-transfer failure, it is a
**missing mechanism**: this tree's own doctrine is *"a comment is a request; a red suite is a
mechanism"*, and D-71 has never had one. Recorded here as the thing someone should take; not minted
into this wave, which is a docs/shim wave and no departure from its plan.

**One improvement on D-71 the worker should claim.** D-71's own remedy was *split the fields by hand*.
Theirs — move both sides of the protocol to `\x1f` — is better, because a non-whitespace delimiter
preserves empty fields natively and nothing downstream has to remember. A new remedy for an old
deviation belongs against that deviation.

**I took the measurement the worker correctly refused to widen into.** They wrote *"Reachability of
those three depends on whether their middle fields can go empty and I have NOT measured that — I am
not widening the wave to find out."* Right call. So a fan-out is measuring it at MY cost against
read-only copies of the four files at `origin/main` in my own scratchpad — one tracer per producer,
adversarial refutation of every *reachable* verdict, and a completeness critic that re-derives the site
list independently. The worker pastes the confirmed list into their disclosure paragraph and fixes
nothing outside Part C.

**Two ledger notes from the same mail, both recorded.** (1) **Part D's R1 fix had a SECOND DOOR** —
resolving `timeout`/`gtimeout` closed "neither present", but a binary that IS present and refuses `-k`
(busybox-shaped) leaves four cases green at rc 125 while measuring nothing; measured with a shim, 29
failed / 4 passed, the four being `expect(r.code).not.toBe(0)` assertions a refusing shim satisfies.
Being closed by probing with a known-124 command instead of testing presence. Same class as D-2840, and
that attribution is correct. (2) **Part C's fix round shipped six behaviour changes with ZERO new
cases** — restoring the pre-fix file leaves the models block 10/10 green, so the whole round was a
green mutation. Round 2 is dispatched with the tests as its deliverable; it must not close without a
mutation row per behaviour change.

## 2026-09-17 03:0x UTC — the D-71 reachability audit: **13 sites, 9 safe, FOUR reachable across three findings**, one guarded by a false comment

The measurement the worker correctly refused to widen into, taken at my cost. Ten agents against
read-only copies of the four files at `origin/main` `03ecda65` in my own scratchpad — never a live
checkout — one tracer per producer on Sonnet, adversarial refutation of every `reachable` verdict on
Opus, and a completeness critic that re-derived the site list itself. Zero errors. Artifact:
`scratchpad/tab-audit-result.md`. **I re-measured all three positives by hand afterwards; nothing
below rests on an agent's word.**

**R1 — `ccrc-doctor-checks:2731` (`_check_accounts`), and its consumer comment is FALSE.** Producer
`deploy/account-op.mjs:1075-1076` pushes `[DOCTOR_FINDINGS[0], acct.id, '…'].join('\t')` with no
presence check, and `opDoctor`'s own docstring at `:1036` says in capitals **"IT DOES NOT VALIDATE THE
ROSTER, and that is a measurement rather than a taste"**, with five lines arguing why it must not.
`join` renders `undefined` as `''`, so an id-less account emits `FINDING\t\t<message>` and `:2734`
prints the message where the id belongs. **`ccrc-doctor-checks:2720-2725` asserts this is impossible** —
*"Every field the helper writes is non-empty by construction (a code, an id, a sentence, or a number),
so CLAUDE.md's measured TSV hazard … cannot bite here"*. The clause "an id" is false, and the producer
says so about itself.

**R2 — `ccrc-doctor-checks:4382` (`_check_routing`), nobody had flagged it.** Producer `:4358` prints
`"$a"` then `_ccrc_cfg_dir "$a"`; an empty `CCRC_ANTHROPIC_BACKEND` element gives `\t<cfgdir>`, and I
reproduced the parse: `a=[/home/u/.claude-x] d=[] f=[/settings.json]`. So `[ -n "$a" ] || continue` at
`:4383` **can never fire for the case it exists to catch**, `n` counts a lane nobody measured, and the
verdict is decided off the filesystem root. **That is D-71's original signature verbatim** — *"the
no-id guard was dead code that could never fire"* — reproduced ~2000 lines from the comment in the same
file that records it.

**R3 — `ccd:12850`/`:12917` (`_ws_gc_scan`'s `dead-reg` row).** `[[ "$p-$s" == "$id" ]]` at `:12484`
admits an empty component — measured, `p=proj s="" id="proj-"` passes — and the row then shifts:
`slug=[-] bytes=[-] age=[/w/proj-] p=[]`, the path lost into `age`. The comment immediately above
describes the PREVIOUS incarnation of this bug as a **"FABRICATED SUCCESS LINE"**. The fan-out had
called this site safe; **the critic caught that its argument was a non-sequitur from the guard it
quoted**, which is the whole reason a completeness critic is in the harness.

**The nine that are safe**, briefly, because a safe verdict is a measurement too: the five
`_wrap_parse_shape` readers are gated by `WRAPPER_ID_RE`/`WRAPPER_SUFFIX_SAFE_RE`, neither of which
accepts empty, and every consumer checks `ok = ok` before touching a later field; `ccd:3646` puts the
free-form reflog subject LAST by design; `ccd:10029` is reached only after `is_merged` proves the oid
matches `^[0-9a-f]{7,40}$`; `ccd:12619`'s `sens` is a literal and its `b` is digit-gated; `ccrc:2722`
obeys its own file's ban.

**What run 42 does with it: disclose all three, and ONE authorised exception.** I told the worker to
paste the three anchors into the D-71 disclosure paragraph and fix no code outside Part C — and then
authorised exactly one departure: **correct the false clause at `ccrc-doctor-checks:2720-2725`**, in a
file Part C already edits, naming it in the wave-done. **Ruling and its reason:** a comment asserting a
safety property the producer explicitly refuses to provide is not documentation, it is a false guard —
the class the sibling programme spent four rounds and 176 mutations removing — and leaving it while
disclosing the defect three paragraphs away teaches the next reader that the comment is the authority.
One clause, one commit, named. Costs if wrong: one comment edit in a file the wave already touches.

**Two cousins, outside the idiom and outside this wave, recorded so they are not lost.** `ccd:2933` is
the same rule with a SPACE — `tmux list-panes -a -F '#{session_name} #{pane_pid}'` read with
`IFS=' '`, and `-a` lists every pane on the box including a human's, where a session name may contain
a space. `ccd:11847` runs awk's DEFAULT FS over a TAB record, so `length($1)` measures the path only to
its first space — and that length is the sort key for the deepest-first ordering `:11828` says is the
only order in which each child's own `worktree remove` actually removes it.

**The finding under all of them.** D-71 is banned in three plans and at least six in-file comments, one
saying it "must not come back". Thirteen call sites, four reachable, one guarded by a false claim.
**A rule stated six times in prose and violated thirteen times in code is a missing mechanism, not a
knowledge-transfer failure.** D-71 has never had a red suite. That is someone's wave — surfaced to the
operator, not taken here.

---

## Part A, corrected: the pin I ruled for was VACUOUS — the worker measured its own promise and refuted it

Mail 1560, `ccrc-pwa-bright-canyon`, unprompted, against its own claim rather than against a ruling.
My Part A ruling (`d9f1ce98`) said *ship (c), pin narrowed to the weakest honest form*, and it rested
on one sentence from `partA-conflict.md`: *"It is mutation-measurable in both directions: delete the
`-L` from the guard and the pin reds; make the `rm` unconditional and it reds."* **Both halves are
false.** Measured by the worker's honesty reviewer and then independently by the worker: the narrowed
pin is GREEN on HEAD, GREEN with the `rm` guarded by only `-L`, GREEN with it guarded by only `-d`,
and GREEN with the `rm` unconditional. The old pin reddened all four. **Net: a mechanism removed and
none added.**

**I verified the cause myself, structurally, without the worker's branch.** `origin/main:ccd/ccd:77`
is `if [ ! -L "$2" ] && [ -d "$2" ]; then return 1; fi` — both tokens the narrowed pin demands, present
unconditionally, INSIDE the span its regex extracts as `mvBody`, on a line A2 is forbidden to touch.
A regex asking "are these tokens present" is therefore satisfied by that one line for **every** possible
guarding of the `rm`. This needed no run: it was true when the option was written.

**Ruling: behaviour, not a cleverer scan.** Ship the two behavioural cases. The alternative the worker
offered — restore the original `not.toMatch` and drop A2's fix — is refused, and the reason is worth
writing down because it looks like a symmetric choice and is not: main's helper contains no `rm` at
all, so the original pin is a **presence ban** on `rm … "$2"`, green on main only because there is
nothing to ban and red on any body that adds one, the correct fix included. The worker's own table says
`HEAD → old pin RED`. Restoring it is not restoring a mechanism; it is (c) not shipping, and D-2187
reopening. **Costs if wrong:** the TOCTOU fix ships with two behavioural cases instead of one regex.

**What I demanded back, and why it is the same rule that caught this.** The six-row mutation table,
scored per MECHANISM — case (a), case (b), the narrowed scan, A1 case 2 — including one row nobody has
run: *refusal guard deleted, `rm` left exactly as HEAD has it.* That row decides whether the narrowed
scan holds anything at all. If it reds, the scan was never a containment pin — it is a pin on the
refusal guard's two tests still being PRESENT, which is real and which nothing else holds, and it gets
re-titled to say so. If it is green, it holds nothing and it goes. **A pin whose NAME promises
containment while its body cannot fail is worse than no pin:** the next reader sees a named assertion
about containment and stops looking. "Its message states its own limit" is not enough — the message
must name `ccd:77` as the line that satisfies it.

### Three things the worker's own fix list did not reach, all measured here

**The false quantifier is in a THIRD place, and that place is D-2189's own definition.** The worker
found *"nothing in the tree creates a DIRECTORY at any of the eight"* false in A4's replacement text and
is fixing both source copies. The same claim sits in
`docs/superpowers/plans/2026-09-09-ccd-queue-platform-shim-and-doctor-coverage.md:201-209` — *"(nothing
in the tree creates a `directory` at any of those paths, so the race stays unreachable)"* — three lines
after that paragraph names `$POOLS_DIR/$project` as one of those paths. Both of the worker's citations
re-measured on `origin/main` and both hold: `ccd-project-pool.test.ts:103` mkdirSyncs `POOLS()/demo`,
which is `ccd:6965`'s destination; `ccd-hold.test.ts:137,184,260,314` mkdirSync `$REG/<id>.hold`, which
is `ccd:2111`'s destination under `_reg_set <id> hold`. **The defining copy is the load-bearing one** —
it is what a later reader consults to learn what D-2189 was. This is `correcting-the-instance-is-not-
correcting-the-claim` landing on a worker who had already applied it twice and stopped at the source.

**The count is wrong by three, not one, and the entry's stated cause is incomplete.** Eight call sites,
counted on `origin/main`: `ccd/ccd` 689, 2111, 3204, 6965, 16257 and `ccd/ccrc` 748, 5672, 6839. The
plan's "five" is `ccd/ccd` **alone** — `ccd/ccrc`'s copy of the platform block was never counted. So
*"a wave added a call site and left the quantifier standing"* accounts for exactly one of the three
missing sites; the other two were never in the census. A tidy cause that explains a third of the error
is its own defect.

**The byte-identity pin constrains A4 in a way nothing in the plan says.** The atomicity paragraph is
byte-identical in `ccd/ccd` and `ccd/ccrc` — that is A3's subject and `macos-platform.test.ts`'s
assertion. So naming only `ccd/ccd`'s five makes the same bytes FALSE in `ccd/ccrc`, and naming eight
without naming each site's FILE makes the same bytes assert something different in each home. Each
named site carries its file, and the rewrite is read back in both copies.

### Two smaller rulings

**The failure-path destruction is disclosed with its CONDITION, not its verdict, and takes no number.**
The fix runs `rm` before `mv`, so a failed `mv` now leaves the destination gone where it previously
survived; the worker measured both revisions and confirmed it is unreachable from `_reg_set` today.
"Unreachable today" is a measurement with an expiry date and nothing that re-measures it, so the
paragraph names the condition that makes the price real — a caller whose destination matters and whose
`src` may be absent. **No deviation number:** the price is intrinsic to option (c), which my own ruling
chose. A disclosed property of the fix, not a departure from the brief. **Costs if wrong:** a future
call site pays a loss the comment warned about in the abstract.

**The plan file is the worker's, in the finish commit** — it is outside every Part's file list, so the
edit is named in the wave-done rather than discovered by the review. Corrected in place without
reflowing, because line-number citations into plans are load-bearing here and a reflow invalidates them
silently. And NOT by blanket-replacing "four of the five" in that file: line 136 is a different five
(the `cat`-fallback sites near D-2379). Each instance checked against its own subject.

### The rule this replaces my ruling's ground with

The conclusion of `d9f1ce98` stands — (c) ships. **Its stated ground does not.** I took a mutation
claim as a fact because it was stated as one, and a sentence about what a table would show is not a
table. Binding on both roles for the rest of this run: **a ruling that rests on a mutation claim cites
the measurement, never the promise; a proposal offering a replacement mechanism arrives WITH the table.**
The worker applied that to itself here, unprompted and at the cost of reopening work it had closed,
which is the only reason the vacuity was found before the wave-done rather than by a reviewer after it.

---

## The cross-plan citation collision: a ratchet with no owner, met an hour after it shipped

Mail 1563, BLOCKED, worker had touched nothing. `#134` (graphify compaction card, D-2849)
merged at **2026-09-17T04:04:42Z** carrying a repo-wide line-citation census in
`server/test/session-hook.test.ts`. Run 42's branch merged `dfa167d7` and four of its cases
went red: `ccd/ccd` debt **22 → 127**, a README anchor 0 → 1, `**Files:**` refs 12 → 20,
`|`-rows 18 → 54. None of the rotted citations are run 42's: they are in #134's own spec and
plan, in README, and in that census's own comment.

**Two of the worker's premises were wrong, and correcting them changed the answer.**

**`ccd/ccd` grew 268 net lines, not ~700.** `git diff --numstat dfa167d7 9b53f221 -- ccd/ccd`
= 286 in, 18 out. The ~700 was the whole-branch insertion count across nine files. This is
load-bearing, not pedantic: a few hundred lines at a handful of insertion points implies a
**small number of distinct constant offsets**, which is the difference between a mechanisable
repair and a heroic one.

**The freeze is pinned by nothing.** All six mentions of the 24,688-byte / `46535cdd…`
section inside `session-hook.test.ts` are comments; no assertion reads it; `git grep -l
46535cdd -- server/test` returns that one file, and #134's Plan A is complete. So *"the
repair is out of reach"* is false as a mechanical claim. **The conclusion survives on a
better reason:** those bytes are the preflight contract a COMPLETED task executed against,
and rewriting them rewrites the record of what that task was told to do. Told to the worker
in that form, because a worker who believes a freeze is mechanised never considers the option
at all — and a false mechanism cited as a constraint is the same defect class as the false
comment at `ccrc-doctor-checks:2720`.

**The worker's principle was right and its precedent stronger than it argued.** It wrote
*"it is only 'adjusting' if the number is changed without the referent having moved"* — and
that census has ALREADY absorbed a foreign programme's merge, by name: *"`deploy/deploy.sh`
2 since the SECOND merge of main (03ecda65, #114)"*. **#114 is account-pools wave 6 — this
coordinator's own programme.** Its authors met this exact case and chose absorb-and-name.

**Ruling: PROVE, REPAIR, then absorb only the residue — and the scale is what decides.**
What that precedent establishes is absorb-with-proof **at +1**. Every raise in that file's
history is proven per anchor by byte identity (*"sha256 231a9934… on both sides"*, *"all
five at +80"*); the largest it has ever accepted is **+3**. The proposal was **+105**, 35×
that, with a prose paragraph where the proofs go — under a sentence that reads *"RE-MEASURE
AND LOWER THE CENSUS; never widen the rule."* **The reason scale matters is mechanical, not
moral: a shift you have PROVEN can be REPAIRED instead of absorbed, and a repair lowers the
debt.** At +1 nobody bothers; at +105 the repair is the whole point, and absorbing without
looking forecloses it. So: prove each new failure by that file's method (1), repair every
anchor provable and unfrozen, absorb only what remains with its cause and commit range named.
**Costs if wrong:** a sizing measurement nobody uses.

**Carried into the instruction: Task 11's own withdrawal guard.** Its method (1) produced
**seven false repairs**, withdrawn because the chosen block *"had landed on a COMMENT … and
the clause's token happened to occur in it"*, on the principle that *"a reference pointing at
the wrong line is worse than one pointing at a line that moved."* A repair counts only when
the tip block is byte-equal, **unique**, and carries the clause's own longest quoted token;
a non-unique match is reported, never chosen between.

**Step one is a measurement with no edits** — the new failures split three ways (provable
shift / inside the freeze / neither), with the distinct offsets and the script — because
**both hand-offs the worker offered are gone**: #134 merged an hour before it wrote, and
Task 11, which that assertion names as the owner of closing this debt, has already run.
Nobody is left to absorb it and there is no later re-measurement to ride.

**One edit authorised now:** README's `ccd/ccd:16330-16332`, repaired rather than bumped,
shift proven by byte-equality. A knowingly wrong line number in the operator-facing README is
the one cost nobody should carry while the rest is sized. The census-comment note is HELD —
the comment and the number land together or neither does.

### Two things this cost me, not the worker

**`ownership.test.ts` is half my omission.** The worker owned it because its briefs named
`single-definition`, `dtbd` and `deviation-refs` as the repo-wide guards and never named
`ownership`. **I wrote those briefs.** Naming a suite list at all invites the miss; the
answer is the shards, not a longer list. And the durable fact no brief of mine has ever
carried, recorded here for every future ccd wave: **`ccd/ccd` is a GENERATED file carrying
`# ccrc:generated`, so any wave that edits it must re-stamp with `markGenerated`** or
`ownership.test.ts` reds — and it reds before a merge, not because of one, which is why this
one hid through every round.

**`suite: RED` is the right signal and it stays.** Clause 15 asks what the FIRST full run
after implementation said. It said red. A second number would make that field a summary of
the worker's fixes rather than a measurement of its branch.

### Surfaced to the operator, not taken

**#134's census is a ratchet with no owner.** Its expected value is a hard-coded exact
per-file map keyed on `ccd/ccd` — a file every programme in this repo edits — and its
`TOUCHED` list is FILE-granular, so it cannot distinguish the thing it declares it measures
(*"THE CITATION DEBT this task creates"*) from rot an unrelated wave caused in the same file.
Its owning programme is complete and the Task 11 it names as the owner of closing the debt
has already run. **The next wave to touch `ccd/ccd` meets it exactly as run 42 did.**

---

## Wave 1 handed off — and the worker corrected my own arithmetic before I did

Mail 1567, `wave-done`. Fingerprint `{branchTip 76897187…, prNumber 136, prPhase open, handoffCommit
76897187…}`, `suite: red`, `failure: ceiling`. **Re-measured, not taken:** `git -C <worker worktree>
rev-parse HEAD` reads `7689718713b78dfc89532bf490e930089a9bbc18` on `ws/bright-canyon`, identical to
both claimed fields; `gh pr view 136` reads OPEN, head `ws/bright-canyon@76897187`, base `main`,
MERGEABLE. `advance → working` then `advance → awaiting-review` both accepted. **Review run 69 opened
(`kind:'review'`, `reviews:42`) and dispatched to a fresh session, `ccrc-pwa-warm-prairie`**, with the
held-out panel as its shape and one wave-specific lens: the mutation claims ARE the deliverable here,
so every guard gets reversed in a copy and its named case must red.

### THE CORRECTION I OWE, and it is against me

The worker's wave-done carries six self-corrections. Two of them land on my own published work.

**1. My D-71 transcript is unrunnable, and I published it as "reproduced it myself".** I printed
`printf '\t/home/u/.claude-x\n' | IFS=$'\t' read -r a d` and reported the parent's variables.
**Measured here, bash 5.2.21, `lastpipe` off:** the last element of a pipeline runs in a subshell, so
the parent reads `a=[X] d=[X] f=[X]` — the values it held before. That command cannot have produced
what I showed. **The FINDING is untouched and the exact output reproduces** under the runnable form:

```
$ IFS=$'\t' read -r a d <<< $'\t/home/u/.claude-x'; f="$d/settings.json"
  a=[/home/u/.claude-x] d=[] f=[/settings.json]
```

…including the `f=[/settings.json]` I reported, which is the DERIVED `$d/settings.json` with `d`
empty — so the report was coherent and only its stated instrument was false. That distinction is the
whole of `a-measurement-is-only-a-fact-with-its-tool`, and I broke it while quoting it.

**2. My safe/reachable split was arithmetically impossible, and my own ledger held both halves of the
contradiction.** I published *"13 sites, 10 safe, THREE reachable"* — while the paragraph headed
**"The ten that are safe"** enumerated **nine**: five `_wrap_parse_shape` readers, `ccd:3646`,
`ccd:10029`, `ccd:12619`, `ccrc:2722`. And the reachable section names **four site anchors across
three findings**, because R3 is `ccd:12850` AND `:12917`. 9 + 4 = 13. The true split is **nine safe,
four reachable sites, three findings**, and the three instances above are corrected in place.

**This is the exact defect I ruled on twice today in other people's work** — #134's census records its
own version of it (*"this sentence read 198 while its own map summed to 200 … a reader re-measuring
the debt took 198 as the figure to close and was two short"*), and its remedy was to assert the sum so
the headline cannot drift from the enumeration. I had no such mechanism on my own paragraph, and a
headline nobody derives from its list is a claim nobody measures. **The rule, on me: a count in a
sentence is derived from the list beside it or it is not written.**

Credit where it is owed: the worker found both, unprompted, in a `wave-done` it could have spent on
its own result. That is the second time in one run it has corrected a claim of mine at its own cost.

### What is still open

Three census cases stay red, cross-plan, and the step-one sizing measurement is running under the
prove-repair-absorb ruling — it arrives as its own mail. The README anchor it was authorised to repair
is repaired by byte-equality and that assertion now passes. Every change is under `ccd/`, so this is
**AGENT-FIRST at deploy time**; nothing is deployed and the worker has stopped pushing.

---

## The census repair, sized and ruled: re-point all 142 — the guard blocking 87 of them is a heuristic, not a proof

Mail 1570. The step-one sizing came back with the branch untouched (`git status --porcelain` empty,
tip still `76897187`, verified here) and a three-way split that answers a question neither option on
the table was asking.

**The tiers nest, and the nesting is the whole ruling:**

```
152 new failure instances
 ├─ 142  byte-equal AND UNIQUE at the tip     ← the referent provably moved, to one known place
 │   ├─ 125  …and the clause's rule is satisfied there   (a re-point turns them GREEN)
 │   │   ├─  38  …and it carries the clause's LONGEST token   (the worker's class (i))
 │   │   └─  87  …and it does not                              (its "population to rule on")
 │   └─  17  …and the clause's rule is NOT satisfied there
 └─  10  NON-UNIQUE — unprovable, parked, no candidate offered
```

38 + 87 + 17 + 10 = 152; 38 + 87 = 125; 38 + 87 + 17 = 142. Seven distinct offsets across all 142
(+54, +83, +221, +241, +305, +314, +323), four across class (i) — every value a cumulative hunk band,
so no anchor moved by an amount the 26 hunks cannot account for.

**Ruling: re-point all 142. Costs if wrong:** a re-pointed anchor lands on the unique new home of
bytes whose clause was never about them — which is the state the 17 are already in, is visible to the
census, and is strictly better than the same clause pointing at an unrelated line.

**Why Task 11's longest-token guard does not bind here, read from its own record.** Its method (1)
searched HISTORY for *"the newest commit at which it stood in a neighbourhood carrying its own
clause's longest quoted token AND was TRUE there"*, and its seven withdrawn repairs failed because
*"the AUTOMATICALLY CHOSEN BASE carried a comment at those lines and the clause's token happened to
occur in it."* **The defect was in base SELECTION.** Run 42 performs no search: one base, `dfa167d7`,
a direct ancestor, and — the worker's own §0 measurement — the two corpus documents are
**byte-identical between base and tip**. "The block the old anchor named" is a lookup, not a
judgement. The guard compensates for a hazard that is absent.

**And the guard demonstrably mis-fires on this corpus.** The 87 fail because one long sentence
dominates a paragraph citing several different files, so the "longest token" belongs to a different
reference: `spec:2209`'s *"UNCONDITIONAL, and with NO `tx`: this is not half of a pair"* is the
longest token for **eight** separate citations, most about other lines; `spec:2222`'s operator-path
sentence does it for four; `spec:308`'s longest token is a sentence about `ccd/session-hook.sh`
attached to a citation of `ccd/ccd:203`. **They fail a heuristic, not a proof** — and the proof they
do carry, byte-equality plus uniqueness against a fixed base, is the stronger of the two.

**Per class:** 125 repaired and green; **17 repaired and STILL RED**, correctly — anchor becomes
right, quotation was already wrong, which is Task 11's own `QUOTATIONLESS` class that it *"left rather
than made"* because a quotation change is not an anchor change. Run 42 re-points the anchor, touches
no prose, and records those 17 with that reason. The 10 non-unique stay untouched with their match
counts named; `ccd/ccd:5797` at **186** identical matches is the method reporting its own limit, which
is precisely why the other 142 are trustworthy. **The absorb falls from +152 to +27, each of the 27
classified rather than counted.**

### The sequencing rule is the worker's, adopted verbatim, and its evidence is the best thing in the exchange

> *"A citation repair is only valid against the tree it will ship in."*

Its README repair first chose `ccd/ccd:16637`; a later commit in the same round moved the referent to
`:16644`. **Measured here: `:16637` at HEAD reads `  # the missed acquisition could have raced.` — a
COMMENT.** That is Task 11's seven-false-repairs failure mode reproduced on this branch, caught only
because the worker re-measured at the final tree rather than trusting its own earlier measurement.

So: **the repair is ONE commit and it is the LAST commit on the branch**, re-measured against that
exact tree, with the census's number, its `total` and its cause comment in the same commit — the hold
on that comment released on that condition. **And it waits for review run 69 to report**, because a
push now makes the review's report evidence about a tip that is gone and the close answers
`stale-review`, costing a whole fresh review run. Order: review reports → any fix round → the repair
commit, last.

### Recorded against me

**My `+268` was right at `9b53f221` and stale at HEAD.** `ccd/ccd` measures **341 in / 18 out = +323
over 26 hunks** at `76897187`; the closing rounds added 55 lines after the tree I measured. Both
figures were correct about their own tree, which is exactly the rule above — a measurement is only
valid against the tree it describes — and I stated mine without naming the tree. The other two
corrections stand too: the `|`-row set is **53**, and `byFile['ccd/ccrc']` 2 → 4 is a fourth KEY
inside one `toEqual`, not a fourth failing case.

**Class (ii)'s zero is the right kind of correction to have made.** The worker proved it non-vacuous —
63 paragraphs, 12 references, 13 failures already firing inside the freeze **at the base as well** —
so my "the freeze is pinned by nothing" finding turns out not to move this decision at all. It removed
a false mechanism from the record without changing an outcome, and locating the region by sliding a
sha-256 window rather than trusting a heading is what made that zero evidence instead of an assumption.

---

## "All six" — there were five, and I said it one message after writing the rule against myself

Mail 1572 asked me to name my sixth plan/brief disagreement. **There is no sixth.** I wrote *"all six
the same way"* and then enumerated **five**: item 423's twelve rows, D5 already landed, A4's mirroring,
D-2380's four, D-2189's eight. The worker's wave-done named those same five. The list was right and the
count was wrong — and it was wrong **one message after** I wrote *"a count in a sentence is derived from
the list beside it or it is not written"* into this ledger as a rule on myself. The worker caught it by
applying that rule back at me, which is the correct use of it.

**I declined the exit it offered.** It wrote *"if your sixth is the D-71 recurrence I agree and it is
class 4."* It is not: the recurrence is a plan ENTRY the wave added, not a plan-vs-brief disagreement,
and taking it would be retro-fitting the list to the count — the exact move I refused twice today in
#134's census. **Five.** A rule that survives only when it costs someone else is not a rule.

### Its class 3 carries the mirror of my defect: right count, wrong list

Measured here on the plan's own diff (294/43, which matches its figure). The non-checkbox removed lines
are **18, in three blocks**: (1) the A2/Darwin rationale, (2) D-2189's heading **and** body, (3)
D-2380's body. Its mail named *"EXACTLY THREE removed lines: D-2189's heading, D-2189's body, D-2380's
body"* — D-2189 counted twice, block 1 omitted. Three is the right number of blocks; those are not the
three.

**And block 1 is a REWRITE, not a removal** — checked before saying anything, because the class matters
more than the count: `claude-OpenClawHetzner` appears **three times at `dfa167d7` and three times at the
tip**, the sentence lives at plan `:201`, and the replacement adds *"**Conditional on the unlink
succeeding**"*. The attribution survived. I looked specifically because a squash on this repo once
dropped a co-author trailer and cost a PR comment to repair. Its conclusion may well hold once block 1
is classed as a rewrite; the list as written is still not derivable from the diff.

**I asked for no corrected taxonomy.** That measurement belongs to review run 69.

### Why none of it goes to the reviewer

The worker's rationale is **the subject's own defence**, and a held-out review is held out from exactly
that. Run 69's brief asks it to decide "correction earned or standard moved" from the diff; handing it
the worker's classification would turn an independent measurement into a check of the worker's
reasoning. It stays with me and I read it when I rule on the report — the one place it is evidence
rather than influence. **Costs if wrong:** the reviewer re-derives a classification the worker already
made, at the price of one lens's time, which is what a held-out panel is for.

### A standing rule this run earned: conflicting instructions

I told the worker to state the rationale *"in the finish commit"* in the same message that told it not
to push while the review reads — and its finish commit had **already landed**, so the instruction was
unexecutable as given. **That defect is mine.** It obeyed the constraint whose violation is
irreversible (a moved tip makes run 69's report evidence about a tip that is gone, costing a whole
fresh review run), satisfied the other by a route that costs nothing, and **told me rather than letting
me discover it**.

> **When two of this session's instructions conflict, obey the one whose violation cannot be undone,
> satisfy the other by the cheapest route that still discharges it, and REPORT the substitution.**
> The reporting is what makes it a resolution rather than a silent swap.

The rationale lands as the first commit of a fix round if run 69 returns findings; if it returns none it
stays a mail and this ledger carries it, because a commit whose only purpose is to restate a mail is not
worth a tip move now.

### Declined credit, recorded accurately

The worker called my finding on the safe/reachable split *"a better finding than mine and it is yours."*
It is not. It called the arithmetic impossible; I only found which of my own sentences was lying.
Without its line I would not have re-read that paragraph, and "the headline disagrees with its own list"
is not something anyone notices about their own prose unprompted.

---

## Review run 69 reported — and the close refuses for a reason that is not the report

**The review is complete and sound:** 12 confirmed, 2 refuted, **0 unexamined**, `unverifiedLenses: []`
— every lens returned, so nothing here is silence dressed as approval. 330 server files with one red
file, agent 18/18, pwa 89/89, three builds and three `bash -n` green. 16 findings, plus the 2 the
panel's majority killed reported beside them rather than dropped.

### The close is blocked by the agent's read whitelist, and the error word names the wrong cause

`runs close 69` refuses **deterministically, twice**:
`{"error":"report-unreadable","detail":"…/warm-prairie/.ccrc-review/69-76897187.md: could not be read
(unreadable)"}`. The file is 22,749 bytes, mode 664, every path component traversable; I read it.
Traced in source rather than guessed:

- `agent/src/whitelist.ts:83-88` — the READ whitelist is exactly `$HOME/.cc-sessions`,
  `$HOME/.cc-limits`, `$HOME/.cc-clips`, anything under `projectsRoot`, and the `~/.claude*` glob.
  **A git worktree at `<home>/worktrees/…` is under none of them.**
- `agent/src/server.ts:322-324` — `case 'stat'` runs `checkPath(req.path, cfg, 'read')` and answers
  `fail(req.id, 'forbidden')` when it fails.
- `server/src/coord/fingerprint.ts:313-316` — `statMeasured` reports anything that is not a proven
  ENOENT as `unreadable`, which `verifyReviewDone` renders as `report-unreadable`.

**So a PERMISSION REFUSAL arrives as an I/O failure.** Two findings, both for the operator:

1. **Review runs are structurally unclosable when the report follows the template.**
   `references/review-brief.md` says *"Report to: an absolute path under YOUR worktree"* — and on a
   two-box fleet that names a location the close route can never stat. **This defect is mine twice
   over:** I copied that line into run 69's brief, and it is in the shipped template.
2. **`forbidden` rendered as `report-unreadable`** is an overloaded null at a seam — the shape
   `CLAUDE.md` bans outright — living inside the review machinery that exists to enforce such things.
   The refusal itself cost nothing; **the wrong word cost the whole diagnosis cycle**, because it sent
   me to look at the file, its permissions and its size before the path.

**Remedy for this run, and why the reviewer does it rather than me:** the report is copied
byte-for-byte (sha256-verified) to `<projects-root>/.ccrc-reviews/`, which is under
`projectsRoot`, outside every repo, so no checkout is polluted — and **the reviewer re-emits
`review-done` with the new path**. I could relocate it and close in ten seconds; I am not going to.
Clause 12 says I close with the REVIEWER'S OWN `{reviewedTip, report}`, and **a coordinator that
manufactures the evidence the server checks has turned a verification into a formality.** The documented
remedy — close `failed`, open a fresh review — is refused: it would burn a complete review and hit the
same wall, because the new reviewer would follow the same template.

### Three corrections to my brief, all accepted, one serious

- **B-2 is the serious one: whole-branch item (1) was half false and following it literally would have
  broken the tree.** I wrote that `ccd/ccd` *and* `ccd/ccrc` carry `# ccrc:generated`.
  `ccd/ccrc:63-67` forbids that marker by name — *"`ccrc` is, and stays, hand-written"* — and the file
  correctly answers `foreign`. A brief instruction that would have caused damage.
- **B-1: the brief's net stat describes `9b53f221`, eight commits behind the tip** (11 files,
  2386/133 at the tip). **The third time this run** I have published a number without naming its tree,
  after writing that rule myself.
- **B-3:** the wave-done names "three failing files"; it is one failing FILE with four failing
  assertions — three real, one a documented load flake green 3/3 in isolation at both base and tip.

### F1 verified independently, and my first probe tested the wrong half

`os.path.isfile` FOLLOWS symlinks, so `put()`'s tmp guard does not fire for a LIVE symlink. My first
reproduction renamed a fresh tmp onto a symlink destination — which replaces the link and lands nothing
outside — and would have let me mis-refute a correct critical finding. **The escape is at the WRITE,
not the rename:** with `tmp` itself a live symlink, `isfile` passes, `open(tmp,'w')` writes *through*
the link, and the field's bytes land outside `$REG`. Measured here end to end. The `exists`→`lexists`
fix closed the DANGLING case only; the second conjunct still follows the link.

---

## Review 69 closed, fix round 1 dispatched — and the reviewer scoped my own finding better than I did

The reviewer re-placed the report under `$HOME/.cc-clips/<its id>/` — **a better choice than the one I
suggested**: it is on the agent's read whitelist, it is session-namespaced, and it is the agent's own
designated write root, where `projectsRoot/.ccrc-reviews/` would have been a new directory beside
every project. Verified byte-identical by `sha256sum` and `cmp` before closing. Run 69 closed
`done`, `released: true`; run 42 advanced back to `working`.

**And it scoped the defect better than I did.** I blamed the coordinator's review-brief template. The
prescription is also in **the reviewer skill's own clause 7** (`$WT/.ccrc-review/<run>-<tip8>.md`), and
it named the measurement I lacked: `CCRC_PROJECTS_ROOT` is `<home>/projects` → the volume mount, while
every session worktree lives under `<home>/worktrees` — **outside it**. So the fix is one of two
things, and the operator picks: clause 7 names a `.cc-clips` path, or `checkPath` gains the worktrees
root. Both halves recorded; neither is run 42's.

**A third, smaller one, noticed in passing:** opening review run 69 under this programme's slug
**overwrote the programme's title** — `GET /api/runs` now reports `programTitle: "Review wave 1"` for
the whole of `ccd-queue`. `openRun`'s conflict arm updates the title and nothing restores it, and with
this programme at wave 1/1 there is no later run to correct it. Cosmetic on the board, wrong in the
record.

### Fix round 1 — the only full round I intend

Announced as such in the brief, before the work, with the bound stated: a second round is scoped to
findings THIS round creates, not new territory. **Order is load-bearing and it is the worker's own
rule:** everything else first, then LAST AND ALONE the single re-point commit for all 142 anchors plus
the census map, its `total` and its cause comment, re-measured at that exact tree.

**Blocking:** F1 (critical — `S_ISREG(lstat)` at three sites, and the case must plant a symlink to an
EXISTING REGULAR file, because a dangling-link case passes without the fix and would be a false pin);
F2; F3 (my binding ruling enforced — the `lastError` fixture must plant a provider-controlled string
carrying a terminator, since all six existing fixtures are clean text and mutated the doctor **invents
a lane with no roster row**); F4; F5; **F6 ruled YES**; F7; F8 (no new number — D-71 covers the class
and I refused a second one this run); F9 (the squash body is the durable record, and the trailers are
derived, not recalled); F10 (**a skipped case is not a pin**); F11 and F15; and **R1 ruled against the
panel's own 3/3 refutation** — not on the reviewer's advice but on the code's text: the `rc2` comment
says the guard exists because an empty `$out` gave *"an empty loop, and the same false PASS"*, which a
zero-exit empty batch still produces. **Costs if wrong:** one rung on a path reachable only through a
non-shipped `node`.

**F13 ruled accept-and-declare.** The `CLAUDE.md` content is measured accurate and corrects a number
every session and subagent on the fleet loads, so leaving it stale ships a known-false claim into the
most-read file in the repo. But it was unilateral and undeclared: **it should have been asked, I would
have said yes, and the defect is the silence, not the edit.**

**Three sources, three values for one set.** My ledger says `|`-rows 18→**54**, the worker measured
**53**, the reviewer measures **52**. Re-measure all three counts in the repair commit at its own tree
and name the instrument; if worker and reviewer still differ, **report the discrepancy — do not pick
one and do not average.** A repair sized off a disputed number repeats the error this whole thread has
been about.

### What came back clean, recorded because a safe verdict is a measurement too

21 of 22 mutation rows reproduce exactly in isolated tree copies. Both mutants shipped as UNPINNED are
honestly described. D-2189's eight call sites reproduce exactly. All fifteen deviations are defined.
The shared platform block is byte-identical in both homes at 52,921 bytes. The branch adds no new
`IFS=$'\t' read` site. And measured mechanically with checkbox state normalised, **no plan task
requirement was weakened or removed** — the only task-text edits widen scope. That was the brief's
central spec question, and the answer is in the wave's favour.

**No fan-out was run over this report and that is deliberate.** It is already verified — three Opus
lenses, three Sonnet refuters per finding, 0 unexamined — plus my own independent reproduction of the
critical finding. A second panel over a closed panel would re-review a review, which clause 12 assigns
to nobody and which the routing policy names as the archetypal over-fan.

---

## F14 had no ruling — the fourth enumeration defect of mine this run, and the first one with a mechanism

The worker read the fix-round artifact against the report and found it ruled on **fifteen of sixteen
findings**. It did not fold the gap in silently, and its reason is the right one: *"a finding that
nobody ruled on is exactly the thing that disappears."*

**Checked mechanically rather than by eye, which is the change.** Deriving the id list from the
report's own `###` headers gives 18 ids — F1–F16 plus R1 and R2 — and matching each against the
artifact leaves **exactly one missing: F14.** The worker's count was exact.

**And the first checker lied, in the safe direction.** It reported four MORE as missing (F12, F15,
F16, R2) because its pattern demanded `**Fn` followed by space/comma/paren while the artifact spells
three of them `**F12.` and one as plain "F11 and F15". The checker under-matched the document's own
spellings. **The direction of a checker's error is itself a property worth naming:** one that
over-reports costs a re-read; one that under-reports hides the gap. Neither answer was believed until
the pattern was fixed.

> **Standing for the rest of this run: no ruling over a set of findings is published without deriving
> the id list from the report and asserting coverage.**

That is the mechanism version of a rule I have stated at other people all day and failed four times
myself — "all six" when it was five; the safe/reachable split whose headline disagreed with its own
list; two figures published without naming the tree they came from; and now fifteen of sixteen. **A
rule that is only ever stated is the thing this entire wave exists to stop.**

### F14 ruled: NARROW the sentence, and not for cost

The new `_plat_mv_notdir` header closes *"And no symlink-to-DIRECTORY exists at any of the eight
anywhere in the tree"* while its own census is scoped to a literal `ln -s` in the shipped files and
excludes fixtures by construction. The reviewer offered two directions; I take the narrowing, because
the reviewer **already measured the fixtures** — `POOLS()/demo` targets a FIFO, `/dev/zero`,
`/dev/null` and a regular file, none a directory. So the wide claim is *true today*. Its warrant would
then rest on a fixture census nobody maintains, and it goes silently false the first time anyone adds
a directory fixture: an absence claim with no writer that maintains it. **Scope it to what the census
measures — and any surviving sentence about fixtures must name the census that would catch a new one,
or it is the same defect one sentence shorter.** Costs if wrong: a narrower true sentence.

**The worker's substitution is ratified** — it proceeded on the reviewer's fix direction rather than
stalling the round on a round trip, under the standing conflict rule written one exchange earlier:
nothing irreversible, cheapest route that discharges it, report rather than silently fold in. First
occasion after the rule was written, used exactly as intended.

### F9 lands in two homes, and the worker was right that it cannot land one of them

A worker never merges, so the hand-written squash body is mine. Ruling: **the corrected row 6 goes in
the plan's A5 table** — tracked, durable, consistent with F5 — **and** the squash body states it. The
body alone would not do: under a squash merge `79aa38b4`'s message never reaches `main`, so the squash
body is the only surviving message, and a reader looking for a mutation result looks at the table, not
at `git log`. The worker writes the artifact with the trailers DERIVED; **verifying it lands is mine.**

### Its F1 scope note, verified — with one citation fourteen lines off

Platform block is `ccd/ccd:11-948`; all three F1 sites (4927, 5158, 5214) sit far outside it; the next
top-level definition after `_pr_py` is at 5366, so it encloses all three; and all three read exactly
`if os.path.lexists(X) and not os.path.isfile(X):` — one defect, three times. **`_pr_py` opens at
4675, not the 4689 it cited.** Substance right, citation off; recorded only because this run has been
two parties holding each other to citing a `ccd` line with the copy it came from. The byte-identity
conclusion stands and `ccd/ccrc` needs no mirror edit.

---

## Fix round 1 handed back; the ordering deviation accepted on the half the worker under-claimed

Mail 1589, `wave-done`, fingerprint `96d5ec10…` / PR 136 / open, `suite: red`, `failure: shallow`.
**Re-measured, not taken:** `git rev-parse HEAD` reads `96d5ec108dd647549d5c66a101590918a537655a`,
identical to both claimed fields; working tree clean; `git log -3` confirms the merge is last and the
re-point second-to-last, exactly as disclosed. Run 42 → `awaiting-review`; **review run 70 opened and
dispatched, SCOPED to the fix round** rather than a fresh whole-branch pass. All sixteen findings
closed, both cheap ones, both disclose-only ones; the citation census reports **12/12 green — the
first time on this branch**.

### The ordering deviation: accepted, and on the evidence the worker did NOT lead with

A merge of `origin/main` (`2f9deae2`, #135) landed mid-round, touching the same files as the repair,
so the repair is second-to-last and the merge is last — against the rule, adopted this run, that a
citation repair lands last because it is only valid against the tree it ships in.

The worker offered two arguments. **(a) "the census is green at the merged tree" cannot carry it, and
its own finding 3 is the proof:** `ccd/ccrc:7129-7130` is green *and still stale*, because inserted
lines happen to carry a token its clause quotes. **Green is compatible with wrong.**

**(b) is the proof, and it is larger than claimed.** The worker cited `ccd/ccd` alone; measured here
across every source file the re-point points into:

| file | base → main | verdict |
|---|---|---|
| `ccd/ccd` | 19,334 → 19,334, numstat 4/4 | line-neutral |
| `ccd/session-hook.sh` | numstat 5/5 | line-neutral |
| `ccd/ccrc` | 11,911 → 11,911 | **not touched by #135 at all** |

No line below #135's changes moved in any file the re-point addresses, so no re-pointed anchor can
have shifted. **Accepted on (b).** Costs if wrong: every anchor into a moved file re-derived — which
is what review run 70 is asked to check independently.

### The README hazard is new, and it generalises past this wave

The anchor went stale a **third** time, and the offset method nearly shipped a false repair: **the
method assumes the CITING document is byte-identical to the base**, and README is the one corpus file
this wave edited, so at the already-repaired anchor the base block is unrelated text — following the
method moved README's anchor onto Python source while its clause is about the `genrc == 1` arm. Caught
only by re-measuring after applying. Re-derived by CONTENT; verified here byte-equal
(`HEAD:16678-16680` ≡ `76897187:16644-16646`, both opening `elif (( genrc == 1 )); then`), and
README's census entry is now empty for the first time this wave.

> **The offset method is valid only where the cited file moved AND the citing file did not.**

### Finding 3 — a stale anchor that LEFT the failing set by coincidence

`ccd/ccrc:7129-7130` is D-2849's parked reference inside the 24,688-byte freeze. This branch added
nine lines above it, so the stale anchor now lands on `_uninst_cc_sessions`' own `rm -f` lines, which
carry a token its clause quotes. **It went green without being repaired and was never reachable to
repair.** The worker kept the five named, made the exception its own constant with the reason beside
it, and the pin that caught it is the one whose comment says a set keeping its length while losing an
entry must still red.

**Routing is mine, not the worker's** — it does not write to another programme. This goes to the
operator as the **second instance** of "#134's census is a ratchet with no owner", and it is the
harder failure of the two: **nothing ever looks at a green row again.**

### Two smaller things, both right

**The `|`-row count was retired, not resolved.** Three sources had said 54 / 53 / 52 at a tree that no
longer exists. The worker measured fresh at the shipping tree — **23**, instrument named — and did not
pick one or average. A disagreement about a dead tree is a question to retire, not settle.

**`suite: red` / `failure: shallow` stands**, for the third time, though the suites are now green:
clause 15 asks what the FIRST full run after implementation said. Reporting the better number would
make that field a summary of the worker's fixes instead of a measurement of its branch.

**F9 remains mine to land.** The corrected squash body is written as an artifact with the trailer
command to re-derive; I derive at merge rather than trusting the two names measured, and read
`git log -1 origin/main` back afterwards to confirm the body landed as written.

---

## Six comment lines would have invalidated a 112-anchor repair

Mail 1594 supersedes 1589: tip `37a175eb`, one commit, because 1589's fingerprint described a tree
missing two items I had required in mail 1586. **Verified rather than taken:** tree clean, #136 OPEN
at that head and MERGEABLE, and the commit is **line-neutral in all three cited source files** —
`ccd/ccd` 19,691, `ccd/ccrc` 11,974, `ccd/session-hook.sh` 3,174, identical either side — touching no
corpus document, only this wave's own plan at +21/0.

**The finding is the headline, and it was in nobody's plan.** The worker's FIRST version of the F14
edit added four lines to `ccd/ccd` and `ccd/ccrc`. Measured, not feared: `byFile['ccd/ccd']` **29 →
83**, README back to one failure, the `|`-row set **23 → 45**. Six lines of *comment* would have
destroyed a 112-anchor repair. Rather than re-run the repair it rewrote the replacement to occupy
**exactly the six lines it replaces** — the property #135 itself engineered for and named in its own
commit message, read and applied.

> **Once a citation repair lands, every later commit touching a cited file must be LINE-COUNT NEUTRAL,
> or the repair is re-run.** The repair creates an invisible constraint on everything after it, and
> prose is not exempt: a comment is lines.

### The conflict was mine, for the second time this run

In mail 1591 I wrote *"You are done until it reports. Do not push"* — having already, in 1586,
required two more work items. **Taken together my instructions were unexecutable:** do these two
things, and do not push. The first instance was telling the worker to write something *"in the finish
commit"* after its finish commit had landed. **Same defect both times: I issue a requirement and then
freeze the branch without noticing I have.**

**But the cheaper route existed, and the rule gets sharper rather than forgiven.** The standing rule
says discharge the other instruction by the CHEAPEST route. That was: commit locally, push nothing,
mail *"both items done, held unpushed — say when."* That discharges both — the work exists, the
review's subject stays still, and the decision to move a tip stays with the party who knows a review is
in flight. The worker chose the most COMPLETE route, not the cheapest, and it discharged my
requirement by spending something that was not its to spend. The cost landed bounded only because it
made the commit line-neutral — engineering rather than luck, but a margin to preserve, not to rely on.

> **Refined for the rest of this run: when a conflict's cheapest discharge is available only to the
> coordinator — an unblock, a permission, a decision about a shared resource — the cheapest route is
> to ASK, and holding finished work locally costs nothing. An unpushed commit has changed nothing
> about anyone else's tree.**

**Recovery taken rather than waited for:** review run 70 was redirected to `37a175eb` immediately,
with the delta named and my own neutrality measurement given as something to RE-MEASURE rather than
accept — item 4 of its brief already asks that question about the #135 merge, and this is a second
instance of it. Waiting for the `stale-review` refusal would have cost a whole fresh review run.

### Two smaller things

**F14's second narrowing is right, and the worker read my condition better than I wrote it.** Its
first narrowing kept run 69's `POOLS()/demo` measurement as a surviving fixture sentence; no census
maintains it and I declined to build one, so the comment now makes **no** fixture claim and says why.
The measurement moved to the plan, dated and attributed to the tree it was taken at. **A review
finding is a fact about a tree; a comment is a standing property — and the second is the one that
rots.**

**Its citation correction of my citation correction is accepted.** `_pr_py` opens at 4675 at
`76897187`; it had cited the import line inside the heredoc. At this tip it is 4684. Both parties have
now mis-cited a `ccd` line in the course of insisting on `ccd` line discipline.

---

## Run 70: a critical fourth site, and two of my rulings measured wrong

Run 70 reported at `96d5ec10` — the tip the worker superseded while it read — so its close would refuse
`stale-review`. **Closed `failed`, and RUN 71 opened as a CARRY-FORWARD** rather than a fresh review:
run 70's 26 findings (1 critical, 13 important, 12 minor; panel 16 confirmed / 4 refuted / 0
unexamined) and run 69's 18 ids are its starting evidence, not discarded. The worker is told to HOLD —
no work, no push — so it does not fix stale findings or move the tip under a second reviewer.

### The critical, and it is my defect rather than the worker's

`get()` at `ccd/ccd:5002` still reads `if not os.path.isfile(p)` — **the exact call the fix removed
fifty lines above it** — so a symlink at `$REG/<id>.<field>` makes `get()` return a foreign file's
bytes as the field. Run 70 measured it end to end; I confirmed the line is present and unmoved at
`37a175eb`, while `put()` (`:4952`) and the lock (`:5188`) now correctly use
`stat.S_ISREG(os.lstat(...))`. The file even carries a comment at `:4977` explaining that
`os.path.isfile` follows symlinks — twenty-five lines above a call that does.

**I wrote "F1 CRITICAL, three sites" and the worker closed three.** A brief that names INSTANCES of a
class gets instances fixed. The rule is already in this ledger's own corpus —
*a ruling naming N guards names INSTANCES of a class; grep the shape before acting* — and I had it and
did not apply it. The round to come names the class by SHAPE: every `os.path.isfile`, every
`os.path.exists`, every bash `-f`/`-e` used as a TYPE TEST on a path that can be a symlink, censused
with its instrument, **and four is not to be taken as the count either.** Run 71 censuses it
independently; a difference between the two censuses is itself the finding.

### My ordering ruling was wrong, and it failed the way I have been correcting everyone else all day

I accepted the re-point landing before `#135`'s merge on line-neutrality, and wrote that I had measured
*"every source file the re-point points into"*. **I had not.** I measured three files I ASSUMED were
the set — `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh` — instead of deriving the set from the corpus.
Run 70 says three cited TEST files moved. Measured since:

| file | `dfa167d7` → `2f9deae2` | in the census's own `byFile` map? |
|---|---|---|
| `server/test/ccd-ws-reap.test.ts` | **2855 → 2860** | **yes** |
| the other seven map entries | line-neutral | — |

**The ordering deviation is therefore NOT accepted.** Whether it costs anything depends on how many
anchors point into a moved file — run 71 measures it, and every such anchor is re-derived by content.

**This is the fifth enumeration defect of mine this run and the first that produced a wrong RULING
rather than a wrong count.** The aggravating fact: the correct source was one command away, and I had
written *"derive the id list from the report and assert coverage"* to the worker three messages
earlier. A rule applied to other people's lists and not to my own file sets is not a rule I hold.

> **Generalised, and it is the rule I keep re-learning in a new costume: the set you measure over must
> be DERIVED from the artifact that defines it — a findings list from the report's headers, a file set
> from the corpus's references, a call-site census from the shape. Never from what you remember the
> set to be.**

### Two more from run 70, held for the carry-forward

**F9 and F11 not addressed, and commit `d59f93d7`'s message CLAIMS F11 was** — the same defect as F9
itself, which was a commit message contradicting its own diff. The last commit's subject names F9, so
that one may have landed after run 70 read; F11 waits for run 71 to re-seat it.

**Four more anchors green by coincidence**, beyond the one the worker found and named. Its instinct to
name rather than delete the one it found is precisely what makes the other four findable.

**The fix round itself was sound:** suites at `96d5ec10` were server 331 files / 10,066 passed / 0
failed, agent 295/295, pwa 2602/2602, three builds green. What run 70 found is not bad work — it is a
class closed by list, an ordering accepted on an assumed file set, and an audit believed where it was
green. **Two of those three are mine.**

---

## The ordering closed on a derivation, and the false comment that defeated the audit

### "Your argument was unsound and its conclusion is true"

The worker's sentence, kept in its words because it states this run's rule better than I have:

> *"Your argument was unsound and its conclusion is true — those are different things and I would
> rather you had the measurement than the relief."*

It derived the set I had assumed: every path-qualified citation in the three corpus documents, 27
distinct paths, bare-basename citations resolved. Three cited files moved across `#135`
(`ccd-ws-reap.test.ts` 2855→2860, `ccd-lifecycle-purge.test.ts` 2493→2503, `session-hook.test.ts`
8758→8815) — **and the cost is zero for a reason neither of us had given:** all re-pointed anchors
point into `ccd/ccd` and `ccd/ccrc`, both line-neutral across `#135`. Anchors into a moved file: zero.

**Verified here independently**, extracting citations either side of `61e0d45b`: the re-point changed
anchors into **exactly two files**, `ccd/ccd` and `ccd/ccrc`, and **none** into any file `#135` moved.
**And my instrument is narrower, which is named rather than left as a discrepancy:** I count 66
distinct `(doc, path, line)` tuples where the worker counts 112 references, because my regex requires
an explicit path while the census's own `REF_RE` lets a bare `:N` inherit one. **Its number is the
right one** — the census's own grammar — and mine is a stricter instrument over the same set. An
unexplained 66-vs-112 in two records is exactly the three-way `|`-row mess just retired.

**The ordering question is CLOSED, on the worker's derivation and not on my ruling.** Its boundary is
recorded too: this says nothing about anchors it did NOT re-point — the 10 non-unique, the 18
re-pointed-and-still-red, and every already-passing anchor. Debt those carry into the three moved
files is `#135`'s, not this repair's.

### The fourth site has two sufficient causes, and the worker only gets one

It declined my attribution, and it is right about its own half: it **opened `ccd/ccd:5002` during the
round, considered it, and ruled it out of scope** — reasoning that `get()`'s `isfile` is the D-2380
HANG guard and a symlink-to-regular-file cannot hang an `open`, which is true and is not the question.
It even noticed the read reaches outside `$REG` and dismissed that. **Examined and mis-ruled is worse
than missed**, and it belongs to the worker.

**My brief's defect stands beside it, not under it.** "All three sites" would have produced the same
outcome had the worker never opened the file. Two independent sufficient causes, neither cancelling
the other — and I keep mine because **the next brief is mine to write, and a defect handed away does
not get fixed where it recurs.**

### The finding of this run: a false comment defeated the audit of the code it describes

The shipped comment at that site promises the guard answers `None` on a type check alone — *"the same
answer an absent field already gives, NEVER A FABRICATED VALUE."* The worker reproduced a fabricated
value: a symlink out of `$REG` makes `get()` return `SECRET-FROM-OUTSIDE-REG` as the field. **It read
that comment during the round and took it as an argument rather than as a claim to test.**

That is the same class as the false clause at `ccrc-doctor-checks:2720` that opened this entire
programme, and it is the strongest case yet for the rule: **a comment asserting a safety property is a
load-bearing claim, because the reader most likely to rely on it is the one auditing the thing it lies
about.** The comment is corrected in the same commit as the guard, stating what the guard now actually
guarantees rather than what it was hoped to.

### Two instrument defects, one hour apart, both caught only by disbelief

**The worker's:** its edit script printed `ok F11 anchors note` per edit but wrote the file **once at
the end**; a later assertion aborted before that write, a second script re-read fresh, and F11 was
silently discarded. So `d59f93d7` claims a fix it does not contain — **the F9 defect, inside the commit
that closes F9.**

> **A script that reports per-edit and writes at the end reports INTENT, NOT OUTCOME.** Per-edit "ok"
> logs what the script meant; the file is the only record of what happened.

**Mine, and the worker's second:** my coverage checker under-matched `**F12.` and reported four false
MISSINGs; its audit grep began with a hyphen (`-t D-2925`), was read as an option, and reported a
present item as ABSENT until re-run with `-e`. **Both instruments lied in the same direction — toward
absence that was not there — and both were caught only by disbelieving a tool that disagreed with its
operator.** That habit is the thing worth keeping; neither script is.

**And the worker deliberately did NOT hunt the four coincidence anchors**, so as not to contaminate
the independent comparison with run 71. Correct, and for the same reason I have not told run 71 that
the ordering question is closed: it was asked to derive that file set itself.

---

## A diagnosis of an instrument is a claim too — and this one was wrong

The worker refused my reconciliation of 66-vs-112 (*"a stricter instrument over the same set"*) on
correct grounds: that asserts a relationship between two numbers without deriving it, which is the
thing this run has spent all day refusing from other people. **It was right to refuse it and I should
not have offered it.** It then computed five readings of my predicate against its repair set, found
none equal to 66, refused B=67 as an off-by-one — *"the least trustworthy kind of agreement"* — and
landed on: `66 = spec 39 + plan 27`, i.e. *my instrument does not count README*, with the conclusion
that **the one repair that was actually wrong is the one my instrument would have been blind to.**

**Measured before replying, because a diagnosis of a tool is a claim like any other:**

| document | removed | added |
|---|---:|---:|
| `README.md` | **1** | **1** |
| `…compaction-card-plan-a.md` | 28 | 28 |
| `…compaction-card-design.md` | 37 | 37 |
| | **66** | **66** |

And the README reference it sees, by name: `ccd/ccd:16644-16646` → `ccd/ccd:16678-16680` — the
`genrc == 1` anchor, the one repair that was actually wrong. **It is the one my instrument sees.** So
the load-bearing sentence of that mail is false, and 66 is not `spec 39 + plan 27` but
`README 1 + plan 28 + spec 37`. The gap to its B=67 is **distributed** — 39/27 against 37/28 — a
KEYING difference (doc-line-keyed repairs against occurrences of changed citation tuples), not a
dropped document.

**The number is still not retired, and on the worker's own reasoning:** an off-by-one is the weakest
agreement there is. What each measures is the honest end state — mine counts occurrences of
path-qualified citation tuples whose text changed; its counts doc-line-keyed repairs under the
census's own grammar, bare `:N` included. **Its grammar governs, because the census is what goes red.**

**Two things of its survive intact, and they are the valuable ones.** The 45 bare-`:N` references are a
real gap in my regex. And the corpus property is the durable finding: **two independent instruments
have now under-counted this corpus by dropping bare references** — its first pass ran 112 → 17 before
it handled both spellings, mine drops 45. Anyone building a third should be told before they start.
So is the rule it drew: *a scope that silently drops a document reads identically to a scope that found
nothing there* — true, and exactly why refusing my lazy reconciliation was right.

### The shape worth both parties' time

The worker refused an off-by-one as too weak to close a number — correct — **and then closed it on a
decomposition it had not run against the instrument it was diagnosing.** Same defect, one step later,
inside the message diagnosing that defect. I did the identical thing an hour earlier, ruling an
ordering on a file set I assumed.

> **Neither party should diagnose an instrument it has not run.** It cost one command here — the same
> command the other would have run — and the alternative is a confident, specific, false claim about
> why someone else's number differs from yours.

Nothing here touches what the worker is holding: its repair set, its zero-cost derivation and its
stated boundary all stand exactly as measured, and my independent check confirmed the file set.

---

## Three explanations, three refutations, each undone by one command

The 66-vs-112 thread closed, and what it produced is worth more than the number.

**The worker reproduced my 66 exactly** with its own instrument — README 1, plan 28, spec 37 — and
withdrew "your instrument cannot see README". **Then it refuted my cause too**, and I reproduced its
refutation here independently:

| keying | README | plan | spec | total |
|---|---:|---:|---:|---:|
| changed doc lines | 1 | 15 | 43 | **59** |
| …of those carrying a path ref | 1 | 13 | 33 | **47** |

Identical to its figures. **My "keying difference" explanation is refuted** — doc-line keying gives
47, not 67 — and I had asserted it without running its keying. Withdrawn.

### The score, and the third is mine in the message that named the defect

1. **Mine** — *"a stricter instrument over the same set"*: a relationship asserted, not derived.
2. **Its** — *"your instrument cannot see README"*: my instrument diagnosed without running it.
3. **Mine** — *"it is a keying difference"*: its instrument diagnosed without running it.

**Each correction cost one command.** The explanation was the expensive part every time, and wrong
every time.

> **An explanation of a numeric discrepancy feels like analysis and is a hypothesis — and it is
> cheaper to TEST than to construct.** When two measurements of one artifact disagree, neither party
> may explain the gap; both must run.

Its 67 is unreproducible under any of six keyings, so the off-by-one was signal about its number
rather than about my scope. **My refusal to retire it was right for a worse reason than I gave:** I
refused on principle; it closed on measurement.

### The one thing that got stronger under examination

The final `measure.json` is gone, but replaying the repair against the surviving earlier one
reproduces the landed anchors **shifted by a constant** — +34 past the insertion, +9 below, matching
the later commits' additions exactly. That is positive evidence the re-measure-at-the-shipping-tree
condition was honoured, because the landed numbers are then provably not any earlier measurement's
numbers. **A story about having re-measured would be worth nothing; a constant is checkable by
anyone.**

### The instrument is the deliverable

The worker's repair script tallies substitutions per PARAGRAPH and applies edits by BYTE RANGE, so two
repairs on different LINES of one paragraph become two edits over the **identical** range: applying
both keeps only the last, and the tally counts both. **It can report repairs the file never
received — intent-vs-effect WITH incremental writes**, which is the shape both of us thought
incremental writing ruled out.

It measured whether the latent discard fired — spec 23 repaired lines across 23 distinct segments,
plan 8 across 8, zero collisions — and then **stated the bound on its own exonerating result**: that
ran against the surviving repair set, not the final one, so it is strong evidence and not proof.
Applying that discipline to a result in one's own favour is the hard direction.

**Ruled: closed in the fix round against the FINAL set, one command, reported either way.** And
deliberately NOT sent to run 71 — it is hunting coincidence-green anchors independently, which is the
overlapping detector for a lost repair, and handing it a specific hazard the worker found would
destroy the comparison. If the two censuses disagree, the disagreement is the finding, and that only
works if neither party was told.

**Thread closed:** 66 reproduces under two independent instruments, 67 under none, the cause is an
artifact that no longer exists, and both durable findings — the bare-`:N` corpus property and the
paragraph-range discard — are recorded.

## 2026-09-17 13:5x UTC — run 71 closed; two CRITICALs I re-measured myself; the fix round, and the order that is the ruling

Review run 71 (`ccrc-pwa-soft-river`) reported at `37a175eb`: **22 findings, 2 CRITICAL, 415 agents,
0 dead, `unexamined: 0`, `unverifiedLenses: []`.** Advanced to `working`, closed with the reviewer's
own `{reviewedTip, report}` — `done`, `released:true`. The report sat under `~/.cc-clips/`, which is
on the agent read whitelist, so the close route could stat it: run 69's structural refusal did not
recur, because the brief now names the whitelisted home rather than the worktree clause 7 asks for.

**I re-measured both CRITICALs before ruling, and a third finding that falsifies a sentence this
wave minted. All three reproduce exactly.**

### CRITICAL 1 — the class is three read sites, and two of them are bash

I reproduced the read-through in a fixture HOME, with controls, at the reviewed tip:

    _reg_get  demo  rc=0 value=[SECRET-OUTSIDE-REG]     # ccd/ccd:2282
    _reg_read demo  rc=0 value=[SECRET-OUTSIDE-REG]     # ccd/ccd:2391
    get('demo')  -> 'SECRET-OUTSIDE-REG\n'              # ccd/ccd:5002
    controls: a real regular file -> its own bytes; a DANGLING symlink -> rc 1 / rc 2 / None

A live symlink at `$REG/<id>.<field>` returns a foreign file's bytes **at rc 0** — indistinguishable
from a real read, and `cmd_pr_state` persists it into `.prhistory`. My brief for run 70 said "F1
critical, all three sites", naming instances of a class; the reviewer's brief said not to take four
as the count either. **The answer is three read-side sites, one python and two bash — and the bash
pair is the most-called reader in the tool, 142 invocations.** Neither of my two counts was right,
and the reason is the same both times: I counted the instances someone had already found.

The scan that makes the twins safe to convert is measured (`git grep -nE "ln -s(fn)? .*(REG|
cc-sessions)" 37a175eb -- ccd/` → three hits, all comments), and **it answers only "does converting
break a shipped caller".** It cannot bound the population — anything with a shell can write that
directory. Ruled explicitly into the brief so the scan is never quoted as containment; that vacuity
is this wave's own subject.

### CRITICAL 2 — the branch no longer merges, and the deliverable had to change shape

`git merge-tree --write-tree ecbb8b22 37a175eb` — no working tree touched — gives three conflicts,
each one a thing this wave was about: the `# ccrc:generated` marker, the one README line the wave was
authorised to repair, and **the citation-debt map itself**, where main asserts `'ccd/ccd': 125` /
total **162** and this branch asserts **29 / 66**. Two branches have each re-measured one census off
one base to different values, each true of its own tree and neither of the merge.

The reviewer offered two options — re-point once more, or take the repair out. **Neither is
available: "take it out" is not a revert.** Reverting restores a *different* wrongness, since the
reverted anchors point at pre-#135 lines that are also wrong on the merged tree.

**RULING (D-2990): the repair's deliverable stops being a number and becomes a derivation that was
run last.** The census map and total are whatever the instrument prints on the final tree; neither
66 nor 162 may be typed; if it prints 200, 200 ships and the commit names the command. Same for the
README anchor and the stamp. This is the only shape that converges, because the old deliverable was
a number true of a tree that stops existing the moment `main` moves — and **`main` moved twice
inside a single review.** Making the deliverable a derivation makes re-running it cheap, which is how
the race is won: by shortening the window, not by measuring more carefully.

### The order is the ruling

Three items each change `ccd/ccd`'s line count and two are *derived from* it. Merge first, then the
guard class, then every tree-derived cardinal last, stamp last of all. **Nothing in step 3 may be
typed from an earlier measurement, including one taken earlier in the same round.** Done in the
intuitive order each step invalidates the last — which is how this wave has expired three repairs in
a row.

### F4 is the indictment of the method, and it is why the scope contracts (D-2992)

Twelve distinct anchors are coincidence-green: spelling unchanged, audit GREEN, cited bytes moved.
**The repair takes its work list from the census's FAILING set, so it can never reach them** — not
through more care, not through another round. Two are caught by main's new assertion and are fixed;
**the other ten are declared with the instrument, not repaired.** A declaration carrying its
instrument is inheritable; a repaired ten with no instrument is another number that goes stale.

Run 70's four were real but its framing — that they "left the failing set" — does not hold; all four
were already green at `d59f93d7`. I accepted that framing. The correction is mine to carry.

### Two inferences of mine that the round retires

**"Line-count neutral" was never anchor safety.** #135 rewrote `ccd/session-hook.sh:1118-1120` and
`:1123` **in place**; the cited span `1115-1119` covers them. A file can keep its length and change
every byte under a citation. I made that inference twice and closed a deviation on it once.

**A verified wave-done freezes the tip (D-2991).** `37a175eb` landed after its own wave-done and
that is what discarded review run 70 — 26 findings, a full panel, six sharded suites, closed
`stale-review`. The worker did the obedient thing; my F14 ruling arrived into a branch already under
review, and a requirement delivered then has nowhere to land except a push. **The constraint binds
the coordinator, not the worker:** I do not issue requirements against a branch whose fingerprint is
under review — they wait for the brief that review will trigger.

### F3 — the third occurrence of one shape, inside the paragraph that exists to fix it

`ccd/ccd:128` / `ccd/ccrc:187` / plan `:330-331` ship "fixtures create links with `symlinkSync`,
which no `ln -s` scan can see". Measured: **28 `ln -s` in `server/test/*.ts`, two of them in the file
this wave created.** The conclusion survives on its other reason; the second reason is false. Ruled:
delete the false one, keep the true one, **and do not supply a third** — one true reason is the whole
remedy. And my own F14 ruling said "if ANY sentence about fixtures survives": **"any" means any**, so
it reaches `ccd/ccd:98`, and that condition is unmet. Widening my own ruling against the branch's
interest is the direction that costs something.

### Dispatch, and two mechanism facts found by trying

Run 42 advanced `awaiting-review` → `working`. **`POST /api/runs/:id/dispatch` answers
`bad-transition` from `working`** — a run may be dispatched once, so a fix round is MAIL, not a
dispatch, and its `route` object has no ride. Sent as mail 1611 with both artifacts attached.

**`POST /api/runs/42/route` then answered `no-record` on `class`.** This worker's session predates
the routing slices (#116 landed on main during run 71), so it has no `.class` file and **the
coordinator's escalation door is closed for the whole life of that session.** The wave's own
`failure: shallow` signal — the matrix's direct call to raise effort — has no mechanism to act on.
The routing therefore lands by the brief's prose, where the worker skill's clause applies it, and the
gap goes to the operator. Deviations **D-2989**, **D-2990**, **D-2991**, **D-2992** issued (floor
2993) and defined in the brief, each spelled on its own.

**Reported, not fixed:** F14's compaction-lock fourth binary (`ls` reachable through the `/dev/fd`
arm while the mechanism-absence probe names three) and `ccd/ccd-usage-sweep.py`'s delete-side
`os.path.isdir` gate. Both are main's, both real, both mine to carry up rather than this wave's to
take.

## 2026-09-17 16:0x UTC — wave-done at `724dab2e`; the CRITICAL is closed; my own instruction was impossible

Worker reported `suite: red`, `failure: ceiling`, six commits in the mandated order, tip `724dab2e`.
**`ceiling` was the correct signal and the cause was my brief.**

### D-2989 is CLOSED, verified with controls rather than taken

I re-ran my own fixture probe against the worker's code:

    _reg_get  demo rc=1 | _reg_read demo rc=2 | get('demo') -> None
    controls: a real regular file -> its own bytes (all three); a dangling symlink -> rc 1 / rc 2 / None

The read-through is gone at all three sites. `_reg_read` answers **rc 2, not rc 1** — present-and-
not-a-field, never absent — which is the right arm and the worker chose it unprompted. Its per-site
mutation table (all three reverted 3F/164P; each alone exactly 1F) is what makes this a class rather
than three coincidences, and it named the shape that let this survive twice: **the dangling case is
green with NO guard**, so only symlink-to-an-existing-regular-file discriminates.

### My instruction could not be executed, and the reason is my own rule unapplied

I wrote "re-derive `ccd/ccd:6478` and `:13020` so main's new assertion goes GREEN". Two anchors
cannot close a gap of 70. **Review 71 measured that test at `d02c2549`, where the failing half was
the weak-anchor list; by the time I wrote the brief main was `ecbb8b22` and the failing half had
become the NON-VACUITY FLOOR — a different assertion in the same test.** I carried a DIAGNOSIS
across a moved tree, which is the exact thing my own brief forbids for numbers. **A diagnosis goes
stale the same way a number does, and I did not apply the rule to my own reasoning.** Third time
this wave a claim has been carried over a moved tree; the first two were also mine.

Corroborated by a hand that is not ours: **PR #140 is MERGED** — "the corpus walk's non-vacuity
floor … 200 → 100 against a measured 130 (main red at `ecbb8b22`)". The worker's 130 is that PR's
own number, arrived at independently. `origin/main` is now `2ff33333` — **the fourth move of main
inside this wave.**

### What I measured, with controls, before ruling

    main 2ff33333 alone ............ GREEN (1 passed)
    branch 724dab2e alone .......... RED (the old 200 floor)
    merge-tree 2ff33333 + 724dab2e . CLEAN, no conflicts, tree 2c7d63c5
    that test on the MERGE ......... RED — the floor now PASSES and the OTHER
                                     assertion fires: weak = ["ccd/ccd:2964"], exactly one anchor

**The floor failure was masking the weak assertion**, so the worker could not have seen it. One
anchor, attributed: the graphify spec `:99` cites `ccd/ccd:2964` for "the three-status `_reg_purge`";
`dfa167d7` and main both cite `:2872`; **this branch re-pointed it to `:2964`** while the merged
referent sits at `:3072`. Moved by +92 where the tree moved ~+200 — one anchor whose base was picked
wrong, which is the worker's own provenance defect in a single instance.

### The provenance finding is the best thing this wave produced, and it is accepted whole

**"The repair's base was never one tree."** Three populations — anchors `61e0d45b` re-pointed,
anchors that arrived with the merge, anchors nobody touched — so a single-base byte-equality method
produced **138 "provable" repairs of which 103 CONFLICT**, each base giving a different unique answer
for the same anchor. The fix is derivable rather than chosen: *an anchor's base is the tree whose
copy of that same DOCUMENT carries that exact spelling*. 176 failing → 117 repairable / 16 non-unique
/ 15 referent-gone / 28 already right, **no conflicts left**. Refusing the 16, the 15 and 5
unlocatable rather than guessing is correct and I overrode none of it.

**The mechanism did what the census cannot.** My ruling said declare the residue with its instrument
rather than repair it blind; main's assertion is now such an instrument, and it found exactly one
anchor the census scores green. That is the vindication of the ruling and also its bound.

I accept the worker's correction over the reviewer's on `ccd/session-hook.sh:1115-1119`: if the
anchor never matched its clause at any tree, it is not #135 residue, the defect predates the wave and
the clause's substance is stale too — the quotationless class, refused and declared, not re-pointed.
And its two stale-when-written corrections are my own rule biting inside a single round, caught by
the worker at the line-final tree. Its carried obligation closed against the FINAL set: 59 repaired
lines, 59 distinct segments, **zero collisions**, no edit discarded — and it took the same bound on
that exonerating result as it would have on an incriminating one.

Round 3 sent as mail 1616: merge `2ff33333`, re-locate that one anchor **by content**, re-derive every
cardinal last. Nothing else. I merge on green with `--admin`.
