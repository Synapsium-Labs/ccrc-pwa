# Limit swap autofix: wake onto a full account, the latent rescue holes, faster detection and a fleet watchdog

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (or
> superpowers:executing-plans) to carry out this plan task by task. Every task is test-first: write the failing test,
> watch it fail for the stated reason, make it pass, commit.

**Goal.** No session stays on a usage limit for more than a few minutes without an automatic swap or an operator
item that carries its own control. Every fix keeps the rescue's one act: end the session and resume it on another
account. Nothing ever sends keys to Claude Code's rate-limit menu ("What do you want to do?"), because an Enter or a
digit there can pick "Switch to usage credits".

**Architecture.** Tasks 1 to 6 and 8 change `ccd` alone. Task 7 adds two box settings (ccd/ccrc's `CCRC_SETTINGS`,
the box-settings tables in `shared/api.ts`, the console's family label). Task 9 adds a ccd verb on its own systemd
timer. Tasks 10 and 11 carry the watchdog's "no room" state through the agent and server to a Waiting on you row with
its controls. Each task ships on its own, in this order.

**Tech stack.** bash (`ccd/ccd`, `ccd/ccrc`), systemd user units, TypeScript (server, agent, shared, pwa), vitest.
Run vitest as `npx vitest run --maxWorkers=2 <files>` with at most about 12 files per command, in a package that has
`node_modules` (`npm ci` first if it has none). ccd tests use fixture HOMEs only (`makeCcdHarness`).

## Deviations found

- **D-8123 (2026-11-09)** — a limit-blocked session is moved without a human: a wake or start onto an account at its
  ceiling moves first, the wake stand-down yields at the ceiling, three latent rescue holes close, detection reads
  past the auto-opened limit menu, a lone rescue waits at most 15 s, and a fleet-level limit watchdog forces a stuck
  rescue or raises an operator item with its own control.

The operator's rulings of 2026-11-09, all as recommended:

1. **Wake fix.** When a session is woken or settled onto an account at its ceiling (today the settle step's
   `_serviceable` rc 1 only calls `_route_degrade`), pick a rescue target with measured room and start the session
   there instead. The wake stand-down gate (`SWAP_COOLDOWN` after `.woke`) yields when the session's account is at its
   ceiling.
2. **Latent holes.** An account whose usage is unknown ranks after every measured account with room as a rescue
   target and is never counted as free. A limit-blocked session whose class window is undecidable drops the class
   gate rather than strand. A pane narrower than the pane-check width still gets the transcript check.
3. **Faster detection.** Bypass the 30 s transcript-verdict cache (`.tscan`, `TRANSCRIPT_ARM_INTERVAL`) while the
   rate-limit menu or a limit banner is on screen. Read enough pane rows that the auto-opened menu cannot push the
   banner out (today `tail -8`). Cap the rescue jitter at 15 s when it is the only rescue in flight, and keep the full
   0 to 120 s spread when several are in flight (the 2026-08-14 herd outage).
4. **Fleet-level limit watchdog** on its own timer, not a per-session supervisor tick. Any live session that shows a
   limit sign (the pane, banner or transcript rungs, or its account at 98 or more in `~/.cc-limits`) for N minutes
   (a setting, default 5) with no swap is forced through the normal rescue path past the cooldown, draft and
   stale-press holds. A draft is overridden after N minutes (ruled). It never sends keys and logs `watchdog-rescue`.
   When no account has measured room it raises a Waiting on you item that carries its own one-tap control ("Swap
   to…" listing accounts with room as they appear, plus "Wait until reset at HH:MM"), per the ruling that an item
   carries its own control (one tap plus a confirm), through the existing operator item and swap doors.
5. **The fleet box picks up new releases by itself** through the existing safe update path. If that is a setting
   the operator can already turn on, the default in code does not change and the setting is reported. Finding below:
   it is, so this plan has no task for ruling 5.

Departures this plan takes inside the rulings, for the reviewer to confirm:

- **The wake move sits at the caller, not inside the settle.** The settle (`_spawn_start`) runs inside the session's
  own unit, which cannot stop itself to move. The move is made by `cmd_ensure` and `cmd_start` before they ask the
  unit to spawn, with the same figure test the settle's rc 1 reads (`_avail`, a known five-hour or seven-day half at
  `SWAP_CEILING`), so it also covers a session with no class. The settle's `_route_degrade` stays as the backstop for
  an in-unit revival, and ruling 1's gate change (Task 2) moves that one at its first idle tick.
- **The watchdog does not force a move while the session is mid-turn on an account-only sign.** A session at 98 or 99
  can still be working; a stop loses the turn. The rulings name cooldown, draft and stale-press as the holds to pass,
  not a running turn. A pane, banner, menu or transcript sign cannot be mid-turn, so those are forced as ruled.
- **"Wait until reset" needs one new narrow verb.** No existing door records an operator's choice to wait, so Task 10
  adds `ccd limit-wait <id>` behind the agent whitelist, composed by a session-gated route beside the swap route.
  "Swap to…" goes through the existing `POST /api/sessions/:id/swap` and the existing `SwapSheet`.

## What was measured first

From the swap study of 2026-11-08 (fleet box, read only), with code read at `origin/main` f5b90f302:

- **After the draft-reader fix (D-8116) reached the box, two limit episodes, both off the account within 20 s.**
  A child: transcript rung, `auto-rescue … via=transcript type=seven_day`, dispatched "in 15s", landed 20 s after the
  banner. A coordinator: woke onto an account that read `seven=100`. ccd logged
  `degrade …: opus -> sonnet (unservable (99): opus on <lane> at settle)`, then `stand-down …: woke`. The banner came
  42 s after the wake, and a manual swap moved it 15 s later. Nothing automatic moved it.
- **Why the wake did not move it.** `cmd_ensure` → `_hib_wake_clear` stamps `.woke` and spawns on the current
  wrapper. The settle's `_serviceable` rc 1 only calls `_route_degrade`. In `_auto_swap_check` the affinity arm (the
  one that leaves an account at its ceiling) is held by
  `[[ … now - woke < SWAP_COOLDOWN ]] && _standdown_note "$id" woke`.
