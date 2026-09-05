# Graphify read side at the ccrc level — design

**Date:** 2026-09-02. **Status:** proposed, awaiting operator review.
**Supersedes:** the read-side half of D-1243 (`plans/2026-09-01-d1243-the-read-side-had-no-mechanism.md`);
retargets D-1244 (PR #44) from "harden the block writer" to "the block writer's census becomes the remover".
**Leaves alone:** everything in `2026-08-27-graphify-fleet-integration-design.md` §A–§F (the write side).

## 0. The objection, and what it measured as

Operator, 2026-09-02: *"CLAUDE.md is a project file — graphify integration and enforcement should be
ccrc level."*

Where D-1243 actually put the block: **not** any repository's `CLAUDE.md`, but every rostered account's
config-dir `CLAUDE.md` (`~/.claude*/CLAUDE.md`) — the file Claude Code loads for every session under that
account, in every project. That is worse than the objection assumes, on both counts:

- graphify wrote `always_on/claude-md.md` for a **project** file. Its first sentence is *"This project has
  a knowledge graph at graphify-out/"*. Planted account-wide it asserts that of every project the account
  ever opens, including the trees the sweep refuses.
- the account file is the **operator's**, not ccrc's. Every one of D-1244's six data-loss classes —
  substring markers, a lost end marker, two blocks, the line-1 splice, the unchecked `&&` chain, the
  symlink fallback — exists **only because ccrc was rewriting a file it does not own**. An artifact ccrc
  owns outright has none of them.

**Measured effect of the block** (graphify's own query log, `~/.cache/graphify-queries.log`, one JSONL
row per `query`/`path`/`explain` with the graph's path in `corpus`):

| window | queries | corpora | ccrc-pwa (busiest project on the fleet, 5 fresh graphs) |
| --- | --- | --- | --- |
| last 7 days | 265 | 11 | 0 |
| since D-1243 deployed (2026-09-01) | 109 | 4 | 0 |

103 of the 109 were MekWarLive — whose **project** `CLAUDE.md` has carried graphify's block, committed,
since 2026-07-08. The account-wide block moved nothing. "5/5 homes converged" was shape; this is effect.

Two more read-side facts nobody had measured:

- **What a session runs when it types `graphify` is not the engine ccrc pins.** `command -v graphify`
  resolves to `~/.local/bin/graphify`, a pip console-script shim (`#!/usr/bin/python3` … `from
  graphify.__main__ import main`) that imports `~/.local/lib/python3.12/site-packages/graphify` — dated
  Jul 7, **no dist-info, no `__version__`**. The venv at `~/.ccrc/graphify-venv` is pinned at 0.9.9 and
  builds every graph; the read side runs whatever was on `PATH` in July. The write side resolves the
  engine by absolute path everywhere (spec §A); the read side was never given a path at all.
- **13 of 16 live trees are fresh; 3 are behind** (`custom-tools` 97 commits — refused by the corpus
  guard, correctly; `expoAI-assistant/keen-prairie` 43; `MekWarLive/swift-harbor` 4). Nothing in a session
  says which. A session querying a graph 97 commits stale gets confident wrong answers.

## 1. The rule

The read side lives **only** in artifacts ccrc installs and owns outright, and its effect is **measured**
rather than asserted. Those artifacts already exist:

| artifact | owner mechanism | reaches |
| --- | --- | --- |
| `ccd/session-hook.sh` | `install-session-hooks.sh` registers it in every rostered `settings.json` (managed entries, converge + `--remove`) | every fleet session, every event |
| `ccd/worker-skill/SKILL.md` | `install-worker-skill.sh`; eleven clauses pinned verbatim | every dispatched worker |
| the graphify skill | `install-graphify-skill.sh` assembles it from the pinned package into every home | every session — its description **already** says *"especially when graphify-out/ exists, where the question should be treated as a graphify query first"* |
| `~/.ccrc/graphify-venv` | `_inst_graph_engine`, pinned | the sweep — and, after R3, sessions |
| `~/.cc-sessions/<id>.hookstate.json` | the hook writes it; `server/src/hookstate.ts` is its one reader | the server, the PWA, the run board |

**Never a `CLAUDE.md` at either level.** The project-level `## graphify` sections in MekWarLive and rp-llm
are graphify's own doing in the operator's repositories — theirs, untouched by this design.

## 2. Mechanisms

### R0 — retire the account-wide block

Delete `_inst_graph_always_on` (`ccd/ccrc:5169-5337`) and its describes in
`ccrc-install-graphify.test.ts` / `ccrc-install.test.ts`. Add **`_inst_graph_always_on_off`**, the same
shape as `_inst_graph_hooks_off` — ccrc already has a step whose whole job is removing what an earlier
layer planted, so this is the idiom, not a wart. For each rostered config dir: resolve the symlink
(**skip** if unresolvable — never write through a link you could not resolve), census the two markers as
whole lines, require **exactly one well-ordered pair** or report and leave the file alone, back up, delete
lines `ls..le` plus the one separating blank line the append path wrote, via tmp + `mv` with the file's
own mode preserved. Anything else: *"left in place — remove by hand"*, counted, `INST_DEGRADED`. This is
D-1244's hardened census and splice doing its last job; PR #44's code is reused, not discarded.

Fleet today: 5 rostered homes, **3 physical files** (`.claude-gpt` and `.claude-kimi` are symlinks to
`~/.claude/CLAUDE.md`). The step stays in the tree afterwards exactly as `_inst_graph_hooks_off` does.

### R1 — the graph card: `SessionStart` context from the session hook

On `SessionStart` — **every** source, compact included, because compaction is precisely when a session
loses what it knew (the hookstate write stays skipped for compact, per D-306; the card is independent of
it) — the hook prints **one** JSON object on stdout:

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<card>"}}
```

The card is **measured for this session's tree** (`cwd` from the payload; `$REG/<id>.workdir` as the
fallback):

- no `graphify-out/graph.json` → print **nothing**. Silence is the true answer for a tree the sweep has
  not reached or refused; when `~/.ccrc/graph-sweep.json` carries a row for the tree, its `reason` is the
  one line printed instead (*"the sweep refused this tree: `untracked-paths: …`"*), so a session knows
  why there is no graph rather than assuming there never is one.
- present →

  > graphify: this tree has a knowledge graph — `graphify-out/`, N nodes, built at `<sha8>` (**fresh** |
  > **K commits behind HEAD**), engine `<engine>` (pin `<pin>`). Answer codebase questions with
  > `graphify query "<question>"` first; `graphify path "<A>" "<B>"` for relationships and
  > `graphify explain "<concept>"` for one concept; read `graphify-out/GRAPH_REPORT.md` only for broad
  > architecture. Do not run `graphify update` or any build here — the ccrc sweep owns the write side.

Cost, under the hook's standing contract (*exit 0 on every path, no network, no locks, no waiting*):
`built_at_commit` is the **last** key of `graph.json`, so it is read with `tail -c 4096`, never by parsing
the 8 MB file; `git rev-parse HEAD` and `git rev-list --count` are ref reads; the node count comes from
the sweep census row when present, else from the 123 KB `manifest.json` (measured 2026-09-02), else is
omitted. Any failure prints nothing. **Stdout stays empty on every other event** — on `PreToolUse` a
stdout JSON is a permission decision, so the card path is the only `printf` to stdout in the file and
lives inside the `SessionStart` arm.

The engine/pin pair is on the card for one reason: the drift §0 found (sessions running an unversioned
July copy against 0.9.9 graphs) is otherwise invisible until a query fails strangely.

### R2 — worker skill clause 12

Added to `ccd/worker-skill/SKILL.md`, pinned verbatim by `worker-skill.test.ts` (which becomes "twelve
clauses"):

> 12. When your workspace carries `graphify-out/graph.json`, a question about the codebase goes to
> `graphify query` before `grep` or a file read, and to `graphify path` / `graphify explain` for
> relationships and concepts. Never run `graphify update` or any graphify build in the workspace: the
> sweep owns the write side, and a session-side build holds you at `working` for minutes and wedges the
> next dispatch as `worker-busy`.

The coordinator skill gains no clause — it reads plans and mail, not source. `references/wave-lifecycle.md`
§2 gains one sentence: a brief may quote the card's freshness line so the worker knows what it is querying.

### R3 — the engine sessions run is the engine ccrc pins

`_inst_graph_engine` gains a converge of **`~/.local/bin/graphify` → `~/.ccrc/graphify-venv/bin/graphify`**
with `ccrc wrappers`' discipline: write when absent; replace when the existing file is a symlink into the
venv **or** a pip/pipx console-script shim (the `from graphify.__main__ import main` shape measured on this
fleet — matched by content, not assumed); **refuse with a remedy** for anything else (a hand-written
launcher is the operator's). `/usr/local/bin/graphify` is root-owned: reported, never touched.

Doctor check `graphify-path`: `command -v graphify` must resolve into the venv, and today's remedy text
(*"root-owned link outside $HOME"* — factually wrong for a user-owned file inside `$HOME`) is replaced by
the measured one.

### R4 — measure the effect: graph queries in hookstate

`session-hook.sh`, on `PostToolUse` with `tool_name == "Bash"` and a `tool_input.command` matching
`(^|[;&|[:space:]])graphify[[:space:]]+(query|path|explain)([[:space:]]|$)`, increments `graphQueries` in
the hookstate it already writes. The counter is carried across events the way `subagents` is; reset to 0
on a `SessionStart` whose source is `startup` or `clear`; kept across `resume` and `compact`. `graphify
update` and builds do **not** count — the hook is measuring reads.

One reader, `server/src/hookstate.ts`: `graphQueries: number | null`, **null when the field is absent**
(an older hook), never folded to 0 — a session that reported no queries and a session that reported
nothing are two conditions the console shows differently (`graph 0` vs no chip). Carried on
`FleetSession.graphQueries: number | null` — additive, no `FLEET_PROTO` bump, `reviveFleetSession`'s
literal gains the field so every path must compute it. PWA: a `graph N` chip on the session card and on
the run board's worker row.

The server **never reads `~/.cache/graphify-queries.log`**: it is not under the agent whitelist and this
design does not add a read root. The hook projects the count into a file that already is.

### R5 — declined for now: the `PreToolUse` speed bump

A deny on the first `Grep`/`Glob`/`Read` in a session whose tree has a fresh graph and whose
`graphQueries` is 0 **is** a mechanism in this codebase's sense — one deny, one reason, then open, the
same "convention with a speed bump" shape as `coordinator-paused`. Declined in this round, on three
grounds:

1. `PreToolUse` fires for **subagents** too. An Explore agent's first `Grep` would be denied in a context
   that never saw the card.
2. The hook's contract is *"a hook that can slow or break a session is worse than no hook"*; a deny path
   would be the first thing in the file that can wedge a turn.
3. R4 makes adoption measurable. Gate **after** the number says the card and the clause did not move it —
   not before there is a number.

Recorded so it is not re-derived. Revisit with one week of R4 data — **which is a sample somebody
takes, not a series the tree keeps** (D-1365). R4 projects the count into the hookstate the hook
rewrites on every event and onto the `FleetSession` / `~/.ccrc/state-cache.json` snapshot; nothing
persists it to `coord.db`, to a run row or to any log, and it resets on every `SessionStart` that is
not a `resume`, which for a dispatched worker means per-wave (dispatch `/clear`s the worker from wave
2 on). The revisit is therefore an act: a week or more after deploy, read the `graph N` chips across
the live fleet on one dated day — sessions carrying a chip, chips reading `graph 0`, the total — and
record that reading in `docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md`'s
`## Deviations found`, the way §0's table recorded the block's own effect. Persisting the counter
instead (stamping a worker's `graphQueries` into its run row at wave close, so the week's figure is
re-derivable rather than sampled) is the alternative, and is not in this round's scope.

### R5 — built, by operator ruling 2026-09-05: the `PreToolUse` gate

The decline above stands as history. The revisit it asked for was taken on 2026-09-05 at 11:08 UTC,
two days after the read side deployed, and recorded as D-1613: **4 queries fleet-wide across 3
corpora; of 18 live sessions, 10 carried `graphQueries` 0, 2 carried 1, 1 carried 2, 5 carried
`null`** (no `SessionStart` since the deploy). The card and clause 12 moved nothing the counter could
see. The operator's ruling on that reading: *"WE WANT TO ENFORCE."* R5 is therefore built, and each
of the three grounds gets its answer in the mechanism rather than in prose.

**Where it lives.** The existing `PreToolUse` arm of `ccd/session-hook.sh`. That event is already
registered with matcher `*` in every wrapper HOME by `_inst_hooks`, and the script is re-executed per
event, so an agent deploy makes the gate live in every session with no restart and no
`settings.json` change.

**Gated calls.** `Grep`; `Glob`; and `Bash` whose command **heads** with a search — after optional
leading environment assignments and at most one `cd <dir> &&` / `cd <dir>;` prefix, the first word is
one of `rg grep egrep fgrep ugrep ag ack find fd`, or the pair `git grep`. A search that is not at the
head of the pipeline (`vitest run | grep Tests`) is not a codebase question and is not gated.
`graphify …` itself is never gated. `Read` is not gated: a named file is not a question.

**Arm condition — ALL true, or the hook prints nothing and the call proceeds.**
1. `$HOME/.ccrc/graph-gate-off` is absent (the operator's kill-switch; ccrc-owned directory, nothing
   in the tree writes it).
2. The tree named by the payload's `cwd` (fallback `$REG/<id>.workdir`, as the card) has
   `graphify-out/graph.json` with a stamp the card's own tail read accepts.
3. Freshness, by the card's own predicate, reads `fresh`, `fresh — same content as HEAD`, or at most
   `GRAPH_GATE_MAX_BEHIND` (10) commits behind HEAD. `not an ancestor`, `unmeasured` and further behind
   do not gate: the card already tells the session the graph is stale.
4. The session's `graphQueries` is 0.
5. The session's `graphGateDenials` is below `GRAPH_GATE_MAX_DENIALS` (3).

**Effect.** stdout, exit 0:
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}`
The reason is the card's vocabulary plus the act: *graphify gate: this tree has a knowledge graph
(<N> nodes, <freshness>) and this session has not queried it yet. Search tools open after one graph
query — run: `graphify query "<your question in plain words>"` (`graphify path "<A>" "<B>"` for a
relationship, `graphify explain "<concept>"` for one concept). Denial <k> of 3; after 3 the gate
opens anyway.* The hookstate written on that event carries `graphGateDenials: k`.

**Opening.** Any `graphify query|path|explain` attempt — the existing `GRAPH_QUERY_RE`, counted on
the command and never on its exit code — lifts the gate for the session. `graphGateDenials` resets
with `graphQueries`, on a `SessionStart` that is not a `resume`, so a dispatched worker meets the gate
once per wave (dispatch `/clear`s it from wave 2 on), and `/clear` by hand re-arms it.

**The three grounds, answered.**
1. *Subagents.* The hook fires for a subagent's tool calls too (the harness documents it) and the
   subagent shares the session's hookstate, so its first search is denied with a reason that carries
   everything the card carried, and one query by anyone opens the gate for everyone in the session.
2. *A hook that can wedge a turn.* Fail-open everywhere: every read failure, an unreadable hookstate,
   a missing `jq`, an unresolvable tree, an unparseable stamp — no stdout. And the bound: after 3
   denials without a query the gate opens anyway, so a session that cannot run `Bash` at all gets
   through on its fourth search call, and the board shows `gated 3` for it.
3. *Gate after the number.* The number is D-1613. It keeps being taken: denials are counted beside
   queries, so the gate's own effect is the next reading.

**Surfaces.** The `SessionStart` card ends with *Search tools (Grep, Glob, shell grep/rg/find) are
gated until this session's first graph query.* when conditions 1–3 hold for the session's tree, and
with *the search gate is off (operator file)* when the kill-switch exists. `graphGateDenials: number |
null` sits beside `graphQueries` in the hookstate (`null` ≠ 0, one reader, same discipline);
`FleetSession.graphGateDenials` is additive with one tolerant reader `graphGateCount`; the `graph N`
chip reads `graph N · gated k` when k > 0. The doctor's `graphify` line adds `gate on` or `gate off
(operator file)`. README documents the gate, the kill-switch and the bound, and re-derives its R5
paragraph from decline to ruling.

**Mutation targets.** Each with a test that goes red when the guard is deleted: the deny JSON,
byte-exact; opens after one query; silent without a graph; silent at 11 behind, gated at 10; silent
with the kill-switch file; `Bash` head-search denied and pipeline-tail search allowed; the bound at 3;
counters reset on startup and `/clear`, kept on `resume`; silent when the hookstate is unreadable;
the card sentence; `hookstate.ts` revives `null` and `0` apart; `FleetSession` carries the field;
the chip; the doctor line.

## 3. Rings and invariants

- The hook is shell at the harness seam: it measures and reports, it does not decide. No network, no
  locks; every read is a local file or a git ref.
- `hookstate.ts` is an L3 adapter and may not narrow: `null` and `0` stay distinct.
- `shared/api.ts` gains one additive field; L0 imports nothing, as before.
- `EXEC_COMMANDS` unchanged; `gh` untouched; **no new ccd verb; no new agent read root**.
- `settings.json` entries are unchanged — `SessionStart` and `PostToolUse` are already managed events
  (D-306 wired `SessionStart`); `install-session-hooks.test.ts` still derives the set from the hook's own
  `case` block.

## 4. Mutation targets

| mutation | expected red |
| --- | --- |
| card printed on any event but `SessionStart` | stdout-empty test for `PreToolUse`/`PostToolUse`/`Stop` |
| card printed with no `graph.json` present | silence test |
| `built_at_commit` read from the head of `graph.json` | fixture with the key last and a decoy first |
| hook exits non-zero when `cwd` is missing or not a repo | exit-0 test |
| `graphQueries` counted for `graphify update` | not-counted test |
| `graphQueries` reset on `compact` | kept-across-compact test |
| reader folds an absent `graphQueries` to 0 | null-vs-0 test |
| clause 12 softened or removed | verbatim pin |
| `_inst_graph_always_on_off` deletes a chained or malformed block | left-in-place + reported test |
| R5's revisit criterion names no act that takes the number (and nothing persists it) | derived doc guard over both R5 sections |
| `_inst_graph_always_on_off` writes through an unresolvable link | skip test |
| `~/.local/bin/graphify` replaced when it is a hand-written script | refused test |
| doctor passes with `graphify` resolving outside the venv | FAIL test |
| README describes the read side as a `CLAUDE.md` block | derived README guard |

## 5. Ledger

**D-1245** (allocate at commit time: `origin/main`'s highest is D-1243 today; D-1244 lands with PR #44):
*D-1243 put a project-scoped instruction into an account-wide file ccrc does not own; measured effect
zero on every project but the one whose project file already carried it; retired for R0–R4.*

## 6. Operator decisions

1. **R5** is declined by this design. Say so if you want the speed bump regardless.
   **Reversed 2026-09-05 (D-1613):** the operator said so, on the R4 reading. R5 is built — §2 "R5 — built".
2. **R0** removes the block from the three physical files ccrc wrote, on the next `ccrc install`. If you
   would rather remove them by hand, R0 ships report-only.
3. **PR #44** is merged on green — it hardens `main` against the data-loss classes for the interim and its
   census is R0's core — and deployed **once**, with this design, not twice.

## 7. Out of scope

The write side (§A–§F stand); the project-level blocks in operator repositories; graphify's git hooks
(O6 stands); the semantic layer (Appendix A stands).
