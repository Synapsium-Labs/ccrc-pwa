# The routing matrix — which class, effort, subagent class and workflow mode a shape of work runs on

This is the strategy the coordinator applies (clause 13) and the worker routes its own subagents
by (worker clause 14). It is spec §3 of `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md`,
verbatim; the spec is the argument, this file is the rule the skills point at. A row changes by a
PR against THIS file, with the spec amended in the same PR and the measurement behind the change
attached (spec §6: ten completed waves of one shape, judged by a panel, never a single agent). A
reference, not a clause: `server/test/routing-references.test.ts` pins its class and effort words
to the vocabularies the mechanism enforces, not the rows themselves.

The held-out review panel (`references/review-panel.md`) is NOT routed by this table: its model
and effort are literal in its script, whatever row the wave under review ran on.


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
| Worker executing a spec'd plan: a dependent chain that fits one context | Opus · high | Sonnet · high implementers; Opus · high per-task reviewer; Haiku scouts | Off | Measured by Anthropic, not on this fleet: a single model on a dependent chain that fits one context beat orchestration in every case, at lower effort; Opus 5 matched Fable 5 on coding at 60% of its cost. Measured here: this fleet's Opus turns average 155k of context, so a wave that outgrows one context falls under the bulk row; the coordinator names the row in the brief. The wave's `route` carries `compact 40` (the worker's lower threshold, S6-R9): a dependent chain that fills one context compacts earlier than the box default, so the wave's later tasks start lean. |
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

