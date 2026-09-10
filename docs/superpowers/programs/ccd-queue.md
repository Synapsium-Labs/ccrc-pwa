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
