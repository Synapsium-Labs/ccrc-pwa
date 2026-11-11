# The plan: epics, checkpoints and tickets

A programme declares its plan before its first wave opens. The plan is what ccrc keeps the Linear hierarchy from: each
**epic** is one plan-sized stage and lists the waves that run in it; each **checkpoint** is something that must be true
before the epic is done; each **ticket** is one unit of work, and every work run attaches to exactly one of them. You
change the plan only through `ccrc-api plan`; no session writes a Linear initiative, project or milestone.

A run is refused at `runs open` when the plan does not allow it:

- `plan-missing`: the programme has no epic and was created after the plan model landed, so it needs a plan. Declare it
  with `plan put` below, with `home`, then open the run again.
- `wave-epic-mismatch`: no live epic lists this wave, or the `ticket` you named belongs to another epic than the one that
  lists the wave. Revise the plan (`plan put`, or `plan ticket-move`) so the wave and the ticket share an epic.
- `ticket-unavailable`: the ticket you named is done, dropped, already started by another run, or an Upkeep ticket. Name
  another ticket, or open with none and the run gets a new one.
- `plan-closed`: the plan was ended with `plan close`; nothing opens under it.
- `reserved-programme`: `linear-sync` is ccrc's own and never a run's programme.

An older programme, one that existed before the plan model, opens as it always did, with no plan and no ticket.

## plan put

Declares or revises the whole plan as one body keyed by `key`. A new programme needs `home` (its home project) and may
carry a `title`. A key that disappears from the body is never deleted; an epic you cut is named again with `droppedWhy`.

```bash
"$API" plan put <slug> --json - <<JSON
{"home":"<home project>","epics":[
  {"key":"w1-capture","title":"W1 capture","summary":"what this stage is","waves":[1],
   "checkpoints":[{"key":"cohort-started","title":"Cohort started","kind":"measured"}],
   "tickets":[{"key":"w1-1","kind":"work","title":"Start the cohort","checkpoint":"cohort-started"}]}]}
JSON
```

`project` on an epic or a ticket is optional and defaults to the home project. A new ticket's key may not start `run-`:
that is how ccrc names the ticket of a run opened with none. Refusals: `not-plan-owner` (only the
programme's coordinator declares it), `plan-bad-body`, `plan-too-large` (at most 24 epics, 16 checkpoints in an epic and
200 tickets in a body), `waves-not-contiguous`, `wave-overlap`, `dropped-needs-reason`, `ticket-workspace-mismatch`,
`linear-text-public` and `plan-closed`.

## plan show

```bash
"$API" plan show <slug>
```

Reads the plan with each object's state and its Linear link. Any session may read it.

## plan met

Marks a checkpoint met, with exactly one piece of evidence: a pull request, an item or a repository path.

```bash
"$API" plan met <slug> --json - <<JSON
{"checkpoint":"cohort-started","evidence":{"pr":123}}
JSON
```

Refusals: `not-plan-owner`, `unknown-checkpoint`, `plan-bad-body` (a dropped checkpoint, or a key two epics share
with no `epic` named) and `linear-text-public` (a path).

## plan ticket-add

Adds a ticket to an epic (and optionally a checkpoint and a project). A worker may file a `follow-up` into its own run's
epic with this verb.

```bash
"$API" plan ticket-add <slug> --json - <<JSON
{"epic":"w1-capture","key":"w1-2","kind":"task","title":"Write the capture notes"}
JSON
```

Refusals: `not-plan-owner`, `unknown-epic`, `unknown-checkpoint`, `plan-bad-body`, `ticket-workspace-mismatch`,
`linear-text-public`, `plan-closed`.

## plan ticket-move

Moves a ticket to another epic, checkpoint or project, or drops it with a reason. A drop moves nothing. A ticket a run
holds (`started`, or attached to a run not yet dispatched) stays put until that run ends.

```bash
"$API" plan ticket-move <slug> --json - <<JSON
{"ticket":"w1-2","epic":"w2-evaluation"}
JSON
```

Refusals: `not-plan-owner`, `unknown-ticket`, `unknown-epic`, `unknown-checkpoint`, `plan-runs-open` (a run holds the
ticket), `plan-bad-body` (a done or dropped ticket), `dropped-needs-reason`, `ticket-workspace-mismatch`,
`linear-text-public` (the ticket's text judged by the project it moves to) and `plan-closed`.

## plan epic-drop

Drops an epic with a reason. An epic with a run holding one of its tickets (working, or opened and not yet
dispatched) is refused `plan-runs-open`.

```bash
"$API" plan epic-drop <slug> --json - <<JSON
{"epic":"w2-evaluation","why":"cut from scope"}
JSON
```

Refusals: `not-plan-owner`, `unknown-epic`, `dropped-needs-reason`, `plan-runs-open`, `linear-text-public` and
`plan-closed`.

## plan close

Ends the plan: `done`, or `abandoned` with a reason. This is the programme's explicit end; a wave gap or a failed last run
is never one. After it, `runs open` is refused `plan-closed`.

```bash
"$API" plan close <slug> --json - <<JSON
{"outcome":"done"}
JSON
```

Refusals: `not-plan-owner`, `plan-runs-open` (a run of the programme has not ended; close after it), `plan-closed` (the
plan was already closed), `plan-bad-body`, `dropped-needs-reason` and `linear-text-public` (the reason).

Every `plan` verb is refused `no-plan-door` by the client when the server is older than the plan verbs, and `unavailable`
when the box has no plan store.
