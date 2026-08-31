# Subagent preview + ticket-named workspaces

**Date:** 2026-08-31
**Deviation series:** allocate from D-1123 (origin/main high-water is D-1122 —
`docs/superpowers/plans/2026-08-30-program-leverage-wave4-f4.md:821-891`, with D-1120/D-1121 already
carried in `pwa/src/fleet/StartProgramSheet.tsx:515,:779`). Confirm with a fresh grep at allocation
time; a working tree behind `origin/main` reports a stale floor.

Two features, one plan, because they share nothing but a sheet and it is worth saying so:

- **A — a preview of what each subagent is doing** ("as in Orca").
- **B — name a workspace, or start it from a Linear ticket.**

## Operator decisions (2026-08-31, locked)

1. **Account:** the sheet SHOWS where the workspace will land; it does not offer a choice. `ccd ws-add`
   takes no account (`_ws_least_loaded` decides, `ccd/ccd:3707`, seeded `:3787`); `ccd swap` moves it
   afterwards and is already whitelisted and already in the UI.
2. **Linear:** the full API arm — fetch the issue title.
3. **Subagent preview:** a fleet-wide strip.
4. **Name format:** `[TICKET] - {Linear title}`.
5. **A named workspace is exempt from the ai-title sweep.**

## The one structural fact that shapes everything

Two different ccd verbs mint sessions, and only one of them can be named:

| path | verb | account | nameable |
|---|---|---|---|
| NewSessionSheet (account → project) | `ccd start\|enable <wrapper> <project> [workdir]` | **chosen** | **no** — `cmd_start` (`ccd/ccd:12117`) has no slug concept and silently ignores a 4th positional |
| ProjectCard `+` | `ccd ws-add <project> [slug]` | auto | **yes** — `ccd/ccd:3687` binds `slug="${2:-}"` |

So "after I choose account, name it" cannot be one flow without a ccd change. Decision 1 resolves it:
naming lives on the `ws-add` path, and the account becomes a stated fact rather than a question.

### `[TICKET] - {Linear title}` is two strings, not one

`_ws_slug_valid` is `^[a-z0-9][a-z0-9-]{1,30}$` (`ccd/ccd:3403`) — lowercase, no spaces, 2..31 chars.
The reasons are mechanical: no dots (`tmux -t` parses `session:window.pane`), no slashes (systemd
instance escaping), lowercase only (case-insensitive filesystems). So one ticket yields:

- **slug** `eng-1234-fix-the-login-flow` — directory, id `<project>-<slug>` (`ccd/ccd:3781`), branch
  `ws/<slug>`, tmux `cc-<id>`, unit `claude-session@<id>`. **Immutable for life** (no verb renames a
  slug; `cmd_ws_rename` moves a git ref and one registry field).
- **title** `ENG-1234 - Fix the login flow` — what the board shows.

This split is what makes long ticket names work. Measured against your own Orca tree:
`HEL-691-exhibitor-profile-floating-edit-button-overlaps-the-content-at-the-end` is 78 chars. It cuts
to slug `hel-691-exhibitor-profile` and keeps the full sentence as the title.

## What is already true (so the plan does not re-buy it)

- `cmd_ws_add` already accepts an operator slug, validates it, and refuses a collision **before** any
  worktree, branch, registry row or pane exists, inside the per-project `flock` (`ccd/ccd:3730-3744`).
- The agent's exec grant `['ws-add']` is a **one-token prefix** and `isExecAllowed` leaves trailing
  tokens unconstrained (`agent/src/whitelist.ts:323`, `:665`). A slug crosses the wire today with **no
  whitelist change**. `ws-add` is absent from `REQUIRED_VERB_FLAG` (`:240-242`).
- Flag injection is structurally impossible: `cmd_ws_add`'s strip loop matches `--no-rc/--surface/--actor`
  in any position, but every accepted slug begins `[a-z0-9]` by construction, so it can never spell a
  flag. ccd makes the same argument for `--no-rc` at `ccd/ccd:3635`.
