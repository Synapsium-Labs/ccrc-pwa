# gpt-lane compaction wedge — context pressure on the wire, ccd compactor honesty, the astra tier

**Date:** 2026-09-08
**Trigger:** `custom-tools-calm-river` lost 80.7 minutes to
`Prompt is too long · automatic compaction failed: Request timed out`.

## The incident, measured

| Time (UTC) | Event |
|---|---|
| 12:12:59 | ccd auto-homes the session `claude → gpt` (nine sessions land on the lane in one batch) |
| 12:44:43 | ccd's proactive compactor fires — at **ctx 98%**, not its 50% threshold; succeeds, 200,130 → 25,164 tokens in 568 s |
| 18:13:32 → 18:16:53 | the last clean idle boundary. ~28 supervisor ticks, every gate open, pane reads **44%** — 5.6 points under `COMPACT_THRESHOLD=50`. ccd declines |
| 18:16:53 | the wedged turn begins at 90,305 tokens (45%) |
| 18:26:07 | four tool results add a measured 19,209 tokens → ~183,000. Past Claude Code's blocking limit |
| 18:26 → 19:37 | 71 minutes of retries on a compaction that cannot finish in time |
| 19:37:33 | the synthetic error. The turn dies |
| 19:38:37 | the pane returns to `❯`; ccd fires 64 s later |
| 19:47:07 | the identical work succeeds — **508 s** |

**The causal chain.** Claude Code 2.1.263 cannot resolve `gpt-5.6-sol` — the string `gpt-5`
appears nowhere in the 215 MB binary and the dynamic capability lookup is dead code
(`k5t(){return!1}`) — so its window resolver falls through to the global default **200,000**
(`Fme` @178837288). From that it derives an *absolute* ladder: warn 147,000 · auto-compact
167,000 (W−33,000) · **hard block 177,000** (W−23,000). At ~183,000 the block fired and Claude
Code forced a blocking, mid-turn, full-history compaction. On this lane compaction costs
**2.78–2.84 ms per input token** (508,264 ms ÷ 182,952 and 568,051 ms ÷ 200,130 — 2.1% apart),
so ~510 s. Its only deadline is the Anthropic SDK client timeout, default **600,000 ms** to
response *headers*; the stream first-byte/idle watchdogs are structurally inert here because
they require the base-URL host to be literally `api.anthropic.com`. Codex at `reasoning:
{effort: max}` streams nothing until it has finished reasoning, so the whole wait is pre-header
silence.

**The escape hatch runs at ~85% of the only budget it has.** Fleet-wide on 2026-09-08, 2 of 17
gpt-lane compactions exceeded 600 s (619,756 ms and 825,582 ms) against 97,922–127,531 ms on the
native lanes.

**What is NOT the cause, measured.** The backend never refused the prompt: zero `exceeds the
context window` errors across 1,441 logged POSTs in the live LiteLLM process. `Prompt is too
long` is Claude Code's own default banner on the blocking-limit path (`Ait(xf) ?? gC`), not an
API message. And the window must NOT be raised — see D-2011's note and `~/.local/bin/ccgpt`.

## Already shipped (box tooling, outside this repo)

`~/.local/bin/ccgpt`: `API_TIMEOUT_MS=870000` (covers every compaction ever measured on the
lane, worst 825,582 ms, while staying under `ccgpt-proxy`'s own `urlopen(timeout=900)` so Claude
Code keeps ownership of its deadline) and `CLAUDE_CODE_MAX_RETRIES=2` (the stock default is 10;
at 870 s each, one doomed compaction could hold a session for over two hours). Env is read at
exec, so live sessions are undisturbed until they respawn.

