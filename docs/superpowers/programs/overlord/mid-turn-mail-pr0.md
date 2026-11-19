# Overlord, mid-turn mail PR 0: task note

The note of PR 0 (Task 0.1) of `docs/superpowers/plans/2026-11-19-mid-turn-mail.md`, run 2746, wave 172. It records
what the pull request ships and where it departs from the plan, for the coordinator to fold into the programme ledger.
No D-number is defined here: departures are named by slug. The result itself is in `mid-turn-mail-e-rig.md`.

## What ships

- `server/test/delegation-rig/scenarios-overlord/ov-pretool-context.json`, the rig scenario.
- `docs/superpowers/programs/overlord/mid-turn-mail-e-rig.md`, the result: **yes** on 2.1.328, the fleet's build.
- This note.

No source file changes, so no listed file grows and `shared/api.ts`'s free lines are untouched.

## Departures and observations

| Slug | What | Why |
|---|---|---|
| `rig-ran-in-fleet-test-slice` | The rig ran on the fleet box, inside `ccrc test --local`'s test slice, in the rig's own isolation (a private tmux server, a fixture HOME, a mock API on loopback), as the W0 spike's scenarios did. The brief said the test box. | Remote test runs are off: `ccrc test --remote` answered `ran on: local (fallback: off)`. The run touched no live session, no fleet tmux server and no account, and spent nothing: the API is the mock. |
| `read-target-is-a-system-file` | The scenario's Read call reads `/etc/os-release`. | Claude Code's Read takes an absolute path, and the mock's entries take no `@RIG_…@` placeholders, so the fixture repo's path cannot be named. Nothing from the run is committed. |
| `emitter-logs-its-payload` | The hook command adds `--log-payload` to the plan's `emit-context.mjs` line. | Its log then shows each call's tool name, `prompt_id` and `agent_id`, which is how the note proves one turn on the main thread. The line's text is unchanged. |
| `four-builds-not-one` | The scenario ran on 2.1.327, 2.1.325 and 2.1.312 as well as 2.1.328. | Live sessions still ran those builds on the day until rolled. Each answered yes. |
| `context-is-a-system-message` | Observation, no departure: the line arrives as a `role: "system"` message right after the user message carrying the tool result, prefixed `PreToolUse:<tool> hook additional context: `, not inside the `tool_result` block. | Spec §7 asks whether the line arrives "with each tool result". It arrives directly after each one, which meets that. PR 5's fixed text is read after the prefix. |
| `requests-not-transcript` | The answer is read from the requests the mock received (`reqs/`), as the plan says, not from the transcript as spec §7 says. | The request is what the model is given. The plan governs (worker clause 6). |

## Checks run

- `rig.sh check-scenario` on the new file: exit 0.
- `server/test/delegation-rig-w0.test.ts`, which holds every committed `scenarios-overlord` file to `check-scenario`
  and to the `mainMarker` pin, and the delegation corpus bypass-free.
- The plan's "Every PR" guards, one file at a time, from `server/`, after `git fetch origin main`.
