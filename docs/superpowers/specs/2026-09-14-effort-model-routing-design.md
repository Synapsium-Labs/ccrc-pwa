# Effort, model and orchestration routing — design

Status: APPROVED 2026-09-14 (v3 plus the two plan-time probes in §3, §5.4, §6, §7 and §9). v1 was written from a six-section brainstorm approved section by
section on 2026-09-13/14; v2 folded in a four-lens adversarial review (66 findings); v3 folds in a
second two-lens pass on v2 (35 findings). Research base:
`2026-09-13-effort-model-orchestration-research.md` (same directory). Deviation numbers are minted
at plan time through the allocator; this spec defines none.

## 1. Purpose

ccrc today decides nothing about which model class, effort level, subagent class or workflow mode
a supervised session runs. Every Anthropic session is typed `/effort ultracode` at spawn and again
at every resume and swap (`ccd/ccd`: `SPAWN_EFFORT`, `_inject_spawn_effort`, fired from
`_spawn_settle`), the lane's `settings.json` picks the model, subagents inherit the session model
on Anthropic lanes, and a swap erases whatever the session had chosen. The 30-day measurement
behind this design found output tokens at 7% of API-equivalent spend, context re-read at 64%,
context growth at 29%, and Opus subagents alone at 44%.

This design gives ccrc one general strategy (§3), a decider that applies it (§4), the mechanics
that carry each session's settings through spawns, swaps and limits (§5), a measurement loop that
validates the strategy on this fleet's own work (§6), and the pins that keep each guard honest
(§8).

## 2. Objective, quality gate, boundary

**Objective.** One general strategy, fixed independently of any account's limits or model
availability: the model class, effort, subagent class and workflow mode that give the best
quality per unit of time and tokens for each shape of work. Accounts, windows and caps are
capacity the mechanics route around to keep a session on its assigned settings. The subscription
is the hard edge: no fast mode, no usage credits, ever. This is not a global schedule across
projects; task arrival is unknown. It is a rule-set applied per workspace and per coordinator
workspace.

**Weighing.** Quality is a gate, not a term. Below the gate, speed to a finished piece of work
and token spend on it count roughly equally. Minor quality compromises are acceptable for large
gains in either when the loss is negligible in practice.

**Spend is counted twice, because the constraint is.** The throughput term is weekly-window
consumption per completed unit (wave, review, spec); four of nine measured lanes sat at 100% of
their weekly window during the survey, so this is the binding constraint. The money term is each
account's Fable share against its 50% weekly allowance, the only spend on this fleet that can
become usage credits. Window weights per class are unpublished. Until measurement replaces them,
the proxy is the API rate card weighted by this fleet's measured component mix (64% cache read,
29% cache write, 7% output by cost): per token, Fable 5.1 is about 1.0× Opus 5 (its cache read is
half Opus's price, its writes and output twice), Sonnet 5 about 0.4×, Haiku 4.5 about 0.2×. Per
message on this fleet, Fable (5 and 5.1 blended, the only split the scan supports) came out at
roughly 2 to 2.4× Opus 5, derived from the 30-day scan's per-model totals divided by message
counts, the range reflecting the Fable cache-rate uncertainty the research note carries. Both
figures are labelled proxies wherever they appear.

**Speed** is wall-clock from the run event that dispatched the brief to the wave-done the
coordinator accepted, minus excluded time (limit waits, swaps, operator absence) taken from the
swap and hold events, so a swap-heavy wave is not scored as slow work.

**Quality gate.** What "negligible loss" is measured by. None of these is "review rounds per
wave" or "fix rounds" when the reviewers are the subagents being changed; those signals move the
wrong way when a reviewer weakens, and a fix round exists because a lens raised a finding.

- Findings from a held-out review panel that always runs on Opus: three lenses with distinct
  perspectives (correctness, spec conformance, does-it-reproduce), each finding refuted by a
  fresh-context Sonnet pass, majority deciding. The panel is unroutable (§4): it is a Workflow
  whose `agent()` calls carry literal `model: 'opus'`, `effort: 'high'`, invoked by a coordinator
  clause, exempt from the routing fields and from escalation and demotion. A lens that dies or
  returns nothing counts as unverified, never as approval.
- Suite green on the first run of a task.
- Wave-done accepted on first submission.
- Defects surviving to the whole-branch pass; operator reverts after merge.
- For the compaction rule only: post-compaction re-read count.

**Caveat carried until measured.** A failed check in ccrc produces a fix round, not a discarded
re-run. Anthropic's "run cheap, re-run failures" economy (93% pass at $0.70 per task against 91.7%
at $1.39) is a re-run economy. Any cheaper-first assignment here is provisional until the sweep
shows the marginal fix-round cost is below the saving.

**Boundary.** ccrc decides class, effort, subagent class and workflow mode for a session at the
points where a change is cheap (spawn, dispatch, a settle, an idle tick, each subagent call),
holds them across swaps, and reports what it decided. It never trades the quality gate for the
other two terms. It does not infer the shape of the work: the coordinator declares a wave's shape
and routing in the brief; an operator-started session gets the coordinator row (§4).

## 3. The strategy

Keyed on the shape of the work, because that is what the evidence keys on; the lifecycle-stage
tables circulating online have no primary source. Effort names do not correspond across classes,
so every cell names both. Cells whose assignment rests on an operator ruling or a design choice
rather than a measurement say so in the Why column; they are not weaker rules, they are rules with
a different warrant. "Measured by Anthropic" means Anthropic's benchmarks, not this fleet;
"measured here" means the 30-day scan or a probe on this fleet.