- **Why the 15 s after the banner saw no rescue (inferred).** `_session_hard_blocked` reuses `.tscan` for
  `TRANSCRIPT_ARM_INTERVAL` (30 s), and a negative verdict from just after the wake was likely still cached. The pane
  rungs read `tail -8`, and the auto-opened menu fills those rows: in `server/test/fixtures/panes/box/rate-limit-dialog.ansi`
  the banner is row 12 of the visible pane and the last eight rows are the menu (checked: the `_pane_limit_banner`
  pattern matches the whole pane, not its last eight rows). Then `SWAP_JITTER` adds 0 to 120 s.
- **Every visible pane on the fleet box is 50 rows** (18 of 18 sampled). A whole-pane read is one `capture-pane -p`.
- **Unknown usage.** `_swap_target`'s candidate loop already ranks an unmeasured candidate at 100, after every scored
  one. The hole is its home-recovered arm: on a forced rescue (`cur != home`), a home whose usage is unknown passes
  `_avail` and is returned before the loop ranks anything, ahead of a measured account with room.
- **Class window.** `_auto_swap_check`'s `strc == 5` arm strands a hard-blocked session with
  `_strand_mark … classwindow`. One coordinator logs `tick-undecidable … classwindow` every 30 minutes.
- **Narrow pane.** `_auto_swap_check` returns at its first line when `_pane_measurable` fails, and
  `_session_hard_blocked` answers `unmeasurable` before its transcript rung, so a pane under `READER_MIN_COLS` (120)
  is never rescued.
- **Release pickup.** The box ran without the D-8116 fix for about 14.5 hours after it was published, because every
  install on the box was `ccrc-detach update --to … --from pwa`.

## Ruling 5: the box already has the setting, so no code

- **What decides it.** The update dispatcher (`server/src/update/converge.ts` `runDispatch`, deciding through
  `dispatch.ts` `intendedMove` and `autoPermits` in `shared/update-move.ts`) moves a node automatically when its
  resolved update intent's `auto` permits its channel and it has a `desiredTag`. `auto` is `off`, `stable` (moves a
  node on the stable channel only) or `channel` (moves a node on any channel). An automatic move also needs the
  node's caps to carry `update-gate` (`moveRefusal`'s `no-update-gate`), and D-8122's `autoHeld` holds it while the
  fleet host's pressure reads critical. The install is the same `ccrc-detach update` the PWA starts, so its sweep
  restarts supervisors in batches and live sessions keep running.
- **What the box reads today** (`~/.ccrc/update-intent`, written by `ccd-update-sync`): `channel dev`, `auto off`,
  `desired-dev` one release newer than the version installed, `desired-stable none`. Its `ccrc-caps` carry
  `update-gate` and `detach`.
- **The setting.** The update intent's `auto` set to `channel`, because the box follows the dev channel and the
  limit fixes ship as dev releases (`stable` would never move it while `desired-stable` is `none`). In the console:
  Settings → Updates → Policy → Auto-install → "On any channel". That control writes the fleet scope (`*`), so it also
  moves the server box automatically. To move only the fleet box, send
  `POST /api/updates/intent` with `{"scope": "<the fleet box's node id>", "auto": "channel"}` (the id is
  `~/.ccrc/node-id` on that box). A node-scope row overrides the fleet row, so check `GET /api/updates`'s `intent`
  list for a node row that still says `off`.
- **No code change.** The default (`auto` off for a new install) stays as it is for other installers.

## Task order

| Task | Title | Touches | Size | Ships alone |
|---|---|---|---|---|
| 1 | A wake or start onto an account at its ceiling moves first | ccd only | M | yes |
| 2 | The wake stand-down yields at the ceiling | ccd only | S | yes |
| 3 | An unmeasured home never outranks measured room on a forced rescue | ccd only | S | yes |
| 4 | A limit-blocked session with an undecidable class window drops the class gate | ccd only | S | yes |
| 5 | A narrow pane still gets the transcript rung | ccd only | S | yes |
| 6 | The limit menu: read the whole pane for its banner and bypass the verdict cache | ccd only | M | yes |
| 7 | Box settings `limit-rescue`, and a lone rescue's jitter capped | ccd, ccrc, shared tables, pwa words, docs | M | yes |
| 8 | One dispatch per session at a time | ccd only | S | yes |
| 9 | The fleet limit watchdog on its own timer | ccd, ccrc install, deploy units | L | yes (needs 7, 8) |
| 10 | The "no room" record and the wait door reach the server | ccd, agent, server, shared | M | yes (needs 9) |
| 11 | The Waiting on you row with "Swap to…" and "Wait until reset" | pwa, shared | M | yes (needs 10) |

Tasks 1 to 6 and 8 are ccd-only and can land in any order among themselves. A task that changes a function another
task also edits (Tasks 1 and 3 in `_swap_target`; Tasks 5 and 6 in `_session_hard_blocked`) rebases on the earlier one.

Shared test scaffolding: every new ccd test file follows `server/test/ccd-standdown-notes.test.ts`. It uses
`makeCcdHarness`, the session id `lane-a-project-a`, the default test roster (`claude`, `claude-a`, `claude-b`,
`claude-d`, `gpt`), a `tmux` stub that answers `$HOME/pane.txt` and logs every call to `$HOME/ccd-calls`, and the
`FAKE_NOW` clock seam. `limits(w, five, seven, opts)` writes `~/.cc-limits/<w>.json` with `ts` and, when given, the
`fiveResetAt`/`sevenResetAt` keys. Every ccd test file below ends with the keystroke pin
`expect(h.calls().filter((l) => /send-keys/.test(l))).toEqual([])`.

---

### Task 1: A wake or start onto an account at its ceiling moves first (ccd only, M)

