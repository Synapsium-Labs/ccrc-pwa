# The Overlord's load path under the pinned profile, measured (W1 sandbox, Task 1)

**In short.** The plan's launch (`w1-sandbox.md`, Task 1) was run in the W0 rig on the two Claude Code builds the fleet
runs most, **2.1.325** (10 accounts) and **2.1.323** (2), read from each account config's `.last-update-result.json` as
W0b did. Both builds behaved the same on every row. The linked skill and the linked `CLAUDE.md` load; a `CLAUDE.md` above
the workspace and a `.claude/rules` file load too; no bypass dialog shows with the acceptance in `--settings`; an
account's enabled plugin does not load under the pinned source. Three findings change what the hook can read: a resume
writes no start attachment at all, the door's tools are offered directly (so `deferred_tools_delta` and
`mcp_instructions_delta` are never written), and the transcript records the offered tool list, with each tool's server,
in a `prompt_snapshot` attachment. The coordinator ruled on those three (§4), and PR A builds the rulings.

## 1. How it was run

Three scenarios in `server/test/delegation-rig/scenarios-overlord/`, and one control:

| Scenario | What it launches | Steps |
|---|---|---|
| `ov-sandbox` | the Overlord's launch: `--setting-sources project`, a `--settings` profile file (every deny word, ccrc's hook on every event, the status line, `skipDangerousModePermissionPrompt: true`), `--strict-mcp-config` with the door stub, `--tools Agent,Skill`, `--agents` with one reader type, `--dangerously-skip-permissions`, and the env pin. The repository's `.claude/skills/ccrc-overlord` is a link to a staged skill under the fixture `~/.cc-sessions`, and its `CLAUDE.md` a link to a constitution file there. A `.claude/rules` file in the workspace, a `CLAUDE.md` in the directory above it, an account skill, and a foreign SessionStart hook that fails | a turn that calls `Skill`, `/clear` and a turn, `/compact` and a turn, `/exit`, `--resume`, a turn, `/exit` |
| `ov-sandbox-rc` | the same, with `--remote-control w0-rc` | one turn |
| `ov-sandbox-plugin` | the same, over an account config with one enabled plugin (a skill, a command, an agent, a SessionStart and PreToolUse hook, a tool server) | one turn |
| `ov-sandbox-plugin-control` | the plugin launch with no pinned source (so the account settings load), the control for M8 | one turn |

A new stub, `stubs/transcript-snap.mjs`, registered on SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop and
SessionEnd, copied the transcript at each event and indexed its attachment kinds, so each row below says which event
first saw what. The rig gained `launch.files` entries that are links (`link`, held under the run root) and files under
the run root (`in: "root"`), and `--remote-control` on its flag list. The fixtures
`server/test/fixtures/start-loads/transcript-<build>-startup.jsonl` (the first session, to its `/clear`) and
`-resume.jsonl` (the session `/clear` began: its start, its compaction, its resume and the turn after) are those
transcripts, redacted: the run root reads `/rig`, the stub directory `/rig-stubs`, and Claude Code's own prompt text,
request bodies, tool and agent descriptions, the environment snapshot and the git status read `<redacted>`. Every entry and
every key the start-loads reader uses is kept. The private-name scan over the four files is clean.

## 2. The answers

