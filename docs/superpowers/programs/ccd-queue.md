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

## 2026-09-17 03:0x UTC — the D-71 reachability audit: **13 sites, 10 safe, THREE reachable**, one guarded by a false comment

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

**The ten that are safe**, briefly, because a safe verdict is a measurement too: the five
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
saying it "must not come back". Thirteen call sites, three reachable, one guarded by a false claim.
**A rule stated six times in prose and violated thirteen times in code is a missing mechanism, not a
knowledge-transfer failure.** D-71 has never had a red suite. That is someone's wave — surfaced to the
operator, not taken here.
