# Program: terminal-drawer-fit

Spec: `docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md`
Plans: `docs/superpowers/plans/2026-09-14-drawer-wave{1,2,3,4}-*.md`
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-brisk-mesa`   Workspace: per-wave (wave 1 spawns)

**What this program is.** The console drawer gets a history a phone can read, and a window that fits
the phone without lying to the fleet. It replaces PR #96, which was measured to destroy the very
scrollback it exists to render.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | the latch (pin before every attach) + the salvaged reader, with nine corrections | server | — | open |
| 2 | `ccd win-size` verb + grant + the fleet-box readers standing down | **AGENT-FIRST** | — | planned |
| 3 | the deliberate un-pin under a measured fit guard | server | — | planned |
| 4 | whole-branch pass, README, the CLAUDE.md sentence, ledger reconcile | docs | — | planned |

Wave 1 is independently valuable and safe with nothing after it. Wave 3 may merge in any order but
DOES nothing until wave 2 is on the fleet box: it un-pins only through a verb gated on
`capSupported(state,'win-size-v1')`, which answers false on no evidence.

**Deviation block: `D-2766`–`D-2781`** (16 numbers, allocated once at run-open 2026-09-14; floor now
2782). Every wave draws from this block and defines each number in the same act as using it. A worker
never calls the allocator mid-wave (coordinator clause 10); it names the departure in its wave-done
mail and the coordinator assigns from the block. **Wave 1 owes none as planned** — both departures an
earlier draft carried were ruled into the spec instead (§11 rulings 9 and 10).

Run ids: wave 1 = **51**.

## Decisions & deviations (why, not just what)

The spec's §11 carries fifteen numbered rulings; these are the ones a reviewer most needs the *why* for.

- **PR #96 is closed, not continued.** A program worker commits on its own workspace branch (worker
  clause 2), so `fix/terminal-scrollback` is off the table. Twelve of its fourteen commits are
  cherry-picked with `-x` and the author's trailer; `df82702d` and `1dee05ab` — the window-follow —
  are dropped. Wave 1 Task 17 Step 6 closes #96 with a comment saying exactly that.
- **`window-size smallest`, never `latest`.** `latest` follows whoever TYPED last, so a phone and a
  desktop on one session reflow the window on every keystroke alternation: +6 MB tmux RSS per flip,
  never returned, and from ~flip 17 it sheds 50 history lines per flip. `smallest` is deterministic,
  keystroke-stable, and self-heals when the narrow client leaves.
- **The window is pinned before every attach and un-pinned only deliberately.** Measured end to end
  (spec F14): unpinned, a 43-column attach to a pane holding 1203 logical lines leaves 1046 — 157
  destroyed. Pinned first, the window never leaves 220 and nothing is lost.
- **No `history-limit` raise.** The census (F12) found 25 of 31 live panes at zero stored history,
  max 11 — every pane passes the 43-column fit at today's 2000. A raise would cost tmux memory and
  whole-server stall for a case that does not occur. The lever, if a later census disagrees, is one
  line in `ccd/tmux.conf` (§6.4).
- **The readers are not rewritten; they stand down.** `-J` cannot rescue them: at a narrow width Ink
  re-lays-out and emits its OWN newlines, so there is no tmux wrap to rejoin. Below
  `READER_MIN_COLS` every ccd site that would TYPE stands down, and the mail lane holds. A narrow
  pane is *unmeasured*, not idle.
- **`gone` is `not-alive`, checked BEFORE the width** (ruling 13). Folding it into the held token
  would retry a dead session's mail every five minutes forever, because that hold counts no attempt
  by design.
- **The automation-paused notice is gated on `narrowed === true`** (rulings 14/15), never on the
  client's width — `cols` is the pty's width and says nothing about whether the window followed it.
  Gating on `cols` alone would make wave 3 visibly non-inert before wave 2 deploys.

## Carried constraints (reviewers get these)

- **PR #94's residual, against merged code.** #94 merged as `fb19772e` (2026-09-14 11:50 UTC) and
  `main` is green on every leg including `test-macos`; D-2614 is closed. Its text does not name this:
  on the non-tty path Apple's `script.c` handles stdin EOF by writing VEOF and setting
  `readstdin = 0`, and the re-arm at `:318` is guarded by `ttyflg`, which that path never sets — so
  if the `cat` copier dies, the operator's code channel is removed silently while `script` runs on to
  its deadline. To be reported to #94's author. **This program takes no dependency on it.**
- **The width-sensitive readers are a defect about those readers**, not about this program. Making
  automation run *at* 43 columns needs a real Ink capture at phone width and a two-box phrase sweep;
  it is later work with its own spec (spec §10), not a prerequisite.
- **`resize-window` latches `window-size manual`, and `set-option window-size smallest|latest`
  un-latches but does not restore.** This is the fact every wave turns on and it is nowhere in
  `CLAUDE.md` yet; wave 4 puts it there, beside SAFETY.
- **Three "mutation tests" in an earlier draft of wave 3 did not mutate** (a `clearInterval` behind a
  `closed` short-circuit, a `<=`→`===` with no falling-floor case, a half-deleted `onPong`). Every
  mutation table in these plans was re-derived after that; reviewers should still run them rather
  than read them.

## Next-wave brief

**Wave 1 is dispatched.** Its plan is `docs/superpowers/plans/2026-09-14-drawer-wave1-latch-and-reader.md`,
all 17 tasks, and it owes no deviation numbers as planned (both departures an earlier draft carried
were ruled into the spec instead — §11 rulings 9 and 10).

When wave 1's `wave-done` arrives: re-measure the fingerprint, advance, settle the items read from
`GET /api/runs/:id/items`, review the handoff commit, then **open wave 2's run BEFORE closing wave
1's** — wave 2 stays in `ccrc-pwa`, so it reclaims wave 1's `sessionId` and closes wave 1 with
`final:false`.

Wave 2 is the AGENT-FIRST one: it ships to the fleet host before any server that calls it, and its
first task is the `READER_MIN_COLS` measurement (wrap-ansi over Claude Code's status-line shapes at
40–220 columns, no live session). Its brief must name the three tasks routed to `opus@high` — the
`win-size` verb body, the whitelist entry plus `REQUIRED_VERB_FLAG` and its bypass fixtures, and
`_pane_measurable` with its sweep over every typing site — and its mandatory security lens is the
exec grant.
