# Host load gauge — the fifth instrument in the strip — design

Status: **agreed in dialogue with the operator, 2026-09-20**, decision by decision. Not yet planned,
not yet built on any ref that ships. Measured against `083aeb10`; every `file:line` below was read there.

A REFERENCE IMPLEMENTATION EXISTS AND IS PARKED: branch `wip/host-load-gauge` (commit `33f10b54`),
suite-green on all three packages, written while the design was being agreed. It is **evidence that
these seams work and a source to cherry-pick from, not the deliverable** — the point of this file is
that the work goes through the lane properly. The mockup the operator signed off on is on that branch
too (`docs/superpowers/research/2026-09-20-host-load-gauge-mockup/`, regenerable) and on the operator's
private canvas at `https://claude.ai/artifact/6NfVj1ptLvYBDmXw6v5UXA`.

## 1. The problem, measured

The console shows what every ACCOUNT is spending (`pwa/src/fleet/AccountsStrip.tsx`, five-hour and
seven-day windows off `~/.cc-limits`) and nothing at all about the BOX those sessions run on. Twenty
tmux sessions share one machine; when one wedges a thread, when a test sweep eats the page cache, or
when memory pressure is about to have the OOM killer pick a session, the operator's only readout is a
session that went quiet. `ccrc-graph-sweep`'s OOM on a 15 GB box is the worked example already in the
operator's notes.

Nothing in the tree measures this today. Searched `server/src`, `agent/src`, `ccd/`: no reader of
`/proc/stat`, `/proc/meminfo` or `os.loadavg()` exists; `FleetHealth` (`shared/api.ts:3108`) answers
reachability and agreement, never load.

## 2. What is being built

One tile in the accounts strip, in the same chrome as an account gauge, showing ONE host: **the box the
sessions run on** — the fleet host in remote mode, the server's own box in local mode. Never a second
tile for the server box; the operator ruled that the box that runs the sessions is the only one worth
the pixels, and a reading that might be about either box is worse than no reading.

Two rows:

- **`cpu`** — the whole box's average over the reading's own window, drawn as the fill; the **two
  busiest logical threads as ticks on the same track**, with the hotter one amber past 90%. A pegged
  single thread is invisible in a 20% average on a 16-thread box, and that is exactly the state worth
  catching. A tick can never land inside the fill: no average outruns its own maximum.
- **`mem`** — `used` and `cache` as **one pill in two tones** on the RAM track, and **swap on its own
  3px hairline underneath**, on its own scale.

### 2.1 The decisions the operator made, and may not be quietly re-opened

1. **CPU is never banded amber/red.** The account meters band at 50/75 because usage there is a budget
   being spent; a fleet box at 80% CPU is a fleet box doing its job. Red is reserved for the row where
   it means an OOM is coming.
2. **Memory bands at 75/90**, not the account ladder's 50/75 — half the RAM in use is a box at rest.
3. **Swap is not in the RAM bar.** It was, pinned to the right edge, and the operator rejected it: two
   different devices cannot share one scale, and on the box closest to an OOM the violet segment lands
   ON the red one, so the single worst reading in the fleet draws as a collision. Its hairline sits
   inside the row's existing height (5px + 2px gap + 3px = 10px, under the 15px the percentage cell
   already sets), so the tile does not grow and nothing shifts on the poll where swap first appears.
   It is drawn only when some swap is in use, and scaled to the SWAP total: "how deep into swap are
   we", not "how much of RAM is it worth".
4. **The two memory tones are one pill.** The track's `overflow: hidden` rounds the outer ends, the
   join stays square, and the right-hand cap belongs to whichever segment is last — so a box with no
   cache worth drawing (< 0.5%) still ends in a cap. A 1px divider between the tones was tried and
   rejected: it reads as a gap punched in the bar.
5. **The percentage is `used` alone.** Cache is handed back under pressure, so `used` is what predicts
   an OOM. Either tone can be the larger — `used = total − free − cache`, so the pair always sums to
   the bar — and both orders are normal.
6. **Position is fixed and does not depend on the number of accounts.** Desktop: its own column at the
   RIGHT EDGE of the bar, 264px, outside the accounts grid, so adding, disabling or removing a lane
   never moves it. Phone: the last, full-width row under the strip. The operator asked for this
   explicitly.
