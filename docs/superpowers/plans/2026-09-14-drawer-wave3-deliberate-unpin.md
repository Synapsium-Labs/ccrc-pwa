# Terminal drawer, wave 3 — the deliberate un-pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a phone-width drawer narrow a session's tmux window — but only to a width the pane's own history can absorb without shedding a line, only through the verb wave 2 put on the fleet box, and only while every reader that would type into that pane is told the pane is unmeasured rather than idle.

**Architecture:** The decision is a pure L1 function (`server/src/pane/fit.ts`'s `fitFloor`) over wave 1's `PaneProbe`; the un-pin is an L2 port (`WindowSizer`, `server/src/pane/sizer.ts`) whose only adapter shells `ccd win-size` through `CCD_ARGV`/`runCcd` behind `capSupported(state, 'win-size-v1')`; the socket, the pty, the refcount and the single 30-second timer live in one L4 delivery module (`server/src/pane/drawer.ts`) that decides nothing. The mail lane gains one additive refusal token (`auto-continue-unmeasured`) and the PWA learns one additive server→client frame (`grid`, sent as a **binary** frame so pane output can never forge it).

**Tech Stack:** TypeScript (Node ≥ 22.13, ESM), Fastify + `@fastify/websocket` (`ws`), node-pty, vitest 4; React 18 + xterm 6.0.0 in the PWA, tested under jsdom with `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md` (wave 3 = §7 in full; §4's wave table; §9's routing)

---

## Global Constraints

Copied from this repo's `CLAUDE.md` and from the spec. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: `server`.** Wave 3 touches `server/`, `pwa/`, `shared/` **only**. It must not touch `ccd/`, `session-hook.sh`, `ccd/coordinator-skill/` or `agent/` — those are wave 2's, and they are AGENT-FIRST. Wave 3 may merge in any order but **does nothing** until wave 2 is on the fleet box: every un-pin is gated on `capSupported(state, 'win-size-v1')`, which answers `false` with no evidence.
- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts`. If node-floor's absolute assertion is red while the others are green, **RAISE engines — never lower them**.
- **No root `package.json`, no root runner. Four packages, each `"type":"module"`, run cd'd in:** `server/` `agent/` `pwa/` `shared/`. `shared/` is not a real package — its bare `"type":"module"` marker is load-bearing.

      cd server && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Run suites in the FOREGROUND, timeout ≥ 600000 ms.** Backgrounding hides a hang; the suites are load-sensitive.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.
- **Ring discipline** (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`): ring membership is a property of a file's IMPORTS, not its path. L0 `shared/*.ts` imports NOTHING (not even `node:*`). L1 policy = pure decisions, no `fs`/fastify/`reply`. L2 ports = interfaces + failure contracts, **declared BY THE CONSUMER**. L3 adapters — **an adapter may not narrow a distinction it received**. L4 delivery owns fastify/sockets/timers but is NOT allowed to DECIDE. L5 = `index.ts` only.
- **No overloaded null at a seam.** Two conditions a caller handles differently must not collapse to the same value; that's a defect, not style. `fitFloor`, `WindowSizer.unpin`, `PaneProbe` and `WindowWidthProbe` each keep their conditions apart.
- **Wire discipline — additive-only, absence-permits.** `FLEET_PROTO` stays 1 (`shared/api.ts`); do NOT bump it for a new field or for the `grid` frame (which is not a fleet frame at all). A newer peer must tolerate an older peer omitting a field, through a SINGLE reader per field.
- **Single-source-of-truth values are enumerated once and derived.** `server/test/single-definition.test.ts` text-scans `shared/`, `server/src/`, `pwa/src/`, `agent/src/` and fails the build on a 2nd copy of a definition's shape. Every constant this wave adds is defined once in `shared/api.ts` and imported everywhere else.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted or mutated, **measured before/after, not asserted in a comment**. Doctrine: "A comment is a request; a red suite is a mechanism." TDD red-first. Every task below ends with an explicit mutation check.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** `HOME` is the single isolation boundary the ccd suite relies on. Server tests get theirs from `testDeps(...)` (`server/test/helpers.ts`), which seeds a throwaway home via `mkTmp` and routes every exec through `guardRunner` — the agent's REAL `EXEC_WHITELIST`.
- **SAFETY, sacred:** never run `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore` against a live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units directly. Nothing in this wave needs any of them.
- **Workspace-branch discipline (worker skill clause 2):** commit on this workspace's own branch, never a separate feature branch — a feature branch wedges every close with `stale-tip`.
- **D-N numbers are ISSUED, never chosen.** See `## Deviations found` at the foot of this plan.
- **Model routing (spec §9):** the three opus@high implementation tasks §9 names are **all in wave 2** (the `win-size` verb body, the whitelist entry + `REQUIRED_VERB_FLAG` + bypass fixture, and `_pane_measurable`). **No task in this plan is one of them** — every task here is `sonnet@high` (`/model sonnet`, `/effort high`). The three review lenses in `## Review lenses` are `opus@high`.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `shared/api.ts` | Modify | L0 vocabulary: `CANONICAL_COLS`, `CANONICAL_ROWS`, `STALL_BUDGET_LINES`, `PaneGridReason`, `PaneGridFrame` (whose `narrowed?: true` is what makes the §7.6 notice gateable — spec §7.5, ruling 15). Imports nothing. |
| `server/src/pane/fit.ts` | **Create** | L1 policy, PURE: `fitFloor` (the §7.2 bound) and `measuredNum` (the ONE grid-number validator, shared by the query string and the `resize` frame). No I/O. |
| `server/src/pane/sizer.ts` | **Create** | The `WindowSizer` L2 port declared for the pty route, plus its one L3 adapter `ccdWindowSizer` (pin = `tmux resize-window`; unpin = `ccd win-size --mode smallest`, gated on `win-size-v1`). |
| `server/src/pane/drawer.ts` | **Create** | L4 delivery: the `PtySocket` port, the `DrawerRegistry` refcount, `attachDrawer` (the §7.1 flow + frames + the one §7.3 timer) and `bootSweep`. Decides nothing. |
| `server/src/exec.ts` | Modify (append to `class Tmux`) | Adds `windowWidth(id)` — `list-panes -F '#{window_width}'` as a measured read (`WindowWidthProbe`), for the boot sweep. |
| `server/src/server.ts` | Modify (the `/ws/pty/:id` block — `main`'s 1462-1491, and wave 1's latch comment adds ~25 lines inside it, so find it with `grep -n "ws/pty" server/src/server.ts` rather than trusting the number) | Builds the sizer, the registry and the drawer deps once, adapts the `ws` socket to `PtySocket`, validates `:id`, hands the socket to `attachDrawer`, and kicks the boot sweep. |
| `server/src/inject/send.ts` | Modify (the `SendResult` error union, 18-22; the head of the queued closure, ~498 — untouched by waves 1-2, so these are exact) | §7.4: the mail lane's `holdIfAutoContinueArmed` opt-in measures the pane's width first and refuses `auto-continue-unmeasured`. |
| `server/src/watch.ts` | Modify (~line 3046) | The sweep's back-off arm for the new token — held, not failed, exactly as `auto-continue-armed`. |
| `pwa/src/lib/api.ts` | Modify (`SEND_ERROR_TEXT`, ~line 51) | One sentence for `auto-continue-unmeasured`. |
| `pwa/src/session/TerminalDrawer.tsx` | Modify | Reads the binary `grid` control frame off the same socket and says why the view is the width it is (§7.5), plus the §7.6 automation notice. |
| `pwa/src/session/chat.css` | Modify (after the `.term-retry:active` rule — `main`'s 2215, ~2255 once wave 1's history-layer CSS is in; grep the selector) | The two note styles. |
| `server/test/pane-fit.test.ts` | **Create** | Pins `fitFloor`'s bound (including F13's `+ height` term), its reasons, and `measuredNum`. |
| `server/test/pane-sizer.test.ts` | **Create** | Pins the exact argv of both arms and the three `unpin` verdicts. |
| `server/test/pane-drawer.test.ts` | **Create** | Pins the attach flow, frame handling, refcount and the one timer (ping / terminate / re-check). |
| `server/test/pane-bootsweep.test.ts` | **Create** | Pins the boot sweep and `Tmux.windowWidth` — Task 6's own file, and Task 9 Step 3's `git diff --stat` expects to see it here. |
| `server/test/pty.test.ts` | Modify (add to the existing `describe`, **and update BOTH `it`s wave 1 leaves there**) | Pins the wiring end to end over a real websocket. |
| `server/test/send.test.ts` | Modify (`fakeTmux`, 39-52; new `describe`) | Pins §7.4. |
| `pwa/test/terminal-grid.test.tsx` | **Create** | Pins the frame split, the three sentences, the automation notice, and that pane OUTPUT cannot forge a frame. |

---

### Task 1: The wire vocabulary and the fit floor (L0 + L1, pure)

**Model routing:** `sonnet@high`.

**Files:**
- Modify: `shared/api.ts` — append the five definitions directly after the block wave 1/wave 2 added (find it with `grep -n 'READER_MIN_COLS' shared/api.ts`; if that grep is empty, see Step 0)
- Create: `server/src/pane/fit.ts`
- Test: `server/test/pane-fit.test.ts` (new)

**Interfaces:**
- Consumes (from wave 1, `shared/api.ts`): `PaneProbe` = `{ ok: true; history: number; limit: number; width: number; height: number; alternate: boolean } | { ok: false; reason: 'gone' } | { ok: false; reason: 'unreadable'; detail: string } | { ok: false; reason: 'unparseable'; detail: string }`
- Consumes (from wave 2, `shared/api.ts`): `READER_MIN_COLS: number` (used by Tasks 7 and 8, not here)
- Produces: `CANONICAL_COLS = 220`, `CANONICAL_ROWS = 50`, `STALL_BUDGET_LINES = 6000`, `type PaneGridReason = 'history-too-small' | 'stall-budget' | 'unmeasured'`, `interface PaneGridFrame { type: 'grid'; cols: number; rows: number; reason?: PaneGridReason; narrowed?: true }` (all in `shared/api.ts`); `interface FitFloor { cols: number; reason?: PaneGridReason }`, `function fitFloor(probe: PaneProbe, clientCols: number): FitFloor`, `function measuredNum(v: unknown): number | null` (all in `server/src/pane/fit.ts`)

**One spec sentence resolved before any code is written.** §7.2 ends: *"An unmeasurable probe → floor
= `width` (no un-pin), reason `unmeasured`."* Those two halves cannot both be read literally, because
a failed `PaneProbe` **carries no `width`** — `{ ok: false; reason: 'gone' }` has no such field, by
construction (wave 1 kept the failure arms free of numbers nobody measured). So one half is the rule
and the other is shorthand for it:

- **THE RULE IS "no un-pin."** That is the clause of §3 this branch of `fitFloor` exists to serve, and
  it is what §7.7 lens 3 audits.
