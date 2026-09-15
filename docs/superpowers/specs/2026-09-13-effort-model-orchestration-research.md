# Effort, model and orchestration routing — research and validation

Recorded 2026-09-13 as the input to a design brainstorm. ccrc today has no policy
that decides effort, model or subagent model per session, role or task; this note
establishes what the evidence says the optimal setup is, validates it against this
fleet's own numbers, and lists the seams a design would use. It is research, not a
spec: nothing here is a decision.

Method: Anthropic's cost-optimization and model-migration guidance (bundled
`claude-api` skill, cached 2026-06-24), Claude Code docs and help-center articles
(fetched 2026-09-13), independent evaluations, a read-only survey of this tree, a
read-only capture of the 28 live sessions' statuslines, and a globally de-duplicated
scan of 45.5 GB of transcripts on the fleet box for the last 30 days.

## 1. What the measured evidence says about effort

**The curve is per-workload and per-model; level names do not transfer across models.**
Anthropic's own runs (Claude Fable 5 unless stated):

| Workload shape | Effort step-down | Quality cost | Token cost |
|---|---|---|---|
| Research / knowledge work | default → `medium` | none measurable on four benchmarks | 70–85% of default |
| Research / knowledge work | default → `low` | −1 to −3 points | one third to one half off |
| Long-horizon coding (Opus 5) | default → `medium` | −2 points | ~50% |
| Long-horizon coding (Opus 5) | default → `low` | −8 points | ~25% |
| Reasoning-ceiling research | each step | +2.4 rubric points per step | no free cut |

Independent: Artificial Analysis measures Claude Opus 5 at `high` / `xhigh` / `max` as
48 / 50 / 51 on its Intelligence Index, with `xhigh` generating 110M tokens over the
suite against a 94M median — two points for roughly 17% more output. Diminishing
returns at the top are measured, not assumed.

**Anthropic's per-model recommendations** (model-migration guide): Opus 4.7/4.8 —
`xhigh` "for most coding and agentic use cases", `high` the minimum for
intelligence-sensitive work, `medium` cost-sensitive, `low` short scoped tasks.
Sonnet 5 — keep `high`, raise to `xhigh` only for the hardest coding; it "respects
effort strictly" and under-thinks at `low`. Claude Fable 5.1 — default `high`;
"lower effort settings, including `low`, still perform very well, often exceeding
the `xhigh` or even `max` performance of previous models"; "at higher effort on
routine work, Claude Fable 5.1 can gather context and deliberate beyond what the task
needs". Lower effort means "fewer and more-consolidated tool calls, less preamble".

**Escalation beats allocation when a failure signal exists.** Run everything at
`low` and re-run failures at the default: 93% pass at about $0.70 per task versus
91.7% at $1.39 running everything at the default; starting at `medium` gave 94% at
$0.95. This only works with a checker (tests, a validator, a review). ccrc's loop has
several: suites, review lenses, the wave-done re-measurement.

**The stage → effort table circulating online** (architecture = high/xhigh,
debugging = xhigh/max, features = medium, tests = medium, routine = low) has no
primary source. It is independently reproduced by several 2026 blogs that relabel
Anthropic's per-level *descriptions* with software-lifecycle stage names. No
measurement backs the stage assignments. The evidence keys on workload shape (bulk
versus dependent chain, checkable versus not, ceiling versus routine) and on the
model, not on lifecycle stage.

## 2. What the evidence says about model tiering and subagents

- **Stronger model at lower effort often beats a cheaper model.** Claude Fable 5 at
  `low` beat Sonnet 5 on a deep-research benchmark at ~10% less per task. On a
  coding subset Opus 5 matched Fable 5 (91.7% vs 91.3%) at ~60% of its cost. Haiku 4.5
  answered knowledge questions at a tenth of Opus 5's cost at 63% vs 92% accuracy —
  "high-volume work with checkable outputs, not long agentic loops".
- **Orchestrator + cheaper workers pays only when there is bulk beyond one context
  window.** Measured: −55% cost at 3–7 points below the frontier model solo on work
  larger than a context; on routine search it paid as tail insurance; on a single
  dependent chain that fits one context "the coordinator's model alone at lower
  effort came out ahead" in every case measured. Anthropic's 2025 multi-agent
  research post: multi-agent systems use ~15× the tokens of a single chat turn.
  A 2026-07-22 Anthropic webinar (numbers reported second-hand): Fable 5
  orchestrator + Sonnet 5 workers reached 96% of Fable-solo's BrowseComp score at 46%
  of the cost; on an easier subset the mix added 60% cost for no gain.
- **Advisor pattern** (cheap executor consulting a frontier model) sat within noise
  of the frontier model alone at `medium`, at about the same cost.
- **Subagent mechanics that set the cost:** a subagent starts a fresh prefix with no
  cache shared with the parent; switching the main loop's model mid-session
  invalidates its cache, so the cheaper model belongs in a subagent, not a `/model`
  swap; fresh-context verifier subagents outperform self-critique; asynchronous
  long-lived subagents beat spawn-and-block on Fable 5.1 (context persists, cache
  reads instead of re-establishment).

