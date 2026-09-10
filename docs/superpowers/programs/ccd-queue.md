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