- **`width` is shorthand for "the width the window is already at", and this plan spells that number
  `CANONICAL_COLS`.** It is not a guess: §5.1's latch has just pinned this window to `220x50` *before*
  the probe was taken (§7.1's flow, `pin(id)` on the line above `probe = paneProbe(id)`), so the
  window's width at the moment the floor is computed is `CANONICAL_COLS` whether or not tmux would
  say so. Returning it is therefore returning `width` — and it is the value that GUARANTEES the rule,
  because a floor of 220 is `> clientCols` for every drawer narrow enough to want an un-pin.
- The guarantee does not rest on the number alone. `attachDrawer`'s un-pin condition carries a
  separate `probe.ok &&` term (Task 3), and Task 3's case *"a WIDE client on an unmeasurable pane
  still does not un-pin"* exists precisely to prove that term is load-bearing rather than decorative —
  a 220-column client makes `floor.cols <= clientCols` true, and the answer must still be "pinned".

This is a reading of §7.2, not a departure from it, so it mints no `D-N`. If a reviewer disagrees and
calls it a departure, that is a number to issue at review time — not one to write here.

- [ ] **Step 0: Confirm the two upstream waves landed on this branch**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -n 'PaneProbe\|PANE_HISTORY_LINES\|READER_MIN_COLS' shared/api.ts
grep -n 'paneProbe' server/src/exec.ts
grep -n 'winSize' server/src/ccdargv.ts
grep -n 'WIN_SIZE_CAP' server/src/ccdargv.ts
```

Expected: `PaneProbe` and `PANE_HISTORY_LINES` present (wave 1), `READER_MIN_COLS` present (wave 2), `Tmux.paneProbe` present (wave 1), `CCD_ARGV.winSize` and `WIN_SIZE_CAP` present (wave 2).

If `READER_MIN_COLS` is missing, wave 2 is not merged here: **stop and report to the coordinator** — Tasks 7 and 8 cannot be written against a constant that does not exist. If only `CCD_ARGV.winSize`/`WIN_SIZE_CAP` are missing (wave 2's ccd/agent half merged but its server-side argv did not), Task 2 Step 0 adds them with exact code.

- [ ] **Step 1: Write the failing test**

Create `server/test/pane-fit.test.ts`:

```ts
// The fit floor (design 2026-09-14 §7.2) and the ONE grid-number validator
// (§7.3). Both are L1 and pure: every case here is a literal in, a literal out.
import { describe, it, expect } from 'vitest';
import { fitFloor, measuredNum } from '../src/pane/fit.js';
import { CANONICAL_COLS, STALL_BUDGET_LINES } from '../../shared/api.js';
import type { PaneProbe } from '../../shared/api.js';

type Measured = Extract<PaneProbe, { ok: true }>;
const ok = (o: Partial<Measured> = {}): PaneProbe =>
  ({ ok: true, history: 0, limit: 2000, width: 220, height: 50, alternate: true, ...o });

describe('fitFloor', () => {
  it('lets a phone have its own width when the pane has nothing to shed', () => {
    // need(43) = (0 + 50) * ceil(220/43) = 50 * 6 = 300 <= 2000.
    expect(fitFloor(ok({ history: 0 }), 43)).toEqual({ cols: 43 });
  });

  it('counts the VISIBLE SCREEN, not just the history (F13)', () => {
    // history alone passes at 43: 330 * 6 = 1980 <= 2000.
    // with the screen it does not: (330 + 50) * 6 = 2280 > 2000.
    // smallest W with 380 * ceil(220/W) <= 2000 is 44 (ceil(220/44) = 5, 1900).
    expect(fitFloor(ok({ history: 330 }), 43)).toEqual({ cols: 44, reason: 'history-too-small' });
  });

  it('names the stall budget when the budget, not the pane limit, is what binds (F10)', () => {
    // budget = min(20000, 6000) = 6000. need(W) = 2050 * ceil(220/W).
    // W = 110 -> 2050 * 2 = 4100 <= 6000; W = 109 -> 2050 * 3 = 6150 > 6000.
    expect(STALL_BUDGET_LINES).toBe(6000);
    expect(fitFloor(ok({ history: 2000, limit: 20000 }), 43))
      .toEqual({ cols: 110, reason: 'stall-budget' });
  });

  it('never manufactures a reason for a client that is already at least as wide as the pane', () => {
    // history + height (2050) is over the limit (2000), but at the pane's own
    // width nothing reflows, so there is nothing to refuse.
    expect(fitFloor(ok({ history: 2000, limit: 2000 }), 220)).toEqual({ cols: 220 });
    expect(fitFloor(ok({ history: 2000, limit: 2000 }), 400)).toEqual({ cols: 220 });
  });

  it('refuses to narrow at all when even the pane\'s own width is over budget', () => {
    expect(fitFloor(ok({ history: 2000, limit: 2000 }), 43))
      .toEqual({ cols: 220, reason: 'history-too-small' });
  });

  it.each<PaneProbe>([
    { ok: false, reason: 'gone' },
    { ok: false, reason: 'unreadable', detail: 'server exited' },
    { ok: false, reason: 'unparseable', detail: 'no active row' },
  ])('an unmeasurable probe holds the canonical grid and says so: %o', (probe) => {
    expect(fitFloor(probe, 43)).toEqual({ cols: CANONICAL_COLS, reason: 'unmeasured' });
  });

  it('the alternate screen is neither a permit nor a refusal (F9)', () => {
    const on = fitFloor(ok({ history: 330, alternate: true }), 43);
    const off = fitFloor(ok({ history: 330, alternate: false }), 43);
    expect(on).toEqual(off);
  });
});

describe('measuredNum', () => {
  it.each([
    ['43', 43], ['43.9', 43], [43, 43], [43.9, 43], ['220', 220],
  ])('measures %o as %o', (v, want) => { expect(measuredNum(v)).toBe(want); });

  it.each([
    ['0'], ['-5'], ['abc'], [''], ['  '], [undefined], [null], [0], [-1],
    [Number.NaN], [Number.POSITIVE_INFINITY], [true], [{}], [[]],
  ])('answers null, not a default, for %o', (v) => { expect(measuredNum(v)).toBeNull(); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (foreground, timeout 600000):

```bash
cd server && ./node_modules/.bin/vitest run test/pane-fit.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/pane/fit.js" from "test/pane-fit.test.ts"`, and `"CANONICAL_COLS" is not exported by "../shared/api.ts"`.

- [ ] **Step 3: Write the minimal implementation**

Append to `shared/api.ts`, directly after the `READER_MIN_COLS` / `PANE_HISTORY_LINES` block:

```ts
/** The grid ccd spawns every session with (`_tmux_new_session … -x 220 -y 50`,
 *  `ccd/ccd`), and therefore the PINNED state the 2026-09-14 design's §3 names.
 *  Spelled ONCE here: `server.ts`'s close path, `pane/fit.ts`, `pane/sizer.ts`
 *  and `pane/drawer.ts` all read it from this definition rather than repeating
 *  the literal. The bash side keeps its own copy by construction — a shell
 *  cannot import TS — and `ccd win-size --mode canonical` is the arm carrying
 *  it there. */
export const CANONICAL_COLS = 220;
export const CANONICAL_ROWS = 50;

/** The ceiling on how many lines a narrow-then-widen round trip may reflow, and
 *  so on how long the SINGLE-THREADED tmux server is unavailable to every other
 *  session it serves. Design F10: reflow is ~linear in the reflowed line count —
 *  300/714 ms at 11951 lines, 455/1230 ms at 19951 — so 6000 caps a round trip
 *  near half a second. F12's census says today's fleet never approaches it. */
export const STALL_BUDGET_LINES = 6000;

/** Why the server chose a grid the client did not ask for. ABSENT means the
 *  client's own grid was honoured — deliberately NOT spelled as a fourth token,
 *  because a reader that has to tell 'none' from 'ok' is one distinction away
 *  from a bug. */
export type PaneGridReason = 'history-too-small' | 'stall-budget' | 'unmeasured';

/** server -> client on `/ws/pty/:id`. Sent as a BINARY frame while the pane's
 *  own output stays a TEXT frame, so a session that prints this exact JSON into
 *  its pane cannot forge one (the pane carries model- and repo-controlled text).
 *  ADDITIVE: `FLEET_PROTO` stays 1 — this is not a fleet frame at all — and a
 *  PWA predating it drops an unknown binary frame. */
export interface PaneGridFrame {
  type: 'grid';
  cols: number;
  rows: number;
  reason?: PaneGridReason;
  /** The window ACTUALLY FOLLOWED this grid — `sizer.unpin` answered `'ok'`,
   *  so tmux is under `window-size smallest` and ccd's readers are standing
   *  down (§7.4, §7.5, ruling 15). ABSENT means the window is still pinned at
   *  the canonical grid: the agent has no `win-size-v1` (`'unsupported'`), or
   *  the verb failed (`'failed'`). `cols` cannot carry this — it is the PTY's
   *  width, sent on every attach whether or not the window followed it — and a
   *  §7.6 notice gated on `cols` alone tells a phone its automation is paused
   *  in exactly the window that must stay wave-1-identical. Spelled `?: true`
   *  rather than `: boolean` so the absent case has ONE spelling on the wire
   *  and an older server's silence reads as "not narrowed", which it is. */
  narrowed?: true;
}
```

Create `server/src/pane/fit.ts`:

```ts
// L1 POLICY, PURE. No `fs`, no fastify, no sockets, no timers — every export
// here is a literal in, a literal out, which is what makes the whole §7.2
// argument testable without a tmux anywhere. Design:
// docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md §7.2, §7.3.
import type { PaneGridReason, PaneProbe } from '../../../shared/api.js';
import { CANONICAL_COLS, STALL_BUDGET_LINES } from '../../../shared/api.js';

/** The narrowest width this pane may be shown at, and — only when that is wider
 *  than the client asked for — why. `reason` absent means the client got what it
 *  asked for; it is never `'ok'`. */
export interface FitFloor {
  cols: number;
  reason?: PaneGridReason;
}

/**
 * The smallest width W in [clientCols, width] whose reflow the pane can absorb.
 *
 *   need(W) = (history + height) * ceil(width / W)
 *
 * The `+ height` is F13 and it is not decoration: at its own PERMIT boundary a
 * bound of `history * ceil(width/W)` approved a narrow that put the pane 252
 * lines over its limit and destroyed 200 logical lines on the next scroll. The
 * visible screen reflows into the history too.
 *
 * The budget is `min(limit, STALL_BUDGET_LINES)` — the pane's own history-limit
 * is what sheds lines (F1), the stall budget is what holds the single-threaded
 * tmux server hostage (F10), and whichever is smaller binds. `reason` names
 * which one did, so the drawer can say something true.
 *
 * `alternate_on` is NEITHER a permit nor a refusal (F9): while the alternate
 * screen is up a resize does not reflow (6 ms vs 63 ms) — but the reflow is
 * DEFERRED, and lands at alt-exit at exactly this size (measured 1852 -> 11359
 * in one step). Nothing scrolls into history while the alt screen is up, so the
 * numbers at attach ARE the numbers that will reflow. Which is why this function
 * never reads the field.
 */
export function fitFloor(probe: PaneProbe, clientCols: number): FitFloor {
  // Nothing was measured, so nothing may be narrowed: hold the canonical grid
  // the route just pinned, and say that it is a measurement failure rather than
  // a history that does not fit. Three probe failures, one answer HERE — but
  // the three are still distinct at the seam that produced them (`PaneProbe`),
  // which is where a caller that needs them apart can still tell them apart.
  //
  // §7.2 words this as "floor = `width` (no un-pin)". A FAILED probe carries no
  // `width` — the failure arms hold no numbers nobody measured — so the rule is
  // the parenthesis and `width` is shorthand for "the width the window is
  // already at". §7.1 pins this window to the canonical grid on the line ABOVE
  // the probe, so that width is `CANONICAL_COLS`, and returning it is what
  // makes "no un-pin" true by arithmetic: 220 is above every clientCols narrow
  // enough to be asking. The route's own `probe.ok &&` term refuses in the same
  // breath, so neither guard is carrying this alone.
  if (!probe.ok) return { cols: CANONICAL_COLS, reason: 'unmeasured' };

  const { history, limit, width, height } = probe;
  // The client is already at least as wide as the pane: no reflow is being
  // asked for, so nothing can be shed and there is nothing to refuse. Returning
  // a reason here would be reporting a hazard that this attach cannot cause.
  if (clientCols >= width) return { cols: width };

  const budget = Math.min(limit, STALL_BUDGET_LINES);
  const bound: PaneGridReason = limit <= STALL_BUDGET_LINES ? 'history-too-small' : 'stall-budget';
  const need = (w: number): number => (history + height) * Math.ceil(width / w);

  // need() is non-increasing in W, so the first W that fits is the smallest.
  for (let w = Math.max(1, clientCols); w <= width; w++) {
    if (need(w) <= budget) {
      return w <= clientCols ? { cols: w } : { cols: w, reason: bound };
    }
  }
  // Not even the pane's own width is inside the budget — refuse to narrow at all.
  return { cols: width, reason: bound };
}

/**
 * The ONE validator for a grid number, shared by `/ws/pty/:id`'s query string
 * and its `resize` frames (§7.3). Answers `null` for "not a measured number" —
 * a single condition, which each caller then answers in its own way: the query
 * string substitutes its default, a `resize` frame is dropped whole and leaves
 * the pty and the grid untouched.
 *
 * Accepts the string form because a query string has no other form, and the
 * number form because a JSON frame does.
 */
export function measuredNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-fit.test.ts
```

Expected: PASS, 7 `fitFloor` cases + 2 `measuredNum` cases (19 assertions across the two `it.each` tables).

Then the neighbour that scans every source root for a second copy of a definition:

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```

Expected: PASS. If it goes red naming one of the five new definitions, a copy of that shape already exists under one of the four roots — report it as a single-definition collision for the operator to mint a number for; **do not weaken the scan**.

- [ ] **Step 5: Mutation check, then commit**

Temporarily delete the `+ height` from `need`'s body in `server/src/pane/fit.ts` (leaving `history * Math.ceil(width / w)`) and re-run `./node_modules/.bin/vitest run test/pane-fit.test.ts`: the case **"counts the VISIBLE SCREEN, not just the history (F13)"** must FAIL with `expected { cols: 43 } to deeply equal { cols: 44, reason: 'history-too-small' }`. Restore it.

Then change `measuredNum`'s `n > 0` to `n >= 0` and re-run: the `measuredNum` table must FAIL on `'0'` and `0`. Restore it.

```bash
cd "$(git rev-parse --show-toplevel)"
git add shared/api.ts server/src/pane/fit.ts server/test/pane-fit.test.ts
git commit -m "$(cat <<'MSG'
feat(pane): the fit floor and the grid vocabulary (wave 3, spec §7.2/§7.3)

fitFloor is L1 and pure: (history + height) * ceil(width/W) against
min(limit, STALL_BUDGET_LINES), F13's screen term included, and a reason
that names which term bound it. measuredNum is the one grid-number
validator the query string and the resize frames will share.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The `WindowSizer` port and its ccd adapter

**Model routing:** `sonnet@high`.

**Files:**
- Create: `server/src/pane/sizer.ts`
- Modify (only if Task 1 Step 0 found them missing): `server/src/ccdargv.ts`, `server/test/whitelist-subset.test.ts`
- Test: `server/test/pane-sizer.test.ts` (new)

**Interfaces:**
- Consumes: `Tmux.resizeWindow(id: string, cols: number, rows: number): Promise<boolean>` (`server/src/exec.ts`); `CCD_ARGV.winSize(id: string, mode: 'smallest' | 'canonical'): CcdArgv` and `WIN_SIZE_CAP = 'win-size-v1'` and `capSupported(state: Pick<FleetState,'ccdVerbs'> | undefined, token: string): boolean` (`server/src/ccdargv.ts`); `CcdResult { ok: boolean; stdout: string; stderr: string; killed; signal }` (`server/src/lifecycle.ts`); `CANONICAL_COLS`, `CANONICAL_ROWS` (Task 1)
- Produces: `interface WindowSizer { pin(id: string): Promise<void>; unpin(id: string): Promise<'ok' | 'unsupported' | 'failed'> }`; `interface SizerDeps { tmux: Tmux; runCcd: (argv: CcdArgv) => Promise<CcdResult>; fleetState?: FleetState; log: (line: string) => void }`; `function ccdWindowSizer(d: SizerDeps): WindowSizer`

- [ ] **Step 0: If wave 2 left the server-side argv unbuilt, build it**

Only if Task 1 Step 0 found `CCD_ARGV.winSize` or `WIN_SIZE_CAP` missing. In `server/src/ccdargv.ts`, beside `POOLS_CAP`:

```ts
/** Wave 2's cap: `ccd caps` prints it only on a ccd that has BOTH the
 *  `win-size` verb and §6.3's reader stand-down, so seeing it is proof of both.
 *  Gated with `capSupported` (null -> REFUSE), never `verbSupported` (null ->
 *  permit) — permit-by-default is right for a verb that always existed and
 *  wrong for one that never did. */
export const WIN_SIZE_CAP = 'win-size-v1';
```

and inside the `export const CCD_ARGV = {` object, beside `coordPause`:

```ts
  winSize: (id: string, mode: 'smallest' | 'canonical') =>
    argv(['win-size', '--session', id, '--mode', mode]),
```

and in `server/test/whitelist-subset.test.ts`'s `SAMPLES` record:

```ts
  winSize: ['demo-quiet-basin', 'smallest'],
```

Then run `./node_modules/.bin/vitest run test/whitelist-subset.test.ts` from `server/` — it must PASS. If it fails with "every ccd prefix the agent grants is reachable from some CCD_ARGV entry" or with `argv not in the agent EXEC_WHITELIST: ccd win-size …`, wave 2's **agent** half is not on this branch either: stop and report to the coordinator. Wave 3 must not add a grant to `agent/src/whitelist.ts` — that file is wave 2's and is AGENT-FIRST.

- [ ] **Step 1: Write the failing test**

Create `server/test/pane-sizer.test.ts`:

```ts
// The WindowSizer port's one adapter (design §7.1, §6.1). Every exec here
// crosses the agent's REAL EXEC_WHITELIST first — `testDeps` wraps the runner
// in `guardRunner` — so an argv this adapter builds that the fleet would refuse
// throws here rather than shipping.
import { describe, it, expect } from 'vitest';
import { ccdWindowSizer } from '../src/pane/sizer.js';
import { CANONICAL_COLS, CANONICAL_ROWS } from '../../shared/api.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';

const ID = 'claude2-mekwarlive';

const sizerOn = (verbs: string[] | null, run: Runner) => {
  const calls: string[][] = [];
  const logged: string[] = [];
  const recording: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return run(cmd, args); };
  const d = testDeps(undefined, recording);
  const sizer = ccdWindowSizer({
    tmux: d.tmux,
    runCcd: d.runCcd,
    fleetState: { connected: true, downSince: null, ccdVerbs: verbs, rosterFp: null, build: null },
    log: (l) => logged.push(l),
  });
  return { sizer, calls, logged };
};

const okRun: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
const failRun: Runner = async () => ({ code: 1, stdout: '', stderr: 'ccd: bad id: x' });

describe('ccdWindowSizer.pin', () => {
  it('is the already-granted tmux resize-window at the canonical grid', async () => {
    const { sizer, calls } = sizerOn(['win-size-v1'], okRun);
    await sizer.pin(ID);
    expect(calls).toEqual([
      ['tmux', 'resize-window', '-t', `cc-${ID}`, '-x', String(CANONICAL_COLS), '-y', String(CANONICAL_ROWS)],
    ]);
  });

  it('does not run ccd at all — the pin works against an agent of any age', async () => {
    const { sizer, calls } = sizerOn(null, okRun);
    await sizer.pin(ID);
    expect(calls.some((c) => c[0] !== 'tmux')).toBe(false);
  });

  it('says so when the pin fails, rather than swallowing it into the void return', async () => {
    const { sizer, logged } = sizerOn(['win-size-v1'], failRun);
    await sizer.pin(ID);
    expect(logged.join('\n')).toContain(ID);
    expect(logged.join('\n')).toMatch(/pin/i);
  });
});

describe('ccdWindowSizer.unpin', () => {
  it('runs `ccd win-size --session <id> --mode smallest` and answers ok', async () => {
    const { sizer, calls } = sizerOn(['win-size-v1'], okRun);
    expect(await sizer.unpin(ID)).toBe('ok');
    const ccdCalls = calls.filter((c) => c[1] === 'win-size');
    expect(ccdCalls).toHaveLength(1);
    expect(ccdCalls[0]!.slice(1)).toEqual(['win-size', '--session', ID, '--mode', 'smallest']);
  });

  it('answers unsupported, and runs NOTHING, when the cap is absent', async () => {
    const { sizer, calls } = sizerOn(['stop-surface', 'pools-v1'], okRun);
    expect(await sizer.unpin(ID)).toBe('unsupported');
    expect(calls).toEqual([]);
  });

  it('answers unsupported on NO EVIDENCE — capSupported, never verbSupported', async () => {
    const { sizer, calls } = sizerOn(null, okRun);
    expect(await sizer.unpin(ID)).toBe('unsupported');
    expect(calls).toEqual([]);
  });

  it('answers failed — a refused verb is not an absent one, and the route treats them differently', async () => {
    const { sizer } = sizerOn(['win-size-v1'], failRun);
    expect(await sizer.unpin(ID)).toBe('failed');
  });

  it('never narrows its three verdicts to a boolean or a null', async () => {
    const seen = new Set<string>();
    seen.add(await sizerOn(['win-size-v1'], okRun).sizer.unpin(ID));
    seen.add(await sizerOn(['win-size-v1'], failRun).sizer.unpin(ID));
    seen.add(await sizerOn(null, okRun).sizer.unpin(ID));
    expect([...seen].sort()).toEqual(['failed', 'ok', 'unsupported']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-sizer.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/pane/sizer.js" from "test/pane-sizer.test.ts"`.

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/pane/sizer.ts`:

```ts
// The window-sizing seam.
//
// `WindowSizer` is an L2 PORT and it is declared BY ITS CONSUMER — the pty
// route (`pane/drawer.ts`, `server.ts`) — which is why it says nothing about
// tmux or ccd: it names the two things the route needs done and the conditions
// it is prepared to handle. `ccdWindowSizer` below is its one L3 adapter.
//
// The two arms deliberately travel different paths. `pin` is the already-granted
// raw `tmux resize-window` (design §5.1/§6.1): it works against an agent of ANY
// age, which is what lets wave 3 ship before — or without — wave 2 reaching the
// fleet box. `unpin` is the new `ccd win-size` verb and is gated on the cap that
// ccd advertises together with §6.3's reader stand-down, so a server that sees
// the cap knows the readers on that box already yield to a narrow pane.
import type { CcdArgv } from '../ccdargv.js';
import { CCD_ARGV, capSupported, WIN_SIZE_CAP } from '../ccdargv.js';
import type { Tmux } from '../exec.js';
import type { FleetState } from '../fleetstate.js';
import type { CcdResult } from '../lifecycle.js';
import { CANONICAL_COLS, CANONICAL_ROWS } from '../../../shared/api.js';

export interface WindowSizer {
  /** Latch `window-size manual` at the canonical grid (F3). Idempotent. */
  pin(id: string): Promise<void>;
  /**
   * Un-latch, so tmux follows the NARROWEST attached client (`smallest`, F5 —
   * deterministic, keystroke-stable, self-healing when that client leaves;
   * never `latest`, F4).
   *
   * Three conditions the route handles differently, and deliberately not a
   * boolean or a null: `'unsupported'` = the fleet box has no such verb, so the
   * window stays pinned and there is nothing to say; `'failed'` = the verb was
   * there and refused, which is worth a log line; `'ok'` = tmux now follows the
   * pty.
   */
  unpin(id: string): Promise<'ok' | 'unsupported' | 'failed'>;
}

export interface SizerDeps {
  tmux: Tmux;
  /** The ONLY path to ccd (`Deps.runCcd`). There is deliberately no raw
   *  `Runner` here — a `win-size` argv can only be built by `ccdargv.ts`. */
  runCcd: (argv: CcdArgv) => Promise<CcdResult>;
  fleetState?: FleetState;
  log: (line: string) => void;
}

export function ccdWindowSizer(d: SizerDeps): WindowSizer {
  return {
    async pin(id: string): Promise<void> {
      // `resizeWindow` answers a boolean and the port answers void, so the
      // distinction is SPOKEN here rather than dropped — an adapter may not
      // narrow a distinction it received. The port stays void because no caller
      // acts on a failed pin differently: the window is already as wrong as it
      // can be and the boot sweep will find it again.
      const pinned = await d.tmux.resizeWindow(id, CANONICAL_COLS, CANONICAL_ROWS);
      if (!pinned) {
        d.log(`pane/sizer: pin failed for ${id} — its window may be off the canonical `
          + `${CANONICAL_COLS}x${CANONICAL_ROWS} grid until the next boot sweep`);
      }
    },
    async unpin(id: string): Promise<'ok' | 'unsupported' | 'failed'> {
      // `capSupported` (no evidence -> REFUSE), never `verbSupported` (no
      // evidence -> permit): permit-by-default is correct only for a verb that
      // has always existed. An un-upgraded agent simply leaves the window
      // pinned — wave 1 behaviour, no fallback path, no second mechanism.
      if (!capSupported(d.fleetState, WIN_SIZE_CAP)) return 'unsupported';
      const r = await d.runCcd(CCD_ARGV.winSize(id, 'smallest'));
      return r.ok ? 'ok' : 'failed';
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-sizer.test.ts test/whitelist-subset.test.ts
```

Expected: PASS, both files.

- [ ] **Step 5: Mutation check, then commit**

Change `capSupported` to `verbSupported` in `unpin` (and its import) and re-run `./node_modules/.bin/vitest run test/pane-sizer.test.ts`: **"answers unsupported on NO EVIDENCE"** must FAIL with `expected 'ok' to be 'unsupported'`. Restore it.

Then delete the `if (!pinned)` block and re-run: **"says so when the pin fails"** must FAIL with `expected '' to contain 'claude2-mekwarlive'`. Restore it.

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/pane/sizer.ts server/test/pane-sizer.test.ts server/src/ccdargv.ts server/test/whitelist-subset.test.ts
git commit -m "$(cat <<'MSG'
feat(pane): the WindowSizer port and its ccd adapter (wave 3, spec §7.1)

pin is the already-granted tmux resize-window at 220x50 and works against
an agent of any age; unpin is `ccd win-size --mode smallest` behind
capSupported(state, 'win-size-v1') — no evidence REFUSES. Three verdicts,
never a boolean and never a null.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The drawer registry, the socket port, and the attach flow

**Model routing:** `sonnet@high`.

**Files:**
- Create: `server/src/pane/drawer.ts`
- Test: `server/test/pane-drawer.test.ts` (new)

**Interfaces:**
- Consumes: `fitFloor`, `measuredNum`, `FitFloor` (Task 1); `WindowSizer` (Task 2); `Tmux.paneProbe(id: string): Promise<PaneProbe>` (wave 1); `KeyedQueue.run<T>(key: string, fn: () => Promise<T>): Promise<T>` (`server/src/inject/queue.ts`); `SpawnPty = (id: string, cols: number, rows: number) => PtyLike` and `PtyLike { onData(l): {dispose()}; write(d); resize(c,r); kill() }` (`server/src/pty.ts`); `CANONICAL_COLS`, `PaneGridFrame` (Task 1)
- Produces: `DRAWER_DEFAULT_COLS = 80`, `DRAWER_DEFAULT_ROWS = 24`, `RE_CHECK_MS = 30_000`, `MISSED_PONGS_MAX = 2`; `interface PtySocket`; `class DrawerRegistry` with `add(id, s): void`, `remove(id, s): number`, `count(id): number`; `interface DrawerDeps { tmux; queue; spawnPty; sizer; log }`; `function attachDrawer(d: DrawerDeps, reg: DrawerRegistry, socket: PtySocket, id: string, clientCols: number, clientRows: number): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `server/test/pane-drawer.test.ts`:

```ts
// The attach flow (design §7.1) and the frames (§7.3), driven directly against
// the L4 module — no fastify, no real socket. The timer half of §7.3 is added
// by Task 4 in this same file.
import { describe, it, expect, vi } from 'vitest';
import { attachDrawer, DrawerRegistry, DRAWER_DEFAULT_COLS, type DrawerDeps, type PtySocket } from '../src/pane/drawer.js';
import type { WindowSizer } from '../src/pane/sizer.js';
import { CANONICAL_COLS } from '../../shared/api.js';
import type { PaneProbe } from '../../shared/api.js';
import type { PtyLike } from '../src/pty.js';
import { Tmux, type Runner } from '../src/exec.js';
import { KeyedQueue } from '../src/inject/queue.js';

const ID = 'claude2-mekwarlive';

/** Stub in place of node-pty: records writes/resizes/kill, emits nothing. */
class StubPty implements PtyLike {
  written: string[] = [];
  resized: Array<{ cols: number; rows: number }> = [];
  killed = false;
  disposed = 0;
  private listener: ((d: string) => void) | null = null;
  onData(l: (d: string) => void): { dispose(): void } {
    this.listener = l;
    return { dispose: () => { this.disposed++; } };
  }
  emit(d: string): void { this.listener?.(d); }
  write(d: string): void { this.written.push(d); }
  resize(cols: number, rows: number): void { this.resized.push({ cols, rows }); }
  kill(): void { this.killed = true; }
}

/** A PtySocket a test can drive: records what the server sent, fires callbacks. */
class FakeSocket implements PtySocket {
  text: string[] = [];
  binary: string[] = [];
  pings = 0;
  terminated = 0;
  closes: Array<{ code?: number; reason?: string }> = [];
  private msg: ((raw: unknown) => void) | null = null;
  private closed: (() => void) | null = null;
  private pong: (() => void) | null = null;
  send(data: string | Uint8Array, opts?: { binary?: boolean }): void {
    if (typeof data === 'string' && opts?.binary !== true) this.text.push(data);
    else this.binary.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
  }
  ping(): void { this.pings++; }
  terminate(): void { this.terminated++; this.closed?.(); }
  close(code?: number, reason?: string): void { this.closes.push({ code, reason }); this.closed?.(); }
  onMessage(cb: (raw: unknown) => void): void { this.msg = cb; }
  onClose(cb: () => void): void { this.closed = cb; }
  onPong(cb: () => void): void { this.pong = cb; }
  deliver(frame: unknown): void { this.msg?.(JSON.stringify(frame)); }
  deliverRaw(raw: string): void { this.msg?.(raw); }
  pongBack(): void { this.pong?.(); }
  hangUp(): void { this.closed?.(); }
  frames(): Array<Record<string, unknown>> {
    return this.binary.map((b) => JSON.parse(b) as Record<string, unknown>);
  }
}

const measured = (o: Partial<Extract<PaneProbe, { ok: true }>> = {}): string => {
  const p = { history: 0, limit: 2000, width: 220, height: 50, alternate: true, ...o };
  return `1 ${p.history} ${p.limit} ${p.width} ${p.height} ${p.alternate ? 1 : 0}\n`;
};

const harness = (opts: { probe?: string; unpin?: 'ok' | 'unsupported' | 'failed' } = {}) => {
  const tmuxCalls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    tmuxCalls.push([cmd, ...args]);
    if (args[0] === 'list-panes') return { code: 0, stdout: opts.probe ?? measured(), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const order: string[] = [];
  const ptys: StubPty[] = [];
  const sizer: WindowSizer = {
    pin: async (id) => { order.push(`pin:${id}`); },
    unpin: async (id) => { order.push(`unpin:${id}`); return opts.unpin ?? 'ok'; },
  };
  const logged: string[] = [];
  const d: DrawerDeps = {
    tmux: new Tmux(run),
    queue: new KeyedQueue(),
    spawnPty: (id, cols, rows) => {
      order.push(`spawn:${id}:${cols}x${rows}`);
      const p = new StubPty();
      ptys.push(p);
      return p;
    },
    sizer,
    log: (l) => logged.push(l),
  };
  return { d, reg: new DrawerRegistry(), order, ptys, logged, tmuxCalls };
};

describe('attachDrawer — the §7.1 flow', () => {
  it('pins, probes, spawns at the floor, THEN un-pins, and says what grid it gave', async () => {
    const h = harness();                               // empty history -> 43 fits
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 43, 20);
    expect(h.order).toEqual([`pin:${ID}`, `spawn:${ID}:43x20`, `unpin:${ID}`]);
    // `narrowed` is the un-pin's own receipt (§7.5): the window FOLLOWED this
    // grid. Task 8 gates the automation notice on it, so a frame that omitted
    // it here would make the drawer silent on the one path where the notice is
    // true — and a frame that carried it unconditionally would make the drawer
    // lie on the three paths where it is not.
    expect(s.frames()).toEqual([{ type: 'grid', cols: 43, rows: 20, narrowed: true }]);
  });

  it('spawns at the FLOOR, not the client\'s width, and names the reason when they differ', async () => {
    const h = harness({ probe: measured({ history: 330 }) });   // floor 44 (F13)
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 43, 20);
    expect(h.order).toEqual([`pin:${ID}`, `spawn:${ID}:44x20`]);   // NO un-pin
    expect(s.frames()).toEqual([{ type: 'grid', cols: 44, rows: 20, reason: 'history-too-small' }]);
  });

  it('never un-pins on an unmeasurable probe, and holds the canonical grid', async () => {
    const h = harness({ probe: '' });                  // no active row -> unparseable
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 43, 20);
    expect(h.order).toEqual([`pin:${ID}`, `spawn:${ID}:${CANONICAL_COLS}x20`]);
    expect(s.frames()).toEqual([{ type: 'grid', cols: CANONICAL_COLS, rows: 20, reason: 'unmeasured' }]);
  });

  it('a WIDE client on an unmeasurable pane still does not un-pin', async () => {
    // The floor is CANONICAL_COLS here, so `floor.cols <= clientCols` is TRUE
    // for a 220-column client — `probe.ok` is the only term still refusing, and
    // this is the case that proves it is load-bearing rather than decorative.
    const h = harness({ probe: '' });
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 220, 50);
    expect(h.order).toEqual([`pin:${ID}`, `spawn:${ID}:${CANONICAL_COLS}x50`]);
    expect(s.frames()).toEqual([{ type: 'grid', cols: CANONICAL_COLS, rows: 50, reason: 'unmeasured' }]);
  });

  it('an unsupported un-pin is silent, a FAILED one is logged, and NEITHER claims the window narrowed', async () => {
    // The `narrowed` half is §7.5 / ruling 14, and it is what keeps wave 3
    // INERT until wave 2 is on the fleet box: against an agent with no
    // `win-size-v1` the window is still pinned at the canonical grid, ccd's
    // readers are NOT standing down and §7.4's hold does not apply, so a frame
    // claiming otherwise would have the drawer tell a phone its automation is
    // paused when nothing is holding anything.
    const quiet = harness({ unpin: 'unsupported' });
    const qs = new FakeSocket();
    await attachDrawer(quiet.d, quiet.reg, qs, ID, 43, 20);
    expect(quiet.logged).toEqual([]);
    expect(qs.frames()).toEqual([{ type: 'grid', cols: 43, rows: 20 }]);

    const loud = harness({ unpin: 'failed' });
    const ls = new FakeSocket();
    await attachDrawer(loud.d, loud.reg, ls, ID, 43, 20);
    expect(loud.logged.join('\n')).toContain(ID);
    expect(ls.frames()).toEqual([{ type: 'grid', cols: 43, rows: 20 }]);
  });

  it('every tmux and sizer call for one session goes through the ONE KeyedQueue, in order', async () => {
    const h = harness();
    const seen: string[] = [];
    const realRun = h.d.queue.run.bind(h.d.queue);
    h.d.queue.run = (<T,>(key: string, fn: () => Promise<T>): Promise<T> => {
      seen.push(key);
      return realRun(key, fn);
    }) as typeof h.d.queue.run;
    await attachDrawer(h.d, h.reg, new FakeSocket(), ID, 43, 20);
    expect(seen).toEqual([ID, ID, ID]);               // pin, probe, unpin
  });
});

describe('attachDrawer — frames', () => {
  it('streams pane output as TEXT frames and forwards input', async () => {
    const h = harness();
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 43, 20);
    h.ptys[0]!.emit('WELCOME-FROM-TMUX');
    expect(s.text).toEqual(['WELCOME-FROM-TMUX']);
    s.deliver({ type: 'input', data: 'ls\r' });
    expect(h.ptys[0]!.written).toEqual(['ls\r']);
  });

  it('input typed before the pty exists is delivered, not dropped', async () => {
    const h = harness();
    const s = new FakeSocket();
    const attached = attachDrawer(h.d, h.reg, s, ID, 43, 20);
    s.deliver({ type: 'input', data: 'early\r' });    // during the pin/probe awaits
    await attached;
    expect(h.ptys[0]!.written).toEqual(['early\r']);
  });

  it('a resize frame resizes the pty and is CLAMPED by the floor, which the grid frame says', async () => {
    // THE FLOOR IS RE-COMPUTED FOR THE NEW WIDTH. At attach, 60 columns needs
    // (330 + 50) * ceil(220/60) = 1520 <= 2000, so the floor IS 60 and carries
    // no reason. Asking for 30 is a different question: ceil(220/30) = 8 puts
    // it at 3040, and the smallest W that fits is 44. A `Math.max(30, 60)`
    // against the stale attach-time floor would answer 60 with no reason at
    // all — which is why this case is the one that pins the re-floor.
    const h = harness({ probe: measured({ history: 330 }) });   // floor 44 at 30 cols
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 60, 20);              // at 60, the floor is 60
    s.deliver({ type: 'resize', cols: 30, rows: 18 });
    expect(h.ptys[0]!.resized).toEqual([{ cols: 44, rows: 18 }]);
    // `narrowed` SURVIVES the refit: the un-pin happened at attach and the
    // window is still following the pty. It is a fact about the WINDOW, not
    // about this frame's width.
    expect(s.frames().at(-1)).toEqual({ type: 'grid', cols: 44, rows: 18, reason: 'history-too-small', narrowed: true });
  });

  it('a resize frame the client can have is passed through with no grid frame', async () => {
    const h = harness();
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 43, 20);
    const before = s.frames().length;
    s.deliver({ type: 'resize', cols: 90, rows: 28 });
    expect(h.ptys[0]!.resized).toEqual([{ cols: 90, rows: 28 }]);
    expect(s.frames()).toHaveLength(before);
  });

  it.each([
    [{ type: 'resize', cols: 0, rows: 28 }],
    [{ type: 'resize', cols: -5, rows: 28 }],
    [{ type: 'resize', cols: 'wide', rows: 28 }],
    [{ type: 'resize', cols: 90 }],
    [{ type: 'resize', cols: Number.NaN, rows: 28 }],
  ])('a resize frame that fails the validator leaves the pty and the grid untouched: %o', async (frame) => {
    const h = harness();
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 43, 20);
    const before = s.frames().length;
    s.deliver(frame);
    expect(h.ptys[0]!.resized).toEqual([]);
    expect(s.frames()).toHaveLength(before);
  });

  it('a malformed frame is ignored without killing the socket', async () => {
    const h = harness();
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 43, 20);
    s.deliverRaw('{not json');
    s.deliver({ type: 'nonsense' });
    expect(h.ptys[0]!.written).toEqual([]);
    expect(s.terminated).toBe(0);
  });
});

describe('attachDrawer — the refcount (§7.3)', () => {
  it('the LAST drawer to leave re-pins the window; the pty is killed and the stream disposed', async () => {
    const h = harness();
    const s = new FakeSocket();
    await attachDrawer(h.d, h.reg, s, ID, 43, 20);
    h.order.length = 0;
    s.hangUp();
    await vi.waitFor(() => expect(h.order).toEqual([`pin:${ID}`]));
    expect(h.ptys[0]!.killed).toBe(true);
    expect(h.ptys[0]!.disposed).toBe(1);
    expect(h.reg.count(ID)).toBe(0);
  });

  it('an INTERMEDIATE close re-pins nothing — smallest self-heals when the narrow client leaves (F5)', async () => {
    const h = harness();
    const a = new FakeSocket();
    const b = new FakeSocket();
    await attachDrawer(h.d, h.reg, a, ID, 43, 20);
    await attachDrawer(h.d, h.reg, b, ID, 90, 30);
    h.order.length = 0;
    a.hangUp();
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(h.order).toEqual([]);
    expect(h.reg.count(ID)).toBe(1);
    b.hangUp();
    await vi.waitFor(() => expect(h.order).toEqual([`pin:${ID}`]));
  });

  it('a SECOND drawer does not re-pin the window out from under the first', async () => {
    const h = harness();
    await attachDrawer(h.d, h.reg, new FakeSocket(), ID, 43, 20);
    h.order.length = 0;
    await attachDrawer(h.d, h.reg, new FakeSocket(), ID, 90, 30);
    expect(h.order.filter((o) => o.startsWith('pin:'))).toEqual([]);
  });

  it('a socket that dies mid-attach leaves no pty behind', async () => {
    const h = harness();
    const s = new FakeSocket();
    const attached = attachDrawer(h.d, h.reg, s, ID, 43, 20);
    s.hangUp();
    await attached;
    expect(h.ptys.every((p) => p.killed)).toBe(true);
    expect(h.reg.count(ID)).toBe(0);
  });
});

describe('DrawerRegistry', () => {
  it('counts per session and answers how many are LEFT after a removal', () => {
    const reg = new DrawerRegistry();
    const a = new FakeSocket();
    const b = new FakeSocket();
    expect(reg.count('x')).toBe(0);
    reg.add('x', a); reg.add('x', b); reg.add('y', a);
    expect(reg.count('x')).toBe(2);
    expect(reg.remove('x', a)).toBe(1);
    expect(reg.remove('x', b)).toBe(0);
    expect(reg.count('y')).toBe(1);
    expect(reg.remove('x', a)).toBe(0);           // already gone; no throw
  });

  it('DRAWER_DEFAULT_COLS is the pre-wave-3 default, so an old client is unchanged', () => {
    expect(DRAWER_DEFAULT_COLS).toBe(80);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-drawer.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/pane/drawer.js" from "test/pane-drawer.test.ts"`.

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/pane/drawer.ts`:

```ts
// L4 DELIVERY. This module owns the socket, the pty and the one timer — and it
// DECIDES nothing: the width comes from `pane/fit.ts` (L1, pure), the un-pin
// from the `WindowSizer` port (L2), the measurement from `Tmux` (L3). Every
// branch here is "act on an answer somebody else gave".
//
// Design: docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md §7.1, §7.3.
import type { PaneGridFrame, PaneProbe } from '../../../shared/api.js';
import { CANONICAL_COLS } from '../../../shared/api.js';
import type { Tmux } from '../exec.js';
import type { KeyedQueue } from '../inject/queue.js';
import type { PtyLike, SpawnPty } from '../pty.js';
import { fitFloor, measuredNum, type FitFloor } from './fit.js';
import type { WindowSizer } from './sizer.js';

/** What a client that names no grid gets — the values `/ws/pty/:id` used before
 *  wave 3, kept so an older PWA's attach is byte-for-byte what it always was. */
export const DRAWER_DEFAULT_COLS = 80;
export const DRAWER_DEFAULT_ROWS = 24;

/** ONE timer per socket, at the ping cadence (§7.3): it pings, it fails a socket
 *  that has missed its pongs, and it re-probes. Three jobs, one interval —
 *  three intervals is three things to dispose and two chances to leak one. */
export const RE_CHECK_MS = 30_000;
export const MISSED_PONGS_MAX = 2;

/**
 * The slice of a `ws` socket this module drives, declared BY THIS CONSUMER. It
 * is not a structural subset of `ws.WebSocket` on purpose: `server.ts` writes
 * the seven-line adapter explicitly, so nobody has to reason about whether ws's
 * overloaded `on` happens to be assignable this week.
 */
export interface PtySocket {
  send(data: string | Uint8Array, opts?: { binary?: boolean }): void;
  ping(): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
  onMessage(cb: (raw: unknown) => void): void;
  onClose(cb: () => void): void;
  onPong(cb: () => void): void;
}

export interface DrawerDeps {
  tmux: Tmux;
  /** The process's ONE per-session queue (`Deps.queue`). §7.3: every
   *  `resize-window` / `win-size` / probe call for a session goes through it, in
   *  order — PR #96 fired four un-awaited resizes. A second queue serialises
   *  nothing at all. */
  queue: KeyedQueue;
  spawnPty: SpawnPty;
  sizer: WindowSizer;
  log: (line: string) => void;
}

/**
 * REFCOUNT, NOT A GRID MAP (§7.3). The server does not remember what width each
 * drawer asked for — under `smallest` tmux already answers that question, and
 * answers it again for free when a client leaves (F5). All this has to know is
 * whether anybody is still looking.
 */
export class DrawerRegistry {
  private open = new Map<string, Set<PtySocket>>();

  add(id: string, s: PtySocket): void {
    const set = this.open.get(id) ?? new Set<PtySocket>();
    set.add(s);
    this.open.set(id, set);
  }

  /** Remove `s` and answer how many drawers are LEFT on that session. */
  remove(id: string, s: PtySocket): number {
    const set = this.open.get(id);
    if (set === undefined) return 0;
    set.delete(s);
    if (set.size === 0) {
      this.open.delete(id);
      return 0;
    }
    return set.size;
  }

  count(id: string): number {
    return this.open.get(id)?.size ?? 0;
  }
}

export async function attachDrawer(
  d: DrawerDeps,
  reg: DrawerRegistry,
  socket: PtySocket,
  id: string,
  clientColsIn: number,
  clientRowsIn: number,
): Promise<void> {
  let clientCols = clientColsIn;
  let clientRows = clientRowsIn;
  let closed = false;
  let pty: PtyLike | null = null;
  let sub: { dispose(): void } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let floor: FitFloor = { cols: CANONICAL_COLS, reason: 'unmeasured' };
  /** The last probe this socket took, kept so a `resize` frame can be RE-FLOORED
   *  against it. The floor is a function of TWO things — the pane and the width
   *  being asked for — and only one of them is fixed for the life of an attach.
   *  A drawer that rotates, or a phone that hands back width when its keyboard
   *  closes, is asking a question the attach-time floor cannot answer: that
   *  floor was computed for the width the client had THEN, so re-using it
   *  clamps a 30-column request to the 60-column answer of a question nobody
   *  asked. Start it at a failure, matching `floor`'s own starting value, so a
   *  frame that arrives before the first probe lands is held at the canonical
   *  grid rather than at a width nothing measured. */
  let lastProbe: PaneProbe = { ok: false, reason: 'unparseable', detail: 'no probe taken yet' };
  let grid = { cols: CANONICAL_COLS, rows: clientRowsIn };
  /** Did the WINDOW follow the pty? True only once `sizer.unpin` has answered
   *  `'ok'` — i.e. tmux is under `window-size smallest` and ccd's readers are
   *  standing down (§7.4). It is a fact about the window, not about a width, so
   *  it survives every refit and re-check for the life of the attach. §7.5 /
   *  ruling 15: the drawer's §7.6 automation notice is gated on THIS, never on
   *  `grid.cols`, because a pinned window at an unsupported agent gets exactly
   *  the same `cols` and none of the standing down. */
  let narrowed = false;
  let awaitingPong = false;
  let missedPongs = 0;
  /** Keystrokes that arrived while the pin and the probe were in flight. The
   *  socket's listeners are attached SYNCHRONOUSLY, before the first await, so
   *  nothing a thumb types during the attach is lost to a listener that is not
   *  there yet. */
  const pending: string[] = [];

  const release = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    sub?.dispose();
    sub = null;
    pty?.kill();
    pty = null;
    // The LAST drawer to leave re-pins. An intermediate close re-pins nothing:
    // under `smallest` tmux restores the remaining client's size itself (F5).
    if (reg.remove(id, socket) === 0) {
      void d.queue.run(id, () => d.sizer.pin(id));
    }
  };

  const sendGrid = (): void => {
    // Built by assignment rather than by ternary because there are now TWO
    // optional fields and four combinations; a conditional-spread literal is
    // where a field quietly goes missing on one arm.
    const frame: PaneGridFrame = { type: 'grid', cols: grid.cols, rows: grid.rows };
    if (floor.reason !== undefined) frame.reason = floor.reason;
    if (narrowed) frame.narrowed = true;
    // BINARY, while pane output stays TEXT. The split is by FRAME TYPE and not
    // by shape because the pane carries model- and repo-controlled text: a
    // `JSON.parse`-and-sniff on the text path would let a session print its own
    // grid frame into its own pane and have the drawer believe it.
    socket.send(Buffer.from(JSON.stringify(frame), 'utf8'), { binary: true });
  };

  const onFrame = (raw: unknown): void => {
    let m: { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
    try {
      m = JSON.parse(String(raw)) as typeof m;
    } catch {
      return; // malformed frames are ignored, exactly as before wave 3
    }
    if (m.type === 'input' && typeof m.data === 'string') {
      if (pty === null) pending.push(m.data);
      else pty.write(m.data);
      return;
    }
    if (m.type !== 'resize') return;
    const cols = measuredNum(m.cols);
    const rows = measuredNum(m.rows);
    // ONE validator, the same one the query string passes. A frame that fails it
    // leaves the pty AND the grid untouched — it is not a request for a default.
    if (cols === null || rows === null) return;
    clientCols = cols;
    clientRows = rows;
    // RE-FLOOR. `fitFloor` answers for a (pane, width) pair, and the width just
    // changed — so the attach-time floor is an answer to a question this frame
    // is not asking. Same probe, new width: L1 decides again, L4 acts on it.
    floor = fitFloor(lastProbe, cols);
    const want = Math.max(cols, floor.cols);
    grid = { cols: want, rows };
    pty?.resize(want, rows);
    // Under `smallest` a pty resize is all it takes; say so only when the answer
    // is not the one the client asked for.
    if (want !== cols || floor.reason !== undefined) sendGrid();
  };

  const tick = async (): Promise<void> => {
    if (closed) return;
    if (awaitingPong) {
      missedPongs += 1;
      if (missedPongs >= MISSED_PONGS_MAX) {
        // A no-FIN socket never fires `close`, so the refcount would stay above
        // zero forever and the window would stay narrow forever (F5 only heals
        // when the client actually LEAVES). This is a data-loss fix, not tidiness.
        d.log(`pane/drawer: ${id} missed ${missedPongs} pongs — terminating the socket `
          + 'so its close fires and the refcount stays honest');
        socket.terminate();
        return;
      }
    }
    awaitingPong = true;
    socket.ping();

    // History can grow while a drawer is open on a busy non-alt session, so the
    // floor that was true at attach can rise under it.
    const next = await d.queue.run(id, () => d.tmux.paneProbe(id));
    if (closed) return;
    lastProbe = next;
    floor = fitFloor(next, clientCols);
    if (floor.cols <= grid.cols) return;
    grid = { cols: floor.cols, rows: grid.rows };
    pty?.resize(grid.cols, grid.rows);
    sendGrid();
  };

  socket.onMessage(onFrame);
  socket.onPong(() => { awaitingPong = false; missedPongs = 0; });
  socket.onClose(() => { closed = true; release(); });

  const first = reg.count(id) === 0;
  reg.add(id, socket);

  // §5.1's latch. Only for the FIRST drawer on this session: a second attach
  // re-pinning would yank the window back to 220 under the drawer that is
  // already reading it at 43.
  if (first) await d.queue.run(id, () => d.sizer.pin(id));
  const probe: PaneProbe = await d.queue.run(id, () => d.tmux.paneProbe(id));
  if (closed) return;

  lastProbe = probe;
  floor = fitFloor(probe, clientCols);
  grid = { cols: Math.max(clientCols, floor.cols), rows: clientRows };
  const spawned = d.spawnPty(id, grid.cols, grid.rows);
  pty = spawned;
  sub = spawned.onData((data) => socket.send(data));   // server->client: raw utf8 TEXT frames
  for (const chunk of pending.splice(0)) spawned.write(chunk);

  if (probe.ok && floor.cols <= clientCols) {
    const verdict = await d.queue.run(id, () => d.sizer.unpin(id));
    // ONLY `'ok'`. `'unsupported'` and `'failed'` both leave the window PINNED
    // at the canonical grid, and the drawer must say nothing about automation
    // in either — that is what keeps this wave inert before wave 2 deploys
    // (§7.5, ruling 14).
    if (verdict === 'ok') narrowed = true;
    if (verdict === 'failed') {
      d.log(`pane/drawer: ccd win-size --mode smallest failed for ${id}; `
        + `the window stays pinned at ${CANONICAL_COLS} columns`);
    }
    // 'unsupported': the fleet box has no such verb. Pinned, and nothing to say.
  }
  if (closed) {
    release();
    return;
  }
  sendGrid();
  timer = setInterval(() => { void tick(); }, RE_CHECK_MS);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-drawer.test.ts
```

Expected: PASS. The timer-specific cases arrive in Task 4; nothing here advances a clock, so the 30-second interval never fires inside a test.

- [ ] **Step 5: Mutation check, then commit**

1. In `release`, change `if (reg.remove(id, socket) === 0)` to `if (true)` and re-run: **"an INTERMEDIATE close re-pins nothing"** must FAIL with `expected [ 'pin:claude2-mekwarlive' ] to deeply equal []`. Restore it.
2. In `onFrame`, change `if (cols === null || rows === null) return;` to `const c = cols ?? clientCols; const r = rows ?? clientRows;` (and use those): the `it.each` **"a resize frame that fails the validator…"** table must FAIL on every row. Restore it.
3. Delete the `if (first)` guard around the pin and re-run: **"a SECOND drawer does not re-pin…"** must FAIL. Restore it.
3b. Delete the re-floor from `onFrame` — the `floor = fitFloor(lastProbe, cols);` line, leaving `Math.max(cols, floor.cols)` against the attach-time floor — and re-run: **"a resize frame resizes the pty and is CLAMPED by the floor, which the grid frame says"** must FAIL with `expected [ { cols: 60, rows: 18 } ] to deeply equal [ { cols: 44, rows: 18 } ]`. Restore it. (Task 5's pre-existing `it` reds on the same mutation, from the other side: its `{ cols: 90, rows: 28 }` becomes `{ cols: 120, rows: 28 }`. Two suites, one guard.)
4. In `attachDrawer`, change `if (probe.ok && floor.cols <= clientCols)` to `if (floor.cols <= clientCols)` (dropping the `probe.ok` term) and re-run: **"a WIDE client on an unmeasurable pane still does not un-pin"** must FAIL with `expected [ 'pin:…', 'spawn:…', 'unpin:…' ] to deeply equal [ 'pin:…', 'spawn:…' ]`. Restore it.
5. Change the same condition to `if (probe.ok)` (dropping the floor term) and re-run: **"spawns at the FLOOR, not the client's width"** must FAIL for the same reason in reverse — it un-pins a window whose history does not fit at the client's width. Restore it.
6. Change `if (verdict === 'ok') narrowed = true;` to `narrowed = true; void verdict;` (the "every attach narrows" reading, which is what gating §7.6 on `cols` amounts to) and re-run: **"an unsupported un-pin is silent, a FAILED one is logged, and NEITHER claims the window narrowed"** must FAIL. **Measured 2026-09-14** on a standalone build of this exact module: `AssertionError: expected [ { type: 'grid', cols: 43, …(2) } ] to deeply equal [ Array(1) ]` — the mutant's frame carries `narrowed: true` where a pinned window must carry nothing. Restore it.

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/pane/drawer.ts server/test/pane-drawer.test.ts
git commit -m "$(cat <<'MSG'
feat(pane): the drawer's attach flow, frames and refcount (wave 3, spec §7.1/§7.3)

pin -> probe -> floor -> spawn at the floor -> un-pin only when the probe
measured and the floor fits, then a binary `grid` frame carrying `narrowed`
only when the window actually followed. Resize frames pass the one validator
and are clamped by the floor. Refcount, not a grid map: the LAST drawer out
re-pins, an intermediate close re-pins nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The one timer — ping, terminate, and the re-check

**Model routing:** `sonnet@high`.

**Files:**
- Modify: `server/src/pane/drawer.ts` — no new code; this task proves the `tick` written in Task 3 and fixes it if the tests say it is wrong
- Test: `server/test/pane-drawer.test.ts` — add one `describe` at the foot of the file

**Interfaces:**
- Consumes: everything Task 3 produced (`attachDrawer`, `DrawerRegistry`, `RE_CHECK_MS`, `MISSED_PONGS_MAX`, `PtySocket`)
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

Append to `server/test/pane-drawer.test.ts` (the `harness`, `FakeSocket`, `StubPty`, `measured` and `ID` from Task 3 are already in scope — do not redefine them):

```ts
describe('the one timer (§7.3): ping, terminate, re-check', () => {
  it('pings on the cadence, and a socket that answers is never terminated', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const s = new FakeSocket();
      await attachDrawer(h.d, h.reg, s, ID, 43, 20);
      // ONE PONG PER PING, three cadences deep. Pong ONCE and then advance
      // three cadences and this socket dies by its own arithmetic — tick 2
      // pings, tick 3 counts the first miss, tick 4 counts the second and
      // terminates. That is the NEXT case's behaviour, deliberately, and
      // asserting `terminated === 0` after it would be asserting the bug.
      for (const expected of [1, 2, 3]) {
        await vi.advanceTimersByTimeAsync(RE_CHECK_MS);
        expect(s.terminated).toBe(0);
        expect(s.pings).toBe(expected);
        s.pongBack();
      }
      expect(s.terminated).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pong RESETS the miss count — one missed pong then an answer starts the count over', async () => {
    // The SECOND half of `onPong`. Deleting `missedPongs = 0` alone leaves
    // `awaitingPong = false` doing all the work, and every other case here is
    // blind to it: they either pong on every cadence or never pong at all, and
    // the miss count is only observable when a socket MISSES, ANSWERS, and
    // then misses again. Without this case that assignment is unpinned.
    vi.useFakeTimers();
    try {
      const h = harness();
      const s = new FakeSocket();
      await attachDrawer(h.d, h.reg, s, ID, 43, 20);
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);          // ping 1, unanswered
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);          // missed 1, ping 2
      expect(s.terminated).toBe(0);
      s.pongBack();                                            // answered: the count starts over
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);          // ping 3, unanswered
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);          // missed 1 AGAIN, ping 4
      expect(s.terminated).toBe(0);                            // NOT the second miss of a run
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);          // missed 2 -> terminate
      expect(s.terminated).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a no-FIN socket is TERMINATED after two missed pongs, so close fires and the window is re-pinned', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const s = new FakeSocket();
      await attachDrawer(h.d, h.reg, s, ID, 43, 20);
      h.order.length = 0;
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);          // ping 1
      expect(s.terminated).toBe(0);
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);          // missed 1, ping 2
      expect(s.terminated).toBe(0);
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);          // missed 2 -> terminate
      expect(s.terminated).toBe(1);
      expect(MISSED_PONGS_MAX).toBe(2);
      expect(h.order).toEqual([`pin:${ID}`]);                   // the refcount stayed honest
      expect(h.ptys[0]!.killed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a floor that ROSE under an open drawer widens the pty and says why', async () => {
    vi.useFakeTimers();
    try {
      let probe = measured({ history: 0 });        // floor 43 at attach
      const tmuxCalls: string[][] = [];
      const run: Runner = async (cmd, args) => {
        tmuxCalls.push([cmd, ...args]);
        if (args[0] === 'list-panes') return { code: 0, stdout: probe, stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      };
      const ptys: StubPty[] = [];
      const d: DrawerDeps = {
        tmux: new Tmux(run),
        queue: new KeyedQueue(),
        spawnPty: () => { const p = new StubPty(); ptys.push(p); return p; },
        sizer: { pin: async () => {}, unpin: async () => 'ok' },
        log: () => {},
      };
      const s = new FakeSocket();
      await attachDrawer(d, new DrawerRegistry(), s, ID, 43, 20);
      expect(s.frames()).toEqual([{ type: 'grid', cols: 43, rows: 20, narrowed: true }]);

      probe = measured({ history: 330 });          // history grew: floor is now 44
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);
      expect(ptys[0]!.resized).toEqual([{ cols: 44, rows: 20 }]);
      expect(s.frames().at(-1)).toEqual({ type: 'grid', cols: 44, rows: 20, reason: 'history-too-small', narrowed: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a floor that FELL narrows nothing — the re-check only ever widens', async () => {
    // THE CASE THAT MAKES `floor.cols <= grid.cols` DIFFER FROM `===`. Every
    // other re-check case here holds the floor still or raises it, and on both
    // of those the two spellings agree — so without a FALLING floor the `<=`
    // is unpinned and a mutation to `===` is green. A floor falls when the
    // pane sheds what it was carrying (`tmux clear-history`, or a session that
    // restarts under the drawer): the arithmetic changes, the client's request
    // does not, and a pty that shrank out from under a reader would reflow the
    // view nobody asked to move.
    vi.useFakeTimers();
    try {
      let probe = measured({ history: 330 });      // floor 44 at attach
      const run: Runner = async (cmd, args) => {
        if (args[0] === 'list-panes') return { code: 0, stdout: probe, stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      };
      const ptys: StubPty[] = [];
      const d: DrawerDeps = {
        tmux: new Tmux(run),
        queue: new KeyedQueue(),
        spawnPty: () => { const p = new StubPty(); ptys.push(p); return p; },
        sizer: { pin: async () => {}, unpin: async () => 'ok' },
        log: () => {},
      };
      const s = new FakeSocket();
      await attachDrawer(d, new DrawerRegistry(), s, ID, 43, 20);
      // 44 > 43, so the floor refused the un-pin: no `narrowed` on this frame.
      expect(s.frames()).toEqual([{ type: 'grid', cols: 44, rows: 20, reason: 'history-too-small' }]);

      probe = measured({ history: 0 });            // the pane's history was cleared: floor 43
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS);
      expect(ptys[0]!.resized).toEqual([]);
      expect(s.frames()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a floor that stayed put sends nothing — the re-check is not a heartbeat frame', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const s = new FakeSocket();
      await attachDrawer(h.d, h.reg, s, ID, 43, 20);
      const before = s.frames().length;
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS * 4);
      expect(s.frames()).toHaveLength(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the timer is DISPOSED on close — the interval is GONE, not merely inert', async () => {
    // ASSERT THE DISPOSAL ITSELF, not its downstream silence. `tick`'s first
    // line is `if (closed) return;` and `onClose` sets `closed` BEFORE calling
    // `release()`, so an interval that is never cleared still probes nothing
    // and pings nobody: the observable half of this test is true with or
    // without the `clearInterval`, and on its own it pins nothing. What the
    // guard actually prevents is a leaked timer keeping a closed socket's
    // closure alive for the life of the process — one per drawer ever opened —
    // and `vi.getTimerCount()` is where that is visible.
    vi.useFakeTimers();
    try {
      const h = harness();
      const s = new FakeSocket();
      await attachDrawer(h.d, h.reg, s, ID, 43, 20);
      expect(vi.getTimerCount()).toBe(1);          // the ONE timer (§7.3), alive
      s.hangUp();
      expect(vi.getTimerCount()).toBe(0);          // and disposed by `release`
      const before = h.tmuxCalls.filter((c) => c[1] === 'list-panes').length;
      await vi.advanceTimersByTimeAsync(RE_CHECK_MS * 5);
      expect(h.tmuxCalls.filter((c) => c[1] === 'list-panes')).toHaveLength(before);
      expect(s.pings).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Add `RE_CHECK_MS, MISSED_PONGS_MAX` to the existing import from `../src/pane/drawer.js` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-drawer.test.ts
```

Expected: the seven new cases FAIL first on the import — `"RE_CHECK_MS" is not exported` is impossible (Task 3 exported it), so the real expected state is: **if Task 3's `tick` is correct, they PASS on the first run.** That is a legitimate outcome for a task whose job is to prove a mechanism written a step earlier — but you must still see each one go red on demand. Run Step 5's mutations FIRST, one at a time, confirming each named case fails, then restore and re-run for green.

**Three of these seven cases exist ONLY because a mutation was measured green without them** (audit finding F2, re-derived and re-measured 2026-09-14 against a standalone build of Tasks 1-3): "a pong RESETS the miss count", "a floor that FELL narrows nothing", and the `vi.getTimerCount()` half of "the timer is DISPOSED on close". Do not drop them as redundant with their neighbours — each neighbour is exactly the case that was green.

- [ ] **Step 3: Implement (only what Step 2 proves missing)**

If any of the five cases failed for a reason other than a deliberate mutation, fix `tick`/`release` in `server/src/pane/drawer.ts` until they pass. The behaviours they pin, in full:

- one `setInterval(RE_CHECK_MS)` per socket, started only after the attach completed;
- each tick: if a pong is still outstanding, count a miss; at `MISSED_PONGS_MAX` misses log and `socket.terminate()` and return without pinging again;
- otherwise `socket.ping()`, mark a pong outstanding, then re-probe through `d.queue.run(id, …)`;
- re-floor against the CURRENT `clientCols`; widen the pty and send a grid frame **only** when the new floor is above the pty's current width — a floor that FELL moves nothing, which is what `<=` (not `===`) buys;
- `release()` (from `onClose`) CLEARS the interval. Note what this does and does not do: a closed drawer is already silent through `tick`'s own `if (closed) return;`, so the disposal's whole job is that the timer, and the closure it holds, stop existing. Assert it on `vi.getTimerCount()`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-drawer.test.ts
```

Expected: PASS, all cases from Tasks 3 and 4.

- [ ] **Step 5: Mutation check, then commit**

Every mutation below was **modelled and run on 2026-09-14** against a standalone build of Tasks 1-3 (this module plus `fit.ts`, a stub `WindowSizer`, and wave 1's `paneProbe`), and the red quoted with each is the measured assertion text, not a prediction. Three of the four this plan carried before were measured GREEN and are replaced here; the audit that found them is F2.

1. Change `MISSED_PONGS_MAX` to `99` and re-run: **"a no-FIN socket is TERMINATED after two missed pongs"** must FAIL with `AssertionError: expected +0 to be 1`. Restore it. (Measured: it reds "a pong RESETS the miss count" in the same run, for the same reason.)
2. Delete `clearInterval(timer)` from `release` (leave `timer = null`) and re-run: **"the timer is DISPOSED on close — the interval is GONE, not merely inert"** must FAIL with `AssertionError: expected 1 to be +0` at `expect(vi.getTimerCount()).toBe(0)`.
   **Do NOT expect the probe count to grow — measured, it does not.** `tick` returns on its own `if (closed) return;` and `onClose` sets `closed = true` before `release()` runs, so the orphaned interval fires into a function that does nothing: with the pre-audit test body (no `getTimerCount`) this mutation was measured **GREEN, 27/27 passing**. The leak is real and the only place it is observable is the timer count. Restore it.
3. Change `if (floor.cols <= grid.cols) return;` to `if (floor.cols === grid.cols) return;` and re-run: **"a floor that FELL narrows nothing — the re-check only ever widens"** must FAIL with `AssertionError: expected [ { cols: 43, rows: 20 } ] to deeply equal []` — the mutant shrinks the pty under a reader who did not ask.
   **"a floor that stayed put sends nothing" does NOT red on this**, and the pre-audit plan named it: in that case the floor never falls, so `<=` and `===` agree on every cadence and the mutation was measured **GREEN, 27/27 passing**. Restore it.
4. Replace the WHOLE `onPong` body — `socket.onPong(() => { awaitingPong = false; missedPongs = 0; });` becomes `socket.onPong(() => {});` — and re-run: **"pings on the cadence, and a socket that answers is never terminated"** must FAIL with `AssertionError: expected 1 to be +0` (measured; "a pong RESETS the miss count" reds beside it).
   **Deleting `awaitingPong = false` ALONE does not red, which is what the pre-audit plan asked for.** `missedPongs = 0` still runs on every pong, so the miss count is reset before it can ever reach `MISSED_PONGS_MAX` and the socket is never terminated: measured **GREEN, 27/27 passing**. Restore it.
5. Delete `missedPongs = 0` alone from the `onPong` callback (keeping `awaitingPong = false`) and re-run: **"a pong RESETS the miss count"** must FAIL with `AssertionError: expected 1 to be +0` — the mutant terminates a socket that answered, on its second miss across two separate runs rather than two in a row. Restore it. (This is mutation 4's other half: with both named separately, neither assignment can be deleted silently — the failure mode `mutate the call site, not just the helper` describes.)

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/pane/drawer.ts server/test/pane-drawer.test.ts
git commit -m "$(cat <<'MSG'
test(pane): pin the drawer's one timer — ping, terminate, re-check (spec §7.3)

Two missed pongs terminate a no-FIN socket so its close fires and the
refcount stays honest: a leaked count is a window left narrow forever.
A floor that rose under an open drawer widens the pty and says why; a
floor that stayed put, or that FELL, sends nothing.

Three cases here exist because the mutation beside them was measured
green without one: the interval's disposal is asserted on the timer
count (a closed drawer is silent either way), the floor comparison
needs a FALLING floor to tell <= from ===, and the miss count needs a
socket that misses, answers, and misses again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: `/ws/pty/:id` runs the attach flow

**Model routing:** `sonnet@high`.

**Files:**
- Modify: `server/src/server.ts` — replace the whole `spawnPty`/`dim`/`app.get('/ws/pty/:id', …)` block (`main`'s 1462-1491; wave 1's latch comment adds ~25 lines inside the route, so locate it with `grep -n "ws/pty" server/src/server.ts` and read to the block's closing `});` rather than trusting a number)
- Test: `server/test/pty.test.ts` — **update BOTH `it`s wave 1 leaves in `describe('pty drawer bridge', …)`**, then add four new cases after them. The two to update are:
  - `it('WS /ws/pty/:id streams output, forwards input/resize, kills + restores size on close', …)` — on `main` today (`pty.test.ts:38`), untouched by wave 1
  - `it('PINS the canonical grid BEFORE the pty attaches, so the client cannot reflow the history', …)` — wave 1 Task 5's own case, with the ordered `log`

**Interfaces:**
- Consumes: `attachDrawer`, `DrawerRegistry`, `DrawerDeps`, `PtySocket`, `DRAWER_DEFAULT_COLS`, `DRAWER_DEFAULT_ROWS` (Task 3); `ccdWindowSizer` (Task 2); `measuredNum` (Task 1); `isSafeSessionId(id: string): boolean` (`server/src/clip.ts`, already imported at `server.ts:45`)
- Produces: no new exports. `Deps` is unchanged — the sizer and the registry are built inside `buildServer` from members `Deps` already carries.

- [ ] **Step 1: Write the failing test**

**First, the two `it`s that are ALREADY there.** Wave 1 leaves this file with two cases, and wave 3's
flow changes what both of them measure — because both give their `Runner` a single blanket
`{ code: 0, stdout: '', stderr: '' }`, and `paneProbe` reads that as `unparseable`. An unparseable
probe floors at `CANONICAL_COLS`, so **the client's own width stops being the grid** and both cases
fail on assertions that have nothing to do with what they are testing:

| case | assertion that breaks | why |
|---|---|---|
| `WS /ws/pty/:id streams output, …` | `expect(spawned).toEqual({ id: 'claude2-MekWarLive', cols: 120, rows: 40 })` | the floor is 220, so the spawn is `220x40` |
| `WS /ws/pty/:id streams output, …` | `expect(stub.resized).toContainEqual({ cols: 90, rows: 28 })` | `max(90, 220)` — the resize is clamped to 220 |
| `PINS the canonical grid BEFORE the pty attaches, …` | `expect(log).toContain('spawnPty claude2-MekWarLive 43x40')` | the floor is 220, so the spawn is `220x40` and the log never carries that line |

The fix is one line in each Runner: **answer the probe with a MEASURED row** instead of silence. Give
each of the two its own `list-panes` arm, immediately after the `calls`/`log` push and before the
blanket return:

```ts
      // §7.1 PROBES THE PANE BEFORE IT SPAWNS. Answer it with a measured row in
      // wave 1's `PANE_PROBE_FORMAT` order — `#{pane_active} #{history_size}
      // #{history_limit} #{pane_width} #{pane_height} #{alternate_on}` — so
      // this pane reads as the canonical 220x50 with nothing stored. The floor
      // is then the client's own width and these cases measure what they were
      // written to measure. Blanket-silence instead reads as `unparseable`,
      // floors at CANONICAL_COLS, and turns every grid below into 220.
      if (args[0] === 'list-panes') return { code: 0, stdout: '1 0 2000 220 50 1\n', stderr: '' };
```

With that row in place, **re-assert both cases unchanged** — do not relax them:

- `spawned` is `{ id: 'claude2-MekWarLive', cols: 120, rows: 40 }`: 120 < 220, and
  `need(120) = (0 + 50) * ceil(220/120) = 100 <= 2000`, so the floor is 120 and the client gets it.
- `stub.resized` contains `{ cols: 90, rows: 28 }`: this one is true **only because `onFrame`
  re-floors** (Task 3). At 90 columns `need(90) = 50 * 3 = 150`, the floor is 90, and
  `max(90, 90) = 90`. Against the stale attach-time floor of 120 it would be `{ cols: 120, rows: 28 }`
  — so this pre-existing assertion is a second, independent witness for Task 3's re-floor, and it is
  listed as such in Task 3's mutation table.
- wave 1's ordered log is unchanged in both directions: `log.indexOf(pin) < log.indexOf(spawn)` still
  holds (the probe's own `tmux list-panes …` line lands BETWEEN them),
  `log.filter((l) => l.startsWith('tmux resize-window'))` is still exactly `[pin]` (the un-pin is
  `ccd win-size`, not a `resize-window`), and the close still leaves two copies of `pin` in the log —
  the second now issued by `sizer.pin` through the refcount rather than by the route's own close
  handler.
- Neither case grows a `ccd win-size` call: `testDeps` carries **no `fleetState`**, so
  `capSupported(undefined, WIN_SIZE_CAP)` is `false` and `unpin` answers `'unsupported'` in silence.
  That is the wave's own inertness guarantee, visible in the suite that predates it.
- The first case's `frames` array now also collects the binary `grid` frame. Its assertion is
  `expect(frames).toContain('WELCOME-FROM-TMUX')`, which an extra entry cannot break — leave it.

**Then** append these cases inside the same `describe('pty drawer bridge', …)`, after the two:

```ts
  it('pins BEFORE it spawns, un-pins after, and sends the client its grid', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'list-panes') return { code: 0, stdout: '1 0 2000 220 50 1\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const stub = new StubPty();
    const order: string[] = [];
    const deps = {
      ...testDeps(undefined, run),
      fleetState: { connected: true, downSince: null, ccdVerbs: ['win-size-v1'], rosterFp: null, build: null },
      spawnPty: (id: string, cols: number, rows: number) => {
        order.push(`spawn:${cols}x${rows}:after:${calls.length}`);
        return stub;
      },
    };
    app = await buildServer(deps);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-mekwarlive?cols=43&rows=20`);
    const control: unknown[] = [];
    ws.on('message', (d, isBinary) => { if (isBinary) control.push(JSON.parse(String(d))); });
    await opened(ws);

    // The pin is the FIRST tmux argv, and it is spent before the pty exists.
    await vi.waitFor(() => expect(order).toHaveLength(1), wait);
    expect(calls[0]).toEqual(['tmux', 'resize-window', '-t', 'cc-claude2-mekwarlive', '-x', '220', '-y', '50']);
    expect(order[0]).toBe('spawn:43x20:after:2');    // pin, then probe, then spawn

    // The un-pin is the ccd verb, not a tmux option.
    await vi.waitFor(() =>
      expect(calls.some((c) => c[1] === 'win-size'
        && c.slice(1).join(' ') === 'win-size --session claude2-mekwarlive --mode smallest')).toBe(true), wait);

    // `narrowed: true` end to end: this is the ONE case in the wave where the
    // flag is earned by a real `ccd win-size` round trip rather than by a stub
    // sizer, so it is where "the window followed" and "the verb ran" are proved
    // to be the same fact (§7.5, ruling 15). The case below — `ccdVerbs: null`,
    // so `unpin` answers `'unsupported'` — is its control, and carries none.
    await vi.waitFor(() => expect(control).toEqual([{ type: 'grid', cols: 43, rows: 20, narrowed: true }]), wait);
    ws.close();
  });

  it('leaves the window pinned, and says so, when the fleet box has no win-size verb', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'list-panes') return { code: 0, stdout: '1 330 2000 220 50 1\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const stub = new StubPty();
    let spawned: { cols: number; rows: number } | undefined;
    const deps = {
      ...testDeps(undefined, run),
      fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null },
      spawnPty: (_id: string, cols: number, rows: number) => { spawned = { cols, rows }; return stub; },
    };
    app = await buildServer(deps);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-mekwarlive?cols=43&rows=20`);
    const control: unknown[] = [];
    ws.on('message', (d, isBinary) => { if (isBinary) control.push(JSON.parse(String(d))); });
    await opened(ws);

    await vi.waitFor(() => expect(spawned).toEqual({ cols: 44, rows: 20 }), wait);   // the floor, not 43
    await vi.waitFor(() =>
      expect(control).toEqual([{ type: 'grid', cols: 44, rows: 20, reason: 'history-too-small' }]), wait);
    expect(calls.some((c) => c[1] === 'win-size')).toBe(false);
    ws.close();
  });

  it('refuses a session id it cannot prove safe, before any tmux target is built from it', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    let spawns = 0;
    const deps = {
      ...testDeps(undefined, run),
      spawnPty: () => { spawns++; return new StubPty(); },
    };
    app = await buildServer(deps);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/${encodeURIComponent('../../etc')}`);
    await new Promise<void>((resolve) => { ws.on('close', () => resolve()); ws.on('error', () => resolve()); });
    expect(spawns).toBe(0);
    expect(calls).toEqual([]);
  });

  it('a query string that names no measurable grid falls back to 80x24, exactly as before wave 3', async () => {
    const run = async (cmd: string, args: string[]) => {
      if (args[0] === 'list-panes') return { code: 0, stdout: '1 0 2000 220 50 1\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const stub = new StubPty();
    let spawned: { cols: number; rows: number } | undefined;
    const deps = {
      ...testDeps(undefined, run),
      spawnPty: (_id: string, cols: number, rows: number) => { spawned = { cols, rows }; return stub; },
    };
    app = await buildServer(deps);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-mekwarlive?cols=0&rows=nope`);
    await opened(ws);
    await vi.waitFor(() => expect(spawned).toEqual({ cols: 80, rows: 24 }), wait);
    ws.close();
  });
```

Both pre-existing `it`s must be GREEN at the end of this step, with only the `list-panes` arm added
and no assertion weakened. The close-time `resize-window` argv the first one waits for is still
issued — by `release()` through `sizer.pin`, now that the refcount has reached zero, rather than by
the route's own close handler.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/pty.test.ts
```

Expected: FAIL — the first new case fails with `expected [] to have a length of 1` / `expected undefined to deeply equal [ 'tmux', 'resize-window', … ]` (wave 1's route spawns at the client's own grid and sends no binary frame at all), and the bad-id case fails because the socket opens and `spawns` is 1.

The **two pre-existing `it`s stay GREEN in this step**, and that is the point of doing them first: wave 1's route never runs `list-panes`, so the arm added to each Runner is dead code until Step 3 lands the flow that calls it. A pre-existing case that goes red HERE means the arm was mis-typed, not that wave 3 broke it.

- [ ] **Step 3: Write the minimal implementation**

In `server/src/server.ts`, add to the import block beside the existing `./pty.js` import:

```ts
import { attachDrawer, DrawerRegistry, DRAWER_DEFAULT_COLS, DRAWER_DEFAULT_ROWS, type DrawerDeps, type PtySocket } from './pane/drawer.js';
import { ccdWindowSizer } from './pane/sizer.js';
import { measuredNum } from './pane/fit.js';
```

Replace that whole block — the `// Terminal drawer:` comment through the `});` that closes `app.get('/ws/pty/:id', …)` — in full with:

```ts
  // Terminal drawer: attach a pty to the session's tmux window. Lazy-import the
  // native node-pty binding only when no stub is injected (keeps tests hermetic).
  //
  // The flow itself lives in `pane/drawer.ts` (L4) and the decisions it acts on
  // in `pane/fit.ts` (L1) and `pane/sizer.ts` (L2) — this block is wiring, and
  // wiring only. Design §7.1.
  const spawnPty: SpawnPty = deps.spawnPty ?? (await import('./pty.js')).attachPty;
  const drawerLog = (line: string): void => { console.warn(line); };
  const drawers = new DrawerRegistry();
  const drawerDeps: DrawerDeps = {
    tmux: deps.tmux,
    queue: deps.queue,
    spawnPty,
    sizer: ccdWindowSizer({
      tmux: deps.tmux, runCcd: deps.runCcd, fleetState: deps.fleetState, log: drawerLog,
    }),
    log: drawerLog,
  };

  app.get('/ws/pty/:id', { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    // BEFORE ANY `cc-<id>` TARGET IS BUILT FROM IT. This route is the one place
    // on this server where a `:id` reached a tmux target un-checked; wave 3 is
    // the wave that hands the same id to `ccd win-size` through the agent, where
    // prefix matching leaves every token after the grant unconstrained, so the
    // gap closes here rather than being widened.
    if (!isSafeSessionId(id)) { socket.close(1008, 'bad-session-id'); return; }
    const q = req.query as { cols?: string; rows?: string };
    // Seven explicit lines rather than passing `socket` straight through: the
    // port is declared by its consumer and `ws`'s overloaded `on` is nobody's
    // business but this adapter's.
    const sock: PtySocket = {
      send: (data, opts) => { socket.send(data, opts); },
      ping: () => { socket.ping(); },
      terminate: () => { socket.terminate(); },
      close: (code, reason) => { socket.close(code, reason); },
      onMessage: (cb) => { socket.on('message', (raw) => cb(raw)); },
      onClose: (cb) => { socket.on('close', () => cb()); },
      onPong: (cb) => { socket.on('pong', () => cb()); },
    };
    void attachDrawer(
      drawerDeps, drawers, sock, id,
      measuredNum(q.cols) ?? DRAWER_DEFAULT_COLS,
      measuredNum(q.rows) ?? DRAWER_DEFAULT_ROWS,
    );
  });
```

Then prove the old `dim` helper has no other reader and is gone:

```bash
cd "$(git rev-parse --show-toplevel)" && grep -n 'const dim = \|dim(' server/src/server.ts
```

Expected: no output.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/pty.test.ts test/auth-gate.test.ts test/routes.test.ts test/whitelist-subset.test.ts
```

Expected: PASS, all four. `auth-gate.test.ts`'s route counts must be UNCHANGED **at WAVE 1's numbers — 48 / 76 / 73 / 28** (`scanRoutes('server.ts').length` → 48, `ROUTES.length` → 76, the derived `httpCount` → 73, `scanRoutes('coord/routes.ts').length` → 28). Those are not `main`'s: `main` reads 47 / 75 / 72 / 28, and wave 1's salvage re-pinned the first three when it landed `GET /api/sessions/:id/pane/history`. **Wave 3 adds no HTTP route of its own** — it rewrites the body of a `/ws/pty/:id` that `WS_ROUTES` already lists — so the numbers it inherits are the numbers it leaves.

If a count is one LOW (47 / 75 / 72), wave 1 is not on this branch and Task 1 Step 0 should already have stopped you. If a count is one HIGH (49 / 77 / 74), an HTTP route was added by mistake in this wave — revert it. Never "fix" a count by editing the number: it is the pin, not the measurement.

Then the whole server suite, in the FOREGROUND with a 600000 ms timeout:

```bash
cd server && npm run test
```

Expected: PASS. Re-run any of the five known load flakes in isolation before calling one a break.

- [ ] **Step 5: Mutation check, then commit**

1. Delete the `if (!isSafeSessionId(id))` line and re-run `./node_modules/.bin/vitest run test/pty.test.ts`: **"refuses a session id it cannot prove safe, before any tmux target is built from it"** must FAIL with `expected 1 to be +0` on `expect(spawns).toBe(0)` — the un-checked id reaches `spawnPty` and builds a `cc-../../etc` target. Restore it.
2. Swap the order in `attachDrawer`'s caller so the pty is spawned before the pin — i.e. temporarily move `if (first) await d.queue.run(id, () => d.sizer.pin(id));` in `pane/drawer.ts` to AFTER the `d.spawnPty(...)` line — and re-run: **"pins BEFORE it spawns"** must FAIL with `expected 'spawn:43x20:after:1' to be 'spawn:43x20:after:2'`. Restore it.

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/server.ts server/test/pty.test.ts
git commit -m "$(cat <<'MSG'
feat(pty): /ws/pty/:id runs the wave-3 attach flow (spec §7.1)

The route becomes wiring: it validates :id before any cc-<id> target is
built from it, adapts the ws socket to the PtySocket port, and hands the
attach to pane/drawer.ts. The pin is spent before the pty exists; the
un-pin is the ccd verb behind its cap; the client is told its grid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The boot sweep

**Model routing:** `sonnet@high`.

**Files:**
- Modify: `server/src/exec.ts` — add `WindowWidthProbe` beside `SessionVerdict` and `windowWidth` to `class Tmux` (after `resizeWindow`, the last method)
- Modify: `server/src/pane/drawer.ts` — add `bootSweep`
- Modify: `server/src/server.ts` — kick the sweep at the foot of `buildServer`
- Test: `server/test/pane-bootsweep.test.ts` (new)

**Interfaces:**
- Consumes: `Runner`, `ExecResult`, `class Tmux` (`server/src/exec.ts`); `DrawerDeps`, `DrawerRegistry` (Task 3); `CANONICAL_COLS` (Task 1); `readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]>` (`server/src/registry.ts`)
- Produces: `type WindowWidthProbe = { ok: true; width: number } | { ok: false; reason: 'gone' } | { ok: false; reason: 'unmeasured'; detail: string }` and `Tmux.windowWidth(id: string): Promise<WindowWidthProbe>` (`server/src/exec.ts`); `function bootSweep(d: DrawerDeps, reg: DrawerRegistry, ids: readonly string[]): Promise<void>` (`server/src/pane/drawer.ts`)

- [ ] **Step 1: Write the failing test**

Create `server/test/pane-bootsweep.test.ts`:

```ts
// §7.3's boot sweep: a restart must not strand a narrow window. The census's
// 302x74 stray is corrected the same way.
import { describe, it, expect } from 'vitest';
import { bootSweep, DrawerRegistry, type DrawerDeps, type PtySocket } from '../src/pane/drawer.js';
import { Tmux, type Runner } from '../src/exec.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { CANONICAL_COLS } from '../../shared/api.js';

const widths = (byId: Record<string, { code: number; stdout: string; stderr: string }>) => {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] !== 'list-panes') return { code: 0, stdout: '', stderr: '' };
    const target = String(args[2] ?? '').replace(/^cc-/, '');
    return byId[target] ?? { code: 1, stdout: '', stderr: "can't find window: cc-" + target };
  };
  const pinned: string[] = [];
  const logged: string[] = [];
  const d: DrawerDeps = {
    tmux: new Tmux(run),
    queue: new KeyedQueue(),
    spawnPty: () => { throw new Error('the boot sweep must never spawn a pty'); },
    sizer: { pin: async (id) => { pinned.push(id); }, unpin: async () => 'ok' },
    log: (l) => logged.push(l),
  };
  return { d, calls, pinned, logged };
};

const OK = (w: number) => ({ code: 0, stdout: `${w}\n${w}\n`, stderr: '' });

describe('bootSweep', () => {
  it('pins every window that is not at the canonical grid, and leaves the rest alone', async () => {
    const h = widths({ a: OK(CANONICAL_COLS), b: OK(43), c: OK(302) });
    await bootSweep(h.d, new DrawerRegistry(), ['a', 'b', 'c']);
    expect(h.pinned).toEqual(['b', 'c']);
  });

  it('reads #{window_width} through list-panes — a verb the agent already grants', async () => {
    const h = widths({ a: OK(43) });
    await bootSweep(h.d, new DrawerRegistry(), ['a']);
    expect(h.calls[0]).toEqual(['tmux', 'list-panes', '-t', 'cc-a', '-F', '#{window_width}']);
  });

  it('a session that is GONE is not pinned and is not logged as a failure', async () => {
    const h = widths({});
    await bootSweep(h.d, new DrawerRegistry(), ['ghost']);
    expect(h.pinned).toEqual([]);
    expect(h.logged).toEqual([]);
  });

  it('an UNMEASURABLE window is left alone and SAID, never pinned on a guess', async () => {
    const h = widths({ a: { code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/default' } });
    await bootSweep(h.d, new DrawerRegistry(), ['a']);
    expect(h.pinned).toEqual([]);
    expect(h.logged.join('\n')).toContain('no server running');
  });

  it('a window with a drawer already on it is NOT swept out from under it', async () => {
    const h = widths({ a: OK(43) });
    const reg = new DrawerRegistry();
    reg.add('a', {} as PtySocket);
    await bootSweep(h.d, reg, ['a']);
    expect(h.pinned).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('one bad session does not end the sweep', async () => {
    const h = widths({ a: { code: 1, stdout: '', stderr: 'boom' }, b: OK(43) });
    await bootSweep(h.d, new DrawerRegistry(), ['a', 'b']);
    expect(h.pinned).toEqual(['b']);
  });
});

describe('Tmux.windowWidth', () => {
  const probe = async (r: { code: number; stdout: string; stderr: string }) =>
    new Tmux(async () => r).windowWidth('a');

  it('measures the first row — every pane of a window reports the SAME window_width', async () => {
    expect(await probe(OK(220))).toEqual({ ok: true, width: 220 });
  });
  it("tells GONE from unmeasurable, on list-panes' OWN literal", async () => {
    // MEASURED, tmux 3.4, private socket, re-run for this wave:
    //   $ tmux -L s list-panes -t cc-nope -F '#{window_width}'
    //   can't find window: cc-nope                               rc=1
    //   $ tmux -L s capture-pane -p -t cc-nope
    //   can't find pane: cc-nope                                 rc=1
    // Same verb as `paneProbe`, so the SAME literal — one fact, two readers.
    expect(await probe({ code: 1, stdout: '', stderr: "can't find window: cc-a" })).toEqual({ ok: false, reason: 'gone' });
    // `capture-pane`'s message reaching THIS reader would mean tmux changed
    // under us; until it does, it is an unrecognised refusal like any other.
    expect(await probe({ code: 1, stdout: '', stderr: "can't find pane: cc-a" }))
      .toEqual({ ok: false, reason: 'unmeasured', detail: "can't find pane: cc-a" });
    expect(await probe({ code: 1, stdout: '', stderr: 'lost server' }))
      .toEqual({ ok: false, reason: 'unmeasured', detail: 'lost server' });
  });
  it('a zero-exit answer that is not a width is unmeasured, not a zero', async () => {
    expect(await probe({ code: 0, stdout: '\n', stderr: '' })).toMatchObject({ ok: false, reason: 'unmeasured' });
    expect(await probe({ code: 0, stdout: 'wide\n', stderr: '' })).toMatchObject({ ok: false, reason: 'unmeasured' });
    expect(await probe({ code: 0, stdout: '0\n', stderr: '' })).toMatchObject({ ok: false, reason: 'unmeasured' });
  });
  it('a silent non-zero still carries a detail a human can act on', async () => {
    expect(await probe({ code: 3, stdout: '', stderr: '' }))
      .toEqual({ ok: false, reason: 'unmeasured', detail: 'tmux exited 3 with no message' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-bootsweep.test.ts
```

Expected: FAIL — `"bootSweep" is not exported by "../src/pane/drawer.ts"` and `Property 'windowWidth' does not exist on type 'Tmux'`.

- [ ] **Step 3: Write the minimal implementation**

In `server/src/exec.ts`, add beside `SessionVerdict` (above `class Tmux`):

```ts
/** One window's width, measured. Three conditions, kept apart at the seam:
 *  `gone` is a session that is not there (nothing to correct), `unmeasured` is
 *  a tmux that would not answer (correcting it would be a guess). */
export type WindowWidthProbe =
  | { ok: true; width: number }
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'unmeasured'; detail: string };
```

and append inside `class Tmux`, after `resizeWindow`:

```ts
  /** `#{window_width}` for cc-<id>'s window (design §7.3's boot sweep).
   *
   *  Row [0] is safe HERE and only here: `list-panes` lists every pane of the
   *  window and each one reports the SAME `#{window_width}`. That is exactly
   *  what is NOT true of the per-pane fields `paneProbe` reads — F7 measured PR
   *  #96 taking row [0] of those and mismatching on a split window — so do not
   *  copy this row selection over there. */
  async windowWidth(id: string): Promise<WindowWidthProbe> {
    const r = await this.run('tmux', ['list-panes', '-t', target(id), '-F', '#{window_width}']);
    if (r.code !== 0) {
      // THE SAME LITERAL `paneProbe` MATCHES, AND FOR THE SAME REASON: this is
      // `list-panes`, and `list-panes` says "can't find WINDOW". `capture-pane`
      // is the verb that says "can't find pane". MEASURED for this wave on a
      // private tmux 3.4 socket (`tmux -L ccrc-probe-… list-panes -t cc-nope`
      // -> `can't find window: cc-nope`, rc 1; `capture-pane -p -t cc-nope` ->
      // `can't find pane: cc-nope`, rc 1). "can't find session" is a THIRD
      // message and belongs to colon- and `$`-prefixed targets (`cc-nope:`,
      // `$cc-nope`) — shapes `target()` never builds, so it cannot arrive here.
      //
      // Matching anything but this one means every dead registry session reads
      // `unmeasured` and the boot sweep logs a failure for each of ~20 of them
      // at every single start. Keep this test and `paneProbe`'s in step by
      // hand: two readers, one measured fact.
      if (r.stderr.includes("can't find window")) return { ok: false, reason: 'gone' };
      const msg = r.stderr.trim();
      return { ok: false, reason: 'unmeasured', detail: msg !== '' ? msg : `tmux exited ${r.code} with no message` };
    }
    const first = r.stdout.trim().split('\n')[0] ?? '';
    const n = Number(first);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, reason: 'unmeasured', detail: `list-panes printed ${JSON.stringify(first)}` };
    }
    return { ok: true, width: n };
  }
```

Append to `server/src/pane/drawer.ts`:

```ts
/**
 * §7.3's boot sweep. A server restart cannot strand a narrow window: at boot
 * nothing is attached, so any window off the canonical grid is a leftover —
 * from a drawer that died with the last process, or from the census's 302x74
 * stray. Sequential and un-awaited by its caller: ~20 sessions x 2 execs is not
 * something `/health` should wait behind.
 *
 * Never pins on a GUESS. `gone` is nothing to correct and `unmeasured` is a
 * tmux that would not answer — firing twenty resizes at an unreachable box is
 * noise, not repair, so it is said instead.
 */
export async function bootSweep(d: DrawerDeps, reg: DrawerRegistry, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    if (reg.count(id) > 0) continue;   // a drawer owns this window; it is not stranded
    const w = await d.queue.run(id, () => d.tmux.windowWidth(id));
    if (!w.ok) {
      if (w.reason === 'unmeasured') {
        d.log(`pane/drawer: boot sweep could not measure ${id}'s window (${w.detail}); leaving it alone`);
      }
      continue;
    }
    if (w.width === CANONICAL_COLS) continue;
    d.log(`pane/drawer: boot sweep found ${id}'s window at ${w.width} columns; `
      + `pinning it back to ${CANONICAL_COLS}`);
    await d.queue.run(id, () => d.sizer.pin(id));
  }
}
```

In `server/src/server.ts`, directly after the `app.get('/ws/pty/:id', …)` registration added in Task 5:

```ts
  // §7.3's boot sweep, started here because this is where the refcount lives.
  // Un-awaited on purpose: a restart must answer `/health` immediately, and the
  // sweep serialises against every drawer through the same per-session queue.
  void readRegistry(deps.io, deps.cfg)
    .then((records) => bootSweep(drawerDeps, drawers, records.map((r) => r.id)))
    .catch((e: unknown) => { drawerLog(`pane/drawer: boot sweep aborted: ${String(e)}`); });
```

Add `bootSweep` to the `./pane/drawer.js` import, and confirm `readRegistry` is already imported (`grep -n "readRegistry" server/src/server.ts`); if it is not, add it to the existing `./registry.js` import.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/pane-bootsweep.test.ts test/pty.test.ts test/exec.test.ts
```

Expected: PASS.

Then the whole server suite (the sweep now runs inside every `buildServer`, so any test asserting an EXACT tmux call list could move):

```bash
cd server && npm run test
```

Expected: PASS. `testDeps`'s fixture home has no registry sessions, so the sweep enumerates nothing for the overwhelming majority of suites. If a suite that seeds sessions now sees an extra `list-panes` argv, that suite's assertion is the thing to widen (`toContainEqual` rather than `toEqual`) — never disable the sweep to make a test green.

- [ ] **Step 5: Mutation check, then commit**

1. Change `if (w.width === CANONICAL_COLS) continue;` to `if (w.width >= CANONICAL_COLS) continue;` and re-run `./node_modules/.bin/vitest run test/pane-bootsweep.test.ts`: **"pins every window that is not at the canonical grid"** must FAIL with `expected [ 'b' ] to deeply equal [ 'b', 'c' ]` (the 302-column stray goes uncorrected). Restore it.
2. Change the `!w.ok` arm to `if (!w.ok) { await d.queue.run(id, () => d.sizer.pin(id)); continue; }` and re-run: **"a session that is GONE is not pinned"** and **"an UNMEASURABLE window is left alone"** must both FAIL. Restore it.
3. Delete the `if (reg.count(id) > 0) continue;` line and re-run: **"a window with a drawer already on it is NOT swept"** must FAIL. Restore it.
4. In `windowWidth`, change `r.stderr.includes("can't find window")` to `r.stderr.includes("can't find pane")` — `capture-pane`'s literal, the wrong verb's — and re-run: **"tells GONE from unmeasurable, on list-panes' OWN literal"** must FAIL with `expected { ok: false, reason: 'unmeasured', detail: "can't find window: cc-a" } to deeply equal { ok: false, reason: 'gone' }`, and **"a session that is GONE is not pinned and is not logged as a failure"** must FAIL on the log. Restore it. This is the mutation that matters most in this task: it is the difference between a silent sweep and one that shouts about every dead session at every boot.

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/exec.ts server/src/pane/drawer.ts server/src/server.ts server/test/pane-bootsweep.test.ts
git commit -m "$(cat <<'MSG'
feat(pane): the boot sweep re-pins stranded windows (spec §7.3)

Tmux.windowWidth is a measured read of #{window_width} — row [0] is safe
for a WINDOW field and stays forbidden for the per-pane ones (F7). The
sweep pins only what it measured off the canonical grid: gone is nothing
to correct, unmeasured is a guess, and neither is repaired on faith.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The mail lane holds when it cannot read (§7.4)

**Model routing:** `sonnet@high`.

**Files:**
- Modify: `server/src/inject/send.ts:18-22` (the `SendResult` error union) and `~:498` (the head of the queued closure — the `const pane = await d.tmux.captureAnsi(id);` at the top of the `holdIfAutoContinueArmed` caller's body, NOT the identically-spelled line at `:148`)
- Modify: `server/src/watch.ts:3046` — a new arm beside the `auto-continue-armed` one
- Modify: `pwa/src/lib/api.ts:51` — one entry in `SEND_ERROR_TEXT` (the record opens at `:28`)
- Test: `server/test/send.test.ts` — widen `fakeTmux` (39-52) and add a `describe`

None of these four files is touched by wave 1 or wave 2, so unlike Task 5's and Task 8's the line numbers here are exact rather than estimates.

**Interfaces:**
- Consumes: `READER_MIN_COLS: number` (wave 2, `shared/api.ts`); `Tmux.paneProbe` (wave 1); `CANONICAL_COLS`, `CANONICAL_ROWS` (Task 1); `MAIL_ARMED_HOLD_MS = 300_000` (`server/src/watch.ts:298`)
- Produces: the additive `SendResult` error token `'auto-continue-unmeasured'` — and, for a probe that answers `gone`, the EXISTING `'not-alive'`, returned before the width is consulted (spec §7.4, ruling 13)

**`gone` IS `not-alive`, AND THE ORDER OF THE TWO CHECKS IS THE WHOLE OF IT (spec §7.4 / ruling 13).**
A probe has four arms, and only three of them mean "we could not read this pane". The fourth,
`gone`, means the session is dead — which the `captureAnsi === null` line immediately below already
reports as `not-alive`. Folding it into the held token is not a cosmetic collapse:

- The sweep's back-off for `auto-continue-unmeasured` passes `false` as its last argument and so
  **counts no attempt** — a hold is not a failure. That is correct for a pane that is merely narrow,
  because the hold expires when the width does.
- A DEAD session's width never returns. So a dead session's mail, held on this token, is retried
  every `MAIL_ARMED_HOLD_MS` (five minutes) **forever**, never reaching `MAIL_MAX_ATTEMPTS`, never
  parked as `undeliverable` — and each retry tells the sender that a terminal drawer is open on a
  pane that no longer exists.
- `not-alive` takes the ordinary failure path in `watch.ts` (there is no arm for it: measured,
  `watch.ts`'s `res.error ===` arms are `auto-continue-armed` (`:3046`), `enter-ignored` (`:3071`)
  and `draft-present` (`:3091`) — none of them `not-alive`), which counts the
  attempt and parks the row after the ceiling. That is the behaviour a dead recipient must get, and
  it is today's behaviour — this wave must not change it.

So the `gone` arm returns FIRST, above the width test, and it ships with its own test and its own
mutation.

- [ ] **Step 1: Write the failing test**

In `server/test/send.test.ts`, first widen `fakeTmux` so every existing case keeps deciding on its pane text alone. Replace lines 39-52 with:

```ts
/** §7.4: the mail lane measures the pane's WIDTH before it trusts a phrase
 *  match, so this fake answers `list-panes` too. The default row is the
 *  canonical grid — wide, measured, readable — which is what every case written
 *  before wave 3 assumed without having to say so. The row's shape is wave 1's
 *  `PaneProbe` format: `#{pane_active} #{history_size} #{history_limit}
 *  #{pane_width} #{pane_height} #{alternate_on}`. */
function fakeTmux(
  panes: (string | null)[],
  /** A row (the measured case), `''` (rc 0 with no active row -> `unparseable`),
   *  or a tmux FAILURE — which is the only way to reach the `gone` arm, because
   *  `paneProbe` reads it off `list-panes`' own stderr (`can't find window`,
   *  wave 1's measured literal). */
  probeRow: string | { code: number; stderr: string } = `1 0 2000 ${CANONICAL_COLS} ${CANONICAL_ROWS} 1`,
) {
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'list-panes') {
      if (typeof probeRow !== 'string') return { code: probeRow.code, stdout: '', stderr: probeRow.stderr };
      return probeRow === '' ? { code: 0, stdout: '', stderr: '' } : { code: 0, stdout: `${probeRow}\n`, stderr: '' };
    }
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(capIdx, panes.length - 1)] ?? null;
      capIdx++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), calls };
}
```

and add to that file's imports:

```ts
import { CANONICAL_COLS, CANONICAL_ROWS, READER_MIN_COLS } from '../../shared/api.js';
```

Then append this `describe`, immediately after the existing `describe('holdIfAutoContinueArmed (D-2368)', …)` block:

```ts
describe('auto-continue-unmeasured (§7.4): a narrow pane is UNMEASURED, not idle', () => {
  const IDLE = 'all quiet\n❯ \n';
  /** `list-panes`' own refusal for a session that is gone — wave 1's measured
   *  tmux 3.4 literal, and NOT `capture-pane`'s ("can't find pane"). */
  const GONE = { code: 1, stderr: "can't find window: cc-x" };

  it('holds when the pane is narrower than the readers were calibrated for', async () => {
    expect(READER_MIN_COLS).toBeGreaterThan(43);
    const { tmux, calls } = fakeTmux([IDLE], '1 0 2000 43 50 1');
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { holdIfAutoContinueArmed: true });
    expect(res).toEqual({ ok: false, error: 'auto-continue-unmeasured' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('holds when the pane could not be measured at all', async () => {
    const { tmux, calls } = fakeTmux([IDLE], '');       // no active row -> unparseable
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { holdIfAutoContinueArmed: true });
    expect(res).toEqual({ ok: false, error: 'auto-continue-unmeasured' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('a session that is GONE is not-alive, never held — or its mail would retry every 5 minutes forever', async () => {
    // §7.4 / ruling 13. The panes array is `[IDLE]`, NOT `[null]`, and that is
    // the point: a capture that SUCCEEDS means the only thing in this call that
    // can answer `not-alive` is the probe's own `gone` arm. Point it at a dead
    // capture too and the case would stay green with the arm deleted, which is
    // no test at all.
    const { tmux, calls } = fakeTmux([IDLE], GONE);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { holdIfAutoContinueArmed: true });
    expect(res).toEqual({ ok: false, error: 'not-alive' });
    expect(calls.filter((c) => c[1] === 'capture-pane')).toEqual([]);
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('control: a GONE session with no opt-in still reads not-alive, from the capture, exactly as before', async () => {
    // The un-changed path. `not-alive` is not a new answer for a dead session —
    // it is the answer it already had, and the opt-in must not move it.
    const { tmux } = fakeTmux([null], GONE);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi');
    expect(res).toEqual({ ok: false, error: 'not-alive' });
  });

  it('is decided BEFORE the pane is even captured — a wrapped phrase is never read', async () => {
    const { tmux, calls } = fakeTmux([IDLE], '1 0 2000 43 50 1');
    await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { holdIfAutoContinueArmed: true });
    expect(calls.filter((c) => c[1] === 'capture-pane')).toEqual([]);
  });

  it('a pane at exactly READER_MIN_COLS is measurable and is typed into', async () => {
    const { tmux, calls } = fakeTmux(
      [IDLE, '❯ hi\n', '❯ \n'], `1 0 2000 ${READER_MIN_COLS} 50 1`,
    );
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { holdIfAutoContinueArmed: true });
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls).length).toBeGreaterThan(0);
  });

  it('control: a caller that did NOT opt in types into a narrow pane exactly as always', async () => {
    const { tmux, calls } = fakeTmux([IDLE, '❯ hi\n', '❯ \n'], '1 0 2000 43 50 1');
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi');
    expect(res).toEqual({ ok: true });
    expect(calls.filter((c) => c[1] === 'list-panes')).toEqual([]);   // and does not even measure
    expect(sendKeysCalls(calls).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/send.test.ts
```

Expected: FAIL — the first new case fails with `expected { ok: true } to deeply equal { ok: false, error: 'auto-continue-unmeasured' }` (main types straight into the narrow pane), and the "decided BEFORE the pane is captured" case fails with a non-empty `capture-pane` list. The `gone` case fails on its RESULT assertion: main has no probe at all, the scripted capture succeeds, and the send runs on into the echo loop — so a dead session whose pane still captures is not `not-alive` to main either. Its control case ("no opt-in, still not-alive") passes on main and must keep passing after.

- [ ] **Step 3: Write the minimal implementation**

In `server/src/inject/send.ts`, extend the union at line 18-22:

```ts
      error: 'not-alive' | 'dialog-open' | 'draft-present' | 'draft-clear-failed' | 'verify-failed' | 'enter-ignored'
        // D-2368. The pane's own status line says Claude Code will continue on
        // its own; nothing was pressed. Only reachable when the caller opted
        // in via `holdIfAutoContinueArmed` — see that option's own docstring.
        | 'auto-continue-armed'
        // §7.4 of the 2026-09-14 terminal-drawer design. The pane is narrower
        // than `READER_MIN_COLS` (a drawer is holding it there) or could not be
        // measured at all, so NO phrase match on it can be trusted: a narrow
        // pane wraps "continuing automatically" between words and the match
        // fails OPEN. Same opt-in, and the sweep holds on it exactly as it
        // holds on `auto-continue-armed` — the hold expires when the width does.
        | 'auto-continue-unmeasured';
```

Add to that file's imports:

```ts
import { composePrompt, MAIL_ENVELOPE_FENCE, READER_MIN_COLS } from '../../../shared/api.js';
```

and insert at the very head of the queued closure, before `const pane = await d.tmux.captureAnsi(id);`:

```ts
    // §7.4. The check below decides on a PHRASE MATCH, and a pane narrower than
    // the readers were calibrated for wraps that phrase between words — grep
    // cannot match across the newline it never presents (F11), so a wrapped
    // "continuing automatically" reads as ABSENT and the nudge types over Claude
    // Code's own recovery. Measure first; hold when the phrase cannot be proven
    // readable. Same queue as everything else on this session.
    //
    // Only for the opt-in caller: a human's send from the PWA is the documented
    // cancel, and it stays exactly as unconditional as it has always been.
    if (opts.holdIfAutoContinueArmed) {
      const probe = await d.tmux.paneProbe(id);
      // GONE IS NOT UNMEASURED, AND THIS LINE IS ABOVE THE WIDTH TEST ON
      // PURPOSE (§7.4, ruling 13). A dead session is the one probe failure
      // whose condition never clears, and the hold below counts no attempt by
      // design — so folding `gone` into it would retry this delivery every five
      // minutes for the life of the process, telling the sender each time that
      // a drawer is open on a pane that no longer exists. `not-alive` is what
      // the `captureAnsi === null` line below would have said two statements
      // later; saying it here changes nothing except that the width can no
      // longer swallow it. Four probe arms in, two answers out, and the one
      // that means DEAD keeps its own.
      if (!probe.ok && probe.reason === 'gone') return { ok: false, error: 'not-alive' };
      if (!probe.ok || probe.width < READER_MIN_COLS) {
        return { ok: false, error: 'auto-continue-unmeasured' };
      }
    }
```

In `server/src/watch.ts`, immediately after the closing `}` of the `if (res.error === 'auto-continue-armed') { … }` block (~line 3055). **`not-alive` gets no arm here and must not get one** — it falls through to the ordinary failure path that counts the attempt and parks the row at `MAIL_MAX_ATTEMPTS`, which is today's behaviour for a dead recipient and the reason §7.4 keeps `gone` out of the held token:

```ts
        if (res.error === 'auto-continue-unmeasured') {
          // §7.4. The recipient's pane is narrower than READER_MIN_COLS — a
          // terminal drawer is holding it there — or could not be measured at
          // all. Either way no phrase match on it can be trusted, so this is a
          // HELD delivery and not a failed one: same shape as the armed hold
          // above, before the attempts ceiling, told once per hold. The hold
          // expires when the width does, which is bounded by the drawer's own
          // open time (design §7.6, the named residual).
          if (d.lastError !== 'auto-continue-unmeasured') {
            tellSender(
              'the recipient\'s pane is too narrow to read safely (a terminal drawer is open on it); the nudge is held until it widens',
              `mail-blocked-${d.id}`,
            );
          }
          store.backOff(d.id, res.error, now + MAIL_ARMED_HOLD_MS, false);
          continue;
        }
```

In `pwa/src/lib/api.ts`, add to `SEND_ERROR_TEXT` directly after the `'auto-continue-armed'` entry:

```ts
  // §7.4 of the 2026-09-14 terminal-drawer design. A narrow pane is UNMEASURED,
  // not idle: the phrase that says "Claude is handling this itself" wraps between
  // words below READER_MIN_COLS and would read as absent. Held, not failed.
  'auto-continue-unmeasured': "That session's terminal is too narrow to read safely right now — the nudge is held until it widens.",
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/send.test.ts test/mail-sweep.test.ts test/auto-continue-armed.test.ts test/dialog.test.ts
cd pwa && ./node_modules/.bin/vitest run test/api.test.ts
```

Expected: PASS. `auto-continue-armed.test.ts`'s cross-copy pin must still be green — `AUTO_CONTINUE_RE` and `armWindow` are untouched by design (§6.5 lens 3, §7.4's own sentence).

- [ ] **Step 5: Mutation check, then commit**

Every mutation below was **modelled and run on 2026-09-14** against a standalone build of this task (this file's insert applied to today's `send.ts`, over wave 1's `paneProbe`), and the red quoted is the measured assertion text.

1. Change `probe.width < READER_MIN_COLS` to `probe.width < 1` and re-run `./node_modules/.bin/vitest run test/send.test.ts`: **"holds when the pane is narrower than the readers were calibrated for"** must FAIL with `AssertionError: expected { ok: false, …(3) } to deeply equal { ok: false, …(1) }` — the mutant falls through and the scripted panes take the send to `verify-failed`, which is a different refusal, not a pass. ("is decided BEFORE the pane is even captured" reds beside it.) Restore it.
2. Change `!probe.ok || probe.width < READER_MIN_COLS` to `probe.ok && probe.width < READER_MIN_COLS` and re-run: **"holds when the pane could not be measured at all"** must FAIL (measured, same shape). Restore it.
3. Move the whole new block to AFTER `const armWindow = …` and re-run: **"is decided BEFORE the pane is even captured"** must FAIL with `AssertionError: expected [ [ 'tmux', 'capture-pane', …(4) ] ] to deeply equal []`, and **so must the `gone` case** — its own `capture-pane` assertion reds for the same reason. Restore it. **Take care moving it:** `const pane = await d.tmux.captureAnsi(id);` appears **THREE** times in this file — `:148`, `:498` and `:885` — and the one this step moves is `:498`; `:148` is inside the submit-poll loop and `:885` inside the Enter-press helper. A scripted move that takes the first match silently mutates nothing and prints a green run (measured, 7/7 passing on a no-op edit).
4. Delete the `if (opts.holdIfAutoContinueArmed)` wrapper (leaving the probe unconditional) and re-run: **"control: a caller that did NOT opt in"** must FAIL with `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true }` — measured; the un-opted caller is refused outright, which is louder than the `list-panes` assertion that follows it. Restore it.
5. **The `gone` mutation (§7.4, ruling 13).** Delete the `gone` line entirely, collapsing the two conditions into the held token, and re-run: **"a session that is GONE is not-alive, never held"** must FAIL. **Measured 2026-09-14** on a standalone build of this task: `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: false, error: 'not-alive' }` — the mutant answers `auto-continue-unmeasured`, which is the delivery that never terminates. Restore it.
6. **The ORDER, separately from the arm.** Move the `gone` line to directly BELOW the width test, leaving both conditions present, and re-run: the same case must FAIL with the same text (**measured**) — `!probe.ok` catches a `gone` probe first, so an arm that is merely present but second is an arm that never runs. Restore it. (Mutations 5 and 6 red the same case on purpose: the test pins a behaviour, and there are two independent ways to lose it.)

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/inject/send.ts server/src/watch.ts pwa/src/lib/api.ts server/test/send.test.ts
git commit -m "$(cat <<'MSG'
feat(mail): hold on auto-continue-unmeasured (spec §7.4)

The opt-in caller measures the pane's width before it trusts a phrase
match: below READER_MIN_COLS, or with no measurement at all, the nudge is
HELD rather than typed. armWindow and AUTO_CONTINUE_RE are untouched; the
sweep backs off exactly as it does for auto-continue-armed, and the hold
expires when the width does.

A probe that answers `gone` is NOT held — it is not-alive, above the width
test. That hold counts no attempt, and a dead session's width never comes
back, so holding it would retry the delivery every five minutes forever
instead of parking it after the ceiling.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The drawer says why (§7.5)

**Model routing:** `sonnet@high`.

**Files:**
- Modify: `pwa/src/session/TerminalDrawer.tsx` — the socket construction (`sockRef.current = ws;`, ~487), the attach effect's `ws.onmessage` (~517), one `useState` beside the others, and the JSX between `</div>` of `.term-screen` (~955) and `<div className="term-keys" …>` (~998). **These are post-wave-1 numbers** — wave 1's salvage takes this file from `main`'s 293 lines to ~1060, so `main`'s own 156/190/250-292 are meaningless here. Locate every one of them by the anchor, not the number.
- Modify: `pwa/src/session/chat.css` — after the `.term-retry:active` rule (`main`'s 2215, ~2255 post-wave-1)
- Test: `pwa/test/terminal-grid.test.tsx` (new)

**Interfaces:**
- Consumes: `PaneGridFrame`, `PaneGridReason` (Task 1); `READER_MIN_COLS` (wave 2); the existing `MakeTerm`/`TerminalDrawerProps` and — **as wave 1 leaves it, six members, all REQUIRED** — `export interface DrawerTerm { write(data: string): void; onData(cb: (data: string) => void): void; onWheel(cb: (ev: WheelEvent) => boolean): void; fit(): { cols: number; rows: number }; focus(): void; dispose(): void }` (`pwa/src/session/TerminalDrawer.tsx`). **`onWheel` is wave 1's addition** — salvaged with `08506275`, the commit that stops a wheel notch typing `ESC OA` into the pane — and it is not optional, so any object this task's tests hand to `makeTerm` must supply it or Step 4's typecheck fails with `Property 'onWheel' is missing in type … but required in type 'DrawerTerm'`.
- Produces: `export function parseGridFrame(data: unknown): PaneGridFrame | null` and `export function gridReasonText(g: PaneGridFrame): string | null` from `pwa/src/session/TerminalDrawer.tsx`

- [ ] **Step 1: Write the failing test**

Create `pwa/test/terminal-grid.test.tsx`:

```tsx
// §7.5: the drawer reads the server's binary `grid` control frame off the same
// socket as the pane's own output, and says why the view is the width it is.
// The harness is `terminal.test.tsx`'s, copied because that file's fakes are
// private to it; keep the two in step by hand.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { TerminalDrawer, parseGridFrame, type DrawerTerm } from '../src/session/TerminalDrawer';
import { READER_MIN_COLS } from '../../shared/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  FakeSocket.instances.length = 0;
});

const ID = 'claude:OpenClawHetzner';

class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  binaryType = 'blob';
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; }
}
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

const fakeTermFactory = (cols = 48, rows = 20) => {
  const write = vi.fn<(data: string) => void>();
  const dispose = vi.fn<() => void>();
  const grid = { cols, rows };
  const makeTerm = (_host: HTMLElement): DrawerTerm => ({
    write: (d) => write(d),
    onData: () => {},
    // REQUIRED since wave 1 (`08506275`): a no-op here because nothing in this
    // file scrolls — `terminal-scrollback.test.tsx` is where the wheel is
    // driven. Omitting it is a typecheck failure, not a runtime one, so it
    // would pass Step 2 and red only in Step 4.
    onWheel: () => {},
    fit: () => ({ ...grid }),
    focus: () => {},
    dispose,
  });
  return { makeTerm, write, dispose };
};

const opened = () => {
  const t = fakeTermFactory();
  render(<TerminalDrawer id={ID} open onClose={vi.fn()} makeSocket={makeSocket} makeTerm={t.makeTerm} />);
  const ws = FakeSocket.instances.at(-1);
  if (!ws) throw new Error('drawer opened no socket');
  act(() => ws.onopen?.());
  return { t, ws };
};

/** Raw bytes in a buffer allocated from THIS realm's `ArrayBuffer`. That last
 *  part is load-bearing and was measured, 2026-09-14: under jsdom
 *  `new TextEncoder().encode(...).buffer` is a NODE-realm ArrayBuffer, and
 *  `buf instanceof ArrayBuffer` against the jsdom global answers **false** —
 *  so a fixture built by slicing the encoder's own buffer makes
 *  `parseGridFrame` answer `null` for every well-formed frame and every
 *  rendering case below goes red for a reason that does not exist in a
 *  browser, where `ev.data` under `binaryType = 'arraybuffer'` is always a
 *  realm-native buffer. Allocate, then copy in. */
const rawBinary = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
};

/** A server control frame, on the wire exactly as the server sends it. */
const binary = (frame: unknown): ArrayBuffer => rawBinary(JSON.stringify(frame));

describe('the grid frame', () => {
  it('asks for arraybuffer frames, so a control frame is not a Blob it cannot read', () => {
    const { ws } = opened();
    expect(ws.binaryType).toBe('arraybuffer');
  });

  it('names the columns the history needs, and does not write the frame into the terminal', () => {
    const { t, ws } = opened();
    act(() => ws.onmessage?.({ data: binary({ type: 'grid', cols: 44, rows: 20, reason: 'history-too-small' }) }));
    expect(screen.getByText(/needs .*44 columns/i)).toBeTruthy();
    expect(t.write).not.toHaveBeenCalled();
  });

  it('names the fleet\'s server for a stall-budget floor', () => {
    const { ws } = opened();
    act(() => ws.onmessage?.({ data: binary({ type: 'grid', cols: 110, rows: 20, reason: 'stall-budget', narrowed: true }) }));
    // SCOPED to the stall-budget sentence's own opening words. A bare
    // /110 columns/ matches TWO nodes here — 110 is below READER_MIN_COLS
    // (120), so the §7.6 automation notice renders alongside and names the
    // same number — and `getByText` throws on more than one match.
    expect(screen.getByText(/Narrowing this session below 110 columns/).textContent).toMatch(/server/i);
    expect(screen.getByText(/automation is paused/i)).toBeTruthy();   // and the pair is deliberate
  });

  it('says it could not measure, rather than showing a wire token', () => {
    const { ws } = opened();
    act(() => ws.onmessage?.({ data: binary({ type: 'grid', cols: 220, rows: 20, reason: 'unmeasured' }) }));
    expect(screen.getByText(/could not measure this pane/i)).toBeTruthy();
    expect(screen.queryByText('unmeasured')).toBeNull();
  });

  it('a frame with NO reason says nothing — the client got what it asked for', () => {
    const { ws } = opened();
    act(() => ws.onmessage?.({ data: binary({ type: 'grid', cols: 220, rows: 20, narrowed: true }) }));
    // The whole notes block is absent, not merely empty — 220 carries no reason
    // AND is at or above READER_MIN_COLS, so neither sentence has a subject.
    // `narrowed` is TRUE here deliberately: it isolates the width term, so this
    // case cannot be passed by a build that has lost it.
    // Asserted on the container rather than on `role="status"`: this drawer
    // renders other status nodes of its own (the connection overlay), so a
    // role query here would pass whatever this code did.
    expect(document.querySelector('.term-notes')).toBeNull();
    expect(screen.queryByText(/could not measure/i)).toBeNull();
    expect(screen.queryByText(/needs/i)).toBeNull();
  });

  it('a reason token a newer server invented is dropped, and the grid is still read', () => {
    const { ws } = opened();
    act(() => ws.onmessage?.({ data: binary({ type: 'grid', cols: 43, rows: 20, reason: 'from-the-future', narrowed: true }) }));
    expect(screen.queryByText(/needs/i)).toBeNull();
    expect(screen.getByText(/automation is paused/i)).toBeTruthy();   // 43 < READER_MIN_COLS
  });

  it('raw pane output still reaches the terminal untouched', () => {
    const { t, ws } = opened();
    act(() => ws.onmessage?.({ data: 'WELCOME-FROM-TMUX' }));
    expect(t.write).toHaveBeenCalledWith('WELCOME-FROM-TMUX');
  });

  it('a PANE that prints the frame cannot forge one — text is output, binary is control', () => {
    const forged = JSON.stringify({ type: 'grid', cols: 43, rows: 20, reason: 'unmeasured' });
    const { t, ws } = opened();
    act(() => ws.onmessage?.({ data: forged }));
    expect(t.write).toHaveBeenCalledWith(forged);
    expect(screen.queryByText(/could not measure/i)).toBeNull();
    expect(screen.queryByText(/automation is paused/i)).toBeNull();
  });
});

describe('the automation notice (§7.6)', () => {
  it('says the session\'s automation is paused while the UN-PINNED view is below the reader width', () => {
    const { ws } = opened();
    act(() => ws.onmessage?.({ data: binary({ type: 'grid', cols: 43, rows: 20, narrowed: true }) }));
    expect(screen.getByText(/automation is paused/i).textContent).toContain('43');
  });

  it('says nothing at a width the readers can read', () => {
    // `narrowed` TRUE, width at the floor: the width term alone decides here.
    const { ws } = opened();
    act(() => ws.onmessage?.({ data: binary({ type: 'grid', cols: READER_MIN_COLS, rows: 20, narrowed: true }) }));
    expect(screen.queryByText(/automation is paused/i)).toBeNull();
  });

  it('says NOTHING when the un-pin was REFUSED — against an agent without win-size-v1 this wave is inert', () => {
    // §7.5 / rulings 14-15, and the case that keeps wave 3 shippable ahead of
    // wave 2. 43 columns with NO `narrowed`: `sizer.unpin` answered
    // 'unsupported' (or 'failed'), the tmux window is still pinned at the
    // canonical grid, ccd's readers are NOT standing down and §7.4's hold does
    // not apply — so there is nothing paused to report. Wave 1 renders no notes
    // block at all at this width, and this must be byte-identical to it.
    const { ws } = opened();
    act(() => ws.onmessage?.({ data: binary({ type: 'grid', cols: 43, rows: 20 }) }));
    expect(document.querySelector('.term-notes')).toBeNull();
    expect(screen.queryByText(/automation is paused/i)).toBeNull();
  });
});

describe('parseGridFrame', () => {
  it.each([
    ['a text frame', 'hello'],
    ['a text frame that spells a grid frame', '{"type":"grid","cols":43,"rows":20}'],
    ['a number', 7],
    ['undefined', undefined],
    ['null', null],
  ])('answers null for %s — only a BINARY frame is a control frame', (_label, data) => {
    expect(parseGridFrame(data)).toBeNull();
  });

  it('answers null for binary bytes that are not JSON at all', () => {
    expect(parseGridFrame(rawBinary('{not json'))).toBeNull();
  });

  it('reads a VIEW as well as a buffer — a Uint8Array frame is still a control frame', () => {
    // The `ArrayBuffer.isView` branch, which nothing else here reaches: every
    // other positive case hands it a buffer. (`ArrayBuffer.isView` is
    // realm-independent, so unlike `instanceof` it needs no fixture care.)
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'grid', cols: 43, rows: 20 }));
    expect(parseGridFrame(bytes)).toEqual({ type: 'grid', cols: 43, rows: 20 });
  });

  it.each([
    [{ type: 'not-grid', cols: 1, rows: 1 }],
    [{ type: 'grid', cols: '43', rows: 20 }],
    [{ type: 'grid', cols: 43 }],
    [null],
    [[1, 2, 3]],
  ])('answers null for a binary frame that is not a grid frame: %o', (frame) => {
    expect(parseGridFrame(binary(frame))).toBeNull();
  });

  it('keeps a well-formed frame — reason, narrowed and all', () => {
    expect(parseGridFrame(binary({ type: 'grid', cols: 44, rows: 20, reason: 'stall-budget', narrowed: true })))
      .toEqual({ type: 'grid', cols: 44, rows: 20, reason: 'stall-budget', narrowed: true });
  });

  it('DROPS a reason this build does not know, and keeps the grid it came with', () => {
    // Asserted HERE and not only through the rendering, because the rendering
    // cannot see it: `gridReasonText` answers `null` for an unknown token by
    // its own `default:` arm, so a `parseGridFrame` that passed every token
    // through would render exactly the same page. Measured — the rendering-only
    // version of this check was GREEN against that mutation.
    expect(parseGridFrame(binary({ type: 'grid', cols: 43, rows: 20, reason: 'from-the-future', narrowed: true })))
      .toEqual({ type: 'grid', cols: 43, rows: 20, narrowed: true });
  });

  it('a narrowed that is not literally `true` is dropped', () => {
    // `?: true` has ONE spelling on the wire. Anything else is a peer this
    // build does not understand, and the notice it gates must not fire on it.
    expect(parseGridFrame(binary({ type: 'grid', cols: 44, rows: 20, narrowed: 'yes' })))
      .toEqual({ type: 'grid', cols: 44, rows: 20 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-grid.test.tsx
```

Expected: FAIL — `"parseGridFrame" is not exported by "../src/session/TerminalDrawer.tsx"`.

- [ ] **Step 3: Write the minimal implementation**

In `pwa/src/session/TerminalDrawer.tsx`, add to the imports:

```tsx
import type { PaneGridFrame } from '../../../shared/api';
import { READER_MIN_COLS } from '../../../shared/api';
```

Add at module scope, directly after the `QUICK_KEYS` array:

```tsx
/**
 * The server's `grid` control frame, off the wire (§7.1). It arrives as a BINARY
 * frame while the pane's own output arrives as TEXT, and that split is the whole
 * guard: a pane carries model- and repo-controlled bytes and could print this
 * exact JSON, so sniffing the shape of a text frame would let a session forge
 * its own grid frame. Anything that is not a binary frame carrying a
 * well-formed grid object is `null` and the caller writes it to the terminal or
 * drops it.
 *
 * A `reason` this build does not know (a newer server) is DROPPED while the
 * grid itself is kept — absence-permits, and a sentence nobody wrote is not a
 * sentence to show. `narrowed` is kept only when it is literally `true`: it is
 * `?: true` on the wire, it GATES the §7.6 notice (§7.5, ruling 14), and a
 * truthy-but-not-`true` token from a peer this build does not understand must
 * not fire a sentence about a session's automation.
 */
export function parseGridFrame(data: unknown): PaneGridFrame | null {
  let text: string;
  if (data instanceof ArrayBuffer) text = new TextDecoder().decode(new Uint8Array(data));
  else if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    text = new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  } else return null;

  let m: unknown;
  try { m = JSON.parse(text); } catch { return null; }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const f = m as { type?: unknown; cols?: unknown; rows?: unknown; reason?: unknown; narrowed?: unknown };
  if (f.type !== 'grid' || typeof f.cols !== 'number' || typeof f.rows !== 'number') return null;
  const base: PaneGridFrame = { type: 'grid', cols: f.cols, rows: f.rows };
  if (f.narrowed === true) base.narrowed = true;
  if (f.reason === 'history-too-small' || f.reason === 'stall-budget' || f.reason === 'unmeasured') {
    return { ...base, reason: f.reason };
  }
  return base;
}

/** §7.5: one sentence per reason, in words, naming the number. `null` when the
 *  client got the grid it asked for — there is nothing to explain. */
export function gridReasonText(g: PaneGridFrame): string | null {
  switch (g.reason) {
    case 'history-too-small':
      return `This session's history needs ≥ ${g.cols} columns to scroll without losing lines, `
        + 'so the view stays that wide; it will fit after the session\'s next restart.';
    case 'stall-budget':
      return `Narrowing this session below ${g.cols} columns would stall the fleet's tmux server `
        + 'for every other session it serves, so the view stays that wide.';
    case 'unmeasured':
      return 'Could not measure this pane; showing it at full width.';
    default:
      return null;
  }
}
```

Inside the component, beside the other `useState` calls:

```tsx
  const [gridFrame, setGridFrame] = useState<PaneGridFrame | null>(null);
```

Inside the attach effect, directly after `setState('connecting');`:

```tsx
    setGridFrame(null);   // a fresh attach knows nothing about the window yet
```

Directly after `sockRef.current = ws;`:

```tsx
    // Control frames arrive as binary; without this the browser hands them over
    // as a Blob, which only reads back asynchronously.
    try { ws.binaryType = 'arraybuffer'; } catch { /* a test double may have none */ }
```

Replace the `ws.onmessage` assignment with:

```tsx
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') { term.write(ev.data); return; }   // raw utf8 pane output
      const frame = parseGridFrame(ev.data);
      if (frame !== null) setGridFrame(frame);
    };
```

In the JSX, between the closing `</div>` of `.term-screen` and the `<div className="term-keys" …>`:

```tsx
        {/* THE NOTICE IS GATED ON `narrowed`, NOT ON `cols` (§7.5, rulings
            14-15). `cols` is the PTY's width and is sent on EVERY attach — a
            phone at 43 columns against an agent that has not taken wave 2's
            deploy gets exactly this `cols` with the tmux window still pinned at
            220, ccd's readers still reading and §7.4's hold not applying. Gated
            on `cols` alone this drawer would tell that phone its automation is
            paused, which is false, and wave 3 would have changed visible
            behaviour in precisely the window that must stay wave-1-identical. */}
        {gridFrame !== null
          && (gridReasonText(gridFrame) !== null
            || (gridFrame.narrowed === true && gridFrame.cols < READER_MIN_COLS)) && (
          <div className="term-notes">
            {gridReasonText(gridFrame) !== null && (
              <p className="term-note" role="status">{gridReasonText(gridFrame)}</p>
            )}
            {gridFrame.narrowed === true && gridFrame.cols < READER_MIN_COLS && (
              <p className="term-note term-note--paused" role="status">
                {`This session's automation is paused while the drawer holds it at ${gridFrame.cols} columns — `
                  + 'held nudges and Claude Code\'s own auto-continue resume when you close the drawer.'}
              </p>
            )}
          </div>
        )}
```

In `pwa/src/session/chat.css`, after `.term-retry:active { … }`:

```css
/* §7.5 — why the view is the width it is, and what that costs the session
   while it is. Sits between the glass and the quick-key bar so it is never
   under a thumb, and never over the terminal. */
.term-notes {
  display: grid;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  background: color-mix(in srgb, var(--bg-well) 92%, transparent);
}
.term-note {
  margin: 0;
  font: var(--weight-regular) var(--text-xs) / 1.4 var(--font-sans);
  color: color-mix(in srgb, var(--ink-on-well) 82%, transparent);
}
.term-note--paused {
  color: var(--status-warn-text, var(--ink-on-well));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/terminal-grid.test.tsx test/terminal.test.tsx
cd pwa && ./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS, and a clean typecheck. `terminal.test.tsx`'s nine pre-existing cases must be untouched — this change is additive on one branch of `onmessage`.

Then the whole PWA suite:

```bash
cd pwa && npm run test
```

- [ ] **Step 5: Mutation check, then commit**

1. Change `onmessage`'s first branch to `if (typeof ev.data === 'string') { const f = parseGridFrame(new TextEncoder().encode(ev.data).buffer as ArrayBuffer); if (f) { setGridFrame(f); return; } term.write(ev.data); return; }` — the "sniff the text frame" design — and re-run: **"a PANE that prints the frame cannot forge one"** must FAIL with `AssertionError: expected "vi.fn()" to be called with arguments: [ Array(1) ]` — the terminal never received the bytes the pane printed, because the drawer believed them (**measured 2026-09-14**). Restore it. **This is the security-relevant mutation; record that you ran it.**
2. Change BOTH spellings of `gridFrame.cols < READER_MIN_COLS` to `gridFrame.cols < 1` in the JSX and re-run: **"says the session's automation is paused while the UN-PINNED view is below the reader width"** must FAIL with `Unable to find an element with the text: /automation is paused/i`. **Measured 2026-09-14** (3 cases red, the two stall-budget/from-the-future cases beside it). Restore it.
3. **The `narrowed` gate (§7.5, ruling 14).** Drop the `gridFrame.narrowed === true &&` term from BOTH spellings, leaving the width test alone — which is exactly the pre-audit design — and re-run: **"says NOTHING when the un-pin was REFUSED"** must FAIL. **Measured:** `AssertionError: expected <div class="term-notes">…(1)</div> to be null`. Restore it. This is the mutation that proves wave 3 is inert against an agent without `win-size-v1`; run it and record it beside mutation 1.
4. In `parseGridFrame`, accept any `f.reason` (replace the three-token test and its `return base` with `return { ...base, reason: f.reason as never };`) and re-run: **"DROPS a reason this build does not know"** must FAIL with `AssertionError: expected { type: 'grid', cols: 43, …(3) } to deeply equal { type: 'grid', cols: 43, …(2) }` (**measured**) — the mutant's extra key is the forwarded token. Restore it.
   **Do not expect the rendering case to red on this — measured, it does not.** With the pre-audit test set (the rendering assertion only) this mutation was **GREEN, 25/25 passing**: `gridReasonText`'s own `default:` arm answers `null` for an unknown token, so the page a forwarding parser renders is the page a filtering one renders. The distinction is only visible on the parsed value, which is why mutation 4 names a `parseGridFrame` case.
5. Delete `if (f.narrowed === true) base.narrowed = true;` from `parseGridFrame` and re-run: **"keeps a well-formed frame — reason, narrowed and all"** must FAIL with `AssertionError: expected { type: 'grid', cols: 44, …(2) } to deeply equal { type: 'grid', cols: 44, …(3) }` — **measured**, 5 cases red in that run, the other four being every rendering case that needs the flag to survive the parse. Then change it to `if (f.narrowed !== undefined) base.narrowed = f.narrowed as true;` and re-run: **"a narrowed that is not literally `true` is dropped"** must FAIL with `expected { type: 'grid', cols: 44, …(2) } to deeply equal { type: 'grid', cols: 44, rows: 20 }` (**measured**). Restore it.

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/session/TerminalDrawer.tsx pwa/src/session/chat.css pwa/test/terminal-grid.test.tsx
git commit -m "$(cat <<'MSG'
feat(drawer): the grid frame, and why the view is this wide (spec §7.5/§7.6)

The control frame rides the pty socket as BINARY while pane output stays
TEXT, so a session printing this JSON into its own pane cannot forge one.
Three sentences for three reasons, the number named in words.

The automation notice is gated on the frame's `narrowed`, never on its
`cols`: `cols` is the pty's width and is sent on every attach, so against
an agent without win-size-v1 — where the window is still pinned and ccd's
readers are still reading — gating on it would tell a phone its automation
was paused and make this wave visibly non-inert before wave 2 deploys.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Whole-wave verification, the ledger check, and the PR

**Model routing:** `sonnet@high` (the three review lenses that follow the PR are `opus@high` — see `## Review lenses`).

**Files:**
- Modify: none (verification only; any fix it surfaces is committed under the task it belongs to)
- Test: all three package suites

**Interfaces:**
- Consumes: everything Tasks 1-8 produced
- Produces: a pushed branch and a PR

- [ ] **Step 1: Run all three package suites, in the FOREGROUND**

```bash
cd server && npm run test
```

```bash
cd agent && npm run test
```

```bash
cd pwa && npm run test
```

Expected: PASS, all three (timeout ≥ 600000 ms each). `agent/` is untouched by this wave and must be green unchanged. Re-run any of `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state` IN ISOLATION before calling one a real break.

- [ ] **Step 2: Run the cross-tree ledger scan**

```bash
cd "$(git rev-parse --show-toplevel)" && git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: PASS. It compares this branch's plan entries against `origin/main`'s **without merging** and reds on any allocator-era number defined in two plans — it fires before the merge that would otherwise decide it.

- [ ] **Step 3: Confirm the wave's file boundary held**

```bash
cd "$(git rev-parse --show-toplevel)" && git diff --stat origin/main...HEAD -- ccd/ agent/ deploy/
```

Expected: **no output.** Wave 3's deploy class is `server`; anything under `ccd/` or `agent/` belongs to wave 2 and is AGENT-FIRST. If this prints a file, move that change to wave 2 and tell the coordinator before the PR goes up.

```bash
cd "$(git rev-parse --show-toplevel)" && git diff --stat origin/main...HEAD
```

Expected: only paths from the `## File Structure` table above.

- [ ] **Step 4: Typecheck every package the wave touched**

```bash
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts test/single-definition.test.ts test/node-floor.test.ts
```

Expected: PASS. `typecheck-tests` spawns `tsc --noEmit` for `server/test`, `agent/test` and the whole `pwa` package with pwa's OWN compiler — a new `.ts`/`.tsx` file no project includes goes red here, which is the check that covers the four files this wave created.

- [ ] **Step 5: Push and open the PR**

```bash
cd "$(git rev-parse --show-toplevel)"
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Terminal drawer wave 3: the deliberate un-pin" --body-file - <<'EOF'
Wave 3 of the terminal-drawer program (`docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md` §7). Plan: `docs/superpowers/plans/2026-09-14-drawer-wave3-deliberate-unpin.md`.

A phone-width drawer may now narrow a session's tmux window — but only to a width the pane's own history can absorb, only through the verb wave 2 put on the fleet box, and only while every reader that would type into that pane is told the pane is unmeasured rather than idle.

- `fitFloor` (L1, pure): `(history + height) × ceil(width / W)` against `min(limit, STALL_BUDGET_LINES)`, F13's screen term included, with a reason naming which term bound it.
- `WindowSizer` (L2 port, declared by the route): `pin` is the already-granted `tmux resize-window` and works against an agent of any age; `unpin` is `ccd win-size --mode smallest` behind `capSupported(state, 'win-size-v1')` — no evidence REFUSES, so this wave is INERT until wave 2 is on the fleet box.
- `/ws/pty/:id` now validates `:id` before any `cc-<id>` target is built from it, pins before it spawns, spawns at the floor, un-pins only on a measured probe, and tells the client its grid over an additive BINARY control frame.
- Refcount, not a grid map: the last drawer out re-pins; a no-FIN socket is terminated after two missed pongs so `close` fires and the count stays honest; a boot sweep re-pins every stranded window.
- The mail lane holds on the additive `auto-continue-unmeasured` rather than typing over a wrapped phrase; `armWindow` and `AUTO_CONTINUE_RE` are untouched. A probe answering `gone` is `not-alive` BEFORE the width is consulted (§7.4): that hold counts no attempt, so folding a dead session into it would retry its mail every five minutes forever instead of parking it.
- The drawer says why the view is this wide, and says that the session's automation is paused while it holds it narrow (§7.6, the named residual) — gated on the frame's `narrowed`, which is set only when `ccd win-size` answered `ok`, so against an agent without `win-size-v1` this wave renders exactly what wave 1 renders.

Deploy class: **server**. Touches `server/`, `pwa/`, `shared/` only.

Review lenses (all opus@high; lens 3 is this wave's mandatory security lens — see the plan's `## Review lenses`): concurrency/lifecycle, ring discipline, data loss.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 6: Report the wave-done fingerprint**

Report to the coordinator: the branch name, the handoff commit sha, `git rev-parse HEAD` measured against the workspace branch tip (they must be equal — a worker commits on its workspace branch, never a separate feature branch), the three suites' results, and every `D-TBD-<slug>` this wave wrote (worker skill clause 11).

---

## Deviations found

Numbers are ISSUED, never chosen: allocate with `POST /api/ledger/deviations` and DEFINE in the same act. A session that cannot reach the allocator writes `D-TBD-<slug>` and reports (worker clause 11).

---

## Review lenses

Three lenses, from spec §7.7. All three run `opus@high` (spec §9's per-PR review row).

1. **Concurrency / lifecycle.** The refcount under `terminate()`, the ping cadence, `KeyedQueue` ordering across pin/probe/unpin/re-check, re-check timer disposal, two drawers on one session, and a socket that dies mid-attach. Does any path leave an interval, a pty, or a registry entry behind?

2. **Ring discipline.** `fitFloor` is L1 and pure (no `fs`, no fastify, no timers, no `node:*`); `WindowSizer` is an L2 port declared by its consumer; `ccdWindowSizer` is an L3 adapter that does not narrow a distinction it received (`pin`'s discarded boolean is SPOKEN, `unpin` keeps three verdicts); `pane/drawer.ts` (L4) owns the socket and the timer and DECIDES nothing; no overloaded null at the probe, the sizer, `measuredNum` or `windowWidth`; `shared/api.ts`'s five new definitions import nothing and are spelled once.

2b. **Inertness before wave 2.** Wave 3 may merge first, so measure the claim: with `sizer.unpin` answering `'unsupported'` on every attach, is anything about this build's behaviour different from wave 1's? The window stays pinned, the pty spawns at the floor as wave 1 already had it, and the drawer must render NO notes block at a phone width. The `narrowed` flag is the whole mechanism (§7.5, rulings 14-15); check that nothing else in the diff reads `cols` as a proxy for it.

3. **Data loss — THIS WAVE'S MANDATORY SECURITY LENS.** Spec §9 names only two lenses as mandatory-opus on untrusted input, and both belong to earlier waves (escape replay, wave 1; the exec grant, wave 2). Wave 3's untrusted-input surface is this lens's: the JSON-parsed `resize` frame, the `:id` that reaches `ccd win-size` through the agent where prefix matching leaves every later token unconstrained, and the pane's own model- and repo-controlled bytes arriving on the same socket as the server's control frame. Run it at `opus`, `xhigh`, regardless of pool level. It also owns §7.7's own list: **every path that can leave a window narrow** — no-FIN socket, server restart, an operator's own `tmux attach` at 80 columns (outside the server's control, covered by the readers' stand-down and the boot sweep), and alt-exit after a narrow attach.
