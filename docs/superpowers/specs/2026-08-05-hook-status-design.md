# Hook-reported agent status — Build 1 of the Orca imports

Approved 2026-08-05 by the operator (design presented and ratified in session;
transport approach A chosen over POST-per-event and CC-namespace variants).
Evidence base: `docs/superpowers/research/2026-08-05-orca-analysis.md` plus two
fleet probes run 2026-08-05 against the live host and this repo (facts below
marked MEASURED were verified on the box or in the tree that day).

## The problem, measured

ccrc infers "this session needs a human" from a 2-second tmux pane scrape
(`server/src/watch.ts` `detectDialogs` → `server/src/pane/dialog.ts`), and the
README's own "Pane-format fragility" section documents the cost: every Claude
Code upgrade can silently break dialog detection. Busy-ness comes from Claude
Code's live status file (`<CLAUDE_CONFIG_DIR>/sessions/<pid>.json`,
MEASURED: written and deleted by the CC binary itself, fields include
`status: idle|busy|shell|waiting`), with the pinned polarity that anything
but `idle` reads busy. There is no signal at all for "the agent asked a
question" beyond the scrape, none for permission prompts (auto-accept fleet),
and none for subagents.

Orca proves the alternative at scale: status from harness hooks, never from
terminal text, normalized to four states, with scrape ranked last. The traps
they already paid for (and we adopt): AskUserQuestion arrives as an
auto-allowed `PreToolUse`, not `PermissionRequest`; `/compact` emits no
`Stop` (`PreCompact`/`PostCompact` bracket it, and only manual `PostCompact`
is a turn boundary); a status rehydrated after downtime must not count as
fresh.

MEASURED fleet facts this design stands on:

1. Hook subprocesses on this fleet can self-identify completely:
   `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID` are in the environment,
   `CLAUDE_CONFIG_DIR` names the wrapper home (absent = `~/.claude`), and
   `tmux display-message -p '#S'` returns `cc-<ccd-id>` for every
   ccd-managed session (verified live: `cc-claude-ccrc-pwa` →
   `claude-ccrc-pwa`, present in the registry).
2. All 12 relevant hook event names exist as literals in every CC binary
   version live on the fleet (2.1.218–2.1.222). The target events
   (`UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse`,
   `PermissionRequest`, `SubagentStart`, `SubagentStop`, `PreCompact`,
   `PostCompact`) are configured NOWHERE today — net-new namespace. Existing
   hooks (`SessionStart`, `SessionEnd`) live in all four wrapper homes'
   `settings.json` and must be preserved by any installer.
3. The agent's read whitelist already covers `~/.cc-sessions/**` (and
   `readdir` is read-gated), writes remain `.cc-clips` only — a hook that
   writes into the registry directory ON the fleet host is a producer the
   server consumes over the existing read path. Zero whitelist changes.
   Precedent: `ccd/statusline-command.sh` publishing `~/.cc-limits/<acct>.json`
   via tmp+`mv -f`, consumed remotely; `pr-state` writing registry fields the
   server cannot write.
4. `~/.cc-sessions/` naming: registry suffixes are single-word fields keyed
   `<id>.<field>`; no `*.json`-suffixed per-session file exists there today.
   `notify.sh` is shipped by `deploy.sh agent` (scp + chmod, backed up per
   run) — the same lifecycle carries the new hook script.
5. Hook config is read at session start (operational consequence: running
   sessions adopt hooks on their next cycle; ccd already cycles sessions on
   swap and compact, so rollout is gradual and needs no forced restarts).

## Design

### H1 — the hook script (`ccd/session-hook.sh`)

One shared bash script for all four wrapper homes (statusline precedent),
deployed to `~/.cc-sessions/session-hook.sh` by the agent deploy. Invoked by
CC with the event payload on stdin. Behavior:

- **Fleet gate:** resolve the ccd id from tmux (`tmux display-message -p '#S'`
  when `$TMUX_PANE` is set; name must match `cc-<id>`); anything else —
  no tmux, foreign session name, `tmux` absent — exits 0 silently. A hook
  must never break or slow a non-fleet session.