| Row | Answer (both builds) |
|---|---|
| **M1** | The linked skill is listed (`skill_listing` names `ccrc-overlord`), and a `Skill` call loads its body (the next request carries it). The account skill is not listed. **Links work; ccd links.** |
| **M2** | The linked `CLAUDE.md` reaches the first request, and `instructions` names it at its link path (`<workspace>/CLAUDE.md`, type `Project`) with the target's content. It is written again before the first request after `/clear` and after `/compact`. **The pinned launch also loads a `.claude/rules` file in the workspace and a `CLAUDE.md` in a directory above it**, each listed in `instructions` (type `Project`) and present in every request. Task 6's refusal of both stands. |
| **M3** | With `skipDangerousModePermissionPrompt: true` in the `--settings` value, a config that never accepted the bypass shows **no dialog** at the first start or at the resume; the footer reads "bypass permissions on". W0 measured the dialog without it (results note, the first-launch row). **The profile carries the acceptance; no operator precondition; ccd's acceptor stays as a second guard.** |
| **M4** | Detailed in §3. In short: the start attachments are written just before the first request (after the start's SessionStart hook attachments and the user's prompt), the first-request marker is the `api-request` entry with `querySource: "repl_main_thread"`, a compaction boundary is a `system` entry with `subtype: "compact_boundary"`, a failing SessionStart hook writes `hook_non_blocking_error` with its `command`, a hook that succeeds silently writes nothing, a **resume writes no start attachment**, and the transcript lags the hooks. |
| **M5** | Claude Code's own lists under the profile, against the mock: agent types `Explore`, `Plan`, `general-purpose` (the `agent_listing_delta` attachment names them itself, in `builtInTypes`); skills `claude-api`, `code-review`, `dataviz`, `fewer-permission-prompts`, `init`, `keybindings-help`, `loop`, `plugin-authoring`, `run`, `security-review`, `simplify`, `update-config`. Filled into `CLAUDE_CODE_OWN_LISTS` for both builds. **Caveat:** the mock has no account behind it, and a live session on 2.1.325 on this box lists more unprefixed bundled skills (`schedule` and three `artifact-*` skills), which an account's features appear to gate. A live start would read `skills` failed on those names until the lists carry them; a live read of the lists (W0b's kind) is owed before PR B relies on them. |
| **M6** | `--remote-control` changes nothing the hook can read: the same attachments, the same payload keys, no new environment name (the rig's sessions bill an API key, so Remote Control cannot attach against the mock). **The `remote-control` property reads `CCRC_LAUNCH_RC`** (slug `remote-control-read-from-the-spawn-record`). A real account's attached session may record more; unmeasured here. |
| **M7** | The door's tools are **offered directly, not deferred**: every main request lists `Agent`, `Skill`, `mcp__door__act`, `mcp__door__card`, `mcp__door__read` and a `DeferredToolPlaceholder`. Neither `deferred_tools_delta` nor `mcp_instructions_delta` is ever written (the stub serves no instructions). The tool list is recorded: a `prompt_snapshot` attachment written after the first response carries `tools`, each with `name` and, for a server's tool, `server`. |
| **M8** | **The pinned launch does not load the account's enabled plugin**: no skill, command, agent, hook run or request text of it, on either build. The control, the same plugin with no pinned source, loads its skill, its command (listed as a skill, `rig-plugin:w0-plugin-cmd`), its agent and its SessionStart hook; its tool server stays out under `--strict-mcp-config` in both. For the operator, beside doctor's `overlord-mods` check: a plugin is not a pinned launch's problem today, on these two builds. |

## 3. M4 in detail: what each start writes, and when the hook can see it

The order at a `startup` and at a `/clear` start (a new transcript file each time):

1. the SessionStart hooks' attachments: `hook_non_blocking_error` for the failing foreign hook, `hook_success` for ccrc's
   (which prints context), `hook_additional_context`. The snap stub, which prints nothing, wrote none: **a hook that
   succeeds silently leaves no attachment**;
2. the user's prompt;
3. `environment`, `model`, `agent_listing_delta` (`isInitial: true`), `skill_listing` (`isInitial: true`),
   `instructions`, `session_context`, `date`, a `prompt_snapshot` with no `tools`;
4. `api-request-shape`, `api-request-blob` entries, then **`api-request` (`querySource: "repl_main_thread"`): the first-request
   marker**;
5. the response, then a `prompt_snapshot` **with** `tools` (after the first response; before the second request when the
   turn used a tool).

At a **`compact`** start: the `compact_boundary` entry, the summary, then `agent_listing_delta` and `skill_listing` again
(both `isInitial: true`), `environment`, `model`, the SessionStart hooks' attachments, and before the next request
`instructions` again. So the fold of the listing kinds reads forward from the newest `compact_boundary` (or the head), and
can find that boundary by reading back from the tail.

At a **`resume`** start: **nothing**. No hook attachment for `SessionStart:resume`, no `instructions`, no listing, no
`prompt_snapshot`; only the request entries, the prompt and the response. The session still sends the constitution in
every request (the mock's dumps show it).

**The lag.** The transcript is written behind the hooks. At the first `startup` SessionStart the file does not exist yet;
at PreToolUse it held one entry; at the `Stop` of a one-request turn after `/clear` it held neither that turn's request
nor its response; the start attachments of the `startup` turn, which used a tool, were present at its `Stop`. So the
first `Stop` can lack the marker, and the plan's rule (count a try, keep the file, compute at the first `Stop` whose
window holds the marker) is what makes the report land; the tool-bearing `prompt_snapshot` lags one step further.

What this selects for Task 4, inside the plan's table (tightening only):

| Kind | Read |
|---|---|
| `instructions` | the window (from the recorded offset to the marker) |
| `skill_listing` | the window; at a resume, the newest before it (measured: a resume does not write it) |
| `agent_listing_delta` | the fold from the newest `compact_boundary` or the head to the window's end; `isInitial: true` starts it again |
| `prompt_snapshot` (`tools`, ruled) | the first tool-bearing one after the marker; `toolServers` from its tools' `server` (the delta kinds are left out when nothing is deferred, so they are not read) |
| `hook_success` | the window; `hook_non_blocking_error`, the failing hook's kind, read beside it, each by its `command` |

## 4. Ruled by the coordinator (2026-11-15), and built in PR A

1. **A resume writes no start attachment** (slug `resume-carries-its-own-start`). At a `resume`, `instructions` and
   `hooks` are carried from the newest reported `startup` of the same transcript, and only when that start's report
   recorded the same profile digest and the same Claude Code build (the hook keeps both in `$REG/<id>.loadlast`, written
   on that report's 202) and the transcript is within the read bound. The resume still sends its own report, with its
   own digest, build and every kind it measured, and names the start it carried from in `carriedFrom`. With no such
   start, or any mismatch, both kinds read `unmeasured`. **Residual:** a linked file whose content is edited between the
   start and the resume is not seen, since the carry reads the start's list and the hook hashes each file where it
   stands. And a resume writes no `prompt_snapshot` either, so its `tools` and `toolServers` read `unmeasured`; a resumed
   Overlord stays not engaged until a fresh start, as the plan's question 5 already says of a changed row.
2. **Tools from the prompt snapshot** (slug `tools-read-from-the-prompt-snapshot`). The kind `tools` is the names of the
   first tool-bearing `prompt_snapshot` after the marker, and `toolServers` the servers its tools name. The report waits
   for that snapshot; on the hook's last try (or once a second request marker shows none came) it goes out with both
   kinds `unmeasured`, never empty. The deferred-tools reading is dropped from the table.
3. **The own lists are a rig lower bound** (slug `own-lists-are-a-rig-lower-bound`). Recorded here (M5) and beside
   `CLAUDE_CODE_OWN_LISTS`; nothing in PR A judges against them, and the live read is a Needs-first of PR B, which the
   coordinator carries.
4. **A silent foreign SessionStart hook is invisible** to the `hooks` property; doctor's `overlord-mods` check (PR A2) is
   what sees it.
