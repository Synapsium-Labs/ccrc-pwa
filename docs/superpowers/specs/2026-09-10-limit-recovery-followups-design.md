# Limit recovery, the follow-ups — stale Enter, a structural limit detector, an armed-nudge hold

**Status:** approved 2026-09-10 (operator: "build the followups"). Plan:
`docs/superpowers/plans/2026-09-10-limit-recovery-followups.md`. Parent spec:
`docs/superpowers/specs/2026-09-09-post-swap-redrive-design.md` (PR #73, merged `e227329e`,
deployed both lanes 2026-09-09 22:04/22:09 UTC).

## 1. What the deploy measured, and what it left

The parent spec's §1 table was four sessions rescued and four stalled. Between the agent-lane
deploy (22:04:52Z) and 10:15 UTC the next morning, `~/.cc-sessions/swap.log` carries **53 swap
landings and 53 `redrive-skip … not-stalled` lines, zero bare `redrive` lines, zero `armed`
skips**. Both halves of the parent's ruling R2 are now measured live:

| landing | kind | what the destination transcript shows |
|---|---|---|
| ccrc-pwa-quiet-summit 22:06:56 | auto-home of an IDLE session (turn ended 22:06:21) | no META prompt, no synthetic pair — a completed turn is not re-driven |
| ccrc-pwa-clear-meadow 09:29:54 | rescue (claude-expoai weekly limit) | 09:29:56 META `Continue from where you left off. Note: ccd restarted …`; 09:30:07 the assistant: "Session restarted on a different account — the previous process's sweep died on a weekly limit …" |
| expoAI-assistant-swift-meadow 10:13:14 | rescue (same storm) | 10:12:21 the banner row; 10:13:16 META prompt; 10:13:27 the assistant working |

`CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` and ccd's prompt were read from the live process
environment of a landed session (`/proc/<pid>/environ`). The fallback keystroke has not been
needed once; `REDRIVE_WAIT_S` stays at 20 (D-2371).

What the parent recorded and did not build — the three follow-ups this spec answers:

- **D-2233** — `Your usage limit has reset · press enter to continue` is a second manual-only
  state.
- **D-2234** — the limit banner's structured fields are read by nobody; the pane grep is the
  detector and the PWA renders the banner as an assistant bubble.
- **D-2235** — the server's mail nudge is the one keystroke site still un-gated on an armed
  auto-continue.

Plus one the C1 follow-up PR recorded against #73's code and ruled "its own PR" (D-2347): the
transcript reader tests `-r` alone before reading by name.

## 2. The mechanisms, measured

Read from the installed bundle (`~/.local/share/claude/versions/2.1.267`, the version every
lane ran on 2026-09-10), from `ccd/ccd` at `24f32a18`, from `server/src`, and from transcripts.

1. **The stale phase is "slept through the reset".** The auto-resume tick (`Tln` in the
   bundle) records the gap since its last observation; when that gap exceeds `graceMs` AND the
   reset instant has passed, it sets `sleptThroughReset` and, instead of firing, moves the
   checkpoint to `phase:"stale"` (`tengu_quota_auto_resume_stale`, `late_by_ms`). The status
   line then reads `Your usage limit has reset · press enter to continue` (`mu(l)` returns that
   sentence for `phase==="stale"`). **Enter in that phase submits the continuation**
   (`Rln()`/`Cln()` hand the pending prompt back; `tengu_quota_auto_resume_stale_resumed`).
   Typing while ARMED cancels (`manual_submit`) and the continuation is discarded;
   `/rate-limit-options` re-arms. So a process starved past its own reset — a cgroup
   `memory.high` throttle, a suspended box — needs one Enter, and nothing on the fleet presses
   it.
2. **When a session sits armed at all.** The rescue arm swaps a hard-blocked session within
   seconds, so the armed line is normally gone before anyone can type into it. The measured
   exceptions: `SWAP_COOLDOWN=900` — a session that swapped within the last 15 minutes and hits
   a limit on the new account is NOT rescued again until the cooldown lapses; the same for
   `SWAPBLOCK_COOLDOWN=1800` after a refused swap; and a stranded session (no destination —
   never yet logged, `grep -c ' stranded' swap.log` = 0). In every one of those the session
   waits on its own auto-continue, and the mail sweep can type into it.