**Effort and workflow mode are independent settings.** In Claude Code 2.1.270 dynamic workflows
are their own setting (`enableWorkflows` / `disableWorkflows`, toggled from `/config`).
`ultracode` is a shorthand that sets both `xhigh` and standing workflow orchestration for the
session, and is refused unless dynamic workflows are enabled ("Ultracode needs dynamic workflows
enabled"). Workflow mode at another effort is workflows enabled plus that effort, under the
Workflow tool's standard opt-in rule. **Haiku 4.5 accepts no effort level** (the served catalogue, version 346
fetched 2026-09-14, gives it `thinking.type: none` and no `runtime.effort_levels`, and the client
hard-codes it as unsupported); a Haiku cell names no effort. The same catalogue lists `low medium
high xhigh max` with a `high` default for Fable 5.1, Opus 5 and Sonnet 5, which is the effort
vocabulary §5.1 validates against.

| Work shape | Main loop | Subagents | Workflow mode | Why |
|---|---|---|---|---|
| Coordinator: opens the program, dispatches waves, re-measures wave-done, reviews handoffs, rules on deviations; every operator-started session | Fable · ultracode while orchestrating; drops itself to Fable · high with workflows off while idle on mail | Opus · high review lenses (3–5, scaled to the diff); Sonnet · high refute pass per finding; Haiku scouts | On while orchestrating | Operator ruling 2026-09-14: operator-started sessions get the best model at the start and decide routing for everything below them. This runs above Anthropic's Fable 5.1 default of `high` (higher effort over-deliberates on routine work), which is why the idle drop is part of the row. |
| Brainstorm, spec, architecture with cross-cutting blast radius; multi-day plan | Fable · high; ultracode at the decision itself | Opus · high refuters and design lenses; Sonnet fact checks | On as a judge panel only when the solution space is wide | Fable's launch guidance names design and long horizons; not independently measured. A panel pays only when there is a real space of designs (design choice). |
| Worker executing a spec'd plan: a dependent chain that fits one context | Opus · high | Sonnet · high implementers; Opus · high per-task reviewer; Haiku scouts | Off | Measured by Anthropic, not on this fleet: a single model on a dependent chain that fits one context beat orchestration in every case, at lower effort; Opus 5 matched Fable 5 on coding at 60% of its cost. Measured here: this fleet's Opus turns average 155k of context, so a wave that outgrows one context falls under the bulk row; the coordinator names the row in the brief. |
| Bulk independent work: mechanical sweeps, transforms, many files with checkable output; a wave larger than one context | Opus · ultracode orchestrating | Sonnet · medium or high workers; Haiku for transcription-grade | On | Measured by Anthropic, not on this fleet: orchestrator with cheaper workers cost 55% less at 3–7 points below the frontier model solo, only when bulk exceeds one context. The 3–7 points is the largest measured quality cost in this matrix; the held-out panel runs on this row's output from the first wave. |
| Whole-branch review pass, large program | Fable · ultracode | Opus · high lenses | On | One second-hand data point (a 2026-07-22 Anthropic webinar): Fable orchestrating Sonnet workers reached 96% of Fable-solo's score at 46% of cost on bulk reading, and on an easier subset the same mix added 60% cost for no gain. This row is a design choice betting that a whole-branch pass is the hard subset. |
| Debugging | Opus · xhigh | Sonnet · high refuters | Off | Operator's standing rule: Fable · high after two failed Opus attempts. `max` is reachable only by the mechanical rule below. |
| Tests from a spec; refute a concrete claim; mutation checks | Sonnet · high | none, or Haiku | Off | Anthropic's guidance: Sonnet 5 respects effort strictly and under-thinks at low; high is its floor here. |
| Scout, grep, status probe, file listing | Haiku (no effort level) | none | Off | Zero judgment; the caller checks the answer. |
| Docs, comments, ledger prose | Sonnet · medium | none | Off | Not implementation, so it may sit below Sonnet · high (design choice). |

**Floors and ceilings.** Implementation work never runs below Sonnet · high, with one carve-out:
bulk mechanical work whose output the orchestrator checks file by file (the bulk row) may run its
workers at `medium`, because the checker carries the gate there. `max` is never a default: it is
reachable only from `xhigh`, after a second failed check of the same kind on the same session.
Fable is never a fan-out worker and never inherits into workflow agents; every workflow agent
names its class and effort explicitly. The class ladder for a subagent ends at Opus (Haiku →
Sonnet → Opus); a capability ceiling above Opus inside a subagent escalates the main loop, never
the fan-out.

**Where subagent class and effort can be set.** Subagent class has three surfaces: the
per-session class floor (§5.1, `subagent`), agent frontmatter `model:`, and the per-call `model`
on an Agent or Workflow call, all measured on this fleet. Subagent effort has two: the Workflow
tool's `effort:` option on an `agent()` call, and agent frontmatter `effort:` (no agent
definitions exist on this fleet today). An Agent-tool subagent runs at the session's effort. So
every Subagents cell whose effort differs from its row's main loop is reached through a Workflow
call, or accepts the session's effort; the held-out panel is a Workflow for that reason. The
coordinator's brief states the subagent effort it expects and the worker skill's clause applies
it on the surface that carries it.

