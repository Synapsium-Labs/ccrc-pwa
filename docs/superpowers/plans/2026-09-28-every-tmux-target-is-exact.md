# Every tmux target is exact — Plan

> **For agentic workers:** a single-task fix, done in one commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** no tmux command ccrc runs — in `ccd`, the server or the agent — can resolve a session's target to
a DIFFERENT session or window. A target that names a session which is gone fails, with the message every
classifier already reads as death.

**Background, measured 2026-09-28 on tmux 3.4** (private sockets, `-f /dev/null`; real ccd functions in a
fixture HOME; the server's `Tmux` adapter against a private socket):

- `_tmux() { echo "cc-$1"; }` is the session NAME, and it is passed bare as `-t` at about 80 tmux calls in
  `ccd/ccd`, as `cc-${id}` by the server (`server/src/exec.ts:74`, `server/src/pty.ts:19`) and by the agent
  (`agent/src/pty.ts:36`). tmux resolves a bare session string as the exact name, then a UNIQUE PREFIX of a
  name, then an fnmatch pattern; for a window- or pane-type command with no colon it first tries the string
  as a WINDOW NAME in the most recently used session.
- So, with `cc-x` gone and `cc-x-2` live: `has-session` answers rc 0 (ccd's `_session_probe` says `live`, and
  `cmd_supervise` never respawns the dead session while every tick helper acts on the sibling: `_sync_uuid`
  writes the sibling's sessionId into this row, the stale press, `/compact` and route typers type into it);
  `capture-pane`, `send-keys`, `set-option`, `resize-window` and `attach` all act on `cc-x-2`; and
  `kill-session` KILLS `cc-x-2` — the path of `cmd_stop`, `cmd_swap`, `ws-rm`, `ws-archive` (PWA-reachable)
  and `ws-reap`. With `cc-x` live and a window named `cc-x` in a later session, window- and pane-type
  commands hit that window. `display-message` never fails: it prints an empty expansion.
- `=cc-x` (no colon) is exact only for session-type commands; `list-panes` and `resize-window` still
  prefix-match, and `capture-pane`, `send-keys`, `set-option` and `display-message` FAIL even when `cc-x`
  exists. `=cc-x:` is exact for every command in the census, in every layout measured.
- Under `=cc-x:` a missing session answers `can't find session: cc-x` for `has-session`, `kill-session`,
  `attach`, `list-panes`, `capture-pane` and `send-keys` alike, so `_session_probe`'s one death message still
  means death; the server's `paneProbe` (`can't find window`) and `captureHistory` (`can't find pane`) must
  learn it, or a dead session reads `unreadable` / `unmeasured`. No-server and no-socket messages do not
  depend on the target.
- tmux rewrites `.` and `:` in a session NAME to `_` (`-s cc-w-my.site` creates `cc-w-my_site`), and
  `_ws_project_valid` admits a dot. Today a dotted id's bare target answers `can't find pane: site`
  (unknown, refuse); an unsanitized `=cc-w-my.site:` would answer `can't find session` — `gone`, for a LIVE
  session. The target builder must apply tmux's own rewrite.
- Exposure today: 0 prefix pairs among the 75 registry ids (slug word lists never prefix each other), but
  explicit slugs, project names that prefix one another and URL ids can create one, and the sign-in panes
  `cc-auth-<account>` are exposed now (19 prefix pairs among wrapper names). This is the systemic repair
  D-2781 declared and D-2862 deferred to a drawer wave that never took it.

## Task 1: one exact target spelling everywhere

**Files:** `ccd/ccd`, `ccd/ccd-telemetry-keepalive`, a new `shared/tmux-target.ts` (L0, imports nothing),
`server/src/exec.ts`, `server/src/pty.ts`, `agent/src/pty.ts`, the tests that pin target spelling, a new
behavioural suite, `README.md`, `agent/CLAUDE.md`.

Design:

1. **bash builders**, defined BELOW the highest cited `ccd/ccd` line (21428 at 17e5e7a35) so nothing cited
   moves (e.g. directly above `cmd_attach`):
   `_tmux_at() { local n="${1//[.:]/_}"; echo "=$n:"; }` (tmux NAME → exact TARGET) and
   `_tmux_t() { _tmux_at "$(_tmux "$1")"; }` (id → exact TARGET). `_tmux` stays byte-identical: it is the
   NAME builder for `new-session -s`, and `keepalive-freshness-parity.test.ts` pins its shape. Edit only its
   trailing comment, in place: a NAME, never a `-t` target.
2. **Switch every ccd target in place**, adding no lines above the cited corpus: every
   `-t "$(_tmux "…")"` becomes `-t "$(_tmux_t "…")"`; every target-only binding `t=$(_tmux "$id")` becomes
   `t=$(_tmux_t "$id")`; in the functions that receive a NAME (`_accept_first_run_prompts`,
   `_inject_spawn_effort`, `_redrive_after_spawn`, `_spawn_start`'s `tname` uses, `cmd_account_pane`'s
   `$pane`), anchor at the binding or the use with `_tmux_at` and keep the name contract (`${1#cc-}` still
   derives the id from the name). Never anchor an `-s` NAME: `-s =cc-y` creates a session literally named
   `=cc-y` (measured). `cmd_win_size`'s existing `=$t` / `=$t:` spellings may be normalised to `=$t:`.
3. **The keepalive** (`ccd/ccd-telemetry-keepalive`, its own file, cannot source ccd): its one
   `has-session -t` becomes `=${KA_TMUX_PREFIX}${1//[.:]/_}:`; `KA_TMUX_PREFIX='cc-'` stays (parity pin).
4. **TypeScript**: `shared/tmux-target.ts` exports `tmuxName(id)` and `tmuxTarget(id)` (the same `=…:` form
   with the same `.`/`:` rewrite). `server/src/exec.ts`'s `target()`, `server/src/pty.ts`'s and
   `agent/src/pty.ts`'s `attach -t` use `tmuxTarget`; export or inject the attach argv so it is pinnable.
   `paneProbe` and `captureHistory` add `can't find session` to their gone arm, keeping the
   recognise-one-death-message polarity (everything else stays unknown/unreadable). No agent whitelist
   change (measured: `isExecAllowed` accepts `-t =cc-x:`); no `FLEET_PROTO` change.
5. **Guards shipped with the fix:** a behavioural suite on a REAL private tmux socket (plant a harness-bin
   `tmux` shim that execs the real binary with `-L <private> -f /dev/null`, so `_session_probe`'s real
   `_plat_timeout` arm runs; unset `TMUX`, `TMUX_PANE`, `TMUX_TMPDIR` — a deep `TMUX_TMPDIR` overflows
   `sun_path`; kill the server in `afterAll`); a source scan over `ccd/ccd` and the keepalive that allows
   only the anchored builders, `"$t"` bound from them, or the keepalive's literal anchored form after `-t`,
   with a count floor; TS pins on `tmuxTarget` and both attach argvs; classifier cases for the anchored
   death message.

- [x] Red: the tests below, each measured red before the fix.
- [x] Green: design items 1–4, then every test that pins a bare spelling updated to the exact one.
- [x] Re-stamp `ccd/ccd`; confirm the citation census is unmoved (or run S6-R11); mutation table; full
  sharded server suite plus PWA, agent, build and tsc.

Validation 2026-09-29: focused private-socket, source-census, TypeScript, citation and package suites pass.
The complete server run had 17,442 passing tests and six unrelated load/environment failures; its
`ccd-auto-compact` failure passes in isolation.

Tests (red first), on the real private socket with `cc-demo` absent and `cc-demo-2` live:
`_session_probe demo` → `gone` (today `live`); `_pane_born demo` → empty (today the sibling's epoch);
`_pane_measurable demo` rc 1; `cmd_stop demo` leaves `cc-demo-2` alive (today killed); a dotted id created
through `_tmux_new_session` probes `live`; `cmd_account_pane --id A --cancel` leaves `cc-auth-<A-longer>`
alive. Controls: `cc-demo` live → `live`, its own epoch, its own pane text; a later session's window named
`cc-demo` is not read; no server → `unknown` with substrate `absent`. Server: `can't find session: cc-nope`
→ `paneProbe` and `captureHistory` answer `gone`; every `Tmux` argv carries `'-t','=cc-myid:'`;
`tmuxTarget('w-my.site') === '=cc-w-my_site:'`; the attach argvs are `['attach','-t','=cc-demo:']`.

## Deviations found

- **D-3525** — *Every tmux target is exact (`=cc-<id>:`), closing D-2781 and D-2862.* Measured on tmux 3.4:
  a bare `-t cc-<id>` resolves a missing session to a unique-prefix sibling (and, for window- and pane-type
  commands, to a same-named window in a later session), so a dead session probed `live`, its supervisor
  kept ticking against the sibling, and every kill path — `cmd_stop`, `cmd_swap`, `ws-rm`, `ws-archive`,
  `ws-reap`, `cmd_account_pane --cancel` — killed the sibling. D-2781 found the hazard and fixed its
  instance; D-2862 deferred the systemic repair to a drawer wave that never took it. What shipped: one
  exact spelling for every target — `=` + the tmux-sanitised name + `:` — built once in bash (`_tmux_t`,
  `_tmux_at`; `_tmux` stays the NAME builder) and once in TypeScript (`shared/tmux-target.ts`), and the
  server's two pane classifiers read `can't find session`, which the exact target produces for a missing
  session. Rejected: `=cc-<id>` without the colon (measured: window commands still prefix-match and pane
  commands fail on a live session, silently behind `2>/dev/null`); refusing prefix-related ids at mint time
  (cannot cover URL ids, existing rows, window-name shadowing or the sign-in panes). CARRIED: tmux older
  than 2.1 has no `=` exact match; ccrc states no tmux floor (the fleet runs 3.4, the macOS CI leg 3.7c).
