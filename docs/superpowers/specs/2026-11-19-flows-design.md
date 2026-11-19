# Flows: the method a programme follows, as data the operator edits

**Spec** · 2026-11-19 · Status: Draft, for the operator · Owner: the operator · Linear: none · Related:
`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (rings, contexts, the Rejected list),
`docs/superpowers/specs/2026-09-14-review-runs-design.md` (work and review runs), `docs/superpowers/plans/2026-11-19-flows-w1.md`
(wave 1's build)

## In short

ccrc's method — brainstorm, spec, plan, dispatch waves, re-measure wave-done, review, merge — is written today as prose in
three skills and as constants in the server. Nobody can change it without a ccrc release. This design makes the method
**data**: a **Flow** is a graph of **blocks** joined by **outcome edges**, each block carrying the prompt a session is given
when a programme reaches it. ccrc ships **templates** (its own flow, `ccrc`); a plugin may ship more (a lifecycle of its own,
for one). The operator copies a template, edits it in the PWA — drag and drop on the desk, an outline on the phone — and
publishes immutable versions. A programme **pins** the version it opened with. ccrc's fleet protocol (open a run, dispatch,
re-measured wave-done, the review handoff) appears as **locked blocks**: they can be placed, never edited or deleted,
because the server's re-measurement depends on them. Wave 1 builds the definitions, their store and the editor; **nothing
executes a flow until wave 3**, and then in shadow first.

## 1. Context

The operator, 2026-11-18, asked for colleagues to use a lifecycle plugin inside ccrc, then widened it: "the workflows have
to be programmatically managed, to be able to install plugins in the future and modify it. So people can select predefined
[flows: ccrc's own, a plugin's lifecycle] etc." Ruled in the conversation since:

- **The name is Flow.** "Workflow" is Claude Code's own word in ccrc (`server/src/workflows/`, `WorkflowStrip`, `wf_` ids,
  coordinator and worker clause 19) and stays as it is.
- **Flows are per operator** (per installation; ccrc has one operator). **Templates are shared from code**: ccrc's in this
  tree, a plugin's in its own repository.
- **A flow is a graph** — branches and loops, drag-and-drop editing, an editable prompt on every block — not a line of stages.
- **A step is an instruction or a gate, set per block.** A gate is checked by the server from a closed catalogue.
- **The server runs the flow** (approach A below), not generated skills and not a session-side engine.
- **The editor's look** is the mockup approved 2026-11-18, kept beside this file (`2026-11-19-flows-design/mockup.html`,
  rendered to `desktop.png`; not product code): desk tab "Flows" (palette, canvas in a well, inspector of Section cards),
  phone outline with lock marks and live counts, built on `@ccrc/ui`. Its diagram predates §4's wave skeleton; §4 governs.
- Instruction to the builder: implement it, acting as architect and principal engineer, challenging as it goes (§11).

## 2. Measured today

- **The installer names a fixed list.** `_inst_skills` (`ccd/ccrc`) installs coordinator, worker, reviewer, history and
  linear skills into every rostered home. It installs no plugin.
- **The brief's first sentence is a constant.** `WORKER_KICKOFF_PREFIX` and its reviewer twin (`server/src/coord/dispatch.ts`)
  name the `ccrc-worker` / `ccrc-reviewer` skill; the coordinator writes the rest of the brief.
- **The skills mix protocol and method.** The worker's twenty clauses hold both the fleet protocol (`ws/<slug>` branch, ack,
  claims, the done fingerprint, `ccrc test --`) and method (which executor, routing). They are pinned word for word.
- **The run machine is code.** `RunState` and `RunKind` (`shared/api.ts`) with their transition tables; `ACTIVE_RUN_STATES`
  counts the dispatch cap.
- **A plugin on a home fails doctor** for an account that can serve the Overlord (`overlord-mods`, `ccd/ccrc-doctor-checks`),
  because a plugin's hooks can approve what the Overlord's profile denies.
- **The exec surface is closed**: `EXEC_COMMANDS = ['tmux','ccd']`. The server runs no arbitrary command on the fleet.

## 3. Goals, non-goals, anti-goals

Goals: the method is data; the operator edits it in the PWA; templates ship from code and from plugins; a programme follows
one pinned version; gates the server can measure are enforced; the PWA shows where every programme is on its flow.

Non-goals: multi-user ownership; a hosted service for sharing flows (sharing is a file, §14); a generic workflow
engine for anything but ccrc programmes; replacing Claude Code's own Workflow tool.

Anti-goals — the design has failed, even if it works, if:
- an edited flow can remove or reorder the fleet protocol, and a programme wedges `stale-tip` or skips re-measurement;
- the server gains a way to run arbitrary commands on the fleet box;
- a flow edit changes a programme already running;
- a second writer appears for a run's state.

## 4. The model (L0, `shared/flows.ts`)

```ts
type BlockKind = 'instruction' | 'skill' | 'gate' | 'protocol';
type Role = 'coordinator' | 'worker' | 'reviewer' | 'operator';
type GateKind = 'approval' | 'pr-state' | 'attested';
type ProtocolStep = 'open-wave' | 'dispatch' | 'verify' | 'review' | 'close-wave' | 'end';