7. **It is a sibling of `AccountsStrip`, never a cell inside it.** That grid is one `role="link"` onto
   `/accounts` (`AccountsStrip.tsx`), and a tap on box load must not open a screen that says nothing
   about the box.
8. **No reading is ever a zero.** Six named conditions, each a different sentence and a different fix:
   `absent` (no `/proc` — not Linux), `unreadable` (there and denied), `unparsable`, `unsupported`
   (the agent predates the op — deploy the agent lane), `offline` (no agent link), `timeout` (asked,
   nothing came back). The two halves fail INDEPENDENTLY: an unreadable `/proc/meminfo` still leaves
   the CPU row measured.
9. **A stale reading greys its fills** rather than fading the tile, the treatment
   `.accounts-row[data-disabled='true'] .acct-fill` already uses (`pwa/src/fleet/fleet.css`) and for
   its reason: a frozen bar must not keep reading as live pressure.

## 3. The seams

### 3.1 Why a dedicated agent op, and not two `read` calls

`/proc` is not on the agent's read whitelist and **must not be put there**: `agent/src/whitelist.ts`
refuses a widened read root by design, and an entry for `/proc` would hand the PWA every
`/proc/<pid>/environ` on the fleet box along with the CPU numbers (`agent/CLAUDE.md`, the whitelist
section). Sampling on the box is also the only way the two `/proc/stat` reads are a MEASURED interval
apart — over the WS they would be two round trips apart, which is a window nobody measured.

So: one additive, **pathless** frame, `{t:'req', op:'hostStat'}`. Additive per the wire rule — no
`FLEET_PROTO` bump. An agent that predates it rejects the frame in `validateReq` with `bad-request`,
which the server must read as `unsupported` (a positive answer: "deploy the agent"), never as a box
with nothing to report.

### 3.2 Where the algorithm lives

`shared/hoststat.ts` (L0, imports no runtime module and no `node:*` — the PWA bundles this tree): the
`/proc/stat` and `/proc/meminfo` parsers plus the sampler, with the reader, the clock and the sleep
**injected**. The agent passes a `node:fs` reader; a local-mode server passes its own `FleetIO`
(`readFileMeasured` already answers the exact `{ok}|{ok:false,reason}` shape); a test passes a map of
strings. One implementation, so the two boxes cannot compute different numbers from the same text.

Parser rules that carry real weight, each of which must keep a red test:

- CPU ids come from the LINE NAMES (`cpu7` → 7), never from positions: an offline CPU is simply absent
  from the file and positions shift under you.
- `iowait` counts as IDLE. Counting it as busy is how a disk-bound box reads as pegged.
- A counter pair that did not move is `unparsable`, **not 0%** — a fabricated zero is
  indistinguishable from a genuinely idle box and the operator can act on neither.
- `cache = Buffers + Cached + SReclaimable − Shmem`, `used = total − free − cache`, clamped so the
  three segments always sum to the total and the bar can never overflow its track.
- A CPU present in only one of the two samples is DROPPED, never rendered from its whole counter.

The sampler holds the previous `/proc/stat` reading, so an ordinary poll costs one read and reports
over the poll's own interval; the first poll (and any after a long quiet spell, or one whose previous
sample is younger than ~900ms) takes a pair ~400ms apart itself.

### 3.3 Server

A port declared by its consumer, two adapters (agent / local io), and a cache in front:

- `GET /api/host` → the reading. **Never 5xx and never an empty body** — a named failure is the answer.
- 5s cache **and a shared in-flight request**. Both halves matter: the TTL bounds how often a quiet box
  is sampled, and the single-flight share is what stops ten clients polling on the same second from
  becoming ten agent round trips, which a cache alone does not.
- `at` is RESTAMPED with the server's clock. The agent's stamp is honest about the agent's clock, and
  the PWA compares `at` to its own to decide "stale"; across two boxes that comparison is what lies.
- A 4s request budget, well under the client's 15s default: a widget that waits fifteen seconds to say
  nothing is worse than one that says `timeout` in four.

Gating: an ordinary PWA-surface READ. **Not** box-token gated, **not** EXEMPT — session-gated when
`CCRC_AUTH` is armed, exactly like `GET /api/fleet`.