- **Event → state mapping** (Orca's, adapted):
  - `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `PostCompact` with
    `trigger: auto`, and `PreToolUse` of any tool EXCEPT `AskUserQuestion`
    → `working`.
  - `PreToolUse` of `AskUserQuestion` → `waiting` with envelope
    `{ questions: <tool_input untruncated> }` (truncating corrupts options;
    cap the file, not the field — see size rule below).
  - `PermissionRequest` → `waiting` with envelope
    `{ approval: { tool, summary } }`, summary = first present of
    `command | file_path | path | url | pattern`, clipped to 200 chars.
  - `Stop` and `PostCompact` with `trigger: manual` → `done`, with
    `interrupted: true` when the payload says so.
  - Any event name the script does not recognize → exit 0, write nothing.
    (Orca additionally registers `StopFailure`/`PostToolUseFailure`; the
    2026-08-05 binary probe found neither literal in the fleet's CC
    versions, so v1 registers only MEASURED events. Plan-time task:
    re-verify the event list against the then-current binary before
    finalizing the installer's stanza.)
  - `SubagentStart` / `SubagentStop` → update the subagent set (name +
    startedAt), capped at 32; the session state itself is untouched.
- **The write:** `~/.cc-sessions/<id>.hookstate.json`, single JSON object,
  written atomically (`.tmp` then `mv -f`), whole file ≤ 64 KB (drop the
  `questions` envelope before dropping anything else if oversized — a
  truncated envelope is worse than none). Shape:

  ```json
  { "v": 1, "state": "working|waiting|done", "event": "<hook event>",
    "sessionId": "<CLAUDE_CODE_SESSION_ID>", "pid": <CLAUDE_PID>,
    "updatedAt": <epoch ms>, "interrupted": true?,
    "ask": { "questions": … } | { "approval": { "tool", "summary" } } | null,
    "subagents": [ { "name", "startedAt" } ] }
  ```

  `ask` is nulled on every transition to `working` or `done` (an answered
  question must not stay sticky); `subagents` persists across events (read
  current file, modify, write — the read failure mode is "start from
  empty", never a crash).
- **No `blocked` state in v1.** Orca separates `blocked`/`waiting`; nothing
  on this fleet produces a distinguishable `blocked` today. The `v` field
  exists so v2 can add it without archaeology.
- **Latency budget:** the script is on the hot path of every tool call. No
  network. One tmux call, one read, one write. Target < 50 ms; the tests
  time it.

### H2 — the installer (`ccd/install-session-hooks.sh`)

Idempotent, run by `deploy.sh agent` after shipping the script (same gated
lifecycle, backed up first):

- For each wrapper home (`~/.claude`, `~/.claude-personal`, `~/.claude-corp`,
  `~/.claude-gpt`): jq-merge the managed hook entries into
  `settings.json`'s `.hooks`, preserving every existing entry (MEASURED:
  SessionStart/SessionEnd hooks exist in all four and one home carries an
  extra cloneme entry — the installer must be provably non-destructive).
- **Managed-entry recognition is by script filename** (Orca's trick): any
  existing entry whose command contains `/session-hook.sh` is swept and
  replaced, so re-runs converge and stale paths from old installs cannot
  accumulate.
- Backup each `settings.json` to `~/ccrc-backups/<ts>/` before writing;
  write via tmp+`mv`; `jq empty` the result before the swap (a settings.json
  broken by the installer would break every future session of that home).
- Events registered: exactly the H1 list plus nothing. `PreToolUse` uses
  matcher `*`.

### H3 — registry lifecycle (ccd)

`hookstate.json` joins the per-session registry namespace, so ccd owns its
cleanup exactly like every other suffix:

- `_reg_purge`'s roster gains `hookstate.json` (reap/rm/retire leave no
  orphan).
- The registry FIELDS census in `server/test/ccd-workspaces.test.ts`
  updates in the same commit (the pinned list).
- ccd itself never reads the file (server-side concern only); no new verbs,
  no argv, no whitelist motion.

### H4 — server: ranked resolver + additive wire fields

New module `server/src/hookstate.ts` (reader + validator, livestate.ts's
sibling): `readHookState(io, registryDir, id)` → typed `HookState | null`,
null on missing/malformed/oversized. Freshness and authority rules, pinned
by tests:

- **Freshness:** a hookstate is live when `updatedAt` is within 30 minutes
  (Orca's constant) AND `sessionId` matches the registry's current `uuid`
  (a restart invalidates the old file the moment `_sync_uuid` advances —
  this is the `restoredUnconfirmed` idea done with existing plumbing).
- **Authority ranking for the new fields only:** fresh hookstate > nothing.
  The EXISTING `status` field keeps livestate as its sole authority —
  hook data never flips busy/idle in v1, so the pinned "unknown ⇒ busy"
  polarity and the interrupt route's semantics are untouched.
- `assembleFleet` gains three optional `FleetSession` fields, revived in the
  literal (compile tripwire) and added to every fixture:
  - `hookState: 'working' | 'waiting' | 'done' | null`
  - `askSummary: string | null` (one line: AskUserQuestion's first question
    header, or `approval: <tool> — <summary>`)
  - `subagents: { name: string; startedAt: number }[] | null`
- The full `ask` envelope travels on the per-session stream (a new
  `SessionStreamMsg` variant `{ type: 'ask', ask }` emitted on change, and
  cleared with `{ type: 'ask_cleared' }`), NOT on the fleet wire — the
  fleet line stays light; the sheet gets the payload only when open.
- **Scrape demotion, explicitly scoped:** `detectDialogs` keeps running
  unchanged (it is still the only source for sessions without hook data and
  the only renderer-grade parse of pane menus). When a fresh hookstate
  carries `ask`, the per-session stream prefers the envelope (source-tagged,
  Orca's priority idea: `hook > scrape`); `dialogPending` on the fleet wire
  becomes `dialogPending || (hookState === 'waiting')` — additive, never
  subtractive.

### H5 — PWA: minimal consumption

- `SessionLine`/`SessionHeader`: `hookState === 'waiting'` renders the
  existing attention treatment (same dot vocabulary — no new visual system
  in Build 1; buckets and two-glyph work are Build 2).
- `DialogSheet`: when the stream delivers an `ask` envelope, render its
  options/approval as the sheet's tappable content (numbered options send
  the digit; approval renders Allow/Deny sending `y`/`ESC`), falling back
  to today's scraped dialog when no envelope exists. Envelope content is
  source-tagged in the UI ("from hook" invisible to users; a `data-source`
  attr for tests).
- `subagents`: a count chip on the session card when non-empty (`⑂ 2`),
  nothing more in Build 1.

## Global constraints (bind every task)

- **Zero new agent whitelist grants; zero new argv surfaces; zero new
  network paths.** The hook writes locally as the user; the server reads
  via the existing agent `read` op.
- **The hook script must be harmless everywhere:** non-fleet sessions,
  missing tmux, unreadable registry, full disk — every failure path exits 0
  and writes nothing partial (tmp+`mv` only). It never blocks: no network,
  no locks, no waiting.
- **`status` semantics are frozen.** Hook data adds fields; it never
  changes busy/idle/dead derivation, `archiveSafety`, or the interrupt
  route's authority in v1.
- **Additive wire evolution:** new `FleetSession` fields are optional-null,
  revived in the literal, present in every fixture; an old PWA against a
  new server must keep working (and vice versa — absent fields revive to
  null).
- **Installer is provably non-destructive:** existing hook entries survive
  byte-identical; `jq empty` gates every write; backups precede writes.
- **Tests under fixture HOME only**, ccd-style, including the hook script
  (fake `tmux` shell function, stdin payloads, fixture registry). Suites
  stay green at current counts plus new.

## Cut from Build 1 (deliberate)

- **Buckets, watermarks, push changes, notification copy** — Build 2.
- **`blocked` as a distinct state** — nothing produces it here yet; `v`
  field reserves the slot.
- **Transcript-first conversation rendering** — separate effort (the AI
  Vault-shaped work); the ask envelope covers the interactive case that
  matters now.
- **`Notification` hook** — Orca doesn't register it for Claude either; the
  events above cover the states.
- **Hook-driven busy/idle** — livestate is already authoritative and
  CC-owned; replacing it buys nothing and risks the polarity.

## Testing strategy

TDD throughout, existing idioms. Load-bearing fixtures:

1. Hook script: every event → expected file content (including the
   AskUserQuestion-as-PreToolUse trap, PostCompact auto vs manual, the
   ask-clearing rule, subagent set add/remove/cap, oversize-envelope drop);
   non-fleet invocations write nothing; a corrupt existing file is
   overwritten not crashed on; timing budget asserted (< 50 ms p95 over 20
   runs in the harness).
2. Installer: fixture homes with the MEASURED real-world settings.json
   shapes (including the cloneme extra) — merge preserves them exactly;
   re-run converges; a filename-matched stale entry is swept; broken-JSON
   settings refuses (non-zero, file untouched).
3. Resolver: freshness window, uuid mismatch → null, malformed → null,
   `dialogPending` OR-rule, wire fields null for hookless sessions;
   revive round-trips (null vs populated).
4. Stream: ask envelope emit/clear ordering against the existing
   `nextDialogFrame` gate (no double-delivery with scraped dialogs).
5. PWA: DialogSheet envelope-vs-scrape preference, digit/y/ESC sends,
   subagent chip, waiting-dot.
6. ccd: `_reg_purge` removes `hookstate.json`; FIELDS census updated.

## Rollout

Ship agent-side first (script + installer via `deploy.sh agent` — inert
until sessions cycle), then server+PWA (reads null until files appear).
Both orders are safe; this one means no reader ever sees a writer it
doesn't understand. Sessions adopt hooks on their natural swap/compact
cycles; no forced restarts. The five-proof deploy verification applies,
plus one new proof: after one session cycles, its `hookstate.json` exists
and the fleet wire carries `hookState` for it.