The stale catalogue comment is corrected in the same file. It said sol's max equalled its default
"so there is nothing to opt into" and told the next reader to raise the window "if the catalogue
starts reporting a bigger max_context_window". **It now does — 872,000** — and following that
instruction walks back into 2026-07-26. Measured over all 2,339 transcripts under `~/.claude-gpt`:
the largest prompt ever *accepted* on `gpt-5.6-sol` is **196,341** tokens, and `litellm.log`
carries **30** `Your input exceeds the context window` refusals, every one
`Model Group=gpt-5.6-sol`. Advertised ≠ usable.

`~/.handoff/litellm-config.yaml`: reconciled against a live catalogue read — `gpt-6-astra` and
`gpt-reserve` and `gpt-5.3-codex-spark` added, the retired `gpt-5.4` / `gpt-5.5-mini` routes
dropped, and the `[1m]` aliases removed (they existed only to serve a suffix the launcher now
forbids; while they existed a single `CCGPT_MODEL=gpt-5.6-sol[1m]` reproduced the 2026-07-26 dead
end). **Requires a LiteLLM restart to take effect.**

## Deviations found

- **D-2011 — `parseStatusline` discarded the one number that predicts a wedge.**
  `ccd/statusline-command.sh:171` renders `▓ ctx <bar> NN%` into every pane, and
  `ccd/ccd:12357`'s `_pane_ctx_pct` already scrapes it to drive the proactive compactor. The
  server's `parseStatusline` (`server/src/pane/statusline.ts`) parses model, effort, ultracode,
  branch and workflowActive from that same capture and **throws the context figure away** —
  `ctx` appears nowhere in `server/src`, `pwa/src` or `shared`. So the console measured this
  hazard every 5 seconds for 20 minutes and could not show it on any screen. Fix: parse it into
  `Statusline.ctxPct` with the existing `segmentAfter` helper anchored on `▓` (which appears
  nowhere else — `make_bar` uses █/░ and the limits segment uses ⏳), carry it as
  `FleetSession.ctxPct: number | null` (additive; `FLEET_PROTO` stays 1), and render it.
  NOTE for whoever reads this next: the number is a percentage of what Claude Code *believes*
  the window is, which on the gpt lane is 200,000 for a model whose real usable wall measures
  ~196,000. Do not "correct" the denominator here, and do not raise Claude Code's assumption.

- **D-2012 — a rising signal must not survive a miss.** `server/src/watch.ts:3227-3231` keeps
  the whole last-known `Statusline` when a tick parses nothing (`if (sl.model || sl.branch ||
  sl.effort)`), which is right for model and branch — a dialog overlay hides the statusline for
  a tick — and wrong for context pressure: a stale 82% read as current is worse than no reading
  at all. `ctxPct` must be dropped on any tick whose captured pane carried no `ctx` segment,
  while model/branch are retained, and that must stay distinguishable from a dead pane
  (`pane === null`), which already deletes the whole entry.

- **D-2013 — ccd's compactor collapses two different refusals into one silent `return 0`.**
  In `_auto_compact_check` (`ccd/ccd:12373-12375`) "the pane could not be read" and "the pane
  was read and carries no `ctx` segment" return the same value, with no log line and no registry
  field. They are different conditions with different remedies, which CLAUDE.md calls a defect
  rather than a style preference. It is live: 3 of 19 panes currently render no `ctx` segment at
  all, so they are permanently invisible to the compactor and nothing anywhere says so. Fix:
  a distinct recorded reason per refusal, rate-limited so a session pinned at 100% does not
  write a line every 5 seconds.

- **D-2014 — the lastswap gate asserts a landing compaction instead of measuring it.**
  `ccd/ccd:12371-12372` suppresses compaction for `COMPACT_COOLDOWN` after a swap because
  "a swap landing already compacted from summary". On 2026-09-08 nine sessions landed on the gpt
  lane at 12:12:59 and no landing compaction happened for calm-river — the transcript has no
  record at all between 2026-09-07T19:15:27Z and 12:44:44Z — so it sat at 98% for thirty minutes
  on a premise that measurably did not hold. Fix: re-measure rather than assume. Honest scope
  note: this would NOT have prevented the wedge (calm-river was idle across that window and was
  compacted at 12:44 regardless); it is a measured live near-miss, and any of those nine taking
  a tool step in that hole would have wedged identically.