**Files**
- Modify `ccd/ccd`: new `_wake_ceiling_move`, called from `cmd_ensure` and `cmd_start` in their `CCD_IN_UNIT != 1`
  branch, after `_hib_wake_clear` and before `_supervised_start`. `_swap_target` honours `CCD_RESCUE_MEASURED_ONLY`.
  `_swap_end_cause` names the `wake` arm. `cmd_swap`'s `CCD_SWAP_ARM` case passes `wake` straight through (no act
  gate: nothing is running to back off from).
- Create `server/test/ccd-wake-ceiling-move.test.ts`.

**Interfaces**
```bash
_wake_ceiling_move() {   # id -> rc 0 a move was dispatched (the caller returns 0 and spawns nothing) | 1 nothing to do (the caller spawns as before)
# rc 1 when: CCD_WAKE_MOVE=1 (the swap's own `|| cmd_ensure` fallback); the session is alive; `_avail "$wrapper"`
# passes (no KNOWN half at SWAP_CEILING); or no target with MEASURED room (`CCD_RESCUE_MEASURED_ONLY=1 _rescue_target
# id wrapper home 1 hrc` answers no name, or rc 2-5). Otherwise: stamps `lastswap`, logs
#   wake-rescue <id>: <wrapper> (ceiling five=<n|?> seven=<n|?>) -> <target> [home=<home>]
# and runs `CCD_WAKE_MOVE=1 CCD_SWAP_AUTO=1 CCD_SWAP_ARM=wake ccd swap <id> <target>` in its own transient unit
# (`_svc_run_detached`, no jitter), so a long carry never runs inside the caller's timeout. A no-room answer logs
#   wake-ceiling-stay <id>: <wrapper> at its ceiling and no account has measured room
# once per wake, and the wake spawns on the current account as today.
```
`CCD_RESCUE_MEASURED_ONLY=1` in `_swap_target`: the candidate loop skips a candidate whose `_limit_score` is empty,
and the home-recovered arm admits home only when `_limit_score "$home"` is a number. Unset, nothing changes.

The hold file and a manual-swap pin do not stop the move: a session started on an account at its ceiling is
evacuated by the limit rescue a minute later anyway, and both already let a limit evacuate.

**TDD**

1. Write the failing tests:
```ts
// server/test/ccd-wake-ceiling-move.test.ts (stubs: `_supervised_start` and `_svc_run_detached` append to ccd-calls)
it('a wake onto an account reading seven=100 moves to the account with measured room, not the unmeasured one', () => {
  seed('claude', 'claude'); touchReg(`${ID}.hibernated`);
  limits('claude', 10, 100, { sevenResetAt: T0 + 86400 });
  limits('claude-a', 20, 30, {});              // measured room
  // claude-b, claude-d: no telemetry (unknown)
  h.sh(`${STUBS} cmd_ensure ${ID}`, env());
  expect(detached()).toEqual([expect.stringMatching(/CCD_WAKE_MOVE=1 CCD_SWAP_AUTO=1 CCD_SWAP_ARM=wake .* swap 'lane-a-project-a' 'claude-a'/)]);
  expect(h.calls().some((l) => l.startsWith('supervised-start'))).toBe(false);
  expect(lines('wake-rescue')).toEqual([expect.stringMatching(/: claude \(ceiling five=10 seven=100\) -> claude-a \[home=claude\]$/)]);
  expect(regGet('lastswap')).toBe(String(T0));
});
it('only unmeasured room: no move, the wake spawns where it is and says so once', () => { /* claude=100, no other files */
  // expect supervised-start, one `wake-ceiling-stay` line, no detached swap
});
it('an account under the ceiling: byte-identical to today (no swap.log line, supervised-start)', () => {});
it('a seven-day reading whose sevenResetAt has passed is not a ceiling', () => {});
it('the swap fallback re-entering cmd_ensure (CCD_WAKE_MOVE=1) never moves again', () => {});
it('an in-unit ensure (CCD_IN_UNIT=1) never moves', () => {});
it('cmd_start of a stopped session at its ceiling moves the same way', () => {});
it('sends no keys', () => { /* the keystroke pin over every case above */ });
```
2. Run `cd server && npx vitest run --maxWorkers=2 test/ccd-wake-ceiling-move.test.ts`. Expected: the first, fifth
   and seventh cases fail (no `wake-rescue` line, `supervised-start` called). The others pass and are the
   characterization.
3. Implement `_wake_ceiling_move`, the two call sites and the `_swap_target` env switch. Re-run: all pass. Re-run
   `test/ccd-swap-target-class.test.ts test/ccd-hibernate-roll.test.ts test/ccd-hibernate.test.ts test/ccd-swap.test.ts`
   to confirm nothing else moved.
4. Commit: `ccd: a wake or start onto an account at its ceiling moves to measured room first (D-8123)`.

---

### Task 2: The wake stand-down yields at the ceiling (ccd only, S)

**Files**
- Modify `ccd/ccd` `_auto_swap_check`: the `.woke` gate becomes
  `[[ "$woke" =~ ^[0-9]+$ && $(( now - woke )) -lt "$SWAP_COOLDOWN" ]] && _avail "$wrapper" && { _standdown_note "$id" woke; return 0; }`.
- Modify `server/test/ccd-standdown-notes.test.ts` (add cases beside its woke row).

**Interfaces.** No new function. When the gate yields, the tick goes on to the gates that already follow it
(`_swap_idle_gate`, `_affinity_cur_serves`, the box read, `_affinity_slot_take`).

**TDD**
1. Failing test:
```ts
it('a woken session whose account reads seven=100 is moved by the affinity arm, not held by woke', () => {
  seed(); h.sh(`_reg_set ${ID} woke ${T0 - 30}`); idleStatus();
  limits('claude', 10, 100, { sevenResetAt: T0 + 86400 }); limits('claude-a', 20, 30, {});
  tick(PROMPT, { target: null });
  expect(lines('stand-down')).toEqual([]);
  expect(dispatches()).toEqual(['dispatch lane-a-project-a -> claude-a affinity']);
});
it('kept: a woken session on an account under the ceiling still stands down `woke`', () => {});
```
2. Run `npx vitest run --maxWorkers=2 test/ccd-standdown-notes.test.ts`. Expected: the first case fails with a
   `stand-down lane-a-project-a: woke` line.
3. Implement and re-run.
4. Commit: `ccd: the wake stand-down yields when the session's account is at its ceiling (D-8123)`.

