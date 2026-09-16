# Post-swap re-drive — limit recovery without a manual resume message

**Status:** approved 2026-09-09 (operator: "build the fixes"). Plan:
`docs/superpowers/plans/2026-09-09-post-swap-redrive.md`.

## 1. The class of problem, as reported

> Recovery from hitting limits essentially leaves a session in a state where the only recovery
> path is manual intervention by sending a resume message, as the built-in mechanisms don't seem
> to produce the desired result.

Measured on the claude2 storm of 2026-09-09 (four sessions rescued to claude-dev0 within six
minutes), every one of them: **the rescue fires, the swap lands, the session sits idle at a prompt
until a human types.**

| session | banner | rescue decided | swap landed | idle until | what ended the idle |
|---|---|---|---|---|---|
| intake-platform-quiet-cove | 11:23:23 | 11:23:28 | 11:25:29 | 11:52:45 | typed `куігьу` ("resume" on a Cyrillic layout) |
| custom-tools-calm-river | 11:22:57 | 11:22:58 | 11:23:07 | 11:31:48 | typed `resume` |
| custom-tools-amber-ridge | 11:25:22 | 11:25:25 | 11:27:05 | 11:32:55 | typed `resume work` |
| ccrc-pwa-clear-meadow | 11:27:38 | 11:27:42 | 11:29:04 | 11:30:24 | an incidental ccrc-mail nudge |

Sources: `~/.cc-sessions/swap.log`, `journalctl --user -u claude-session@<id>`, each session's
transcript JSONL under the destination account's `projects/` dir.

## 2. The mechanism, measured

Every fact below was read from the installed Claude Code bundle
(`~/.local/share/claude/versions/2.1.266`, and 2.1.263/2.1.265 carry the same strings), from
`ccd/ccd`, or from the transcripts. None is remembered.

1. **Claude Code arms its own recovery on a limit.** The turn ends with an assistant entry
   `isApiErrorMessage:true, error:"rate_limit", apiErrorStatus:429,
   quotaLimits:{status:"rejected", resetsAt:<epoch>, rateLimitType:"five_hour"}` and a system
   line `Usage limit reached · continuing automatically at 11:50am · esc or type to cancel`. That
   timer is in-memory: **any keystroke cancels it** (`tengu_rl_checkpoint_auto_continue_cancelled_by_slash`
   exists for exactly a slash command), and a process restart discards it.
2. **ccd's rescue arm sees that line and swaps.** `_pane_hard_blocked` (`ccd/ccd`) matches
   `limit reached`; `_auto_swap_check` dispatches `ccd swap` with up to `SWAP_JITTER`=120 s of
   delay; `cmd_swap` stops the unit, carries the transcript, and `_spawn_start` runs
   `<wrapper> --resume '<uuid>'` on the destination. The armed auto-continue dies with the old
   process. So far this is the design working.
3. **On `--resume`, Claude Code writes a resume prompt it then does not submit.** Its
   deserializer (`C$n` in the bundle) classifies the tail — an unanswered task-notification plus
   an API-error assistant entry — as `interrupted_turn`, appends a META user message
   `Continue from where you left off.` (`CLAUDE_CODE_RESUME_PROMPT`, default `v$n`), and pads it
   with a synthetic assistant `No response requested.` (`message.model:"<synthetic>"`) so the
   alternation stays valid. The REPL submits that prompt **only when**
   `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` is set:

   ```js
   if (a.CLAUDE_CODE_RESUME_INTERRUPTED_TURN && e.turnInterruptionState?.kind==="interrupted_prompt"
       && dy(e.turnInterruptionState.message.origin)) { /* auto-resume */ O = {message: ...} }
   function dy(e){ return e===void 0 || e.kind==="human" || e.kind==="auto-continuation" }
   ```

   The synthetic prompt carries no origin, so `dy(undefined)` is true: a plain ccd `--resume`
   qualifies. The value Claude Code's own self-hosted runner sets for a respawned worker is the
   string `"1"` (`CLAUDE_CODE_RESUME_INTERRUPTED_TURN: o>1 ? "1" : void 0`). With
   `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` unset there is no staleness suppression.