## 3. How this fleet is billed (primary sources, fetched 2026-09-13)

- All Anthropic models on a Max account draw from **one** rolling 5-hour window and
  **one** weekly window; metering is token-based; per-model weights are not
  published ("Anthropic no longer publishes the exact token count that the
  multiplier is applied to"). Per-token price is the only available proxy for the
  weight.
- **Fable 5 and 5.1 are included on Max** ("a standard part of your plan"); "you can
  use up to 50% of your weekly usage limits on Fable models at no extra cost"; they
  "use them faster than other Claude models"; past the 50% share "you can keep using
  Fable models with usage credits, or switch to another model". The promotion that
  ended 2026-07-19 was the **Pro** allowance for Fable 5 only.
  → `~/.claude/fable-orchestration-policy.md` says Fable "bills usage credits after
  2026-07-19"; that is the Pro sentence misapplied to Max. The 2026-09-04
  "out of usage credits" incident is what the 50% cap looks like from inside a
  session. Correction pending operator approval.
- Fast mode is usage-credits only and outside the subscription limits.
- Help-center guidance for Claude Code: "Opus … uses meaningfully more of your quota,
  so switch to it when you need it rather than leaving it on by default"; "/clear …
  is the single most effective lever for both quality and cost"; effort level,
  model choice and conversation length are the listed factors that move the limit.
- **Live state:** 4 of the 9 measured lanes sat at `seven: 100` during this survey.
  The fleet is window-bound, so token efficiency is throughput, not money — except
  Fable past its 50% share, which is money.

## 4. This fleet, measured

**Configuration.** Every Anthropic lane's `settings.json` has `effortLevel: "xhigh"`;
the default lane (`.claude`) pins `modelSettings["claude-fable-5-1"].effortLevel = "high"`
and a second Anthropic lane pins Opus 5 to `high`; only the gpt lane sets
`CLAUDE_CODE_SUBAGENT_MODEL` (`sonnet`). `ccd/ccd:975` `SPAWN_EFFORT="ultracode"` and
`_inject_spawn_effort` (`ccd/ccd:14905`) type `/effort ultracode` into every freshly
spawned Anthropic session, regardless of role.

**Live distribution (28 tmux sessions, read-only capture):** 24 at `xhigh` (most
with the ultracode divider), 3 at `high`, 1 unreadable; 24 on Opus 5, 3 on Fable
5.1, 1 on the gpt lane. Coordinators and workers are indistinguishable by effort.

**30-day transcript scan** (494,311 billable messages after global de-duplication —
85% of raw assistant lines were duplicates: content-block splits plus identical
transcripts carried across up to six config dirs by swaps). API-rate equivalents,
labelled as such; the subscription weights them by an unpublished rule.

| Component | Share of ≈$40k API-equivalent |
|---|---|
| cache reads (context re-sent each turn) | 63.7% |
| cache writes (context growth each turn) | 29.4% |
| output tokens (what effort controls directly) | 6.9% |
| uncached input | ~0% |

| Model | Messages | Avg context per turn | Output per turn | API-equiv |
|---|---|---|---|---|
| Opus 5 | 253,920 | 155k | 257 | $28.0k |
| Sonnet 5 | 103,853 | 150k | 76 | $4.1k |
| Fable 5 + 5.1 | 25,126 | 169k / 228k | 399 / 1,109 | ≈$5.4–6.6k (Fable cache rates vary) |
| Opus 4.7 | 12,884 | 57k | 707 | $1.2k |
| Haiku 4.5 | 1,349 | — | — | $15 |

- **Subagents are 80% of messages and ~60% of spend.** Opus 5 subagents alone are
  ≈$17.7k, about 44% of everything. Sonnet 5 is 99.9% subagent traffic (some
  routing to Sonnet already happens). Subagents average 150k of context per turn —
  they are not the cheap, short contexts the guidance assumes.
- Cache hit ratios are 94–97% on every model: caching is not the lever here.
- Fable is ~14% of spend; Fable 5.1 writes 4× the output per turn of Opus 5 and takes
  far fewer turns.
- **Transcripts carry `"effort"` as a top-level field on every line.** Per-turn
  effort is measurable retroactively; `output_config` never appears.

**What this changes.** The effort table attacks the 7% slice. The two levers the
numbers point at are (i) context per turn × turns per task, and (ii) which model
the subagent fleet runs on. Effort matters mostly through its effect on turn count
("fewer and more-consolidated tool calls"), which this scan cannot separate — it
needs an A/B on real waves.

## 5. Seams in ccrc (survey 2026-09-13; `ccd/ccd` lines spot-checked)

Has:
- Model and effort **pickers** that type `/model <alias>` and `/effort <level>` into
  the pane (`pwa/src/lib/models.ts:29,54` → `POST /api/sessions/:id/prompt` →
  `server/src/inject/send.ts:431`). No launch-time model or effort choice
  (`api.createSession` carries only wrapper/project/workdir).
- **Read-back** of model / effort / ultracode / ctx% from the statusline
  (`server/src/pane/statusline.ts:18,132`, merged in `server/src/watch.ts:3394`,
  on the wire as `FleetSession.model/effort/ultracode/ctxPct`, `shared/api.ts:45-70`).
- **Spawn-time effort injection**, one global constant (`ccd/ccd:975`, `:14905`).
- **Per-lane env materialiser** for `ANTHROPIC_DEFAULT_*_MODEL`,
  `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`
  (`shared/modelenv.mjs:44-64,160,247`), driven only by the operator CLI
  `ccrc models <account> …` (`deploy/models-op.mjs`). Refuses `opus`/`fable` as the
  subagent class — a rule measured on the gpt lane's allowlist, not on Anthropic
  lanes (`shared/modelenv.mjs:84-129`).
- **Limits reader and lane ranking** (`server/src/limits.ts:9,128,225,282`;
  `~/.cc-limits/<account>.json` = `{five, seven, ts, fiveResetAt, sevenResetAt}`),
  written by `ccd/statusline-command.sh:238-252` from Claude Code's own payload —
  which carries only `five_hour` and `seven_day`, no per-model window.
- **Subagent lifecycle events** in hookstate (`SubagentStart`/`SubagentStop` →
  `subagents: [{name, startedAt}]`, `ccd/session-hook.sh:1401-1429`) — name and time
  only.
- **Roles inferred, not stored:** coordinator = `runs.claimedBy`; worker = the hold
  `program:<slug> wave:N/M`. No reviewer role exists.
- Claude Code itself: `--effort`, `CLAUDE_CODE_EFFORT_LEVEL` (overrides all,
  v2.1.236+), `effortLevel` and `modelSettings.<id>.effortLevel` in settings, agent
  frontmatter `model:` and `effort:`, `CLAUDE_CODE_SUBAGENT_MODEL` (+ `_FORCE`),
  subagent resolution order: per-call `model` > frontmatter > env > session model.
  OpenTelemetry `claude_code.token.usage` / `claude_code.cost.usage` carry `model`,
  `effort`, `agent.name`, `skill.name` attributes.

Lacks:
- Any per-role, per-wave or per-task effort or model policy; any structured
  model/effort field in a wave brief (`server/src/coord/dispatch.ts:168,185` — free
  text; the coordinator and worker skills never mention model, effort or subagents).
- Any token accounting: the statusline's `💲` segment is rendered
  (`ccd/statusline-command.sh:174-178`) and never parsed; hookstate carries no usage.
- Subagent model pinning on Anthropic lanes.
- A feedback loop from outcomes (review rounds, first-pass wave-done) to settings.

Prior art: `2026-09-08-model-class-registry-design.md` (lane configuration, not
routing); `2026-09-04-account-pools-design.md`; `2026-09-07-account-health-and-provenance-design.md`.
No spec addresses routing by role or task.

## 6. Validation status

| Claim | Status |
|---|---|
| Effort curves by workload; escalation beats allocation | measured by Anthropic; independent corroboration on Opus 5 only (Artificial Analysis) |
| Stronger model at lower effort vs cheaper model | measured by Anthropic; one second-hand webinar data point |
| Fable included on Max to 50% weekly; consumes faster | primary source (help center) |
| Per-model window weights; whether cache reads count less | **unpublished** — measurable here by correlating `.cc-limits` deltas with transcript usage |
| Fleet spend composition (context ≫ output) | measured, 30 days, de-duplicated; dollars are API-rate equivalents |
| Fleet runs `xhigh`/ultracode regardless of role | measured (settings, ccd source, live panes) |
| Quality effect of lower effort on **this** fleet's waves | **not measured** — no eval exists; needs an A/B on real waves with the review lens as checker |
| Per-model effort cost index and rate-limit payload shape (Claude Code 2.1.270 binary) | **measured 2026-09-14** from `strings` on the installed binary: the model catalogue carries `effort_cost_index` per model — Opus 5 {low 0.67, medium 0.76, high 1, xhigh 1.6, max 1.7}, Fable 5.1 {0.75, 0.86, 1, 1.38, 1.74}, Sonnet 5 {0.47, 0.74, 1, 2.41, 5.59} — and Haiku 4.5 is hard-coded as effort-unsupported. The statusline payload's `rate_limits` is built from `five_hour`, `seven_day` and `spend_limit` only; the per-class buckets (`seven_day_opus`, `seven_day_sonnet`, `model_scoped[]`) belong to the `get_usage` control-request schema, not the statusline. Dynamic workflows are their own setting (`enableWorkflows`); `ultracode` is refused unless they are enabled. |
| Subagent model resolution on an **Anthropic** lane (Claude Code 2.1.270) | **measured 2026-09-13**, two headless `-p` arms on one Anthropic (Max) lane, session `--model opus`: with `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` the default subagent ran on `claude-sonnet-5` and a per-call `model: opus` subagent did NOT land in the sonnet or haiku buckets; with the env unset the default subagent ran on `claude-opus-5` (inherits the session) and per-call `model: haiku` ran on Haiku. The gpt-lane family step-down recorded in `shared/modelenv.mjs:84-129` is a proxy-catalogue artefact and does not transfer to Anthropic lanes. Each arm cost about $0.2 API-equivalent. |
| `get_usage` control request as a per-class bucket channel | **measured 2026-09-14** (at plan time), Claude Code 2.1.270, headless `-p --input-format stream-json --output-format stream-json --model haiku`, a `control_request` of subtype `get_usage` with `skip_behaviors: true` on stdin, four credential shapes: an env OAuth token alone; the same after one real Haiku turn; the lane's config dir alone (the turn failed "Not logged in" under the sandbox, so that arm measures nothing); the lane's config dir plus the env token after one real Haiku turn. Every `control_response` was `subtype: success` with `subscription_type: null`, `rate_limits_available: false`, `rate_limits: null`. The channel answers a headless client but carries no buckets on this fleet; the Fable share is the sweep's estimate (design §5.4). |
| Served model catalogue vs the compiled seed | **fetched 2026-09-14**: `downloads.claude.ai/model-catalog/v1/catalog.json`, version 346, issued 2026-09-14T05:56Z, expires 2026-09-21. Five surfaces (`cc`, `ccd`, `ccr`, `chat`, `cowork`), each a `model_selector_config[].models[]` list. Per model: `runtime.effort_levels` (`low medium high xhigh max` for Fable 5.1, Opus 5, Sonnet 5; `low medium high max` for Opus 4.6 and Sonnet 4.6), `runtime.default_effort` (`high` for the three routed classes; `xhigh` for Opus 4.7), `thinking.type` (`none` for Haiku 4.5, which lists no `effort_levels` at all), and a `settings_vocabulary.effort_level` rank {low 1, medium 2, high 3, xhigh 4, max 5}. It carries **no `effort_cost_index` and no `per_turn_effort`**: those are compiled-seed rows only (six rows in the 2.1.270 binary), so a served-catalogue refresh cannot change them, and the design's class-aware escalation rests on the seed. |
| Sidecar coverage on the live fleet | **measured 2026-09-14**, 43 minutes to 1 hour after the statusline hook shipped (agent lane 16:36 UTC; measurements 17:19 and 17:34 UTC). 20 sidecar files under `~/.cc-sessions/usage/` against 33 active session units. The 13 units with no sidecar all had a tmux session idle between 78 and 1374 minutes — i.e. not one of them has rendered since the hook shipped — so coverage is 20 of 20 sessions that rendered, with no counterexample; a sidecar is written on render, not on schedule. Freshness: 18 of 20 carried a `ts` inside 30 minutes at the first reading, 15 of 20 at the second, the laggards being idle panes. **Zero `<id>.agents/` directories exist**: subagent renders do not write an agent sidecar on this fleet, so per-agent attribution comes from the sweep's transcript-side subagent count (220647 of 276318 records in the window), not from the sidecar. Server side the same 20 arrive: `~/.ccrc/state-cache.json` holds 49 known sessions, 20 with `usage` non-null, and all 20 of those carry a non-null model, class and effort — so the render still completes now that its tmux call is bounded by `timeout`/`gtimeout`. |
| Usage sweep first passes | **measured 2026-09-14**, three passes recorded in `~/.ccrc/usage-sweep.json`, all `ok`: 16:42:04-16:54:50 (cold, 12m46s wall, 3m15s CPU, 1.9G peak) 275920 records; 17:00:19-17:07:26 (7m07s, 3m39s CPU) 276318; 17:20:15-17:28:03 (7m48s, 3m45s CPU, **2.2G peak**) 277046. Scan of the middle pass: 2667139 assistant lines de-duplicated to 276318 records by removing 1731666 duplicate message ids, **0 parse errors**, 32563 of 69660 transcript files inside the 7-day window — 48.3 GB (45.0 GiB), larger than the box's page cache, so every pass re-reads most of it. Per class (records / API-equivalent USD): opus 87924 / 10729, sonnet 86706 / 2975, fable 5214 / 2326, haiku 997 / 11.66, and 95477 records in `other` that the rate table does not price at all. Context dominates as §4 says: 14.74G cache-read tokens against 29.1M output tokens on the opus class alone. `fableShare.estimate` across 12 accounts ranges 0.000 to 0.263, every one of them listing `other` in `unpricedClasses`. **Join rate to ccd sessions is the weak spot**: of 1209 `perSession` rows only 39 carry a `ccdId` (3.2% of rows) — but those 39 hold 243108 of 276318 records (88.0%), the 1170 unjoined rows holding 12.0%. The join reads `$REG/<id>.uuid`, i.e. a session's CURRENT uuid only, so every uuid a `/clear` or a compaction rotated inside the window is an orphan row; the records are counted, the session they belong to is not named. Unit re-budgeted from these passes (ruling R13): `TimeoutStartSec=1800`, `MemoryMax=3G`, `OnUnitActiveSec=4h`, confirmed loaded by the user manager after the re-deploy; the first pass under the new budget (17:41:19-17:48:46, 278076 records) peaked at **2.4G** — over the cap it would have run under an hour earlier. The peak has risen 1.9G -> 2.2G -> 2.4G across four passes as the window filled, so 3G is ~0.6G of headroom and the next fix is an incremental scanner, not another gigabyte. |
| `/effort <level>` typed as a keystroke — does it persist? (`D-2808`) | **measured 2026-09-14**, Claude Code 2.1.270, private tmux server `tmux -L routeprobe`, scratch `CLAUDE_CONFIG_DIR` seeded `{"effortLevel":"xhigh"}`, launched `--model opus --dangerously-skip-permissions`. Keystrokes `send-keys -l '/effort high'` then `send-keys Enter`. **It persists, and it writes the PER-MODEL key**: the acknowledgement reads `Set effort level to high (saved as your default for new sessions): Comprehensive implementation with extensive testing and documentation` and `settings.json` gains `"modelSettings":{"claude-opus-5":{"effortLevel":"high"}}` — the top-level `"effortLevel":"xhigh"` is left untouched, and the per-model entry WINS over it for that model. `/effort auto` answers `Effort level set to auto` and **deletes** the saved level, leaving `"modelSettings":{"claude-opus-5":{}}` — the empty per-model object survives, and the session then runs with no effort word in its header in spite of the top-level `xhigh`. No picker appears when the level is given as an argument. |
| `/model <alias>` typed as a keystroke — does it persist? (`D-2811`; slice 4's lever) | **measured 2026-09-14**, same session. `/model sonnet` answers `Set model to Sonnet 5 and saved as your default for new sessions` and writes top-level `"model":"sonnet"` into `settings.json`. `/model default` answers `Set model to Sonnet 5 (default) and saved as your default for new sessions` and **deletes** the `"model"` key. A session-only effort set beforehand survives the model change (header `Sonnet 5 with medium effort`). |
| The session-only form, driven by keystroke, for `/effort` and `/model` (`D-2808`) | **measured 2026-09-14**. `/effort` with NO argument opens a slider: `low medium high xhigh max ┆ ultracode`, `ultracode` captioned `xhigh + workflows`, footer verbatim `←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel`. `/model` with no argument opens a list (`1. Default (recommended) ✔`, `2. Sonnet`, `3. Opus`, `4. Haiku`) with footer `Enter to set as default · s to use this session only · Esc to cancel` and an effort control inside it reading `◐ Medium effort ←/→ to adjust`. **The session-only key is `s` in both.** Drive measured: for effort, `Left`×7 pins the marker at `low`, then `Right`×N to the target (low 0 … ultracode 5), then `s` → `Set effort level to medium (this session only): …` with `settings.json` byte-identical before and after; for model, `Down`×2 then `s` → `Set model to Opus 5 for this session only`, again with no settings write. **Two traps for a driver**: ←/→ inside the MODEL picker adjusts EFFORT, not the model; and when the conversation already has turns, Opus 5 interposes a second dialog — `Change effort level? … This conversation is cached for the current effort level. Switching to medium means the full history gets re-read on your next message.` with `❯ 1. Yes, switch to medium` / `2. No, go back` — that must be confirmed with `Enter`. The same two-turn history on Fable 5.1 showed NO such dialog, so a keystroke driver has to tolerate both shapes. |
| `--settings` as a launch lever: is `ultracode` a key, is `enableWorkflows`, is an unknown key fatal? (`D-2809`) | **measured 2026-09-14**, five launches, JSON passed inline on the argv. `--settings '{"enableWorkflows":true,"ultracode":true}'` **puts the session in ultracode at launch with no keystroke**: the divider above the prompt renders the word `ultracode` and a bare `/effort` shows the slider marker on `ultracode`. `--settings '{"ultracode":true}'` alone does the same on a config dir whose `/config` already reads `Dynamic workflows  true` (the default on this build), so the two-key form is the one that does not lean on that default. `--settings '{"enableWorkflows":true}'` starts clean with no banner and no status-line change; its only readback is NEGATIVE — `/config` searched for `workflow` lists three rows without the flag (`Dynamic workflows  true`, `Ultracode keyword trigger  true`, `Dynamic workflow size  medium (default)`) and ONE row with it, the two toggles withdrawn because a flag now forces them. `--settings '{"nosuchkey":true}'` **starts normally**: an unrecognised key is not fatal and prints no warning. `--settings` never writes the settings file — `diff` clean before/after on every arm. |
| `--effort <level>` as an argv lever (`D-2808`) | **measured 2026-09-14**, Claude Code 2.1.270. `claude --help` carries `--effort <level>  Effort level for the current session (low, medium, high, xhigh, max)`. Measured against a config dir pinning `modelSettings.claude-opus-5.effortLevel = high` under a top-level `xhigh`: `--effort medium` starts the session at `Opus 5 with medium effort` — it **overrides both pins** — and `settings.json` is byte-identical afterwards, so the flag is session-scoped by construction. `--effort ultracode` is **honoured even though the help text does not list it**: the session comes up with the `ultracode` divider word and header `Opus 5 with xhigh effort` (ultracode = xhigh + workflows). `--effort bogus` is **silently ignored, not fatal**: the session starts at the config-dir value with no warning. |
| A pinned lane: does a keystroke take, and does it survive a relaunch? (`D-2810`) | **measured 2026-09-14** on the synthetic control — scratch config dir `{"effortLevel":"xhigh","modelSettings":{"claude-opus-5":{"effortLevel":"high"}}}`. The session starts at `Opus 5 with high effort`, i.e. the per-model pin beats the top-level value. The session-only keystroke (`/effort`, `Left`×7, `Right`×3, `s`) **takes**: `Set effort level to xhigh (this session only): Deeper reasoning than high, just below maximum (Fable 5, Opus 4.7+, Sonnet 5)`, header `Opus 5 with xhigh effort`, settings file unchanged. After one turn and a relaunch with `--resume <uuid>` on the same config dir, the header reads **`Opus 5 with high effort`** — **the session-only level does NOT survive the resume; the pin returns.** Consequence for this fleet: every rescue swap that relaunches with `--resume` silently discards a session-only effort. The really-pinned lanes were read READ-ONLY and never launched against (controller resolution): **four** config dirs carry `modelSettings.<id>.effortLevel` today, not the two this spec assumed — three pin `{"claude-fable-5-1":{"effortLevel":"high"}}` and one pins `{"claude-opus-5":{"effortLevel":"high"}}`, all four also carrying top-level `"effortLevel":"xhigh"` and `"model":"opus"` (`D-2810`). **Is ccd itself the writer of those pins? Measured, and no** (`D-2810`). The question has to be asked because two facts in this same table meet: a plain `/effort <level>` PERSISTS and writes exactly `modelSettings.<model-id>.effortLevel` (row above), and `_inject_spawn_effort` (`ccd/ccd:15169-15190`, the type itself at `ccd/ccd:15183`) types the plain form — `tmux send-keys -t "$t" -l "/effort $SPAWN_EFFORT"` with `SPAWN_EFFORT="ultracode"` (`ccd/ccd:989`) — into EVERY freshly spawned session, against the LANE's config dir, on the live fleet right now. So the four pins could have been written by the settle rather than by the operator. **Measured 2026-09-14**, Claude Code 2.1.270, private tmux server, scratch `CLAUDE_CONFIG_DIR` seeded `{"effortLevel":"xhigh"}`, launched `--model opus`, keystrokes typed exactly as ccd types them (`send-keys -l '/effort ultracode'`, `send-keys Enter`): the acknowledgement is `Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration` — **`(this session only)`, NOT `(saved as your default for new sessions)`** — and `settings.json` is byte-identical before and after (`diff` clean). The control is on the SAME dir in the SAME session, so it cannot be a read-only dir or a stuck write: `/effort high` typed immediately afterwards answers `(saved as your default for new sessions)` and writes `"modelSettings":{"claude-opus-5":{"effortLevel":"high"}}` — the census's exact key AND its exact value. Only the VALUE `ultracode` is non-persisting, which confirms by measurement what ccd's own comment at `SPAWN_EFFORT` asserts ("ultracode is session-only by design (no settings.json key)"). A third type, `/effort ultracode` over the `high` pin just written, left the file byte-identical again: the settle neither writes a pin nor erases one. **Consequences:** the four pinned dirs are operator state, not settle residue; the spec's "remove the pins" consequent would NOT be futile if it were ever triggered; and §5.2's persistence hazard is NOT active on the fleet today — it becomes active the moment any lever types a level other than `ultracode` in the plain form, which is exactly the form Task 8 must not use for `low`…`max`. |
| Cache safety of a mid-session effort change (`D-2808`) | **measured 2026-09-14**, one-word turns (`Reply ok`), `cache_creation_input_tokens` / `cache_read_input_tokens` read from the transcript's `assistant` lines. **Opus 5**: turn A 7878 / 29761, turn B (control) **35** / 37639, then `/effort` → medium session-only, turn C **8109** / 29761 — creation tokens up 232× and the read count back to turn A's, i.e. **the prefix was re-written**, exactly as Claude Code's own `Change effort level?` dialog warns. **Fable 5.1**, same procedure: turn A 8773 / 29761, turn B 5026 / 33543, turn C **193** / 38572 — creation tokens FELL and reads rose, i.e. **the prefix survived**, and no warning dialog was shown. So a live effort change is cache-safe on Fable 5.1 and cache-hostile on Opus 5 on this build; on a worker carrying a real prefix the Opus re-write is the whole context, not a few thousand tokens. |
| Slice 1 gate on the live fleet (`D-2808`, `D-2809`, `D-2816`) | **measured 2026-09-14**, Claude Code 2.1.270, both lanes deployed at one sha (agent lane built 23:41:21Z, server 23:47:19Z; `/health` reports the shipped sha). `ccd caps` prints the verb `route` and the token `route-v1`. **The doctor's routing check FAILS, and it is a true positive**: of the **10** Anthropic lanes the roster projects, **3** carry `CLAUDE_CODE_SUBAGENT_MODEL` in their `settings.json` and would override the record's spawn env; **0** carry `CLAUDE_CODE_EFFORT_LEVEL`, so §5.2's "never the effort override env" holds fleet-wide. Those 3 are the fleet's own earlier mechanism (the 2026-09-07 subagent-routing ruling put that key in `settings.json` so subagents would stop inheriting the orchestrator's model) and slice 1 makes the record the writer of the same floor — a collision whose remedy is 3 operator edits, not a code change. Before the deploy the projection carried `CCRC_ANTHROPIC_BACKEND` and no `CCRC_SUBAGENT_CLASSES`, i.e. the check's WARN arm rather than a vacuous PASS (`D-2816`); after it, both arrays declare and the check reaches a real measurement. **A record carrying every field, written through the shipped verb** at 23:48:21Z on the controller's OWN session (`class=default subagent=sonnet workflow=on effort=ultracode`, actor and reason given): 4 `set` lines, 4 `swap.log` lines each naming the previous value as ∅, and 4 `route` lifecycle rows (`outcome: done`, the actor and reason on `dec`, the field transition on `detail`) — and `inert`, `degraded` and `compact` stay absent, which is right for an Anthropic lane at `workflow=on`. **The spawn line is PENDING A NATURAL SWAP, and the brief's way of reading it does not work.** The record applies at the next resume or swap, which is not forced: polled every 2 minutes for 20 minutes (23:49:39Z to 00:09:40Z) and the session's process was unchanged throughout, so nothing was restarted. Two facts the next reader needs. First, the unit journal carries NO argv — ccd logs `ensured <id> (resume)` and the settle's own skip line, nothing more — so the argv must be read from the live process (`/proc/<pid>/cmdline`), not from `journalctl … | grep new-session`. Second, the CONTROL is measured: at 23:48:49Z, after the record was written, the running process still carried the pre-record argv (`--remote-control <id> --resume <uuid> --dangerously-skip-permissions` — no `--model`, no `--effort`, no `--settings`) and NEITHER routing env var, which is what "applied at the next spawn, not retroactively" looks like from outside. What the next spawn must carry, from the composer at `ccd/ccd:15075-15146`: no `--model` (class `default` passes no flag), `--settings '{"enableWorkflows":true,"ultracode":true}'` BEFORE `--effort ultracode` (that order is D-2818's, pinned contiguous by `ccd-route-spawn.test.ts`), and `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` on the `env` line. One caveat this gate already measured: this session's own lane is one of the 3 whose `settings.json` names that same variable, and that key reaches the tool environment Claude Code spawns even while the session process's own env is clean — so on this lane the spawn env and the lane's settings.json will both be claiming the subagent floor until the operator resolves it. |

### 6.1 The levers ruled (routing slice 1, Task 7 — Claude Code 2.1.270, measured 2026-09-14)

Every ruling below rests on the rows above; each names the branch taken from the slice-1 plan's own
branch table. D-numbers D-2808..D-2811 were minted and defined by the controller on 2026-09-14 (one per decision;
the measurement rows above cite the decision they feed).

1. **The effort lever — `D-2808`. Branch taken: Lever A, with the argv flag
   as the settle's form.** The branch table's Lever-A antecedent is satisfied in both halves: a plain
   `/effort <level>` DOES persist (it writes `modelSettings.<model-id>.effortLevel`), and the
   session-only form IS drivable by keystroke (`/effort`, `Left`×7, `Right`×N, `s`). So a live change
   inside a running session is Lever A — plus one tolerance the branch table did not know about: on
   Opus 5 with existing turns a second dialog (`Change effort level?` / `❯ 1. Yes, switch to <level>`)
   must be confirmed with `Enter`, and on Fable 5.1 it does not appear, so the driver must handle both.
   For the SPAWN path the measurement points elsewhere: `--effort <level>` exists on the argv, is
   session-scoped, writes nothing, overrides both the top-level and the per-model pin, and covers
   `ultracode` — while a session-only keystroke does NOT survive a `--resume`, which is exactly what
   every rescue swap does. An argv flag is re-applied on each relaunch; a keystroke is not. The
   branch table has no row for "the argv carries the level", so this half is a departure from it and
   is flagged for the controller rather than assumed.
2. **The `--settings` keys — `D-2809`. Branch taken: "arm 3 honours `enableWorkflows`
   and `ultracode`".** Task 8 may compose `--settings '{"enableWorkflows":true,"ultracode":true}'` for
   `effort: ultracode` and `--settings '{"enableWorkflows":true}'` for `workflow: on` at another effort.
   The hazard the plan guarded against — an unrecognised key killing every routed spawn — is measured
   ABSENT: `--settings '{"nosuchkey":true}'` starts normally. `workflow` therefore has a lever in this
   slice and no lane needs `inert=workflow` on this ground. Note the readback asymmetry: `ultracode`
   reads back on the status-line divider and the `/effort` slider, `enableWorkflows` only negatively,
   by its `/config` toggle disappearing.
3. **The pinned lanes — `D-2810`. No operator-approved edit is proposed.** The
   spec's consequent ("removes the pins if not") is NOT triggered: the keystroke DOES take on a pinned
   config dir, and the argv `--effort` flag overrides the pin outright. The pins only reassert
   themselves across a `--resume`, which the argv lever survives by construction. The real lanes were
   never launched against; the census is a read of their `settings.json` and says **four** dirs pin a
   per-model effort, not the two the spec names.
   **The prior question this ruling had to answer first — who WRITES those pins — and its measurement
   (`D-2810`).** A plain `/effort <level>` persists into
   `modelSettings.<model-id>.effortLevel`, the census's exact key; and `_inject_spawn_effort`
   (`ccd/ccd:15169-15190`, the type itself at `ccd/ccd:15183`, `SPAWN_EFFORT="ultracode"` at `ccd/ccd:989`) types that same plain form into
   every freshly spawned session, against the LANE's config dir, on the live fleet. Had that type
   persisted, this ruling would be wrong twice over: "remove the pins" would be futile against a writer
   that regrows them at the next spawn, and §5.2's persistence hazard — the reason this task exists —
   would be ACTIVE on the fleet today rather than a hazard Task 8 must avoid. Measured (row above):
   `/effort ultracode`, the value ccd actually types, answers `(this session only)` and leaves
   `settings.json` byte-identical, while `/effort high` on the SAME dir in the SAME session answers
   `(saved as your default for new sessions)` and writes `{"claude-opus-5":{"effortLevel":"high"}}` —
   the census's key and its value. **ccd is therefore not the writer**: the four pins are operator
   state, no settle regrows them, and the STOP CLASS is not entered on this ground either. What the
   measurement does bind is Task 8: it may keep typing `ultracode` plain, because that value writes
   nothing, but every other level must reach a session by the session-only picker keys or by the argv
   `--effort` flag — a plain `/effort low`…`/effort max` would write the LANE's `settings.json` and
   create exactly the operator-pin problem this ruling just measured away.
4. **The `/model` lever, recorded for slice 4 — `D-2811`.** The persisting form is
   `/model <alias>` (writes top-level `"model"`), `/model default` deletes that key; the session-only
   form is the bare `/model` picker driven `Down`×N then `s`, which writes nothing. Inside that picker
   ←/→ adjusts EFFORT, so a model driver must use Up/Down only. `--model` on the argv remains the
   session-scoped form ccd already uses.

## 7. The optimal setup, as the evidence ranks it

1. **Instrument before tuning.** Per-turn model + effort + usage + agent name is
   already in the transcripts and in OTEL; ccrc reads none of it. Without it every
   change below is unmeasurable.
2. **Context per turn is the largest slice.** Compaction thresholds, `/clear` at
   wave boundaries, bulky reads absorbed by subagents that return one line, smaller
   injected context. Average 155k tokens per Opus turn today.
3. **Subagent model is the largest single bucket** (Opus subagents ≈44%). Pin
   `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` on Anthropic lanes, `Explore` on Haiku,
   judgment reviewers explicitly on Opus. Ceiling ≈ a quarter of spend if all moved;
   real saving smaller.
4. **Effort by escalation, not by stage.** Spawn at `high`; raise to `xhigh` for the
   hard tail (debugging survivors, architecture, whole-branch review) and on a
   failed check, never as the default for a fresh worker. Fable at `high` (already
   pinned in `.claude`).
5. **Fable is a cap, not a bill.** Route it as an escalation and keep each account's
   Fable share visible against its 50% weekly limit; past the cap it becomes credits.
6. **Only then** revisit the model of the main loop per role.

## 8. Open questions the design must answer

- Objective: weekly window consumption per merged wave (throughput), Fable share
  (money), or wall-clock?
- Quality signal for "no loss": review rounds per wave, first-pass wave-done,
  suite green on first run, deviation count?
- Unit of control: per lane (settings env), per spawn (ccd flags), per role
  (coordinator/worker/verifier), per wave (brief field), per subagent (frontmatter)?
- Who decides: ccrc mechanically, the skills by convention, or the model itself
  given the policy as context?
