# The terminal drawer at every width: a window-sized client, a wrapped view for narrow glasses, and a guarded follow for wide ones (design)

**Status:** DRAFT rev 1 — operator chose stages 1+2 with recommendations on 2026-10-14; for review in the docs PR.
**Date:** 2026-10-14 · **Base:** `origin/main` `e66ca6ac` (PR #190) · **Branch:** `ws/drawer-every-width`
**Plan:** `docs/superpowers/plans/2026-10-14-terminal-drawer-every-width-stage1.md` (stages 1 and 1b). It is the single home of this design's deviation numbers, D-5005 to D-5013 (§13). Stage 2 gets its own plan once stage 1 is on the box, and that plan cites these numbers rather than redefining them.
**Program ledger:** `docs/superpowers/programs/terminal-drawer-fit.md`.
**Supersedes** (D-5013):
- §7 (wave 3, "the deliberate un-pin") of `docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md`. With it go that spec's rulings 1, 13, 14 and 15 and the mail-lane half of ruling 4 (its §11). §3 below says how rulings 2 and 3 carry over.
- Its unbuilt plan, `docs/superpowers/plans/2026-09-14-drawer-wave3-deliberate-unpin.md`.

Waves 1 (#106) and 2 (#117) stand unchanged. PR #190's `consoleFit` becomes this design's view chooser.

**Related:** #96 (closed; the window followed the client), #102 (the 2026-09-14 design), #106, #117, #190 (the interim type fit).

**Measurements:**
- Taken in an `ubuntu:24.04` container with tmux 3.4.
- Real Claude Code 2.1.299 ran against a local fake Messages API, on private `-L` sockets. The fleet box was not touched, and nothing below was captured from a live session.
- **[M]** is measured; **[I]** is inferred.
- Code is cited by function or constant at `e66ca6ac`. Line numbers are hints, written `≈:N`.

## What rev 1 changes from rev 0

Rev 0 was the judged draft. Rev 1 records the operator's rulings and corrects what writing it down found.

1. **Rulings recorded** (§12). Stages 1 and 2 are chosen, each open item takes its recommendation, and the phone live lease (O1) is deferred.
2. **Numbers issued and defined** (§13): D-5005 to D-5013, in the plan's Deviations section.
3. **B0's first sight now proceeds** (§6.1). Rev 0 stood a reader down on the first geometry it saw. Every spawn is a fresh process, so `_accept_first_run_prompts` would have returned rc 6 on its first iteration on every spawn, and every one-shot `ccd route --apply` would have stood down. A change still stands down the whole supervisor tick it is seen in, as rev 0 said, and not only the one call that saw it.
4. **The route-apply door waits for the settle** (§6.5). `POST /api/sessions/:id/route` runs `ccd route --apply` outside `Deps.queue`, so rev 0's queue hold did not cover it.
5. **The real-tmux test measures geometry with tmux's own formats** (§9). The screen-equality half (W6) moves to a PWA test over recorded streams, so the server takes no terminal-emulator dependency.
6. **The "not Claude Code" chip keys on the `❯` glyph alone** (§5.3), not on copies of `hasMenu` and `promptBoxShowing`, which stay on the server. Menu taps (1b) are gated on the server's own dialog verdict (§5.5).
7. **Typed text is sanitised before framing** (§5.4). Pasted text carrying `\e[201~` would otherwise end the bracketed paste early and run the rest as keystrokes.
8. **The `drawer.follow` carrier is named**: `CCRC_DRAWER_FOLLOW` (§6.3).
9. **Citations corrected:** `FleetWatcher.detectDialogs` (≈:7503; the class itself is ≈:670) and `Tmux.paneProbe` (≈:190; `PANE_PROBE_FORMAT` is ≈:126).

## In short

- **The drawer pans sideways on every glass narrower than about 1480 CSS px.** That covers every phone, every tablet and most laptops [I, §1.2]. The window is pinned at 220x50, and a client narrower than the window is a viewport that tmux pans to follow the cursor.
- **The pin stays; the client changes.** Stage 1 attaches a client exactly the window's size: 220x51, which is the 50 window rows plus tmux's status row.
  - Measured: the client's screen equals `capture-pane -p` on 50 of 50 rows, and the window stays 220x50 under both `manual` and `latest`, including while typing [M].
  - Where 220 columns fit at 11px or more, the drawer shows that grid (PR #190's fit).
  - Where they don't, the browser re-wraps the same live screen to the glass width at 14px. On phones it adds a key bar and a native text field.
  - No change to the server's behaviour, the agent, ccd or tmux is needed.
- **Wide glasses make the window follow them (stage 2).** A drawer that shows 120 or more columns at 14px has the window resized to its grid by the server, through `resize-window`, which is already granted. Claude Code then draws natively.
  - The floor is `READER_MIN_COLS`, so ccd's readers stay calibrated and the mail lane never meets a narrow pane.
  - A one-tick ccd stand-down on any change in window geometry, plus a server-side settle hold, keep every reader off the roughly 50 ms repaint that follows a resize.
  - Stage 2 does nothing until ccd advertises `geom-settle-v1` (operator ruling O4).
- **Phones never narrow a window** in this design. The automation pause that the 2026-09-14 spec accepted as a residual (§7.6 there) does not occur.

## 1. The problem, measured

### 1.1 What ships today

- **Route** `GET /ws/pty/:id` (`server/src/server.ts`, ≈:1743-1824):
  - It fires `resizeWindow(id, PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS)` without awaiting it (≈:1805), which latches `window-size manual`.
  - It spawns `tmux attach` at the grid the client asked for (≈:1806), parsed by `dim()` (≈:1738).
  - It forwards `{type:'resize'}` frames to the pty (≈:1808-1816).
  - On close it pins to 220x50 again, with no refcount (≈:1822).
  - Remote mode carries the same columns and rows to the agent (`server/src/remote/pty.ts` → the agent's `ptyOpen` arm in `agent/src/server.ts` → `agent/src/pty.ts`). The agent does not clamp them [M, code].
- **PWA** (`pwa/src/session/TerminalDrawer.tsx`):
  - `fitToWindow` (≈:710) runs `consoleFit` from 14px down to 11px for 220 columns, against the constant `PINNED_WINDOW_COLS` (`shared/api.ts`). If 220 doesn't fit, the drawer stays at 14px and shows `window 220 cols · pans` (≈:1322-1335).
  - `refit` (≈:934) sends a resize frame whenever the glass grid changes.
  - `QUICK_KEYS` (≈:476) has no Ctrl key, although the app tells operators to clear the box "in the terminal (Ctrl-C once)" (`SEND_ERROR_TEXT` ≈:61 and `SUBMIT_ERROR_TEXT` ≈:114, `pwa/src/lib/api.ts`).
  - xterm 6.0.0 binds no touch selection, so a phone cannot copy text (≈:921).

### 1.2 Where it pans, by width [I]

These figures assume a 0.6 em cell (8.4px at 14px) and a 30px gutter plus scrollbar, so 220 columns fit at `(glass − 30) / 132` px. They agree with the phone's measured 43 columns (2026-09-14 spec) and with #190's measured 185 columns at 14px.

| Glass (CSS px) | Example | Columns at 14px | Today |
|---|---|---|---|
| 320–430 | phones | 34–47 | pans; 15–21% of the window visible |
| 768–1024 | tablets | 87–118 | pans |
| 1280–1481 | small and 13" laptops | 149–172 | pans (189–219 columns even at 11px) |
| 1482–1877 | 14"/16" laptops | 172–219 | fits at 11–13.9px (11.2px at 1512) |
| ≥1878 | 1920 and wider | ≥220 | fits at 14px; everything past 220x50 is tmux's `·` filler [M] |

### 1.3 Facts this design stands on

| # | Fact | How measured |
|---|---|---|
| W1 | Claude Code runs on the alternate screen. Across resizes from 220 to 45, then 300, then back to 220, `history_size` stayed 0 and `alternate_on` stayed 1. The fleet census of 2026-09-14 (F12 there) found 31 of 31 panes `alternate_on=1`, median history 0. | [M] rig; census [M] but a month old |
| W2 | A resize alone loses nothing. **Output that arrives while a window is narrow** sheds about `history-limit/10` rows per line once the reflowed history is over the limit. Example: 20 lines at W=45 on a pane holding 1850 dense lines lost 840 lines at limit 2000, and 0 at 10000. | [M] rig, line-tagged FIFO pane |
| W3 | Below 120 columns the server's readers break, and nothing on the server knows the width: (a) `AUTO_CONTINUE_RE`'s phrase splits at 43–45 columns, so the mail lane types and cancels Claude Code's limit continuation; (b) one permission prompt's `parseDialog` id changed at 60x30, 45x20, 45x14 and 100x14; (c) the statusline parse lost ctx at 100 columns, ctx and branch at 80, and every field at 45. ccd stands down below 120 by design (`_pane_measurable`). | [M] `wrap-ansi@9` and rig; `origin/main`'s own parsers run on the captures |
| W4 | **Between 120 and 300 columns, at 22 rows or more,** a 4-option permission prompt with a 132-character option label hashed to one `parseDialog` id at ten sizes (120x22 … 300x79). | [M] rig; `origin/main`'s `parseDialog` run on the captures |
| W5 | **A resize leaves a repaint window.** A capture right after narrowing read only `─` and `❯`; Claude Code had repainted within about 13 ms, and every capture was complete by 50 ms. A capture right after widening shows the old layout padded out. | [M] rig, `pipe-pane -o` timestamps |
| W6 | **A client the window's size moves nothing.** A 220x51 `tmux attach` on a 220x50 window (status on): its rows 0–49 equal `capture-pane -p` on 50 of 50 rows, idle and with a draft. Row 50 is the status line. The window stays 220x50 under `manual` and under `latest`, through the attach and through typing. | [M] rig, pyte model |
| W7 | Attach redraw is 6.1–17.5 KB. The stream is 0.27 KB/s while busy and 0 when idle. Keystroke-to-echo median is 6.8 ms (local). | [M] rig |
| W8 | `resize-window -x C -y R` latches `manual`. Under `manual` no client moves the window: a second client, a SIGWINCH and a human attach were all tested. With status on, a client of R rows views a window of R−1 rows exactly. A window keeps its last size after its last client leaves. | [M] rig |
| W9 | An `@xterm/xterm` 6.0.0 `Terminal` that is never `open()`ed still parses the alternate screen, keeps per-cell 24-bit colour, tracks the cursor and fires `onWriteParsed`. | [M] jsdom; real browser [I] |
| W10 | A structure-aware re-wrap of a 220x50 Claude Code screen. Rows at W=45 (a character wrap of the same screen in brackets): permission prompt 52 (58), markdown with a table 83 (104), multi-select 45 (51), Write preview 47 (55), reply done 43 (53), busy 49 (59). Never more rows than the character wrap at any W measured below 220. No false joins across six screens. 0.9–1.3 ms per frame on node. | [M] prototype on the rig's captures |
| W11 | Claude Code 2.1.299 hides the terminal cursor and draws a reverse-video caret cell. Ctrl-C clears a draft and then shows `Press Ctrl-C again to exit`. Bracketed paste of two lines lands as two lines in the box and is not submitted. | [M] rig |
| W12 | The agent kills every pty when its link to the server closes (the `ws.on('close')` handler in `agent/src/server.ts`, ≈:1279). | [M] code |
| W13 | ccd's keystroke gate also needs Claude Code's status file to say `idle` and to have been quiet for at least `COMPACT_QUIET` (60 s) (`_idle_for_keystroke`). A repaint window can therefore fool its draft check (`_pane_box_has_content`) but cannot make it type into a running turn. | [M] code; [I] consequence |

## 2. Goals and non-goals

**Goals**
1. No sideways panning at any glass width from 320px to ultrawide.
2. Every job the drawer exists for works on a phone:
   - answering menus the chat cannot parse;
   - recovering the input box (Ctrl-C);
   - reading the full question text;
   - copying text;
   - typing a short answer.
3. Laptops and wide screens see Claude Code's own layout at 14px, and a wide monitor uses its width.
4. Opening a drawer never narrows a window below `READER_MIN_COLS`, never sheds history, and never lets a reader act on a repaint.
5. Old cached bundles and old servers keep working in every combination.

**Non-goals**
- Claude Code's own native layout below 120 columns. That is the phone live lease (§12, O1), deferred.
- Raising `history-limit`. W1 makes it unnecessary for Claude Code panes.
- A history channel other than the existing `capture-pane` read layer.
- Changing ccd's spawn geometry or `ccd/tmux.conf`.

## 3. Contracts this design keeps

- **The pin** (2026-09-14 spec §5.1, F14). Every drawer attach is still preceded by the 220x50 pin, unless the window sizer (§6.3) is holding the window for a following drawer.
- **The 2026-09-14 rulings 2 and 3, re-read.** Ruling 2 said the window is "un-pinned only through an advertised verb". What the verb bought was evidence that the fleet box's readers stand down. Stage 2 resizes through the server's already-granted `resize-window`, never below `READER_MIN_COLS`, and only once ccd advertises `geom-settle-v1` (§6.1), which is the same evidence for the hazard that remains (W5). Ruling 3 ("no `set-option` grant") holds: nothing here needs one.
- **ccd's stand-down below 120** (`_pane_measurable`) and the `win-size-v1` verb. The stand-down is extended, never weakened (§6.1). `ccd win-size` stays shipped and uncalled.
- **The history route and layer** (`GET /api/sessions/:id/pane/history`, `historyScrollback` in `TerminalDrawer.tsx`). They are already width-safe.
- `FLEET_PROTO` stays 1. Every wire addition is optional and additive.
- **One per-session `KeyedQueue`** (`Deps.queue`, `server/src/server.ts`). The sizer uses that same instance and never a second queue.

## 4. Shape

| Stage | Lands | Touches | Deploy class |
|---|---|---|---|
| 1 | Window-sized client, grid and wrapped views, phone input layer | `pwa/`; `shared/api.ts` (one constant, three docstrings); comment-only lines in `server/src/server.ts` and `server/src/ccdargv.ts`; new tests and rig scripts under `server/test/` | server lane (PWA bundle) |
| 1b | Tappable menu rows; the menu-row parsers move to `shared/` | `pwa/`, `shared/`, `server/` (re-import only) | server lane |
| 2·B0 | ccd stands down across a geometry change; advertises `geom-settle-v1` | `ccd/` | **AGENT-FIRST** |
| 2·B1 | Fit target, `WindowSizer`, route, settle holds, grid frames, follow in the PWA, behind `drawer.follow` | `server/`, `pwa/`, `shared/` | server lane; does nothing until B0's capability is seen |

Stage 1 is independently complete: it meets the requirement at every width, with wide screens letterboxed at 220x50. Stage 2 adds native layout on laptops and full use of wide screens.

## 5. Stage 1: a window-sized client and a wrapped view

### 5.1 The attach (D-5005)

- The drawer connects with `?cols=220&rows=51`, which is `PINNED_WINDOW_COLS × (PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS)`.
- It **never sends a resize frame**. `refit` stops sending them.
- `TMUX_STATUS_ROWS = 1` is new in `shared/api.ts`, beside `PINNED_WINDOW_*`. A test reads `ccd/tmux.conf` and fails if that file ever sets `status off` or a multi-line status.
- Server: no behaviour change (its only stage-1 edits are comments, §4). `dim()` accepts any positive integer. The attach pin and the close pin become no-ops in steady state, and they still repair a window that something else narrowed.
- With a client exactly the window's size, tmux has nothing to pan and nothing to fill (W6). Under `latest`, the attach itself holds 220x50, so the un-awaited pin's measured race (2 lost in 40, 2026-09-14) no longer matters.
- `PINNED_WINDOW_COLS/ROWS` keep their names. Their docstring stops promising a wave 3 and points here.

### 5.2 One terminal, two views (D-5005, D-5006)

- There is **one** `@xterm/xterm` `Terminal`, fixed at 220x51. Its grid never follows the glass.
- **Measuring.** The chooser measures columns through one function, `colsAt(px)`: the terminal's own `propose(px)` when it is open, else a monospace cell probe in the DOM, the same probe that sets W for the wrapped view (§5.3).
- **Choosing the view.** The view is `consoleFit(colsAt, PINNED_WINDOW_COLS)`'s verdict:
  - `clipped: false` (220 columns fit at 11px or more) → **grid**: the terminal is opened visible at that type size, as today. Between about 1482 and 1877 CSS px this is the exact grid at 11–13.9px (operator ruling O2).
  - `clipped: true` → **wrapped**.
  - `null` (no layout yet) → keep the current view; the first measured fit decides.
  - A per-device override, a `grid ⇄ wrapped` chip, replaces the `pans` notice. It is kept in `localStorage`. Every access is wrapped in try/catch, and a throwing or empty store means "no override".
  - A grid forced by the chip on a glass it does not fit renders at `consoleFit`'s size and the **browser** scrolls the host sideways, under a `grid · scrolls` chip; tmux still pans nothing. That is the sideways host scroll #190 withdrew as a default, so it exists only as this explicit per-device choice, and the wrapped view stays the default there.
- **Grid view.** The 51 rows are fixed. A glass taller than that leaves a margin. On a shorter glass the **browser** scrolls the host vertically, anchored to the bottom where the input box is. tmux never pans.
- **Wrapped view.** On a coarse pointer the terminal is never opened: its buffer is the model (W9). On a fine pointer it is opened into an off-screen host, so a physical keyboard reaches xterm's own textarea when the wrapped view is clicked. That path is proved by the browser spike before stage 1 lands (§10, ruling O6); if the spike fails, the wrapped view uses `TermInput` (§5.4) on every device.
- **The status row** (row 50) is dropped from the wrapped view and shown in the grid.

### 5.3 The wrapped view (D-5006): `pwa/src/session/wrapScreen.ts` (pure) and `WrappedView.tsx`

**`readModel(term, srcCols)`** reads buffer rows 0 to `rows − 1 − TMUX_STATUS_ROWS` (the window's rows; the status row is never part of the model) into styled cells. It keeps any trailing cell with non-default attributes, because the caret is a reverse-video cell (W11). Wide characters keep their width; their trailing half is skipped.

**`wrapScreen(rows, W, srcCols)`** classifies each row, then re-joins and wraps it. It returns visual rows plus a map back to source cells.

- **Blank:** runs collapse to one.
- **Rule:** a row of box-drawing rule characters at least `srcCols / 2` long becomes a CSS rule in the source colour.
- **Table:** a box frame with inner `│┼┬┴` becomes a row that does not wrap and scrolls sideways.
- **Right-aligned segment:** 8 or more spaces followed by text reaching the right edge becomes its own right-aligned row.
- **Otherwise prose.**

Re-joining reverses Claude Code's own breaks. A row joins the next one only when **all** of these hold:
- it is at least half `srcCols`;
- `len + 1 + nextFirstWord > srcCols − 6`;
- the next row has the same continuation indent;
- the next row has no list marker and is not a rule or a table row.

Word wrap at W uses a hanging indent taken from the marker or gutter (`● `, `⎿  `, `❯ `, `1. `, `│ `, `[ ]`, code line numbers), capped at W/3. Unbreakable tokens get a hard break.

This is the "reflowed native view" proposal's re-wrapper. On every screen W10 measured it takes fewer rows than a character wrap of the same screen (at 45 columns, 52 against 58 for a permission prompt and 83 against 104 for a markdown table), with no false joins. The hybrid proposal's character wrap was also measured on the 2026-10-14 spike's own transcript screen: 81–87 ragged rows at 45 columns, where Claude Code's own layout at that width takes 50.

**Rendering:**
- Each row is keyed and re-renders only when it changes, on `onWriteParsed`, coalesced to `requestAnimationFrame`.
- The view sticks to the bottom unless the operator has scrolled up. The scroll is anchored on the caret row, or on the `❯` row.
- Text is selectable. While a selection lies inside the view, updates freeze behind a `paused` chip.

**W** comes from the glass width divided by the measured 14px monospace cell, not from `FitAddon`.

**When the screen is not Claude Code.** If no `❯` (U+276F) has been on screen for 2 s (vim, less), a chip offers the grid view. This is a display hint only: it decides nothing that is sent.

### 5.4 Input (D-5007)

- **Key bar, primary row:** `esc ↑ ↓ ⏎ ^C ⌫ ⋯`. **`⋯` opens:** `← → tab ⇧tab space PgUp PgDn ^U ^O ^R ^T ^B ctrl`.
  - The bar wraps to two rows below 420px instead of overflowing (`.term-keys` in `chat.css`, ≈:2429).
  - `ctrl` is a one-shot latch: the next letter typed in the text field becomes `\x01`–`\x1a` and is sent at once.
  - The existing `hist`/`live` toggle stays beside the bar.
- **^C/^D guard.** When the model's last 4 rows match `/Press Ctrl-[CD] again to exit/`, the key asks for confirmation instead of sending (W11).
- **`TermInput`** (shown by default on a coarse pointer, and on any pointer in the wrapped view if the O6 spike fails). A native `<textarea>`, so autocorrect, dictation and IME all work.
  - **Type** writes the text literally, or as bracketed paste (`\e[200~…\e[201~`) when it contains a newline (W11).
  - **Before framing,** the text is sanitised: every C0 control other than tab and newline is removed, ESC among them, so neither bracketed-paste marker survives as a marker; so is DEL. Clipboard text from elsewhere must not be able to close the paste and run its tail as keystrokes.
  - `⏎` is a separate key, so the operator sees the echo before submitting.
- **Grid view and fine pointers:** unchanged. xterm's textarea, physical keys, and the existing quick keys plus `^C` (guarded).

### 5.5 Menus (stage 1b, D-5008)

- `OPTION_RE`, `CHECKBOX_RE`, `leftCol`, `paneOptionRows` and the `OptionRow` type move from `server/src/pane/dialog.ts` into a browser-safe `shared/pane-menu.ts` (L0: it imports nothing). They are pure; only `parseDialog`'s id needs `node:crypto`, and it stays. `dialog.ts` imports them and re-exports `paneOptionRows` and `OptionRow`, so `inject/ask.ts` is untouched. `single-definition.test.ts` pins the one home.
- The PWA runs them on the **220-column model**, which is the same input the server parses (W6).
- **Gate.** Rows are tappable only while the session's dialog state from the server (the one `DialogSheet` reads) says a menu is up **and** `paneOptionRows` finds the run holding the cursor in the model. `hasMenu` and `promptBoxShowing` stay on the server: a reply that quotes a numbered list is not a menu, and a tap there would send arrow keys into the input box.
- **Tap** sends ↑/↓ for the difference from the `❯` row, then shows a highlighted **Select ⏎**.
- **Tap on a checkbox row** moves there and sends Space.
- **Stale-tap guard.** At send time, if the option labels or the selected index differ from the snapshot taken at pointerdown, the tap is dropped and the row flashes.
- `DialogSheet`'s "answer in the terminal" escalations open the drawer in the view the glass chooses. In the wrapped view the scroll anchors on the menu, so the question and its options are on screen together (today "Open terminal to answer" hides the sheet that showed the question).

### 5.6 What stays the same

- The history layer and its gestures in the grid view.
- In the wrapped view, the history layer is reached only through the `hist` key; the drag gestures belong to the DOM scroller.
- `consoleFit` and its 11px floor.

## 6. Stage 2: wide glasses make the window follow them

### 6.1 B0: ccd stands down across a repaint (AGENT-FIRST, capability `geom-settle-v1`, D-5009)

1. **`_pane_measurable`** reads `'#{pane_active} #{pane_width} #{window_width}x#{window_height}'` in its existing `list-panes` call, so no fork is added.
2. **Memory is per process,** in an associative array keyed by id. The supervisor carries it across its ticks; a one-shot verb carries it across its own steps.
   - **A geometry that differs** from the one this process last recorded for the id: record it, with the supervisor tick it was seen in, and return 1 with the reason `settling`. Every later call for that id in the same tick also returns 1, so the whole tick stands down and not only its first reader; the next tick proceeds if the geometry has held. Outside a tick (a one-shot verb), the call that saw the change stands down, and multi-step sequences re-measure (item 3).
   - **First sight** in a process: record it and proceed under today's width rule. (Rev 0 stood down on first sight. A spawn is a fresh process, so `_accept_first_run_prompts` would have answered rc 6 on every spawn, and every one-shot `ccd route --apply` would have stood down.)
   - Below `READER_MIN_COLS` the reason stays `narrow`.
   - One rc and one direction per caller, as today: `_pane_auto_continue_armed` still inverts, so a settling pane reads ARMED.
   - `_pane_narrow_note` and `_idle_for_keystroke`'s `KS_WHY` name the reason: `pane-settling` or `pane-narrow`.
3. **Re-measure inside multi-step sequences.**
   - `_route_type_model` and `_route_type_effort` re-run `_pane_measurable` before each read-then-act step. On failure they send Escape and return `pane-settling`.
   - `_accept_first_run_prompts` measures on every iteration, not only when `i == 1`.
   - Both are already gaps below 120 today. Above 120, a following drawer can trigger them through W5.
4. **The capability** `geom-settle-v1` is advertised by `cmd_caps` in the same deploy.
5. **Budget.** The unchanged-geometry path adds no fork, and `ccd-tick-budget.test.ts` stays green. The supervisor tick diet's memo (D-4964, its W4) takes one `list-panes` per tick; whichever of the two lands second carries the geometry field into the other.

### 6.2 The fit target (`server/src/pane/fit.ts`, L1, pure; D-5011)

`fitTarget(probe, glasses, mode) → {cols, rows} | {refused: reason}`.

**Size:**
- `cols = clamp(min(glass.cols), READER_MIN_COLS, FOLLOW_MAX_COLS = 300)` (operator ruling O3: 300, the widest measured, not 400).
- `rows = clamp(min(glass.rows) − TMUX_STATUS_ROWS, FOLLOW_MIN_ROWS = 22, FOLLOW_MAX_ROWS = 100)`. W4's id stability was measured at 22 rows and up.
- Taking the minimum over every following glass makes the window fit every follower, and it never flips on a keystroke (F4 of the 2026-09-14 spec).
- A glass with fewer than `READER_MIN_COLS` columns is never a follower. The server enforces this, not only the PWA band.

**Guard,** using the 2026-09-14 spec's F13 bound for **both trips**:
- `(history + height) × ceil(max(a,b) / min(a,b)) ≤ min(limit, STALL_BUDGET_LINES = 6000)`;
- once for current → target, and once for target → 220.

**Refusals:**
- An unmeasured probe is refused (`unmeasured`).
- There are no partial floors: a pty wider than its glass would bring back panning.
- A refused follower is served as a stage-1 client at the resting grid (shown as the grid or the wrapped view, as its glass chooses in §5.2), with the reason.

### 6.3 `WindowSizer` (`server/src/pane/sizer.ts`, L2 port and its adapter; D-5010, D-5012)

**State per session:** `{ sockets: Map<ws, {view:'follow'|'wrap'|'legacy', glass}>, applied, epoch, settledAt, inFlight }`.

**`apply(id)`** runs on `Deps.queue`:
1. A fresh `Tmux.paneProbe`.
2. `fitTarget` over the followers. With no followers the target is **220x50**: this is the refcounted pin.
3. If the target differs from `applied`, `Tmux.resizeWindow` (granted at the agent's `resize-window` whitelist row).
4. Every new-bundle pty on the session is resized to **target cols × (rows + 1)**, so that every such client is window-sized (I1).
5. **Settle** (§6.5), then `epoch++` and `settledAt = now`.
6. A grid frame goes to every opted-in socket.

**The settle port** the readers consume: `settling(id)` (an apply is in flight, or `RESIZE_SETTLE_MS` has not passed since `settledAt`), `settled(id)` (a promise that resolves when `settling` turns false, at once for a window at rest) and `epoch(id)`.

**Re-check:** every 30 s while `applied` is not 220x50.
- Re-probe.
- If the return trip's bound has reached 80% of the budget (a non-alternate-screen pane accumulating history at more than 220 columns), drop to 220 now.

**Gate** (operator ruling O4). Followers exist only when `drawer.follow` is on **and** `capSupported(state, 'geom-settle-v1')` is true. Otherwise every socket is a wrapped or grid client at 220x51, which is stage 1.

**The flag's carrier** is `CCRC_DRAWER_FOLLOW`, read once at boot by the config loader. Only the value `on` turns it on; absent or anything else is off. It ships off.

### 6.4 The route (`server/src/server.ts`'s `/ws/pty/:id` → `server/src/pane/drawer.ts`, L4; D-5010, D-5012)

**Query:**
- `view=follow|wrap&gcols=&grows=` registers the socket with the sizer. `wrap` means "not following": a stage-1 client at the resting grid, which its PWA shows as the grid or the wrapped view by its own glass (§5.2).
- `cols=220&rows=51` stays in the URL, so an older server serves stage 1.

**Socket types:**
- **A legacy socket** (no `view`) behaves exactly as today, except that it does not pin while a follower holds the window.
- **The pty grid is chosen by the server.** Client `{type:'glass', cols, rows}` frames are inputs to `fitTarget`, coalesced to 120 ms trailing. The client never resizes its own pty.

**Frames and liveness:**
- **Server → client control frames are binary**: `{type:'grid', window:{cols,rows}, view, reason?, epoch}`. Pane output stays text, so pane output cannot forge a frame.
- **Liveness:** a ping every 30 s; after two missed pongs the socket is terminated through the close path. The last close re-pins through `apply`.

**Boot sweep:** on server start and on agent reconnect, `apply` runs for every rostered session that has no registered socket and whose probe is not 220x50.

### 6.5 Settling: no reader acts on a repaint (D-5010)

- **Server queue.** `apply`'s queue task does not return until the pane has settled. The signal is the capture's bottom box border spanning exactly the new width, as `parseStatusline`'s `boxCols` infers it (the value `FleetSession.paneCols` carries, `fleet.ts` ≈:720). For screens with no box, the fallback is two equal plain captures 25 ms apart. Either way the task gives up waiting at `RESIZE_SETTLE_MAX_MS = 750`.
  - Every `sendPrompt`, `submitEnter` and `answerDialog` on the session queues behind it.
  - The mail lane's guards in `sendPrompt` (`autoContinueArmed`, `turnRunning`, `draftOfMeasured`) therefore never read a repaint.
- **The route-apply door.** `POST /api/sessions/:id/route` runs `ccd route --apply` outside `Deps.queue`. It first awaits `sizer.settled(id)`. It does not hold the queue for the ccd call.
- **`FleetWatcher.detectDialogs`** (`watch.ts`, ≈:7503). While `sizer.settling(id)`, it carries the previous dialog and statusline verdicts forward. No edges, no `staleAsk`, no push.
  - If a dialog is present on both sides of an epoch change and its id differs while its option labels match, the held ask is re-keyed with no `staleAsk` and no push. This is defence in depth: W4 says ids are stable in this band.
- **ccd:** §6.1.

### 6.6 The PWA when following (D-5010, D-5011)

- **Band.** `C14 = colsAt(14)` on the drawer's glass:
  - `C14 ≥ READER_MIN_COLS` → request `view=follow`;
  - otherwise → `view=wrap` (stage 1).
- **On each grid frame:**
  - `term.resize(window.cols, window.rows + 1)` at 14px. Spare glass is margin, so there is no tmux filler.
  - The chooser's `wantCols` and the chip read `grid.window`, not `PINNED_WINDOW_COLS`.
  - A `reason` on a wrap frame shows as a chip (`history`, `unmeasured`, `off`).
  - The live terminal uses `scrollback: 0`, because it is always on the alternate screen [I: this frees the scrollbar FitAddon reserves].
- **A wrapped client on a following window** wraps the window's width: its model is `window.cols` wide, and 1b's parsers read it at that width, as the server does.
- **Bytes across a frame.** They are handed to the terminal at the binary frame boundary. tmux's full redraw after a client resize converged from every cut point measured (64 of 64, local pty) [M].
- **No release on a hidden tab.** A follower is at 120 columns or more, so a hidden tab costs the fleet nothing. Dead sockets are handled by the ping.

### 6.7 Wire vocabulary (`shared/api.ts`, appended)

New constants:
- `TMUX_STATUS_ROWS` (stage 1)
- `FOLLOW_MAX_COLS`, `FOLLOW_MAX_ROWS`, `FOLLOW_MIN_ROWS`
- `STALL_BUDGET_LINES`
- `RESIZE_SETTLE_MS`, `RESIZE_SETTLE_MAX_MS`
- `GEOM_SETTLE_CAP = 'geom-settle-v1'`

New types: `DrawerView`, `DrawerGlassFrame`, `DrawerGridFrame`.

`PINNED_WINDOW_COLS/ROWS` keep their names and now mean "resting size". Stage 2 updates their docstring again.

## 7. Behaviour by width

C14 is [I] (§1.2). "Readers" means ccd's and the server's.

| Glass | C14 | Stage 1 alone | Stages 1 + 2 | Window while open | Readers |
|---|---|---|---|---|---|
| 320 (small phone) | ~34 | wrapped, 14px, key bar, text field | same | 220x50 | unaffected |
| 360–430 phones | 39–47 | wrapped, key bar, text field | same | 220x50 | unaffected |
| 740–932 phone landscape | 84–107 | wrapped | wrapped | 220x50 | unaffected |
| 768–834 tablet portrait | 87–96 | wrapped | wrapped | 220x50 | unaffected |
| ~1024 tablet landscape, split-screen browser | ~118–120 (borderline) | wrapped | wrapped, or follow when C14 ≥ 120 | 220x50, or C14 wide | unaffected / calibrated |
| 1180–1481 laptops | 137–172 | wrapped (220 needs <11px) | **follow**: native at 14px | C14 × (glass rows − 1) | calibrated; settle gates |
| 1482–1877 | 172–219 | grid at 11–13.9px (#190; ruling O2) | **follow**: native at 14px | 172–219 cols | calibrated |
| 1878–2549 | 220–299 | grid at 14px, 220x50, margin | **follow**: the window grows to C14 | 220–299 cols | calibrated (measured to 300) |
| ≥2550 / ultrawide | ≥300 | grid at 14px | follow, capped at 300×100; margin | 300 | calibrated |
| Phone + laptop on one session | — | both window-sized at 220x51 | the laptop follows; the phone wraps the laptop's width | the laptop's grid | calibrated |
| Two laptops | — | both window-sized at 220x51 | the narrowest wins; the wider shows margin | min of the two | calibrated |
| Guard refused / `drawer.follow` off / no capability | — | — | that drawer is a stage-1 client (grid or wrapped, as its glass chooses), with a reason chip | 220x50 | unaffected |
| Last close / dead socket / server restart | — | no-op | re-pin through `apply`, the ping, or the boot sweep | 220x50 | — |
| An old cached bundle | — | today's behaviour: pans | today's behaviour; it never pins over a follower | as today | as today |

Rows: a follower's window is `glass rows − 1`, between 22 and 100. A glass shorter than 23 rows scrolls in the browser, anchored to the bottom.

## 8. Invariants (I1–I8)

1. **Window-sized clients.** Every pty a stage-1-or-later drawer opens is exactly the window's grid plus the status row. tmux never pans such a drawer and never fills one, and attaching one never moves a `latest` window off its size.
2. **The calibration floor.** No drawer ever causes a window narrower than `READER_MIN_COLS`. This is enforced in `fitTarget`, not trusted to the PWA.
3. **Deliberate, guarded, refcounted.** A window leaves 220x50 only through `WindowSizer.apply`, after a fresh probe passes the fit bound for both trips. It returns to 220x50 when no follower remains, on liveness timeout, and on the boot sweep.
4. **No reader acts on a repaint.** The server's queue holds through the settle, the route-apply door waits for it, `FleetWatcher` carries its verdicts forward, and ccd stands down on any change in geometry it has seen.
5. **The display never chooses keystrokes from its own geometry.** Whatever the wrapped view sends is one of three things: sanitised literal operator text, a named key, or a menu delta computed from the window-wide model under the stale-tap guard.
6. **Pane output cannot forge a control frame** (binary versus text).
7. **Mixed versions are safe in every direction.**
   - Old bundle: the legacy pin path.
   - New bundle on an old server: stage 1.
   - New server without ccd's capability, or with the flag off: stage 1.
8. **Committed fixtures are synthetic.** They are recorded from the container rig, never captured from live fleet sessions.

Each invariant ships with a test that turns red when the mechanism behind it is deleted or made wrong (mutation discipline, `CLAUDE.md`).

## 9. Proof

**Real tmux, server suite** (private `-L` sockets with `ccd/tmux.conf`; a visible `describe.skipIf` when tmux is absent, as `ccd-tmux-anchor.test.ts` does; the macOS CI job installs tmux through brew):
- `drawer-window-sized-client.test.ts` (stage 1). A session is spawned as ccd spawns it: 220x50, pin, `window-size latest`. The stub app is a deterministic alternate-screen script (colours, wide characters, a reverse-video caret, no `·`). A node-pty client attaches at `PINNED_WINDOW_COLS × (PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS)`.
  - Assert, with tmux's own formats, `client_width × client_height` = 220x51 and `window_width × window_height` = 220x50, under `latest` and under `manual`, through 20 typed characters.
  - Assert the client's stream carries no `·` filler.
  - **Mutation:** attach at 220x50 → under `latest` the window becomes 220x49 and the client/window equality reds. Attach at 220x52 → under `latest` the window becomes 220x51 and the equality reds. Attach at 300x51 → under `manual` the filler appears.
- `sizer-real-tmux.test.ts` (stage 2).
  - `apply` to 150x40 → `manual`, exact size. A 300x80 client does not move it. Last close → 220x50.
  - A non-alternate pane holding 1850 dense lines at limit 2000 is refused at 120, and `history_size` is unchanged.
  - **Mutation:** guard only the outbound trip → a 300 → 220 return case reds.
- `sizer-settle.test.ts` (stage 2). A stub app repaints 200 ms after SIGWINCH. A `sendPrompt` queued behind `apply` captures the repainted screen, identified by a marker.
  - **Mutation:** drop the settle wait → it captures the transient.

**Real xterm, PWA suite** (`@xterm/xterm` 6.0.0 under jsdom; the same package the drawer ships):
- `xterm-unopened-model.test.ts`. Pins W9: parsing, colour, cursor and `onWriteParsed` without `open()`, so an xterm upgrade cannot silently break the model.
- `drawer-model-equals-capture.test.ts`. Each recorded 220x51 attach stream (below), fed to an un-opened terminal, gives model rows 0–49 equal to the `capture-pane -p` recorded in the same rig run (trailing spaces trimmed), outside the rows the recording itself measured as animated (at most 2, such as a spinner), and row 50 is the status line. This is W6, measured on every fixture.
- `wrap-screen-golden.test.ts`. The inputs are the recorded streams: permission prompt, Write preview, multi-select, markdown with table and code, busy, reply-done. The `server/test/fixtures/panes/` 220x50 captures are added as text.
  - Each is wrapped at W ∈ {34, 39, 45, 60, 87, 118, 149, 171, 220} and compared to golden outputs.
  - Properties:
    - (a) every non-space source character appears once and in order, except rules and collapsed blanks;
    - (b) no visual row is wider than W, except table rows;
    - (c) at W ≥ srcCols the output is the source;
    - (d) the caret cell survives;
    - (e) the source map is a bijection on kept cells;
    - (f) prose wrapped at 220, then re-joined and wrapped at W, equals a direct wrap at W;
    - (g) no wide character is split across two visual rows.

**Fixtures** are recorded by scripts under `server/test/drawer-rig/` (like `delegation-rig/`): the container, the fake Messages API, real Claude Code, synthetic prompts about a fictional `project-a`. The scripts are committed; the rig is never run in CI. Every recorded file passes the delegation rig's existing residue scan (`sanitize.mjs --scan`) before it enters the tree, and a test re-runs that scan over the committed corpus.

**PWA:**
- The URL carries `cols=220&rows=51`, and no resize frame is ever sent (stage 1).
- The view follows `consoleFit`'s verdict, and the override survives a throwing `localStorage`.
- Key-bar sequences, the ctrl latch, and the bar's wrap below 420px.
- The ^C guard against a model showing the exit notice.
- Bracketed-paste framing, and sanitising (a pasted `\e[201~` never reaches the frame).
- Menu delta, the server-verdict gate and the stale-tap drop (1b).
- Stage 2:
  - band choice;
  - a grid frame → `term.resize`, and the chip reads `grid.window`;
  - the byte hand-off at the frame boundary;
  - `console-window-fit.test.tsx` updated to read the frame.

**Server:**
- `single-definition`: the menu-row parsers have one home, `shared/pane-menu.ts` (1b).
- `fit.test.ts`: both trips; refusal reasons; no partial floor; min over followers; the row clamps.
- `sizer.test.ts`: refcount; the cap gate; the flag; legacy sockets don't pin over a follower; the ping terminate path; the boot sweep.
- `watch` settle carry-forward with no `staleAsk` and no push; the re-key.
- The route-apply door waits for `settled(id)`. **Mutation:** skip the wait → a door call during an in-flight apply runs first.
- `pty.test.ts`'s pin-ordering cases rewritten for the sizer's ordering.

**ccd:**
- `ccd-geom-settle.test.ts`: stand down on the first tick after a geometry change, every reader in that tick and not only the first, and proceed on the next. First sight proceeds: a spawn's `_accept_first_run_prompts` is not answered rc 6 by it. **Mutations:** stand down on first sight → the spawn case reds; let the second reader in the changed tick proceed → the same-tick case reds.
- `ccd-route-apply`: a geometry change between picker steps → Escape and `pane-settling`.
- The startup gate loop is measured on every iteration.
- The tick budget is unchanged.

**Rig end to end (manual, scripted under `server/test/drawer-rig/`):**
- Real Claude Code against the fake API.
- Open a follower at 150x40, resize it, close it. Check `history_size`, the window after close, and that no stale-Enter or `/compact` lands during the repaint.

**Device matrix (manual; operator ruling O7):** iPhone SE and 15 (Safari), Android 360 and 412 (Chrome), iPad in both orientations, desktops at 1280, 1440, 1512, 1920 and 2560. A WebKit Playwright smoke test is not added now.

## 10. Rollout and measurement

| Step | What | Deploy | Gate to proceed |
|---|---|---|---|
| 0 | Read-only census on the fleet box: `list-panes -a -F '#{history_size} #{history_limit} #{alternate_on} #{window_width}x#{window_height}'` and `claude --version`. Golden captures are **not** taken from live panes. | none | panes with history over about 950 will be refused in stage 2, which is safe |
| 1·spike | The browser spike (ruling O6): keyboard capture through an off-screen xterm on a fine pointer (Safari focus, IME, dead keys), and iOS `visualViewport` with the wrapped view and `TermInput` up. | preview build | pass → §5.2 as written; fail → `TermInput` on every device in the wrapped view. Either way it is recorded before stage 1 merges |
| 1 | Stage 1 | server lane (bundle) | device matrix for phones and tablets; no change in `swap.log` stand-downs |
| 1b | Menu taps | server lane | — |
| 2·B0 | ccd geometry settle, capability | **agent lane first** | `ccd caps` shows `geom-settle-v1` on the box |
| 2·B1 | Sizer, `drawer.follow` off | server lane | merged with the flag off; then flip it on |
| 2·flip | `CCRC_DRAWER_FOLLOW=on` | config, server restart | desktop matrix; one week with no duplicate pushes and no `pane-settling` storm in `swap.log` |

**Rollback:**
- Stage 1 and 1b: the previous bundle.
- Stage 2: `drawer.follow` off, then restart the server lane. Every socket becomes a 220x51 client, and the boot sweep re-pins any window left non-canonical.
- B0 is harmless left in place: one stand-down tick per geometry change.

## 11. What this does not claim

1. **Phones never see Claude Code's native narrow layout.** The wrapped view approximates it. Prose is near-native. Code hard-wraps. Tables scroll sideways. Truncation such as `… +N lines` was decided at 220 columns.
2. **Phone typing is compose-then-type.** Slash autocomplete and the `@` picker appear only after **Type**. The chat's composer remains the primary prompt path.
3. **The re-wrap heuristics are tied to Claude Code's glyphs.** A new release can degrade the display, but only the display: what is sent never comes from the wrapped geometry (I5).
4. **Between 120 and 219 columns,** the following degrade but do not fail open [I]:
   - `continuationRows` / `matchesOwnDraft` fail on a wrapped first line (measured: false at 120 for a 121-character line);
   - replace capacity scales with width;
   - the statusline tail may clip (not measured with the real ccd statusline).
5. **Only the 50-row screen exists in tmux.** Older transcript is Claude Code's PgUp (shared by every viewer) or the chat.
6. **First sight proceeds in ccd** (§6.1). A process whose first measurement lands inside a repaint is not stood down by B0. For the supervisor that is its first tick after its own start. A `ccd route --apply` started by hand or by a session, outside the server's door, inside the ~50 ms after a resize is the other case. Both are bounded by W13: a draft or a picker can be misread, but nothing types into a running turn.
7. **`TMUX_STATUS_ROWS` is a constant pinned against `ccd/tmux.conf`.** An operator's own tmux configuration that turns the status line off makes the stage-1 client one row taller than the window. Under `manual` that is one filler row; under `latest`, with the pin's race lost, the window becomes 220x51. Neither narrows anything.
8. **The 2026-09-14 census is a month old** (W1). Step 0 re-measures it before stage 2.

## 12. Rulings and what stays open

**Requirement (operator, 2026-10-14):** "obviously UI should work on mobile, desktop wide etc."

**Rulings (operator, 2026-10-14):** "Yes, stages 1+2 with recommendations." The design goes to a docs PR for approval; stage 1 and 1b are built first; stage 2 is built behind the ccd settle change. Each open item took its recommendation, which for O1 is deferral:
- **O1. Phone live lease** (native typing below 120 columns, at the cost of pausing that session's automation while the lease is held): **deferred.** It would need the 2026-09-14 design's ccd sequencing fixes, a `pane-narrow` mail-lane gate and a watcher freeze. Revisit after a month of stage 1.
- **O2. Default view between about 1482 and 1877px before stage 2:** **grid** (the exact grid at 11–13.9px), with the chip.
- **O3. Follow cap:** **300 columns**, the widest measured.
- **O4. Gating stage 2:** **gated on B0's `geom-settle-v1`.**
- **O5. Grow the type to fill wide screens in stage 1** (reversing #190's rule in `consoleFit` that room to spare is not a reason to swell): **no.** Stage 2 fills with columns instead.
- **O6. Browser spike before stage 1 lands:** **yes** (§10, step 1·spike).
- **O7. Real-browser automation:** **the manual matrix for now.**
- **O8. Ledger:** **mark wave 3 of `terminal-drawer-fit` superseded, and reconcile rows 1–2** (#106 and #117 landed). Done with this document (D-5013).

**Later:** a `FleetSession.drawer` field so that other devices show "terminal open at N columns elsewhere"; a JSON tee of the statusline so ctx reads independently of width; deprecating `ccd win-size` if nothing calls it; the spinner phrase that `READER_MIN_COLS` was derived for, which Claude Code 2.1.299 did not print in the rig at any width (a fact about the readers, not about this design).

## 13. Deviation numbers

The allocator issued this design a block of ten numbers on 2026-10-14. D-5005 to D-5013 are defined once, in the plan's Deviations section, and every other document cites them with the meanings below. The block's tenth number, 5014, is not used and stays undefined; it is spelled without its prefix because `deviation-refs.test.ts` requires every tracked ref to be ledgered.

| Number | Slug | What it records | Here |
|---|---|---|---|
| D-5005 | `window-sized-client` | the 220x51 attach, `TMUX_STATUS_ROWS`, no resize frames, the view chooser and its chip | §5.1, §5.2 |
| D-5006 | `wrapped-view-rejoin` | the model and the structure-aware re-join | §5.2, §5.3 |
| D-5007 | `phone-input-layer` | the key bar, the ctrl latch, the ^C/^D guard, `TermInput`, bracketed paste and sanitising | §5.4 |
| D-5008 | `menu-row-taps` | the parsers' move to `shared/`, taps, the gate and the stale-tap guard (1b) | §5.5 |
| D-5009 | `geom-settle-v1` | ccd's stand-down across a geometry change (B0) | §6.1 |
| D-5010 | `window-sizer-settle` | `WindowSizer`, the settle hold, the route-apply door, the watcher's carry-forward, binary frames, the ping (B1) | §6.3–§6.6 |
| D-5011 | `follow-band-and-cap` | the follow band, the 300×100 cap, the `READER_MIN_COLS` floor and the two-trip bound | §6.2, §6.6 |
| D-5012 | `follow-flag-boot-sweep` | `drawer.follow` and its carrier, the capability gate, the boot sweep | §6.3, §6.4, §10 |
| D-5013 | `wave3-superseded-ledger-reconciled` | the supersession of wave 3, the ledger reconcile, the stale citations | header, §3, §12 |

## 14. Routing

These parts are spec-able and may go to a cheaper worker model, with every diff reviewed before it lands:
- the re-wrap core and its golden and property tests;
- the key-bar CSS;
- the fixture-recording scripts.

These stay with the implementer at opus@high:
- `fitTarget`, `WindowSizer` and the settle holds;
- ccd B0;
- the ^C and stale-tap guards, and `TermInput`'s sanitising.