- `agent_id` is a **required** field on `SubagentStart`/`SubagentStop` in the shipped binary (2.1.251).
- Claude Code already writes `~/.claude/projects/<munge>/<uuid>/subagents/agent-<agent_id>.meta.json`
  — a ~137-byte launch record `{agentType, description, toolUseId, parentAgentId, spawnDepth}`.
  Measured: 1320 on this box. Already inside the agent's read whitelist via `underClaudeGlob`
  (`agent/src/whitelist.ts:84-89`) — **no whitelist change**.
- `PreToolUse` **is** installed (`ccd/install-session-hooks.sh:91`, separately from `EVENTS_JSON`
  because it alone carries `matcher:"*"`).
- The Linear API: `https://api.linear.app/graphql`; a personal key goes in `Authorization: <key>` with
  **no** `Bearer` prefix (only OAuth uses `Bearer`); `issue(id: "ENG-1234")` accepts the human identifier.

## Two live defects this plan closes on the way

1. **The `⑂ N` disclosure shows a wall of identical strings.** The hook's name ladder
   (`.agent_name // .subagent_name // .agent_type // "subagent"`) resolves to the agent TYPE — the first
   two keys are not in the schema. Measured live: `ccrc-pwa-calm-summit` carries
   `["workflow-subagent" ×5]`. The count is real; the names carry no information.
2. **`SubagentStop` retires the wrong row.** `del(.[ (map(.name)|index($n)) // empty ])` deletes the
   FIRST name match, i.e. the oldest. With concurrent same-typed subagents — the ordinary case, per (1)
   — the surviving row's `startedAt` belongs to the one that finished.

## What stays unsourceable

Per-subagent **working / blocked / waiting**. The `SubagentStart` schema is `{agent_id, agent_type}`;
the launch record has no status field; a subagent's own AskUserQuestion surfaces as the PARENT's `ask`
because the hook identifies the session by tmux window name. Orca's literal ask
(`docs/superpowers/research/2026-08-05-orca-analysis.md:195-198`) is **not** delivered, and the existing
refusal — the comment at `SessionLine.tsx:437-447` and the pin at `pwa/test/session-line.test.tsx:385-391`
— survives this plan. Re-proposing per-child state is a spec amendment, not a task.

The strip therefore says *"what each session's hooks last reported"*, never *"running now"*:
`hookUpdatedAt` is a `sessionBucket` parameter, not a `FleetSession` field, so freshness cannot be claimed.

---

## Stages

Ordered so each ships alone and is useful alone. `[AGENT-FIRST]` = ccd to the fleet host **before** the
server (`bash deploy/deploy.sh agent <host>`).

### Feature A — the preview

**A1 — the hook keeps the subagent's id, and lets go of a dead one** `[AGENT-FIRST]`
`ccd/session-hook.sh` only. Read `agent_id` alongside the name in ONE jq call so the fork count on the
hot path is unchanged. Start appends `{name, id, startedAt}`, still `| .[-32:]`. Stop deletes by `id`,
falling back to name when absent. The `SessionStart` arm clears the set for every `source` except
`compact` — it must sit BELOW the `[[ "$src" == compact ]] && exit 0` guard.
No new `case` arm, so `EVENTS_JSON` and its derived-set test are untouched.
Ships alone: both revivers build literals from `name`/`startedAt` and ignore an extra key.
*Red-first:* `server/test/session-hook.test.ts` — (1) two starts, same type, different ids, stop the
second → the survivor is the FIRST (RED today); (2) `SessionStart source:'resume'` → `subagents === []`
(RED today); (3) `source:'compact'` → the set SURVIVES and `updatedAt` did not move.
The 64KB write cap (`:167-172`, whose failure mode is exit 0 with NO WRITE) and the p95<150ms pin
(`:223-232`) both stay green.