**Escalation.** On a failed check the coordinator chooses the rung by failure kind. Shallow or
incomplete work (tests missed, a plan half-followed) raises effort one rung within the class
over the full ladder `low → medium → high → xhigh → max`, floored as above. A capability ceiling
(ambiguity the session could not resolve, cross-session review, a design flaw, a debug that
survived two attempts on the same class) raises class one rung (Haiku → Sonnet → Opus → Fable for
a main loop; ends at Opus for a subagent). A class rung resets effort to the new class's matrix
row, never carries the old level across, because effort names do not transfer; where the matrix
has no cell for the pair, the target is the new class's Anthropic default (`high`). Effort-first
is the default when the kind is unclear, and it is class-aware: Claude Code 2.1.270's model
catalogue carries a per-model `effort_cost_index`, read from the installed binary's compiled seed
on 2026-09-14: Opus 5 {low 0.67, medium 0.76, high 1, xhigh 1.6, max 1.7}; Fable 5.1 {0.75, 0.86,
1, 1.38, 1.74}; the Sonnet 5 entry {0.47, 0.74, 1, 2.41, 5.59} (attributed by catalogue position).
So on Opus and Fable an effort rung is the cheaper increment; on Sonnet a class rung to Opus
(about 2.5× per token) costs about the same as `xhigh` and less than `max`, so a Sonnet subagent
that fails on capability goes to Opus rather than to Sonnet · max. These are catalogue rows, not
binary behaviour (§9). Cache: a class change starts a new cache namespace and re-writes the
session's prefix (measured). An effort change is believed cache-safe on Fable 5.1, whose
catalogue entry carries `per_turn_effort` (the review's reading; Opus 5's does not), and is
unmeasured on Opus 5; slice 1 measures both (§7).

**Demotion** is the coordinator's judgement, as the ruling says: it may drop a session's effort
one rung, or its class one rung, whenever it judges the work is being over-served, never below
the floors above. The evidence the matrix recommends it look for is three consecutive completed
waves of one shape on one session with suite green on first run, wave-done accepted on first
submission and zero held-out-panel findings; that is guidance, not a precondition the mechanism
enforces. Any failed check reverses the last demotion before the ladder is applied. Every
demotion and escalation is recorded (§5.3) with who, what, from, to and why, and the operator can
override live from the picker.

**Timing.** A change is written to the routing fields first and applied by ccd at the next
settle (spawn, resume, swap) or on the next supervise tick that finds the pane idle (§5.3). An
effort change costs nothing to apply. A class change re-writes the cached prefix whether it lands
by keystroke or by relaunch, which is why the coordinator is told the cost and why class changes
cluster at wave boundaries.

**Context hygiene, class-independent.** Shipped and applied everywhere: graph-first reading
(the graphify card, the PreToolUse search gate and Read nudge), bulky reads delegated to a Haiku
or Sonnet subagent under a bounded-answer contract, `/clear` at wave boundaries, ccd's compactor at
its current threshold. Gated on the graphify compaction card (spec
`2026-09-09-graphify-compaction-card-design.md` and Plan A, on `ws/graphify-compaction-card`,
unexecuted): a lower compaction threshold for workers through the `compact` routing field
(§5.1), checked by the post-compaction re-read count. This design consumes that plan and does
not duplicate it.

## 4. The decider

