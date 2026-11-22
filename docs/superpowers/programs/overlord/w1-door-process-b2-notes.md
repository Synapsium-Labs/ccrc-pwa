# Overlord W1, door process B2: notes for the ledger

What door process B2 found while building, for the coordinator to fold into the programme ledger. B2 is Task 8 of plan
`docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`: the model events, report-only, and the reader and
typed-model arms. Each departure is named by a plain-words slug; no number is taken here.

## What shipped

- `PreModelSwitch` and `PostModelSwitch` join `shared/hook-events.ts#HOOK_EVENTS` and the installer's `EVENTS_JSON`. The hook
  has two new case arms:
  - `PostModelSwitch` sends one `model-switch` report, `how: 'switched'`, for every session the start report covers: the main
    thread, a registry row, not a child (plan question 11).
  - `PreModelSwitch` refuses nothing and sends nothing.
  - Both exit inside the case block, before every writer (ruled F11 and F14).
- A typed `/model` in a session with a door is blocked on the prompt path. The hook prints the prompt event's block answer and
  reports `how: 'typed-refused'`, which is never drift. It then exits, so a refused prompt writes no hook state and no turn
  marker.
- Three PreToolUse arms, placed just before the D-6798 fan-out arm:
  - **Reader scope:** a reader's door call other than `mcp__door__read` is denied. A reader is a call with a recorded join or
    an `agent_type`.
  - **Three readers:** a fourth main-thread `Agent` or `Task` call in a session with a door is denied.
  - **Reader model:** under the pin, an `Agent` or `Task` call that names another model is denied.
- `ccd/lib/launch-profiles.json` is regenerated: the Overlord's row registers the hook on the two new events, so its digest
  moves.
- The build capture's drive types `/model haiku` before the first turn and waits for both events. The coordinator's ruling
  (mail 30766) made B2 carry this, and the capture holder said yes (mail 30775). So every new Claude Code build now proves the
  model-switch payload before it is trusted.

## Departures

- **`model-switch-how-is-the-l0-vocabulary`**: the plan names `how` as `typed`, `automatic` or `unknown`, and the refusal as
  `typed-refused`. B1 already fixed the wire in `shared/continuity-reports.ts#MODEL_SWITCH_HOWS` as `switched` or
  `typed-refused`, so `PostModelSwitch` sends `switched`. The payload does not tell a typed switch from an automatic one in
  what W0-12 measured, so a `typed`/`automatic` split would have been a guess.
- **`report-sender-defined-above-the-case`**: B1's sender, `_hook_door_report`, and `REPORT_TIMEOUT_S` move, unchanged, to
  just above the main case block. The model arms exit there, before the point where B1 defined them. No second sender exists.
- **`typed-model-exits-before-every-writer`**: the plan says the prompt is blocked and reported. A blocked prompt opens no
  turn and gets no Stop, so the arm also exits before the hook state, the turn marker and the spools. Otherwise the session
  would read `working` until its next event.
- **`model-events-skip-the-hookcap-arm-and-the-start-resend`** (review 3317 F1 and F4, the coordinator's ruling: both are
  writers F11 and F14 meant the model events and a refused prompt to skip). They exit before the `-hookcap` capture arm, so a
  measuring session copies no model-event payload and no refused prompt to `~/.ccrc/hook-capture/<id>/`; the arm's comment
  now names them. A refused typed `/model` also skips that prompt's start-report resend pass; the next prompt or event retries
  it, so nothing is lost. The real payloads stay unmeasured here.
- **`model-report-covers-the-start-reports-ids`** (review 3317 F3): the model report applies the start report's own id test
  (`^[A-Za-z0-9_-]+$`, `_hook_start_report`) beside its generation-marker and child tests, so it admits no id the start report
  refuses (the hook itself admits a dot). Its trigger (PostModelSwitch, any session with a row, door or not) and its
  no-child policy are unchanged, and the start report's arm is not widened. A fixture case pins the two to the same answer for
  a dotted id and a plain one.