interface FlowBlock {
  id: string;              // stable within the flow: [a-z0-9-]{1,40}
  kind: BlockKind;
  title: string;           // ≤ 80 chars
  role: Role;
  prompt?: string;         // instruction/skill; ≤ PROMPT_MAX chars; {{var}} from FLOW_VARS only
  skill?: string;          // skill: `plugin:skill` or a bare skill name
  gate?: { kind: GateKind; prState?: 'open' | 'merged' };   // gate only
  step?: ProtocolStep;     // protocol only
  outcomes: string[];      // names this block can answer, e.g. ['done'], ['clean','findings']
  at: { x: number; y: number };  // canvas position; layout is part of the document from v1
}
interface FlowEdge { from: string; outcome: string; to: string }
interface FlowDoc { schema: 1; title: string; start: string; blocks: FlowBlock[]; edges: FlowEdge[] }
```

- **Template**: a `FlowDoc` shipped in code, with an id and a version (`ccrc@1`). Read-only.
- **Flow**: the operator's, `{ id, title, source?: { template, version } }`, holding one mutable **draft** and any number of
  immutable **published versions** (1, 2, 3…).
- **Pin** (wave 2): a programme's `(flowId, version)`, written once when the programme starts — before its first run,
  because the blocks before `open-wave` (brainstorm, spec, plan) are the programme's too.
- **Position** (wave 3): the block a programme is on, with its history.

**One flow covers a whole programme**; the protocol skeleton is **one wave**, and the flow loops through it once per wave
(ruled 2026-11-19 by the builder as architect, answering the builder check's Q1). Each protocol step stands for one fact the
run machine already reports, so wave 3 maps names, never invents them:

| Step | Stands for | `PROTOCOL_OUTCOMES` |
|---|---|---|
| `open-wave` | `POST /api/runs` opened the wave's work run (`planned`) | `opened` |
| `dispatch` | the run reached `dispatched` | `dispatched` |
| `verify` | `/advance` accepted the worker's wave-done fingerprint (`awaiting-review`) | `verified` |
| `review` | the review run closed and the coordinator ruled on its report | `clean`, `findings` |
| `close-wave` | the work run reached `done` | `next-wave`, `last` |
| `end` | the programme ended | (none) |

The **phase** of a block says which part of the wave it belongs to: a protocol block's phase is its rank (`open-wave` 1 …
`close-wave` 5, `end` 6); any other block's phase is the lowest phase of the blocks with an edge into it (0 when it is
`start`, or reached only from phase-0 blocks).
`validateFlow(doc): FlowProblem[]` is pure and lives beside the type. Publish refuses a doc with any problem; a draft may hold
problems (it is a draft). The rules:

1. `start` names a block; every block is reachable from it; ids unique.
2. Every edge's `from`/`to` exist and its `outcome` is one of `from`'s outcomes; each `(from, outcome)` has exactly one edge;
   every outcome has its edge. `end` is the only block without outcomes, and `end` is reachable.
3. **The protocol skeleton is present and ordered**: exactly one block for each `ProtocolStep`. Every edge is one of:
   - **forward**: into a non-protocol block of the same phase as its source;
   - **a step**: into protocol rank r from phase r−1, except `open-wave`, entered from phase 0 or 5, and `end`, from phase 5;
   - **rework**, the one backward edge: from phase 3 or 4 (after verify, after review) into a non-protocol block of
     phase 2 (between dispatch and verify) — the fix round, which must then pass `verify` again.
   Anything else is a problem naming the edge.
4. Protocol blocks have no `prompt`, `skill` or `gate`; their outcomes are exactly `PROTOCOL_OUTCOMES[step]`.
5. A gate's kind is from `GATE_KINDS`; `pr-state` names a state; `approval` has role `operator`.
6. `{{var}}` names only `FLOW_VARS` (`plan.path`, `wave.tasks`, `run.id`, `programme.slug`, `review.report`).
7. Sizes: ≤ 60 blocks, prompt ≤ 4000 chars, title ≤ 80.

Every list here (`BLOCK_KINDS`, `ROLES`, `GATE_KINDS`, `PROTOCOL_STEPS`, `FLOW_VARS`) is derived once from its type, per the
single-definition rule.

## 5. How a flow runs (approach A, waves 2–4)

- **Protocol blocks are observations, never acts.** The engine moves a programme past `dispatch`, `verify` or
  `review` when the run machine reports that transition. It never writes a run's state: the run routes stay its one
  writer.
- **An instruction or skill block** is entered by sending its prompt (vars filled, the role's kickoff prefix first) to the
  role's session by mail — the path briefs take today. The session answers with an outcome through one box-token door,
  `POST /api/flows/outcome` (attribution-checked like the claim lanes). `nextBlock(doc, at, outcome)` is the L1 decider.
- **A gate** is measured by the server: `approval` raises a Waiting-on-you item and passes when the operator ticks it;
  `pr-state` reads the PR phase ccrc already measures. **`attested`** is the honest name for "a command passes": the session
  reports the outcome with evidence and the server records who attested it. The server never runs the command (§2, the
  closed exec surface).
- **Shadow first.** Wave 3 records where each programme *would* be and what it *would* send, beside what the coordinator
  actually did, until the operator arms it — ccrc's usual shadow → live lane.

## 6. Templates and plugins

- `ccrc@1` lives in `server/src/flows/templates/ccrc.ts` and is **descriptive**: its prompts are one-line summaries of
  today's method and say so, because nothing reads them before wave 3 and a word-for-word copy of the skills' clauses would
  be a second copy of pinned text. Wave 2 moves the method half of the clauses out of the skills into **`ccrc@2`**, the
  one copy (characterization tests first); an operator's copy of `ccrc@1` then shows "template moved to v2" (builder check Q5).
- A plugin contributes templates as `flows/*.json` in its own tree (wave 6). ccrc's repository is public, so no private
  plugin's template, name or marketplace is ever written here.
- A flow lists the plugins it needs (§14.3); they install when the operator confirms them, which adds them to the operator's
  allowlist, and the spawn loads them per session (wave 6, after measuring that Claude Code can load a plugin for one session without enabling it in the home — the
  `overlord-mods` check stays green).

## 7. Storage (coord.db; context C5 Coordination)

Two tables, one writer (`CoordStore`): `flows (id, title, source_template, source_version, draft_json, created_at, updated_at)`
and `flow_versions (flow_id, version, doc_json, published_at, PRIMARY KEY (flow_id, version))`. Docs are stored as JSON.
**A read checks shape, never policy**: `parseFlowDoc` answers a row that does not parse, or whose shape (or `schema` number)
it does not know, as `unreadable`, never folded into absent. The rules of §4 run at publish only, so tightening them later
never turns a published version unreadable; a change to the document's shape bumps `schema`, and the parser keeps reading
every `schema` it ever shipped (builder check Q2). A published version is never updated; deleting a flow refuses while any
programme pins it (wave 2). coord.db's snapshot carries both tables.

## 8. Doors (all session-gated operator doors; no box token)

`GET /api/flows` (the operator's flows and the templates), `GET /api/flows/:id` (draft, versions, problems),
`POST /api/flows` (new, empty or from a template), `PUT /api/flows/:id/draft` (save; returns problems),
`POST /api/flows/:id/publish` (refuses with the problems), `DELETE /api/flows/:id`, `GET /api/flows/:id/versions/:v`.
Registered from `server/src/flows/routes.ts`, a lane source the box-token census reads with a hand-kept `FLOW_DOORS`.

## 9. The PWA

Desk: a **Flows** tab — the operator's flows and the templates; a flow opens in an editor of Section cards: the diagram
(blocks at their stored places, outcome edges drawn from the blocks' geometry, locked protocol blocks dashed and matte, a
fix round dashed in the attention hue), the outline of steps, and an inspector (kind, role, skill, gate, prompt in mono,
outcomes), with Save draft and Publish. The problems `validateFlow` finds are listed live. Phone: the same editor as an
outline; Flows is not on the phone bar (its six doors are full) and is reached through the palette's "Go to Flows".
Wave 1's diagram takes no input — the outline selects — and kinds are told apart by label and shape; the canvas wave adds
dragging, selection on the canvas, kind colour tokens (generated with the theme seeds, through the contrast gate; account
hues stay accounts') and live positions (a breathing dot on a block).

## 10. Waves

1. **Definitions.** `shared/flows.ts` (model, lists, validator), `ccrc@1` template (descriptive), coord.db tables,
   `CoordStore` methods, the doors, the PWA Flows tab: list, create from template, outline editor (edit block, add block,
   connect outcomes), read-only diagram, validate, publish. Nothing executes.
1b. **Share** (§14.1): export a published version to a file, import a file as a new flow's draft. Nothing executes.
2. **Pins and the brief.** Split protocol from method in the three skills (characterization tests first); programmes pin a
   version; dispatch composes the brief from the pinned flow, shadow-compared to today's.
3. **The engine, shadow then live**: positions, the outcome door, instruction and skill blocks.
4. **Gates**: approval, PR state, attested.
5. **The canvas**: drag and drop, connect by dragging, live positions.
6. **Plugins**: per-session loading, plugin templates, `requires` and the confirm-to-install screen (§14.3).
7. **Harnesses** (§14.2), once the harness adapter seam exists: capability tables, derived support levels, the policy hook.
8. **Managed flows** (§14.4): the managed door and read-only managed flows.

## 11. Challenges the design answers (principal engineer's notes)

- **"Command passes" as a server gate was refused**: it would open the closed exec surface. It became `attested`.
- **Protocol blocks are observations**: otherwise the flow engine becomes a second writer of run state.
- **Flows join C5 Coordination, not a twelfth context**: a flow is the method coordination follows, its only consumer
  is coordination, and a new context would add a map row, an id and a boundary with nothing on the other side of it.
- **The step is `verify`, not `wave-done`**: it stands for the server's re-measurement accepted, and `wave-done` is the
  worker's mail subject, spelled once (`shared/api.ts#WAVE_DONE_SUBJECT`).
- **`FlowRole` reuses `FleetRole`** (`shared/fleetRoles.ts`, the one role vocabulary) for the three session roles and
  adds only `operator`, who is no session.
- **Layout lives in the document from v1**, so the canvas wave needs no migration.
- **Drafts may be invalid; versions may not**: editing stays fluid, and only what a programme can pin is held to the rules.
- **No auto-merge of template updates**: a copy shows "template moved to vN" and a diff; merging an operator's edited prompt
  silently is how a method changes nobody chose.
- **Wave 1 executes nothing**: the definitions and the editor are useful and safe alone, and the risky part ships in shadow.
- **The canvas is wave 5, not wave 1**: the outline edits the whole graph on any screen, and a drag-and-drop library is a
  dependency decision worth its own measurement (bundle, accessibility, licence).

## 12. Rejected

Renaming Claude Code's "workflow" in ccrc; compiling flows into generated skills; a session-side engine; a server-run command
gate; editable protocol blocks; per-home plugin enablement.

## 13. Waiting on you

- Q1. Should a programme already running move to a newly published version when the operator asks, or only new programmes
  (this design: only new)?
- Q2. Should the operator be able to hide a template they never use?
- Q3 (ruled by the operator 2026-11-19: anything may be added, with a notice that the source is unknown and an offer to
  trust it; once trusted, it is not asked again). The confirm screen marks a package from an unknown source and offers
  "Trust this source"; a trusted source is never asked about again, and the confirm screen still lists what each package
  brings. A deployment may route acceptance to someone else through the policy hook (§14.2).

## 14. Sharing, harness support and required plugins (added 2026-11-19)

The operator, 2026-11-19: flows are shared between users, for now simply as a saved JSON file; a flow may require plugins,
and the user confirms installing them, with the UX done properly; every flow states which harnesses it supports. These
fields are **additive** to `FlowDoc` (`schema` stays 1, absence permits: no `harnesses` reads as "Claude Code, supported",
no `requires` as "none"), and each lands with the wave that reads it.

### 14.1 Sharing (wave 1b)

- **Export** writes one published version as a file: the `FlowDoc` plus `{ exportedFrom: { title, version } }`. Drafts are
  not exported: only what passed the validator leaves.
- **Import** reads a file into a **new flow's draft**, never a published version. The file is untrusted input: it passes the
  same `validateFlow` (sizes, protocol skeleton, `FLOW_VARS`), a byte cap on the whole file before parsing, and refuses an
  unknown `schema`. Protocol blocks in the file are checked like any draft's.
- **The operator reads before publishing.** A shared prompt becomes what a session is told, so the import screen lists every
  block's prompt and every `requires` entry before the draft opens. Publishing stays the operator's act.

### 14.2 Harness support (wave 7)

A flow states, per harness, one of three levels:

| Level | Means | Who sets it |
|---|---|---|
| `supported` | every block works on it | derived |
| `limited` | it runs, with a listed limitation per block that needs a capability the harness lacks or provides weakly | derived, the author may add notes |
| `excluded` | the author does not consider it | the author only |

- **Derived, not declared.** Each block kind and gate needs capabilities (`skill`, `pre-tool-hook`, `approval-answer`, …);
  each harness adapter publishes a capability table (`full`, `weak` with a reason, `none`). A pure L1 decider compares them,
  so a harness update that closes a gap changes the level without anyone editing a flow. The author can only narrow:
  exclude a harness or add a note, never mark a gap as supported.
- **The harness is chosen per programme** and pinned with its flow version. The level is computed then and kept: a later
  capability change shows a notice on the running programme and applies only to new pins (the §3 anti-goal: an edit never
  changes a programme already running).
- **Limitations are shown, then decided.** Choosing a `limited` flow for a programme shows its limitations and asks for a
  confirmation. On a single-operator install the operator is the one who confirms. A policy hook (configuration, or the
  existing policy-decision-point seam) may instead refuse `limited`, route the confirmation to someone else, restrict the
  harnesses offered, and refuse or route a package install (§14.3). ccrc decides nothing about who that is.
- **Wave 7 waits for the harness adapter seam**; it adds capability tables and levels to it and does not build it.
- **One policy, a shim per harness.** Guards that run before a tool call are written once on the server (today's
  `approvalguard.ts` and the Overlord's deciders). Each harness gets a thin shim (a hook or plugin that asks the server),
  installed by the adapter. Where a harness has no hook, or one with a known gap, its table says `weak` or `none` and the
  level follows. Pre-prompt checks (what ccrc sends a session) need no harness support, because ccrc composes those prompts.

### 14.3 Required plugins (wave 6)

- `requires: { package, source, version? }[]`. A **package** is ccrc's harness-neutral unit: a manifest (name, version,
  harnesses, signature), flow templates, MCP servers, skills, and a part per harness that the adapter's `install` turns into
  that harness's format. A Claude Code plugin is a package with one `claude-code` part, so today's plugins need no repackaging.
  Every `skill` block's `plugin:skill` adds its package automatically. Authors list only packages no block names (hooks, MCP
  servers).
- **Signatures** are checked by ccrc before install, against publisher keys the operator trusts (Settings). An unsigned
  package installs only if the operator has allowed unsigned packages from that source.
- **If Claude Code cannot load a plugin for one session only** (the wave 6 measurement fails), wave 6 stops there and comes
  back to the operator as a decision; it does not fall back to enabling plugins for a whole home.
- A flow with an unmet requirement can be edited but **not published or pinned**, and shows "needs N plugins · Install".
- **The confirm screen** lists, per plugin: name, source, version, already installed or not, and what it brings (skills,
  agents, MCP servers, hooks). **Hooks get a warning line**, because a plugin's hook can approve what a guard denies (§2,
  `overlord-mods`). Buttons: "Install and continue", and "Continue without" (the flow stays blocked).
- **The install is a server-composed `ccd` verb** with validated arguments (the exec surface stays closed): it adds the plugin
  to the operator's allowlist, installs it, and re-measures that it is present. The PWA shows its progress like any job.
  Loading stays per session; enabling a plugin for a whole home stays rejected (§12).
- **A plugin declares its harnesses too.** Its parts per harness feed the same capability tables, so a flow's level
  accounts for the plugins it requires.

### 14.4 Managed flows (wave 8)

- A deployment that runs many ccrc servers may push flows into each one as **managed** flows: read-only there, labelled
  with their manager, versioned and pinned like any flow. The operator can copy one into a flow of their own unless the
  policy hook forbids it.
- They arrive through one new door with its own credential (not the operator's session, not the box token). It is a door
  like any other: it joins the door census, and `CoordStore` stays the one writer of the flow tables.