### 3.4 PWA

One component, its own poll (6s, matching the server's cache), skipping a hidden tab and snapping
current on `visibilitychange`. The response is SHAPE-CHECKED before it is rendered: a type is not a
guard, and several fixtures in the suite answer an unmatched route with a bare `{}` — `cpu.ok` on that
throws inside render and takes the whole screen down. The lesson is already written down one component
over (`AccountsStrip.tsx`'s `Array.isArray` note and its D-reference).

No `role="group"`/`aria-label` on the tile: FleetScreen's group census is its bucket chips, and a
second kind of group in that list is one more dead end in the rotor
(`pwa/test/fleet-screen.test.tsx`, "adds no landmark per bucket" — that test enumerates them
exhaustively and will go red).

## 4. What the plan must not forget

1. **Route-count prose is pinned.** A new HTTP route bumps four hand-written numbers that tests derive
   and compare: `server/test/auth-gate.test.ts` (the `server.ts` scan count, `ROUTES.length`, the
   "in one loop over all N HTTP routes" claim, the "N scanned + the static wildcard" comment) and
   `server/src/auth/gate.ts`'s own docstring ("stands in front of all N routes"). Adding a route is a
   deliberate act that edits those numbers — that is what the file says, and it means it.
2. **The contrast gate audits new rules.** Any rule that sets a `color` and names no painted ancestor
   enters `report.uncovered` and `pwa/test/contrast.test.ts` fails on the addition. Register it in
   `pwa/design/audit.mjs`'s `INHERITED_GROUNDS` against the WORSE of the tile's two grounds
   (`--bg-raised`, the desktop repaint), with the reason written out.
3. **Mutation-table discipline.** Each guard above ships with a test that goes red when it is deleted.
   The one that matters most: **`/proc` must still be unreachable through the agent's `read` op** — if
   that ever loosens, this whole op becomes the redundant option rather than the cheap one.
4. **Deviation numbers are ISSUED, never chosen.** `POST /api/ledger/deviations` mints the block; a
   session that cannot reach it writes `D-TBD-<slug>` and reports. Nothing in this file allocates one.
5. **AGENT-FIRST.** The change touches `agent/`, and the server's new adapter asks for an op the
   deployed agent may not have. Ship `deploy/deploy.sh agent <host>` before the server lane; until
   then the tile honestly reads `agent old` rather than showing zeros, which is the designed
   degradation and worth verifying on the real fleet.

## 5. Acceptance

- Parsers: ids-from-names, iowait-as-idle, the htop split, and `null` (never an empty reading) for
  every shape the parser does not understand.
- Sampler: a pair on the first call; one read and the poll's own window on the next; a fresh pair after
  a long gap; `absent` and `unreadable` kept apart; the two halves failing independently; a file whose
  counters never advance reported as `unparsable`.
- Port: one reading per window, one in-flight call shared, a port that breaks its never-throw contract
  turned into a named failure rather than a rejection.
- Route: the reading through, a named failure through, 200 in both cases, and a `Deps` with no port
  saying which condition that is.
- Agent: the op answers a computed reading; a box with no `/proc` answers named failures rather than a
  rejection; a smuggled `path` field changes nothing; `/proc` still `forbidden` through `read`.
- PWA: the numbers and the two ticks; no ticks on a single-thread box; the memory pill's cap on the
  last segment; swap on its own track at its own scale, structurally a sibling of the RAM track; six
  distinct words for the six conditions; independent halves; the stale greying; no poll while hidden;
  the tile outside the accounts link; the fixed right-hand column asserted as CSS text.

## 6. Environment notes for whoever picks this up

- `npm ci` cannot complete in this worktree: `node-pty` needs `make`, which is not installed on this
  box. The working move was copying an already-built `node_modules` from a sibling worktree — its
  `ccrc-agent` symlink is relative (`../../agent`), so it repoints itself correctly.
- `strace` is not installed either, so `server/test/session-hook.test.ts`'s five strace tests fail here
  for that reason alone (its own first assertion says so). Everything else in that file passes.
- Known load flakes are listed in the root `CLAUDE.md`; re-run in isolation before calling one a break.
