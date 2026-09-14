# Terminal Drawer Wave 1 — the latch and the reader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin every session's tmux window at the canonical 220x50 grid before a pty client can narrow it, and give the drawer a real console history read from a measurement of the pane rather than from a guess — closing, on `main` today, a hazard that destroys 157 of 1203 stored logical lines on the first phone attach (F14).

**Architecture:** Three mechanisms, all server-and-PWA, no `ccd/` and no `agent/`. (1) The **latch**: `GET /ws/pty/:id` issues the already-whitelisted `tmux resize-window -t cc-<id> -x 220 -y 50` *before* `spawnPty`, which sets `window-size manual` (F3) so the attaching client cannot reflow the history. (2) The **measured read**: a new `Tmux.paneProbe` (L3 adapter) runs one `list-panes -F` over the pane's six formats, selects the **active** row (F7), and answers a four-way discriminated union — never an overloaded null. (3) The **route and the drawer**: `GET /api/sessions/:id/pane/history` probes first and sizes its `capture-pane -S` window from the measurement, and the PWA history layer, touch drag and momentum land by cherry-pick from PR #96 and are then corrected against nine verified defects.

**Tech Stack:** TypeScript (server: Fastify + node:sqlite, `typescript` 7.x; pwa: React 19 + Vite 8 + `@xterm/xterm` 6.0.0 + `@xterm/addon-fit` 0.11.0 + vaul, `typescript` 6.0.3), vitest 4 (server: node env; pwa: jsdom), tmux 3.4, node `>=22.13.0`.