**A2 — PROBE the join before building on it** `[gate, not a stage]`
Nothing in the tree proves the hook's `agent_id` equals the sidecar filename id — the hook discards it
today, so no capture exists. It is very likely (the binary builds `subagents/agent-` from the same id
space) but A3 is worthless if it is wrong. After A1 lands, read ONE live `~/.cc-sessions/<id>.hookstate.json`
and confirm an `id` matches an `agent-<id>.meta.json` on disk. **Do not start A3 until this is measured.**

**A3 — the server reads the launch record**
New `server/src/subagents.ts`: `sidecarDirFor(resolvedTranscriptPath)` (strip `.jsonl`, append
`/subagents`, derived from the RESOLVER's winning path — never re-munged, because a rung-5/6 winner
lives under another account's configDir) and `readLaunchRecord`, a ≤4KB read. **Never** touches the
sidecar `.jsonl` (p50 857KB, max 48MB; `tail.ts:6-10` records what reading transcripts whole cost once).
`sweepSubagentLaunches` beside `sweepHookStates`. Positive entries cached for process life — a launch
record cannot change — so steady state is zero reads and a dropped read never blanks a description
already on screen. Bounded LRU 512 (`resolve.ts:366`'s shape). `SubagentEntry` gains
`description: string | null`, always emitted. `agentId` deliberately does NOT go on the wire.
No `FLEET_PROTO` bump.
**Judge-mandated correction:** `readLaunchRecord` returns **two** arms, not three. `FleetIO.stat`/`readFile`
fold every failure to one null, so `absent` is a distinction the port cannot produce — fabricating it is
the mirror of the collapse CLAUDE.md's open-issues section already names. Either collapse to
`found | unmeasured` with a docstring saying why, or earn `absent` from a real directory listing.
*Red-first:* `server/test/subagent-launches.test.ts` — path derivation; end-to-end into an assembled
session; **the cache** (two sweeps → ONE io read); **retain-don't-erase** (a later failed read leaves the
description on the wire).

**A4 — the row says what the subagent is doing**
`pwa/src/fleet/SessionLine.tsx`, three edits, **no CSS**. The primary cell renders
`sa.description ?? sa.name`; `title` carries both. `useNow(30_000, subagentsOpen)` so an open
disclosure's clock moves and a closed one starts no timer. Rewrite the two comments that currently
assert the opposite — they were true and are no longer.
The existing `expect(row.children).toHaveLength(2)` pin stays **GREEN**: this adds a fact, not a cell.
UI stage → `fleet ui` green + a FRESH blind `ui-verifier`.

**A5 — the fleet-wide strip** (decision 3)
`pwa/src/fleet/SubagentsStrip.tsx`, HotFilesStrip's shape: a collapsed headline
`⑂ 5 subagents · 2 sessions` expanding to groups per session with indented rows. Renders **nothing**
when no live session has one. Filter is `s.bucket !== 'dead' && s.subagents !== null && s.subagents.length > 0`
— never a hoisted boolean, because `null` (no hook data) and `[]` (a measurement of zero) are different
facts. Both controls join `pwa/test/tap-targets.test.tsx`'s loop.
**Sequenced after A3 deliberately:** built today its rows would read `workflow-subagent` five times.
*Red-first:* a dead session's subagents are never listed.

### Feature B — the name

**B1 — ccd records that a human chose the name, and what to call it** `[AGENT-FIRST]`
`cmd_ws_add`: add `--title <text>` to the existing flag-strip loop, mirroring `--actor` exactly
(same arity check, same `_lc_dec_ok` length bound, same blank refusal). Set `named=1` inside the
existing `[[ -n "$slug" ]]` arm at `ccd/ccd:3742` — **there**, because after `:3745` `$slug` is non-empty
either way and the distinction is gone. Write `named` and `title` with the other `_reg_set` calls.
*Red-first:* in a FIXTURE HOME (never the live `$HOME`) — `ws-add demo eng-1234` leaves `.named`=1;
`ws-add demo` leaves none (RED if the write is hoisted past `:3745` — D-410's shape one line over).
`ccd-lifecycle-sites.test.ts`'s four argv forms stay byte-identical.

**B2 — the name sweep leaves a human's name alone** (decision 5)
`server/src/registry.ts`: `SessionRecord.namedByOperator`, from `fieldMeasured(…, 'named')`.
Measured-absent → false; measured-empty → false; **LISTED-but-unreadable → TRUE**. Doubt reads as
NAMED — the cost of guessing wrong is a model typing over a human's name — citing `watch.ts:1473`'s
identical ruling for `held`.
`server/src/watch.ts`: one clause on `sweepNames`'s twelfth condition at `:1475`, beside `held` (already
read) and before the `openRunsForSession` query.
**Must land before B5**, or the first named workspace is renamed within ~10s of its first turn. Ships
alone and is immediately useful: it protects workspaces created by hand with `ccd ws-add demo eng-1234`
today.
*Red-first:* two rows in one sweep, one named → exactly ONE `ws-rename`, naming the auto row (RED today:
both are renamed). Plus the doubt arm.

**B3 — the slug rule, once**
`server/src/naming.ts`: export `slugifyWords` and `fitSlug`, extracted verbatim out of `deriveBranch`,
which keeps calling them with `SLUG_MAX = 40` and behaves identically. **`SLUG_MAX` is a BRANCH budget —
do not reuse 40 for a slug.** New `server/src/slug.ts` (L1, imports only naming.ts): `parseLinearRef` and
`deriveWorkspaceSlug` returning `auto | named | refused(reason)`. Budget 31, floor 2 (ccd's undocumented
floor: `{1,30}` applies to the SECOND class, so a 1-char slug is refused and no test covers it), trailing
`-` stripped AFTER truncation. Refusal reasons are a `Record<Reason, string>` with the runtime list
DERIVED via the `PR_REASONS` `Object.keys` idiom.
*Red-first:* the parse table with **each refusal reason asserted separately** — a test that only checks
"it failed" stays green through exactly the overloaded-null this repo bans. Plus **the parity pin**:
every produced slug matched against the regex READ OUT OF `ccd/ccd:3403` at test time
(`wsaudit.test.ts:53-63`'s idiom), so a ccd grammar change reds this suite instead of shipping slugs the
box refuses. Plus a text-scan pinning `slug in use: ` and `invalid slug '` as literal substrings of ccd.

**B4 — Linear resolution** (decision 2)
New `server/src/linear.ts` (L3 adapter behind an L2 port the route declares). POST to
`https://api.linear.app/graphql`, `Authorization: <token>` **without** `Bearer`, query
`issue(id:"ENG-1234"){identifier title}`. **Carries an AbortSignal with an explicit deadline** — the
repo's convention is `PR_GH_TIMEOUT=8` on every `gh` call; the one in-process `fetch`
(`server/src/server.ts:1089`, Hetzner) has no timeout and is the exception, not the model. Without one a
Linear outage wedges a Fastify request the phone is waiting on.
Config: `CCRC_LINEAR_TOKEN` as a nullable field beside `hetznerToken` (`server/src/config.ts:329`), read
with `??`, plus a documented empty key in `deploy/ccrc.env.example`.
**Absence-permits, and this is the load-bearing arm:** no token → the offline parse still works
(`ENG-1234` → `eng-1234`; a Linear URL's own trailing title slug → `eng-1234-fix-the-login-flow`).
A resolution failure NEVER blocks the create — it degrades to the offline name. Distinct, non-collapsed
failure conditions: not-configured / unauthorised / not-found / timeout / malformed.
**Why the server box and not the fleet box:** the agent's deps are `node-pty` and `ws` — it has zero
outbound HTTP capability — and `EXEC_COMMANDS` is closed to `tmux`/`ccd`, so a `curl` grant is precisely
what `agent/src/whitelist.ts:309-315` forbids. The server is the only place this can live.
**Why an env var and not a token file:** the mail token is a FILE because two boxes and a shell script
share it, which is what buys the ~230 lines of `coord/token.ts`. This is read by one process, so it rides
the `CCRC_HETZNER_TOKEN` lane — a nullable config field, not a new boot-refusal class.
*Red-first:* the header is `Authorization: <token>` with no `Bearer` (RED if anyone "fixes" it); a
timeout degrades to the offline name and still creates; each failure condition maps to its own arm.
`server/test/topology-clean.test.ts` will red on a real Linear workspace slug or issue URL in any
fixture — use invented placeholder vocabulary.

**B5 — the slug crosses the seam**
`server/src/ccdargv.ts`: a **new `wsAddNamed` key**, never a widened `wsAdd`. This is mechanism, not
taste: `whitelist-subset.test.ts:78-80`'s `Object.keys` equality and `EXPECTED`'s
`Record<keyof typeof CCD_ARGV, string[]>` both fail on a new key and **neither fails on a widened
optional** — a widened `wsAdd` would hide the second argv shape from the enumeration.
Route: absent/non-string/empty → today's exact `CCD_ARGV.wsAdd(project)` and today's exact response;
`refused` → 400 `{ok:false,error:'bad-slug',reason}` with **no argv built**; `named` → composed from
`deps.runCcd` directly so stderr can be classified — `slug in use: ` → 409, `invalid slug '` → 400,
everything else → 502 unchanged.
**A blank field must OMIT the token, never emit `''`.** `['ws-add','demo','']` reaches `ccd:3742-3745`,
fails `[[ -n "$slug" ]]`, passes `[[ -z "$slug" ]]`, draws a random adjective-noun and exits 0 — so
`runCcdOr502` answers **200 for a workspace nobody named**. Use `...(slug ? [slug] : [])`, the shape
`CCD_ARGV.start` already uses for `wd`.
*Red-first:* `{slug:'ENG-1234'}` → 400 **AND `calls` is EMPTY** (the second assertion is what catches a
mutant that builds the argv and lets ccd refuse); `{slug:''}` → `['ws-add','demo']`; a 409 for
`slug in use:`; the existing bodyless assertions stay green **unchanged** — that is the additivity proof.

**B6 — the title reaches the board**
`SessionRecord.title` from the registry `title` field; `FleetSession.title: string | null`;
`sessionLabel` gains a first rung: `title ?? name ?? branch ?? workspace ?? id`. Additive, absence-permits,
no proto bump.
*Rejected alternative:* a `coord.db` table. coord.db is Build-7 coordination, a workspace title is not;
and CLAUDE.md states the flat files are ground truth and a lost coord.db reconstructs from them. A title
in the registry survives that; a title in coord.db does not.

**B7 — the sheet** (decision 1)
New `pwa/src/fleet/NewWorkspaceSheet.tsx`, mounted at SCREEN level in FleetScreen beside the other three
sheets (board-hosted, never inside ProjectCard — answering flips the card). Top to bottom: a `.sheet-copy`
line stating where it lands (`Lands on team·alt — 62% free.`, reusing the two degraded arms
`ProjectCard.tsx:158-164` already words); one `.proj-search` input, `aria-label="Name or Linear ticket"`,
`autoCapitalize="off" autoCorrect="off" spellCheck={false}`; a live `→ <project>-<slug>` preview; a
single-line helper cleared on the first keystroke; the narrating confirm.
**No `autoFocus`** — the auto-name path stays two thumb taps with no keyboard.
The client derivation renders the label and disables the button only; it **never rewrites the field**, and
it imports the SAME function the server validates with.
*Red-first:* tapping `+` calls NOTHING (RED today — `FleetScreen.tsx:139` creates on tap); empty + Add →
the byte-identical request today's `+` sends; a pasted URL → the button's accessible name carries the
derived slug; garbage → confirm disabled and `workspaceAdd` NOT called; **a 409 keeps the sheet OPEN with
the field intact**; the close-reset test must reject the create or drive `rerender` — vaul unmounts the
portal at `open={false}`, so a close-then-query test stays GREEN with the reset deleted
(`lifecycle-ui.test.tsx:295-306`).

---

## Deviations found

*(Allocate real numbers from `POST /api/ledger/deviations` at implementation time; the floor above is a
starting point, not an allocation.)*

- **D-1123** — `install-session-hooks.sh:37`'s `EVENTS_JSON` does not list `PreToolUse`, but `:91`
  installs it separately because it alone carries `matcher:"*"`. Two independent research passes read
  `:37` as the complete installed set and concluded the hook cannot see a Task launch. The list and the
  install are one fact in two places; only the derived-set test keeps them honest, and it does not cover
  the `PreToolUse` arm.
- **D-1124** — `FleetSession.subagents[].name` is documented as a subagent's name but is always its TYPE:
  the ladder's first two keys (`agent_name`, `subagent_name`) are not in the shipped schema. Measured:
  five identical `workflow-subagent` rows in one live session.
- **D-1125** — `SubagentStop` retires the oldest same-named row, not the one that stopped
  (`del(.[ (map(.name)|index($n)) // empty ])`), while `agent_id` — a required schema field that would
  make the pairing exact — is discarded at `session-hook.sh:138`.
- **D-1126** — the subagent set survives a process restart: `SessionStart` reads the prior set back and
  writes it forward. Measured: rows aged 4037 and 3814 minutes on a `SessionStart` write.
- **D-1127** — `_ws_slug_valid`'s `{1,30}` applies to the second character class, so a 1-character slug is
  refused. Undocumented and untested (`ccd-workspaces.test.ts:76-80` stops at leading-dash, uppercase and
  length-32). The regex also PERMITS a trailing `-`.
- **D-1128** — `_ws_slug_new` returns rc 1 for three distinct conditions (invalid `CCD_WS_SLUG`, taken
  `CCD_WS_SLUG`, 60 exhausted draws) and `cmd_ws_add` reports all three as one string. An overloaded seam
  in ccd itself; out of scope here, recorded because this plan reads that path.

## Rejected

- **A per-subagent working/blocked/waiting glyph** — the literal Orca line. Unsourceable; see above.
- **`CCD_WS_SLUG` as the transport** — dead twice: honoured only when the positional is empty, and it
  cannot cross the exec seam at all (`Runner = (cmd, args)`, no env; `ExecReq` is `{cmd,args,timeoutMs}`).
  It would also report the SERVER process's own environment identically for every caller.
- **Narrowing the grant to `['ws-add','--slug']`** — a new grant shape, a ccd parse change and an
  AGENT-FIRST deploy, to buy nothing: the positional form is already the tested operator path.
- **A silent `-2` collision ladder** — one ticket maps deterministically to one slug, so a second
  workspace for the same ticket collides *by design*. Auto-suffixing quietly produces two workspaces for
  one ticket, which is the thing a deterministic slug existed to prevent. Answer 409 and echo ccd's own
  refusal, which names the exact files to reclaim.
- **Reading the description out of the transcript** — a 256KB fold to recover what a 137-byte file the
  read whitelist already covers already holds, with no join key to the hook's count.

## Open question

`+` becoming a sheet costs a tap on the auto-name path (`+` → `Add a workspace to demo`, both in the
thumb zone). Recommended anyway: it is the only irreversible create on that screen with no confirmation,
the slug is chosen for life, and it is the only place the account projection can be a sentence rather
than a `title` attribute a phone never renders. Say if you'd rather keep the one-tap `+` and put the
naming door elsewhere.