---

### Task 3: An unmeasured home never outranks measured room on a forced rescue (ccd only, S)

**Files**
- Modify `ccd/ccd` `_swap_target`: the home-recovered arm adds `{ [[ -z "$force" ]] || [[ -n "$(_limit_score "$home")" ]]; }`.
  A forced call with an unmeasured home falls through to the candidate loop, where home is a candidate like any other
  and ranks at 100 (the loop's unmeasured rank), after every measured account with room.
- Create `server/test/ccd-rescue-unknown-rank.test.ts`.

**Interfaces.** `_swap_target`'s answers do not change shape. The unforced call (the affinity arm returning home)
is unchanged: returning home while its telemetry is quiet is the D-6181 affinity policy, not a rescue.

**TDD**
1. Failing test:
```ts
it('forced, away from home, home unmeasured, claude-b measured at 40: picks claude-b', () => {
  seed('claude-a', 'claude'); limits('claude-b', 40, 40, {});      // claude: no file
  expect(h.sh(`_swap_target ${ID} claude-a claude 1 0`).trim()).toBe('claude-b');
});
it('forced, home unmeasured and nothing measured has room: still home (eligible, ranked last)', () => {});
it('kept: unforced, home unmeasured: returns home (affinity)', () => {});
it('kept: forced, home measured at 20: returns home before the loop', () => {});
```
2. Run `npx vitest run --maxWorkers=2 test/ccd-rescue-unknown-rank.test.ts test/ccd-swap-target-class.test.ts`.
   Expected: the first case fails, answering `claude`.
3. Implement and re-run, adding `test/ccd-auto-swap-pool.test.ts test/ccd-nested-rescue.test.ts`.
4. Commit: `ccd: an unmeasured home ranks after measured room on a forced rescue (D-8123)`.

---

### Task 4: A limit-blocked session with an undecidable class window drops the class gate (ccd only, S)

**Files**
- Modify `ccd/ccd`: `_swap_target` reads `CCD_CLASS_GATE_OFF=1` as "no class" (`cls=""` after `_route_peek_to`).
  In `_auto_swap_check`'s `strc -ge 2` arm, when `strc == 5` and `hard_blocked` is set, retry once with
  `CCD_CLASS_GATE_OFF=1 _rescue_target …`. With a target, log
  `class-gate-dropped <id>: class window undecidable; rescuing without the class gate` and take the normal rescue path.
  With none, strand as today.
- Create `server/test/ccd-rescue-classwindow-drop.test.ts`.

**Interfaces.** No new function. The landing's settle measures the new lane's serviceability as it always does, and
on an unmeasured figure composes the standing class (it does not degrade on a fabricated fact).

**TDD**
1. Failing test (stubs: `_route_peek_to() { printf -v "$1" opus; }`, `_class_gate() { [[ -z "$2" ]] && return 0; return 2; }`,
   a fresh transcript limit row):
```ts
it('hard-blocked and the class window undecidable: rescued without the class gate, never stranded', () => {
  tick(PROMPT, { target: null, extra: CLASS_UNMEASURED });
  expect(lines('class-gate-dropped')).toHaveLength(1);
  expect(dispatches()).toEqual([expect.stringMatching(/^dispatch lane-a-project-a -> claude-a rescue/)]);
  expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(false);
});
it('kept: not blocked and the class window undecidable: tick-undecidable classwindow, no move', () => {});
```
2. Run the file. Expected: the first case fails with a `.stranded` marker and no dispatch.
3. Implement and re-run, adding `test/ccd-swap-target-class.test.ts test/nested-rescue-words.test.ts`.
4. Commit: `ccd: a limit-blocked session drops an undecidable class gate rather than strand (D-8123)`.

---

### Task 5: A narrow pane still gets the transcript rung (ccd only, S)

**Files**
- Modify `ccd/ccd`:
  - `_session_hard_blocked`: when `_pane_measurable` fails, skip both pane rungs and the `esc to interrupt` test, run
    the stale-press grace and the transcript rung as today, and keep the box read's `draft` stand-down. It still
    answers `HARD_BLOCK_NO=unmeasurable` when the transcript says nothing.
  - `_auto_swap_check`: the narrow-pane early return runs `_session_hard_blocked` first. A positive verdict takes the
    rescue path (the affinity arm still never runs on a narrow pane). A negative one keeps today's
    `_pane_narrow_note` line.
- Create `server/test/ccd-narrow-pane-transcript.test.ts`.

**TDD**
1. Failing test (`touch $HOME/narrow` makes the width query answer 80):
```ts
it('a narrow pane whose transcript ends in this process\'s limit row is rescued via=transcript', () => {
  seed(); narrow(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
  tick(PROMPT, { target: null });
  expect(lines('auto-rescue')).toEqual([expect.stringMatching(/ via=transcript /)]);
});
it('a narrow pane with a draft stands down `draft`, no move', () => {});
it('kept: a narrow pane with no limit row writes the narrow note and moves nothing', () => {});
```
2. Run with `test/ccd-reader-standdown.test.ts test/ccd-standdown-notes.test.ts`. Expected: the first case fails (no
   `auto-rescue`).
3. Implement and re-run.
4. Commit: `ccd: a pane narrower than the reader width still gets the transcript rung (D-8123)`.

---

### Task 6: The limit menu: read the whole pane for its banner and bypass the verdict cache (ccd only, M)

**Files**
- Modify `ccd/ccd`:
  - New `_pane_limit_menu` (pane text → rc 0 iff the rate-limit menu is up: a `What do you want to do?` row and a
    numbered cursor row naming one of its options, `Stop and wait for limit to reset` or `Switch to usage credits`).
  - New `_pane_limit_capture_to var id tail` → `var` = the whole visible pane when `_pane_limit_menu` holds on it,
    else `tail` unchanged. It costs one extra `capture-pane -p` only when the tail shows the menu's footer
    (`Enter to confirm · Esc to cancel`) or the question row.
  - `_session_hard_blocked`: `_pane_limit_banner` is asked of that capture (the broad `_pane_hard_blocked` stays on
    `tail -8`, so text in the conversation can never trigger it). While the menu or a banner is on screen, the
    `.tscan` cached verdict is not reused and the scan runs fresh (its answer is still written back).
  - `_swap_rescue_act_gate` and `_standdown_outside_tail` read the same capture.
- Create `server/test/ccd-limit-menu-detect.test.ts`, reading `server/test/fixtures/panes/box/rate-limit-dialog.ansi`
  and `rate-limit-dialog-mail-row.ansi` (plain for `-p`, raw for `-e`).

**Interfaces.** No new rung word: a banner found above the menu is `HARD_BLOCK_VIA=banner`, as today. The menu
alone is not a verdict, but it forces the fresh transcript scan.

**TDD**
1. Failing tests:
```ts
it('the menu fixture: the banner above the menu is found, via=banner', () => {
  seed(); pane(MENU_FIXTURE);
  tick(MENU_FIXTURE, { target: null });
  expect(lines('auto-rescue')).toEqual([expect.stringMatching(/ via=banner /)]);   // today: no banner in tail -8
});
it('menu up and a negative .tscan 5 s old: the transcript is rescanned, not reused', () => {
  seed(); h.sh(`_reg_set ${ID} tscan "${T0 - 5} 0"`); writeTranscript([turn(T0 - 60), limitRow(T0 - 3)]);
  tick(MENU_WITHOUT_BANNER, { target: null });
  expect(lines('auto-rescue')).toHaveLength(1);
});
it('kept: a banner-shaped line in the conversation, 20 rows up and no menu, is not a block', () => {});
it('kept: no menu: a negative .tscan inside the interval is reused (no rescan)', () => {});
it('the act gate with the menu up does not cancel the rescue', () => {
  // `_swap_rescue_act_gate` with CCD_SWAP_TX set: rc 0, no `rescue-cancel` line
});
it('sends no keys, whatever the menu shows', () => {});
```
2. Run with `test/ccd-pane-box-draft.test.ts test/ccd-limit-banner.test.ts test/ccd-limit-banner-corpus.test.ts`.
   Expected: the first, second and fifth cases fail.
3. Implement and re-run.
4. Commit: `ccd: read past the auto-opened limit menu and rescan the transcript while it is up (D-8123)`.

---

### Task 7: Box settings `limit-rescue`, and a lone rescue's jitter capped (ccd + settings tables, M)

**Files**
- Modify `ccd/ccrc`: `CCRC_SETTINGS` gains `CCRC_RESCUE_SOLO_JITTER_S` and `CCRC_LIMIT_WATCHDOG_MIN`. The table rows
  are `CCRC_RESCUE_SOLO_JITTER_S:value:limit-rescue:fleet,both:run` and
  `CCRC_LIMIT_WATCHDOG_MIN:value:limit-rescue:fleet,both:run`. A family check `_lr_ok` admits an integer from 0 to 120
  for the jitter and 0 to 1440 for the minutes (0 turns the watchdog off). `_lr_says` gives the console sentence.
- Regenerate `ccd/lib/ccrc-settings.sh` (`node deploy/gen-settings-lib.mjs`).
- Modify `shared/api.ts`: `BoxSettingFamily` gains `'limit-rescue'`, and `BOX_SETTINGS_TABLE` gets the two rows.
- Modify `pwa/src/fleet/boxSettingsWords.ts`: the family label `'limit-rescue': 'Limit rescue'`.
- Modify `README.md` (configuration table), `deploy/ccrc.env.example` (commented defaults), and the
  `server/test/fixtures/box-settings/ok--*.json` rows the corpus pins.
- Modify `ccd/ccd`: a helper reads a box setting once per process, as the browser-tools read does (source the library
  in a subshell and call `_ccrc_knob`). `_dispatch_swap` computes its jitter through `_rescue_jitter_max`.
- Create `server/test/ccd-rescue-jitter-solo.test.ts`. Extend `server/test/box-settings-table.test.ts`,
  `ccrc-settings-census.test.ts`, `ccrc-settings-verb.test.ts` and `ccrc-settings-lib.test.ts` as their own pins
  demand.

**Interfaces**
```bash
_rescue_jitter_max() {   # id arm -> prints the jitter ceiling for this dispatch
# rescue|watchdog with NO other session's `lastswap` inside SWAP_JITTER + 60 s: min(SWAP_JITTER, CCRC_RESCUE_SOLO_JITTER_S)
# anything else (affinity, or another dispatch in flight): SWAP_JITTER. Reads `$REG/*.lastswap` with builtins only.
}
```
`_dispatch_swap` draws `RANDOM % (max + 1)` as today. The dispatch line gains ` max=<n>`, so swap.log shows which
spread applied.

**TDD**
1. Failing tests (stub `_svc_run_detached` to record its `sleep N`; set `RANDOM` per draw through a stub
   `_jitter_draw() { echo "$1"; }` that returns the ceiling, so the bound is asserted exactly):
```ts
it('a lone rescue draws from 0..15', () => { expect(dispatchLine('rescue')).toMatch(/\(in 15s\) max=15$/); });
it('a rescue with another session dispatched 30 s ago keeps 0..120', () => {});
it('an affinity move always keeps 0..120', () => {});
it('CCRC_RESCUE_SOLO_JITTER_S=0 in ccrc.env: a lone rescue goes at once', () => {});
it('SWAP_JITTER=0 still means no delay at all', () => {});
```
2. Run the new file plus the four settings test files. Expected: the jitter cases fail on `max=` and the bound, and
   the table pins fail until both rows exist everywhere.
3. Implement and re-run. The box-settings corpus regeneration case is Linux-only, as D-8122's was; it runs on CI.
4. Commit: `ccd: box settings for limit rescue and a lone rescue's jitter capped at 15 s (D-8123)`.

---

### Task 8: One dispatch per session at a time (ccd only, S)

**Files**
- Modify `ccd/ccd` `_dispatch_swap`: before `_svc_run_detached`, claim `$REG/<id>.dispatching` with a no-clobber
  write of the epoch. A claim younger than `SWAP_JITTER + 60` refuses the dispatch: it logs
  `dispatch-dup <id> -> <target> (a dispatch at <epoch> is still pending)`, restores `lastswap` from the caller's
  `prev`, and returns 1. An older claim is replaced. `cmd_swap` removes the claim on every exit after its act-time
  gates (one `trap … RETURN` in the auto branch).
- Create `server/test/ccd-dispatch-claim.test.ts`.

**Why.** The watchdog (Task 9) and a supervisor tick can decide for the same session in the same second. Two
transient units running `cmd_swap` for one session is the double-move this guards against.

**TDD**
1. Failing test: two `_dispatch_swap lane-a-project-a claude-a rescue …` calls in one fixture second. Expect one
   recorded `systemd-run` and one `dispatch-dup` line. A third call with the claim's epoch moved back
   `SWAP_JITTER + 61` s dispatches.
2. Run with `test/ccd-swap.test.ts test/swap-timeout-budget.test.ts`. Expected: the duplicate case fails (two
   dispatches).
3. Implement and re-run.
4. Commit: `ccd: one pending swap dispatch per session (D-8123)`.

---

### Task 9: The fleet limit watchdog on its own timer (ccd, ccrc install, deploy units, L)

**Files**
- Modify `ccd/ccd`: new verb `limit-watchdog` (`cmd_limit_watchdog`), new `_watchdog_sign_to`,
  `_swap_watchdog_act_gate`, `_watchdog_resume_here`; `cmd_swap`'s arm case gains `watchdog`; the dispatcher gains
  `limit-watchdog)`.
- Create `deploy/systemd/ccd-limit-watchdog.service` (Type=oneshot,
  `ExecStart=%h/.local/bin/ccd limit-watchdog`, `TimeoutStartSec=50`, `MemoryMax=256M`, `Nice=10`) and
  `deploy/systemd/ccd-limit-watchdog.timer` (`OnActiveSec=2min`, `OnUnitActiveSec=60s`, `AccuracySec=10s`).
- Modify `ccd/ccrc` (`_inst_atomic` of both units, `_inst_enable_timer limit-watchdog` on every role but `server`,
  the uninstall lists) and `deploy/deploy.sh` (`_unit_atomic` and `enable --now`), as `ccd-scope-sweep` is done.
- Modify `CLAUDE.md`: `limit-watchdog` and `limit-wait` (Task 10) join the verbs no session runs by hand.
- Create `server/test/ccd-limit-watchdog.test.ts` and `server/test/ccd-limit-no-keys.test.ts`. Extend
  `ccrc-install-role.test.ts`, `ccrc-uninstall.test.ts` and `installTreeFixture.ts` for the new unit pair.

**Interfaces**
```bash
cmd_limit_watchdog() {   # (no args) — one pass over every live session; always exits 0 unless the registry is unreadable
# N = CCRC_LIMIT_WATCHDOG_MIN (Task 7); 0: exit at once. For each id with a live pane (not hibernated, not stopped):
#   _watchdog_sign_to sign id  -> sign = pane|banner|menu|transcript|account|"" (carried-in rows excluded)
#   no sign: rm `$REG/<id>.limitsign`; close an open limitwait (Task 10)
#   sign:    keep `$REG/<id>.limitsign` = "<since> <sign>" (since is the first pass that saw any sign)
#   now - since >= N*60 AND (no lastswap OR lastswap <= since OR now - lastswap >= N*60):   # the clock restarts at the last move
#     sign == account AND the pane shows `esc to interrupt`: log `watchdog-hold <id>: running` once, act next pass
#     target with MEASURED room: CCD_RESCUE_MEASURED_ONLY=1 _rescue_target id wrapper home 1 hrc
#       (rc 5: one retry with CCD_CLASS_GATE_OFF=1, as Task 4)
#     found: lastswap=now; log
#       watchdog-rescue <id>: <wrapper> -> <target> [home=<home>] sign=<sign> for=<seconds>s
#       _dispatch_swap id target watchdog "$prev" "$now" "$dfrom" "$dto" "$tx" "$txbytes"
#     none:  write the limitwait record (Task 10) and `_strand_mark` with cause
#       "limit sign <sign> for <m> min and no account has measured room"; log `watchdog-noroom` once per episode
#   at most WATCHDOG_PER_PASS (3) forced rescues per pass; the rest wait for the next pass (60 s)
}
_watchdog_sign_to() {   # var id -> the first rung that holds, in order: pane (tail -8, `_pane_hard_blocked`), banner
# (`_pane_limit_banner` over Task 6's capture), menu (`_pane_limit_menu`), transcript (`_limit_dated … transcript`,
# uncached), account (`_limit_field_to` five or seven at SWAP_CEILING or more, read with maxage SWAP_FRESH so a quiet
# account's old reading is no sign). Never writes `.tscan`.
}
_swap_watchdog_act_gate() {   # id wrapper -> rc 0 proceed | 1 backed off. Re-asks `_watchdog_sign_to`: no sign ->
# `watchdog-cancel <id>: no limit sign`; output since the decision -> `rescue-backoff <id>: output since decision`.
# A draft or a stale-press does NOT back off (ruled). Never reads or writes the input box.
}
_watchdog_resume_here() {   # id — limitwait choice=wait, its reset passed, and the session's own account now has
# measured room: `_end_record id limit-resume`, then the same stop-and-ensure a swap does, on the same account, in a
# transient unit. Logs `watchdog-resume <id>: <wrapper> after reset`. Nothing is typed into the pane.
}
```

**TDD**
1. Failing tests (`ccd-limit-watchdog.test.ts`; the clock seam moves `FAKE_NOW` between passes):
```ts
it('a banner for 5 minutes with no swap: watchdog-rescue past the cooldown and a draft', () => {
  seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 1000}`);          // older than the sign
  pass(BANNER_WITH_DRAFT, T0);                                    // first sight: stamps limitsign, no act
  pass(BANNER_WITH_DRAFT, T0 + 299); expect(dispatches()).toEqual([]);
  pass(BANNER_WITH_DRAFT, T0 + 300);
  expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/sign=banner for=300s$/)]);
  expect(dispatches()).toEqual([expect.stringMatching(/ watchdog$/)]);
});
it('the sign clears between passes: the clock restarts', () => {});
it('a swap after the sign began: no act until the sign has outlived that swap by N minutes', () => {});
it('the watchdog\'s own move restarts the clock: a landing still on a limit is forced again N minutes later', () => {});
it('account-only sign while mid-turn: watchdog-hold running, no dispatch', () => {});
it('an account reading 99 older than SWAP_FRESH is no sign', () => {});
it('no account has measured room: watchdog-noroom once, a strand, a limitwait record, no dispatch', () => {});
it('four sessions due in one pass: three dispatched, the fourth next pass', () => {});
it('CCRC_LIMIT_WATCHDOG_MIN=0: nothing is read or written', () => {});
it('the act gate: sign gone -> watchdog-cancel; draft -> proceeds', () => {});
it('choice=wait and the reset passed with room on its own account: watchdog-resume, same account', () => {});
```
   `ccd-limit-no-keys.test.ts` reads `ccd/ccd`, cuts out the bodies of `cmd_limit_watchdog`, `_watchdog_sign_to`,
   `_swap_watchdog_act_gate`, `_watchdog_resume_here`, `_wake_ceiling_move` and `cmd_limit_wait`, and asserts none
   contains `send-keys`, `_send_keys` or `paste-buffer`.
2. Run `npx vitest run --maxWorkers=2 test/ccd-limit-watchdog.test.ts test/ccd-limit-no-keys.test.ts test/ccrc-install-role.test.ts test/ccrc-uninstall.test.ts`.
   Expected: every watchdog case fails with `unknown command: limit-watchdog`, and the install pins fail on the
   missing units.
3. Implement and re-run, adding `test/ccd-swap.test.ts test/ccd-standdown-notes.test.ts test/ccd-dispatch-claim.test.ts`.
4. Commit: `ccd: a fleet limit watchdog on its own timer forces a stuck rescue or records no room (D-8123)`.

---

### Task 10: The "no room" record and the wait door reach the server (ccd, agent, server, shared, M)

**Files**
- Modify `ccd/ccd`: the limitwait record `$REG/<id>.limitwait` is one line,
  `state=open since=<epoch> reset=<epoch|-> account=<wrapper> sign=<sign>[ choice=wait at=<epoch>]`. It has one
  writer. The reset is the transcript row's `HARD_BLOCK_RESET`, else the account's `fiveResetAt` or `sevenResetAt`
  for the window at the ceiling, else `-`. A landing swap (`cmd_swap`'s success tail) or a pass with no sign closes
  it (`state=closed … end=<swap|clear>`). New verb `ccd limit-wait <id>` (`cmd_limit_wait`) adds `choice=wait at=<now>`
  to an open record and refuses any other state (`not-waiting`).
- Modify `server/src/ccdargv.ts`: `limitWait: (id) => argv(['limit-wait', id])`.
- Modify the agent's ccd whitelist (`agent/src`, with `agent/test/whitelist.test.ts`) to admit `['limit-wait']`.
- Modify `server/src/registry.ts` (read `$REG/<id>.limitwait` beside `.stranded`, with the same three-valued read),
  `server/src/fleet.ts` (map it), and `shared/api.ts`
  (`FleetSession.limitWait: { since: number; reset: number | null; account: string; waiting: boolean } | null` and its
  reviver; an older server's frame without the field reads `null`).
- Modify `server/src/server.ts`: `POST /api/sessions/:id/limit-wait`, session-gated exactly as the swap route is,
  answering `{ok: true}` or the ccd refusal word.
- Create `shared/limitRoom.ts`: `hasMeasuredRoom(row, ceiling)` and `accountsWithMeasuredRoom(limits, ceiling)`, L0
  and pure. A row has measured room when both halves it applies (`fiveWindowMinutes == 0` reads seven alone) are
  measured, under the ceiling, and inside their window. This is the twin of ccd's `_limit_score` and `_avail` rule.
- Create `server/test/limit-room-parity.test.ts` (one fixture table run through `shared/limitRoom.ts` and through ccd's
  `_limit_score`/`_avail` in a fixture HOME, as `server/test/fixtures/serviceability.ts` drives its twin),
  `server/test/limit-wait-read.test.ts` and `server/test/ccd-limit-wait.test.ts`.

**TDD**
1. Failing tests: the registry read of `state=open since=… reset=… account=lane-a sign=menu` gives
   `{since, reset, account: 'lane-a', waiting: false}`, and `choice=wait` gives `waiting: true`. A closed record, an
   absent file, and a malformed line (never evaluated) read `null`. `ccd limit-wait` on an open record appends the
   choice, and on a closed one exits non-zero with `not-waiting`. The route maps both. The parity table agrees for
   measured, half-measured, rolled-over, `fiveWindowMinutes: 0` and at-ceiling rows.
2. Run `cd server && npx vitest run --maxWorkers=2 test/limit-room-parity.test.ts test/limit-wait-read.test.ts test/ccd-limit-wait.test.ts`,
   then `cd agent && npx vitest run --maxWorkers=2 test/whitelist.test.ts`. Expected: all fail (missing modules,
   verb and field).
3. Implement and re-run, adding `server/test/swap-route-busy.test.ts`.
4. Commit: `limit wait: the watchdog's no-room record and the wait door reach the server (D-8123)`.

---

### Task 11: The Waiting on you row with "Swap to…" and "Wait until reset" (pwa, M)

**Files**
- Modify `pwa/src/ledgers/ledgerWords.ts`: `limitRows(sessions)` lists the sessions whose `limitWait` is not null.
  `waitingTotal` and `programmeWaitingCount` count them, because an item the operator must act on is never hidden
  (the rollup ruling).
- Create `pwa/src/ledgers/LimitWaitRow.tsx`. The row reads "<session> is on a usage limit and no account has room".
  It carries its own two controls, each one tap and then a confirm sentence:
  - **Swap to…** opens `SwapSheet` with its list narrowed to `accountsWithMeasuredRoom` over the accounts' limits the
    page already holds. The list updates as limits frames arrive, so an account appears when it gains room. With
    none, the control reads "No account has room yet" and is disabled. The pick goes through the existing
    `api.swap`, including its `session-busy` second tap.
  - **Wait until reset at HH:MM** (the record's `reset` in the page's clock and zone; "Wait until the limit resets"
    when `reset` is null) calls `api.limitWait(id)`. Once `waiting` is true the row shows "Waiting until HH:MM" and
    keeps "Swap to…".
- Modify `pwa/src/ledgers/WaitingScreen.tsx` (draw the rows in the combined list and in their programme's group),
  `pwa/src/lib/api.ts` (`limitWait`) and `pwa/src/ledgers/ledgers.css` (no new tokens; reuse the row and pill styles).
- Create `pwa/test/limit-wait-row.test.tsx`. Extend `pwa/test/waiting-screen.test.tsx` and `pwa/test/ledger-words.test.ts`.

**TDD**
1. Failing tests: a session with `limitWait` draws one row with both controls. "Swap to…" lists only the accounts with
   measured room, and adds one when a new limits snapshot gives it room. Each control needs its confirm before any
   request. The confirmed swap calls `api.swap(id, 'lane-b')` once. The confirmed wait calls `api.limitWait(id)` once.
   `waiting: true` reads "Waiting until 15:00". The count includes the row. Check the layout at phone, laptop and
   wide widths (`pwa/browser` leg).
2. Run `cd pwa && npx vitest run --maxWorkers=2 test/limit-wait-row.test.tsx test/waiting-screen.test.tsx test/ledger-words.test.ts test/swap-sheet.test.tsx`.
   Expected: fail (no row, no count).
3. Implement and re-run, then `npx tsc --noEmit` in `pwa`.
4. Commit: `pwa: a usage-limit row on Waiting on you carries Swap to and Wait until reset (D-8123)`.

---

## Known risks and the tests that pin them

| Risk | What could go wrong | How it is held | Pinned by |
|---|---|---|---|
| Herding | A window rollover limits many sessions at once. Short jitter or a watchdog pass restarts them together (the 2026-08-14 outage). | The 15 s cap applies only when no other session dispatched in the last `SWAP_JITTER + 60` s; otherwise the full 0 to 120 s spread. The watchdog forces at most 3 per pass. One pending dispatch per session. A wake move is one per wake, inside the server's existing wake budget and D-8122's memory gate. | Task 7 "another session dispatched 30 s ago keeps 0..120"; Task 9 "four sessions due in one pass"; Task 8 duplicate dispatch |
| An account at its ceiling read stale | A high reading whose window already ended moves a session for nothing. A low reading that is days old sends a rescue onto a full account. | Usage only rises inside a window, so a high reading is a lower bound until `resetAt`, and `_limit_field_to` already retracts a reading past its reset. The watchdog's account sign also needs a reading younger than `SWAP_FRESH`. A wrong landing hits the banner and is rescued again, with do-not-bounce, inside N minutes at worst. Unknown is never preferred and never counts as room for a wake or watchdog move. | Task 1 "sevenResetAt has passed is not a ceiling" and "only unmeasured room: no move"; Task 3; Task 9 "older than SWAP_FRESH is no sign"; Task 10 parity table |
| Keystroke safety | A key reaching the rate-limit menu picks "Switch to usage credits". | Every new path ends the session and resumes it (`cmd_swap`, or stop and ensure). None reads or writes the input box except to stand down. | The keystroke pin in every ccd test file; Task 9 `ccd-limit-no-keys.test.ts` source scan |
| False limit from the wider read | A banner-shaped line in the conversation triggers a rescue. | The whole-pane read is used only while the menu is up, and only for the specific current-banner pattern. The broad pattern stays on `tail -8`. | Task 6 "banner-shaped line … no menu, is not a block" |
| Draft loss | The watchdog override, or a narrow pane whose box read misses a wrapped draft, ends a session with typed text. The conversation carries over and the draft is lost. | Ruled for the watchdog after N minutes. The narrow pane keeps the `draft` stand-down when the box read sees one. | Task 9 act gate "draft -> proceeds"; Task 5 "narrow pane with a draft stands down" |
| Lost turn | A forced move while the session is working. | The account-only sign waits for the turn to end. Every other sign means the session is not working. | Task 9 "account-only sign while mid-turn" |
| Double act | The watchdog and a supervisor tick decide the same second. | The dispatch claim, and the watchdog acts only when no swap moved the session in the last N minutes. | Task 8; Task 9 "a swap after the sign began" |
| Wake latency | A wake move's carry takes longer than an ensure's caller waits. | The move runs in its own transient unit and the ensure returns at once. A caller sees the session come up on the new account a little later. | Task 1 first case (detached, no `supervised-start`) |

## Known limits

- An in-unit revival (systemd `Restart=always`) onto an account at its ceiling still settles there with a degrade.
  Task 2 moves it at its first idle tick, and the limit rescue moves it if it hits the banner first.
- Box settings are read once per supervisor or watchdog process. A changed value reaches running supervisors at their
  next restart (every update restarts them); the watchdog reads it every pass.
- A 5-hour block that clears by itself before the watchdog's N minutes leaves no record, as the study noted. The
  watchdog's `limitsign` lines are now the evidence for any block that lasts one pass.
- The menu's option text is pinned from the committed fixtures. If Claude Code rewords the menu, `_pane_limit_menu`
  stops matching and detection falls back to the transcript rung within 30 s, with no keys sent either way.