**Spec:** `docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md` (§2 the measured facts, §5 in full, §5.5 the review lenses, §5.6 the disposition of PR #96)

---

## Global Constraints

Every task's requirements implicitly include this section. These are this repo's project-wide rules, copied from `CLAUDE.md` and the spec.

- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts` (server-only). `server/src/coord/db.ts` imports `node:sqlite` unconditionally; below 22.13 the server fails to boot, not degrades. If node-floor's absolute assertion (3) is red while (1–2) are green, **RAISE engines — never lower them to make it green.**
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in: `server/` `agent/` `pwa/` `shared/`. `shared/` is not a real package — its bare `"type":"module"` marker is load-bearing.
- **This worktree has `server/node_modules` only.** `pwa/` and `agent/` have none. Run `cd pwa && npm ci` before the first PWA task, and `cd agent && npm ci` before the final whole-branch pass.
- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Run suites in the FOREGROUND, timeout ≥600000ms.** Backgrounding hides a hang; the suites are load-sensitive.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. CI on the quiet box is the arbiter; a flake CI passes is a flake.
- **Rings / bounded contexts:** ring membership is a property of a file's IMPORTS, not its path. **L0 `shared/*.ts` imports NOTHING** (not even `node:*`) — the PWA bundles those files. L1 policy = pure decisions, no `fs`/fastify/`reply`. L2 ports = interfaces + failure contracts, declared BY THE CONSUMER. **L3 adapters — an adapter may not narrow a distinction it received** (highest-yield rule). L4 delivery owns fastify/sockets/timers but is NOT allowed to DECIDE. L5 = `index.ts` only.
- **No overloaded null at a seam** — two conditions a caller handles differently must not collapse to the same value; that's a defect, not style. `PaneProbe`'s four arms exist for exactly this reason, and `server/src/io.ts`'s `readFileMeasured` is the pattern it copies.
- **Wire discipline — additive-only, absence-permits:** frames and response bodies are ADDITIVE; do **NOT** bump `FLEET_PROTO` (=1, `FLEET_PROTO_MIN`=1, defined once in `shared/api.ts`) for a new field. A newer peer must tolerate an older peer omitting a field, through a SINGLE reader per field.
- **Single-source-of-truth values are enumerated once and derived.** `server/test/single-definition.test.ts` text-scans four roots (`shared/`, `server/src/`, `pwa/src/`, `agent/src/`) and fails the build on a 2nd copy of a definition's shape. A constant this wave moves to `shared/api.ts` must be IMPORTED everywhere else, never retyped.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated — **measured before/after, not asserted in a comment**. Doctrine: "A comment is a request; a red suite is a mechanism." TDD red-first. Every task below ends with an explicit mutation check.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** `server/test/helpers.ts`'s `testDeps(home, run)` seeds a fixture roster under `mkTmp('ccrc-')` and wraps every `run` through `guardRunner`, which is the real agent `EXEC_WHITELIST` check. No task in this wave shells a real `tmux` or a real `ccd`; every server test drives a fake `Runner`.
- **NO NEW EXEC GRANT IN THIS WAVE.** `agent/src/whitelist.ts` already grants `tmux: [['has-session'], ['list-panes'], ['capture-pane'], ['send-keys'], ['resize-window']]` with no flag restriction (F8). The probe's `list-panes -F '…'` and the latch's `resize-window` are both reachable under existing grants. **A change to `agent/src/whitelist.ts` or to `ccd/` in this wave is out of scope and wrong** — that is wave 2, and it is AGENT-FIRST.
- **Deploy class for THIS wave: `server`.** `bash deploy/deploy.sh` (server lane only). This wave touches `server/`, `pwa/`, `shared/` and nothing else, so the AGENT-FIRST rule does not apply to it. Coordinates live in `~/.ccrc/deploy.env`, machine-local.
- **Branch discipline:** commit on **this workspace's own branch** only (worker skill clause 2) — never a separate feature branch, which wedges every close with `stale-tip`. PR #96's branch `fix/terminal-scrollback` is **not continued**; it is salvaged by cherry-pick with `-x` and the author's `Co-authored-by:` trailer (§5.6).
- **Canonical grid is `220x50`** — the value `ccd` spawns with (`ccd/ccd:14739`, and again in the retry at `ccd/ccd:14780`) and the value already spelled in `server.ts`'s pty close handler on `main`.
- **`PANE_HISTORY_LINES = 2000`** and it is deliberately NOT raised: F12's census says 25 of 31 live panes hold zero scrollback and the max is 11, at `history-limit 2000` throughout. A raise is §6.4's lever, explicitly not in this program.
- **Deviation numbers are ISSUED, never chosen** — see `## Deviations found` at the end of this plan.
- Every commit message in this plan ends with exactly:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

| file | created / modified | its one responsibility in this wave |
|---|---|---|
| `shared/api.ts` | Modify | **L0.** Declares `PaneProbe`, `PaneHistoryReply` and `PANE_HISTORY_LINES` once, for both sides. Imports nothing. |
| `server/src/exec.ts` | Modify | **L3 adapter.** `Tmux.captureHistory` (salvaged, `-J`) reads the text; the new `Tmux.paneProbe` makes the one measurement of the pane and tells its four outcomes apart. |
| `server/src/server.ts` | Modify | **L4 delivery.** The pty route latches the canonical grid before `spawnPty`; the history route orders probe-then-capture and maps outcomes to status codes. Decides nothing the adapter already measured. |
| `server/src/auth/gate.ts` | Modify (salvage only) | The HTTP-route count in its own docstring, re-pinned to 73 by the salvaged commit. No `EXEMPT` entry is added. |
| `pwa/src/lib/api.ts` | Modify | The one typed client call for `GET /api/sessions/:id/pane/history`. |
| `pwa/src/components/Sheet.tsx` | Modify (salvage only) | `handleOnly` on the full-height variant, and a real `Drawer.Handle`, so the console's glass owns the drag. |
| `pwa/src/session/TerminalDrawer.tsx` | Modify | The drawer: the live glass, the history layer, the wheel, the finger, the throw, and the nine corrections. |
| `pwa/src/session/chat.css` | Modify (salvage only) | The history layer's and the key bar's styling. |
| `server/test/pty.test.ts` | Modify | Pins the latch — the resize argv **and its order relative to the spawn**. |
| `server/test/pane-history-route.test.ts` | Create (salvage) + Modify | Pins the route: the exact argv, the read staying a read, and the four outcomes. |
| `server/test/exec-pane-probe.test.ts` | Create | Pins `Tmux.paneProbe`: the format string, the active-row selection, and each of the four arms against a measured tmux literal. |
| `server/test/auth-gate.test.ts` | Modify (salvage only) | Route counts 48/76/73 and the three embedded-literal comments. |
| `server/test/single-definition.test.ts` | Modify | One new `describe`: the three L0 moves are defined once in `shared/api.ts` and imported, never retyped (Task 6). |
| `pwa/test/sheet-handle-only.test.tsx` | Create | Ruling 9's two mechanisms: `handleOnly` reds when deleted, and the full-height-`Sheet` consumer census (Task 2). |
| `pwa/test/auth-login.test.tsx` | Modify (salvage only) | Its `DrawerTerm` stub gains `onWheel`, by `08506275`'s cherry-pick — the one reason this file moves at all. |
| `pwa/test/terminal-scrollback.test.tsx` | Create (salvage) + Modify | The wheel, the history layer, the finger, the throw, the handle — and the nine corrections' red-first tests. |
| `pwa/test/terminal.test.tsx` | Modify (salvage only) | The existing drawer wiring suite, updated by the salvaged commits. |

---

### Task 1: Salvage PR #96's server chain, with the client-follow window removed

Cherry-picks the four server-touching commits §5.6 keeps, resolves the two conflicts, and then **removes** `842446cc`'s window-follows-the-client resizes — which §5.1 explicitly rejects ("wave 1 carries **no** per-client grid map"). After this task the pty route is byte-for-byte `main`'s again on sizing; Task 5 adds the single canonical pin.

**Files:**
- Modify: `pwa/src/lib/api.ts` — conflict at the `session.swap` entry, ~line 497
- Modify: `server/src/server.ts` — conflict at the pty-route neighbourhood, and then the client-follow removal at the attach and in the `resize` message arm
- Modify: `server/src/auth/gate.ts` — line 8's route count, by the cherry-pick
- Modify: `server/src/exec.ts`, `pwa/src/session/TerminalDrawer.tsx`, `pwa/src/session/chat.css`, `pwa/test/terminal.test.tsx`, `pwa/test/auth-login.test.tsx`, `server/test/auth-gate.test.ts` — by the cherry-picks
- Create (by cherry-pick): `server/test/pane-history-route.test.ts`, `pwa/test/terminal-scrollback.test.tsx`
- Modify: `server/test/pty.test.ts` — remove the two client-follow assertions the cherry-pick adds
- Test: `server/test/pane-history-route.test.ts`, `server/test/pty.test.ts`, `server/test/auth-gate.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces, for Tasks 4–16:
  - `server/src/exec.ts`: `export type CaptureHistory = { ok: true; text: string } | { ok: false; reason: 'gone' } | { ok: false; reason: 'unmeasured'; detail: string }` and `async captureHistory(id: string, lines: number): Promise<CaptureHistory>`; `async paneScrollback(id: string): Promise<{ lines: number; alternate: boolean } | null>` (Task 7 deletes this one).
  - `server/src/server.ts`: `const PANE_HISTORY_LINES = 2000` (Task 6 moves it) and the route `GET /api/sessions/:id/pane/history`.
  - `pwa/src/lib/api.ts`: `paneHistory: (id: string) => Promise<{ ok: true; text: string; lines: number; scrollback?: number; alternate?: boolean }>`.
  - **Not produced here, and Tasks 12/14/16 must not expect them at this point:** `HistoryTerm.rowHeight()` lands at `f5fe38e5`, `HistoryTerm.offset?()` at `5d65f8aa`, and `PaintLag`/`paintLag()` at `644f4173` — all three in **Task 3**'s cherry-pick chain, and all three MEASURED absent from `git show 8512cd74:pwa/src/session/TerminalDrawer.tsx`.
  - `pwa/src/session/TerminalDrawer.tsx`: `export interface DrawerTerm { write(data: string): void; onData(cb: (data: string) => void): void; onWheel(cb: (ev: WheelEvent) => boolean): void; fit(): { cols: number; rows: number }; focus(): void; dispose(): void }`; `export type MakeTerm = (host: HTMLElement) => DrawerTerm`; `export interface HistoryTerm { write(data: string, done?: () => void): void; fit(): { cols: number; rows: number }; scrollLines(amount: number): void; onBottom(cb: () => void): void; dispose(): void }`; `export type MakeHistoryTerm = (host: HTMLElement, lines: number) => HistoryTerm`; `export interface TerminalDrawerProps { id: string; open: boolean; onClose: () => void; makeSocket?: (url: string) => WebSocket; makeTerm?: MakeTerm; makeHistoryTerm?: MakeHistoryTerm }`.

- [ ] **Step 1: Cherry-pick `08506275` and resolve the one conflict**

Run:

```bash
git fetch origin main
git cherry-pick -x 08506275
```

**MEASURED, not predicted.** The whole salvage was re-run commit by commit in a throwaway worktree at `origin/main` (`fb19772e`, 2026-09-14) before this plan was written: of the twelve commits §5.6 keeps, **ten apply clean and exactly two conflict** — this one and `53671c68` (Step 3). If a cherry-pick below conflicts where this plan says it will not, `main` has moved again; re-measure rather than improvising.

Expected here: `Auto-merging pwa/src/lib/api.ts`, `CONFLICT (content): Merge conflict in pwa/src/lib/api.ts`, `Auto-merging server/src/server.ts`, and no second `CONFLICT` line. Measured: one conflicted region, markers at `pwa/src/lib/api.ts:497/505/512`, and ten other paths staged clean. The cause is unrelated newer `main` history — **`bb8cc111` (account pools wave 4, the PWA half, #95)** added `opts?: { crossPool?: boolean }` to `Api.session.swap` after the PR branch diverged, and `08506275` inserts `paneHistory` immediately after that same entry. Resolve by **keeping `HEAD`'s `swap` and appending the commit's `paneHistory`**. The resolved region reads exactly:

```ts
    /** `{crossPool:true}` ONLY when it is true — `opts?.crossPool === false`
     *  and an absent `opts` both keep the ordinary `{wrapper}` request shape.
     *  Not a checkbox anywhere in the UI: it is what a
     *  pick made under `SwapSheet`'s "show other pools" disclosure sends, after
     *  a confirm sentence that names the crossing. */
    swap: (id: string, wrapper: string, opts?: { crossPool?: boolean }) =>
      post(`${sid(id)}/swap`, opts?.crossPool === true ? { wrapper, crossPool: true } : { wrapper }),
    /** The terminal drawer's scrollback — the pane's own history, read with
     *  `capture-pane`. `lines` is the server's number, echoed back: this side
     *  never names one, so there is nothing for the two to disagree about. */
    paneHistory: (id: string) =>
      getJson<{ ok: true; text: string; lines: number }>(`${sid(id)}/pane/history`),
```

Then:

```bash
git add pwa/src/lib/api.ts
git cherry-pick --continue --no-edit
```

- [ ] **Step 2: Cherry-pick `842446cc` and `8512cd74` — both clean**

```bash
git cherry-pick -x 842446cc
git cherry-pick -x 8512cd74
```

Expected, measured: `842446cc` reports `Auto-merging server/src/server.ts` and lands `5 files changed, 247 insertions(+), 49 deletions(-)`; `8512cd74` reports **two** auto-merges — `pwa/src/lib/api.ts` and `server/src/server.ts` — and lands `6 files changed, 201 insertions(+), 8 deletions(-)`. No `CONFLICT` line at either step.

- [ ] **Step 3: Cherry-pick `53671c68` and discard its `server.ts` hunk entirely**

```bash
git cherry-pick -x 53671c68
```

Expected: `Auto-merging server/src/server.ts`, then `CONFLICT (content): Merge conflict in server/src/server.ts`, with `server/src/exec.ts` and `server/test/pane-history-route.test.ts` staged clean. Measured: **one** conflicted region, markers at `server/src/server.ts:1488/1489/1568` — an **empty `HEAD` side** (`<<<<<<< HEAD` immediately followed by `=======`), because git is trying to reinsert the whole `FLOOR_COLS` / `FLOOR_ROWS` / `mayFollow` / `Drawer` / `attached` / `lastMoved` apparatus that `df82702d` (DROPPED, §5.6) put between the two trees. `53671c68`'s real payload is the `-J` flag in `exec.ts`, which applied with no conflict; the continued pick lands `2 files changed, 38 insertions(+), 6 deletions(-)`.

Resolve by **deleting the entire conflicted region including all three markers** — take the empty `HEAD` side. Verify with:

```bash
grep -n '<<<<<<<\|=======\|>>>>>>>' server/src/server.ts
```

Expected: no output. Then:

```bash
git add server/src/server.ts
git cherry-pick --continue --no-edit
```

- [ ] **Step 4: Remove `842446cc`'s client-follow window sizing**

`842446cc` is on §5.6's keep list for its PWA half (the history door both ways), but its server half sizes the tmux window to whatever the client reports — the mechanism §5.1 rejects outright. Delete both calls.

In `server/src/server.ts`, inside `app.get('/ws/pty/:id', …)`, delete this comment block and its call (they sit immediately after `const p = spawnPty(id, cols, rows);`):

```ts
    // THE WINDOW FOLLOWS THE CLIENT, and it has to be said out loud because
    // tmux would otherwise do it by itself: the close handler below has always
    // run `resize-window`, and that verb sets `window-size manual` — measured
    // on this fleet, every live window now reads `manual`, a value nothing in
    // this tree writes on purpose. A pinned window stops sizing itself to
    // whoever attaches, so a drawer whose grid is not the spawn's 220x50 gets
    // a CLIPPED viewport: the right of every line cut, the status row hidden
    // under the key bar, and tmux's dotted filler wherever the client is the
    // larger of the two. The history read renders that same pane at the
    // DRAWER's width, so the two views also wrapped differently — one defect
    // wearing a second face.
    void deps.tmux.resizeWindow(id, cols, rows);
```

and, inside the `'resize'` arm of the same route's `socket.on('message', …)`, delete:

```ts
          // Same reason as the attach above: a rotation or a keyboard opening
          // moves the client, and a pinned window would not follow it.
          void deps.tmux.resizeWindow(id, m.cols, m.rows);
```

so that arm is once again exactly `p.resize(m.cols, m.rows);`.

In `server/test/pty.test.ts`, delete the two assertions `842446cc` added — the whole block from the comment `// THE WINDOW FOLLOWS THE CLIENT, at attach and at every refit.` through the second `await vi.waitFor(…'-x', '90', '-y', '28'…)` call, leaving the existing close-time assertion untouched.

- [ ] **Step 5: Run the server suites to verify green**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-history-route.test.ts test/pty.test.ts test/auth-gate.test.ts
```

Expected: PASS, all three files — measured in the salvage probe at this exact point, `Test Files 3 passed (3)`, `Tests 150 passed (150)`. The three counts below still hold, and the reason is that **`main`'s route counts have not moved since PR #96's base**: `scanRoutes('server.ts').length` reads **47** at the branch point `ecd953b0` and reads 47 at `5480fea8`, `676d1a5f`, `bb8cc111` and today's `fb19772e` alike, with `ROUTES.length` 75 and the derived HTTP count 72 throughout (measured with `git show <sha>:server/test/auth-gate.test.ts`. FOUR PRs sit between that base and today's `main` — #92 `5480fea8`, #93 `676d1a5f`, #95 `bb8cc111`, #94 `fb19772e` — and **#92 is the one that does touch `server/src/server.ts`**, adding 81 lines and **no new route**; the other three touch neither file, and none touches `server/src/auth/gate.ts`, whose `all 72 routes` docstring is byte-identical across all five shas. The count, not the file, is what matters here). The salvaged commit's 48/76/73 are therefore still exactly one-more-than-`main`, which is the one route it adds. `auth-gate.test.ts` derives them rather than trusting them, so a future `main` that DOES move them reds that file rather than this plan. `auth-gate.test.ts` passes because the salvaged commit already re-pinned 48/76/73 in all six places (`scanRoutes('server.ts').length` → 48, `ROUTES.length` → 76, the derived `httpCount` → 73, `auth-gate.test.ts:756`, `auth-gate.test.ts:820`, `gate.ts:8`). Confirm the derived numbers rather than assuming:

```bash
cd server && grep -n "toBe(48)\|toBe(76)\|in one loop over all\|the assertion that covers all" test/auth-gate.test.ts && grep -n "stands in front of all" src/auth/gate.ts
```

Expected: `48`, `76`, and `73` in the three prose lines.

Then confirm §5.3's other half — the route is **session-gated when armed and NOT exempt**:

```bash
cd server && grep -n "pane/history" src/auth/gate.ts
```

Expected: no output. `auth-gate.test.ts` pins the whole `EXEMPT` key set with an exact `expect([...EXEMPT.keys()].sort()).toEqual([...])`, so an entry added there goes red on its own — this grep is the positive statement that none was added. The precedent is `POST /api/projects/:project/pool` (`server.ts:2056`): fleet control, session-gated when armed, open dark, no box token.

- [ ] **Step 6: Mutation check, then commit**

Temporarily re-add `void deps.tmux.resizeWindow(id, 120, 40);` immediately after `const p = spawnPty(id, cols, rows);` and run `cd server && ./node_modules/.bin/vitest run test/pty.test.ts`. The suite must **stay green** — which is the point: `main`'s pty suite cannot see a stray resize, and that is exactly why Task 5 adds an order-aware assertion. Record that it stayed green, then remove the line again.

The four cherry-picks are already commits carrying `-x` provenance and the original author's trailer. Commit only the removal:

```bash
git add server/src/server.ts server/test/pty.test.ts
git commit -m "$(cat <<'MSG'
fix(pty): drop PR #96's client-follow window sizing — wave 1 carries no grid map

842446cc is salvaged for its PWA half (one door both ways). Its server half
sized the tmux window to whatever grid the client reported, at attach and on
every refit. Spec §5.1 rejects that outright: the window is PINNED at the
canonical grid and a drawer never moves it, because a 43-column client that
moves it reflows the pane's history and sheds the overflow at `history-limit`
(F1, F14: 157 of 1203 logical lines destroyed on one measured attach).

The route is back to `main`'s sizing behaviour here; the canonical pin lands in
its own commit next, where its ORDER relative to `spawnPty` is what the test
pins.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Salvage the console's own drag (`1c4e79fe`), and ship the guard PR #96 never had

§5.6 keeps `1c4e79fe` — `handleOnly` on the full-height sheet plus a real `Drawer.Handle` — and spec §11 ruling 9 says two obligations ride with it, because `Sheet` is shared: this plan **enumerates every full-height `Sheet` consumer** and shows each renders a handle (a full-height sheet with `handleOnly` and no handle cannot be dismissed by drag at all), and `handleOnly` **ships with a test that reds when it is deleted**. PR #96 shipped it with none. This task is the cherry-pick plus those two mechanisms, red-first.

Its position is §5.6's own — after `53671c68`, before the touch/momentum chain — and that is where it applies clean: measured in the salvage probe at `origin/main`, `3 files changed, 78 insertions(+), 5 deletions(-)`, no conflict.

**Files:**
- Modify (by cherry-pick): `pwa/src/components/Sheet.tsx` — `handleOnly={full}` on `Drawer.Root`, and the grabber becomes a real `Drawer.Handle`
- Modify (by cherry-pick): `pwa/src/session/TerminalDrawer.tsx` — the history door's `aria-pressed`
- Modify (by cherry-pick): `pwa/test/terminal-scrollback.test.tsx`
- Create: `pwa/test/sheet-handle-only.test.tsx` — the two mechanisms ruling 9 requires
- Test: `pwa/test/sheet-handle-only.test.tsx`, `pwa/test/terminal-scrollback.test.tsx`, `pwa/test/terminal.test.tsx`

**Interfaces:**
- Consumes: Task 1's salvaged `pwa/test/terminal-scrollback.test.tsx` and `TerminalDrawer.tsx`; `pwa/src/components/Sheet.tsx`'s `SheetProps` (`{ open, onClose, children, title?, eyebrow?, full? }`).
- Produces: `SheetProps` is **unchanged** — `handleOnly` is derived from `full` INSIDE `Sheet`, never a new prop, so no consumer opts in and none can forget. The history door's `aria-pressed` now reads `hist.at === 'history'` rather than `!atLive`.

- [ ] **Step 1: Install the PWA dependencies — this worktree has none**

```bash
cd pwa && npm ci
```

Expected: an install that resolves `@xterm/xterm` at exactly `6.0.0` and `@xterm/addon-fit` at exactly `0.11.0`. Verify:

```bash
cd pwa && node -p "require('./node_modules/@xterm/xterm/package.json').version + ' ' + require('./node_modules/@xterm/addon-fit/package.json').version"
```

Expected: `6.0.0 0.11.0`.

- [ ] **Step 2: Take the full-height `Sheet` census (ruling 9a)**

`handleOnly` is a property of the SHEET, not of the drawer, so it reaches every consumer that passes `full`. Enumerate them:

```bash
cd pwa && grep -rn "<Sheet" src --include=*.tsx
```

Measured on `origin/main` (`fb19772e`), over all 20 `<Sheet …>` opening tags in `pwa/src`: **exactly one passes `full`**. Its line number below is a BASELINE number — `pwa/src/session/TerminalDrawer.tsx` is 293 lines at `fb19772e` and grows through Tasks 3 and 9–16, so re-grep rather than trusting it once the chain has landed —

| full-height `Sheet` consumer | renders a `Drawer.Handle`? |
|---|---|
| `pwa/src/session/TerminalDrawer.tsx:251` — `<Sheet open={open} onClose={onClose} full title="Terminal" eyebrow={…}>` | **it will, and not by its own doing.** At this point `Sheet.tsx:52` still renders an unconditional `<div className="sheet-grabber" aria-hidden="true" />` and there is no handle anywhere; Step 5's cherry-pick of `1c4e79fe` makes it `full ? <Drawer.Handle className="sheet-grabber"/> : <div className="sheet-grabber"/>` (`Sheet.tsx:68-69` after the pick), so the handle arrives with `handleOnly={full}` in the same branch and a consumer cannot have one without the other |

The other nineteen (`PrSheet`, `HistoryTab`, `DialogSheet` ×4, `AbandonSheet`, `PickSheet`, `ArchiveConflictSheet`, `ResumeSheet`, `PoolSheet`, `StartProgramSheet`, `ReapSheet`, `SessionActionsSheet`, `NewSessionSheet`, `SessionHeader`, `SwapSheet`, `QuickConfirm`, `Composer`) pass no `full`, so once the flag exists they take `handleOnly={false}` and keep the plain `div` grabber they have today, and are dismissible by a swipe anywhere — which is what a list wants and what vaul's own scroll detection already handles.

That census is a fact about today's tree, so it ships as a test in Step 3 rather than as this paragraph: a second full-height sheet added next month must be made to prove its handle, not remembered.

- [ ] **Step 3: Write the failing tests**

Create `pwa/test/sheet-handle-only.test.tsx`:

```tsx
// `handleOnly` on the full-height sheet — the console's own drag, and the
// census that keeps the handle attached to it (spec §5.6, ruling 9).
//
// THE GESTURE ITSELF IS NOT MEASURABLE IN JSDOM and saying so is part of the
// guard: vaul's drag needs real layout, so a simulated pointer drag across the
// glass "passes" whether or not the panel owns it. What IS measurable is that
// the panel STOOD DOWN — without `handleOnly`, vaul's own `onPointerMove` runs
// `getTranslate`, which reads a computed style jsdom does not produce and
// throws `TypeError: Cannot read properties of undefined (reading 'match')`.
// The throw escapes into React's commit and reaches `window`'s `error` event,
// which is the signal this file counts. Measured, vaul 1.1.2: 2 TypeErrors
// from one drag without the flag, 0 with it.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Sheet } from '../src/components/Sheet';

afterEach(cleanup);

/** One deliberate downward drag across a sheet's CONTENT — not its grabber. */
const dragAcross = (el: HTMLElement): void => {
  fireEvent.pointerDown(el, {
    pointerId: 1, clientX: 100, clientY: 100, isPrimary: true, button: 0, pointerType: 'touch',
  });
  fireEvent.pointerMove(el, {
    pointerId: 1, clientX: 100, clientY: 220, isPrimary: true, pointerType: 'touch',
  });
  fireEvent.pointerUp(el, {
    pointerId: 1, clientX: 100, clientY: 220, isPrimary: true, pointerType: 'touch',
  });
};

/** Whatever vaul threw while the drag was being dispatched. */
const errorsDuring = (run: () => void): unknown[] => {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent): void => { errors.push(e.error); };
  window.addEventListener('error', onError);
  try {
    run();
  } finally {
    window.removeEventListener('error', onError);
  }
  return errors;
};

describe('the console keeps its own drag', () => {
  it('a full sheet does not let the panel claim a drag across its content', () => {
    // On a phone this is the whole defect: a swipe over the console collapsed
    // the drawer instead of scrolling it, because the panel and the glass were
    // both claiming the gesture and the panel won.
    const errors = errorsDuring(() => {
      render(
        <Sheet open full onClose={() => {}} title="Terminal">
          <div data-testid="glass">console</div>
        </Sheet>,
      );
      dragAcross(screen.getByTestId('glass'));
    });
    expect(errors, 'vaul claimed a drag across the full sheet\'s content').toEqual([]);
  });

  it('a NON-full sheet still lets the panel be dragged — the stand-down is scoped', () => {
    // The other nineteen sheets hold a list, where a downward swipe anywhere
    // IS a dismissal and should stay one. `handleOnly` is derived from `full`
    // for exactly this reason, and widening it to `true` reds here.
    const errors = errorsDuring(() => {
      render(
        <Sheet open onClose={() => {}} title="Pick one">
          <div data-testid="list">a list</div>
        </Sheet>,
      );
      dragAcross(screen.getByTestId('list'));
    });
    expect(errors.length, 'the non-full panel stood down too — the guard is not scoped to full')
      .toBeGreaterThan(0);
  });

  it('a full sheet offers a real handle to drag by', () => {
    // `handleOnly` without a handle is a panel nothing can dismiss by touch.
    render(<Sheet open full onClose={() => {}} title="Terminal"><div /></Sheet>);
    expect(document.querySelector('[data-vaul-handle]'),
      'the grabber is decoration, not a drag target').toBeTruthy();
  });
});

// — the census (ruling 9a) —
//
// `handleOnly` reaches every consumer that passes `full`, and a full-height
// sheet with the flag and no handle cannot be dismissed by drag at all. Today
// exactly one sheet is full-height and `Sheet` gives it the handle in the same
// branch as the flag. A second one arriving must prove the same thing rather
// than inherit an assumption.
describe('the full-height sheet census', () => {
  const SRC = path.resolve(__dirname, '../src');
  const REPO = path.resolve(__dirname, '../..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = path.join(dir, e);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
    });

  it('the terminal drawer is the only full-height Sheet', () => {
    const consumers = walk(SRC)
      .filter((f) => [...readFileSync(f, 'utf8').matchAll(/<Sheet\b[^>]*>/g)]
        .some((m) => /\bfull\b/.test(m[0])))
      .map((f) => path.relative(REPO, f));
    expect(consumers, 'a new full-height Sheet appeared — prove its handle, then list it here')
      .toEqual(['pwa/src/session/TerminalDrawer.tsx']);
  });

  it('every full-height Sheet gets its handle from Sheet itself, in the same branch as the flag', () => {
    const src = readFileSync(path.join(SRC, 'components', 'Sheet.tsx'), 'utf8');
    expect(src, 'the full variant no longer stands the panel down').toMatch(/handleOnly=\{full\}/);
    expect(src, 'the full variant renders no vaul handle to drag by')
      .toMatch(/full\s*\r?\n?\s*\?\s*<Drawer\.Handle/);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail, and record where the tree stands**

```bash
cd pwa && ./node_modules/.bin/vitest run test/sheet-handle-only.test.tsx
```

Expected, measured at this exact point (Task 1 applied, `1c4e79fe` not yet):

- `a full sheet does not let the panel claim a drag across its content` → RED, `AssertionError: vaul claimed a drag across the full sheet's content: expected [ …(2) ] to deeply equal []`, the two entries being `TypeError: Cannot read properties of undefined (reading 'match')`.
- `every full-height Sheet gets its handle from Sheet itself…` → RED on `handleOnly={full}`.
- The other three pass: the non-full control, and the census's consumer list, which is already correct.

Then record what the salvaged terminal suites read here, so Task 3's measurement has a baseline to be a difference FROM:

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
```

Expected, measured: `Test Files 2 passed (2)`, `Tests 40 passed (40)`, no `Errors` line. **Forty, and zero errors — the vaul ownership defect is NOT visible at this position**, because the tests that provoke it are the finger-drag ones the touch chain has not landed yet. It becomes visible in Task 3, whose Step 2 carries the measurement (65 passed / 28 unhandled errors without `handleOnly`, 67 / 0 with it). Do not expect those numbers here.

- [ ] **Step 5: Cherry-pick `1c4e79fe`**

```bash
git cherry-pick -x 1c4e79fe
```

Expected, measured: clean, `3 files changed, 78 insertions(+), 5 deletions(-)` across `pwa/src/components/Sheet.tsx`, `pwa/src/session/TerminalDrawer.tsx`, `pwa/test/terminal-scrollback.test.tsx`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/sheet-handle-only.test.tsx test/terminal-scrollback.test.tsx test/terminal.test.tsx
```

Expected, measured: `sheet-handle-only.test.tsx` 5 passed; the two salvaged suites `Tests 42 passed (42)` (40 plus the two `1c4e79fe` brings), `Type Errors no errors`, no `Errors` line.

- [ ] **Step 7: Mutation checks, then commit**

Three, each measured before/after:

1. Change `handleOnly={full}` to `handleOnly={false}` in `pwa/src/components/Sheet.tsx` and re-run `test/sheet-handle-only.test.tsx`. Expected RED: `a full sheet does not let the panel claim a drag across its content` (2 TypeErrors) **and** `every full-height Sheet gets its handle from Sheet itself…`. Restore.
2. Widen it to `handleOnly` (always true) and re-run. Expected RED the other way: `a NON-full sheet still lets the panel be dragged — the stand-down is scoped`, `expected +0 to be greater than 0`. Restore.
3. Replace `<Drawer.Handle className="sheet-grabber" aria-hidden="true" />` with the plain `div` and re-run. Expected RED: `a full sheet offers a real handle to drag by` → `the grabber is decoration, not a drag target`, and `terminal-scrollback.test.tsx`'s own `the drawer offers a real handle to drag by`. Restore.

The cherry-pick is already a commit carrying `-x` provenance and the author's trailer. Commit the two mechanisms it arrived without:

```bash
git add pwa/test/sheet-handle-only.test.tsx
git commit -m "$(cat <<'MSG'
test(sheet): handleOnly gets the guard and the census it shipped without

`1c4e79fe` gives the full-height sheet's drag back to its content, which is the
gesture the whole history layer exists to be reached by — without it, measured
on a phone, a swipe over the console collapses the drawer instead of scrolling
it. It shipped with no test that reds when the flag is deleted, and the flag
reaches every consumer that passes `full`, so this adds both halves spec §5.6
requires.

THE GUARD. vaul's drag needs real layout, so the gesture itself cannot be
measured in jsdom — but the panel's STANDING DOWN can: without `handleOnly`,
vaul's own onPointerMove runs getTranslate against a computed style jsdom does
not produce and throws. Measured, vaul 1.1.2: one drag across the content
raises 2 TypeErrors without the flag and 0 with it, and the throws reach
`window`'s error event, which is what the test counts. Red in both directions —
deleting the flag reds the full-sheet case, widening it to `true` reds the
non-full control.

THE CENSUS. Exactly one full-height Sheet exists (`TerminalDrawer.tsx`), and
`Sheet` renders `Drawer.Handle` in the same branch that sets the flag, so a
consumer cannot have one without the other. A second full-height sheet arriving
reds the census rather than inheriting the assumption — a full-height panel with
`handleOnly` and no handle cannot be dismissed by drag at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Salvage the touch, the throw and the mouse (seven commits)

The touch/momentum chain. All seven touch only `pwa/src/session/TerminalDrawer.tsx` and `pwa/test/terminal-scrollback.test.tsx`, and all seven apply with zero conflicts.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx`, `pwa/test/terminal-scrollback.test.tsx` — by the cherry-picks
- Test: `pwa/test/terminal-scrollback.test.tsx`

**Interfaces:**
- Consumes: Task 2's `Sheet` with `handleOnly`, and Task 1's `HistoryTerm`/`MakeHistoryTerm`.
- Produces (relied on by Tasks 9–16): `HistoryTerm` gains `rowHeight(): number` (at `f5fe38e5`) and `offset?(px: number): void` (at `5d65f8aa`) — `scrollLines` it already had from Task 1; `export interface PaintLag { scrolled(rows: number, rowPx: number): void; sub(px: number): void; painted(): void; transform(): number }` and `export function paintLag(): PaintLag` (at `644f4173`); the module-level constants `const TOUCH_OPEN_PX = 24`, `const WHEEL_LINES = 3`, `const FLING_MIN_PX_MS = 0.25`, `const FLING_IDLE_MS = 80`, `const FLING_SMOOTH = 0.35`, `const GLIDE_DECAY = 0.95`, `const GLIDE_STOP_PX_MS = 0.5 / (1000 / 60)`, `const FRAME_MS = 1000 / 60`, `const GLIDE_MAX_STEP_MS = 50`; and in `pwa/test/terminal-scrollback.test.tsx` the private helpers `fakeTermFactory()`, `fakeHistoryFactory({defer?})`, `mountDrawer({defer?, onClose?})`, `jsonFetch(status, body)`, `histHost(view)`, `drag(el, from, to, id?)`, `historyDoor()`, `flush()`, `const ROW_PX = 18`, `const OK_HISTORY = { ok: true, text: HISTORY, lines: 2000 }`, `const HISTORY = 'older output\nolder still\n'`, `const ID = 'claude-a-MekWarLive'`.

- [ ] **Step 1: Cherry-pick all seven, in §5.6's order**

```bash
for c in f5fe38e5 39d8d9af 85e4394a 4d274cb9 5d65f8aa 644f4173 6493be32; do
  git cherry-pick -x "$c" || { echo "STOPPED AT $c"; break; }
done
git log --oneline -8
```

Expected: seven commits land, newest first `the mouse selects text again…`, `the rows and the pixels land together…`, `the throw moves by pixels…`, `the history is thrown, not only dragged`, `the finger can open the history…`, `the finger keeps its drag…`, `the finger scrolls the history, and opens it`. No `CONFLICT` line at any step.

- [ ] **Step 2: Run the PWA terminal suites to verify green**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
```

Expected: PASS, `Tests 67 passed (67)`, `Type Errors no errors`, `Errors` absent. The suite now carries the describes `the finger scrolls the history`, `the history keeps moving after the finger leaves`, `the rows and the transform stay one motion`, and `a finger opens the history from the live glass`.

**This is where Task 2's `handleOnly` earns its keep, and the number is the evidence.** MEASURED at this exact position: with `handleOnly={full}` in `pwa/src/components/Sheet.tsx`, **67 pass and there is no `Errors` line**; with it reverted to `handleOnly={false}`, the same 67 become **65 passing plus 28 unhandled `TypeError: Cannot read properties of undefined (reading 'match')`** out of vaul's `getTranslate`, raised by the finger-drag tests this chain has just added — and vitest warns that unhandled errors can mask false positives. The defect was NOT visible in Task 2 (40 tests, zero errors) because none of the tests that provoke it existed yet. On a phone it is the same fact in the other direction: without the flag vaul's panel claims every pointer drag across the console glass, and a swipe to scroll collapses the drawer instead.

- [ ] **Step 3: Typecheck the whole PWA package**

```bash
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: no output, exit 0. (The PWA uses its **own** `typescript` 6.0.3; never run the server's copy against this project.)

- [ ] **Step 4: Mutation check, then commit**

Temporarily change `if (ev.pointerType === 'mouse') return;` inside the history layer's `down` handler to `if (false) return;` and run `cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx`. Expected RED: `a MOUSE drag selects text — it does not scroll the view` fails with `a mouse drag scrolled the history instead of selecting it`. Restore.

The seven cherry-picks are already commits; no further commit is needed for this task. Confirm the tree is clean:

```bash
git status --porcelain
```

Expected: no output.

---

### Task 4: Correct the two false "tmux never reflows" comments and the inverted `-J` numbers

§2's closing paragraph: *"Two shipped comments in PR #96 assert 'tmux never reflows it'… F1 falsifies both. `-J`'s real value is that a logical line survives reflow and the reader wraps it once at its own width — not that reflow does not happen."* Plus §5.4's last row: `pane-history-route.test.ts:64`'s `-J` numbers are **inverted** — `-J` reduces rendered rows, and the line claims it increases them.

After dropping `df82702d`, the second false comment is not in `server.ts` (that file's floor note went with the dropped commit) but in `pwa/src/session/TerminalDrawer.tsx`. Both surviving copies are corrected here.

**Files:**
- Modify: `server/src/exec.ts:170` — inside `captureHistory`'s `-J` comment
- Modify: `pwa/src/session/TerminalDrawer.tsx:213` — inside `defaultMakeHistoryTerm`'s `scrollback` comment
- Modify: `server/test/pane-history-route.test.ts:64` — the inverted row numbers
- Test: `server/test/pane-history-route.test.ts` (a new comment-scan guard)

**Interfaces:**
- Consumes: Task 1's salvaged `exec.ts`, `pane-history-route.test.ts` and `TerminalDrawer.tsx`.
- Produces: nothing new. Adds one `describe` to `server/test/pane-history-route.test.ts`.

- [ ] **Step 1: Write the failing test**

Append this `describe` to the end of `server/test/pane-history-route.test.ts`, and add `import { readFileSync } from 'node:fs';` and `import path from 'node:path';` to its import block:

```ts
// F1 FALSIFIED THE CLAIM THESE COMMENTS CARRIED, and a comment is not a
// mechanism — so this is the mechanism. Measured on a private tmux 3.4 socket:
// `resize-window -x 43` on a 220-column pane holding 1853 stored lines reflows
// `history_size` to 9460; at `history-limit 2000` the next output sheds ~600
// lines and restoring 220 leaves 1746 logical lines of 1903, oldest gone. tmux
// REFLOWS. What `-J` actually buys is that a LOGICAL line survives that reflow
// and the reader wraps it once, at its own width.
describe('the shipped comments say what F1 measured', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
  const SOURCES = ['server/src/exec.ts', 'pwa/src/session/TerminalDrawer.tsx'] as const;

  it('no shipped comment claims tmux never reflows a stored line (F1)', () => {
    const offenders = SOURCES.filter((rel) => /tmux (never|does not) reflow/i.test(read(rel)));
    expect(offenders, 'a shipped comment still asserts what F1 falsified').toEqual([]);
  });

  it('the scan is looking at something — both files are real and mention reflow', () => {
    for (const rel of SOURCES) {
      expect(read(rel).length, `${rel} is empty or missing`).toBeGreaterThan(1000);
      expect(read(rel), `${rel} lost its reflow note entirely`).toMatch(/reflow/i);
    }
  });

  it('the -J note counts rows DOWN, not up — joining cannot render more rows', () => {
    const src = read('server/test/pane-history-route.test.ts');
    const m = /renders (\d+) rows instead of (\d+)/.exec(src);
    expect(m, 'the -J row measurement went missing from this file').not.toBeNull();
    const withJ = Number(m![1]);
    const without = Number(m![2]);
    expect(withJ, 'the numbers are inverted: -J joins lines, so it renders FEWER rows')
      .toBeLessThan(without);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-history-route.test.ts
```

Expected: FAIL, two of the three new tests red.
- `no shipped comment claims tmux never reflows a stored line (F1)` → `AssertionError: a shipped comment still asserts what F1 falsified`, received `[ 'server/src/exec.ts', 'pwa/src/session/TerminalDrawer.tsx' ]`.
- `the -J note counts rows DOWN, not up` → `expected 6130 to be less than 5861`.
- The anti-vacuity test passes.

- [ ] **Step 3: Correct the three sites**

In `server/src/exec.ts`, inside `captureHistory`, replace:

```ts
    // `-J` JOINS WHAT TMUX ALREADY WRAPPED, and it is here because the reader
    // is not the pane. A stored line was hard-wrapped at the PANE's width and
    // tmux never reflows it, so a phone rendering that capture wraps the
    // remainder a second time — a word broken mid-way and the continuation
    // indented under nothing. `-J` hands back the logical line and lets the
    // reader wrap it at their own width, once.
```

with:

```ts
    // `-J` JOINS WHAT TMUX ALREADY WRAPPED, and it is here because the reader
    // is not the pane. A stored line was hard-wrapped at the PANE's width, so a
    // phone rendering that capture wraps the remainder a second time — a word
    // broken mid-way and the continuation indented under nothing. `-J` hands
    // back the LOGICAL line and lets the reader wrap it at their own width,
    // once.
    //
    // AND THE LOGICAL LINE IS THE ONE THING A RESIZE CANNOT COST (F1, spec
    // §2). An earlier version of this comment said tmux never reflows a stored
    // line; that is FALSE and was measured false on a private tmux 3.4 socket —
    // `resize-window -x 43` on a 220-column pane holding 1853 stored lines took
    // `history_size` to 9460, and at `history-limit 2000` the next output shed
    // ~600 lines that never came back. What survives a reflow is the logical
    // line, which is exactly what `-J` returns, which is why the flag belongs
    // here and why the window is PINNED at the canonical grid before any client
    // attaches (`GET /ws/pty/:id`, spec §5.1) rather than trusted not to move.
```

In `pwa/src/session/TerminalDrawer.tsx`, inside `defaultMakeHistoryTerm`, replace:

```ts
    // DERIVED from the number of lines the server actually sent, never a second
    // constant to keep in step with it. The factor is the WRAP: a stored line
    // was written at the pane's width and tmux does not reflow it, so a phone
    // renders one as several rows — measured at 500 captured lines becoming 948
    // rows at 48 columns (1.9×), against 527 at 220. 3× leaves headroom over
    // the narrowest phone rather than silently dropping the oldest history.
```

with:

```ts
    // DERIVED from the number of lines the server actually sent, never a second
    // constant to keep in step with it. The factor is the WRAP: the capture
    // arrives as LOGICAL lines (`capture-pane -J`), and a phone renders one of
    // them as several rows — measured at 500 captured lines becoming 948 rows
    // at 48 columns (1.9×), against 527 at 220. 3× leaves headroom over the
    // narrowest phone rather than silently dropping the oldest history.
    //
    // NOT because tmux holds the pane's width still: it reflows stored lines on
    // a horizontal resize (F1, spec §2 — 1853 lines became 9460 at 43 columns
    // on a measured private socket). An earlier version of this comment said
    // otherwise. The pane's width is held still by the server's own pin at the
    // canonical grid, and this factor is about the READER's width, not the
    // pane's.
```

In `server/test/pane-history-route.test.ts`, replace:

```ts
    // WHY `-J` EARNS ITS PLACE, measured on a private socket against a real
    // 200-column transcript: 1882 captured lines become 1113 (-41%) for +0.05%
    // of bytes, and a 43-column phone renders 6130 rows instead of 5861 —
```

with:

```ts
    // WHY `-J` EARNS ITS PLACE, measured on a private socket against a real
    // 200-column transcript: 1882 captured lines become 1113 (-41%) for +0.05%
    // of bytes, and a 43-column phone renders 5861 rows instead of 6130 —
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-history-route.test.ts test/pty.test.ts test/single-definition.test.ts
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: PASS everywhere. The comment edits add no second definition of anything, so `single-definition` is unaffected.

- [ ] **Step 5: Mutation check, then commit**

Temporarily re-insert the words `tmux never reflows it` into `server/src/exec.ts`'s `captureHistory` comment and re-run `cd server && ./node_modules/.bin/vitest run test/pane-history-route.test.ts`: `no shipped comment claims tmux never reflows a stored line (F1)` must go RED naming `server/src/exec.ts`. Restore. Then temporarily swap the two numbers back to `6130 rows instead of 5861` and re-run: the third test must go RED with `expected 6130 to be less than 5861`. Restore.

```bash
git add server/src/exec.ts pwa/src/session/TerminalDrawer.tsx server/test/pane-history-route.test.ts
git commit -m "$(cat <<'MSG'
docs(terminal): tmux DOES reflow a stored line — correct both comments and the -J numbers

Spec §2: two comments PR #96 shipped asserted "tmux never reflows it", and F1
falsified both on a private tmux 3.4 socket — `resize-window -x 43` on a
220-column pane with 1853 stored lines took `history_size` to 9460, and at
`history-limit 2000` the next output shed ~600 lines permanently. What `-J`
actually buys is that the LOGICAL line survives a reflow and the reader wraps
it once at its own width.

`pane-history-route.test.ts`'s row numbers were inverted with them: joining
wrapped lines cannot render MORE rows. 5861 with `-J`, 6130 without.

A comment is a request; this ships the mechanism — a scan over the two source
files that goes red on the claim's return, and a check that the -J numbers
count down.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The latch — pin the canonical grid before the pty attaches (§5.1)

The hazard this closes is **live on `main` today**: 21 of 31 windows read `window-size latest` (F12), so the first phone attach narrows the window and reflows the history. F14 measures both halves on one session: **unpinned, a 43-column attach destroyed 157 of 1203 logical lines; pinned first, the window never left 220 and the history was untouched (1153 → 1153, and 1205 logical after detach).**

This is independently valuable and ships alone. It needs **no new grant** — `resize-window` is already in `EXEC_WHITELIST.tmux`.

**Files:**
- Modify: `server/src/server.ts` — inside `app.get('/ws/pty/:id', …)`, before `const p = spawnPty(id, cols, rows);`
- Test: `server/test/pty.test.ts` (add one `it` to the existing `describe('pty drawer bridge', …)`)

**Interfaces:**
- Consumes: `deps.tmux.resizeWindow(id: string, cols: number, rows: number): Promise<boolean>` (`server/src/exec.ts:150`, already on `main`), which runs `['tmux', 'resize-window', '-t', 'cc-<id>', '-x', String(cols), '-y', String(rows)]`; and `deps.spawnPty?: SpawnPty` where `SpawnPty = (id: string, cols: number, rows: number) => PtyLike`.
- Produces: nothing new in types. Wave 3's `pin(id)` step in §7.1 is this same call and will reuse it unchanged.

- [ ] **Step 1: Write the failing test**

Add this `it` to `server/test/pty.test.ts`, inside the existing `describe('pty drawer bridge', …)` block (it reuses that file's `StubPty`, `opened`, `wait` and its `afterEach`):

```ts
  it('PINS the canonical grid BEFORE the pty attaches, so the client cannot reflow the history', async () => {
    // F14, measured end to end on one session with `window-size latest` as ccd
    // spawns it, 1153 stored lines / 1203 logical:
    //   UNPINNED  a 43-column pty client attaches, the window follows it to 43,
    //             `history_size` 1153 -> 5771, one line of output, detach,
    //             restore 220 -> 1046 logical of 1203. 157 DESTROYED.
    //   PINNED    `resize-window -x 220 -y 50` first: the option reads `manual`
    //             (F3), the window stays 220 THROUGHOUT the 43-column attach,
    //             `history_size` unchanged at 1153, 1205 logical after detach.
    //
    // ORDER IS THE WHOLE GUARD, not presence: the close handler has always run
    // the same argv, so a test that only asserts the call exists passes on
    // `main` and passes with the pin deleted. One ordered log, shared by the
    // spawn stub and the Runner, is what can tell them apart.
    const log: string[] = [];
    const run = async (cmd: string, args: string[]) => {
      log.push([cmd, ...args].join(' '));
      return { code: 0, stdout: '', stderr: '' };
    };
    const stub = new StubPty();
    const deps = {
      ...testDeps(undefined, run),
      spawnPty: (id: string, cols: number, rows: number) => {
        log.push(`spawnPty ${id} ${cols}x${rows}`);
        return stub;
      },
    };
    app = await buildServer(deps);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=43&rows=40`);
    await opened(ws);
    await vi.waitFor(() => expect(log).toContain('spawnPty claude2-MekWarLive 43x40'), wait);

    const pin = 'tmux resize-window -t cc-claude2-MekWarLive -x 220 -y 50';
    const spawn = 'spawnPty claude2-MekWarLive 43x40';
    expect(log.indexOf(pin), 'the canonical pin never ran — the client reflows the history')
      .toBeGreaterThanOrEqual(0);
    expect(log.indexOf(pin), 'the pin ran AFTER the attach: by then tmux has already reflowed')
      .toBeLessThan(log.indexOf(spawn));

    // AND THE CLIENT'S OWN GRID IS STILL THE PTY'S. The pin is the WINDOW's
    // size, not the pty's — the phone keeps the 43x40 it measured and sees a
    // clipped view, exactly as it does today. Wave 3 is where that changes.
    expect(log.filter((l) => l.startsWith('tmux resize-window')),
      'the window was sized to the client — wave 1 carries no per-client grid map')
      .toEqual([pin]);

    ws.close();
    await vi.waitFor(() => expect(stub.killed).toBe(true), wait);
    // The close handler's restore is now a no-op against a window that never
    // moved, which is exactly what §5.1 says it becomes.
    await vi.waitFor(() => expect(log.filter((l) => l === pin)).toHaveLength(2), wait);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/pty.test.ts
```

Expected: FAIL on the new `it` only, at the first assertion: `AssertionError: the canonical pin never ran — the client reflows the history: expected -1 to be greater than or equal to +0`. The existing `it` stays green.

- [ ] **Step 3: Write the minimal implementation**

In `server/src/server.ts`, inside `app.get('/ws/pty/:id', …)`, insert immediately **before** `const p = spawnPty(id, cols, rows);`:

```ts
    // THE LATCH, AND IT GOES BEFORE THE ATTACH (spec §5.1, F3, F14).
    //
    // ccd spawns every session `window-size latest` (`ccd/ccd:14790`), and
    // tmux's own default is `latest` too — so the window follows whichever
    // client most recently typed. A phone's pty client is a full tmux client
    // (F6), so the first phone attach NARROWS the window, tmux REFLOWS the
    // stored lines to the new width, and everything past `history-limit` is
    // shed on the next scrolled line and never comes back (F1).
    //
    // `resize-window` latches `window-size manual` (F3), so issuing it here —
    // at the grid ccd spawned with — means the client that attaches an instant
    // later cannot move the window at all. MEASURED end to end on one session
    // (F14), 1153 stored lines / 1203 logical: unpinned, a 43-column attach
    // left 1046 logical of 1203 — 157 destroyed; pinned first, the window read
    // `manual`, stayed 220 throughout, and the history was untouched.
    //
    // NOT AWAITED, and that is deliberate: the socket handler is L4 and decides
    // nothing, `resizeWindow` answers a boolean this route has no branch for,
    // and a tmux that cannot be reached is a session the attach below will fail
    // on anyway. What it must not be is LATER than the attach.
    //
    // NO PER-CLIENT GRID MAP rides with it (§5.1): the window is one fixed size
    // for every drawer, so a second drawer closing restores nothing anyone was
    // depending on, and the close handler's own 220x50 becomes a no-op rather
    // than the defect PR #96's handoff was built to cure. The deliberate
    // un-pin is wave 3, under the fit guard, through an advertised ccd verb.
    void deps.tmux.resizeWindow(id, 220, 50);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/pty.test.ts test/pane-history-route.test.ts test/routes.test.ts test/auth-gate.test.ts
```

Expected: PASS, all four files.

- [ ] **Step 5: Mutation check, then commit**

Delete the `void deps.tmux.resizeWindow(id, 220, 50);` line and run `cd server && ./node_modules/.bin/vitest run test/pty.test.ts`. Expected RED: `the canonical pin never ran — the client reflows the history`. Restore it. Then MOVE the same line to immediately **after** `const p = spawnPty(id, cols, rows);` and re-run. Expected RED: `the pin ran AFTER the attach: by then tmux has already reflowed`, `expected 1 to be less than 0`. Move it back before the spawn.

```bash
git add server/src/server.ts server/test/pty.test.ts
git commit -m "$(cat <<'MSG'
fix(pty): latch the canonical grid before the drawer attaches — the history stops being shed

ccd spawns every session `window-size latest`, so a pty client at a phone's
width NARROWS the window, tmux reflows the stored lines, and the overflow past
`history-limit` is shed on the next scrolled line and never returns (F1). 21 of
31 live windows read `latest` today (F12), so this is live on main.

`tmux resize-window` latches `window-size manual` (F3). Issuing it at the grid
ccd spawned with, BEFORE `spawnPty`, means the client that attaches an instant
later cannot move the window at all. MEASURED end to end on one session (F14),
1153 stored lines / 1203 logical:

  unpinned      43-column attach -> window 43, history_size 1153 -> 5771,
                detach and restore 220 -> 1046 logical of 1203. 157 DESTROYED.
  pinned first  option reads `manual`, window stays 220 throughout the
                43-column attach, history_size unchanged, 1205 logical after.

Costs the phone nothing it has now: the live view stays clipped exactly as
today, and wave 3 is where the deliberate un-pin lands under the fit guard. No
new exec grant — `resize-window` has been in EXEC_WHITELIST.tmux all along.

ORDER is the guard, not presence: the close handler already ran this same argv,
so the test drives one ordered log shared by the spawn stub and the Runner, and
goes red both when the pin is deleted and when it is merely moved after the
attach.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: `PANE_HISTORY_LINES`, `PaneProbe` and `PaneHistoryReply` move to `shared/api.ts` (L0)

The cross-wave contract puts all three in L0 so wave 3 reads `limit`/`width`/`height` off the same declaration and the PWA can name the reply's shape without retyping it. `shared/api.ts` **imports nothing**, and these are a number and two type aliases — nothing to import.

**Files:**
- Modify: `shared/api.ts` — append to the end of the file
- Modify: `server/src/server.ts` — delete the local `const PANE_HISTORY_LINES = 2000;` at line ~121 and its docstring; import it instead
- Test: `server/test/single-definition.test.ts` (add one `describe`)

**Interfaces:**
- Consumes: nothing.
- Produces, for Tasks 7, 8, 14 and 15:
  ```ts
  export const PANE_HISTORY_LINES = 2000;
  export type PaneProbe =
    | { ok: true; history: number; limit: number; width: number; height: number; alternate: boolean }
    | { ok: false; reason: 'gone' }
    | { ok: false; reason: 'unreadable'; detail: string }
    | { ok: false; reason: 'unparseable'; detail: string };
  export type PaneHistoryReply =
    | { ok: true; text: string; lines: number; scrollback?: number; alternate?: boolean; width?: number }
    | { ok: false; error: 'gone' | 'unmeasured' | 'bad-session-id'; detail?: string };
  ```

> **`width?: number` on the `ok:true` arm is SPEC'D, not a departure** — spec §5.3 declares it and §11 ruling 10 records the decision. §5.4 row 6 sizes the drawer's scrollback as `probe.history × ⌈probe.width / term.cols⌉ + term.rows`, and `probe.width` reaches the client through no other field. It is additive and absence-permitting, so `FLEET_PROTO` does not move and an older peer omitting it keeps today's meaning. No deviation number is owed for it.

- [ ] **Step 1: Write the failing test**

Add this to `server/test/single-definition.test.ts`, following that file's existing guard shape (a regex fingerprinting the definition, a scan of `ALL`, an exact `toEqual`, and a companion proving the former copy-site now imports):

```ts
describe('the pane read is declared once, in L0', () => {
  // PANE_HISTORY_LINES is echoed back to the PWA in every history response and
  // will be read by wave 3's fit floor beside READER_MIN_COLS and
  // STALL_BUDGET_LINES. A second copy is a second number to keep in step.
  it('PANE_HISTORY_LINES is defined in shared/api.ts and nowhere else', () => {
    const holders = ALL.filter((f) => /^\s*export const PANE_HISTORY_LINES\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('PaneProbe is declared in shared/api.ts and nowhere else', () => {
    const holders = ALL.filter((f) => /^\s*export type PaneProbe\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('PaneHistoryReply is declared in shared/api.ts and nowhere else', () => {
    const holders = ALL.filter((f) => /^\s*export type PaneHistoryReply\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  it('server.ts no longer spells the 2000 itself — it imports the name', () => {
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'server.ts'), 'utf8');
    expect(src, 'server.ts still defines its own PANE_HISTORY_LINES').not.toMatch(/const PANE_HISTORY_LINES\s*=/);
    expect(src, 'server.ts uses the constant without importing it').toMatch(/PANE_HISTORY_LINES/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```

Expected: FAIL, four red.
- `PANE_HISTORY_LINES is defined in shared/api.ts and nowhere else` → `expected [] to deeply equal [ 'shared/api.ts' ]` (server.ts's copy is a bare `const`, not `export const`, so the scan finds none).
- `PaneProbe …` and `PaneHistoryReply …` → `expected [] to deeply equal [ 'shared/api.ts' ]`.
- `server.ts no longer spells the 2000 itself` → `expected 'const PANE_HISTORY_LINES = 2000;' not to match /const PANE_HISTORY_LINES\s*=/`.

- [ ] **Step 3: Write the minimal implementation**

Append to the end of `shared/api.ts`:

```ts
/** How far above the screen the drawer's history read starts. Stated ONCE,
 *  here, and echoed back to the client in the response — the PWA never names a
 *  number of its own, so there is nothing for the two sides to disagree about.
 *  2000 is tmux's DEFAULT `history-limit`; `ccd/tmux.conf` sets none, so that
 *  default is what the fleet runs. Asking for more is not an error — tmux
 *  returns what it has.
 *
 *  IT IS A CEILING NOTHING HAS REACHED, and raising it is deliberately not
 *  this program's move (spec §6.4). Census of 2026-09-14, 31 live panes on this
 *  box: `history_size` min 0 / median 0 / p90 5 / max 11, with 25 of the 31 at
 *  zero, every pane at `history-limit 2000`. What ends a pane's history is the
 *  program inside it — Claude Code emits `ESC[3J` on repaint, which resets
 *  `history_size` to 0 (measured, 452 -> 0). A raise would cost tmux memory and
 *  a whole-server stall on every reflow (F10: ~linear in reflowed lines, 455 ms
 *  narrow / 1230 ms widen at 19951) for a case the census says does not occur.
 *  The lever, if a later census disagrees, is one `set -g history-limit N` line
 *  in `ccd/tmux.conf` — read at tmux server start (F2), reaching no pane that
 *  already exists. */
export const PANE_HISTORY_LINES = 2000;

/**
 * ONE MEASUREMENT OF A PANE, and its failures told apart.
 *
 * Read with a single `list-panes -t cc-<id> -F '#{pane_active} #{history_size}
 * #{history_limit} #{pane_width} #{pane_height} #{alternate_on}'` — all six are
 * per-pane formats (F8) under a verb the agent already grants, so this opens no
 * new door in the exec surface.
 *
 * FOUR ARMS, NOT A NULL. `list-panes -t <session>` lists EVERY pane of the
 * current window and the ACTIVE one is the pane `capture-pane -t <session>`
 * reads (F7) — PR #96 took row `[0]` and mismatched on a split window, where
 * pane 0 held 278 lines of history and pane 1 was the 24-row active one. So
 * "tmux answered, but no row said it was active" is a real and separate
 * condition from "tmux refused" and from "the session is gone", and a caller
 * that shows a different sentence for each must never receive one value for
 * all three (CLAUDE.md, no overloaded null; `io.ts`'s `readFileMeasured` is the
 * pattern).
 *
 * `alternate` is CONTEXT, neither a permit nor a refusal (spec §7.2): while the
 * alternate screen is up a resize does not reflow, but the reflow is only
 * DEFERRED to alt-exit and lands then, at a size that is exactly what the
 * numbers at attach predict — nothing scrolls into history while a full-screen
 * app holds the pane (F9, measured: 1852 -> 11359 in one step at alt-exit).
 *
 * Wave 3 reads `limit`, `width` and `height` off THIS probe and adds no second
 * reader — one reader per field is the wire rule.
 */
export type PaneProbe =
  | { ok: true; history: number; limit: number; width: number; height: number; alternate: boolean }
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'unreadable'; detail: string }
  | { ok: false; reason: 'unparseable'; detail: string };

/**
 * What `GET /api/sessions/:id/pane/history` answers.
 *
 * ADDITIVE AND ABSENCE-PERMITTING. `scrollback`, `alternate` and `width` are
 * present exactly when the pane probe was `ok` and absent exactly when it was
 * not — and absent is NOT zero. A `scrollback` of 0 is a MEASURED zero ("there
 * is nothing above this screen"); an absent one is "we could not look", and a
 * reader that finds it absent must behave exactly as it did before the field
 * existed. Nothing here bumps `FLEET_PROTO`.
 *
 * `error` keeps `unmeasured` as the single wire token for every could-not-look
 * condition; the probe's own finer vocabulary (`unreadable` vs `unparseable`)
 * rides in `detail`, which is what the drawer renders.
 */
export type PaneHistoryReply =
  | { ok: true; text: string; lines: number; scrollback?: number; alternate?: boolean; width?: number }
  | { ok: false; error: 'gone' | 'unmeasured' | 'bad-session-id'; detail?: string };
```

In `server/src/server.ts`, delete the whole `const PANE_HISTORY_LINES = 2000;` declaration together with the docstring above it (the block that begins `/** How far above the screen the drawer's history read starts.` and ends at the `const` line), and add `PANE_HISTORY_LINES` to the existing import list from `'../../shared/api.js'` that closes at line ~75.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/pane-history-route.test.ts test/typecheck-tests.test.ts
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS. (`typecheck-tests` is a known load flake — if it is red, re-run it alone before treating it as a break.)

- [ ] **Step 5: Mutation check, then commit**

Temporarily re-add `const PANE_HISTORY_LINES = 2000;` to `server/src/server.ts` beside the import and re-run `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts`. Expected RED: `server.ts still defines its own PANE_HISTORY_LINES`. Restore.

```bash
git add shared/api.ts server/src/server.ts server/test/single-definition.test.ts
git commit -m "$(cat <<'MSG'
feat(shared): declare PANE_HISTORY_LINES, PaneProbe and PaneHistoryReply in L0

All three cross the server/PWA boundary and wave 3 reads limit/width/height off
the same PaneProbe, so they belong where both sides can name them once.
shared/api.ts imports nothing and these add nothing to import.

PaneProbe carries FOUR arms rather than a null because the three failures are
three different sentences to a reader: a gone pane, a tmux that refused, and a
tmux that answered with no row claiming to be active — the last being the shape
PR #96's row-[0] read could not see (F7: on a split window pane 0 held 278
lines of history while pane 1 was the active 24-row one).

PaneHistoryReply's scrollback/alternate/width are present exactly when the
probe was ok; absent is "we could not look" and is never zero. Additive, no
FLEET_PROTO bump.

`width?: number` is declared by spec §5.3 and needed by §5.4's scrollback
formula, which sizes the reader's own buffer from the pane's width.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: `Tmux.paneProbe` — the measured, active-row read (§5.2)

Replaces PR #96's `paneScrollback`, which returned `{lines, alternate} | null` from row `[0]`. The new read selects the **active** row and tells four outcomes apart.

**Files:**
- Modify: `server/src/exec.ts` — add `paneProbe` beside `capture`/`captureAnsi`; **delete `paneScrollback` and its docstring**
- Create: `server/test/exec-pane-probe.test.ts`
- Test: `server/test/exec-pane-probe.test.ts`

**Interfaces:**
- Consumes: `shared/api.ts`'s `PaneProbe` (Task 6); `server/src/exec.ts`'s existing private `const target = (id: string) => 'cc-' + id` and `private run: Runner` where `Runner = (cmd: string, args: string[]) => Promise<ExecResult>` and `ExecResult = { code: number; stdout: string; stderr: string; killed?: boolean; signal?: string | null }`.
- Produces, for Task 8: `async paneProbe(id: string): Promise<PaneProbe>` on `class Tmux`, and
  `export const PANE_PROBE_FORMAT = '#{pane_active} #{history_size} #{history_limit} #{pane_width} #{pane_height} #{alternate_on}';`
- **Removes**, so Task 8 must not call it: `paneScrollback`.

- [ ] **Step 1: Write the failing test**

Create `server/test/exec-pane-probe.test.ts`:

```ts
// `Tmux.paneProbe` — the ONE measurement of a pane the drawer and (in wave 3)
// the fit floor both read.
//
// Every literal below was measured against tmux 3.4 on a PRIVATE socket
// (`tmux -L ccrc-probe-…`), never the fleet's server:
//
//   $ tmux -L s new-session -d -s cc-demo -x 220 -y 50 'sleep 300'
//   $ tmux -L s list-panes -t cc-demo -F '#{pane_active} #{history_size} …'
//   1 0 2000 220 50 0                                          rc=0
//   $ tmux -L s list-panes -t cc-nope -F '#{pane_active}'
//   can't find window: cc-nope                                  rc=1
//   $ tmux -L s split-window -t cc-demo 'sleep 300'
//   $ tmux -L s list-panes -t cc-demo -F '…'
//   0 0 2000 220 25 0
//   1 0 2000 220 24 0
//
// THE GONE LITERAL IS NOT `capture-pane`'S. `capture-pane` says "can't find
// pane: cc-nope"; `list-panes` says "can't find WINDOW". Two verbs, two
// messages, and folding them into one substring test would make a real
// `unreadable` read as death.
import { describe, it, expect } from 'vitest';
import { Tmux, PANE_PROBE_FORMAT, type ExecResult, type Runner } from '../src/exec.js';
import type { PaneProbe } from '../../shared/api.js';

const ID = 'claude-a-MekWarLive';

const probeOn = async (r: ExecResult): Promise<{ probe: PaneProbe; calls: string[][] }> => {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return r;
  };
  const probe = await new Tmux(run).paneProbe(ID);
  return { probe, calls };
};

describe('Tmux.paneProbe', () => {
  it('asks for the six formats in one list-panes, against cc-<id>', async () => {
    const { calls } = await probeOn({ code: 0, stdout: '1 0 2000 220 50 0\n', stderr: '' });
    expect(calls).toEqual([['tmux', 'list-panes', '-t', `cc-${ID}`, '-F', PANE_PROBE_FORMAT]]);
    // The format string is the contract with tmux, so it is spelled out here
    // rather than only referenced — a reordering would silently swap two of
    // the numbers below for each other.
    expect(PANE_PROBE_FORMAT).toBe(
      '#{pane_active} #{history_size} #{history_limit} #{pane_width} #{pane_height} #{alternate_on}');
  });

  it('reads the six numbers off a single-pane window', async () => {
    const { probe } = await probeOn({ code: 0, stdout: '1 0 2000 220 50 0\n', stderr: '' });
    expect(probe).toEqual({ ok: true, history: 0, limit: 2000, width: 220, height: 50, alternate: false });
  });

  it('selects the ACTIVE row on a split window, not the first (F7)', async () => {
    // PR #96 read row [0] and mismatched here: pane 0 carried the history,
    // pane 1 was active and is what `capture-pane -t <session>` returns. A
    // probe that describes a pane the capture did not read is worse than none.
    const { probe } = await probeOn({ code: 0, stdout: '0 278 2000 220 25 0\n1 5 2000 220 24 1\n', stderr: '' });
    expect(probe).toEqual({ ok: true, history: 5, limit: 2000, width: 220, height: 24, alternate: true });
  });

  it("answers `gone` on list-panes' own missing-target message, measured verbatim", async () => {
    const { probe } = await probeOn({ code: 1, stdout: '', stderr: "can't find window: cc-nope\n" });
    expect(probe).toEqual({ ok: false, reason: 'gone' });
  });

  it('answers `unreadable` with the reason for any other tmux refusal', async () => {
    const { probe } = await probeOn({ code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/default\n' });
    expect(probe).toEqual({ ok: false, reason: 'unreadable', detail: 'no server running on /tmp/tmux-1000/default' });
    // An unrecognised FUTURE tmux error must read as "we could not look", never
    // as death — `classifyHasSession`'s polarity (D-308/D-309).
    const odd = await probeOn({ code: 3, stdout: '', stderr: '' });
    expect(odd.probe).toEqual({ ok: false, reason: 'unreadable', detail: 'tmux exited 3 with no message' });
  });

  it('answers `unparseable` when tmux succeeded but no row claims to be active', async () => {
    const { probe } = await probeOn({ code: 0, stdout: '0 12 2000 220 25 0\n', stderr: '' });
    expect(probe).toEqual({
      ok: false, reason: 'unparseable',
      detail: 'list-panes returned 1 row(s), none active',
    });
  });

  it('answers `unparseable` when the active row is not six numbers', async () => {
    const { probe } = await probeOn({ code: 0, stdout: '1 0 2000 220 fifty 0\n', stderr: '' });
    expect(probe).toEqual({
      ok: false, reason: 'unparseable',
      detail: 'active row did not match the six-field shape: 1 0 2000 220 fifty 0',
    });
  });

  it('answers `unparseable` on an empty answer rather than inventing a zero', async () => {
    const { probe } = await probeOn({ code: 0, stdout: '', stderr: '' });
    expect(probe).toEqual({
      ok: false, reason: 'unparseable',
      detail: 'list-panes returned 0 row(s), none active',
    });
  });

  it('never narrows a distinction it received — the four arms stay four', async () => {
    // The mutation this is here to catch: any refactor that folds `unreadable`
    // and `unparseable` into one token, or answers `gone` for both. Four
    // inputs, four distinct answers.
    const answers = [
      (await probeOn({ code: 0, stdout: '1 0 2000 220 50 0\n', stderr: '' })).probe,
      (await probeOn({ code: 1, stdout: '', stderr: "can't find window: cc-nope\n" })).probe,
      (await probeOn({ code: 1, stdout: '', stderr: 'boom\n' })).probe,
      (await probeOn({ code: 0, stdout: '0 1 2 3 4 0\n', stderr: '' })).probe,
    ].map((p) => (p.ok ? 'ok' : p.reason));
    expect(answers).toEqual(['ok', 'gone', 'unreadable', 'unparseable']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/exec-pane-probe.test.ts
```

Expected: FAIL at import — `SyntaxError: The requested module '../src/exec.js' does not provide an export named 'PANE_PROBE_FORMAT'`, and once that is added, `TypeError: (intermediate value).paneProbe is not a function`.

- [ ] **Step 3: Write the minimal implementation**

In `server/src/exec.ts`, add to the import block at the top:

```ts
import type { PaneProbe } from '../../shared/api.js';
```

Add above `export class Tmux {`:

```ts
/** The six per-pane formats one `list-panes` answers with, in the order the
 *  parser below reads them (F8 — all six are per-pane formats under a verb the
 *  agent already grants, so this opens no new door). Exported because the test
 *  pins the string itself: a reordering would silently swap two of the numbers
 *  for each other and every guard downstream would go on believing them. */
export const PANE_PROBE_FORMAT =
  '#{pane_active} #{history_size} #{history_limit} #{pane_width} #{pane_height} #{alternate_on}';

/** One row of `PANE_PROBE_FORMAT`: active flag, four counts, alt flag. */
const PANE_PROBE_ROW = /^([01]) (\d+) (\d+) (\d+) (\d+) ([01])$/;
```

Add this method to `class Tmux`, immediately after `captureAnsi`:

```ts
  /**
   * ONE MEASUREMENT OF THE PANE the drawer is about to read, and the four
   * answers it can honestly give (spec §5.2).
   *
   * THE ACTIVE ROW, NOT THE FIRST (F7). `list-panes -t <session>` lists every
   * pane of the current window, while `capture-pane -t <session>` reads the
   * ACTIVE one — so a probe that took row `[0]` would describe a pane the
   * capture never read. Measured on a private tmux 3.4 socket against a split
   * window: pane 0 answered `0 278 2000 220 25 0` and pane 1
   * `1 5 2000 220 24 1`, and the capture returned pane 1. This is the exact
   * defect PR #96 shipped.
   *
   * THE `gone` LITERAL IS `list-panes`' OWN, and it is NOT `capture-pane`'s.
   * Measured, tmux 3.4: `list-panes -t cc-nope` answers `can't find window:
   * cc-nope` where `capture-pane` answers `can't find pane: cc-nope`. Matching
   * on the wrong one would make a dead session read as `unreadable` forever.
   * The polarity is `classifyHasSession`'s (D-308/D-309): recognise the ONE
   * message that means gone and call everything else unknown, so an
   * unrecognised future tmux error reads as "we could not look" rather than as
   * death.
   *
   * AND `unparseable` IS ITS OWN ARM, not a flavour of `unreadable`. tmux
   * answering rc 0 with no active row is a different fact from tmux refusing:
   * the server is up and reachable, and what failed is this adapter's reading
   * of it. A caller shows a different sentence for each, so folding them would
   * be an adapter narrowing a distinction it received.
   */
  async paneProbe(id: string): Promise<PaneProbe> {
    const r = await this.run('tmux', ['list-panes', '-t', target(id), '-F', PANE_PROBE_FORMAT]);
    if (r.code !== 0) {
      if (r.stderr.includes("can't find window")) return { ok: false, reason: 'gone' };
      const msg = r.stderr.trim();
      return {
        ok: false,
        reason: 'unreadable',
        detail: msg !== '' ? msg : `tmux exited ${r.code} with no message`,
      };
    }
    const rows = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const active = rows.find((l) => l.startsWith('1 '));
    if (active === undefined) {
      return {
        ok: false,
        reason: 'unparseable',
        detail: `list-panes returned ${rows.length} row(s), none active`,
      };
    }
    const m = PANE_PROBE_ROW.exec(active);
    if (m === null) {
      return {
        ok: false,
        reason: 'unparseable',
        detail: `active row did not match the six-field shape: ${active}`,
      };
    }
    return {
      ok: true,
      history: Number(m[2]),
      limit: Number(m[3]),
      width: Number(m[4]),
      height: Number(m[5]),
      alternate: m[6] === '1',
    };
  }
```

Then **delete** `paneScrollback` and the whole docstring above it (from its opening `/**` through the closing `}` of the method).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/exec-pane-probe.test.ts
```

Expected: PASS, 9 tests. `test/pane-history-route.test.ts` will now fail to compile because the route still calls the deleted `paneScrollback` — that is expected, and Task 8 fixes it. Confirm the failure is exactly that:

```bash
cd server && ./node_modules/.bin/vitest run test/pane-history-route.test.ts 2>&1 | head -20
```

Expected: an error naming `paneScrollback` on `server/src/server.ts`.

- [ ] **Step 5: Mutation check, then commit**

Change `const active = rows.find((l) => l.startsWith('1 '));` to `const active = rows[0];` and re-run `test/exec-pane-probe.test.ts`. Expected RED: `selects the ACTIVE row on a split window, not the first (F7)` → `expected { ok: true, history: 278, … } to deeply equal { ok: true, history: 5, … }`. Restore. Then change `r.stderr.includes("can't find window")` to `r.stderr.includes("can't find pane")` and re-run. Expected RED: `answers 'gone' on list-panes' own missing-target message` and `never narrows a distinction it received`. Restore.

```bash
git add server/src/exec.ts server/test/exec-pane-probe.test.ts
git commit -m "$(cat <<'MSG'
feat(exec): one measured read of a pane, with its four outcomes told apart

Replaces PR #96's `paneScrollback`, which read row [0] of `list-panes` and
returned `{lines, alternate} | null`. Two defects in one:

  THE ROW. `list-panes -t <session>` lists EVERY pane of the current window;
  `capture-pane -t <session>` reads the ACTIVE one (F7). Measured on a private
  tmux 3.4 socket against a split window, pane 0 answered
  `0 278 2000 220 25 0` and pane 1 `1 5 2000 220 24 1`, and the capture
  returned pane 1 — so the old probe described a pane nobody read.

  THE NULL. Three conditions collapsed into one value: a gone session, a tmux
  that refused, and a tmux that answered with nothing this adapter could read.
  The drawer says a different sentence for each, so they are four arms now
  (CLAUDE.md: an adapter may not narrow a distinction it received).

The `gone` literal is `list-panes`' OWN and differs from `capture-pane`'s —
measured: "can't find window: cc-nope" against "can't find pane: cc-nope".
Matching the wrong one would make a dead session read as unreadable forever.

One `list-panes -F` with six per-pane formats, under the agent's existing
`['list-panes']` grant (F8) — no new exec surface, nothing to ship to the fleet
host ahead of the server. Wave 3 reads limit/width/height off this same probe.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The route probes first and sizes its capture from the measurement (§5.3)

PR #96 captured first and probed second. The order flips so the read is sized by measurement, and the response gains `width`.

**Files:**
- Modify: `server/src/server.ts` — the whole body of `app.get('/api/sessions/:id/pane/history', …)`
- Modify: `pwa/src/lib/api.ts` — `paneHistory`'s return type becomes the shared `PaneHistoryReply`'s `ok:true` arm
- Modify: `server/test/pane-history-route.test.ts` — extend
- Test: `server/test/pane-history-route.test.ts`

**Interfaces:**
- Consumes: `PaneProbe`, `PaneHistoryReply`, `PANE_HISTORY_LINES` (Task 6); `Tmux.paneProbe` (Task 7); `Tmux.captureHistory(id, lines): Promise<CaptureHistory>` and `isSafeSessionId(id: string): boolean` (`server/src/clip.ts:10`), both already imported by `server.ts`.
- Produces, for Tasks 14 and 15:
  `pwa/src/lib/api.ts`: `paneHistory: (id: string) => Promise<Extract<PaneHistoryReply, { ok: true }>>` — i.e. `{ ok: true; text: string; lines: number; scrollback?: number; alternate?: boolean; width?: number }`. Non-2xx answers reject with `ApiError`, whose `.body` is the parsed `{ ok: false; error; detail? }`.

**A note the implementer must not re-decide.** §5.2 says the probe's only job is to SIZE the capture ("`-S -<history>` when `ok`, else the constant"), and §5.3 says `gone` → 404 and `unreadable`/`unparseable` → 502 with `detail`. Those two sentences are reconciled exactly one way: the **capture** decides the status (it has its own `gone` / `unmeasured` vocabulary and it is what the reader came for), and a probe that failed while the capture succeeded is a **200 with the three measured fields absent** — which is also what §5.3's own "the two fields are absent exactly when the probe was not `ok`" requires. Do not add a status path for a probe failure alone.

- [ ] **Step 1: Write the failing tests**

In `server/test/pane-history-route.test.ts`, first change `makeApp`'s default `listPanes` result to a realistic probe row:

```ts
async function makeApp(
  capture: ExecResult,
  listPanes: ExecResult = { code: 0, stdout: '1 1953 2000 220 50 0\n', stderr: '' },
): Promise<{ app: FastifyInstance; calls: string[][] }> {
```

**THAT DEFAULT IS NOT INERT — it reaches four salvaged tests, and all four move in this same edit.**
The salvaged default is an EMPTY `stdout`, which Task 7's probe reads as `unparseable`, so every test
that took the default got a 200 with the three measured fields absent and a capture sized by the
constant. A six-field row makes the probe `ok`, which changes both the capture window and the body.
Measured against the salvaged file (`git show 6493be32:server/test/pane-history-route.test.ts`);
leaving the first three below unedited is **three reds at Step 4**, not a "PASS everywhere".

First, add the format constant to the file's exec import — it is IMPORTED, never retyped, because a
second hand-written copy of it is exactly what `single-definition.test.ts` forbids and what Task 6/7
moved it out of:

```ts
import { Tmux, PANE_PROBE_FORMAT, type ExecResult, type Runner } from '../src/exec.js';
```

**(1) `reads the pane history with capture-pane and answers it verbatim`** (salvaged `:53` and `:70`)
now takes an `ok` probe of 1953 stored lines on a 220-column pane, so both of its assertions move:

```ts
    expect(res.json()).toEqual({
      ok: true, text: HISTORY, lines: 1953, scrollback: 1953, alternate: false, width: 220,
    });
```

```ts
    expect(calls.filter((c) => c[1] === 'capture-pane')).toEqual([
      ['tmux', 'capture-pane', '-t', `cc-${ID}`, '-p', '-e', '-J', '-S', '-1953'],
    ]);
```

Its `THE ARGV IS THE GUARD` comment stays, and so do Task 4's corrected `-J` row counts — but the
one clause naming the constant is no longer true. Change

```ts
    // colours it was written in, `-S -2000` to start above the screen, and
```

to

```ts
    // colours it was written in, `-S -<history>` to start above the screen, and
```

— the flag is still the guard; the window is now a measurement rather than a constant.

**(2) `carries the scrollback measurement beside the text, off the verb that was already allowed`**
(salvaged `:138-150`) feeds the OLD two-field row `'1979 0\n'`. No row in it starts `1 `, so the probe
answers `unparseable` and all three fields vanish; and its format string is the old two-format one,
written by hand. Both move:

```ts
    const { app, calls } = await makeApp(
      { code: 0, stdout: HISTORY, stderr: '' },
      { code: 0, stdout: '1 1979 2000 220 50 0\n', stderr: '' },
    );
```

```ts
    expect(res.json()).toEqual({
      ok: true, text: HISTORY, lines: 1979, scrollback: 1979, alternate: false, width: 220,
    });
    // `list-panes`, not a new verb: the whitelist entry `panePid` already uses,
    // so this widens nothing in the exec surface.
    expect(calls).toContainEqual(
      ['tmux', 'list-panes', '-t', `cc-${ID}`, '-F', PANE_PROBE_FORMAT]);
```

**(3) `reports the alternate screen as CONTEXT, beside the count that decides`** (salvaged `:160-166`)
feeds `'0 1\n'`, `unparseable` for the same reason. The pane its comment describes — nothing stored,
a full-screen app up — is a six-field row:

```ts
    const { app } = await makeApp(
      { code: 0, stdout: 'a full screen\n', stderr: '' },
      { code: 0, stdout: '1 0 2000 220 50 1\n', stderr: '' },
    );
```

Its `toMatchObject({ ok: true, scrollback: 0, alternate: true })` then holds unchanged, and its
comment — which is about `alternate_on` being context rather than a reason — is untouched.

**(4) `mutates nothing on the pane — no copy-mode, no send-keys, no resize`** asserts
`expect(calls.map((c) => c[1])).toEqual(['capture-pane', 'list-panes'])`. The order flips in Step 3,
so change that one line to `['list-panes', 'capture-pane']` and leave its comment — which is about
the list being EXACT, not about the order — intact.

`an unmeasurable probe OMITS both fields — absence is not zero` passes its own failing `listPanes`
explicitly, and `tells a dead pane (404) apart…`, `a failure with nothing to say…` and `refuses a
session id that is not one…` all decide on the CAPTURE or before tmux is reached: those four are
untouched by the default.

Then append:

```ts
describe('the probe is taken FIRST and sizes the capture (§5.2)', () => {
  it('captures `-S -<history>` when the pane was measured, not the constant', async () => {
    // PR #96 captured 2000 lines and then asked how many there were. A pane
    // holding 47 lines paid for 2000 and a pane holding 1953 got a window
    // sized by a guess that happened to be right. The order flips so the read
    // is sized by the measurement.
    const { app, calls } = await makeApp(
      { code: 0, stdout: HISTORY, stderr: '' },
      { code: 0, stdout: '1 47 2000 220 50 0\n', stderr: '' },
    );
    await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    expect(calls.map((c) => c[1]), 'the capture ran before the measurement that sizes it')
      .toEqual(['list-panes', 'capture-pane']);
    expect(calls.filter((c) => c[1] === 'capture-pane')).toEqual([
      ['tmux', 'capture-pane', '-t', `cc-${ID}`, '-p', '-e', '-J', '-S', '-47'],
    ]);
    await app.close();
  });

  it('falls back to PANE_HISTORY_LINES when the pane could not be measured', async () => {
    const { app, calls } = await makeApp(
      { code: 0, stdout: HISTORY, stderr: '' },
      { code: 1, stdout: '', stderr: 'no server running\n' },
    );
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    expect(calls.filter((c) => c[1] === 'capture-pane')).toEqual([
      ['tmux', 'capture-pane', '-t', `cc-${ID}`, '-p', '-e', '-J', '-S', '-2000'],
    ]);
    // ABSENT, NOT ZERO: an unmeasurable probe omits all three fields, and a
    // reader that finds them absent behaves exactly as it did before they
    // existed. The capture itself succeeded, so this is a 200.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, text: HISTORY, lines: 2000 });
    await app.close();
  });

  it('carries scrollback, alternate AND width when the probe was ok', async () => {
    const { app } = await makeApp(
      { code: 0, stdout: HISTORY, stderr: '' },
      { code: 0, stdout: '1 1953 2000 220 50 1\n', stderr: '' },
    );
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    // `width` is what lets the drawer size its OWN scrollback as
    // history x ceil(paneWidth / readerCols) + rows (§5.4). Without it the
    // reader is back to a constant multiplier over a width it cannot see.
    expect(res.json()).toEqual({
      ok: true, text: HISTORY, lines: 1953, scrollback: 1953, alternate: true, width: 220,
    });
    await app.close();
  });

  it('echoes the SIZE IT ASKED FOR as `lines`, so the two sides cannot disagree', async () => {
    const { app } = await makeApp(
      { code: 0, stdout: HISTORY, stderr: '' },
      { code: 0, stdout: '1 47 2000 220 50 0\n', stderr: '' },
    );
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(res.json()).toMatchObject({ lines: 47, scrollback: 47 });
    await app.close();
  });

  it('a measured ZERO history still asks for the constant — tmux returns what it has', async () => {
    // `-S -0` would start at the screen's own top and return nothing above it,
    // which is indistinguishable from a failed read to the layer above. The
    // measured zero travels as `scrollback: 0` instead, which is exactly the
    // fact the drawer refuses to open a layer on.
    const { app, calls } = await makeApp(
      { code: 0, stdout: HISTORY, stderr: '' },
      { code: 0, stdout: '1 0 2000 220 50 1\n', stderr: '' },
    );
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(calls.filter((c) => c[1] === 'capture-pane')).toEqual([
      ['tmux', 'capture-pane', '-t', `cc-${ID}`, '-p', '-e', '-J', '-S', '-2000'],
    ]);
    expect(res.json()).toMatchObject({ scrollback: 0, alternate: true, width: 220 });
    await app.close();
  });

  it('still refuses an unsafe id before either verb runs', async () => {
    const { app, calls } = await makeApp({ code: 0, stdout: HISTORY, stderr: '' });
    const res = await app.inject({ method: 'GET', url: '/api/sessions/..%2Fetc/pane/history' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(calls, 'a rejected id still reached tmux').toEqual([]);
    await app.close();
  });

  it('the capture still decides the status: gone -> 404, anything else -> 502 with its detail', async () => {
    const gone = await makeApp({ code: 1, stdout: '', stderr: "can't find pane: cc-nope\n" });
    const g = await gone.app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(g.statusCode).toBe(404);
    expect(g.json()).toEqual({ ok: false, error: 'gone' });
    await gone.app.close();

    const bad = await makeApp({ code: 1, stdout: '', stderr: 'server exited unexpectedly\n' });
    const b = await bad.app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(b.statusCode).toBe(502);
    expect(b.json()).toEqual({ ok: false, error: 'unmeasured', detail: 'server exited unexpectedly' });
    await bad.app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-history-route.test.ts
```

Expected: FAIL — first as a compile error naming `paneScrollback` (deleted in Task 7), which stops the file before any assertion runs. Once `server.ts` compiles again but still carries PR #96's capture-then-probe body, the behavioural reds are these, and they are the whole of Step 1's edit:

- `the capture ran before the measurement that sizes it` — `expected [ 'capture-pane', 'list-panes' ] to deeply equal [ 'list-panes', 'capture-pane' ]`;
- `mutates nothing on the pane — no copy-mode, no send-keys, no resize` — the same inversion;
- `captures '-S -<history>' when the pane was measured, not the constant`, `echoes the SIZE IT ASKED FOR as 'lines'` and `a measured ZERO history still asks for the constant` — the capture window is still `-S -2000`;
- `carries scrollback, alternate AND width when the probe was ok` — no `width` on the wire yet;
- and the three SALVAGED tests Step 1 re-fitted to the new default: `reads the pane history with capture-pane and answers it verbatim` (`lines`/`scrollback`/`width` and `-S -1953`), `carries the scrollback measurement beside the text…` (the six-field row and `PANE_PROBE_FORMAT`) and `reports the alternate screen as CONTEXT…` (the six-field row).

`falls back to PANE_HISTORY_LINES when the pane could not be measured` and `still refuses an unsafe id before either verb runs` are green from the start; they assert what does NOT change.

- [ ] **Step 3: Write the minimal implementation**

Replace the whole body of `app.get('/api/sessions/:id/pane/history', …)` in `server/src/server.ts` with:

```ts
  app.get('/api/sessions/:id/pane/history', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    // THE MEASUREMENT COMES FIRST, AND IT SIZES THE READ (spec §5.2). PR #96
    // captured 2000 lines and then asked how many there were, so a pane holding
    // 47 paid for 2000 and the answer's own `lines` was a constant rather than
    // a fact. One `list-panes -F` costs a single tmux round trip and turns the
    // capture window into a measurement.
    //
    // A MEASURED ZERO KEEPS THE CONSTANT: `-S -0` starts at the screen's own
    // top and returns nothing above it, which one layer up is indistinguishable
    // from a failed read. The zero still travels as `scrollback: 0`, which is
    // the fact the drawer refuses to open a layer on.
    //
    // AN UNMEASURABLE PROBE DOES NOT FAIL THE ROUTE. It falls back to the
    // constant and OMITS the three measured fields — absence-permitting, and
    // absent is not zero. The CAPTURE is what decides the status, because the
    // capture is what the reader came for: `gone` -> 404, anything else -> 502
    // carrying tmux's own message.
    const probe = await deps.tmux.paneProbe(id);
    const asked = probe.ok && probe.history > 0 ? probe.history : PANE_HISTORY_LINES;
    const r = await deps.tmux.captureHistory(id, asked);
    if (!r.ok) {
      return r.reason === 'gone'
        ? reply.code(404).send({ ok: false, error: 'gone' })
        : reply.code(502).send({ ok: false, error: 'unmeasured', detail: r.detail });
    }
    // `width` rides along so the DRAWER can size its own scrollback against the
    // pane's width rather than a constant multiplier: a stored line re-wrapped
    // at the reader's width is at most ceil(paneWidth / readerCols) rows, and
    // the census holds a 302-column window, so the multiplier is measured
    // rather than assumed (spec §5.4).
    return probe.ok
      ? { ok: true, text: r.text, lines: asked, scrollback: probe.history, alternate: probe.alternate, width: probe.width }
      : { ok: true, text: r.text, lines: asked };
  });
```

In `pwa/src/lib/api.ts`, add `PaneHistoryReply` to the existing `import type { … } from '../../../shared/api'` list used by that file, then replace the `paneHistory` entry with:

```ts
    /** The terminal drawer's scrollback — the pane's own history, read with
     *  `capture-pane`. `lines` is the server's number, echoed back: this side
     *  never names one, so there is nothing for the two to disagree about.
     *
     *  `scrollback`/`alternate`/`width` are ABSENT from an older server and
     *  from a pane that could not be measured, and absence is not zero: the
     *  drawer opens the history exactly as it always did when it cannot be
     *  told how much sits above the screen. A non-2xx rejects with `ApiError`,
     *  whose `.body` carries the route's own `{error, detail?}`. */
    paneHistory: (id: string) =>
      getJson<Extract<PaneHistoryReply, { ok: true }>>(`${sid(id)}/pane/history`),
```

No further test edit is needed here: the four salvaged tests the new `makeApp` default reaches — including `mutates nothing on the pane…`, whose verb order this step flips — were all re-fitted in Step 1, which is where the red-first edit belongs.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-history-route.test.ts test/exec-pane-probe.test.ts test/pty.test.ts test/single-definition.test.ts
cd pwa && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: PASS everywhere — **including the four salvaged tests Step 1 re-fitted**, which is what makes this a real green rather than a partial one. Confirm by name, not by the summary line:

```bash
cd server && ./node_modules/.bin/vitest run test/pane-history-route.test.ts --reporter=verbose
```

`reads the pane history with capture-pane and answers it verbatim`, `carries the scrollback measurement beside the text…`, `reports the alternate screen as CONTEXT…` and `mutates nothing on the pane…` must each appear as `✓`. If any of the three re-fitted ones is still red here, Step 1 was applied incompletely — re-read `git show 6493be32:server/test/pane-history-route.test.ts` rather than weakening the assertion.

- [ ] **Step 5: Mutation check, then commit**

Change `const asked = probe.ok && probe.history > 0 ? probe.history : PANE_HISTORY_LINES;` to `const asked = PANE_HISTORY_LINES;` and re-run `test/pane-history-route.test.ts`. Expected RED: `captures '-S -<history>' when the pane was measured, not the constant`, `echoes the SIZE IT ASKED FOR as 'lines'`, **and the re-fitted salvaged `reads the pane history with capture-pane and answers it verbatim`** (`-S -2000` for `-S -1953`, `lines: 2000` for `1953`) — three sites, which is the point of re-fitting it rather than neutering its default. Restore. Then delete `width: probe.width` from the `ok` branch and re-run. Expected RED: `carries scrollback, alternate AND width when the probe was ok` and, again, the verbatim test. Restore.

```bash
git add server/src/server.ts pwa/src/lib/api.ts server/test/pane-history-route.test.ts
git commit -m "$(cat <<'MSG'
fix(pane-history): probe first, then size the capture by the measurement

PR #96 captured 2000 lines and then asked how many there were, so a pane
holding 47 paid for 2000 and the answer's own `lines` was a constant dressed as
a fact. The order flips: one `list-panes -F` measures the ACTIVE pane, the
capture window is `-S -<history>`, and `lines` echoes the size actually asked
for.

An unmeasurable probe does not fail the route — it falls back to
PANE_HISTORY_LINES and OMITS scrollback/alternate/width. Absent is not zero: a
measured 0 means nothing is above this screen, an absent one means we could not
look, and the drawer says a different thing for each. A measured zero still
asks for the constant, because `-S -0` returns nothing above the screen and
would be indistinguishable from a failed read one layer up.

`width` is new on the wire, additive and absence-permitting (no FLEET_PROTO
bump): the drawer needs the PANE's width to size its own scrollback as
history x ceil(paneWidth / readerCols) + rows, and no other field carries it.
Declared by spec §5.3.

The capture still decides the status — gone -> 404, anything else -> 502 with
its detail — because the capture is what the reader came for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Drawer correction — ctrl+wheel is a pinch, not a reach for history (§5.4 row 8)

A trackpad pinch arrives as a `wheel` event with `ctrlKey` set. Today the drawer's handler reads only `deltaY < 0` and opens the history on a zoom-in.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx` — the `term.onWheel((ev) => …)` handler, ~line 551
- Modify: `pwa/test/terminal-scrollback.test.tsx` — extend `fakeTermFactory` and add one `describe`
- Test: `pwa/test/terminal-scrollback.test.tsx`

**Interfaces:**
- Consumes: `DrawerTerm.onWheel(cb: (ev: WheelEvent) => boolean): void` (Task 1); `fakeTermFactory()`, `mountDrawer()`, `jsonFetch()`, `OK_HISTORY`, `historyDoor()`, `flush()` (Task 3).
- Produces: `fakeTermFactory()`'s returned object gains `wheelWith: (init: WheelEventInit) => boolean | undefined`.

- [ ] **Step 1: Write the failing test**

In `pwa/test/terminal-scrollback.test.tsx`, add to the object `fakeTermFactory` returns, beside the existing `wheel`:

```ts
    /** A wheel event with arbitrary modifiers — a trackpad pinch arrives as
     *  `wheel` with `ctrlKey`, and it is not a reach for older output. */
    wheelWith: (init: WheelEventInit) => wheelHandlers.at(-1)?.(new WheelEvent('wheel', init)),
```

and append this `describe` to the file:

```ts
describe('a pinch is not a reach for the history', () => {
  it('a ctrl+wheel-up opens nothing and still keeps the pty clean', async () => {
    // A trackpad pinch is delivered as `wheel` with `ctrlKey` set — the browser
    // has no separate event for it, which is why xterm's own
    // `attachCustomWheelEventHandler` documentation uses exactly this case as
    // its example. Reading only `deltaY < 0` turns a zoom-in into a history
    // read: a request to the box, a second terminal mounted, and the reader's
    // live pane covered by a layer they never asked for.
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { t, ws } = mountDrawer();

    act(() => {
      t.wheelWith({ deltaY: -120, ctrlKey: true });
    });
    await act(async () => { await flush(); });

    expect(fetchImpl, 'a pinch read the pane history').not.toHaveBeenCalled();
    expect(historyDoor()?.getAttribute('aria-pressed') ?? 'false',
      'a pinch put the history layer up').toBe('false');
    expect(ws.sent, 'a pinch reached the pty').toEqual([]);
  });

  it('the ordinary wheel still opens it — the guard is the modifier, not the wheel', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { t } = mountDrawer();

    act(() => { t.wheel(-120); });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  });

  it('xterm is still told not to process the pinch itself', async () => {
    // Returning `false` is xterm's own "do not process this", and it is the
    // only thing between the wheel and the pane in the alternate buffer. The
    // guard must SKIP THE READ, not hand the event back to xterm.
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t } = mountDrawer();
    expect(t.wheelWith({ deltaY: -120, ctrlKey: true }),
      'xterm was handed a pinch it will turn into arrow keys').toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: FAIL on `a ctrl+wheel-up opens nothing and still keeps the pty clean` → `AssertionError: a pinch read the pane history: expected "spy" to not be called at all, but it was called 1 time`. The other two pass already.

- [ ] **Step 3: Write the minimal implementation**

In `pwa/src/session/TerminalDrawer.tsx`, replace:

```ts
    term.onWheel((ev) => {
      if (ev.deltaY < 0) openHistory();
      return false;
    });
```

with:

```ts
    term.onWheel((ev) => {
      // A PINCH IS NOT A SCROLL. A trackpad pinch reaches the page as a `wheel`
      // event with `ctrlKey` set — there is no separate event for it, which is
      // why xterm's own `attachCustomWheelEventHandler` docs use this very case
      // as their example. Reading `deltaY` alone turned a zoom-in into a
      // request to the box and a second terminal over the reader's live pane.
      //
      // It still returns `false`: the modifier decides whether to READ, never
      // whether xterm may process the event. Handing a pinch back to xterm in
      // the alternate buffer would put arrow keys on the pty, which is the
      // whole defect this handler exists to stop.
      if (!ev.ctrlKey && ev.deltaY < 0) openHistory();
      return false;
    });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Mutation check, then commit**

Change `if (!ev.ctrlKey && ev.deltaY < 0)` back to `if (ev.deltaY < 0)` and re-run. Expected RED: `a ctrl+wheel-up opens nothing and still keeps the pty clean`. Restore. Then change `return false;` to `return true;` and re-run. Expected RED: `xterm is still told not to process the pinch itself` and `with tmux on the alternate screen a wheel notch sends nothing to the pty`. Restore.

```bash
git add pwa/src/session/TerminalDrawer.tsx pwa/test/terminal-scrollback.test.tsx
git commit -m "$(cat <<'MSG'
fix(terminal,pwa): a trackpad pinch no longer opens the console history

A pinch reaches the page as a `wheel` event with `ctrlKey` set — the browser
has no separate event, which is why xterm's own attachCustomWheelEventHandler
docs use this exact case as their example. The handler read `deltaY` alone, so
a zoom-in fired a request to the box and put a second terminal over the
reader's live pane.

The modifier decides whether to READ; it never decides whether xterm may
process the event. The handler still returns `false`, because handing a pinch
back to xterm in the alternate buffer is how arrow keys reach the pty — the
defect this handler exists to stop.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Drawer correction — a mouse selection on the live glass must not open the history (§5.4 row 2)

The history layer's own drag already stands the mouse down (`if (ev.pointerType === 'mouse') return;`). The **live glass**'s `openDown` has no such guard, so a mouse drag that selects text opens the history over the selection.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx` — `const openDown = (ev: PointerEvent) …`, ~line 597
- Modify: `pwa/test/terminal-scrollback.test.tsx` — add a constant and two `it`s to `describe('a finger opens the history from the live glass', …)`
- Test: `pwa/test/terminal-scrollback.test.tsx`

**Interfaces:**
- Consumes: the describe-local helpers `liveGlass(view)` and `swipe(el, dx, dy)` (Task 3), and `mountDrawer`/`jsonFetch`/`OK_HISTORY`/`flush`.
- Produces: nothing new in production code.

- [ ] **Step 1: Write the failing test**

`TOUCH_OPEN_PX` is not exported, and it must not be: the threshold is a decision the production module owns, and a test that imports it can never notice the decision changing. Add a file-local constant beside `ROW_PX` in `pwa/test/terminal-scrollback.test.tsx`:

```ts
/** `TOUCH_OPEN_PX` as the drawer spells it. Restated rather than imported — a
 *  hardcoded literal is this repo's mutation-table control. Every drag below
 *  clears it by 4x, so this number being stale cannot make a test pass that
 *  should fail. */
const OPEN_PX = 24;
```

Then add these two `it`s inside the existing `describe('a finger opens the history from the live glass', …)` block:

```ts
  it('a MOUSE drag selects text on the live glass — it does not open the history', async () => {
    // The history layer already stands the mouse down for exactly this reason
    // (`a MOUSE drag selects text — it does not scroll the view`); the live
    // glass never learned it. A reader dragging across the live pane to copy a
    // line got a history layer over their selection instead, and the selection
    // with it. The mouse loses nothing: its gesture is the wheel, which opens
    // the history already.
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { view } = mountDrawer();
    const el = liveGlass(view);

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 100, clientY: 100 + 4 * OPEN_PX, isPrimary: true, pointerType: 'mouse' });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 100, clientY: 100 + 4 * OPEN_PX, isPrimary: true, pointerType: 'mouse' });
    await act(async () => { await flush(); });

    expect(fetchImpl, 'a mouse selection opened the console history').not.toHaveBeenCalled();
  });

  it('a bare pointer drag still opens it — the guard names the mouse, not the pointer', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { view } = mountDrawer();
    swipe(liveGlass(view), 0, 4 * OPEN_PX);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: FAIL on `a MOUSE drag selects text on the live glass — it does not open the history` → `AssertionError: a mouse selection opened the console history: expected "spy" to not be called at all, but it was called 1 time`. The second new test passes already.

- [ ] **Step 3: Write the minimal implementation**

In `pwa/src/session/TerminalDrawer.tsx`, replace:

```ts
    const openDown = (ev: PointerEvent): void => {
      if (openViaTouch) return;                           // the finger owns this
      if (ev.defaultPrevented) { from = null; return; }   // xterm's own scrollbar
      from = { x: ev.clientX, y: ev.clientY };
    };
```

with:

```ts
    const openDown = (ev: PointerEvent): void => {
      if (openViaTouch) return;                           // the finger owns this
      // THE MOUSE IS SELECTING TEXT, NOT REACHING FOR HISTORY — the same
      // stand-down the history layer's own drag makes one level down, and for
      // the same reason. xterm starts a selection on mousedown and follows it
      // with a document-level mousemove; a reader dragging across the live pane
      // to copy a line got a history layer over their selection, and the
      // selection with it. The mouse loses nothing by standing down: its
      // gesture for this is the wheel, which opens the history already.
      if (ev.pointerType === 'mouse') { from = null; return; }
      if (ev.defaultPrevented) { from = null; return; }   // xterm's own scrollbar
      from = { x: ev.clientX, y: ev.clientY };
    };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
```

Expected: PASS, including the pre-existing `a deliberate drag DOWN reads the pane history, exactly as a wheel-up does` — its `swipe` sets no `pointerType`, so those events carry the empty-string default and are not mice.

- [ ] **Step 5: Mutation check, then commit**

Delete the `if (ev.pointerType === 'mouse') { from = null; return; }` line and re-run. Expected RED: `a MOUSE drag selects text on the live glass — it does not open the history`. Restore. Then widen it to `if (ev.pointerType !== 'touch') { from = null; return; }` and re-run. Expected RED: `a bare pointer drag still opens it` and `a deliberate drag DOWN reads the pane history, exactly as a wheel-up does`. Restore.

```bash
git add pwa/src/session/TerminalDrawer.tsx pwa/test/terminal-scrollback.test.tsx
git commit -m "$(cat <<'MSG'
fix(terminal,pwa): a mouse selection on the live glass no longer opens the history

The history layer's own drag already stands the mouse down — xterm starts a
selection on mousedown and follows it with a document-level mousemove, so a
handler that claims the gesture takes the one way to copy a line out of the
console. The LIVE glass's open gesture never learned it: a reader dragging
across the live pane to select got a history layer over their selection, and
the selection with it.

Same guard, one level up. The mouse loses nothing: its gesture for the history
is the wheel, which opens it already.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: Drawer correction — an `alive` latch before `dispose()` (§5.4 row 3)

`term.write(text, () => term.scrollLines(…))` fires after `dispose()` under React StrictMode's double-invoked effects, which throws inside xterm. The spec requires the test to drive the **real** `defaultMakeHistoryTerm`.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx` — export `defaultMakeHistoryTerm`; add the latch in the history effect, ~line 684
- Modify: `pwa/test/terminal-scrollback.test.tsx` — add one `describe`, and two imports
- Test: `pwa/test/terminal-scrollback.test.tsx`

**Interfaces:**
- Consumes: `MakeHistoryTerm`, `HistoryTerm` (Task 1); `fakeTermFactory`, `mountDrawer`, `jsonFetch`, `OK_HISTORY`, `flush`, `FakeSocket`, `makeSocket`, `ID` (Task 3).
- Produces: `export const defaultMakeHistoryTerm: MakeHistoryTerm` — now exported, consumed by this task's test and by Task 14's.

- [ ] **Step 1: Write the failing test**

Add `import { StrictMode } from 'react';` to the top of `pwa/test/terminal-scrollback.test.tsx` and add `defaultMakeHistoryTerm` to its `TerminalDrawer` import. Then append:

```ts
// — the real terminal, disposed while its write is still parsing —
//
// The effect that mounts the history layer is a React effect, and under
// StrictMode React runs every effect twice on mount: set up, tear down, set up.
// xterm's `write(data, done)` parses ASYNCHRONOUSLY, so the first mount's `done`
// lands AFTER that mount's cleanup has already called `dispose()`. Calling
// `scrollLines` on a disposed Terminal throws, and the throw escapes into
// React's commit — a blank drawer with a TypeError in the console, which is how
// the operator would meet it.
//
// This drives the REAL `defaultMakeHistoryTerm`, not a stub: a stub's `write`
// is synchronous and cannot reproduce the window the defect lives in.
describe('the history terminal survives being disposed mid-parse', () => {
  it('a real terminal disposed while its write is in flight does not throw', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const term = defaultMakeHistoryTerm(host, 2000);
    let threw: unknown = null;
    let alive = true;

    term.write('older output\r\nolder still\r\n', () => {
      // THE LATCH, as the drawer holds it: the callback checks whether the
      // terminal it is about to touch is still the live one.
      if (!alive) return;
      try {
        term.scrollLines(-3);
      } catch (e) {
        threw = e;
      }
    });
    alive = false;
    term.dispose();
    await new Promise((r) => setTimeout(r, 50));

    expect(threw, 'the parse callback reached a disposed terminal').toBeNull();
    host.remove();
  }, 20_000);

  it('the drawer holds that latch itself — a StrictMode double mount raises nothing', async () => {
    // The whole component, twice-mounted the way StrictMode mounts it, driving
    // the REAL history terminal. Any throw from the parse callback escapes into
    // React's commit and this catches it.
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent): void => { errors.push(e.error); };
    window.addEventListener('error', onError);
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));

    const t = fakeTermFactory();
    const view = render(
      <StrictMode>
        <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />
      </StrictMode>,
    );
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('drawer opened no socket');
    act(() => ws.onopen?.());
    act(() => { t.wheel(-120); });
    await act(async () => { await flush(); });
    await new Promise((r) => setTimeout(r, 50));

    window.removeEventListener('error', onError);
    view.unmount();
    expect(errors, 'a parse callback reached a terminal StrictMode had already disposed').toEqual([]);
  }, 20_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: FAIL at import first — `does not provide an export named 'defaultMakeHistoryTerm'`. Export it (Step 3's first change), re-run, and the behavioural red is `the drawer holds that latch itself — a StrictMode double mount raises nothing` → `AssertionError: a parse callback reached a terminal StrictMode had already disposed`, with the received array holding a `TypeError`. The first `it` passes — it holds its own latch, and is the control proving the window is real.

- [ ] **Step 3: Write the minimal implementation**

In `pwa/src/session/TerminalDrawer.tsx`, export the factory:

```ts
export const defaultMakeHistoryTerm: MakeHistoryTerm = (host, lines) => {
```

Then, inside the history effect (`useEffect(() => { if (hist.at !== 'history' || histHost === null) return undefined; …`), declare the latch immediately after the terminal is made:

```ts
    const term = (makeHistoryTerm ?? defaultMakeHistoryTerm)(histHost, hist.lines);
    // THE LATCH, AND STRICTMODE IS WHY IT EXISTS. React runs every effect twice
    // on mount in development: set up, tear down, set up. xterm's
    // `write(data, done)` parses ASYNCHRONOUSLY, so the first mount's `done`
    // lands after that mount's cleanup has already called `dispose()` — and
    // `scrollLines` on a disposed Terminal throws, out of a callback nothing
    // catches, into React's commit. A blank drawer and a TypeError.
    //
    // A flag rather than a try/catch: swallowing the throw would also swallow a
    // real one, and what this needs to express is "the terminal this callback
    // was written for is gone", which is a fact the effect knows and the
    // callback does not.
    let alive = true;
    term.fit();
```

guard the opening scroll:

```ts
    term.write(hist.text.replace(/\r?\n/g, '\r\n'), () => {
      // One notch up, so the gesture that opened this visibly did something —
      // and so the bottom latch is armed by a reader who is genuinely above
      // it. INSIDE the parse callback: xterm writes asynchronously, and a
      // scroll issued beside the write runs against the buffer as it stood
      // BEFORE the history landed, which moves nothing and arms nothing.
      //
      // AND GUARDED, because "asynchronously" includes "after this effect was
      // torn down" — see the `alive` note above.
      if (!alive) return;
      term.scrollLines(-WHEEL_LINES);
    });
```

and in that effect's cleanup, set it false **before** `term.dispose()`:

```ts
      stopGlide();
      alive = false;   // BEFORE dispose: an in-flight parse callback must find it false
      term.dispose();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS.

- [ ] **Step 5: Mutation check, then commit**

Delete the `if (!alive) return;` from the write callback and re-run. Expected RED: `the drawer holds that latch itself — a StrictMode double mount raises nothing`. Restore. Then move `alive = false;` to **after** `term.dispose();` and re-run: the same test goes RED, because the callback now finds `alive` still true against a disposed terminal. Move it back.

```bash
git add pwa/src/session/TerminalDrawer.tsx pwa/test/terminal-scrollback.test.tsx
git commit -m "$(cat <<'MSG'
fix(terminal,pwa): the opening scroll no longer reaches a disposed terminal

React runs every effect twice on mount under StrictMode: set up, tear down, set
up. xterm's `write(data, done)` parses ASYNCHRONOUSLY, so the first mount's
`done` lands after that mount's cleanup has already called `dispose()` — and
`scrollLines` on a disposed Terminal throws, out of a callback nothing catches,
into React's commit. A blank drawer with a TypeError behind it.

An `alive` flag set false BEFORE dispose, checked in the callback. A flag and
not a try/catch: swallowing the throw would swallow a real one too, and what
this needs to say is "the terminal this callback was written for is gone" —
which the effect knows and the callback does not.

Driven against the REAL defaultMakeHistoryTerm (now exported for it): a stub's
write is synchronous and cannot reproduce the window the defect lives in. The
suite carries both the control — a real terminal disposed mid-parse, latch held
by hand — and the whole component under StrictMode with a window `error`
listener catching what escapes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: Drawer correction — a monotonic request id (§5.4 row 4)

`openHistory` guards on `histRef.current.at !== 'reading'`, which is a **state**, not a request identity. A reader who leaves the history and re-opens it can have the first read's answer overwrite the second's.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx` — `const openHistory = (): void => …`, ~line 405
- Modify: `pwa/test/terminal-scrollback.test.tsx` — add one `describe`
- Test: `pwa/test/terminal-scrollback.test.tsx`

**Interfaces:**
- Consumes: `type Hist = { at: 'live' } | { at: 'reading' } | { at: 'history'; text: string; lines: number } | { at: 'empty'; why: string }`, `histRef`, `goHist` (Task 1); `fakeTermFactory`/`fakeHistoryFactory`/`historyDoor`/`flush` (Task 3).
- Produces: `const reqRef = useRef(0);` inside the component. No exported surface changes.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/terminal-scrollback.test.tsx`:

```ts
describe('the newest read wins', () => {
  it('a stale answer cannot overwrite a newer one', async () => {
    // `reading` is a STATE, not a request identity. Sequence: open (read A in
    // flight), return to live, open again (read B). Both land in `reading`, so
    // the old guard admits whichever RESOLVES last — and A resolving after B
    // paints the reader a history captured before they left. Two distinct
    // bodies make the difference visible.
    const bodies = [
      { ok: true, text: 'STALE-A\n', lines: 2000 },
      { ok: true, text: 'FRESH-B\n', lines: 2000 },
    ];
    const gates: Array<() => void> = [];
    let n = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => {
      const body = bodies[n] ?? bodies[1]!;
      n += 1;
      await new Promise<void>((resolve) => { gates.push(resolve); });
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const t = fakeTermFactory();
    const h = fakeHistoryFactory();
    render(
      <TerminalDrawer
        id={ID} open onClose={() => {}}
        makeSocket={makeSocket} makeTerm={t.makeTerm} makeHistoryTerm={h.makeHistoryTerm}
      />,
    );
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('drawer opened no socket');
    act(() => ws.onopen?.());

    act(() => { t.wheel(-120); });                  // read A starts
    await waitFor(() => expect(gates).toHaveLength(1));
    act(() => { t.type('x'); });                    // a keystroke returns to live
    act(() => { t.wheel(-120); });                  // read B starts
    await waitFor(() => expect(gates).toHaveLength(2));

    // B answers first, then the stale A.
    await act(async () => { gates[1]!(); await flush(); });
    await act(async () => { gates[0]!(); await flush(); });

    expect(h.write.mock.calls.map((c) => c[0]),
      'a read the reader had already left overwrote the one they asked for')
      .toEqual(['FRESH-B\r\n']);
  });

  it('a stale FAILURE cannot put up a notice over a newer success either', async () => {
    const gates: Array<(v: Response) => void> = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      new Promise<Response>((resolve) => { gates.push(resolve); }));
    vi.stubGlobal('fetch', fetchImpl);

    const t = fakeTermFactory();
    const h = fakeHistoryFactory();
    render(
      <TerminalDrawer
        id={ID} open onClose={() => {}}
        makeSocket={makeSocket} makeTerm={t.makeTerm} makeHistoryTerm={h.makeHistoryTerm}
      />,
    );
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('drawer opened no socket');
    act(() => ws.onopen?.());

    act(() => { t.wheel(-120); });
    await waitFor(() => expect(gates).toHaveLength(1));
    act(() => { t.type('x'); });
    act(() => { t.wheel(-120); });
    await waitFor(() => expect(gates).toHaveLength(2));

    await act(async () => {
      gates[1]!(new Response(JSON.stringify(OK_HISTORY), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
      await flush();
    });
    await act(async () => {
      gates[0]!(new Response(JSON.stringify({ ok: false, error: 'gone' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      }));
      await flush();
    });

    expect(screen.queryByText(/no history/), 'a stale failure covered a live history').toBeNull();
    expect(historyDoor()?.getAttribute('aria-pressed')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: FAIL on `a stale answer cannot overwrite a newer one` → `expected [ 'FRESH-B\r\n', 'STALE-A\r\n' ] to deeply equal [ 'FRESH-B\r\n' ]`, and on `a stale FAILURE cannot put up a notice over a newer success either` → the `no history` notice is found.

- [ ] **Step 3: Write the minimal implementation**

In `pwa/src/session/TerminalDrawer.tsx`, add beside the other refs in the component:

```ts
  /** WHICH READ, not merely "a read is running". `reading` is a state and two
   *  reads share it: a reader who leaves the history and opens it again has two
   *  requests in flight, and the old guard admitted whichever RESOLVED last —
   *  painting a history captured before they left. A number that only ever goes
   *  up gives each response an identity to be checked against. */
  const reqRef = useRef(0);
```

and replace `openHistory`'s two `then` arms so both check it. The success arm's first line becomes:

```ts
        // THE ANSWER HAS TO BE THE ONE THAT WAS ASKED FOR. The state check
        // stays — a reader who typed their way back to live wants no layer at
        // all — and the identity check is what keeps a stale answer from
        // standing in for a newer one.
        if (req !== reqRef.current || histRef.current.at !== 'reading') return;
```

the rejection arm's first line becomes:

```ts
        if (req !== reqRef.current) return;
```

and the two lines that open the call become:

```ts
    if (histRef.current.at !== 'live') return;
    reqRef.current += 1;
    const req = reqRef.current;
    goHist({ at: 'reading' });
```

Leave the `// NOTHING ABOVE THE SCREEN IS NOT A HISTORY.` and `// WHY, not just "failed"` comment blocks exactly where they are.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
```

Expected: PASS, including the pre-existing `a flick of the wheel is ONE capture, and so is a wheel turned again while reading`.

- [ ] **Step 5: Mutation check, then commit**

Reduce the success arm's guard back to `if (histRef.current.at !== 'reading') return;` and re-run. Expected RED: `a stale answer cannot overwrite a newer one`. Restore. Then delete `if (req !== reqRef.current) return;` from the rejection arm and re-run. Expected RED: `a stale FAILURE cannot put up a notice over a newer success either`. Restore.

```bash
git add pwa/src/session/TerminalDrawer.tsx pwa/test/terminal-scrollback.test.tsx
git commit -m "$(cat <<'MSG'
fix(terminal,pwa): the newest history read wins — `reading` is a state, not an identity

A reader who leaves the history and opens it again has two requests in flight.
Both land in `reading`, so the guard admitted whichever RESOLVED last — and the
older one resolving second paints a history captured before they left. The
failure arm was worse: a stale 404 put a "no history" notice over a history
that was already up.

A monotonic request id gives each response an identity to be checked against.
The state check stays, because a reader who typed their way back to live wants
no layer at all, and the identity check is a different question from that one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: Drawer correction — refit the history terminal on resize (§5.4 row 5)

The history terminal is fitted once, at mount. A rotation while reading leaves the old grid, so xterm wraps against columns the glass no longer has. The live terminal already refits.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx` — the history effect, after `term.fit();` and in its cleanup
- Modify: `pwa/test/terminal-scrollback.test.tsx` — make `fakeHistoryFactory` count its fits, add one `describe`
- Test: `pwa/test/terminal-scrollback.test.tsx`

**Interfaces:**
- Consumes: `HistoryTerm.fit(): { cols: number; rows: number }` (Task 1); `fakeHistoryFactory` (Task 3).
- Produces: `fakeHistoryFactory`'s returned object gains `fits: number[]`.

- [ ] **Step 1: Write the failing test**

In `pwa/test/terminal-scrollback.test.tsx`, add `const fits: number[] = [];` beside `const scrolled: number[] = [];` inside `fakeHistoryFactory`, change the stub's `fit` to:

```ts
        fit: () => {
          fits.push(fits.length + 1);
          return { cols: 48, rows: 20 };
        },
```

add `fits,` to the object it returns, and append:

```ts
describe('a rotation while reading refits the history', () => {
  const open = async () => {
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const m = mountDrawer();
    act(() => { m.t.wheel(-120); });
    await waitFor(() => expect(m.h.write).toHaveBeenCalled());
    return m;
  };

  it('a window resize refits it, the way the live terminal already does', async () => {
    // Fitted once at mount and never again: a phone rotated while reading kept
    // the portrait grid, so xterm went on wrapping against columns the glass no
    // longer had — text off the right edge of a layer whose entire job is to be
    // readable. The live terminal has refit on `resize` since it shipped; the
    // history one never learned it.
    const { h } = await open();
    const before = h.fits.length;

    act(() => { window.dispatchEvent(new Event('resize')); });

    expect(h.fits.length, 'the history terminal kept a grid the glass no longer has')
      .toBeGreaterThan(before);
  });

  it('the visual viewport moving — a keyboard opening — refits it too', async () => {
    const { h } = await open();
    const before = h.fits.length;

    act(() => { window.visualViewport?.dispatchEvent(new Event('resize')); });

    // jsdom may not implement visualViewport; when it does not, the listener
    // cannot be under test and the assertion is skipped rather than faked.
    if (window.visualViewport) {
      expect(h.fits.length, 'the keyboard opening left the history at the old grid')
        .toBeGreaterThan(before);
    }
  });

  it('leaving the history removes the listeners it added', async () => {
    const { h, t } = await open();
    act(() => { t.type('x'); });                 // a keystroke returns to live
    await waitFor(() => expect(h.dispose).toHaveBeenCalled());
    const after = h.fits.length;

    act(() => { window.dispatchEvent(new Event('resize')); });

    expect(h.fits.length, 'a disposed history terminal is still being refitted').toBe(after);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: FAIL on `a window resize refits it, the way the live terminal already does` → `expected 1 to be greater than 1`. The third test passes vacuously today and becomes a real guard once the listeners exist.

- [ ] **Step 3: Write the minimal implementation**

In `pwa/src/session/TerminalDrawer.tsx`, in the history effect, after `term.fit();` add:

```ts
    // AND AGAIN WHENEVER THE GLASS CHANGES SHAPE. Fitted once, the history kept
    // whatever grid it was born with: a phone rotated while reading went on
    // wrapping against columns it no longer had, and the keyboard opening did
    // the same thing a softer way. The live terminal has refit on both events
    // since it shipped (`refit`, in the attach effect); this is the same pair,
    // for the layer that exists to be read.
    //
    // No grid comparison here, unlike the live one: there is no resize frame to
    // send and nothing downstream to spare, so a fit that changes nothing is
    // cheaper than the bookkeeping to avoid it.
    const refitHistory = (): void => { term.fit(); };
    window.addEventListener('resize', refitHistory);
    window.visualViewport?.addEventListener('resize', refitHistory);
```

and in that effect's cleanup, remove them **before** `stopGlide()`:

```ts
      window.removeEventListener('resize', refitHistory);
      window.visualViewport?.removeEventListener('resize', refitHistory);
      stopGlide();
      alive = false;   // BEFORE dispose: an in-flight parse callback must find it false
      term.dispose();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Mutation check, then commit**

Delete the two `addEventListener` lines and re-run. Expected RED: `a window resize refits it, the way the live terminal already does`. Restore. Then delete the two `removeEventListener` lines and re-run. Expected RED: `leaving the history removes the listeners it added` — `expected 3 to be 2`. Restore.

```bash
git add pwa/src/session/TerminalDrawer.tsx pwa/test/terminal-scrollback.test.tsx
git commit -m "$(cat <<'MSG'
fix(terminal,pwa): the history terminal refits when the glass changes shape

Fitted once at mount and never again, so a phone rotated while reading kept its
portrait grid and xterm went on wrapping against columns the glass no longer
had — text off the right edge of the one layer whose whole job is to be
readable. The keyboard opening did the same thing more quietly.

The live terminal has refit on `resize` and `visualViewport.resize` since it
shipped. Same pair, same effect's cleanup removing both — every listener paired
with its removal (review lens 2).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 14: Drawer correction — size the scrollback from the measured pane (§5.4 row 6)

`scrollback: lines * 3` under-provisions on a phone. The measured rule: a stored logical line re-wrapped at the reader's width is at most `⌈paneWidth / readerCols⌉` rows, plus the screen's own rows — and the census holds a **302-column** window, so the multiplier is measured, not a constant.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx` — a new exported pure helper, `MakeHistoryTerm`'s signature, `defaultMakeHistoryTerm`, `Hist`'s history arm, `openHistory`'s success path, and the history effect's call
- Modify: `pwa/test/terminal-scrollback.test.tsx` — `fakeHistoryFactory`'s stub signature plus one `describe`
- Test: `pwa/test/terminal-scrollback.test.tsx`

**Interfaces:**
- Consumes: `PaneHistoryReply`'s `scrollback?` and `width?` (Tasks 6, 8); `defaultMakeHistoryTerm` (Task 11); `fitter(term, fit)` (Task 1's salvaged helper, `(term: Terminal, fit: FitAddon) => () => { cols: number; rows: number }`).
- Produces:
  ```ts
  export interface HistoryPane { history: number; width: number }
  export function historyScrollback(lines: number, cols: number, rows: number, pane?: HistoryPane): number
  export type MakeHistoryTerm = (host: HTMLElement, lines: number, pane?: HistoryPane) => HistoryTerm
  ```
  and `Hist`'s history arm becomes `{ at: 'history'; text: string; lines: number; pane?: HistoryPane }`.

- [ ] **Step 1: Write the failing test**

In `pwa/test/terminal-scrollback.test.tsx`, make `fakeHistoryFactory` record the third argument. Add `const panes: Array<{ history: number; width: number } | undefined> = [];` beside `const madeWith: number[] = [];`, change the factory's signature line and first statements to:

```ts
    makeHistoryTerm: (_host: HTMLElement, lines: number, pane?: { history: number; width: number }) => {
      madeWith.push(lines);
      panes.push(pane);
```

and add `panes,` to the object it returns. Then add `historyScrollback` to the `TerminalDrawer` import and append:

```ts
describe('the reader sizes its own buffer from the pane it measured', () => {
  it('a stored line is at most ceil(paneWidth / readerCols) rows, plus the screen', () => {
    // MEASURED RATHER THAN ASSUMED. `lines * 3` was derived from one pane at
    // 220 columns read on one phone; the fleet census of 2026-09-14 holds a
    // 302-column window, where a 43-column reader needs 8 rows per stored line,
    // not 3 — and xterm silently drops the oldest history past its scrollback.
    // The screen's own rows are added because `capture-pane -S -N` returns the
    // visible screen along with the history above it.
    expect(historyScrollback(2000, 43, 20, { history: 1953, width: 302 }))
      .toBe(1953 * Math.ceil(302 / 43) + 20);
    expect(historyScrollback(2000, 220, 50, { history: 1953, width: 220 }))
      .toBe(1953 + 50);
    // A reader WIDER than the pane re-wraps nothing: the multiplier floors at 1.
    expect(historyScrollback(2000, 400, 50, { history: 100, width: 220 })).toBe(100 + 50);
  });

  it('falls back to lines * 3 when the pane could not be measured', () => {
    expect(historyScrollback(2000, 43, 20, undefined)).toBe(6000);
  });

  it('a measured zero leaves the screen as the floor, never a buffer of nothing', () => {
    // A measured zero history reaches here only through a race (the drawer
    // refuses to open a layer on one), and a scrollback of 0 would be a
    // terminal that cannot scroll at all. The screen's rows are the floor.
    expect(historyScrollback(2000, 43, 20, { history: 0, width: 220 })).toBe(20);
  });

  it('the drawer hands the measurement through to the terminal it makes', async () => {
    vi.stubGlobal('fetch', jsonFetch(200, {
      ok: true, text: HISTORY, lines: 1953, scrollback: 1953, alternate: false, width: 302,
    }));
    const m = mountDrawer();
    act(() => { m.t.wheel(-120); });
    await waitFor(() => expect(m.h.write).toHaveBeenCalled());

    expect(m.h.panes, 'the reader was given no pane to size itself against')
      .toEqual([{ history: 1953, width: 302 }]);
    expect(m.h.madeWith).toEqual([1953]);
  });

  it('an older server that sends no width leaves the reader on the fallback', async () => {
    vi.stubGlobal('fetch', jsonFetch(200, { ok: true, text: HISTORY, lines: 2000 }));
    const m = mountDrawer();
    act(() => { m.t.wheel(-120); });
    await waitFor(() => expect(m.h.write).toHaveBeenCalled());

    expect(m.h.panes, 'absence was read as a measurement').toEqual([undefined]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: FAIL at import — `SyntaxError: The requested module '../src/session/TerminalDrawer' does not provide an export named 'historyScrollback'`.

- [ ] **Step 3: Write the minimal implementation**

In `pwa/src/session/TerminalDrawer.tsx`, add above `export type MakeHistoryTerm`:

```ts
/** What the server measured about the pane this history came out of — the two
 *  numbers the reader needs to size its own buffer. Absent when the probe was
 *  not `ok`, and absent is not zero. */
export interface HistoryPane {
  history: number;
  width: number;
}

/**
 * HOW MANY ROWS THE READER MUST BE ABLE TO HOLD.
 *
 * `capture-pane -J` returns LOGICAL lines, and the reader re-wraps each of them
 * at its own width: a line stored at `pane.width` columns becomes at most
 * `ceil(pane.width / cols)` rows here. `-S -N` also returns the visible screen
 * along with the history above it, so the screen's own rows are added (F13's
 * shape, one layer up: the screen counts).
 *
 * `lines * 3` was the old rule and it was derived from ONE pane at 220 columns
 * read on ONE phone. The fleet census of 2026-09-14 holds a 302-column window,
 * where a 43-column reader needs 8 rows per stored line — and xterm answers an
 * under-provisioned scrollback by silently dropping the oldest history, which
 * is the half of the read the reader scrolled up for.
 *
 * PURE, and exported for its own tests: jsdom cannot measure a row, so the
 * arithmetic is what can be held still.
 */
export function historyScrollback(
  lines: number,
  cols: number,
  rows: number,
  pane?: HistoryPane,
): number {
  if (pane === undefined) return lines * 3;
  const wrap = cols > 0 ? Math.max(1, Math.ceil(pane.width / cols)) : 1;
  return pane.history * wrap + rows;
}

export type MakeHistoryTerm = (host: HTMLElement, lines: number, pane?: HistoryPane) => HistoryTerm;
```

Change `defaultMakeHistoryTerm` to take the pane and set the scrollback **after** the fit, since `term.cols`/`term.rows` are only real once the addon has measured a mounted host. Its head becomes:

```ts
export const defaultMakeHistoryTerm: MakeHistoryTerm = (host, lines, pane) => {
  const term = new Terminal({
    ...glass(),
    cursorBlink: false,
    disableStdin: true,
    // A FIRST GUESS, replaced by a measurement below. xterm needs some
    // scrollback at construction and `term.cols` does not exist until the addon
    // has fitted against a mounted host, so the real number is set once both
    // facts are in hand. See `historyScrollback` for what it means, and for the
    // reflow note this comment used to get wrong.
    scrollback: lines * 3,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  const fitTo = fitter(term, fit);
  /** Fit, then re-derive the buffer at the width that fit produced — so a
   *  rotation re-sizes the scrollback as well as the grid. */
  const sized = (): { cols: number; rows: number } => {
    const grid = fitTo();
    term.options.scrollback = historyScrollback(lines, grid.cols, grid.rows, pane);
    return grid;
  };
  sized();
```

and in the object that factory returns, change `fit: fitter(term, fit),` to `fit: sized,`. Everything else in the factory is unchanged.

Then widen `Hist`'s history arm:

```ts
  | { at: 'history'; text: string; lines: number; pane?: HistoryPane }
```

In `openHistory`'s success path, replace `goHist({ at: 'history', text: r.text, lines: r.lines });` with:

```ts
        // ABSENT IS NOT ZERO, one last time: only a probe that answered `ok`
        // gives the reader two numbers to size itself by, and an older server
        // or an unmeasurable pane leaves it on the `lines * 3` fallback that
        // shipped before either field existed.
        const pane = typeof r.scrollback === 'number' && typeof r.width === 'number'
          ? { history: r.scrollback, width: r.width }
          : undefined;
        goHist({ at: 'history', text: r.text, lines: r.lines, pane });
```

and in the history effect, pass it through:

```ts
    const term = (makeHistoryTerm ?? defaultMakeHistoryTerm)(histHost, hist.lines, hist.pane);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS.

- [ ] **Step 5: Mutation check, then commit**

Change `return pane.history * wrap + rows;` to `return lines * 3;` and re-run. Expected RED: `a stored line is at most ceil(paneWidth / readerCols) rows, plus the screen`. Restore. Then change the `pane` construction in `openHistory` to `{ history: r.scrollback ?? 0, width: r.width ?? 220 }` and re-run. Expected RED: `an older server that sends no width leaves the reader on the fallback` — `expected [ { history: 0, width: 220 } ] to deeply equal [ undefined ]`. Restore.

```bash
git add pwa/src/session/TerminalDrawer.tsx pwa/test/terminal-scrollback.test.tsx
git commit -m "$(cat <<'MSG'
fix(terminal,pwa): size the reader's scrollback from the pane that was measured

`lines * 3` was derived from one pane at 220 columns read on one phone. The
fleet census of 2026-09-14 holds a 302-column window, where a 43-column reader
needs 8 rows per stored line — and xterm answers an under-provisioned
scrollback by silently dropping the oldest history, which is the half of the
read the reader scrolled up for.

`capture-pane -J` returns LOGICAL lines and the reader re-wraps each at its own
width, so the bound is `history x ceil(paneWidth / readerCols)`, plus the
screen's own rows because `-S -N` returns the visible screen too. Both numbers
come off the server's pane probe; an older server or an unmeasurable pane sends
neither and keeps the `lines * 3` fallback exactly as it shipped — absent is
not zero.

The arithmetic is a pure exported function because jsdom cannot measure a row,
so the arithmetic is the part that can be held still. It is applied after the
fit, since `term.cols` does not exist until the addon has measured a mounted
host — and re-applied on every refit, so a rotation re-derives the buffer too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 15: Drawer correction — say WHY, in sentences (§5.4 row 7)

A failed read renders the raw wire token: `no history · gone`, `· unmeasured`, `· unreachable`. The `detail` the route now carries is discarded entirely.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx` — a new exported pure helper, `Hist`'s `empty` arm, `openHistory`'s rejection path, and the `term-histbar` render
- Modify: `pwa/test/terminal-scrollback.test.tsx` — add one `describe`
- Test: `pwa/test/terminal-scrollback.test.tsx`

**Interfaces:**
- Consumes: `PaneHistoryReply`'s `ok:false` arm (Task 6); `ApiError` from `pwa/src/lib/api` (already imported by the drawer).
- Produces: `Hist`'s empty arm becomes `{ at: 'empty'; why: string; detail?: string }`, and
  `export function historyFailureSentence(error: string, detail?: string): string`.

- [ ] **Step 1: Write the failing test**

Add `historyFailureSentence` to the `TerminalDrawer` import and append to `pwa/test/terminal-scrollback.test.tsx`:

```ts
describe('a failed read says why, in a sentence', () => {
  it('the three failures are three sentences, and none of them is a wire token', () => {
    // The reader is not a protocol. `gone`, `unmeasured` and `unreachable` were
    // rendered raw, so the layer that exists to explain a missing history said
    // the least explanatory thing it had.
    expect(historyFailureSentence('gone')).toBe('this session is gone — there is no pane to read');
    expect(historyFailureSentence('unmeasured', 'no server running on /tmp/tmux-1000/default'))
      .toBe('could not read this pane — no server running on /tmp/tmux-1000/default');
    expect(historyFailureSentence('unreachable')).toBe('could not reach the box to read this pane');
    // And the two MEASURED reasons a read can succeed with nothing in it keep
    // the sentences they already had.
    expect(historyFailureSentence('nothing has scrolled off this pane yet'))
      .toBe('nothing has scrolled off this pane yet');
  });

  it('an unmeasured failure with no detail still reads as a sentence', () => {
    expect(historyFailureSentence('unmeasured')).toBe('could not read this pane');
  });

  it("a 502's detail reaches the glass", async () => {
    vi.stubGlobal('fetch', jsonFetch(502, {
      ok: false, error: 'unmeasured', detail: 'active row did not match the six-field shape: junk',
    }));
    const m = mountDrawer();
    act(() => { m.t.wheel(-120); });

    await screen.findByText(
      /could not read this pane — active row did not match the six-field shape: junk/);
  });

  it('a 404 says the session is gone, not the word `gone`', async () => {
    vi.stubGlobal('fetch', jsonFetch(404, { ok: false, error: 'gone' }));
    const m = mountDrawer();
    act(() => { m.t.wheel(-120); });

    await screen.findByText(/this session is gone — there is no pane to read/);
    expect(screen.queryByText(/no history · gone$/), 'the raw wire token is still on the glass')
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: FAIL at import — `does not provide an export named 'historyFailureSentence'`.

- [ ] **Step 3: Write the minimal implementation**

In `pwa/src/session/TerminalDrawer.tsx`, add beside `historyScrollback`:

```ts
/**
 * WHY THERE IS NO HISTORY, as a sentence rather than as a wire token.
 *
 * The route answers three distinct failures and PR #96 rendered all three raw —
 * `no history · gone`, `· unmeasured`, `· unreachable` — on the one layer whose
 * entire job is to explain a missing history. `detail` was discarded outright,
 * which is the half that says WHICH tmux refusal it was.
 *
 * Anything that is not one of the three tokens is already a sentence (the two
 * MEASURED-empty reasons the success path writes) and is returned untouched, so
 * this never has to know about them.
 */
export function historyFailureSentence(error: string, detail?: string): string {
  if (error === 'gone') return 'this session is gone — there is no pane to read';
  if (error === 'unreachable') return 'could not reach the box to read this pane';
  if (error === 'unmeasured') {
    return detail !== undefined && detail !== ''
      ? `could not read this pane — ${detail}`
      : 'could not read this pane';
  }
  return error;
}
```

Widen `Hist`'s empty arm:

```ts
  | { at: 'empty'; why: string; detail?: string }
```

In `openHistory`'s rejection arm, carry the detail:

```ts
      (e: unknown) => {
        if (req !== reqRef.current) return;
        // WHY, not just "failed": a dead pane, a tmux that could not answer and
        // an unreachable box are three different facts to the reader, and the
        // server already told them apart. `ApiError.body` carries the route's
        // own word for it AND, for a 502, the tmux message underneath.
        const body = e instanceof ApiError ? (e.body as { error?: unknown; detail?: unknown }) : null;
        const why = typeof body?.error === 'string' ? body.error : 'unreachable';
        const detail = typeof body?.detail === 'string' ? body.detail : undefined;
        if (histRef.current.at === 'reading') goHist({ at: 'empty', why, detail });
      },
```

And in the `term-histbar` render, replace:

```tsx
                {hist.at === 'reading' ? 'reading history…' : `no history · ${hist.why}`}
```

with:

```tsx
                {hist.at === 'reading'
                  ? 'reading history…'
                  : `no history · ${historyFailureSentence(hist.why, hist.detail)}`}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS. The pre-existing `a dead pane, an unanswerable tmux and an unreachable box stay THREE answers` asserts the three states remain distinguishable; if it asserts on literal token text, update its expected strings to the three sentences above and leave its comment intact.

- [ ] **Step 5: Mutation check, then commit**

Fold the first two arms together — `if (error === 'gone' || error === 'unreachable') return 'could not read this pane';` — and re-run. Expected RED: `the three failures are three sentences, and none of them is a wire token` and `a 404 says the session is gone, not the word 'gone'`. Restore. Then drop `hist.detail` from the render call and re-run. Expected RED: `a 502's detail reaches the glass`. Restore.

```bash
git add pwa/src/session/TerminalDrawer.tsx pwa/test/terminal-scrollback.test.tsx
git commit -m "$(cat <<'MSG'
fix(terminal,pwa): a failed history read says why, in a sentence

The route answers three distinct failures and the drawer rendered all three raw
— `no history · gone`, `· unmeasured`, `· unreachable` — on the one layer whose
entire job is to explain a missing history. `detail`, which is the half that
says WHICH tmux refusal it was, was discarded outright; the server had already
measured it and carried it over the wire.

Three sentences, and a 502's detail reaches the glass behind the second one.
Anything that is not one of the three tokens is already a sentence — the two
MEASURED-empty reasons the success path writes — and is returned untouched, so
the mapping never has to know about them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---
### Task 16: Drawer correction — the transform credits rows that MOVED, not rows asked for (§5.4 row 1)

`paintLag.scrolled(n, px)` is handed the number passed to `scrollLines` verbatim. xterm **clamps** at both ends of the buffer, so a throw that reaches the oldest line goes on asking for rows it cannot get — and the transform stands in for a displacement that never happens, for the whole tail of the throw.

**MEASURE THIS BEFORE WRITING ANYTHING, because it changes what the test can be.** The spec prescribes crediting "`term.buffer.active.viewportY` delta measured across the `scrollLines` call (synchronous at `smoothScrollDuration: 0`)". Measured in this repo's own jsdom, against a real `Terminal` with 60 lines written, `rows` 24, `baseY` 37:

```
before scrollLines(-3):  viewportY 37
after  scrollLines(-3):  viewportY 37
after a 50 ms settle:    viewportY 37
```

**`viewportY` does not move in jsdom at all** — not synchronously, and not after a render. jsdom has no layout, and xterm's scroll is a virtual re-render driven off it. The behavioural consequence is real (measured through the whole factory, with the screen's rect stubbed to 480px over 24 rows so the row height is 20):

| | control `scrollLines(-3)` | top clamp | bottom clamp |
|---|---|---|---|
| crediting `n` (today) | `translateY(60px)` | `translateY(200000px)` | `translateY(-200000px)` |
| crediting the delta | `""` | `""` | `""` |

So the **defect is provable in jsdom and the fix's correct half is not**: after the change every scroll through the real factory credits zero there. That is a jsdom artefact, not a regression — every drag and throw test in this suite drives the STUB `fakeHistoryFactory`, whose `scrollLines` records rather than scrolls, and all 67 stay green (measured). What this task can therefore ship as a red-suite mechanism is the **source-scan guard** below plus the pure-arithmetic control — this repo's own idiom (`auto-continue-armed.test.ts` scans `ccd/ccd`'s text; `single-definition.test.ts` scans four roots; `ccd-arith-containment.test.ts` scans a fixed population). **Do not invent a behavioural assertion jsdom cannot make.** Report the limitation with the wave-done (worker clause 11) so the browser-side proof can be scheduled as its own work.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx` — `PaintLag.scrolled`'s docstring, `defaultMakeHistoryTerm`'s `Terminal` options, and its `scrollLines` method
- Modify: `pwa/test/terminal-scrollback.test.tsx` — add one `describe`
- Test: `pwa/test/terminal-scrollback.test.tsx`

**Interfaces:**
- Consumes: `export function paintLag(): PaintLag` with `scrolled(rows: number, rowPx: number): void`, `sub(px: number): void`, `painted(): void`, `transform(): number` (Task 3 — it arrives with `644f4173`, not with Task 1's chain).
- Produces: no signature changes. `PaintLag.scrolled`'s **meaning** changes — `rows` is now the measured viewport displacement, not the amount requested — and its docstring says so.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/terminal-scrollback.test.tsx`, and add `import { readFileSync } from 'node:fs';` and `import path from 'node:path';` to its import block:

```ts
// — the transform stands in only for rows that actually moved —
//
// xterm CLAMPS `scrollLines` at both ends of its buffer. A throw that reaches
// the oldest line goes on asking for rows for the rest of its curve, and every
// one of those asks was credited to the transform — so the view slid by a
// displacement the rows were never going to make, and then snapped back when
// xterm's own `onRender` finally cleared it. That is the tail of the throw
// shaking, at the top of the history, where a reader is most likely to be
// looking.
//
// WHY THIS IS A SOURCE SCAN AND NOT A BEHAVIOURAL TEST, measured rather than
// assumed: `term.buffer.active.viewportY` does not move in jsdom. Against a
// real Terminal with 60 lines written (rows 24, baseY 37), `scrollLines(-3)`
// leaves viewportY at 37 before the call, after the call, and after a 50 ms
// settle — jsdom has no layout and xterm's scroll is a virtual re-render off
// it. So the DEFECT is visible here (crediting `n` paints translateY(200000px)
// against a clamp) but the FIX's correct half is not (crediting the delta
// paints nothing, for every scroll). A test asserting the fixed behaviour in
// jsdom would pass for the wrong reason. What can go red is the call site
// itself, and the arithmetic underneath it.
describe('the transform credits rows that moved', () => {
  const drawerSrc = (): string =>
    readFileSync(path.resolve(__dirname, '../src/session/TerminalDrawer.tsx'), 'utf8');

  /** The history terminal's own `scrollLines`, as source. */
  const scrollLinesBody = (): string => {
    const m = /scrollLines: \(n\) => \{([\s\S]*?)\n {4}\},/.exec(drawerSrc());
    if (m === null) throw new Error('defaultMakeHistoryTerm has no scrollLines block to scan');
    return m[1]!;
  };

  it('reads the viewport either side of the scroll, and credits the difference', () => {
    const body = scrollLinesBody();
    expect(body, 'the call site does not read the viewport at all')
      .toContain('term.buffer.active.viewportY');
    expect(body, 'the viewport is read once — a delta needs it either side of the scroll')
      .toMatch(/viewportY[\s\S]*scrollLines\(n\)[\s\S]*viewportY/);
    expect(body, 'the ROWS ASKED FOR are still being credited — xterm clamps, so `n` is a request')
      .not.toMatch(/lag\.scrolled\(\s*n\s*,/);
  });

  it('the scan is looking at something — the block is real and still calls paintLag', () => {
    const body = scrollLinesBody();
    expect(body.length, 'the scrollLines block came back empty').toBeGreaterThan(50);
    expect(body, 'the block no longer credits paintLag at all').toContain('lag.scrolled(');
    expect(body, 'the block no longer scrolls').toContain('term.scrollLines(n)');
  });

  it('the terminal sets its scroll instant explicitly, so the delta is one frame`s worth', () => {
    // A smooth scroll would not have arrived when the second read happens. This
    // terminal is dragged and thrown by hand at 60 Hz and wants none of xterm's
    // own easing.
    expect(drawerSrc(), 'the history terminal inherits whatever xterm defaults to')
      .toContain('smoothScrollDuration: 0');
  });

  it('a ZERO credit moves the transform by nothing — the arithmetic underneath', () => {
    // The pure half, and the reason the call site's change means anything: a
    // clamped scroll now hands `0` down here, and `0` must leave the standing
    // transform exactly where it was rather than adding to it.
    const lag = paintLag();
    lag.sub(7);
    expect(lag.transform()).toBe(7);
    lag.scrolled(0, 20);
    expect(lag.transform(), 'a clamped scroll still displaced the view').toBe(7);
    lag.scrolled(-3, 20);
    expect(lag.transform(), 'a real displacement stopped being credited').toBe(7 + 60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx
```

Expected: FAIL, two red.
- `reads the viewport either side of the scroll, and credits the difference` → `AssertionError: the call site does not read the viewport at all: expected '…const px = cellHeight();\n      term.scrollLines(n);\n      lag.scrolled(n, px);…' to contain 'term.buffer.active.viewportY'`.
- `the terminal sets its scroll instant explicitly, so the delta is one frame's worth` → `expected '…' to contain 'smoothScrollDuration: 0'`.

The other two pass: the anti-vacuity scan and the pure-arithmetic control both hold today, which is what makes them controls.

- [ ] **Step 3: Write the minimal implementation**

In `pwa/src/session/TerminalDrawer.tsx`, correct `PaintLag.scrolled`'s docstring:

```ts
  /** The terminal scrolled — `rows` is the displacement the VIEWPORT actually
   *  made, and `rowPx` the row height at that moment.
   *
   *  MEASURED, NOT REQUESTED, and that distinction is the whole of one fix:
   *  xterm CLAMPS `scrollLines` at both ends of the buffer, so a throw that
   *  reaches the oldest line goes on asking for rows for the rest of its curve.
   *  Crediting the ASK made the transform stand in for a displacement the rows
   *  were never going to make, and the view slid and snapped back for the whole
   *  tail of the throw. The call site reads `term.buffer.active.viewportY`
   *  either side of the scroll and hands the difference here.
   *
   *  The sign lives HERE rather than at the call site: a viewport moving toward
   *  OLDER output is a negative `viewportY` delta and the content moves DOWN,
   *  so a helper that took "px, downward" would put that flip in an adapter no
   *  test can reach. */
  scrolled(rows: number, rowPx: number): void;
```

`paintLag()`'s body is unchanged — `pending += -rows * rowPx` is already correct once `rows` is a measurement, and `0` correctly adds nothing.

In `defaultMakeHistoryTerm`'s `Terminal` options, beside `disableStdin: true`, add:

```ts
    // ZERO, EXPLICITLY, because a measurement leans on it: the call site below
    // reads `viewportY` either side of `scrollLines`, and a smooth scroll would
    // not have arrived when the second read happens. xterm's own default is
    // already 0; saying it here keeps a future default change from silently
    // un-synchronising the read. This terminal is dragged and thrown by hand at
    // 60 Hz and wants none of xterm's easing either way.
    smoothScrollDuration: 0,
```

and replace that factory's `scrollLines` with:

```ts
    scrollLines: (n) => {
      // ROW HEIGHT FIRST: after the scroll the buffer has moved, and this
      // reads the rendered cell, which must be the one the rows were standing
      // at when they were asked to move.
      const px = cellHeight();
      // AND THE DISPLACEMENT IS MEASURED, NOT ASSUMED. xterm clamps at both
      // ends of the buffer, so `n` is a REQUEST and `viewportY`'s delta is the
      // answer — see `PaintLag.scrolled`. NOTE FOR ANYONE TESTING THIS:
      // `viewportY` does not move under jsdom at all (measured — 60 lines
      // written, rows 24, baseY 37, viewportY 37 before, after, and 50 ms
      // later), because jsdom has no layout and xterm's scroll is a virtual
      // re-render off it. The guard on this line is therefore a source scan in
      // `terminal-scrollback.test.tsx`, not a behavioural assertion; a browser
      // proof is its own work.
      const before = term.buffer.active.viewportY;
      term.scrollLines(n);
      lag.scrolled(term.buffer.active.viewportY - before, px);
      paint();
    },
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-scrollback.test.tsx test/terminal.test.tsx
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS — 4 new tests green, and the whole file green. Measured on this branch with the change applied: `Test Files 2 passed (2)`, `Tests 67 passed (67)` before the four are added. The pre-existing `the transform stands in for a row until it lands, then steps back by exactly it`, `holds "painted + transform === asked for" through a decelerating throw` and `is symmetric — a throw the other way carries its rows the same` all drive the STUB terminal and are unaffected by a change to the real factory.

- [ ] **Step 5: Mutation check, then commit**

Change `lag.scrolled(term.buffer.active.viewportY - before, px);` back to `lag.scrolled(n, px);` and re-run. Expected RED: `reads the viewport either side of the scroll, and credits the difference`, on both the `not.toMatch` and the either-side ordering. Restore. Then delete `smoothScrollDuration: 0,` and re-run. Expected RED: `the terminal sets its scroll instant explicitly`. Restore. Then change `pending += -rows * rowPx` to `pending += -(rows || 1) * rowPx` in `paintLag()` and re-run. Expected RED: `a ZERO credit moves the transform by nothing` — `expected 27 to be 7`. Restore.

```bash
git add pwa/src/session/TerminalDrawer.tsx pwa/test/terminal-scrollback.test.tsx
git commit -m "$(cat <<'MSG'
fix(terminal,pwa): the transform stands in for rows that MOVED, not rows asked for

xterm clamps `scrollLines` at both ends of its buffer, and `paintLag.scrolled`
was handed the number that was REQUESTED. So a throw reaching the oldest line
went on asking for rows for the rest of its curve, and every ask was credited
to the transform — the view slid by a displacement the rows were never going to
make and snapped back when xterm's own `onRender` finally cleared it. The tail
of a throw shaking, at the top of the history.

`term.buffer.active.viewportY` read either side of the call is the measurement,
and `smoothScrollDuration: 0` is now set explicitly so it stays synchronous
rather than depending on an xterm default.

THE GUARD IS A SOURCE SCAN, and the reason is measured: `viewportY` does not
move under jsdom at all — 60 lines written, rows 24, baseY 37, and viewportY
reads 37 before `scrollLines(-3)`, after it, and 50 ms later. jsdom has no
layout and xterm's scroll is a virtual re-render off it. So the DEFECT is
visible here (crediting `n` paints translateY(200000px) against a clamp) and
the FIX's correct half is not (crediting the delta paints nothing, always). A
test asserting the fixed behaviour in jsdom would pass for the wrong reason, so
what goes red is the call site's own text — this repo's idiom, the same one
`auto-continue-armed.test.ts` uses across the bash/TS boundary — plus the pure
arithmetic underneath, where a ZERO credit must displace nothing. A browser
proof is its own work and is reported with the wave-done.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---
### Task 17: Whole-branch verification, the deviation reconcile, and the PR

**Files:**
- Modify: `docs/superpowers/plans/2026-09-14-drawer-wave1-latch-and-reader.md` — fill in `## Deviations found` with the ISSUED numbers
- Test: every suite in all three packages

**Interfaces:**
- Consumes: everything above.
- Produces: a pushed branch and a PR against `main`.

- [ ] **Step 1: Install the remaining dependencies and run all three suites in the foreground**

```bash
cd agent && npm ci
cd server && npm ci
```

then, each in the FOREGROUND with a timeout of at least 600000 ms:

```bash
cd server && npm run test
cd agent  && npm run test
cd pwa    && npm run test
```

Expected: all three green. `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests` and `ccd-session-state` are known load flakes — re-run any of them **in isolation** with `./node_modules/.bin/vitest run test/<name>.test.ts` before calling a real break.

- [ ] **Step 2: Typecheck the PWA with its own compiler**

```bash
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: no output, exit 0. The PWA uses `typescript` 6.0.3; `server/`'s 7.x must never be pointed at this project — `typecheck-tests.test.ts` resolves each package's own binary for exactly that reason.

- [ ] **Step 3: Prove nothing in `ccd/` or `agent/` moved**

```bash
git diff --name-only origin/main...HEAD | grep -E '^(ccd|agent)/' && echo "OUT OF SCOPE — wave 1 touches server/, pwa/, shared/ only" || echo "scope clean"
```

Expected: `scope clean`. This wave adds **no** exec grant and is a **server-class** deploy; a hit here means wave-2 work has leaked in and the AGENT-FIRST rule would suddenly apply.

- [ ] **Step 4: Allocate and define the deviation numbers**

**This plan ships owing no deviation numbers.** Both departures an earlier draft carried are now
spec'd outright — `1c4e79fe`'s salvage by §5.6 and §11 ruling 9, and `width?: number` by §5.3 and
§11 ruling 10 — so there is nothing to allocate for them. `## Deviations found` below is therefore
empty, and that is the expected end state.

If executing this wave DID force a departure from what this plan says, allocate for it here and
DEFINE it in the same act — `count` is however many you actually owe:

```bash
curl -sS -X POST "$CCRC_URL/api/ledger/deviations" \
  -H "x-ccrc-mail-token: $(cat ~/.ccrc/mail.token)" \
  -H 'content-type: application/json' \
  -d '{"project":"ccrc-pwa","count":<how many you owe>,"title":"terminal drawer wave 1 — the latch and the reader"}'
```

Write each returned number into `## Deviations found` below with its entry, in the same act as the
allocation. **A session that cannot reach the allocator names the departure in its wave-done mail and
reports (worker clause 11)** — never guess, and never read a number off another plan and increment it.
**Never write a concrete `D-TBD-<a real slug>` into this file**: it is a TRACKED file, and
`server/test/dtbd.test.ts` git-greps every tracked file for `D-TBD-[a-z0-9]` and reds the tree on a
hit. The pending token lives in mail, not on disk.

Then prove no collision against `main` without merging:

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the ledger entries, push, and open the PR**

**THE COMMIT IS CONDITIONAL, because Step 4's expected end state is that nothing was allocated.** With
no departure, `## Deviations found` is unchanged, nothing is staged, and a bare `git commit` exits
non-zero with `nothing to commit, working tree clean` — which halts the worker on the expected path.
Guard it on the plan file having actually moved:

```bash
PLAN=docs/superpowers/plans/2026-09-14-drawer-wave1-latch-and-reader.md
if [ -n "$(git status --porcelain -- "$PLAN")" ]; then
  git add "$PLAN"
  git commit -m "$(cat <<'MSG'
docs(plan): define wave 1's deviations against the issued block

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
else
  echo "no deviations owed — nothing to commit, which is Step 4's expected end state"
fi
git push -u origin HEAD
gh pr create --base main --title "Terminal drawer wave 1: the latch and the reader" --body-file - <<'BODY'
Wave 1 of the terminal-drawer programme
(`docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md`, §5).
Deploy class: **server**. Touches `server/`, `pwa/`, `shared/` only — no `ccd/`,
no `agent/`, **no new exec grant**.

## What lands

**The latch (§5.1).** `GET /ws/pty/:id` issues `tmux resize-window -t cc-<id>
-x 220 -y 50` before `spawnPty`. `resize-window` latches `window-size manual`
(F3), so the client that attaches an instant later cannot narrow the window and
tmux never reflows the stored history. This closes a hazard that is live on
`main`: 21 of 31 windows read `latest` (F12). MEASURED end to end (F14) on one
session holding 1153 stored / 1203 logical lines — unpinned, a 43-column attach
left 1046 logical of 1203, **157 destroyed**; pinned first, the window stayed
220 throughout and the history was untouched.

**The measured read (§5.2).** `Tmux.paneProbe` replaces PR #96's
`paneScrollback`: one `list-panes -F` over six per-pane formats, selecting the
**ACTIVE** row (F7 — PR #96 read row `[0]` and described a pane the capture
never read), answering four arms rather than a null. The `gone` literal is
`list-panes`' own and differs from `capture-pane`'s — measured, "can't find
window" against "can't find pane".

**The route (§5.3).** Probe first, then size the capture by the measurement.
`lines` echoes the size actually asked for. `scrollback`/`alternate`/`width` are
present exactly when the probe was `ok`; absent is "we could not look" and is
never zero. Additive, no `FLEET_PROTO` bump. Route counts re-pinned 48/76/73,
not in `EXEMPT`.

**The drawer (§5.4).** PR #96's history layer, touch drag and momentum salvaged
by cherry-pick with `-x` and the author's trailer (§5.6), then **nine**
corrections — §5.4's table has nine rows and all nine land here — each
red-first: the ctrl+wheel pinch (Task 9), the live glass's mouse guard (10), the
StrictMode dispose race against the REAL terminal (11), a monotonic request id
(12), refit on rotation (13), the scrollback sized from the measured pane (14),
three sentences for three failures (15), the transform crediting the rows that
MOVED rather than the rows asked for — `paintLag` against the measured
`viewportY` delta, §5.4 row 1 (16) — and §2's two false "tmux never reflows"
comments with the inverted `-J` numbers (4).

## Review lenses (§5.5)

1. **tmux semantics** — every measured claim in a shipped comment re-measured on
   a private socket.
2. **xterm / React lifecycle** — §5.4's table, plus every listener paired with
   its removal.
3. **SECURITY, opus, MANDATORY — escape-sequence replay.** `capture-pane -e`
   preserves OSC/DCS/CSI from up to 2000 lines of model- and repo-controlled
   output and replays them into a SECOND emulator with a real scrollback and its
   own config. The lens confirms the history terminal opens with the live
   terminal's hardening (no clipboard addon, no proposed API, link handling
   identical), and that an unterminated DCS or an OSC 52 in the capture cannot
   act.

## Departures

None. Both of the departures an earlier draft of this plan carried were ruled
into the spec instead, so they are now the design rather than a deviation from
it: `1c4e79fe`'s salvage by §5.6 and **§11 ruling 9** (it ships with the
full-height-`Sheet` consumer census and the red test PR #96 never had), and
`width?: number` on the history reply by §5.3 and **§11 ruling 10** (additive,
absence-permitting, one reader — no `FLEET_PROTO` bump). This wave's plan
carries an empty `## Deviations found` for the same reason.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
```

- [ ] **Step 6: Close PR #96, citing this wave's PR**

Spec §5.6 requires it, and it is a STEP rather than an assumption: the superseded branch must not be
left open with its commits duplicated under new SHAs, and its author is owed the reason in writing.
Run this only after Step 5's PR exists, and substitute that PR's number for `<N>`:

```bash
gh pr close 96 --comment "Superseded by #<N> (terminal drawer wave 1).

The work in this PR is not discarded: twelve of its commits are cherry-picked into #<N> with \`-x\`
and your \`Co-authored-by:\` trailer — the wheel, the door, the \`-J\` capture, the pane-with-no-history
answer, the console's own drag, and the whole touch/momentum chain.

What changed is the window-follow (\`df82702d\`, \`1dee05ab\`). Measured on a private tmux 3.4 socket:
tmux DOES reflow stored history on a horizontal resize, and when the reflow exceeds the pane's
\`history-limit\` the overflow is shed on the next line of output and does not come back. A 43-column
attach to a 220-column pane holding 1203 logical lines left 1046 — 157 destroyed. The design that
replaces it pins the window at the canonical grid before every attach and un-pins only under a
measured fit guard, through a verb the fleet box advertises.

The full design, with its fourteen measurements, is at
docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md, and the four wave plans
are beside it under docs/superpowers/plans/."
```

If `gh` refuses or is unavailable, DO NOT leave this silent: record the refusal verbatim and report it
in the wave-done mail (worker clause 11) so the coordinator can close it by hand. `gh` has no
exec-whitelist entry by design, so this runs from the worker's own shell, never through the server.

Expected: `gh pr view 96 --json state --jq .state` → `CLOSED`.

- [ ] **Step 7: Report the wave-done fingerprint**

Re-measure rather than quoting the claim: `handoffCommit === branchTip` on **this workspace's own branch**, read fresh from the git ref files and `.prhistory`. Report to the coordinator with any deviation numbers actually owed (Step 4 expects none — say so explicitly if none were allocated, rather than leaving it unsaid), the three review lenses above naming lens 3 as the mandatory opus/xhigh one, and whether Step 6 closed PR #96 or was refused.

---

## Deviations found

Numbers are ISSUED, never chosen: allocate with `POST /api/ledger/deviations` and DEFINE in the same act. A session that cannot reach the allocator writes `D-TBD-<slug>` and reports (worker clause 11).

None were owed *as planned*. Executing the wave found five, every one of them a defect in THIS
PLAN rather than in the spec or the execution — four surfaced by the worker and confirmed by
re-measurement, one an addition the coordinator ruled in. The coordinator assigned them from the
programme block at review (worker clause 11: a worker never calls the allocator mid-wave).

**Task 17 Step 4 of this plan is itself wrong and is struck**: it tells the worker to call
`POST /api/ledger/deviations`, which the wave brief, the programme ledger and worker clause 11 all
forbid. The worker refused it and reported, which is the protocol working against a bad instruction.

- **D-2766** (Task 4): this plan's own Step 3 replacement comment for `server/src/exec.ts` refutes
  the false "tmux never reflows" claim *by quoting it*, and Step 1's regex has no word boundary
  after `reflow` — so the refutation scans identically to the assertion the guard forbids, and Step
  4's "Expected: PASS everywhere" is unreachable. Measured RED, `offenders = ['server/src/exec.ts']`.
  Reworded to refute without restating. The regex was deliberately NOT loosened: that would readmit
  the genuine false claim and break this same task's Step 5 mutation, which requires red.
- **D-2767** (Task 11): this plan's second test CANNOT FAIL. React double-invokes an effect only on
  a component's INITIAL mount commit, and that effect's body returns early until `hist` flips to
  `'history'` — which happens later, on a state change of an already-mounted component — so
  StrictMode never reaches it. Measured: delete `if (!alive) return;` and the suite stays green at
  57 passed. Step 5's mutation 2 is unfalsifiable by construction: both statements run in one
  synchronous cleanup block and the parse callback fires strictly after it returns. Replaced with
  the race that is real — history lands, xterm parses, a keystroke returns to live, cleanup
  disposes mid-parse.
- **D-2768** (Task 12): both of this plan's tests resolve the FRESH read first, the one order in
  which the pre-existing `histRef.current.at !== 'reading'` check already suffices — so Step 2's
  "Expected: FAIL" is wrong (measured 59 passed against code with no request id) and both Step 5
  mutations stay green. This plan also **mis-states the defect**: the stale answer is not appended
  after the fresh one; the fresh read is DISCARDED ENTIRELY (measured `['STALE-A']` against
  `['FRESH-B']`). Tests flipped to stale-first; the `reqRef` implementation is correct as written.
- **D-2769** (Task 17): `pwa/design/audit.mjs` is not in this plan's file table, and had to be
  edited: PR #96's `.term-histbar-word` sets a colour with no recoverable ground, so it entered the
  uncovered census D-2689 freezes and the whole-branch pass was red. Closed by MEASUREMENT, not by
  grandfathering — an `INHERITED_GROUNDS` entry naming `.term-histbar`'s own background, gate
  passing 12.32 dark / 10.41 light against a 4.5 floor. A first attempt using `GROUNDS` was
  correctly refused by the gate.
- **D-2771** (Task 8 / §5.3): this plan CONTRADICTS ITSELF about what a probe failure puts on the
  wire. Lines 1036-1038 dictate, verbatim, a `PaneHistoryReply` docstring saying the probe's
  `unreadable` vs `unparseable` vocabulary "rides in `detail`, which is what the drawer renders" —
  inherited from spec §5.3's "`unreadable`/`unparseable` → 502 with `detail`". Line 1391's "A note
  the implementer must not re-decide" then OVERRIDES it: the capture alone decides the status, and a
  probe that failed while the capture succeeded is a 200 with the three measured fields absent. The
  worker transcribed the earlier text faithfully, so the L0 contract shipped documenting the
  opposite of what the route does. Closed by correcting the docstring — the vocabulary is
  ADAPTER-LOCAL, sizing the capture and feeding wave 3's floor server-side, and deliberately does
  not reach the wire. **Spec §5.3 still carries the original sentence; wave 4's docs pass owns it.**

- **D-2770** (Task 16): `pwa/test/history-term-viewport.test.tsx`, the fake-`Terminal` wiring half
  of spec §11 ruling 11. This plan silently substituted a source scan for it — on the correct
  measurement that a REAL `Terminal`'s `viewportY` does not move under jsdom — and recorded
  "Departures: None", which is the departure. Ruled IN scope: the `vi.mock` isolation is necessary
  (the same control is RED against the real xterm and GREEN with the mock prepended) and the fake
  is faithful (xterm 6.0.0's `BufferService.scrollLines` clamp is byte-for-byte the fake's). It is
  complementary to the scan, not redundant.

---

## Review lenses

Three lenses for this wave, from spec §5.5. Three reviewers, one refute pass per finding on `sonnet@high`.

1. **tmux semantics** — `opus@high`. Every measured claim in a shipped comment re-measured on a private socket (`tmux -L ccrc-…`, killed after, and its socket file removed). Covers `resize-window`'s `manual` latch (F3), the reflow numbers now in `exec.ts` and `TerminalDrawer.tsx` (F1), the `list-panes` format string and both missing-target literals, and the `-J` row counts.
2. **xterm / React lifecycle** — `opus@high`. §5.4's correction table as a checklist, plus every listener paired with its removal: the live glass's pointer/touch pair, the history layer's pointer/touch pair, the two refit listeners added in Task 13, the `alive` latch's ordering against `dispose()`, and the glide's `cancelAnimationFrame`.
3. **SECURITY — escape-sequence replay. `opus`, effort `xhigh`. MANDATORY regardless of pool level** (untrusted-input path; this project's per-project routing carve-out). `capture-pane -e` preserves OSC/DCS/CSI from up to 2000 lines of model- and repo-controlled output and replays them into a SECOND emulator that has a real scrollback and its own configuration. The lens confirms the history terminal is opened with the live terminal's hardening — no clipboard addon, no proposed API, link handling identical — and that an unterminated DCS or an OSC 52 in the capture cannot act.

## Model routing

Per spec §9: **no task in this wave is one of the three opus-routed tasks** — all three of those (the `win-size` verb body, the whitelist entry + `REQUIRED_VERB_FLAG` + bypass fixture, and `_pane_measurable` with its sweep) are wave 2. Every task in this plan is **`sonnet`, effort `high`** (the brief says `/model sonnet`, `/effort high`). The coordinator runs on **`opus@high`**. Lens 3 above is the one mandatory `opus`/`xhigh` reviewer in this wave. Execution stays on the subscription; the handoff gate does not open.