4. **ccd sets no `CLAUDE_CODE_*` variable at all** (`grep -oE 'CLAUDE_CODE_[A-Z_]+' ccd/ccd` is
   empty; the generated wrappers export only `CLAUDE_CONFIG_DIR` and `exec` the launcher).
   `_spawn_settle` types `/effort ultracode` and returns. Nothing re-drives the turn. The server's
   only prompt injection is the mail nudge (`watch.ts` → `sendPrompt(renderMailNudge)`), which is
   what woke clear-meadow by accident.
5. **The affinity arm then bounces the stalled session home.** At the exact `fiveResetAt`
   instant `_limit_field` returns `""`, `_avail home` succeeds, and the session — idle precisely
   because it stalled — passes the idle gate: a second restart, a second transcript copy, a second
   synthetic pair, and on claude2 a `Remote Control disconnected — Claude.ai login was rejected`.
   Zero turns ran on the rescue account.
6. **The PWA renders the stall as a conversation.** `server/src/transcript/parse.ts` reads
   neither `isMeta` nor `message.model`, so the META prompt is a right-aligned user bubble and the
   synthetic padding is an assistant reply. The clip that opened this work reads as "someone sent
   a resume and it was ignored"; nobody sent anything.

## 3. Rulings

- **R1 — Rescue stays; the swap must re-drive.** Rescue-plus-re-drive continues the work within
  about two minutes on an account with headroom, which beats waiting up to five hours. The rescue
  arm is therefore **not** gated on the armed auto-continue line (D-2236). What changes is the
  landing: ccd switches on Claude Code's own interrupted-turn resume for every spawn (D-2227),
  with a ccd-authored `CLAUDE_CODE_RESUME_PROMPT` that tells the model the harness restarted it
  and its background work is gone.
- **R2 — A third-party flag ships with a measurement and a fallback.** The flag is undocumented.
  `_spawn_settle` therefore measures the transcript tail after the TUI is up: if the newest real
  turn is still the unsubmitted pair, ccd types the prompt itself and logs `redrive` (D-2231).
  The measurement is the transcript, never hookstate (D-2237): `working` proves tool calls, not
  that the re-drive took.
- **R3 — ccd never cancels an armed auto-continue.** A new `_pane_auto_continue_armed` gates the
  two keystroke sites that can reach a stranded session — `_auto_compact_check` and
  `_inject_spawn_effort` — and the fallback re-drive itself (D-2229). The server's mail nudge is
  the remaining un-gated site (D-2235, follow-up).
- **R4 — The transcript tells the truth on the PWA.** The parser turns the META resume prompt and
  the synthetic padding into `system` events carrying an additive `origin` field; the bubble words
  the padding as a stall (D-2228). Additive wire field, absence-permits, no `FLEET_PROTO` bump.
- **R5 — No age cap on the re-drive.** `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` stays
  unset by default (`RESUME_REDRIVE_MAX_AGE_MS=""`): a supervisor revival after a box outage is
  exactly the case that should continue on its own, and the prompt itself tells the model to
  re-verify time-sensitive state (D-2230). A `ws-restore` of an old interrupted session re-drives
  too; restore is human-only and Esc stops it.

## 4. Out of scope, recorded

- `Your usage limit has reset · press enter to continue` (Claude Code's `stale` phase) is a
  second manual-only state; R3 prevents ccd from causing it, nothing here answers it (D-2233).
- The limit banner's structured fields (`quotaLimits.resetsAt`, `error:"rate_limit"`) are read by
  nobody; pane-grep remains the detector (D-2234).
- The affinity bounce at the reset instant (§2.5) needs no change once R1 lands: a re-driven
  session is mid-turn and the mid-turn gate defers it. Recorded, not fixed (D-2232).

## 5. Deviations

Numbers D-2226..D-2237 were ISSUED by `POST /api/ledger/deviations` on 2026-09-09 and are
DEFINED in the plan's `## Deviations found` section, which is the ledger's landing site.