3. **The banner row.** On a 429 Claude Code appends
   `{"type":"assistant","isApiErrorMessage":true,"error":"rate_limit","apiErrorStatus":429,
   "quotaLimits":{"status":"rejected","resetsAt":1789430400,"rateLimitType":"seven_day",…},
   "message":{"model":"<synthetic>","content":[{"type":"text","text":"You've hit your weekly
   limit · resets Sep 15, 12am (UTC)"}]}}` (swift-meadow, 10:12:21Z). The earlier storm's banner
   read `You've hit your session limit · resets 11:50am (UTC)` (`five_hour`).
4. **The pane regex matches neither banner text.** `_pane_hard_blocked` is
   `limit reached|reached your .*limit|out of (usage|credits)|monthly spend limit|hit your
   .*spend|API Error: 429|Too Many Requests|rate limit(ed| exceeded| reached)?|Invalid API
   key|Please run /login`. Neither "hit your session limit" nor "hit your weekly limit" is in
   it. Every rescue so far fired because the ARMED line — `Usage limit reached · continuing
   automatically at …` — stood in the same eight lines. With auto-resume off, its re-arm cap
   reached, or a human's Esc, the pane shows only the banner text and the rescue arm sees
   nothing. A blank capture (`compact-skip … pane-blank` is a logged condition on this fleet)
   blinds it outright: `[[ -n "$pane" ]] || return 0` precedes the classifier.
5. **The nudge path already reads the pane.** `sendPrompt` (`server/src/inject/send.ts`)
   captures the pane before any keystroke and refuses `dialog-open` (`hasMenu`) and
   `draft-present`; `sweepMail` (`server/src/watch.ts`) maps a refusal to `store.backOff` with
   exponential steps and, at `MAIL_MAX_ATTEMPTS`, rejects the delivery. Nothing in that
   pre-flight recognises the armed line. `store.backOff` already carries a
   `countsAsAttempt` argument (used for `substrate-unknown`).
6. **The parser.** `server/src/transcript/parse.ts` reads `isMeta` and `message.model` since
   D-2228, and neither `isApiErrorMessage`, `error` nor `quotaLimits`. The banner is an
   assistant bubble in the PWA.

## 3. Rulings

- **R6 — ccd presses Enter for a stale auto-continue (D-2360, D-2361).** A new
  `_auto_stale_check` runs on the supervise tick, BEFORE the swap arm: when the last eight pane
  lines carry `usage limit has reset … press enter to continue` and a prompt (`❯`), and no
  `esc to interrupt`, and the input box is empty, it presses Enter once, logs `stale-resume`,
  and stamps `$REG/<id>.stalepress`; it does not press again within
  `STALE_PRESS_COOLDOWN=120`. A non-empty box logs `stale-skip … input box not empty` and
  leaves the keystroke to the human. Why Enter and not a swap: the account has reset, the
  continuation is right there, and Enter is Claude Code's own documented affordance for this
  phase; a swap costs a restart and a transcript copy for nothing. Why the gate is the exact
  third-party sentence: the trust-dialog incident of 2026-09-08 (bare Enter exited five
  sessions) — a changed sentence fails CLOSED (no keystroke), never open, and the test row is
  the bundle's own string.
- **R7 — the transcript is a second limit detector, structural, beside the pane grep (D-2362,
  D-2363).** `_transcript_limit_banner <path>` answers 0 when the newest real
  user/assistant row in the transcript tail is `"isApiErrorMessage":true` + `"error":"rate_limit"`
  (local-command rows are not turns; any other row means the session moved on), and prints
  `resetsAt` and `rateLimitType`. `_session_hard_blocked id pane` is the union — pane first,
  unchanged; then, only when no turn is running, the transcript — and it stands down when the
  input box is not empty, because `cmd_swap` carries the transcript and never the box. The rescue
  arm and the strand half both call it; a blank pane no longer returns before the verdict; the
  `auto-rescue` line carries ` via=transcript` when the pane alone would not have fired.