- **`prompt-block-has-a-builder`** (review 3317 F6; the plan's "the hook's builders gain" a UserPromptSubmit envelope): the
  block answer is built by `_hook_prompt_block_json`, beside the PreToolUse builders. It is printed from the typed `/model`
  arm itself, which then exits, not from the PreToolUse print site at the file's end, because a refused prompt reaches no
  later line.
- **`reader-scope-keys-on-the-tool-not-the-door`**: the scope arm keys on the tool name (`mcp__door__*`) and the reader facts,
  not on `CCRC_DOOR_NONCE_SHA256`, since only a session with a door serves those tools. The three-reader arm and the typed
  `/model` arm do key on the door hash, as the plan says.
- **`reader-arms-before-the-fan-out-arm`**: the arms sit just before the D-6798 fan-out arm. Sandbox PR B's surface arm sits
  after the role-skill deny (D-4934) block instead (agreed with run 3294, mails 30780 and 30787), so the two hunks stay apart.
  Deny precedence (review 3317 F7): the reader arms run only when no earlier arm has denied, and the later arms (the D-6798
  fan-out arm, the mail hold) also run only when no deny stands. So the first deny wins: the reader arm's reason is the one
  printed unless an earlier arm denied the call. The call is denied either way.
- **`model-names-printable-ascii`**: the hook sends a model name as printable ASCII only, cut to `REPORT_MODEL_MAX`, and an
  empty result as null. The report door's narrowing counts UTF-16 units, so ASCII keeps the two counts equal. Model ids are
  ASCII.
- **`capture-drive-proves-the-model-events`** (the coordinator's ruling, mail 30766): `CAPTURE_EVENTS = HOOK_EVENTS` stays.
  The model events are not carved out.
  - `shared/claudeBuildCapture.ts#HOOK_EVENT_RULES` gains a row for each event, with `from_model` and `to_model` as `present`.
    W0-12 recorded the two fields but not their JSON type.
  - `agent/src/testbox/capture.ts#CAPTURE_STEPS` gains the `/model haiku` step before any turn, so no cache dialog opens
    (W0-12).
  - The runner's fake build raises both events on a typed `/model`, with a broken variant (patch 995) that never raises
    `PostModelSwitch`.
  - The capture decider's "never recorded" case iterates `CAPTURE_EVENTS`, so it gains `PreModelSwitch` and `PostModelSwitch`
    rows with no new code. The runner gains a case for the broken build.
  - Capture PR 3 lowers the step budget so the extra step fits its deadline pin (its mail 30775).
- **`readme-event-list`**: README's hook section lists the registered events, so it needs the two names. README is held by run
  1850's landing work, so this went as one packet (mail 30835), and run 1850's coordinator said yes to that exact hunk
  (mail 30850, packet sha256 `2b3f8c36dec4e383906a909b38fb3934a13a1fe41b34958096ffb209fae0b16c`, checked before applying).

## Residuals (stated, not hidden)

- **Three readers** (plan question 10):
  - The roster `subs` is rewritten whole and loses writes under load (D-5232), so a lost start lets a fourth reader through.
  - One message with four `Agent` calls passes, because every PreToolUse runs before any SubagentStart.
  - "In the background" is not enforced.
- **Reader model:** under the pin, Claude Code drops the `model` field (W0-11), so the arm acts only where the pin did not
  engage (slug `reader-model-arm-kept-as-a-belt`). It compares names as text, so an equivalent spelling is denied: the alias
  `sonnet` pinned and a call naming the full model id (review 3317 F5, a known limit).
- **Reader scope, `agent_type` alone:** a main-thread payload that carried an `agent_type` would have every door write but
  `read` denied. No build is known to send one, and no test covers it (review 3317's whole-branch pass).
- **Typed `/model`:** if the pinned build does not pass a built-in command through UserPromptSubmit, nothing is refused there.
  The switch is still reported by `PostModelSwitch`, and drift is a hard renewal trigger.
- **ccd's own `/model`:** the route apply's `/model` keystroke in a session with a door would be refused the same way, if it
  reaches UserPromptSubmit. A long-lived role's `/model` is not adopted anyway (`_operator_choice_keep`), and the Overlord's
  class comes from the designation at each start.

## Live steps

- **Task 8 Step 5** (whether a typed `/model` reaches UserPromptSubmit, and what `PostModelSwitch` carries for a typed and an
  automatic switch): **unmeasured here, and it carries**, as A2's and B1's live steps did.
  - The test box was not reachable from this run.
  - The W0 rig drives a real Claude Code under tmux, which this run did not start.
  - What does change: once the capture runner captures a build, the new drive step records both payloads for every new
    build. Its recording of the `/model` step also shows whether UserPromptSubmit fired, which answers the first half.

## Sequencing (ruled F13)

B2 changes the Overlord's launch row, so a running Overlord reads `launch-profile-unmet` from this merge until its next start.
B2 should land before the operator's first designation. If an Overlord already runs, it needs a renewal once B2 is on the
fleet (the pull request says so).

## Measurements

- **Growth**, armed (`growth-check.test.ts`, 97/97): `ccd/session-hook.sh` measures +32 by the check's own `codeLines`
  (3264 to 3296), under the cap of 40. The first build measured +37 (review 3317 F8; this note said +27, a hand count of
  non-comment lines). The measurer reads a `<<_` inside a jq string near the deny arms as an unclosed heredoc, so every line
  after it counts, comments included; fix round 1 shortened the reader arms' comment there and moved its residuals here.
  `ccd/install-session-hooks.sh` and the capture files are not growth-checked. `shared/api.ts` is untouched.
- **Hand mutations**, each red, each restored from a saved copy, sha-checked equal: 20 in all, 19 killed (review 3317 F8
  corrected the first count, 18 with 17 killed, which this note had given as 16 of 17). Fix round 2 adds one more, killed:
  21 in all, 20 killed.
  - In the hook, all killed:
    - `PostModelSwitch`'s exit dropped;
    - `PreModelSwitch` made to report;
    - the scope arm's join test dropped, its `agent_type` test dropped, and `read` no longer exempt;
    - the reader bound moved to four, and its door check dropped;
    - the reader model's compare dropped, and its pin check dropped;
    - the typed `/model`'s door check dropped, its word boundary dropped, and its exit dropped;
    - the model report's main-thread and child gate dropped;
    - the model name's control-character strip dropped;
    - fix round 1: the model report's start-report id test dropped, and the prompt builder's `block` word changed.
  - In the installer: the two events dropped from `EVENTS_JSON`. Killed.
  - In `HOOK_EVENTS`: `PostModelSwitch` dropped. Killed.
  - In the capture drive: the step removed. Killed.
  - **One survivor**, the drive step waiting for `PreModelSwitch` only. It is verdict-equivalent: the replay still fails a
    build that never records `PostModelSwitch` and names it. Waiting for both only keeps a late `PostModelSwitch` from landing
    after the next step began, where it would still be recorded.
- **Suites**, one file at a time through `ccrc test`, all green:
  - the new `session-hook-model-events` (19 cases at the first build, 21 after fix round 1) and `session-hook-reader-arms`
    (10);
  - `session-hook-door-reports`, `session-hook-steer`, `install-session-hooks`, `launch-profiles-file`,
    `continuity-launch-profile`, `ccd-launch-surface`, `ccd-launch-surface-moves`, `ccd-launch-profile`, `ccd-door-spawn`,
    `ccd-long-lived`, `ccd-auto-compact`;
  - `claude-build-capture`, `testbox-capture-transport`, `testbox-contract`, `stall-vocabulary`, `collect-lane-l0`,
    `peers-claims-l0`, `ccrc-doctor-codex-host`;
  - the agent's `testbox-capture-runner`, `-desk`, `-record` and `-stub`;
  - every `single-definition/*` and `rings/*` file. Five of them were SIGKILLed in the test slice at load 17 and passed alone.
  - The server and agent type checks are clean.
- **Edits to existing tests:**
  - `session-hook-door-reports`' reader-witness case now calls `read` for its two readers, since the scope arm denies a reader
    any other door tool.
  - `install-session-hooks`' registered-events case lists fourteen events.
  - `sim/launchProfileSets.ts`' pinned hook list gains the two events.
  - Fix round 2 (the merge queue's `test (agent)`, red on one case): `testbox-capture-deadline`'s case "the target leaves
    room for one more typed step than the drive has (door B2's step)" came to `main` with capture PR 3a (#3198), after this
    branch was cut. It adds a `/model haiku` step to the drive; with B2's step already in the drive, that counted B2's step
    twice (917000 ms against the 900000 ms deadline). The case now says the drive carries B2's step exactly once and still
    fits: that step is what its room was kept for. It is not loosened: the fit is the same arithmetic over the drive as it now stands. Removing
    the drive step turns it red (measured, restored from a saved copy, sha-checked). The file had no live claim. I claimed it
    (6575) and absorbed `origin/HEAD` once, because the queue run was red on a test `main` passes.

## The review judge's `rules-mixed` (review 3317 F2)

The judge blocks on `rules-mixed` for `ccd/session-hook.sh` and `ccd/install-session-hooks.sh`. The coupling is held by tests
in both directions:
- `install-session-hooks.test.ts` derives the hook's handled set from its case arms and holds the installer's list and
  `HOOK_EVENTS` to it (D-306, D-8613).
- `launch-profiles-file.test.ts` holds the Overlord's row to `HOOK_EVENTS`.
- `CAPTURE_EVENTS = HOOK_EVENTS`, so the capture rules and drive step must land with the events (the coordinator's ruling,
  mail 30766, call 250).

A rules-only pull request would still change `shared/hook-events.ts`, and a split in either order turns a required check
red. This PR is not split, and no gate setting changes. The documented resolutions on `main` that keep a coupled change
whole are:
- `docs/superpowers/programs/linear-hierarchy.md`, 2026-11-19: #3088 was not split because the judge is not a required
  check, and #3151 "stayed whole although the review judge flags rules-mixed, because a pin test cannot leave the rules
  file it pins without turning a required check red".
- `docs/superpowers/programs/model-class-advance.md`, item 522: a coupled installer change the owner was asked to accept.
- Door A2 and mid-turn mail PR 6 carried the same code on the same hook.

The other two blocking codes (`code-owner-approval-needed`, `proof-not-built`) are covered by standing rulings.