The coordinator decides. ccrc supplies the strategy as a reference file the coordinator skill
ships, `ccd/coordinator-skill/references/routing-matrix.md` (§3's table verbatim), the mechanics
that apply and carry a decision, the placement that routes around limits, and the measurement.
The coordinator, a Fable session, names per wave the worker's class, effort, subagent class and
workflow mode, revises them on the evidence the wave returns, and records why. Workers route
their own subagents by task shape under the worker skill's clause and report a failed check with
its failure kind so the coordinator can name the rung.

The reference file is a reference, not a clause, so a row change is an ordinary diff rather than
a red skill test; adding it also adds its name to `install-coordinator-skill.sh`'s `REQUIRED_REFS`
and to the two parity tests, and the worker skill points at
`../ccrc-coordinator/references/routing-matrix.md` (the worker ships no `references/` of its
own). An accepted proposal to change the matrix (§6) is a PR against that file.

Operator-started sessions are coordinators for features and programs. Every spawn writer seeds
the routing fields at creation (§5.3): the coordinator row for an un-flagged spawn, the
dispatched row when dispatch passes one. An ad-hoc session that is not a coordinator is routed by
the operator from the pickers.

The held-out panel has its own home: a second coordinator reference,
`ccd/coordinator-skill/references/review-panel.md` (the three lenses, the refute pass, the
literal model and effort), also in `REQUIRED_REFS` and the parity tests, named by coordinator
clause 14 as the review brief's shape and RUN by the review run's reviewer (the review-runs design
of 2026-09-14 holds clause 12 — the coordinator dispatches a review run and never reads the diff
itself; merged 2026-09-16, deviation recorded by the controller). Neither the routing fields nor escalation or demotion reach it.

## 5. Mechanics

### 5.1 The routing record

The routing record is seven ordinary registry fields per session, one file per field like every
other field in `~/.cc-sessions/`, written with `_reg_set` and read with `_reg_get`, so it inherits
the registry's atomic tmp-and-rename write, `_reg_purge`'s cleanup, and the uuid-to-id mapping.
Written only by ccd; read by ccd at every settle (spawn, resume, swap) and on the supervise tick
(§5.3). Fields and closed vocabularies:

| Field | Values | Meaning |
|---|---|---|
| `class` | `fable`, `opus`, `sonnet`, `haiku`, `default` | main-loop class; `default` means the lane's `settings.json` decides and serviceability (§5.4) skips it |
| `effort` | `auto`, `low`, `medium`, `high`, `xhigh`, `max`, `ultracode` | `auto` means the lane decides; `ultracode` means `xhigh` plus standing workflow orchestration; undefined for `class: haiku`, and a pairing is rejected |
| `subagent` | `haiku`, `sonnet` | the subagent class floor. `opus` and `fable` are excluded by design because they are unmeasured in the env on an Anthropic lane (Opus for judgment agents is per-call, measured 2026-09-13 on an Anthropic lane). ccd's shape check reuses the projected bash spelling of `shared/models.mjs`'s `SUBAGENT_CLASSES` rather than holding a third copy; the existing refusals in `modelEnvBlock` and `models-op.mjs set-subagent` are the gpt-lane path and are not on this record's path. |
| `workflow` | `on`, `off` | dynamic workflows enabled for the session; implied `on` by `effort: ultracode` |
| `compact` | a percentage, or absent | per-session compaction threshold read by `_auto_compact_check`; absent means `COMPACT_THRESHOLD` |
| `degraded` | a class, or absent | the class actually served when no lane could serve `class` (§5.4) |
| `inert` | field names, or absent | fields ccd could not apply on this lane (§5.2, non-Anthropic backends) |

The fields are registry files any session on the box can write (one UNIX user; attribution, not
authentication), and their values are a byte channel into an argv and a pane. ccd validates every
value by shape against these vocabularies at the read, in bash, with a stated failure direction,
on the pattern of `_spawn_start`'s reads of `rc` and `fromswap`, not the server's hold gate.
Three conditions, three answers:

| Condition | Answer |
|---|---|
| no routing field exists for the session | a session created before slice 1: today's behaviour (`SPAWN_EFFORT` typed, no `--model`, serviceability still applies) |
| a field is absent while others exist | that field's `default` / `auto` / `off` / `COMPACT_THRESHOLD` value, as if written |
| a field holds an unrecognised value | the field behaves as absent, and ccd writes a journal note naming the field and the rejected bytes' length, never the bytes |

Nothing unrecognised reaches an argv or a keystroke.

### 5.2 Levers

| Field | Lever | When | Notes |
|---|---|---|---|
| class | `--model <alias>` on both relaunch argvs `_spawn_start` builds (the primary spawn and the `--session-id` retry), computed once above them like `$rcflag` | launch, resume, swap | the lane's `settings.json` model is overridden per session; `default` passes no flag |
| class, live | `/model <alias>` typed by ccd | on the supervise tick when the pane is idle (§5.3) | **same persistence hazard as `/effort`, measured in slice 1:** 2.1.270 confirms a `/model` pick either "saved as your default for new sessions" or "for this session only"; the injector must drive the session-only form or the lane's saved model changes for every other session on it |
| effort | `/effort <level>` typed by ccd's injector generalised to read the fields | at settle, and on the supervise tick when idle | **persistence hazard, measured first in slice 1:** a plain `/effort <level>` may save itself as the lane default (`modelSettings.<model>.effortLevel`), and `/effort auto` may delete the lane's saved effort; only the slider's session-only confirmation avoids both. Two lanes already carry pins today (the default lane: Fable 5.1 → high; a second Anthropic lane: Opus 5 → high); slice 1 measures whether a keystroke survives a settle on a pinned lane and removes the pins if not. |
| effort, fallback | `--effort <level>` on the relaunch argv | launch | **mutually exclusive with the keystroke, measured on 2.1.270:** `--effort` sets a per-model launch pin under which the session-only `/effort` form answers "Not applied: the launch-effort pin holds effort" and only the persisting form applies. So this lever is taken only if the session-only keystroke cannot be driven, and then a live effort change is a relaunch. |
| effort: ultracode | `/effort ultracode` (session-only by construction) or `--settings '{"ultracode":true}'` on the relaunch argv | settle or launch | requires `workflow: on`; slice 1 confirms `--settings` is honoured for this key |
| workflow | `enableWorkflows` in the session's settings, set through the same `--settings` argument | launch | slice 1 confirms `--settings` is honoured for this key |
| subagent | `CLAUDE_CODE_SUBAGENT_MODEL=<class>` in the spawn process env, composed beside `_resume_env` | launch | measured on this fleet 2026-09-13: env floor honoured, per-call `model:` survives it, unset inherits the session. Anthropic lanes carry no settings key so the process env holds; a doctor check pins that (§8). The gpt lane keeps its materialiser, where settings win. |
| compact | `_auto_compact_check` reads the `compact` field, falling back to `COMPACT_THRESHOLD` | each idle check | absence-permits |

Never `CLAUDE_CODE_EFFORT_LEVEL`: it overrides everything and cannot be changed by `/effort`.

**Non-Anthropic lanes.** On a lane whose backend is not Anthropic, `class` applies (`--model
<alias>` maps onto the lane's tiers through its materialiser); `effort` levels other than
`ultracode` apply through the same `/effort` keystroke the picker sends there today; `effort:
ultracode` and `workflow` are inert (the spawn injector's backend gate exists for ultracode, and
the effort picker already hides ultracode on that lane), and ccd stamps `inert=ultracode,workflow`
rather than pretending; `subagent` applies through the lane's materialiser, where `settings.json`
wins.

### 5.3 Writers

- **Dispatch, wave 1.** The server passes the wave's routing on the existing `ws-add` argv behind
  a `route-v1` caps token. An old ccd binds an unknown flag as a positional: `--route` lands in the
  slug slot and the verb dies at `_ws_slug_valid` before the worktree, registry row or pane exist
  (the D-410 failure shape). So with the token absent the server omits the flag and journals that
  it did, exactly as `actor-flags-v1` governs the dec flags today (`capSupported`, false on no
  evidence): the wave dispatches on the lane default, today's behaviour, and the brief still names
  the routing in prose. The token passes `parseCcdCaps`'s `/^[a-z][a-z0-9-]*$/` filter, is printed
  by `cmd_caps` as a bare `echo route-v1` line beside `pools-v1` (so `caps-token-shape.test.ts`'s
  derived scan covers it), and is added to `ccd-archive.test.ts`'s hand-maintained
  `KNOWN_CAPABILITY_TOKENS`; the `route` verb is added to `cmd_caps`'s heredoc verb list so
  `verbSupported` sees it. The brief carries the same routing as a sentence for the worker
  (`WORKER_KICKOFF_PREFIX + brief`, under the composed 8 KiB cap).
- **Dispatch, wave N ≥ 2.** No `ws-add` runs; the workspace is resumed. The server writes the
  routing fields through the routing verb (no `--apply`) before the `/clear` and the brief, on the
  same caps token, so the fields and the brief name the same routing for the same wave and the
  worker's next settle applies it.
- **Operator spawn.** The new-session sheet gains optional class, effort and workflow fields,
  passed on the same `ws-add` (or `start`/`enable`) argv; unset means the coordinator row. Nothing
  writes a routing field for an id that does not exist yet: `_ws_slug_free` is an any-field check
  and a pre-written field would make the slug read taken. ccd writes the fields after the
  workspace is minted.
- **Live change from the PWA.** The pickers stop typing. A picker tap becomes a write: the server
  calls the routing verb with `--apply`, and ccd types if the idle predicate holds, otherwise on
  the next tick that it does. The picker shows "queued" until the pane read-back confirms. Picker
  values outside the vocabularies do not exist: `Auto` writes `effort: auto`, `Default` writes
  `class: default`.
- **Coordinator decisions.** The coordinator runs
  `ccd route --session <id> --set <field>=<value>` locally on the fleet box, for a worker or for
  itself, and never passes `--apply`: both skills carry the verbatim clause that a session "never
  types into another session's pane by any other means", and the record is the arbiter, so ccd
  applies the change on its own supervise tick or at the next settle without any session having
  caused a keystroke. `--apply` is reachable only from the server's picker path, where the actor
  is the server.
- **The verb.** `ccd route --session <id> --set <field>=<value> [--apply]` is enrolled in
  `agent/src/whitelist.ts`'s `REQUIRED_VERB_FLAG` as `'route': '--session'` and granted as the
  two-token prefix `['route','--session']`, for the reason `coord-pause` and `project-pool` are: a
  one-token grant would permit every positional form the verb might ever grow. It is built only
  through `CCD_ARGV.route`.
- **The supervise tick.** `_route_apply_check` runs beside `_auto_compact_check` under the same
  `PROBE_VERDICT == live` gate and the same idle predicate: pane readable and non-blank,
  auto-continue not armed, not mid-turn, the prompt marker present, the lane's session JSON idle,
  quiet for `COMPACT_QUIET`, input box empty. When the fields differ from what the pane last
  confirmed, it types the keystroke. Each refusal records a slug in its own registry field,
  `$REG/<id>.routeskip` (`<epoch> <reason>`) with a `routenote` log floor, the same shape as
  `_compact_note` / `_compact_note_clear` and never the same field, because
  `_compact_note_clear` unlinks `compactskip` on every below-threshold tick. The fields stay
  intended; the next tick re-attempts.

**Audit trail.** A routing write ccd performs is a lifecycle journal entry, `_lc_done route <id>
…`, carrying who, what, from, to and why in the fields `_lc_emit` admits. `route` is a new
lifecycle act: a union member and a `LIFECYCLE_ACT_MAP` key in `shared/api.ts`, an entry in ccd's
`_LC_ACTS`, and `lifecycle-vocabulary.test.ts` green on the set equality, in one commit, because
`_lc_emit` rewrites an unlisted act to `unknown` with the token in `badact` and that test is red in
between. The journal is swept by the server behind `lifecycle-v1` like every other ccd-side act,
so the trail exists for every session, run or no run. A routing write on a session inside an open
run is additionally a `recordRunEvent` row on that run (`run_events.runId` is NOT NULL and
`recordRunEvent` no-ops on an unknown run, which is why the journal is the primary trail).

**Typers.** Routing keystrokes (`/effort`, `/model`) have exactly one writer: ccd. The server's
`sendPrompt` types plenty else, the dispatch `/clear`, mail nudges and the operator's own prompts,
and ccd types `/compact` and the resume redrive; none of those is routing, and the pickers stop
typing, so no routing keystroke has two writers. The fields are the arbiter: ccd re-applies from
them at every settle and tick, so any keystroke not accompanied by a field write is transient by
design.

### 5.4 Swap continuity and routing around limits

The swap target predicate (`_swap_target`, mirrored by `_ws_least_loaded` and the server's
`projectHome`) gains a serviceability clause with three answers, never two:

- **servable**: the candidate lane's per-class window for `class` is measured and below the
  ceiling; proceed.
- **measured-unservable**: measured and at or above the ceiling on every candidate lane; ccd
  degrades one class rung for the relaunch, stamps `degraded=<class served>`, and journals it so
  the coordinator and operator see it. The intended class stays in the fields and is restored at
  the next settle on a lane that can serve it.
- **unmeasured**: no per-class figure for this lane; ccd does not degrade on a fabricated fact.
  `_swap_target` mints a fourth nobody-can-say code, rc 5, with its own `uword` for
  `_undecidable_cause`'s operator sentence, rather than reusing 2, 3 or 4, each of which names a
  different unmeasurable fact; the next tick tries again. `class: default` skips the clause.

**The Fable ceiling makes the credits edge a mechanism.** Fable-class placement refuses at a
share below the 50% allowance so a lane never reaches the point where the next Fable turn bills
credits. The number is set by slice 3 from the first week of measured Fable share; 40% is the
default until then.

**Where the per-class figure comes from.** The statusline payload carries only `five_hour`,
`seven_day` and `spend_limit` (measured against 2.1.270: its `rate_limits` object is built from
those three and emitted only when one is present). The per-class buckets (`seven_day_opus`,
`seven_day_sonnet`, `model_scoped[]` with a server-supplied label such as "Fable") belong to
Claude Code's `get_usage` structured-data control request, an experimental SDK surface. The
Remote-Control REPL bridge knows the subtype but answers "get_usage is not supported in this
context (onGetUsage callback not registered)", so the bridge is not the channel. Probed at plan
time (2026-09-14, research note §6): a headless stream-json client answers the request
(`subtype: success`) but returns `rate_limits_available: false` and `rate_limits: null` under
every credential shape tried, including the lane's own config dir with its token after a real
turn. No channel delivers the buckets on this fleet today, so slice 0 persists none. The Fable
share is estimated from the offline sweep's per-account Fable token totals joined to the weekly
window, labelled as an estimate, and Opus and Sonnet serviceability use the single `seven_day`
figure. The probe procedure lives in the research note and is re-run by hand when the fleet's
Claude Code version changes; a release that starts answering is a slice-3 change, not a redesign.

Placement for fresh spawns applies the same clause. The predicate is defined once in `shared/`
(L0, imports nothing) with a bash mirror in ccd and a parity test, the way `shared/poolrule.ts`
is, and composes with pool eligibility in that order: pool first, then serviceability.

Relaunch after a swap passes `--model` from the fields, the subagent env from the fields, and
re-applies effort and workflow mode from the fields, never from the global constant.

### 5.5 Skills and workflow agents

- Coordinator skill, two new clauses: (12) the brief names the wave's shape and the routing the
  matrix derives from it, including the subagent effort it expects, and the coordinator revises
  routing on the wave's evidence and records why; (13) the handoff review invokes the held-out
  panel as described in `references/review-panel.md`. Two new references, `routing-matrix.md` and
  `review-panel.md`, each in `REQUIRED_REFS` and the two parity tests.
- Worker skill, two new clauses: route subagents by task shape and name class and effort on
  every Agent or Workflow call; report a failed check with its failure kind.
- The worker's wave-done mail carries two signals as the first two lines of its body, after the
  envelope's `--` terminator, under a named grammar the server parses from `body`: `suite:
  green|red|unrun` and, when a check failed, `failure: shallow|ceiling|unclear`.
  `parseMailEnvelope`, `renderEnvelope` and `EnvelopeInput` are not modified; the envelope grammar
  is strictly positional and an older reader carries the lines verbatim inside `body`.
- Each new clause is a `CONTRACT` literal in the skill's test, a numbered item in SKILL.md, and
  the count word at every site the test derives: both of SKILL.md's own prose statements and every
  mention of the skill's path in README.md and CLAUDE.md. Count the sites from the test, not from
  memory.
- Workflow scripts pass `model:` and `effort:` on every `agent()` call; a Fable session's workflow
  agents run on Opus or Sonnet, never inherited Fable.

## 6. Measurement

Read-only; steers nothing; answers two questions: is each session running what its fields say,
and is the strategy holding the gate while moving speed and spend.

- **Per-session usage sidecar, keyed by the ccd id.** The Claude Code session uuid rotates on
  `/clear` and compaction (`_sync_uuid` exists for that reason), so it cannot key anything. The
  statusline hook derives the ccd id the way the session hook does (the tmux session name, `cc-`
  stripped) and writes `~/.cc-sessions/usage/<ccd-id>.json` by atomic tmp-and-rename, carrying
  `ts` (epoch seconds, the writer's clock, so the server can tell a live reading from a stale one
  the way `.cc-limits` rows carry it), the Claude session uuid, account, the payload's model id,
  effort level, context percentage and running cost. A render that carries an `agent` name writes
  `~/.cc-sessions/usage/<ccd-id>.agents/<agent-name>.json` instead, because subagent renders reuse
  the parent's session id and would otherwise overwrite the main-loop row. The `usage/` directory
  gets its own reaper beside `_reg_purge`, which cleans registry fields only, so a reused ccd id
  never inherits a dead session's reading. Slice 0 confirms the payload carries `model.id` (the
  shipped script reads `display_name`); the recorded id is classified by `shared/models.mjs`'s
  `familyClassOf`, the existing single definition, never by a new id-to-class list. The server
  reads the files through the agent's read whitelist (`.cc-sessions/` is a root), joins by ccd id,
  and ships them on the fleet wire additively.
- **Observers, one per routed field.** The sidecar observes `class` and `effort`. The pane
  read-back (`parseStatusline`'s `ultracode`, the divider word) observes `effort: ultracode` only;
  `workflowActive` observes a running Workflow, not the setting. **Workflow mode has no observer
  today** at any effort below ultracode; slice 1's `--settings` measurement decides whether
  `enableWorkflows` is readable back, and until it is, read-back disagreement is not computed for
  `workflow`. The offline transcript sweep observes `subagent` (per-line `model` and `effort` in
  transcripts).
- **Read-back disagreement** between fields and observers, twice above the noise floor, is a
  mechanism defect and is surfaced, never retried silently, after two benign causes are excluded:
  the model does not support the requested level (Claude Code silently rewrites `max` and `xhigh`
  down to `high`, and emits no effort block for a model with no effort support), and a settings or
  organisation `maxEffortLevel` clamp.
- **Per-class buckets**: none reachable today (§5.4, probed 2026-09-14); the sweep's per-account
  Fable share estimate stands in, labelled as an estimate wherever it is shown.
- **Offline accounting sweep** on the fleet box: the de-duplicating transcript scan (global dedupe
  by message id across config dirs; 85% of raw lines were duplicates) as a scheduled read-only job,
  owned like the graph sweep, emitting per session, model, effort and agent token totals. Joined to
  runs it yields tokens per merged wave, the post-compaction re-read count, and the per-account
  Fable share estimate.
- **Speed per closed unit** from run events: the dispatch event to the accepted wave-done, minus
  excluded time from swap and hold events.
- **Quality signals per closed run.** First-submission wave-done from run events; suite green on
  first run from the worker's `suite:` body line; the held-out panel's findings from the
  coordinator's review; operator reverts from PR history. **Cost signals, never quality:** fix
  rounds and review rounds from run events, counted on the spend side, because a fix round exists
  when a lens raised a finding and a weaker lens raises fewer.
- **Arms.** An arm is the routing recorded at dispatch, before any escalation or demotion. Waves
  that changed routing mid-flight are reported separately and never counted in an arm's mean. The
  confound is named: coordinator-chosen routing correlates with wave difficulty, and shape plus
  plan task count are the only difficulty proxies available; comparisons are within shape.
- **Continuous attribution, not an experiment.** Outcomes are attributed to the routing the
  coordinator chose. Ten completed waves of one shape is the minimum sample before the sweep may
  propose a matrix change; proposals are diffs against `routing-matrix.md` the operator accepts or
  rejects; nothing applies itself.
- **Judging is a panel, never one agent.** Any comparison between two routings (arm A against arm
  B for a shape, or a proposed change to a matrix row against the row it replaces) is judged by
  three independent Opus judges scoring the quality signals blind to which arm is which, each
  verdict refuted by a fresh-context Sonnet pass. A proposal reaches the operator only with the
  panel's scores and every dissent attached; a judge that dies counts as unverified, not as a vote.

## 7. Rollout

Anything touching `ccd/`, the session hook or the skills ships agent-first. Nothing steps down
before its checker exists, and the Fable default does not land before the mechanism that keeps a
Fable session placeable.

| Slice | Lands | Behaviour change | Gate |
|---|---|---|---|
| 0 | sidecar write keyed by ccd id with `ts`, the agents subdirectory and the reaper; the `model.id` confirmation; the per-account Fable share estimate from the sweep (the `get_usage` channel was probed at plan time and carries no buckets, §5.4); server reader and wire fields; the sweep as a scheduled job; speed and quality signals from run events | none | seven days of sidecar data on every Anthropic lane |
| 1 | the seven routing fields with shape validation; settle reads them; `--model` on both relaunch argvs; subagent env; the routing verb and `route` lifecycle act; the `route-v1` caps token and verb list entry; the measurements: does a plain `/effort <level>` or `/model` persist to the lane and does `/effort auto` delete the saved level, can the session-only form be driven by keystroke, does `--settings` set ultracode and workflows and is `enableWorkflows` readable back, does a keystroke survive a settle on a pinned lane, is an effort change cache-safe on Opus 5 | none without fields; swap continuity with them | a swap measured carrying every field |
| 2 | coordinator clauses 12 and 13; `routing-matrix.md` and `review-panel.md` in `REQUIRED_REFS` and the parity tests; worker clauses; the routing sentence in the brief; the `suite:` and `failure:` body lines and the server's body parser; the workflow model/effort policy | in-session subagent routing by convention; the held-out panel runs on every handoff review | skill tests pin the clauses; sidecar shows subagent class shifting |
| 3 | serviceability clause in swap and placement with rc 5, shared definition, bash mirror, parity test; the Fable ceiling; `degraded` | Fable-class sessions are placed and swapped by their share, or by the estimate | a Fable session measured surviving a swap without touching credits |
| 4 | dispatch writes the fields on the argv (wave 1) and through the verb (wave N ≥ 2); operator spawn on the argv; pickers write the fields with `--apply`; `_route_apply_check` with the idle predicate and `routeskip`; coordinator row as the operator-spawn default | workers spawn on their row; operator sessions spawn on Fable · ultracode; picker taps land on the next idle tick | continuous attribution begins |
| 5 | failure-kind escalation and demotion by the coordinator through the verb; journal and run-event trail | automatic escalation and demotion | rungs measured against fix-round cost |
| 6 | the `compact` field and its read in `_auto_compact_check` | a lower worker threshold, only after the graphify compaction card ships | re-read count measurable |

## 8. Guards and the mutation that must go red

| Guard | Mutation | Red suite |
|---|---|---|
| routing-field shape validation in ccd | delete the validator | a fixture field with a value outside every vocabulary reaches an argv |
| `subagent` refuses `opus`/`fable`; `effort` refused with `class: haiku` | widen either | the same fixture suite |
| `route-v1` gate omits the flag on no evidence | emit `--route` regardless | the dispatch test sees the flag at a box whose caps lack it |
| the routing verb's grant | grant `['route']` alone | the whitelist census test that pins `REQUIRED_VERB_FLAG` |
| the coordinator never passes `--apply` | add it to the skill's example or to `CCD_ARGV.route`'s coordinator form | the skill test and the argv census |
| `_route_apply_check`'s idle predicate | replace the chain with the spawn pair | the mid-turn pane fixture types |
| `routeskip` is its own field | write the refusal into `compactskip` | the fixture where a below-threshold tick clears the route refusal |
| `route` is a lifecycle act in both vocabularies | drop it from either | `lifecycle-vocabulary.test.ts` |
| no `CLAUDE_CODE_EFFORT_LEVEL` anywhere | add it to a spawn env composer | the argv census test |
| Anthropic lanes carry no `CLAUDE_CODE_SUBAGENT_MODEL` in settings | plant one in a fixture HOME | the doctor check |
| serviceability parity | change the bash mirror alone | the parity test |
| serviceability's third answer | collapse unmeasured into unservable | the fixture with an absent bucket degrades |
| the held-out panel's literal model and effort | route the panel through the fields | the parity test on `review-panel.md` and the clause-13 pin |
| `--model` on both relaunch argvs | drop it from the retry line | `ccd-spawn-split`'s retry pin |
| sidecar keyed by ccd id with `ts`; agent renders go to the subdirectory | key by uuid, drop `ts`, or let an agent render write the main file | the hook fixture with an `agent` render and a stale reading |
| body-line signals never touch the envelope | add a header line | `mail-envelope-parse`'s round-trip pin |

Each is measured red before and green after, not asserted in a comment.

## 9. Risks

- The routing fields are a byte channel into an argv and a pane; shape validation at the read is
  the defence, and its failure direction is stated.
- A plain `/effort <level>` or `/model` keystroke may persist into the lane's settings and change
  other sessions' spawn default on that lane; slice 1 measures it and picks the session-only path.
- Ultracode is a switch plus a level; its read-back from the pane divider is best-effort, and
  workflow mode below ultracode has no observer until slice 1 finds one.
- The fix-round economy is unproven; if fix rounds cost more than the cheaper-first saving, the
  worker row moves back up and the sweep says so.
- Subagent contexts average 150k today; routing them to Sonnet cuts the rate, not the size; the
  bounded-answer clause is convention with no mechanism.
- Fable's own bucket may be unreachable; then the share is an estimate and the design says so.
- Coordinators on Fable · ultracode are few but expensive per turn; the idle drop is what keeps
  that bounded, and it depends on the coordinator using it.
- The effort cost indices and `per_turn_effort` are compiled-seed rows in the 2.1.270 binary, not
  binary behaviour and not served-catalogue rows: the served catalogue
  (`downloads.claude.ai/model-catalog/v1/catalog.json`, version 346 read 2026-09-14) carries
  per-model `effort_levels`, `default_effort` and `thinking.type`, which confirm §5.1's
  vocabularies and Haiku's lack of effort, but no cost index. A release can change the seed
  without notice; the plan re-reads the seed with `strings` when the sweep shows a discrepancy,
  never pins by constant.

## 10. Operator rulings recorded in this design

- 2026-09-13: strategy first, independent of limits; limits are worked around.
- 2026-09-13: all four classes are routable, including Fable; workflows are a routed dimension.
- 2026-09-13: a swap carries the session's settings.
- 2026-09-14: operator-started sessions are coordinators and get the best model at the start; the
  coordinator decides routing for workers and its own subagents.
- 2026-09-14: the coordinator may escalate and demote as it sees fit; total automation.
- 2026-09-14: measurement is continuous; ten waves per shape is a proposal threshold, not a gate.
- 2026-09-14: judging between two routings is done by a panel of agents, never a single one.

Closed 2026-09-14: the operator confirmed "Fable does NOT use usage credits. We're on the max
plan", and the Fable sentences in `~/.claude/fable-orchestration-policy.md` were rewritten to the
Max wording the same day, so every session's context agrees with the coordinator default.

## 11. Seams (verified 2026-09-13/14; cite by symbol, lines drift)

`ccd/ccd`: `SPAWN_EFFORT`, `_inject_spawn_effort`, `_spawn_settle`, `_spawn_start` (both argvs),
`_resume_env`, `_swap_target` (rc 2/3/4 and `_undecidable_cause`), `_ws_least_loaded`,
`_ws_slug_free`, `_ws_slug_valid`, `cmd_ws_add`'s `*)` arm, `_auto_compact_check`,
`_compact_note` / `_compact_note_clear`, `COMPACT_THRESHOLD`, `COMPACT_QUIET`, `_sync_uuid`,
`_reg_set` / `_reg_get` / `_reg_purge`, `_lc_done` / `_lc_emit` / `_LC_ACTS`, `cmd_caps`.
`ccd/statusline-command.sh`: the `rate_limits` writer, the `🤖 model · effort` and `💲` segments.
`server/src/pane/statusline.ts`: `parseStatusline` (`ultracode`, `workflowActive`).
`server/src/limits.ts`: `readLimits`, `measured`, `projectHome`. `server/src/coord/dispatch.ts`:
`WORKER_KICKOFF_PREFIX`, `dispatchRun` (types `/clear` through `sendPrompt`; `capSupported`).
`server/src/coord/store.ts`: `recordRunEvent`. `server/src/coord/envelope.ts`: `renderEnvelope`,
`EnvelopeInput`. `server/src/auth/gate.ts`: `EXEMPT` (the prompt route is not in it).
`server/src/ccdargv.ts`: `CCD_ARGV`. `agent/src/whitelist.ts`: `REQUIRED_VERB_FLAG`, the read
roots. `shared/models.mjs`: `SUBAGENT_CLASSES`, `familyClassOf`. `shared/modelenv.mjs`:
`MODEL_ENV_KEYS`, `modelEnvBlock` (gpt lane only). `shared/api.ts`: `MailKind`,
`parseMailEnvelope`, `LifecycleAct`, `LIFECYCLE_ACT_MAP`. `shared/poolrule.ts`.
`pwa/src/lib/models.ts`: `modelOptions`, `effortOptions`. `ccd/install-coordinator-skill.sh`:
`REQUIRED_REFS`. Tests named above: `coordinator-skill`, `worker-skill`, `lifecycle-vocabulary`,
`caps-token-shape`, `ccd-archive` (`KNOWN_CAPABILITY_TOKENS`), `ccd-spawn-split`,
`mail-envelope-parse`.
Claude Code 2.1.270 (from the binary): settings `effortLevel`, `modelSettings.<id>.effortLevel`,
`enableWorkflows`, `disableWorkflows`, `ultracode`; CLI `--model`, `--effort` (a per-model launch
pin), `--settings`; env `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_SUBAGENT_MODEL`,
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE`; the statusline payload's `session_id`, `transcript_path`,
`model.{id,display_name}` (id confirmed in slice 0), `effort.level`, `agent.name`,
`rate_limits.{five_hour, seven_day, spend_limit}`; the `get_usage` control request's
`rate_limits.{seven_day_opus, seven_day_sonnet, model_scoped[]}` and the REPL bridge's
"onGetUsage callback not registered" answer; the model catalogue's `effort_cost_index`,
`per_turn_effort`, and Haiku 4.5's missing `effort` capability; `/effort` and `/model` confirmation
strings "saved as your default for new sessions" versus "for this session only".