- **R8 — `_pane_hard_blocked`'s text is NOT widened (D-2364).** Adding `hit your .*limit` would
  also match the banner's text wherever Claude Code re-renders the previous assistant message on
  a `--resume` landing — whether it does is unmeasured, and `_spawn_settle` turns that regex into
  rc 5 ("blocked on the new account") on every landing. The structural detector needs no text
  and cannot be fooled by a re-render: on the destination the newest real row is the META
  resume prompt within seconds. Recorded, not done.
- **R9 — the banner is a system event on the wire (D-2365, D-2366).** The parser maps an
  assistant row with `isApiErrorMessage:true` and `error:"rate_limit"` to
  `{kind:'system', origin:'limit', text:<the banner text>, resetsAt?:<epoch seconds>}` —
  `SystemOrigin` gains `'limit'`, the system member gains an optional `resetsAt`; additive,
  absence-permits, no `FLEET_PROTO` bump. The PWA words it `usage limit · resets HH:MM` in the
  viewer's local clock (with the date when it is not today) and keeps Claude Code's sentence as
  the tooltip. Other API-error rows (`overloaded`, 5xx) stay assistant bubbles — recorded, out of
  scope.
- **R10 — the mail nudge holds while an auto-continue is armed (D-2367, D-2368, D-2369).**
  `autoContinueArmed(pane)` lives in `server/src/pane/dialog.ts` beside `hasMenu`, its regex the
  same literal as ccd's `_pane_auto_continue_armed`, and a test reads ccd's line from source and
  fails on drift (the RESUME_PROMPT_PREFIX pattern: bash cannot import TS). `sendPrompt` gains
  `holdIfAutoContinueArmed`; when set it refuses `auto-continue-armed` before any keystroke,
  after `not-alive` and before `dialog-open`. Only the mail sweep sets it. The sweep maps that
  refusal to `store.backOff(id, 'auto-continue-armed', now + MAIL_ARMED_HOLD_MS, false)` —
  five minutes, no attempt counted, so a delivery cannot be parked by a limit — and tells the
  sender once (`mail-blocked-<id>`, like `draft-present`). The PWA prompt route and dispatch's
  `/clear` are deliberately NOT gated: a human typing is Claude Code's documented cancel and the
  pane is on their screen; `/clear` ends the conversation on purpose.
- **R11 — D-2347 closes here (D-2370).** Both transcript readers test `-f && -r` before reading
  by name. This is an agent-first `ccd` PR on the same rung, which is what D-2347 asked for.
- **R12 — the non-home-able cc-limits stamp is unchanged (D-2374).** The rescue arm's
  `{"five":100,"seven":0,"ts":now}` for a non-home-able wrapper keeps its 5-hour expiry rather
  than the banner's `resetsAt`; the gpt lane's 429 carries no Anthropic-shaped `quotaLimits`
  to read. Recorded, not done.

## 4. Out of scope, observed 2026-09-10

- **A delayed dispatch does not re-check its subject (D-2372).** 10:14:20 the affinity arm
  dispatched quiet-summit `claude-expoai -> claude-dev0 (in 43s)`; 10:14:35 a swap
  `claude-expoai -> gpt` landed from elsewhere; 10:15:05 the delayed dispatch fired and moved it
  again, `gpt -> claude-dev0`. Two restarts in thirty seconds. D-2232's neighbour; its own
  investigation.
- **A gpt-lane landing at ctx 100% ran no turn (D-2373).** bright-meadow landed on `gpt` at
  10:13:39 with the META prompt written and nothing after it within twelve minutes, while the
  compactor logged `not-idle (status=busy ctx 100%)`. The gpt lane's context wall
  (`ws/gpt-lane-prompt-compaction-timeout-2` owns it).
- Generic API-error rows in the PWA (R9).

## 5. Deviations

D-2360..D-2374 were ISSUED by `POST /api/ledger/deviations` on 2026-09-10 (floor now 2375) and
are DEFINED in the plan's `## Deviations found` section.