- **D-2015 — the gpt lane's `fable` alias named a sentinel; it now names a tier.**
  `~/.claude-gpt/settings.json`'s env block carried
  `ANTHROPIC_DEFAULT_FABLE_MODEL: "ccrc-unavailable-fable"` — a deliberate loud failure, because
  the lane had only three tiers. The Codex catalogue now offers `gpt-6-astra`, so the alias names
  it. `pwa/src/lib/models.ts` must offer the row. Two facts a future reader needs: the lane's
  model map is duplicated between `~/.local/bin/ccgpt`'s exports and that settings `env` block,
  and **settings wins** (Claude Code `Object.assign`s settings env over the process environment
  at runtime); and astra answers only after LiteLLM is restarted with the new route.

- **D-2016 — a busy session with no turn boundary is invisible.** The wedge's signature is high
  context + busy + no boundary for a long time, and every field needed to see it is already on
  the wire: `FleetSession.statusUpdatedAt` ticks only on busy↔idle transitions
  (`ccd/ccd:12386-12388`), so `now - statusUpdatedAt` is the current turn's age. No new wire
  field. Deliberately NOT a new `sessionBucket` rung — "attention" means a human answer unblocks
  the session, which is false here, and a new rung would move rows out of `working` and disturb
  `pwa/src/lib/seen.ts`'s unseen ledger. Seed the threshold from the measured distribution of
  `turn_duration` across the fleet, not from this one incident: long turns are normal here and a
  threshold that flags them is noise.

## Rejected, with the measurement that rejected each

- **Raise Claude Code's assumed window** (`CLAUDE_CODE_MAX_CONTEXT_TOKENS=260000`, or a `[1m]`
  alias). The lever is real and unset, and the catalogue advertises 272,000 — but the largest
  prompt ever accepted on `gpt-5.6-sol` measures 196,341 with 30 logged size refusals, so the
  real wall is at or below what Claude Code already assumes. Raising it lets the prompt climb
  past a wall the backend enforces, and then the emergency compaction — which must send the whole
  over-wall history — hard-400s. That is the 2026-07-26 dead end, "no way out but /clear".
- **Lower `COMPACT_THRESHOLD`.** The wedged turn began at 45% and climbed to 91.5% without ever
  crossing an idle boundary; ccd's mid-turn gates are shut for a turn's whole duration, so no
  threshold value is ever consulted during the climb. It would only add compaction cost — ~500 s
  a time on this lane — to every session on every lane.
- **Give ccd a mid-turn actuator** (send ESC at a ceiling, then `/compact`). It destroys
  in-flight work — here, four subagent results that took 20 minutes to produce — and inverts the
  gate that exists so the fleet never interrupts a turn. If ever built, it belongs behind an
  opt-in file in the `AUTOCOMPACT_DISABLE_FILE` idiom, never as a default, and never before an
  operator can see the state first (D-2011, D-2016).
- **Make ccd compute context % itself** instead of scraping the statusline. It would need a
  per-lane window table — the account-name enumeration CLAUDE.md and `single-definition.test.ts`
  forbid — to duplicate a number Claude Code already publishes.
- **Block the auto-swapper from moving a session near its wall.** A swap is a rate-limit-driven
  rescue; refusing it strands the session on an exhausted account, which is worse. The honest
  version of the idea is D-2014.
- **Drop `gpt-5.6-sol` to reasoning effort `high`.** Plausible and untested: gpt-lane compaction
  duration correlates only weakly with input size (113k→420 s, 200k→568 s, 270k→469 s,
  398k→620 s), so much of the ~500 s may be fixed cost rather than effort. It also needs a
  LiteLLM restart. Worth a maintenance-window experiment with before/after
  `compact_boundary.durationMs`; not shipped on a guess.
