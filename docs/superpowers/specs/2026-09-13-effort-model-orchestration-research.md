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
