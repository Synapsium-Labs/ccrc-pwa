# The console drawer: history a phone can read, and a window that fits it without lying to the fleet

**Status:** design, approved in principle 2026-09-14 (operator), plans not yet written.
**Supersedes:** PR #96 (`fix/terminal-scrollback`) — closed with this document cited; its salvageable
commits are named in §5.6 and cherry-picked with attribution.
**Escalation:** Fable, for the cross-cutting decision (ccd, the exec whitelist, server rings, the PWA,
the fleet's pane readers). Execution is on Opus and below (§9).

## 1. The idea, and what it must not cost

A phone opens the terminal drawer on one of ~20 live Claude Code sessions. Two things are wanted:

1. **History.** A wheel notch or a finger drag scrolls the pane's scrollback. Today a wheel notch types
   `ESC OA` into the pane (tmux attaches on the alternate screen; xterm has no scrollback there).
2. **Fit.** The live pane is readable on a 43-column screen. Today the window stays at the spawn's 220
   columns and tmux paints 220 columns into a 43-column client — the tail of every long line and none
   of the short ones.

And two things it must not cost, because the fleet runs unattended and reads its own panes:

- **The history itself.** tmux reflows stored lines on a horizontal resize; when the reflow exceeds the
  pane's `history-limit`, the overflow is shed on the next scrolled line and never comes back.
- **The readers.** `ccd` on the fleet box and the server's mail lane decide whether to TYPE into a live
  pane by matching short phrases (`esc to interrupt`, `continuing automatically`, `Enter to confirm`)
  against a capture. A narrow pane wraps those phrases between words, and every such reader fails
  OPEN — a wrapped `esc to interrupt` reads as idle and ccd types `/compact`, a redrive or a bare
  Enter into a running turn (the shape of the 2026-09-08 five-session incident).

The design below gets both wants and pays neither cost. Its one residual is named in §7.

## 2. Measured facts this design stands on

All on tmux 3.4. Private sockets (`tmux -L ccrc-probe-…`) for anything mutating; the live server was
read with `list-panes -a -F`, `show-window-options`, `list-clients` only. Commands are reproducible
from a Linux box; nothing here is remembered.

| # | Fact | How measured |
|---|---|---|
| F1 | `resize-window -x 43` on a 220-col pane with 1853 stored lines reflows `history_size` to 9460. At `history-limit 2000` the next output sheds ~600 lines; restoring 220 leaves 1746 logical lines of 1903 and the oldest is gone. **With the pane created at limit 20000 the round trip is lossless** (1903 → 1906, oldest intact). | private socket, `capture-pane -J -S -N \| wc -l`, `head -1` |
| F2 | `history-limit` latches at pane creation. `set-option -t <s> history-limit` after the spawn reaches later panes only. `set -g history-limit N` BEFORE `new-session` reaches the new pane (measured 6000). A bare `set -g` fails when no server runs — the cold-boot spawn. | private socket |
| F3 | `resize-window` (both `-x/-y` and `-A`) latches `window-size manual`. `set-option -t <s> window-size latest\|smallest` un-latches it. | private socket, `show-window-options` |
| F4 | `window-size latest` follows the client that most recently **typed**, not attached. Phone(43)+desktop(171) on one session: every keystroke alternation reflows; +6 MB tmux RSS per flip, never returned; from ~flip 17 it sheds 50 history lines per flip. | critique panel, node-pty clients |
| F5 | `window-size smallest`: the narrowest attached client wins, deterministic, no flip on keystroke; when the narrow client leaves the wider one's size is restored with zero server action; with zero clients the window keeps its last size. | private socket, `script` clients at 171 and 43 |
| F6 | The node-pty `tmux attach` the server spawns is a full tmux client (`list-clients` shows it; window follows it). | critique panel |
| F7 | `list-panes -t <session>` lists EVERY pane of the current window; `capture-pane -t <session>` reads the ACTIVE pane. PR #96 read row `[0]` and mismatched on a split window (pane 0: 278 lines of history; pane 1 active, 24 rows, `capture-pane` returned pane 1). | private socket |
| F8 | `#{history_limit}`, `#{history_size}`, `#{pane_width}`, `#{pane_height}`, `#{pane_active}`, `#{alternate_on}`, `#{window_width}` are per-pane formats readable through `list-panes -F` — a verb already granted in `agent/src/whitelist.ts`. | `list-panes -F` |
| F9 | While `alternate_on=1` a resize does NOT reflow (6 ms vs 63 ms); the reflow is DEFERRED to alt-exit and lands then, at a moment no guard observes (1852 → 11359 in one step). Nothing scrolls into history while the alternate screen is up, so the numbers at attach ARE the numbers that will reflow. | critique panel |
| F10 | Reflow time is ~linear in the reflowed line count and tmux is single-threaded for every session it serves: narrow/widen 59/100 ms at 1951 lines, 300/714 ms at 11951, 455/1230 ms at 19951. | critique panel |
| F11 | `grep -qiE 'continuing\s+(automatically\|shortly)'` cannot match across the newline grep never presents; `\s` works within a line. `auto-continue-armed.test.ts` pins the TS regex source to `ccd/ccd:13357`'s grep literal by string equality. | GNU grep 3.11 |
| F12 | **Fleet census, 2026-09-14 12:10 UTC, this box:** 31 live panes, ALL `alternate_on=1`, `history_size` min 0 / median 0 / p90 5 / max 11 (25 of 31 are 0), every pane at `history-limit 2000`, global `window-size latest`, 10 windows `manual` (a drawer closed on them), 21 `latest`, one window 302x74, zero clients attached, tmux server RSS 19 MB. **Every pane passes the 43-column fit bound of §7.2 at today's limit.** | `list-panes -a -F`, read-only |
| F14 | **§5.1's pin closes the hazard, measured end to end.** Same session, `window-size latest` as ccd spawns it, 1153 stored lines / 1203 logical. UNPINNED (main today): a 43-column pty client attaches → window 43, `history_size` 1153 → 5771, one line of output, detach, restore 220 → **1046 logical lines of 1203, 157 destroyed**. PINNED FIRST (`resize-window -x 220 -y 50` before the attach): option reads `manual`, the window stays **220 throughout** the 43-column attach, `history_size` unchanged at 1153, and after detach 1205 logical — **zero loss**. | private socket, `script` client at 43 cols |
| F13 | The fit bound must count the visible screen: at its own PERMIT boundary a bound of `history_size × ceil(pane_width/W)` approved a narrow that put the pane 252 lines over its limit and destroyed 200 logical lines on the next scroll. `(history_size + pane_height) × ceil(pane_width/W)` was a true bound against every shape measured. | critique panel |

Two shipped comments in PR #96 assert "tmux never reflows it" (`exec.ts:169`, `server.ts` floor note).
F1 falsifies both. `-J`'s real value is that a logical line survives reflow and the reader wraps it
once at its own width — not that reflow does not happen.

## 3. The invariant

> A session's window is **pinned at the canonical grid** unless a drawer has **deliberately** un-pinned
> it; it is un-pinned only to a width its history can absorb without shedding and only through a
> verb the fleet box advertised; and while it is narrower than the readers were calibrated for,
> **every reader that would type stands down and says so**, rather than reading a wrapped phrase as
> silence.

Everything in §5–§7 is a mechanism for one clause of that sentence, and each mechanism ships with a
test that goes red when it is deleted (CLAUDE.md, mutation-table discipline).

## 4. Shape: four waves, one program

| wave | lands | touches | deploy class |
|---|---|---|---|
| 1 | the latch + the reader | `server/`, `pwa/`, `shared/` | server |
| 2 | the un-pin verb, its grant, the readers' stand-down | `ccd/`, `agent/` | **AGENT-FIRST** |
| 3 | the deliberate un-pin under a guard | `server/`, `pwa/`, `shared/` | server |
| 4 | whole-branch pass, README, CLAUDE.md sentence, ledger reconcile | docs | — |

Wave 1 delivers most of the value alone and is safe with nothing after it. Wave 3 may merge in any
order but DOES nothing until wave 2 is on the fleet box: it un-pins only through the verb, gated on
a capability that the same ccd deploy advertises together with the readers' stand-down (§6.1). All four plans are written before the run opens (the
`crossrepo-programmes` precedent; the coordinator skill fixes a run's ledger at dispatch).

## 5. Wave 1 — the latch and the reader

### 5.1 The latch (server)

`GET /ws/pty/:id` calls `tmux resize-window -t cc-<id> -x 220 -y 50` **before** `spawnPty`. Already
whitelisted; no new grant. It pins the window (F3) at the canonical grid, so the pty client that
attaches next cannot narrow it and no reflow happens. This closes a hazard that exists on `main`
today — 21 of 31 windows are `latest` (F12), so the first phone attach on a fresh session narrows
it — and it costs the phone nothing it has now (the live view stays clipped, exactly as today).
F14 measures both halves of that claim on one session: unpinned, a 43-column attach destroys 157 of
1203 logical lines; pinned first, the window never leaves 220 and the history is untouched.
The close handler keeps its canonical restore; with the window pinned throughout, a peer's close
restoring 220x50 is a no-op rather than the defect PR #96's handoff was built to cure, so wave 1
carries **no** per-client grid map.

Test: delete the pre-spawn call → `pty.test.ts` red (the stub records the resize argv and its ORDER
relative to the spawn).

### 5.2 One measured read of the pane (server, `exec.ts`)

Replace PR #96's `paneScrollback` with a measured read that selects the **active** row (F7) and
tells its failures apart (CLAUDE.md, no overloaded null; the `readFileMeasured` pattern in `io.ts`):

```ts
// list-panes -t cc-<id> -F '#{pane_active} #{history_size} #{history_limit} #{pane_width} #{pane_height} #{alternate_on}'
type PaneProbe =
  | { ok: true; history: number; limit: number; width: number; height: number; alternate: boolean }
  | { ok: false; reason: 'gone' }                        // "can't find pane"/session — measured literal, fixture-pinned
  | { ok: false; reason: 'unreadable'; detail: string }  // tmux non-zero, any other stderr
  | { ok: false; reason: 'unparseable'; detail: string } // no row starts `1 `, or a row fails the shape
```

Wave 3 reads `limit/width/height` from this same probe; it adds no second reader (wire discipline:
one reader per field). The history route calls the probe FIRST and sizes its capture from it:
`-S -<history>` when `ok`, else the constant `PANE_HISTORY_LINES` (2000 — equal to the fleet's
`history-limit`, and the reason it is not raised is F12). PR #96 captured first and probed second;
the order flips so the read is sized by measurement.

### 5.3 The route

`GET /api/sessions/:id/pane/history` as PR #96 shipped it — session-gated when armed, NOT in
`auth/gate.ts`'s EXEMPT table, route counts re-pinned (48/76/73) — with the response additive:
`{ ok, text, lines, scrollback?, alternate?, width? }` where `scrollback` is the probe's `history`,
`width` its `pane_width`, and the three fields are absent exactly when the probe was not `ok`.
`width` is carried because §5.4's scrollback sizing needs the pane's own width to compute its
multiplier and no other field reaches the client with it; it is additive and absence-permitting, so
`FLEET_PROTO` does not move and an older peer omitting it keeps today's meaning. `gone` → 404, `unreadable`/`unparseable`
→ 502 with `detail` (the drawer renders `detail`; PR #96 discarded it).

### 5.4 The drawer (pwa)

PR #96's history layer, touch drag and momentum, with these corrections — each a red test first:

| defect (verified) | fix |
|---|---|
| `paintLag.scrolled(n, px)` credits the ROWS ASKED; xterm clamps at both buffer ends, so the transform paints a phantom displacement for the whole tail of a throw that reaches an end | credit `term.buffer.active.viewportY` delta measured across the `scrollLines` call (synchronous at `smoothScrollDuration: 0`) — **tested in two halves, because jsdom has no layout and a real `Terminal`'s `viewportY` does not move there at all** (measured: 37 before, 37 after, 37 later). The arithmetic is `paintLag`'s, already exported and tested directly with synthetic values. The WIRING — that the adapter reads `viewportY` either side and credits the difference — is tested against a fake `Terminal` whose `viewportY` does move, so both the clamped case (credit 0) and the moving case (credit the delta) are provable. The real-`Terminal` test asserts only the defect's absence: no ±200000px transform at either clamp. Crediting `n` must red the fake-terminal test in both directions. |
| the live glass's `openDown` has no `pointerType === 'mouse'` / `button` guard; a mouse selection drag opens the history over the selection | mirror the history layer's guard (`terminal-scrollback.test.tsx:1028` shape) |
| `term.write(text, () => term.scrollLines(…))` fires after `dispose()` under StrictMode → `TypeError` | an `alive` latch set false before `dispose()`, checked in the callback; test with the REAL `defaultMakeHistoryTerm` |
| a stale history read can overwrite a newer one (`reading` is a state, not a request identity) | a monotonic request id; a response older than the latest request is dropped |
| the history terminal is fitted once; rotation while reading leaves the old grid | refit on `resize` / `visualViewport.resize`, as the live terminal already does |
| xterm `scrollback: lines * 3` under-provisions on a phone | `scrollback = probe.history × ⌈probe.width / term.cols⌉ + term.rows` when the probe is `ok` (a stored line re-wrapped at the drawer's width is at most that many rows; the census has a 302-column window, so the multiplier is measured, not the constant 6), else `lines * 3` |
| `detail` on a failed read is discarded; raw wire tokens shown | render `detail`; three distinct sentences for `gone` / unreadable / no history |
| ctrl+wheel (trackpad pinch) opens the history | ignore wheel events with `ctrlKey` |
| the two "tmux never reflows" comments and `pane-history-route.test.ts:64`'s inverted -J numbers | corrected to F1's wording and numbers |

### 5.5 Review lenses for wave 1

1. **tmux semantics** — every measured claim in a shipped comment re-measured on a private socket.
2. **xterm/React lifecycle** — the table above, plus every listener paired with its removal.
3. **SECURITY (opus, mandatory) — escape-sequence replay.** `capture-pane -e` preserves OSC/DCS/CSI
   from 2000 lines of model- and repo-controlled output and replays them into a SECOND emulator with
   a real scrollback and its own config. The lens confirms the history terminal is opened with the
   live terminal's hardening (no clipboard addon, no proposed API, link handling identical),
   and that an unterminated DCS or an OSC 52 in the capture cannot act.

### 5.6 Disposition of PR #96

Closed, citing this document. A program worker commits on its workspace branch only (worker skill
clause 2), so the branch is not continued. Wave 1 cherry-picks with `-x` and the author's
`Co-authored-by:` trailer: `08506275` (the wheel), `842446cc` (the door), `8512cd74` (a pane with
nothing above says so), `53671c68` (`-J`), **`1c4e79fe` (the console keeps its own drag)**, and the
touch/momentum chain `f5fe38e5` `39d8d9af` `85e4394a` `4d274cb9` `5d65f8aa` `644f4173` `6493be32` —
then applies §5.4. Dropped: `df82702d` and `1dee05ab` (the window-follow and the floor's removal),
which §6 replaces.

`1c4e79fe` was missing from this list on first writing; wave 1's plan measured the omission and it is
corrected here rather than worked around. It is `handleOnly` on the full-height sheet plus a real
`Drawer.Handle`, and without it vaul's panel claims every pointer drag across the console glass — a
swipe to scroll collapses the drawer instead. Two obligations ride with it, because `Sheet` is shared:

- the plan **enumerates every full-height `Sheet` consumer** and shows each renders a `Drawer.Handle`;
  a full-height sheet with `handleOnly` and no handle cannot be dismissed by drag at all, and that
  regression must be proven absent rather than assumed;
- `handleOnly` ships with a test that reds when it is deleted. PR #96 shipped it with none — measured
  across all 2277 of its pwa tests — and this design does not inherit that gap.

**Closing PR #96 is a step, not an assumption.** Wave 1's final task, after the replacement PR is
open, runs `gh pr close 96` with a comment naming this spec and that PR. If `gh` is unavailable the
worker records the refusal and reports (worker clause 11) rather than leaving it silently open.

## 6. Wave 2 — the fleet box learns to un-pin, and its readers learn to stand down (AGENT-FIRST)

### 6.1 The verb

```
ccd win-size --session <id> --mode smallest|canonical
```

- `<id>` validated by ccd's own id class (`^[a-z][a-z0-9-]{0,31}$`), target `cc-<id>`; unknown mode
  or absent session → exit 1, one-line reason on stderr, nothing run.
- `smallest` → `tmux set-option -t cc-<id> window-size smallest`. Un-latches `manual` (F3); tmux then
  sizes the window to the narrowest attached client (F5) — deterministic, keystroke-stable,
  self-healing when that client leaves. **Not `latest`** (F4).
- `canonical` → `tmux resize-window -t cc-<id> -x 220 -y 50`. Restores the grid with or without
  clients attached and re-latches `manual`, which IS the pinned state §3 wants. **The server does
  not depend on this arm**: its own pin (§5.1, §7.3) is the already-granted `tmux resize-window`,
  which works against an agent of any age. Its callers are an operator typing the verb on the box
  and the agent's `win-size` grant — NOT ccd itself (measured 2026-09-16: no ccd function calls
  own use (a `ccd` that pins a session it just spawned needs no server).
- Advertised in `cmd_caps` as `win-size-v1`, and the cap is the proof of BOTH halves of this wave —
  the verb and §6.3's stand-down ship in one ccd, so a server that sees the cap knows the readers on
  that box already yield to a narrow pane. The server gates on `capSupported(state, 'win-size-v1')`
  (null → false), never `verbSupported` (null → true, "an absent list must never grey out the fleet"
  — the wrong gate for a verb that never existed). An un-upgraded agent simply leaves the window
  pinned: wave 1 behaviour, no fallback path, no second mechanism.
- `aggressive-resize` is left alone (measured no-op for a one-window session).

### 6.2 The grant

`agent/src/whitelist.ts`: `['win-size', '--session']`, and `win-size` enrolled in
`REQUIRED_VERB_FLAG` with `--session` — the `coord-pause --state` precedent: the tail can reach
nothing destructive, but this tree's doctrine is that a verb whose whole argument surface is a flag
is enrolled, so a bare `['win-size']` is a compile error. Negative fixture in `test/types/bypasses/`
for the bare shape; `whitelist-subset.test.ts` extended. This is a **fleet-control** verb, outside
CLAUDE.md's "zero new ccd verbs for coordination mutation" (which is about the coord surface); the
README's whitelist rationale gains the sentence that says so.

### 6.3 The readers stand down below the calibration width

One helper, one definition, in `ccd/ccd`:

```
_pane_measurable <id>    # 0 when #{pane_width} of cc-<id>'s active pane >= READER_MIN_COLS, else 1
```

Every site that decides to TYPE on the strength of a phrase match calls it first and stands down
when it answers 1: `_session_hard_blocked`, `_auto_stale_check`, `_auto_compact_check`, `_redrive`,
the `_spawn_settle` Enter gates and their discriminators, and `_pane_auto_continue_armed` — which
answers **armed** (hold) when unmeasurable, the one direction that cannot cancel a continuation.
The regex literals are NOT changed (F11 — and `auto-continue-armed.test.ts`'s pin stays a mechanism).

`READER_MIN_COLS` is a named constant with a derivation: the widest single-line carrier of the four
phrases measured with `wrap-ansi` (Ink's wrapper, `hard:false`) over Claude Code's known status-line
shapes at widths 40–220, plus margin. The plan's first task measures it; the design's placeholder is
120, which keeps a 171-column desktop client measurable and every phone below it. Two copies exist by
construction (`shared/api.ts` for the server, the bash constant for ccd) and a test holds them equal,
the way `auto-continue-armed.test.ts` holds the regex.

Mutation test: a scan over `ccd/ccd` finds every line carrying one of the four phrases in a `grep`
and asserts a `_pane_measurable` guard precedes it in the same function; removing one guard → red.

### 6.4 Not in this wave: raising `history-limit`

F12 says the fleet's histories are transient (Claude Code's `ESC[3J` on repaint) — 25 of 31 at
zero, max 11 — so every live pane fits at 43 columns under today's 2000, and the guard in §7.2
refuses the rare full pane with a reason rather than shedding it. A raise would cost tmux memory and
whole-server stall (F10) for a case the census says does not occur. If a later census disagrees, the
lever is one line in `ccd/tmux.conf` (`set -g history-limit N`, read at server start — F2 — and
installed to `~/.tmux.conf` by `deploy.sh:680`), with a best-effort `set -g` in the spawn path for a
server already running; neither reaches a pane that already exists.

### 6.5 Review lenses for wave 2

1. **SECURITY (opus, mandatory) — the exec grant.** Prefix matching leaves every token after
   `['win-size','--session']` unconstrained; the session id arrives off a JSON-parsed frame; ccd's
   own validation is the whole gate. The lens proves the bare shape fails to typecheck and the id
   class is enforced before any `tmux` runs.
2. **ccd call shape** — the verb's exit codes and the `cmd_caps` advertisement; the shared-server
   option mutation is scoped to `-t cc-<id>` and never global.
3. **Reader parity** — the TS and bash phrase sets still agree; `armWindow` (`send.ts:512`, the
   8-line slice from D-2368's final review) is untouched; the stand-down covers every typing site.

## 7. Wave 3 — the deliberate un-pin

### 7.1 Flow on `GET /ws/pty/:id`

```
pin(id)                                  # §5.1: the server's own `tmux resize-window 220x50`, unchanged
probe = paneProbe(id)                    # §5.2
floor = fitFloor(probe, clientCols)      # §7.2 — L1, pure
pty   = spawnPty(id, max(clientCols, floor.cols), clientRows)
if probe.ok && floor.cols <= clientCols && sizer.unpin(id) === 'ok':
    # `ccd win-size --mode smallest` through the agent; tmux now follows the pty (F5)
send {type:'grid', cols, rows, reason?}  # server→client, additive; absent reason = the client's own grid
```

`sizer.unpin` answers `'ok' | 'unsupported' | 'failed'` — three conditions the route handles
differently (`unsupported` = pinned, say nothing; `failed` = pinned, log; never `null`).

### 7.2 The fit floor (L1 policy module, no I/O)

```ts
need(W)   = (history + height) × ceil(width / W)          // F13: the screen counts
floor     = the smallest W in [clientCols, width] with need(W) <= min(limit, STALL_BUDGET_LINES)
reason    = 'history-too-small' when floor > clientCols and the binding term was `limit`,
            'stall-budget' when it was STALL_BUDGET_LINES
```

`STALL_BUDGET_LINES = 6000` bounds the whole-server stall (F10: ~linear; 12000 lines ≈ 1 s of
nobody served, so 6000 caps a narrow-plus-widen round trip near half a second). It lives in
`shared/api.ts` beside `READER_MIN_COLS`, and F12 says today's fleet never approaches it. `alternate_on` is **neither a permit nor a refusal**: the reflow is deferred (F9) but its size
is exactly `need`, and nothing grows history while the alt screen is up — so the bound computed at
attach is the bound that lands at alt-exit. A comment carries the 1852 → 11359 measurement so nobody
re-derives "alt means free". An unmeasurable probe → floor = `width` (no un-pin), reason
`unmeasured`.

### 7.3 Refits, re-checks, and leaving

- A `resize` frame passes ONE validator (`measuredNum`: finite, > 0, floored) shared with the query
  string; a frame that fails leaves the pty and the grid untouched. Under `smallest` a pty resize is
  all it takes; the floor clamps it and the `grid` frame says so.
- Every `RE_CHECK_MS = 30_000` (the ping cadence, one timer) the route re-probes and re-floors; a
  floor that rose above the pty's width widens the pty and sends a `grid` frame (history can grow
  while a drawer is open on a busy non-alt session).
- **Refcount, not a grid map.** `Map<id, Set<socket>>`; on close remove; empty → `sizer.pin(id)`.
  An intermediate close self-heals under `smallest` (F5) with no server action.
- **No-FIN sockets.** A ws ping every 30 s, `terminate()` after two missed pongs, so `close` fires and
  the refcount is honest. Test with `socket.terminate()` — the case none of PR #96's seven pty tests
  drove. This is a data-loss fix, not tidiness: a leaked count is a window left narrow forever (F5).
- **Boot sweep.** On server start, for every registry session, `list-panes -F '#{window_width}'`; any
  window not at 220 with no drawer attached (all of them, at boot) → `pin`. A restart cannot strand a
  narrow window, and the census's 302x74 stray is corrected the same way.
- All `resize-window` / `win-size` / probe calls for one session go through the existing
  `KeyedQueue`, in order (PR #96 fired four un-awaited resizes).

### 7.4 The mail lane holds when it cannot read

`sendPrompt(..., { holdIfAutoContinueArmed: true })` first reads the probe's `width` (same queue).
`width < READER_MIN_COLS`, or the probe unreadable/unparseable → `{ ok: false, error:
'auto-continue-unmeasured' }` — an additive error token the sweep backs off on exactly as it does for
`auto-continue-armed`. `armWindow` and `AUTO_CONTINUE_RE` are untouched; the hold expires when the
width does.

**`gone` is NOT held — it is `not-alive`, and the order of the two checks is the whole of it.** A
probe answering `gone` means the session is dead, which the existing `captureAnsi === null` arm
already reports as `not-alive`; folding it into the held token would be this design narrowing a
distinction `PaneProbe` went to four arms to preserve, and the cost is not cosmetic. The sweep's
back-off for `auto-continue-unmeasured` **counts no attempt** by design — a hold is not a failure —
so a dead session whose mail read `unmeasured` would be retried every five minutes forever, with a
message claiming a drawer is open on a pane that no longer exists. So the `gone` arm returns
`not-alive` BEFORE the width is consulted, and it ships with its own test and its own mutation:
collapse the two and mail to a dead session must never terminate.

### 7.5 The drawer says why

The `grid` frame's `reason` renders as one sentence: `history-too-small` → "this session's history
needs ≥ N columns to scroll without loss; it will fit after its next restart"; `stall-budget` → the
same shape naming the server; `unmeasured` → "could not measure this pane; showing it at full
width". While the view is narrow the drawer also states that the session's automation is paused
(§7.6), so the operator is never surprised by a held nudge.

**That sentence is gated on the un-pin having HAPPENED, not on the client's own width**, or wave 3
stops being inert. The frame carries `narrowed?: true` — additive, set only when `sizer.unpin`
answered `'ok'` — and the automation notice requires `narrowed === true && cols < READER_MIN_COLS`.
Against an agent that has not taken wave 2's deploy, `unpin` answers `'unsupported'`, the window
stays pinned at the canonical grid, ccd's readers are NOT standing down and §7.4 does not hold — so a
phone told "automation is paused" there would be told something false, and wave 3 would have changed
visible behaviour in exactly the window that must be wave-1-identical. The same applies to
`'failed'`. `cols` alone cannot carry this: it is the PTY's width, which is sent on every attach
whether or not the window followed it.

### 7.6 The residual, named

While a phone holds a session narrow, that session's automation **waits**: ccd's typing stand-downs
and the mail lane's nudges hold until the drawer closes and the width returns. That is bounded by the
drawer's open time, it is visible in the drawer, and it is the correct direction — a session under a
human's eye yields automation rather than having automation type over the human. Removing the
residual (readers that read at 43 columns) needs a real Ink capture at phone width, a two-box
phrase sweep, and its own spec; it is later work, not a prerequisite (§10).

### 7.7 Review lenses for wave 3

1. **Concurrency / lifecycle** — refcount under terminate, ping cadence, queue ordering, re-check timer
   disposal, two drawers on one session.
2. **Ring discipline** — `fitFloor` is L1 and pure; `WindowSizer` is an L2 port declared by the route;
   no overloaded null at the probe or the sizer seam; the socket handler (L4) decides nothing.
3. **Data loss** — every path that can leave a window narrow: no-FIN, server restart, an operator's
   own `tmux attach` at 80 columns (outside the server's control, covered by the readers' stand-down
   and the boot sweep), alt-exit after a narrow attach.

## 8. Wave 4 — the pass, the docs, the ledger

- Whole-branch review of waves 1–3 together (the coordinator skill's final pass).
- README: Deploy (AGENT-FIRST for wave 2), the new verb and grant, the route, the `grid` frame.
- CLAUDE.md, beside SAFETY, the measured sentence: *"ccd spawns every session `window-size latest`,
  so a pty client at a phone's width narrows the window, reflows the history and SHEDS it at the
  pane's `history-limit`; the drawer latches `manual` at the canonical grid before attaching and
  un-pins only through `ccd win-size` under the fit guard. `resize-window` latches `manual`;
  `set-option window-size smallest|latest` un-latches but does not restore."*
- Ledger: no `D-N` is minted by this design — a deviation is a departure from a PLAN, and PR #96 was
  never one. Each wave's plan defines its own numbers as departures occur, minted through
  `POST /api/ledger/deviations`. **A plan is a TRACKED file, so it may never carry a concrete
  `D-TBD-<a real slug>`**: `server/test/dtbd.test.ts` git-greps every tracked file for
  `D-TBD-[a-z0-9]` and reds the tree on a hit. Plans name a pending departure in prose, or with the
  `<slug>` meta-form the guard's own comment prescribes; the concrete token exists only in mail and
  in a worker's report, never on disk.
- Carried constraint, not a wave: PR #94 (the macOS `script(1)` fix) **MERGED as `fb19772e` on
  2026-09-14 at 11:50 UTC, and `main` is green on every leg including `test-macos`** — the four-week
  red is over and D-2614 is closed. Its residual is therefore LIVE rather than pending, and its text
  does not name it: on the non-tty path Apple's `script.c` handles stdin EOF by writing VEOF and
  setting `readstdin = 0`, and the re-arm at `:318` is guarded by `ttyflg`, which that path never
  sets — so if the `cat` copier dies, the operator's code channel is removed silently and
  irrecoverably while `script` runs on to its deadline. Reported to its author with the source
  citation, as a finding against merged code. This program takes no dependency on it either way.

## 9. Program and routing

One program, four waves, four plans written before the run opens. Coordinator: this session, on
**Opus** (`/model opus` before the first dispatch — the 2026-09-04 incident was a Fable session
fanning out; switching at the source closes it). No settings-file enforcement: `.claude/` is
gitignored here and `shared/modelenv.mjs` is `CLAUDE_CODE_SUBAGENT_MODEL`'s single writer; every
Workflow script passes `model:` on every `agent()`. Execution stays on the subscription; the
handoff gate does not open.

| role | model | effort | note |
|---|---|---|---|
| coordinator (dispatch, mail, handoff review) | opus | high | Fable only for this document |
| wave workers | sonnet | high | brief says `/model sonnet`, `/effort high` |
| **three named tasks → opus@high** | opus | high | (1) the `win-size` verb body and its validation, in `ccd`'s spawn neighbourhood; (2) the whitelist entry + `REQUIRED_VERB_FLAG` + bypass fixtures — proof-by-typecheck against an adversarial type; (3) `_pane_measurable` and its sweep over the typing sites |
| per-PR review lenses (3 per wave, §5.5 §6.5 §7.7) | opus | high; **xhigh for wave 2** | the two untrusted-input lenses are opus regardless: escape replay (w1), the exec grant (w2) |
| refute pass, one per finding | sonnet | high | concrete claims |
| scouts, route counts, fixture capture | haiku | low | |
| `READER_MIN_COLS` measurement (wave 2 task 1) | sonnet | high | `wrap-ansi` over known status shapes, no live session |

## 10. Later, and not here

- **Width-proof readers** (automation that reads at 43 columns): needs a real Ink capture at phone
  width (a throwaway session on a private socket), a decision on `armWindow`'s size at narrow
  widths (8 lines at 43 columns carry a third of the content), and a join-before-match at ~14 ccd
  sites plus the server. Its own spec.
- **`history-limit` raise**: only if a later census contradicts F12. Lever in §6.4.
- **Horizontal panning** of a full-width live view: an alternative to narrowing, using the drag the
  reader already has; unneeded while the un-pin works.

## 11. Decisions recorded here (Fable rulings)

1. `smallest`, not `latest`, is the following mode (F4/F5).
2. The window is pinned before every attach and un-pinned only through an advertised verb (§3).
3. `win-size` is a fleet-control verb, enrolled in `REQUIRED_VERB_FLAG`; no `set-option` grant.
4. The readers are not rewritten; they stand down below `READER_MIN_COLS` and the mail lane holds
   on `auto-continue-unmeasured`. A narrow pane is unmeasured, not idle.
5. `alternate_on` is context: neither permit nor refusal.
6. No `history-limit` raise (F12).
7. PR #96 is closed and salvaged by cherry-pick with attribution (§5.6).
8. The fit bound counts the screen (F13) and carries a stall budget (F10).
9. `1c4e79fe` is salvaged (§5.6): `handleOnly` is claim 9 and the console's drag depends on it. It
   ships with a full-height-`Sheet` consumer census and the red test PR #96 never had.
10. `PaneHistoryReply` carries `width?` (§5.3) — additive, absence-permitting, one reader.
11. §5.4 row 1 is tested in two halves (arithmetic in `paintLag`, wiring against a fake `Terminal`),
    because a real `Terminal`'s `viewportY` does not move under jsdom.
12. Plans never carry a concrete `D-TBD-<slug>` (§8).
13. A probe answering `gone` is `not-alive`, checked BEFORE the width (§7.4). Holding it would retry
    a dead session's mail forever, because the hold counts no attempt.
14. The automation-paused notice is gated on `narrowed === true`, not on the client's width (§7.5).
    `cols` is the pty's width and says nothing about whether the window followed it, so gating on it
    would make wave 3 visibly non-inert before wave 2 deploys.
15. `PaneGridFrame` carries `narrowed?: true`, set only when `sizer.unpin` answered `'ok'`.
