# Routing slice 4 — the writers: dispatch and operator spawns seed the record, pickers write it with `--apply`, the supervise tick applies it, and the coordinator row is the operator-spawn default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every session gets its routing record at the moment it is created — a dispatched worker from the wave's brief (on the `ws-add` argv for wave 1, through the `route` verb before the `/clear` for wave N ≥ 2), an operator-started session from the new-session sheet or, unflagged, from the coordinator row — and a picker tap on the phone becomes a record write that ccd applies on its own supervise tick with the session-only keystrokes slice 1 measured, so no routing keystroke has two writers and every routing decision is attributable. Continuous attribution (spec §6) begins: the record at dispatch is the arm.

**Architecture:** Three ccd verbs (`ws-add`, `start`, `enable`) take a repeatable `--route <field>=<value>` flag, parsed by the same strip-then-bind loop `--surface`/`--actor` use, validated by `_route_argv_check` BEFORE anything is minted (a bad value dies with nothing touched), written after the row's `uuid` and before `_spawn_start` so the first spawn composes the record, and journaled as `route` rows with the verb's own actor. `ws-add` places by the EFFECTIVE class — the `--route class=` value, or the coordinator row's `fable` for an operator spawn — through `_place_for_class` (`_ws_least_loaded project class`, one rung down when every in-pool lane was measured unservable at the class, `degraded` stamped after the mint — the placement half slice 3 deferred; the `cmd_ws_add` refusal reason gains its `_class_gate` arm, D-2854's obligation). An unflagged OPERATOR spawn landing on an Anthropic lane gets the coordinator row (`class=fable effort=ultracode subagent=sonnet workflow=on`); a dispatched worker (`--no-rc`) without `--route` gets NO row — today's behaviour, which is what an old server that cannot send routing must keep getting. `cmd_route --apply` writes the fields and then asks the compactor's idle predicate, extracted into two helpers the compactor now calls in its own order (`_pane_for_keystroke`, `_idle_for_keystroke`); when it holds, ccd types the SESSION-ONLY sequences measured in slice 1 (`/effort` → `Left`×7 → `Right`×N → `s`, with Opus 5's `Change effort level?` dialog confirmed; `/model` → the cursor moved to the target row read off the picker itself → `s`; `ultracode` plain, session-only by construction), confirms by reading the acknowledgement line back off the pane, and records what it confirmed in `$REG/<id>.routeapplied`; otherwise `_route_apply_check`, beside `_auto_compact_check` on every live tick, retries and records each refusal in its OWN field (`routeskip`, `routenote`, never `compactskip`). The server builds every argv through `CCD_ARGV` (new `--route` arguments on the spawn builders, `--apply` and the actor flags on the route builder), gates each on its own caps token (`route-argv-v1`, `route-apply-v1`; absent → omitted and journaled, the `actor-flags-v1` shape), and gains one session-gated door, `POST /api/sessions/:id/route`, that the PWA's pickers call instead of typing. The pickers show "queued" until the pane read-back (`FleetSession.effort`/`model`/`ultracode`, already on the wire) agrees. Two probes open the slice: `--model <alias>` on a non-Anthropic lane (S1-R10) and `{"enableWorkflows":false}` (S1-R12), plus the `/model` picker's rows and cursor behaviour on a Fable-entitled lane and on the codex lane (what the driver reads).

**Tech Stack:** bash (`ccd/ccd`), TypeScript (`server/src/ccdargv.ts`, `server/src/coord/dispatch.ts`, `server/src/coord/routes.ts`, `server/src/server.ts`, `server/src/limits.ts`, `pwa/src/lib/{models,api}.ts`, `pwa/src/screens/SessionScreen.tsx`, `pwa/src/fleet/{NewSessionSheet,ProjectCard}.tsx`, `ccd/ccrc-api`), vitest, tmux, Claude Code 2.1.270's `/effort` and `/model` pickers.

**Spec:** `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md` — §5.2 (levers: class live, effort, the `/model` persistence hazard), §5.3 (every writer: dispatch wave 1 and N ≥ 2, operator spawn, live change from the PWA, the verb's `--apply`, the supervise tick, `routeskip`, the audit trail, "typers: exactly one writer"), §4 (operator-started sessions are coordinators; the coordinator row), §7 slice 4, §8 rows 3, 5, 6, 7. Slices 0–3 are on this branch; the record, its validator, the `route` verb and act (slice 1), the serviceability clause, `degraded`, `_class_gate`, `_class_below`, `_route_degrade`/`_route_restore` (slice 3) are what this slice writes through.

## Global Constraints

- **The record is the arbiter; ccd is the one typer.** No route in `server/src` types `/effort` or `/model` after this slice: the pickers' `api.prompt(id, '/effort …')` path is REPLACED, not kept beside the new door (spec §5.3 "Typers"). `sendPrompt` still types the operator's own text, the dispatch `/clear` and mail nudges; a test scans `pwa/src` and `server/src` for a string literal beginning `/effort` or `/model` and fails on one.
- **Session-only keystrokes only, measured.** Every level except `ultracode` is typed through the picker's session-only form (`s`), never as a plain `/effort <level>` (D-2810: the plain form writes the LANE's `settings.json`). `ultracode` is typed plain (session-only by construction, D-2810). A class is typed through the bare `/model` picker — cursor to the target row, then `s` — never `/model <alias>` (D-2811: it writes the lane's top-level `model`). Inside the `/model` picker ←/→ move EFFORT — the driver uses Up/Down only, and the row it moves to is READ off the picker's own capture, never a constant. `auto` and `workflow` have no live lever: `effort=auto` applies by ABSENCE at the next settle (nothing composed; the live level stands until then) and is recorded applied when written; `workflow` applies at the next settle (Task 1 measures the false key) — the tick types nothing for either, and `routeapplied` says so.
- **The idle predicate is ONE predicate, in TWO helpers, and the compactor's order is preserved byte for byte.** `_pane_for_keystroke id` (the 8-row capture: `pane-unreadable`, `pane-blank`, `auto-continue`) and `_idle_for_keystroke id pane ctxnote` (`mid-turn`, `no-prompt`, `no-pane-pid`, `status-unreadable`, `not-idle`, `quiet-unmeasured`, `not-quiet`, `drafting`) are extracted FROM `_auto_compact_check`, which calls the first, keeps its own `no-ctx-segment`/threshold/`post-swap` checks inline between them, then calls the second — so a below-threshold mid-turn pane still records nothing, exactly as D-2013 argued. The compactor's note words, their order and their detail sentences do not change (`ccd-auto-compact.test.ts` pins them, including `(no status in <path>, ctx 88%)`).
- **Refusals live in their own field**: `$REG/<id>.routeskip` (`<epoch> <reason>`) with a `routenote` floor, the `_compact_note` shape, and NEVER `compactskip` — `_compact_note_clear` unlinks `compactskip` on every below-threshold tick and would erase a routing refusal (spec §5.3, §8 row 7).
- **A bad `--route` value refuses before any side effect** — the worktree, the registry row and the pane must not exist when the verb dies; the refusal names the field and the byte count, never the bytes (slice 1's rule).
- **A dispatched worker without routing gets no row** (`--no-rc` and no `--route`): byte-identical to today's dispatch — the old-server compatibility spec §5.3 requires. The coordinator row is written ONLY for operator spawns (`start`/`enable`, and `ws-add` without `--no-rc`) that LAND on an Anthropic lane; on a non-Anthropic lane the default row is what Task 1's probe rules (until measured: none).
- **Caps tokens, one per capability** (`/^[a-z][a-z0-9-]*$/`, `cmd_caps` `echo`, `KNOWN_CAPABILITY_TOKENS` in `ccd-archive.test.ts`, `caps-token-shape`): `route-argv-v1` (the three spawn verbs accept `--route`) and `route-apply-v1` (`route` accepts `--apply`; `--actor`/`--reason` already exist on the verb — the token names the apply). The server omits what a box does not advertise and journals the omission (`capSupported`, false on no evidence).
- **Every argv through `CCD_ARGV`** (`whitelist-subset.test.ts` enumerates it); the grants `['route','--session']`, `['ws-add']`, `['start']`, `['enable']` already exist — no new grant, and `gh` gets none.
- **Two conditions a caller handles differently never collapse**: an omitted routing (no token) is journaled apart from a refused one (ccd died); `queued` in the PWA is distinct from `applied` and from `refused`.
- **Every commit that edits `ccd/ccd` re-stamps its provenance marker first** — `node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"` from the repo root — then `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts`.
- **AGENT-FIRST**; **FIXTURE HOMEs only** (the probes run on a PRIVATE tmux server, `tmux -L routeprobe`, against scratch `CLAUDE_CONFIG_DIR`s, credentials sourced with `set -a; . <file>; set +a` and never printed); suites from inside the package, foreground, `timeout ≥ 600000`; **D-numbers are issued** (the controller mints and defines them; a subagent that finds a departure writes `D-TBD-<slug>` in its report and never touches this file); **no account names** in shipped source; **never touch the live fleet's tmux, `~/.cc-sessions`, `~/.cc-limits` or units by hand** — Task 8's gate writes through the SHIPPED verb on the controller's own session only.

---

## File structure

| File | Responsibility |
|---|---|
| `ccd/ccd` | `--route` on `cmd_ws_add`/`cmd_start` (`cmd_enable` forwards), `_route_argv_check`, `_route_argv_write`, `ROUTE_COORDINATOR_ROW`, `_route_seed_default`, `_place_for_class`, the refusal reason's `_class_gate` arm; `cmd_route --apply`, `_pane_for_keystroke`, `_idle_for_keystroke`, `_route_apply_check`, `_route_note`/`_route_note_clear`, `_route_type_effort`, `_route_type_model`, `_route_picker_rows`, `_route_ack_wait`, `_route_apply_now`, `_route_applied_set`, the settle's `routeapplied` write; `cmd_caps` prints `route-argv-v1` and `route-apply-v1` |
| `server/src/ccdargv.ts` | `routeFlags()`, `start`/`enable`/`wsAdd`/`wsAddWorker` take `route`, `route(id, field, value, dec)` takes the actor flags, `routeApply(...)`, `ROUTE_ARGV_CAP`, `ROUTE_APPLY_CAP` |
| `shared/api.ts` | `ROUTE_WRITABLE_FIELDS`, `RouteField`, `RouteFields`, `parseRouteFields()` (shape only), `ProjectPlacement`'s `none` arm gains `class?` |
| `server/src/coord/dispatch.ts` | `dispatchRun(…, route)`: wave 1 on the argv, wave N ≥ 2 through the verb before `/clear`, omission journaled |
| `server/src/coord/routes.ts` | `POST /api/runs/:id/dispatch` body `route?` |
| `server/src/server.ts` | `POST /api/sessions` and `/api/projects/:project/workspaces` body `route?`; `POST /api/sessions/:id/route` (session-gated, `ROUTE_APPLY_CAP`); `GET /api/projects?class=` |
| `server/src/limits.ts` | `projectPlacement(roster, limits, pool, cls, shares, nowS)` — the trailing three defaulted, the `none` arm carries `class` |
| `pwa/src/lib/api.ts` | `api.route(id, field, value)`; `createSession`/`workspaceAdd` carry `route?`; `projects(cls?)` |
| `pwa/src/lib/models.ts` | `PickOption.route: {field, value}` replaces `command` |
| `pwa/src/screens/SessionScreen.tsx` | pickers write the record; `queued` until read-back |
| `pwa/src/fleet/NewSessionSheet.tsx` | optional class/effort/workflows row at step 2 |
| `pwa/src/fleet/ProjectCard.tsx` | the `none` copy names the class when the placement carries one |
| `ccd/ccrc-api` | `[runs.signals]` row (D-2842's carry) and the two count words |
| tests | new: `ccd-route-argv.test.ts`, `ccd-place-class.test.ts`, `ccd-route-apply.test.ts`, `ccd-route-tick.test.ts`, `dispatch-route.test.ts`, `sessions-route-body.test.ts`, `sessions-route-route.test.ts`, `no-routing-keystroke-from-server.test.ts`, `projects-route-class.test.ts`; touched: `ccd-archive.test.ts`, `ccrc-api.test.ts`, `ccrc-api-closed.test.ts`, `coordinator-skill.test.ts`, `projected-home.test.ts`; pwa: `models.test.ts`, `session-pickers.test.tsx` (new), `new-session-sheet.test.tsx`, `project-card.test.tsx` (existing or new — read `pwa/test` first) |
| `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` | §6 rows for Task 1's probes and Task 8's gate |

---

### Task 1: The probes — `--model <alias>` on a non-Anthropic lane, `{"enableWorkflows":false}`, the `/model` picker's rows and cursor on a Fable-entitled lane and on the codex lane

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` §6 (three rows)
- No source changes.

**Interfaces:**
- Consumes: `~/.local/bin/claude` (2.1.270; the fleet's launcher picks per-account versions — read `fleet-claude-version-lanes` in memory if it is there, else `cat ~/.local/bin/claude | head -40`), ONE Fable-entitled Anthropic lane's OAuth env file and the codex lane's env file (`ls ~/.cc-secrets/ | grep -- '-oauth.env$'`; never print one), scratch `CLAUDE_CONFIG_DIR`s under the session scratchpad, `tmux -L routeprobe`.
- Produces three answers Tasks 2, 4 and 5 branch on: (1) what `--model opus`/`--model sonnet`/`--model haiku`/`--model fable` do on the codex lane (the statusline's `🤖` model, the transcript's `model` field, or a refusal) — S1-R10; (2) whether `--settings '{"enableWorkflows":false}'` is honoured (`/config`'s workflows row; `/effort ultracode` refused with "Ultracode needs dynamic workflows enabled") — S1-R12; (3) the bare `/model` picker: its rows in order on a Fable-entitled Anthropic lane (is `Fable` listed?) and on the codex lane (what labels?), WHICH ROW THE CURSOR STARTS ON when the current model is not the default (launch with `--model opus`, open the picker, read the `❯` row), and whether `Up` on row 1 wraps to the last row — the two facts `_route_type_model` (Task 4) is built on.

- [ ] **Step 1: Scratch dirs and the private server.** Everything lives under the session scratchpad (the directory the harness names in its environment block), never inside the checkout:

```bash
S="${CLAUDE_SCRATCHPAD:?set this to the session scratchpad path from the environment block}/route-probe-4"
mkdir -p "$S/cfg-plain" "$S/cfg-codex"
printf '%s\n' '{"effortLevel":"xhigh"}' > "$S/cfg-plain/settings.json"
printf '%s\n' '{"effortLevel":"xhigh"}' > "$S/cfg-codex/settings.json"
ls ~/.cc-secrets/ | grep -- '-oauth.env$'          # pick the lane files by NAME; never cat one
```

Each arm runs as

```bash
set -a; . ~/.cc-secrets/<lane>-oauth.env; set +a
tmux -L routeprobe new-session -d -s probe -x 200 -y 50 \
  "cd '$S' && exec env CLAUDE_CONFIG_DIR='$S/<cfg dir>' <launcher> <flags> --dangerously-skip-permissions"
sleep 20; tmux -L routeprobe capture-pane -t probe -p | tail -5     # wait for the ❯ prompt
```

and ends with `tmux -L routeprobe kill-server`. Every `capture-pane` output is saved under `$S/arm-<n>-<step>.txt`; a settings file is diffed before and after each arm (`cp settings.json before.json` … `diff`). Keystrokes go through `tmux -L routeprobe send-keys -t probe -l '<text>'` then `send-keys -t probe Enter`; picker keys (`Up`, `Down`, `Left`, `Right`, `Escape`, `s`) as their tmux key names.

- [ ] **Step 2: Arm 1 — the alias on the codex lane.** Read `ccd/ccgpt` (or the wrapper `~/.local/bin/ccgpt` on the fleet host) to find which env file it sources and which launcher/binary it execs; source that file; launch on the private server with `CLAUDE_CONFIG_DIR=$S/cfg-codex` and `--model opus`; capture the first 20 lines (a refusal shows here), send `Reply ok` + Enter, wait, capture the statusline's `🤖` segment, then read the newest transcript under `$S/cfg-codex/projects/*/` and take the last `assistant` line's `model`. Repeat for `sonnet`, `haiku`, `fable`, and a control with no `--model`. Record the five models observed.

- [ ] **Step 3: Arm 2 — the false key.** On the Anthropic lane with `CLAUDE_CONFIG_DIR=$S/cfg-plain`, launch with `--settings '{"enableWorkflows":false}'`; `/config` + Enter, capture the workflows row; Escape; `/effort ultracode` + Enter, capture the answer (expected "Ultracode needs dynamic workflows enabled" if the key is honoured); kill. Control: the same with `true` (expect ultracode accepted).

- [ ] **Step 4: Arm 3 — the picker rows and the cursor.** D-2808's row already measured the picker on an OPUS 5 session with the default selected: `1. Default (recommended) ✔`, `2. Sonnet`, `3. Opus`, `4. Haiku`, `Down`×2 + `s` → `Set model to Opus 5 for this session only`. Measure what it did not: (a) on the Fable-entitled Anthropic lane, launched with `--model fable`: `/model` + Enter, capture the list verbatim (is `Fable` a row? which number?), and which row carries the `❯` cursor at open (the current model's row, or row 1?); press `Up` once from wherever it opened until row 1, then `Up` once more and capture: did it wrap to the last row or stay? Escape. (b) The same launched with `--model opus` (cursor start row when the current model is Opus). (c) The same on the codex lane (`CLAUDE_CONFIG_DIR=$S/cfg-codex`): the rows, their labels, the cursor. For one arm, move the cursor to a non-current row and press `s`: capture the acknowledgement line verbatim (the `Set model to <Name> for this session only` shape) and diff the settings file (must be byte-identical).

- [ ] **Step 5: Record and decide.** Three §6 rows in the research doc, verbatim strings, each opening `**measured 2026-09-15**, Claude Code <version>, private server …`. Then the decisions, which the CONTROLLER records as deviations (one per decision; the implementer writes `D-TBD-<slug>` in the report, never a number):
  - **Non-Anthropic class alias (S1-R10):** honoured and mapped (the model changes as `--model` says) → Task 2's `_route_seed_default` writes the coordinator row on non-Anthropic lanes too and `_spawn_start`'s S1-R10 comment is rewritten as measured; ignored or refused → non-Anthropic lanes get NO default row, `_spawn_start` composes no `--model` there (a `case` on `_is_anthropic_backend`), and the research row says spec §5.2's "applies" sentence is false for that lane.
  - **`{"enableWorkflows":false}` (S1-R12):** honoured → `_spawn_start` composes it for `workflow=off` and clears the `inert=workflow` stamp; not honoured → the stamp stays and the row says so.
  - **The `/model` picker:** whether `fable` is reachable from the picker at all (if not, a live class change TO fable is a relaunch, recorded — `_route_type_model` records `no-picker-row`); whether the cursor starts on the current row (then `_route_type_model` MUST read the cursor row — the design Task 4 already assumes) and whether `Up` wraps (if it wraps, "pin at row 1 with `Up`×N" is unsafe and the delta method is the only one).

- [ ] **Step 6: Commit** — `docs(research): slice 4 probes — the alias on a codex lane, the false workflows key, the /model picker rows and cursor (routing slice 4, Task 1)`.

---

### Task 2: `--route` on `ws-add`, `start` and `enable`; placement by class; the coordinator row; the caps token

**Files:**
- Modify: `ccd/ccd` (`cmd_ws_add`, `cmd_start`, `cmd_enable`, new helpers beside `cmd_route`, `cmd_caps`), `server/test/ccd-archive.test.ts` (`KNOWN_CAPABILITY_TOKENS`)
- Test: `server/test/ccd-route-argv.test.ts` (new), `server/test/ccd-place-class.test.ts` (new), `server/test/caps-token-shape.test.ts` (derived, unchanged), `ccd-route-spawn.test.ts`, `ccd-spawn-split.test.ts`, `ccd-default-pool.test.ts`, `ccd-project-pool.test.ts`, `projected-home.test.ts`

**Interfaces:**
- Consumes: `_route_valid f v` (0/1/2), `_route_word_in`, `ROUTE_FIELDS`, `_route_bytes`, `_route_any`, `_lc_done route`, `_ws_least_loaded project class` (skips lanes `_class_gate` answers 1 for; keeps 0 and 2), `_class_below`, `_class_gate` (0 servable/no class, 1 measured unservable, 2 unmeasured), `_route_degrade id from to why`, `_is_anthropic_backend w`, `_project_pool_state`, `_account_ok`, `_pool_ok`, `CCRC_HOME_ABLE`, `_reg_set`, `_ws_seed_home`.
- Produces:
  - Loop arms on `cmd_ws_add` and `cmd_start` (`cmd_enable` forwards `--route` pairs to `cmd_start` untouched, the way it forwards `--cross-pool`): `--route) [[ $# -ge 2 ]] || die "$usage"; lc_route+=("$2"); shift 2 ;;` and `--route=*) lc_route+=("${1#--route=}"); shift ;;`.
  - `_route_argv_check "${lc_route[@]}"` — validates every `k=v` with `_route_valid`, refuses `degraded`/`inert`, refuses the haiku+effort pair, dies naming the field and the byte count — BEFORE any mint.
  - `_route_argv_write id actor reason "${lc_route[@]}"` — writes each field with `_reg_set`, journals `route` rows (`dec.actor "$actor" dec.reason "$reason" detail "$f: ∅ -> $v"`), one `swap.log` line each.
  - `ROUTE_COORDINATOR_ROW="class=fable effort=ultracode subagent=sonnet workflow=on"` and `_route_seed_default id wrapper` — the row when the session has NO routing field and the wrapper is an Anthropic backend (Task 1's ruling may widen it), journaled `dec.actor spawn dec.reason "coordinator row (default)"`.
  - `_place_for_class project class strict` → stdout the lane; `PLACE_DEGRADED_TO=<rung>` when placed one rung down; `""` when nothing places. `strict=1` (an explicit `--route class=`) never falls back; `strict=0` (the coordinator row's class for an operator spawn) falls back to today's class-blind `_ws_least_loaded "$project"` when no rung places, so a gpt-only pool still places an operator spawn where it did yesterday (and then gets no row, because the lane is not Anthropic).
  - `cmd_ws_add`'s refusal reason gains the arm `elif _class_gate "$w" "$cls"; [[ $? -eq 1 ]]; then why+=" $w:class=$cls-unservable"` — rc 1 ONLY: an unmeasured lane (rc 2) is placeable and must not be named as the reason (D-2854's obligation).
  - `cmd_caps` prints `route-argv-v1`.
  - A dispatched worker (`--no-rc`) without `--route` → NO row and class-blind placement; an operator `ws-add` without `--route` → placed by `fable` with the fallback above, and the coordinator row when the lane is Anthropic; `start`/`enable` on a named wrapper never place, and seed the row on a NEW session only.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-route-argv.test.ts`. Harness: `makeCcdHarness`, `seedAccountsSh` and the `RESUME_DIES`/`newSessions`/`composed` helpers copied from `ccd-route-spawn.test.ts` (top of that file), the `eventsOf`/`decOf` journal readers from `ccd-route-verb.test.ts`, a project repo made with `h.makeRepo('demo')` the way `ccd-default-pool.test.ts` does (read its `beforeEach`), and the gpt stub installed the way `ccd-auto-swap-pool.test.ts`'s `install()` does. `CCD_WS_SLUG` pins the slug (ccd's own hook at `_ws_slug_next`), so the id is `demo-quiet-mesa`; the worktree path is `$WORKTREES_ROOT/demo/quiet-mesa` — read `WORKTREES_ROOT`'s value with `h.sh('echo "$WORKTREES_ROOT"')` rather than guessing.

```ts
describe('--route on ws-add/start/enable (routing spec §5.3 dispatch wave 1 and operator spawn)', () => {
  it('ws-add --no-rc --route class=opus --route effort=high <project>: the row carries both fields before the first spawn, journaled with the verb actor', () => {
    h.sh(`${RESUME_DIES} CCD_WS_SLUG=quiet-mesa ccd ws-add --no-rc --route class=opus --route effort=high demo`);
    const id = 'demo-quiet-mesa';
    expect(h.reg(id, 'class')).toBe('opus'); expect(h.reg(id, 'effort')).toBe('high');
    const rows = eventsOf(h.home, 'route'); expect(rows).toHaveLength(2);
    expect(decOf(rows[0]!)).toMatchObject({ actor: 'ws-add', reason: 'argv' });
    expect(composed(newSessions()[0]!)).toContain('--model opus');   // the FIRST spawn line already composes the record
  });

  it('a bad value dies BEFORE the worktree, the row or the pane exist, naming the field and the byte count, never the bytes', () => {
    const wt = h.sh('echo "$WORKTREES_ROOT"').trim();
    const out = h.sh(`${RESUME_DIES} CCD_WS_SLUG=quiet-mesa ccd ws-add --no-rc --route class=gemini demo 2>&1; echo rc=$?`);
    expect(out).toMatch(/bad value for class \(6 bytes\)/); expect(out).not.toContain('gemini'); expect(out).toMatch(/rc=1/);
    expect(fs.existsSync(path.join(wt, 'demo', 'quiet-mesa'))).toBe(false);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
    expect(newSessions()).toHaveLength(0);
  });

  it('the haiku+effort pair is refused on the argv exactly as cmd_route refuses it', () => {
    const out = h.sh(`${RESUME_DIES} CCD_WS_SLUG=quiet-mesa ccd ws-add --no-rc --route class=haiku --route effort=high demo 2>&1; echo rc=$?`);
    expect(out).toContain('class haiku takes no effort level'); expect(out).toMatch(/rc=1/);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
  });

  it('a dispatched worker (--no-rc) without --route gets NO row — byte-identical to today', () => {
    h.sh(`${RESUME_DIES} CCD_WS_SLUG=quiet-mesa ccd ws-add --no-rc demo`);
    for (const f of ['class', 'effort', 'subagent', 'workflow']) expect(h.reg('demo-quiet-mesa', f)).toBeNull();
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
    const line = composed(newSessions()[0]!);
    for (const tok of ['--model', '--settings', '--effort', 'CLAUDE_CODE_SUBAGENT_MODEL']) expect(line).not.toContain(tok);
  });

  it('an operator ws-add (no --no-rc, no --route) landing on an Anthropic lane gets the coordinator row, journaled as the default', () => {
    h.sh(`${RESUME_DIES} CCD_WS_SLUG=quiet-mesa ccd ws-add demo`);
    const id = 'demo-quiet-mesa';
    expect([h.reg(id, 'class'), h.reg(id, 'effort'), h.reg(id, 'subagent'), h.reg(id, 'workflow')]).toEqual(['fable', 'ultracode', 'sonnet', 'on']);
    expect(decOf(eventsOf(h.home, 'route')[0]!)).toMatchObject({ actor: 'spawn' });
    expect(composed(newSessions()[0]!)).toContain(`--model fable --settings '{"enableWorkflows":true,"ultracode":true}' --effort ultracode`);
  });

  it('an operator start on the codex lane gets no default row (until Task 1 rules otherwise)', () => {
    h.sh(`${RESUME_DIES} ccd start gpt demo`);
    for (const f of ['class', 'effort', 'subagent', 'workflow']) expect(h.reg('gpt-demo', f)).toBeNull();
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
  });

  it('start and enable take --route, write after the mint, journal with actor start; an existing row is never re-seeded', () => {
    h.sh(`${RESUME_DIES} ccd start --route subagent=haiku claude demo`);
    expect(h.reg('claude-demo', 'subagent')).toBe('haiku');
    expect(decOf(eventsOf(h.home, 'route')[0]!)).toMatchObject({ actor: 'start', reason: 'argv' });
    h.sh(`${RESUME_DIES} ccd enable --route workflow=off claude-a demo`);   // enable forwards to start; the `enable` lifecycle row precedes the route row
    expect(h.reg('claude-a-demo', 'workflow')).toBe('off');
    expect(decOf(eventsOf(h.home, 'route')[1]!)).toMatchObject({ actor: 'start' });
    h.sh(`${RESUME_DIES} ccd start claude demo`);   // a second start of an EXISTING session with no --route
    expect(h.reg('claude-demo', 'subagent')).toBe('haiku'); expect(h.reg('claude-demo', 'class')).toBeNull();
    expect(eventsOf(h.home, 'route')).toHaveLength(2);
  });
});
```

Create `server/test/ccd-place-class.test.ts` — `_place_for_class` over the serviceability fixture table (`server/test/fixtures/serviceability.ts`, the sweep file planted as `ccd-serviceable.test.ts` plants it) with: (a) every in-pool lane measured at the Fable ceiling → the rung below is placed and `PLACE_DEGRADED_TO=opus`; (b) one lane unmeasured among the rest at the ceiling → that lane is placed at the class (no degrade, `PLACE_DEGRADED_TO` empty); (c) `strict=1` on a gpt-only pool → `""`; `strict=0` on the same pool → `gpt` and `PLACE_DEGRADED_TO` empty; (d) `ws-add --route class=fable` on fleet (a) → placed on the rung below with `degraded=opus` stamped AFTER the row exists (one `route` row `degraded: ∅ -> opus`, actor `ccd`) and the first spawn composes `--model opus`; (e) `ws-add --no-rc --route class=fable` on a gpt-only pool → dies, the reason names `gpt:class=fable-unservable`, and nothing was minted; (f) `ws-add` (operator, no flags) on fleet (a) → placed on the rung below, the coordinator row written, `degraded=opus` stamped after it.

Add `'route-argv-v1'` to `KNOWN_CAPABILITY_TOKENS` (alphabetical, between `pools-v1` and `route-v1`).

- [ ] **Step 2: Run to verify they fail** — `cd server && ./node_modules/.bin/vitest run test/ccd-route-argv.test.ts test/ccd-place-class.test.ts test/ccd-archive.test.ts` → FAIL (`--route` binds as the project positional; no token; no `_place_for_class`).

- [ ] **Step 3: Implement in `ccd/ccd`**

Beside `cmd_route` (after `_route_bytes`):

```bash
ROUTE_COORDINATOR_ROW="class=fable effort=ultracode subagent=sonnet workflow=on"   # spec §3's coordinator row: the default for an OPERATOR spawn (§4)

_route_argv_check() {   # k=v... -> 0 all valid | dies naming the field and the byte count (never the bytes). Refuses ccd-only fields and the haiku+effort pair.
  local kv f v rc cls="" eff=""
  for kv in "$@"; do
    [[ "$kv" == *=* ]] || die "bad --route '$kv' (want <field>=<value>)"
    f="${kv%%=*}"; v="${kv#*=}"
    _route_word_in "$f" "${ROUTE_FIELDS[*]}" || die "unknown routing field '$f' (want one of: ${ROUTE_FIELDS[*]})"
    [[ "$f" == degraded || "$f" == inert ]] && die "'$f' is written by ccd only"
    _route_valid "$f" "$v"; rc=$?
    case "$rc" in
      0) ;;
      2) die "route: this box's roster projection carries no subagent class list — re-run ccrc install" ;;
      *) die "bad value for $f ($(_route_bytes "$v") bytes) — not in its vocabulary; nothing was touched" ;;
    esac
    [[ "$f" == class ]] && cls="$v"; [[ "$f" == effort ]] && eff="$v"
  done
  [[ "$cls" == haiku && -n "$eff" && "$eff" != auto ]] && die "class haiku takes no effort level — set effort=auto or pick another class; nothing was touched"
  return 0
}

_route_argv_write() {   # id actor reason k=v... — write validated fields (the row exists), one route row + one log line each
  local id="$1" actor="$2" reason="$3" kv f v; shift 3
  for kv in "$@"; do
    f="${kv%%=*}"; v="${kv#*=}"
    _reg_set "$id" "$f" "$v" || die "could not write $f for $id — the record is unchanged from this field on"
    _lc_done route "$id" "" dec.actor "$actor" dec.reason "$reason" detail "$f: ∅ -> $v"
    echo "$(date '+%F %T') route $id: $f ∅ -> $v [actor=$actor] ($reason)" >> "$REG/swap.log"
  done
}

_route_seed_default() {   # id wrapper — the coordinator row for an OPERATOR spawn with no routing field, on an Anthropic lane
  _route_any "$1" && return 0
  _is_anthropic_backend "$2" || return 0                 # Task 1's ruling may widen this
  # shellcheck disable=SC2086
  _route_argv_write "$1" spawn "coordinator row (default)" $ROUTE_COORDINATOR_ROW
}

_route_argv_class() {   # k=v... -> stdout the class= value among them, or nothing
  local kv; for kv in "$@"; do [[ "$kv" == class=* ]] && { printf '%s' "${kv#class=}"; return 0; }; done; return 0
}

_place_for_class() {   # project class strict -> stdout the lane; PLACE_DEGRADED_TO=<rung> when placed one rung down; "" when nothing places.
  # strict=1: an explicit class never falls back. strict=0: the coordinator row's class for an operator spawn — when no rung
  # places, today's class-blind rule decides (a gpt-only pool keeps placing operator spawns), and no row follows on that lane.
  local project="$1" cls="${2:-}" strict="${3:-1}" hw below w unserv=0 pps
  PLACE_DEGRADED_TO=""
  hw=$(_ws_least_loaded "$project" "$cls")
  if [[ -n "$hw" || -z "$cls" || "$cls" == default ]]; then printf '%s' "$hw"; return 0; fi
  # Nothing placed at the class. Degrade one rung ONLY on a measured emptiness: at least one in-pool lane answered
  # `_class_gate` rc 1. rc 2 (unmeasured) lanes are placeable and would have been placed, so their presence here means
  # they failed an earlier filter — not a fact about the class (spec §5.4: nobody degrades on a fabricated fact).
  pps=$(_project_pool_state "$project")
  for w in "${CCRC_HOME_ABLE[@]}"; do
    _account_ok "$w" && _pool_ok "$w" "$pps" || continue
    _class_gate "$w" "$cls"; [[ $? -eq 1 ]] && unserv=$((unserv + 1))
  done
  if (( unserv > 0 )); then
    below=$(_class_below "$cls")
    if [[ -n "$below" ]]; then
      hw=$(_ws_least_loaded "$project" "$below")
      [[ -n "$hw" ]] && { PLACE_DEGRADED_TO="$below"; printf '%s' "$hw"; return 0; }
    fi
  fi
  (( strict )) && return 0
  _ws_least_loaded "$project"
}
```

`cmd_ws_add`: `lc_route=()` beside `lc_args=()`; the loop gains the two arms (usage string extended with `[--route <field>=<value>]...`); after the actor checks `(( ${#lc_route[@]} )) && _route_argv_check "${lc_route[@]}"`; then `local cls strict=1; cls=$(_route_argv_class "${lc_route[@]}"); if [[ -z "$cls" && ! $norc -eq 1 ]]; then cls="${ROUTE_COORDINATOR_ROW%% *}"; cls="${cls#class=}"; strict=0; fi` (the coordinator row's class, derived from the constant, never respelled); the pre-lock read becomes `hw=$(_place_for_class "$project" "$cls" "$strict")`, its refusal `for w in CCRC_HOME_ABLE` loop gains the `_class_gate` rc-1 arm after the `_pool_ok` arm; inside the `fresh` subshell `_ws_least_loaded "$project" || true` becomes `_place_for_class "$project" "$cls" "$strict" || true; printf '\n%s' "$PLACE_DEGRADED_TO"` — the subshell prints TWO lines (lane, rung) and the parent splits them: `fresh_deg=""; [[ "$fresh" == *$'\n'* ]] && { fresh_deg="${fresh#*$'\n'}"; fresh="${fresh%%$'\n'*}"; }` before the `[[ -n "$fresh" ]]` die; after `_ws_seed_home "$id" "$hw"` and the `(( norc )) && _reg_set "$id" rc off` line: `if (( ${#lc_route[@]} )); then _route_argv_write "$id" "${lc_actor:-ws-add}" argv "${lc_route[@]}"; elif (( ! norc )); then _route_seed_default "$id" "$hw"; fi; [[ -n "$fresh_deg" ]] && _route_degrade "$id" "$cls" "$fresh_deg" "unservable: $cls on every in-pool lane at placement"` — the actor is the declared `--actor` when the caller gave one (the dispatcher's `run:<id> dispatch`), else the verb. `cmd_start`: the same two arms in its strip loop (`route=()`), `_route_argv_check` right after the wrapper/project validation, `_route_argv_write "$id" start argv "${route[@]}"` after `_ws_seed_home "$id" "$wrapper"` on the `[[ -z "$regw" ]]` (minting) arm only, else `_route_seed_default "$id" "$wrapper"` on that same arm only. `cmd_enable`: `--route) route+=(--route "$2"); shift 2 ;;` and `--route=*) route+=("$1"); shift ;;` in its loop, forwarded as `cmd_start ${cross:+--cross-pool} "${route[@]}" "$@"`. `cmd_caps`: `echo route-argv-v1` beside `route-v1`, with a two-line comment in the `actor-flags-v1` style. Re-stamp the marker.

- [ ] **Step 4: Run to verify they pass, and every spawn suite** — the two new suites + `ccd-route-spawn`, `ccd-spawn-split`, `ccd-default-pool`, `ccd-project-pool`, `projected-home`, `ccd-archive`, `caps-token-shape`, `ccd-serviceable`, `ccd-swap-target-class`, `ownership`.

- [ ] **Step 5: Mutation check, measured** — move `_route_argv_check` below `git worktree add` → "dies BEFORE the worktree" reds; drop the `elif (( ! norc ))` guard (seed for workers too) → "dispatched worker gets NO row" reds; delete the rung-below walk in `_place_for_class` → case (a) reds; make `strict` always 0 → case (c)'s strict half reds; change the reason arm to `! _class_gate` → a fixture with one unmeasured lane in the refusal text reds. Record each as before/after in the report.

- [ ] **Step 6: Commit** — `feat(routing): --route on ws-add/start/enable, placement by class with the rung below, the coordinator row for operator spawns (routing slice 4, Task 2)`.

---

### Task 3: The server writes the record — dispatch wave 1 on the argv, wave N ≥ 2 through the verb, operator spawns from the body

**Files:**
- Modify: `shared/api.ts` (`ROUTE_WRITABLE_FIELDS`, `RouteField`, `RouteFields`, `parseRouteFields`), `server/src/ccdargv.ts`, `server/src/coord/dispatch.ts`, `server/src/coord/routes.ts:1347`, `server/src/server.ts` (`POST /api/sessions`, `POST /api/projects/:project/workspaces`)
- Test: `server/test/dispatch-route.test.ts` (new), `server/test/sessions-route-body.test.ts` (new), `server/test/run-routes.test.ts`, `server/test/whitelist-subset.test.ts` (both maps, unchanged), `server/test/single-definition.test.ts`, `shared` cases in `server/test/route-fields-parse.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's `--route`; `capSupported`, `sweepDec(state, actor)`, `ActorFlags`, `decFlags`, `ROUTE_CAP`; `dispatchRun(deps, id, brief, items)` and its call site `routes.ts:1347` (`dispatchRun(dispatchDeps, id, body.brief, body.items)`).
- Produces:
  ```ts
  // shared/api.ts (L0)
  export const ROUTE_WRITABLE_FIELDS = ['class', 'effort', 'subagent', 'workflow', 'compact'] as const;
  export type RouteField = (typeof ROUTE_WRITABLE_FIELDS)[number];
  export type RouteFields = Partial<Record<RouteField, string>>;
  /** SHAPE only — known keys, non-empty strings, no control characters, ≤ 32 bytes each; VALUES are ccd's to refuse (`_route_valid`). */
  export type RouteFieldsParse = { ok: true; route: RouteFields } | { ok: false; why: 'not-object' | 'unknown-field' | 'bad-value'; field?: string };
  export function parseRouteFields(v: unknown): RouteFieldsParse;
  // server/src/ccdargv.ts
  export const ROUTE_ARGV_CAP = 'route-argv-v1';
  const routeFlags = (r: RouteFields | null): string[] =>
    r === null ? [] : ROUTE_WRITABLE_FIELDS.flatMap((f) => (r[f] === undefined ? [] : ['--route', `${f}=${r[f]}`]));
  start:       (w, p, wd?, route: RouteFields | null = null) => argv(['start', ...routeFlags(route), w, p, ...(wd ? [wd] : [])])   // FLAGS LEAD (the swapCross rule)
  enable:      the same shape
  wsAdd:       (p, route: RouteFields | null = null) => argv(['ws-add', ...routeFlags(route), p])
  wsAddWorker: (p, dec, route: RouteFields | null = null) => argv(['ws-add', '--no-rc', ...routeFlags(route), p, ...decFlags(dec)])
  route:       (id, field, value, dec: ActorFlags | null = null) => argv(['route', '--session', id, '--set', `${field}=${value}`, ...decFlags(dec)])
  ```
  `dispatchRun(deps, id, brief, items, route: unknown = undefined)`: `undefined`/absent → no routing (today's argv, byte for byte); otherwise `parseRouteFields` — a malformed `route` → `{ ok: false, kind: 'bad-request', detail: 'route: <why>' }` BEFORE any fleet act; wave 1 (the `wsAddWorker` arm at `dispatch.ts:364`): `wsAddWorker(run.project, dispatchDec, capSupported(deps.fleetState, ROUTE_ARGV_CAP) ? route : null)` and, when the route was given but the token is absent, `recordRunEvent(id, 'coordinator', 'route-omitted:no-route-argv-cap')`; wave N ≥ 2 (the resume arm): for each field in `ROUTE_WRITABLE_FIELDS` order, `runCcd(CCD_ARGV.route(sessionId, f, v, sweepDec(deps.fleetState, `run:${id} dispatch`)))` BEFORE the `/clear` — a refusal is `{ ok: false, kind: 'fleetFailed', stderr }` (the run stays `planned`, nothing cleared); with no `route-v1` token, `recordRunEvent(id, 'coordinator', 'route-omitted:no-route-v1-cap')` and the `/clear` proceeds. `routes.ts:1347` passes `body.route`. `POST /api/sessions` and `POST /api/projects/:project/workspaces` accept `route?`: 400 `bad-request` on a bad shape; 501 `unsupported` when `ROUTE_ARGV_CAP` is absent and `route` was given — never silently dropped for an operator who asked; absent `route` → today's argv.

- [ ] **Step 1: Write the failing tests** — `dispatch-route.test.ts` (the `dispatch-hold-order.test.ts` harness: a stubbed `runCcd` recording argv and a `sendPrompt` recorder, `ccdVerbs` seeded with and without the tokens): wave 1 with the token → the ws-add argv is `['ws-add','--no-rc','--route','class=opus','--route','effort=high','<project>','--surface','agent','--actor','run:<id> dispatch']` (order pinned); without the token → no `--route`, a `route-omitted:no-route-argv-cap` run event; wave N ≥ 2 with the token → `route --session <sid> --set class=opus --surface agent --actor run:<id> dispatch` BEFORE the `/clear` in the recorder's combined order; a ccd refusal on the route verb → `fleetFailed`, no `/clear`, the run still `planned`; malformed `route` → `bad-request` and no fleet act; `route` absent → the argv byte-identical to a call without the parameter. `sessions-route-body.test.ts` (the `routes.test.ts` idiom: `buildServer(testDeps(home))` with `runCcd` stubbed): `POST /api/sessions` with `route` → `start --route class=opus <w> <p>`; with a bad field → 400 and no ccd call; without the token → 501 and no ccd call; without `route` → today's argv; the same four for `/workspaces`. `route-fields-parse.test.ts`: `parseRouteFields` over unknown key, control char, empty, 33 bytes, not an object, a valid five-field object. `whitelist-subset` stays green (no new verb).

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** as the Interfaces block spells; every builder keeps its old call shape (defaulted trailing parameter) so `whitelist-subset`'s enumeration is unchanged; `ROUTE_WRITABLE_FIELDS` is the one list (`single-definition` scans for a second copy of the five words as an array — do not respell them in a test either; import).

- [ ] **Step 4: Run to verify they pass** — plus `run-routes`, `dispatch-hold-order`, `dispatch-adopt`, `coord-pause-route`, `box-token-census`, `single-definition`, `typecheck-tests`.

- [ ] **Step 5: Mutation check, measured** — move the wave-N route calls after the `/clear` → the order pin reds; drop the `capSupported` gate on wave 1 → the no-token case reds; drop the 501 → the sessions no-token case reds.

- [ ] **Step 6: Commit** — `feat(routing): dispatch seeds the worker's record (argv on wave 1, the verb before /clear on wave N) and operator spawns carry route fields (routing slice 4, Task 3)`.

---

### Task 4: `cmd_route --apply`, the extracted idle predicate, `_route_apply_check`, the session-only typers, read-back and `routeskip`

**Files:**
- Modify: `ccd/ccd` (`cmd_route`, `_auto_compact_check`, new `_pane_for_keystroke`, `_idle_for_keystroke`, `_route_apply_check`, `_route_note`/`_route_note_clear`, `_route_type_effort`, `_route_type_model`, `_route_picker_rows`, `_route_ack_wait`, `_route_apply_now`, `_route_applied_set`; `_spawn_start`'s settle stamp; the supervise loop's `live)` arm at `ccd/ccd:16691`; `cmd_caps`), `server/test/ccd-archive.test.ts`
- Test: `server/test/ccd-route-apply.test.ts` (new), `server/test/ccd-route-tick.test.ts` (new), `server/test/ccd-auto-compact.test.ts` (unchanged — the predicate extraction must keep every note word and sentence)

**Interfaces:**
- Consumes: slice 1's measurements (the keystroke tables in the research doc rows for D-2808/D-2811), Task 1's picker facts, `_pane_auto_continue_armed`, `_pane_box_has_content`, `_pane_ctx_pct`, `COMPACT_QUIET`, `COMPACT_NOTE_FLOOR`, `_cfg_dir`, `_tmux`, `_reg_get`/`_reg_set`, `_route_get`, `_route_effort_for id class`, `_compact_note`'s shape (`ccd/ccd:14788`), `_auto_compact_check`'s body (`ccd/ccd:14821`–`14958`).
- Produces:
  - `_pane_for_keystroke id` → rc 0 with the 8-row capture in the global `KS_PANE`; rc 1 with `KS_WHY` ∈ {`pane-unreadable`, `pane-blank`, `auto-continue`} and `KS_DETAIL` carrying the compactor's exact detail sentence (`tmux capture-pane rc=$prc` / `tmux capture-pane rc=0, empty capture` / the auto-continue sentence). The pipeline line `pane=$(tmux capture-pane -t "$(_tmux "$id")" -p 2>/dev/null | tail -8); prc=$?` moves here VERBATIM, on one line (the 8-ROW window argument in the compactor's comment moves with it).
  - `_idle_for_keystroke id pane ctxnote` → rc 0 idle; rc 1 with `KS_WHY` ∈ {`mid-turn`, `no-prompt`, `no-pane-pid`, `status-unreadable`, `not-idle`, `quiet-unmeasured`, `not-quiet`, `drafting`} and `KS_DETAIL` built from these templates, which render byte-identically to today's compactor when `ctxnote` is `ctx ${pct}%`: `mid-turn`/`no-prompt`/`not-quiet`/`drafting` → `"$ctxnote"`; `no-pane-pid` → `"tmux list-panes named no pane pid${ctxnote:+, $ctxnote}"`; `status-unreadable` → `"no status in $sf${ctxnote:+, $ctxnote}"` (absent) / `"not a regular file: $sf${ctxnote:+, $ctxnote}"` / `"no status in $sf${ctxnote:+, $ctxnote}"` (no token); `not-idle` → `"status=$st${ctxnote:+ $ctxnote}"`; `quiet-unmeasured` → `"no statusUpdatedAt in $sf${ctxnote:+, $ctxnote}"`. It computes its own `now`, reads `wrapper` with `_reg_get`, and keeps the `-e`/`-L` status-file arms exactly.
  - `_auto_compact_check` becomes: kill-switch and cooldown as before → `_pane_for_keystroke "$id" || { _compact_note "$id" "$KS_WHY" "$KS_DETAIL"; return 0; }; pane="$KS_PANE"` → `no-ctx-segment` / threshold clear / `post-swap` exactly as before → `_idle_for_keystroke "$id" "$pane" "ctx ${pct}%" || { _compact_note "$id" "$KS_WHY" "$KS_DETAIL"; return 0; }` → `_compact_note_clear`, `lastcompact`, the log line, the `/compact` keys as before.
  - `_route_note id reason [detail]` / `_route_note_clear id` — `routeskip` (`<epoch> <reason>`) and `routenote` (floor `ROUTE_NOTE_FLOOR=1800`, its own constant beside `COMPACT_NOTE_FLOOR` with a comment saying they are equal by choice, not by derivation), a `route-skip $id: <reason> (<detail>)` swap.log line, modelled line for line on `_compact_note`/`_compact_note_clear`.
  - `_route_applied_set id field value` — rewrites `$REG/<id>.routeapplied` (space-separated `field=value` words) with that field replaced or appended; `_route_applied_get id field` reads one.
  - `_route_type_effort tmux level` — `ultracode`: `send-keys -l '/effort ultracode'`, `Enter` (plain, D-2810); other levels: `-l /effort`, `Enter`, `Left`×7, `Right`×N (`low 0, medium 1, high 2, xhigh 3, max 4`), `-l s`; then `_route_ack_wait`: if the pane shows `Yes, switch` first (Opus 5's `Change effort level?` dialog), `Enter`, then wait again. Each key is followed by the `sleep` `_inject_spawn_effort` uses.
  - `_route_picker_rows pane` → one line per picker row: `<n> <label> [cursor]` — parses `^\s*(❯\s*)?(\d+)\.\s+(.+?)(\s+✔)?\s*$` off the capture after `/model` + Enter; `_route_type_model tmux class` — `-l /model`, `Enter`, capture, `_route_picker_rows`, find the target row whose label begins with the class's display word (`default` → `Default`, `opus` → `Opus`, `sonnet` → `Sonnet`, `fable` → `Fable`, `haiku` → `Haiku`; on a non-Anthropic lane the row Task 1 measured for that class, or `no-picker-row`), find the cursor row, press `Down`×(target − cursor) or `Up`×(cursor − target), `-l s`; no such row → `Escape` and rc 2 (`KS_WHY=no-picker-row`). Never a numeric constant.
  - `_route_ack_wait tmux regex` → polls the pane up to `ROUTE_ACK_WAIT=5` seconds (one `sleep 1` per poll) for a line matching the acknowledgement (`Set effort level to <level> \(this session only\)` / `Set model to .* for this session only` — the strings D-2808/D-2811 measured), rc 0 on match, rc 1 on timeout.
  - `_route_apply_now id` — the one applier. Wants: `class` = `degraded` if stamped else the record's `class` (the class SERVED, never the intended one on a degraded lane); `effort` = `_route_effort_for id <served class>`. For each of `class`, `effort` whose wanted value differs from `_route_applied_get`: `effort=auto` or empty → `_route_applied_set id effort auto` without typing (absence is the lever; the live level stands until the settle); `class=default`/empty → the picker's `Default` row; otherwise type, wait for the ack, on ack `_route_applied_set` and `_route_note_clear`; on no ack → `_route_note id apply-unconfirmed "<field>=<value>"` and return 1 (the next tick retries); on `no-picker-row` → `_route_note id no-picker-row "class=<value>"`, return 1. `workflow`, `subagent` and `compact` are never typed (settle-applied; recorded applied when written: `_route_applied_set` for each on every write). Returns 0 when nothing is pending. Class first, then effort (D-2811: a session-only effort survives a model change).
  - `_route_apply_check id` (the tick): nothing pending → `_route_note_clear`, return 0; `_pane_for_keystroke` refuses → `_route_note id "$KS_WHY" "$KS_DETAIL"`; `_idle_for_keystroke "$id" "$KS_PANE" ""` refuses → the same; else `_route_apply_now`.
  - `cmd_route --apply` — a flag in its loop; after the writes and echoes, `if _pane_for_keystroke "$id" && _idle_for_keystroke "$id" "$KS_PANE" ""; then _route_apply_now "$id" || echo "queued $id"; else _route_note "$id" "$KS_WHY" "$KS_DETAIL"; echo "queued $id"; fi`; without `--apply` nothing changes (the coordinator's form). Every written field is `_route_applied_set` for `workflow`/`subagent`/`compact` at write time (they are settle-applied) — `class`/`effort` are recorded only on ack or at the settle.
  - `cmd_caps` prints `route-apply-v1`; `KNOWN_CAPABILITY_TOKENS` gains it.
  - The settle (`_spawn_start`, beside the `inert` stamp at `ccd/ccd:15613`) writes `routeapplied` from what it composed: `class=<rclass as served> effort=<reff or auto> subagent=<rsub or absent> workflow=<on|off>`, so a fresh spawn is never re-typed; `rm -f` the file when the session has no record.
  - The supervise loop's `live)` arm: `_auto_compact_check "$id"; _route_apply_check "$id"` — appended to the one line at `ccd/ccd:16691`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-route-apply.test.ts`. The tmux stub logs every `send-keys`, answers `capture-pane` from `$HOME/pane.txt`, and after a `send-keys` whose key text (with `-l ` stripped and a leading `/` dropped) names an existing `$HOME/pane-after-<key>.txt`, copies that file over `pane.txt` — so a test scripts the pane's transitions (`pane-after-model.txt` = the picker, `pane-after-s.txt` = the acknowledgement, `pane-after-Enter.txt` = after a dialog confirm). The lane's session JSON (`$(_cfg_dir claude)/sessions/4242.json`) is planted `idle` and quiet as `ccd-auto-compact.test.ts`'s `plantSession` does (read it; `sessionsDir()` there is `$HOME/.claude/sessions`).

```ts
const IDLE_PANE = '│ 🤖 Opus 5 · xhigh │ ▓ ctx ▁▁▁ 20% │\n❯ \n';
const MID_TURN_PANE = 'Working… (esc to interrupt)\n';
const PICKER_PANE = `${IDLE_PANE}❯ 1. Default (recommended) ✔\n  2. Sonnet\n  3. Opus\n  4. Haiku\nEnter to set as default · s to use this session only · Esc to cancel\n`;
const ACK_EFFORT = (level: string): string => `${IDLE_PANE}Set effort level to ${level} (this session only): …\n`;
const ACK_MODEL = (name: string): string => `${IDLE_PANE}Set model to ${name} for this session only\n`;
const DIALOG_PANE = `${IDLE_PANE}Change effort level?\n❯ 1. Yes, switch to high\n  2. No, go back\n`;
const TMUX_STUB = `tmux() {
  echo "tmux $*" >> "$HOME/tmux-calls"
  case "$1" in
    capture-pane) cat "$HOME/pane.txt" ;;
    list-panes)   echo 4242 ;;
    send-keys)    shift; while [[ "\${1:-}" == -t ]]; do shift 2; done; k="$*"; k="\${k#-l }"; k="\${k#/}"
                  [[ -f "$HOME/pane-after-$k.txt" ]] && cp "$HOME/pane-after-$k.txt" "$HOME/pane.txt" ;;
  esac; return 0
}; sleep() { :; };`;
const keys = (): string[] => fs.readFileSync(path.join(h.home, 'tmux-calls'), 'utf8').split('\n')
  .filter((l) => l.startsWith('tmux send-keys')).map((l) => l.replace(/^tmux send-keys -t \S+ /, ''));
const pane = (text: string): void => { fs.writeFileSync(path.join(h.home, 'pane.txt'), text); };
const after = (key: string, text: string): void => { fs.writeFileSync(path.join(h.home, `pane-after-${key}.txt`), text); };
/** The lane's session JSON the idle predicate reads: `<config dir>/sessions/<pane pid>.json`, idle and quiet for longer than
 *  COMPACT_QUIET — `ccd-auto-compact.test.ts`'s `plantSession` shape; `h.sh('_cfg_dir claude')` names the directory. */
const plantIdle = (): void => {
  const dir = path.join(h.sh('_cfg_dir claude').trim(), 'sessions'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '4242.json'), JSON.stringify({ status: 'idle', statusUpdatedAt: Date.now() - 120_000 }));
};
// `seed(id, wrapper)` and `ID` are copied from ccd-route-degrade.test.ts (a wrapper, a uuid, a tmux name); `sleep` is stubbed in TMUX_STUB.

describe('route --apply (routing spec §5.3 live change; slice 1 keystrokes D-2808/D-2810/D-2811)', () => {
  beforeEach(() => { seed(ID, 'claude'); plantIdle(); pane(IDLE_PANE); h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} effort xhigh; _reg_set ${ID} routeapplied "class=opus effort=xhigh"`); });

  it('effort=high on an idle pane: /effort, Enter, 7×Left, 2×Right, s — and routeapplied records it after the ack', () => {
    after('s', ACK_EFFORT('high'));
    const out = h.sh(`${TMUX_STUB} ccd route --session ${ID} --set effort=high --apply --actor operator --reason picker`);
    expect(keys()).toEqual(['-l /effort', 'Enter', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Right', 'Right', '-l s']);
    expect(out).toContain(`set ${ID} effort=high`); expect(out).not.toContain('queued');
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high'); expect(h.reg(ID, 'routeskip')).toBeNull();
  });

  it("Opus 5's Change-effort dialog is confirmed with Enter, then the ack is read", () => {
    after('s', DIALOG_PANE); after('Enter', ACK_EFFORT('high'));   // the first Enter (after /effort) copies the ack too early — so the test plants the dialog on `s` and the ack on the NEXT Enter by rewriting pane-after-Enter from a `s` hook: read the stub, and make pane-after-Enter apply only when pane.txt already shows the dialog
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set effort=high --apply`);
    expect(keys().slice(-2)).toEqual(['-l s', 'Enter']);
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
  });

  it('effort=ultracode types the PLAIN form (session-only by construction) and nothing else', () => {
    after('effort ultracode', ACK_EFFORT('ultracode'));
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set effort=ultracode --apply`);
    expect(keys()).toEqual(['-l /effort ultracode', 'Enter']);
  });

  it('class=sonnet reads the picker, moves the cursor from the ✔ row to the Sonnet row, presses s — never `/model sonnet`, never Left/Right', () => {
    after('model', PICKER_PANE); after('s', ACK_MODEL('Sonnet 5'));
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set class=sonnet --apply`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=sonnet');
  });

  it('a picker whose cursor sits BELOW the target moves Up', () => {
    after('model', PICKER_PANE.replace('❯ 1.', '  1.').replace('  3. Opus', '❯ 3. Opus')); after('s', ACK_MODEL('Sonnet 5'));
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set class=sonnet --apply`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Up', '-l s']);
  });

  it('a class the picker does not list: Escape, no-picker-row, nothing recorded', () => {
    after('model', PICKER_PANE);
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set class=fable --apply`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Escape']);
    expect(h.reg(ID, 'routeskip')).toMatch(/no-picker-row/); expect(h.reg(ID, 'routeapplied')).not.toContain('class=fable');
  });

  it('on a degraded session the class typed is the rung SERVED, not the intended one', () => {
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} degraded opus; _reg_set ${ID} routeapplied "class=sonnet effort=xhigh"`);
    after('model', PICKER_PANE); after('s', ACK_MODEL('Opus 5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=opus');
  });

  it('effort=auto types NOTHING and is recorded applied (absence is the lever)', () => {
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set effort=auto --apply`);
    expect(keys()).toEqual([]); expect(h.reg(ID, 'routeapplied')).toContain('effort=auto');
  });

  it('workflow=off types nothing and is recorded applied-at-settle', () => {
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set workflow=off --apply`);
    expect(keys()).toEqual([]); expect(h.reg(ID, 'routeapplied')).toContain('workflow=off');
  });

  it('a mid-turn pane queues: nothing typed, routeskip=mid-turn, the verb prints queued', () => {
    pane(MID_TURN_PANE);
    const out = h.sh(`${TMUX_STUB} ccd route --session ${ID} --set effort=high --apply`);
    expect(keys()).toEqual([]); expect(out).toContain(`queued ${ID}`);
    expect(h.reg(ID, 'routeskip')).toMatch(/^\d+ mid-turn$/);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8')).toMatch(new RegExp(`route-skip ${ID}: mid-turn`));
  });

  it('no acknowledgement within the window: apply-unconfirmed, nothing recorded, the next tick retries', () => {
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set effort=high --apply`);   // the pane never shows the ack line
    expect(h.reg(ID, 'routeapplied')).not.toContain('effort=high'); expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
    fs.writeFileSync(path.join(h.home, 'tmux-calls'), '');
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()[0]).toBe('-l /effort');
  });

  it("without --apply the verb writes and types nothing — the coordinator's form (spec §5.3, §8 row 5)", () => {
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set effort=high`);
    expect(keys()).toEqual([]); expect(h.reg(ID, 'routeapplied')).not.toContain('effort=high');
  });

  it('routeskip is its OWN field: a below-threshold compaction tick clears compactskip and leaves routeskip standing (spec §8 row 7)', () => {
    pane(MID_TURN_PANE);
    h.sh(`${TMUX_STUB} ccd route --session ${ID} --set effort=high --apply`);
    pane(IDLE_PANE);   // ctx 20% < COMPACT_THRESHOLD
    h.sh(`${TMUX_STUB} _reg_set ${ID} compactskip "1 not-idle"; _auto_compact_check ${ID}`);
    expect(h.reg(ID, 'compactskip')).toBeNull(); expect(h.reg(ID, 'routeskip')).toMatch(/mid-turn/);
  });
});
```

(The dialog case needs the stub to apply `pane-after-Enter.txt` only when `pane.txt` currently shows `Yes, switch` — add that one `grep -q` guard to the stub's `send-keys` arm; the plan states the intent and the implementer writes the guard.)

Create `server/test/ccd-route-tick.test.ts`: (a) a pending field on a mid-turn pane is left alone by `_route_apply_check` (`routeskip` = `mid-turn`) and applied on the next call once the pane is idle, `routeskip` cleared after the ack; (b) `_spawn_start` with a record writes `routeapplied` = `class=opus effort=xhigh subagent=sonnet workflow=on` (the composed values; use `ccd-route-spawn.test.ts`'s `RESUME_DIES` spawn idiom), so `_route_apply_check` right after a spawn types nothing; (c) a source scan of `_supervise_loop`'s `live)` arm shows `_route_apply_check "$id"` on the same line as `_auto_compact_check "$id"` (pin the way `ccd-crosspool.test.ts` pins that arm); (d) a source scan of `_auto_compact_check`'s body shows a call to `_pane_for_keystroke` and a call to `_idle_for_keystroke`, and NO `tmux capture-pane` of its own (the predicate is extracted, not copied).

`server/test/ccd-auto-compact.test.ts` runs unchanged and must stay green after the extraction — it is the pin on the predicate preserving every note word and sentence.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** — FIRST the extraction alone (`_pane_for_keystroke`, `_idle_for_keystroke`, the compactor rewritten to call them): run `ccd-auto-compact` green before anything else, and commit that as its own commit (`refactor(ccd): extract the compactor's idle predicate into _pane_for_keystroke and _idle_for_keystroke (routing slice 4, Task 4)`). THEN the helpers as the Interfaces block spells, `cmd_route`'s `--apply` arm, the supervise loop's call, the settle's `routeapplied` write. Re-stamp the marker before each commit.

- [ ] **Step 4: Run to verify they pass** — the two new suites, `ccd-auto-compact`, `ccd-route-spawn`, `ccd-route-degrade`, `ccd-route-verb`, `ccd-crosspool`, `ccd-archive`, `caps-token-shape`, `ccd-arith-containment`, `ownership`.

- [ ] **Step 5: Mutation check, measured** — write the refusal into `compactskip` → the row-7 case reds; type `/effort high` plain → the keystroke-sequence assertion reds; skip `_route_ack_wait` → the no-ack case reds; hard-code `Down`×1 for sonnet → the cursor-below case reds; type the intended class on a degraded session → that case reds; re-inline a `tmux capture-pane` in `_auto_compact_check` → tick (d) reds.

- [ ] **Step 6: Commit** — `feat(routing): route --apply and the supervise tick apply the record with the session-only keystrokes; refusals in routeskip (routing slice 4, Task 4)`.

---

### Task 5: The PWA's pickers write the record — `POST /api/sessions/:id/route`, `api.route`, queued until read-back

**Files:**
- Modify: `server/src/ccdargv.ts` (`routeApply`, `ROUTE_APPLY_CAP`), `server/src/server.ts` (the route beside `POST /api/sessions/:id/prompt` at `server.ts:1527`, using the existing `pwaDec(req)` at `server.ts:470`), `pwa/src/lib/api.ts`, `pwa/src/lib/models.ts`, `pwa/src/screens/SessionScreen.tsx`
- Test: `server/test/sessions-route-route.test.ts` (new), `server/test/no-routing-keystroke-from-server.test.ts` (new), `pwa/test/models.test.ts`, `pwa/test/session-pickers.test.tsx` (new)

**Interfaces:**
- Consumes: Task 4's `route --apply` and `route-apply-v1`; `knownId`, `runCcdOr502`, `capSupported`, `pwaDec(req)` (surface `pwa`, actor from `sessionAuth(req).device`, reason `null` — the dec every human-driven route already declares; the picker is one more of them, so it takes THAT helper and invents no reason word); `FleetSession.effort`/`model`/`ultracode` (already on the wire); `PickSheet`'s `options`/`onPick`; `parseRouteFields` (Task 3).
- Produces:

```ts
// server/src/ccdargv.ts
export const ROUTE_APPLY_CAP = 'route-apply-v1';
  routeApply: (id: string, field: string, value: string, dec: ActorFlags | null) =>
    argv(['route', '--session', id, '--set', `${field}=${value}`, '--apply', ...decFlags(dec)]),
```

```ts
// server/src/server.ts — beside /api/sessions/:id/prompt; session-gated like it (NOT in auth/gate.ts's EXEMPT)
  app.post('/api/sessions/:id/route', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { field?: unknown; value?: unknown };
    const parsed = parseRouteFields(typeof body.field === 'string' ? { [body.field]: body.value } : null);
    if (!parsed.ok || Object.keys(parsed.route).length !== 1) return reply.code(400).send({ ok: false, error: 'bad-request' });
    if (!capSupported(deps.fleetState, ROUTE_APPLY_CAP)) return reply.code(501).send({ ok: false, error: 'unsupported' });
    const [field, value] = Object.entries(parsed.route)[0] as [string, string];
    return runCcdOr502(reply, CCD_ARGV.routeApply(id, field, value, pwaDec(req)));
  });
```

```ts
// pwa/src/lib/models.ts — `command` is REMOVED from PickOption; `route` replaces it
export interface PickOption { label: string; sublabel?: string; route: { field: RouteField; value: string }; active: boolean }
// modelOptions rows keep their labels, order and `active` rule; the gpt lane's four rows map to the classes their aliases named
// (GPT-6 Astra → class fable, Sol → opus, Terra → sonnet, Luna → haiku); Anthropic: Opus 5 → opus, Sonnet 5 → sonnet, Fable 5 → fable, Haiku 4.5 → haiku, Default → class default
// effortOptions rows: Low…Max → {effort: level}, Auto → {effort: 'auto'}, Ultracode (Anthropic lanes only) → {effort: 'ultracode'}
// pwa/src/lib/api.ts
    route: (id: string, field: RouteField, value: string) => post(`${sid(id)}/route`, { field, value }),
```

`SessionScreen`: `pick(o: PickOption)` → `setQueued(o.route); await api.route(id, o.route.field, o.route.value)`; the header's model/effort chip renders a small `queued` badge while `queued` is set; it clears when the live row reads the value back — `effort`: `live.effort === value` (or `live.ultracode` for `ultracode`, or on the response for `auto`, since absence is not readable); `class`: `live.model` contains the picked row's label prefix (the first word of `label`), or on the response for `default` — and after 60 s without read-back it clears with the toast "Routing queued; the pane has not confirmed it yet". A 501 shows the fleet's existing unsupported toast (grep `unsupported` in `pwa/src` for the helper).

- [ ] **Step 1: Write the failing tests**

`server/test/sessions-route-route.test.ts` (the `routes.test.ts` idiom: `buildServer(testDeps(home))`, `runCcd` stubbed to record argv; `ccdVerbs` seeded per case):

```ts
describe('POST /api/sessions/:id/route (routing spec §5.3, live change from the PWA)', () => {
  it('404 for an unknown session, before any parse', …);
  it('400 for a missing field, an unknown field, a control character, a second key — and no ccd call', …);
  it('501 unsupported when the box does not advertise route-apply-v1 — never a silent drop', …);
  it('builds route --session <id> --set effort=high --apply --surface pwa --actor <device actor> when both caps stand', …);
  it('omits the actor flags when actor-flags-v1 is absent, keeps --apply', …);
  it('a ccd refusal is a 502 carrying stderr', …);
  it('is NOT in auth/gate.ts EXEMPT (session-gated like /prompt)', …);   // read the EXEMPT set as coord-pause-route.test.ts does
});
```

`server/test/no-routing-keystroke-from-server.test.ts` — the typer census: walk every `.ts`/`.tsx` under `pwa/src` and `server/src`; no line may contain a string literal (`'`, `"` or backtick immediately before) beginning `/effort` or `/model`; the ONLY permitted survivors are comment lines (a line whose first non-space characters are `//`, `*` or `/*`); the mutation: `pick` calling `api.prompt(id, '/effort high')` reds. Measure the census on the pre-task tree first: it must red on `pwa/src/lib/models.ts` today (the `command:` literals), which proves the scan sees the literal form.

`pwa/test/models.test.ts`: rewrite the `commands` helper to `routes` (`(o) => \`${o.route.field}=${o.route.value}\``); every option carries `route` with a field in `ROUTE_WRITABLE_FIELDS` and no `command` key (`'command' in o` false); the gpt lane's four rows are `class=fable, class=opus, class=sonnet, class=haiku` with the GPT labels; the Anthropic lane's five end with `class=default`; the gpt lane never offers `class=default`; `Ultracode` present only off the gpt lane; `Auto` → `effort=auto`. `pwa/test/session-pickers.test.tsx` (the `session-lifecycle.test.tsx` harness — `vi.mock` of `../src/lib/api` with `route: vi.fn()`, the Virtuoso mock, `SessionScreen` rendered against a store seeded with one session): a tap on `High` calls `api.route(id, 'effort', 'high')` and renders `queued`; a fleet frame with `effort: 'high'` clears it; a tap on `Opus 5` calls `api.route(id, 'class', 'opus')` and clears on `model: 'Opus 5'`; `api.prompt` is NEVER called by a picker tap.

- [ ] **Step 2: Run to verify they fail** — `cd server && ./node_modules/.bin/vitest run test/sessions-route-route.test.ts test/no-routing-keystroke-from-server.test.ts`; `cd pwa && ./node_modules/.bin/vitest run test/models.test.ts test/session-pickers.test.tsx` → FAIL.

- [ ] **Step 3: Implement** as the Interfaces block spells. Remove `pick(command)`'s `api.prompt` call; rewrite the `changeModel`/`changeEffort` comment at `SessionScreen.tsx:217` ("the chooser sheets send `/model <alias>` … directly") to say the sheets write the record and ccd types; `PickSheet` is unchanged (it hands back the option).

- [ ] **Step 4: Run to verify they pass** — the four suites plus `whitelist-subset`, `box-token-census`, `coord-pause-route`, the whole `pwa` suite, `typecheck-tests`.

- [ ] **Step 5: Mutation check, measured** — restore `api.prompt(id, '/effort …')` in `pick` → the census reds; drop the `ROUTE_APPLY_CAP` gate → the 501 case reds; add `command` back to a `PickOption` → `models.test.ts` reds.

- [ ] **Step 6: Commit** — `feat(routing): the pickers write the record through POST /api/sessions/:id/route and show queued until the pane reads it back (routing slice 4, Task 5)`.

---

### Task 6: The new-session sheet's optional routing row, and the placement forecast by class on the projects list

**Files:**
- Modify: `pwa/src/fleet/NewSessionSheet.tsx`, `pwa/src/lib/api.ts` (`createSession` body, `projects(cls?)`), `pwa/src/fleet/ProjectCard.tsx` (the `none` copy), `shared/api.ts` (`ProjectPlacement`'s `none` arm gains `class?: string`), `server/src/limits.ts` (`projectPlacement` threads `cls`, `shares`, `nowS`), `server/src/server.ts` (`GET /api/projects` reads `?class=`)
- Test: `pwa/test/new-session-sheet.test.tsx`, `server/test/projects-route-class.test.ts` (new), `server/test/projected-home.test.ts` (the `none` arm's wire shape), a `ProjectCard` case in whichever `pwa/test` file already renders it (`grep -l ProjectCard pwa/test/*.tsx`)

**Interfaces:**
- Consumes: Task 3's `route?` on `POST /api/sessions`; slice 3's `projectHome(roster, limits, pool, cls, shares, nowS)` and `readSharesMeasured(io, registryDir)` / `SharesRead`; `CLASSES` (`shared/api.ts`); `effortOptions`' Ultracode rule.
- Produces:
  - `projectPlacement(roster, limits, pool, cls = 'default', shares = { kind: 'absent' }, nowS)` — the three trailing parameters defaulted so every existing caller is byte-identical; the `none` arm is `{ kind: 'none', pool, class: cls }` when `cls !== 'default'` and unchanged otherwise (D-2854's TypeScript half: the third meaning of `none`, told apart on the wire).
  - `GET /api/projects?class=<c>`: `c` outside `CLASSES ∪ {'default'}` → 400 `bad-request`; with a class, `readSharesMeasured` once per request and `poolCells` passes `(cls, shares, nowS)`; no `class` → byte-identical to today's answer (no shares read).
  - `api.projects(cls?: string)` appends `?class=` only when given.
  - The sheet's step 2 gains one row of three `<select>`s under the project list — `Class` (`Coordinator row` (unset) / Default / Fable / Opus / Sonnet / Haiku — the four names drawn from `CLASSES`), `Effort` (unset / Auto / Low / Medium / High / Xhigh / Max / Ultracode — the labels drawn from `effortOptions(wrapper, null, false)`, so Ultracode is present only for an Anthropic account), `Workflows` (unset / on / off); the body carries `route` with only the set keys; a one-line note reads "Unset fields take the coordinator row (Fable · ultracode, Sonnet subagents, workflows on). If the account can't serve the class today, ccd starts one rung down and restores it when it can."
  - `ProjectCard`: when `placement.placement.kind === 'none'` carries `class`, the add label reads `New workspace on <project> — no lane can serve <class>` (rendered only when the row was fetched with a class; today's fetch never is, so the fleet screen's copy is unchanged).

- [ ] **Step 1: Write the failing tests** — `projects-route-class.test.ts` (the `routes.test.ts` idiom with a planted sweep file the way `ccd-serviceable.test.ts`/`shares.test.ts` plant it): `?class=fable` with every lane's share at the ceiling → every row's `placement` is `{ kind: 'none', pool: …, class: 'fable' }`; `?class=bogus` → 400; no `class` → the response byte-identical to a request made before the change (pin by deep-equal against the same fixture without the query). `projected-home.test.ts`: the `none` arm with a class carries it, and without one carries no `class` key. `new-session-sheet.test.tsx`: the row renders only at step 2; unset selects post no `route` key; `Opus`+`High` posts `route: { class: 'opus', effort: 'high' }`; `Ultracode` is absent for the gpt account; the note text is present. `ProjectCard`: a measured `none` with `class: 'fable'` renders `no lane can serve fable`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** — the selects are plain `<select>`s in the existing sheet styles (no new component); values are drawn from `CLASSES` and `effortOptions` — never a respelled list; `createSession` sends `route` only when at least one key is set (the `crossPool` rule: an ordinary start keeps the request shape it sent before).

- [ ] **Step 4: Run to verify they pass** — the four suites plus the whole `pwa` suite, `single-definition` (the class names appear only via `CLASSES`), `typecheck-tests`.

- [ ] **Step 5: Mutation check, measured** — drop `class` from the `none` arm → the placement test reds; post `route: {}` when nothing is set → the sheet test reds; validate `class` against a respelled list → `single-definition` reds.

- [ ] **Step 6: Commit** — `feat(routing): the new-session sheet seeds the record; the projects list forecasts placement by class (routing slice 4, Task 6)`.

---

### Task 7: `ccrc-api runs signals` (D-2842's carry) and the coordinator reference's routing sentences

**Files:**
- Modify: `ccd/ccrc-api` (one `ROUTES` row, the two count words at `ccrc-api:24` and `:76`), `server/test/ccrc-api.test.ts` (`ROWS`, `toHaveLength`, the `WORDS` map), `ccd/coordinator-skill/references/wave-lifecycle.md` (§2 at line 89 and §160–169; the signals section at line 678), `ccd/coordinator-skill/SKILL.md` (step 2 at line 246)
- Test: `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts` (corpus parity — a fenced `ccrc-api runs signals` example must map to the table), `server/test/coordinator-skill.test.ts`

**Interfaces:**
- `[runs.signals]='GET|/api/runs/{id}/signals|yes|-'` beside `runs.items-list` in `ROUTES`; the count word `twenty-two` → `twenty-three` at BOTH scanned sites (`ccrc-api.test.ts`'s two regexes); `WORDS` gains `23: 'twenty-three'`; `ROWS` gains `[['runs','signals'], …]` in that file's row shape; `toHaveLength(23)`.
- `wave-lifecycle.md` §2: the body line at 89 becomes `{"brief":"<the wave brief, prose>","items":["<title>", …],"route":{"class":"…","effort":"…","subagent":"…","workflow":"…"}}` and a paragraph after the `items` paragraph (line 160–169): `route` — an object of the writable fields (`class`, `effort`, `subagent`, `workflow`, `compact`), vocabularies as `references/routing-matrix.md` spells them; the server passes it to ccd on the wave-1 `ws-add` argv and, for wave N ≥ 2, through the routing verb before the `/clear`; an old ccd cannot take it and the server journals the omission (`route-omitted:…` run events) — the brief still names the routing in prose (clause 12). The signals section (line 678): the run's signals are read with `ccrc-api runs signals <run>` — one fenced example. `SKILL.md` step 2: the body is `{"brief", "items", "route"}`, `route` being what clause 12 derives.

- [ ] **Step 1: Write the failing tests** — `ccrc-api.test.ts`: the `ROWS` entry, the count; `coordinator-skill.test.ts`: `wave-lifecycle.md` §2 names `"route"` beside `"brief"` and `"items"` (a sentence-literal `toContain` in the linkage describe's style) and `SKILL.md` step 2 names the three keys.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** — the row, the two words, the two reference edits and the SKILL.md sentence — no clause changes, no clause count-word changes, no destructive verb, no unregistered route (`GET /api/runs/:id/signals` is registered at `routes.ts:1924`).

- [ ] **Step 4: Run to verify they pass** — plus `ccrc-api-closed`, `worker-skill`, `routing-references`, `install-coordinator-skill`'s suite (`ls server/test | grep -i coordinator`).

- [ ] **Step 5: Mutation check, measured** — remove the client row → the count test AND the closed-corpus parity red; delete the §2 `route` sentence → the coordinator pin reds.

- [ ] **Step 6: Commit** — `feat(routing): ccrc-api runs signals; the coordinator's dispatch carries route beside brief (routing slice 4, Task 7)`.

---

### Task 8: Ship agent-first and measure the gate — continuous attribution begins

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` §6 (the gate row)

- [ ] **Step 1: The full suites, in chunks** (server in four chunks that partition `ls server/test/*.test.ts` exactly; agent; pwa; `deviation-refs` and `dtbd` after a real `git fetch origin main`).
- [ ] **Step 2: Push** to the branch (PR #116 already carries the branch; retitle/re-body it for slices 2–4 through `gh api -X PATCH repos/Synapsium-Labs/ccrc-pwa/pulls/116 -F title=… -F body=@<file>` — `gh pr edit` fails silently on this org; read both back). Never merge.
- [ ] **Step 3: Deploy, agent lane first** (`bash deploy/deploy.sh agent` — ccd, the skill references), then the server (`bash deploy/deploy.sh` — dispatch, the routes, the PWA); `/health` must report the shipped sha.
- [ ] **Step 4: The gate.** (a) The picker lever on the CONTROLLER's OWN session through the SHIPPED verb on the fleet box: `ccd route --session <own id> --set effort=high --apply --actor controller --reason "slice 4 gate"` — the verb queues (the controller is mid-turn), the tick applies it at the next idle boundary: record the `route-skip`/ack lines in `swap.log`, the session's `routeapplied`, the statusline's `· high`, the timestamps and the exact acknowledgement line; then write `ultracode` back the same way (Fable's cache is measured safe, D-2808). (a′) The HTTP door `POST /api/sessions/:id/route` from the PWA — PENDING the operator's tap; never forged. (b) The next dispatched wave on this fleet carries `route` in its dispatch body — PENDING if none has dispatched; read its worker's `route` rows (`dec.reason argv`) and its first spawn line. (c) The next operator spawn on an Anthropic lane carries the coordinator row (`route` rows with `dec.actor spawn`) — PENDING until one happens; never spawn one for the measurement. (d) `ccrc doctor`'s routing arm: still WARN on the three lanes (S1-R13 flips to FAIL in slice 5).
- [ ] **Step 5: Commit the row** — `docs(research): slice 4 gate — the picker lever applied by the tick, attribution begins (routing slice 4, Task 8)`.

---

## Deviations found

Issued by `POST /api/ledger/deviations` on 2026-09-16 (one block of thirty-five, D-2886..D-2920, minted after the whole-branch review) and defined here in the same act. Every one records a departure from THIS plan's text or a defect in it; the controller's rulings S4-R1..S4-R15 are in the slice's ledger. Slice 4's shipped commits: e33f351c (Task 1), 3e9dd495/e3edaf4d/ad375ce5 (Task 2), d4d03cbc/2732769e/bb2ec8eb (Task 3), 301a7159/5e3cd9d3/c4ad9400/1ff069fd (Task 4), bfe912e5/6ab85098/a2d0886f (Task 5), 10f113e5/e3767488/bb8e511d (Task 6), d687fe3b/839a2319/24fe7a3b (the merge with origin/main dba672ac), 44d38b24 (Task 7), bae91973/ab1465cc (the final review's fix wave).

- **D-2886 — Task 1, decision (a): `--model <alias>` is HONOURED and MAPPED on the codex lane.** Measured 2026-09-15 (research §6 row 'S1-R10, slice 4'): four aliases resolve to four ids through that lane's `ANTHROPIC_DEFAULT_<CLASS>_MODEL` env keys; `opus` is the lane default and indistinguishable by construction. Consequence: `_route_seed_default` writes the coordinator row on EVERY lane (the plan's `_is_anthropic_backend` gate and its 'no default row on the codex lane' case are gone); on that lane the first settle degrades `fable` to `opus` by slice 3's backend rule and stamps `inert=effort,workflow`; `_spawn_start`'s S1-R10 comment rewritten as measured.
- **D-2887 — Task 1, decision (b): `{"enableWorkflows":false}` is HONOURED.** Row 231: the verbatim refusal `Ultracode needs dynamic workflows enabled` under `false`, ultracode accepted under `true`, settings byte-identical. Consequence (Task 4, R1): `_spawn_start` composes `--settings '{"enableWorkflows":false}'` for `workflow=off` on an Anthropic lane and no longer stamps `inert=workflow` for it; the slice-1 pin in `ccd-route-spawn.test.ts` that asserted the old stamp is replaced.
- **D-2888 — Task 1, decision (c): the `/model` picker opens on the CURRENT row, `Up` on row 1 WRAPS, Fable is listed only while current, the codex lane labels rows by model id with `Custom <Class> model` as the description.** Row 232. Consequence (Task 4, R2): `_route_type_model` parses the rows off the pane and moves by the DELTA from the cursor row (never an ordinal, never 'pin with Up×N'); matches by label on Anthropic lanes and by description on non-Anthropic lanes; a class with no row is `no-picker-row` and lands by argv at the next settle.
- **D-2889 — Task 1: Claude Code on the box is 2.1.273, not the plan's 2.1.270.** Every row records 2.1.273; nothing measured differs from D-2808's rows.
- **D-2890 — Task 2: the plan's row-5 mutation ('change the reason arm to `! _class_gate` → the unmeasured fixture reds') cannot red.** `cmd_ws_add`'s refusal builder walks behind the same `_account_ok`/`_pool_ok` predicates `_ws_least_loaded` filters on, so a lane answering rc 2 there was already PLACED and the builder never runs. Shipped control (3e9dd495, row 5b): delete the arm → case (e) reds. A plan defect, recorded.
- **D-2891 — Task 2, ruling S4-R2: `cmd_ws_add --actor` refuses control characters.** The plan's `_route_argv_write` echo interpolates `$actor` into swap.log; a newline forged a second audit line — the hole S1-R4 closed on `cmd_route`. Refused before any mint (ad375ce5).
- **D-2892 — Task 2, ruling S4-R3: `start`/`enable --route` on an EXISTING session writes the pairs.** The plan put `_route_argv_write` on the minting arm only, so a revival validated, wrote nothing, journaled nothing and exited 0. The revival arm writes with the OLD value rendered as `cmd_route` renders it (`class: sonnet -> opus`), actor `start`, reason `argv` (ad375ce5). Completed for the `_alive` arm by D-2919.
- **D-2893 — Task 2, ruling S4-R4: a field given twice on the argv is refused.** The plan's `_route_argv_class` returned the FIRST `class=` while `_route_argv_write` kept the LAST, so placement and the record could disagree; `_route_argv_check` dies `--route <f> given twice` before any mint (ad375ce5). Two more pins from the same ruling: the D-410 shape (`--route` after the positional; `--route` as the last token) and the swap.log lines.
- **D-2894 — Task 3: `CCD_ARGV.route` (and every route builder) emits `--actor`/`--reason` only, never `--surface`.** The plan's Interfaces block appended `decFlags(dec)`; the real `cmd_route` has no `--surface` arm and dies on it — `ccdargv-dec-parity.test.ts`, a real-binary suite, caught the literal form. `actorReasonFlags` is the measured builder; `route` stays out of that suite's six dec-appending verbs (d4d03cbc).
- **D-2895 — Task 3, ruling S4-R5 (reversing the controller's own R2): wave N ≥ 2 writes ONE `route` argv with every `--set` pair.** The plan's per-field loop could leave a half-applied record when a later pair (haiku+effort) was refused; `CCD_ARGV.routeSet` carries every pair in `ROUTE_WRITABLE_FIELDS` order so `cmd_route` validates all before writing anything; it throws on zero fields; enumerated in `whitelist-subset` under the same grant (bb2ec8eb). `CCD_ARGV.route` (single field) stays for slice 5's door.
- **D-2896 — Task 3: `POST /api/sessions`' cross-pool arm carries `route`.** The plan named `start`/`enable`/`wsAdd`/`wsAddWorker`; the cross-pool arm (`startCross`/`enableCross`) returned before the route-carrying call and would have dropped an operator's routing silently (review Important, 2732769e).
- **D-2897 — Task 4: `ROUTE_NOTE_FLOOR` already existed.** The plan asked for a NEW constant beside `COMPACT_NOTE_FLOOR`; slice 1 had defined it (1800, `_route_note_floored`, the route-reject floor). Reused, its comment extended ('equal by choice, not by derivation') — a second spelling would have been unpinnable by `ccd-arith-containment`'s uniqueness-anchored table.
- **D-2898 — Task 4: the supervise beat counts the seconds a tick spends typing.** The plan put the applier on the supervise tick and said nothing about its cost; a slider is 20–35 s of TUI pacing against a heartbeat that assumed a 5 s tick, so the 120 s freshness window could be crossed. `cmd_supervise` stamps `t0` and adds `spent` to the beat (c4ad9400).
- **D-2899 — Task 4: `ROUTE_APPLY_CAP` landed in Task 4, not Task 5.** The plan assigned the `ccdargv.ts` constant to Task 5; the token's three spellings (`cmd_caps`, `KNOWN_CAPABILITY_TOKENS`, the constant) landed together with the parity assertion (c4ad9400).
- **D-2900 — Task 4, ruling S4-R7: a refused apply is retried three times, ten minutes apart, then gives up.** The plan's tick re-attempted every 5 s for ever — `/effort ultracode` refused on an enableWorkflows:false lane would have typed into a live pane twelve times a minute indefinitely. `$REG/<id>.routetries`, `ROUTE_RETRY_BACKOFF=600`, `ROUTE_RETRY_MAX=3`, `apply-gave-up`; cleared by any `cmd_route` write, the settle's stamp, an empty pending set; idle refusals never count (1ff069fd).
- **D-2901 — Task 4, ruling S4-R8: an ABSENT class or effort is nothing pending; a record with no `routeapplied` file is SEEDED from its served values without typing.** The plan's `class=default`/empty → 'type the Default row' collapsed absence into default, and a partial record with no stamp would have had `/model` typed into it on the first tick. Absence is nothing pending, exactly as the settle treats it; the seed writes `routeapplied-seeded` to swap.log (1ff069fd). The seed's CONDITION is narrowed by D-2916.
- **D-2902 — Task 4, ruling S4-R9: fields named in `inert` are neither claimed applied nor typed.** The plan's settle stamp `effort=<reff or auto> workflow=<on|off>` was unconditional, so a codex-lane session asserted `effort=high applied` beside `inert=effort`; `_route_inert_has` is the single reader and both the stamp and the pending gate skip inert fields (1ff069fd). The settle also omits `workflow` when the record is silent about it — absence is neither `on` nor `off`.
- **D-2903 — Task 4, ruling S4-R9: `_route_effort_for` gained a `quiet` argument and `_route_type_effort` a third rc.** The tick's cheap gate decided through a path that could WRITE a pair note; `quiet` routes the read through `_route_peek` with no note. `ROUTE_EFFORT_STOPS` (the slider ORDER, the measured thing) replaces a hand-kept ordinal map; a level with no stop is `no-slider-stop` (rc 2), a distinct refusal word (1ff069fd).
- **D-2904 — Task 5: the queued badge clears on the row's statusline KEY, not the label prefix.** The plan's rule 'live.model contains the picked row's label prefix' fails on the gpt lane (three rows share `GPT-5.6`); `PickOption.readback` carries the same key `active` matches (bfe912e5), pinned per row on both lanes (a2d0886f).
- **D-2905 — Task 5: two files outside the plan's list changed of necessity.** `pwa/src/session/PickSheet.tsx` (its `onPick` carried the `command` string the slice removes) and `pwa/test/lifecycle-ui.test.tsx` (two overflow-menu tests pinned the old `api.prompt('/model …')` typing; converted to assert `api.route` and never `api.prompt`).
- **D-2906 — Task 5: `server/test/verb-gate.test.ts` was DEAD at module load from bb2ec8eb to 6ab85098.** Its probe calls every `CCD_ARGV` builder with four bare strings; D-2895's `routeSet` throws on zero fields, so the whole file errored before any assertion for three commits and its ungated-call-site census never ran. Repaired with a `PROBE_ARGS` override and `CAP_GATED_VERBS = {route}` (a bare `capSupported(` answers the verb's skew question), pinned in both directions (6ab85098). Touched-file suite lists skip repo-wide guards — again.
- **D-2907 — Task 5: the queued timer is installed BEFORE the await.** The plan's `pick()` sketch installed the 60 s timer after `await api.route(...)`; a read-back landing during the request left a timer that toasted a false 'not confirmed' (6ab85098).
- **D-2908 — Task 6, ruling S4-R12: the `none` arm carries `class` only when the CLASS emptied the pool.** The plan attached `class` whenever a class was asked, so an all-disabled pool rendered `no lane can serve fable` — the collapse D-2854's own docstring forbids. `projectPlacement` re-calls `projectHome` class-blind and attaches `class` only when that call places (bb8e511d). D-2854's TypeScript half, done honestly.
- **D-2909 — Task 6: `?class=` present but blank is refused (400), not the silent default path.** Stricter than the plan's 'no class → byte-identical'; only a wholly absent key takes the byte-identical path (10f113e5).
- **D-2910 — Task 6, ruling S4-R13: the sheet's Class select reads in capability order with the class word appended.** The plan listed Default / Fable / Opus / Sonnet / Haiku; `CLASSES` is ladder order (Haiku first) and `modelOptions`' labels on the gpt lane carry no class word (`GPT-6 Astra`). Rendered `[...CLASSES].reverse()` with `— <class>` appended (`GPT-6 Astra — fable`), still derived from `modelOptions`/`CLASSES` (bb8e511d).
- **D-2911 — The merge, ruling S4-R11: the held-out panel is the review brief's SHAPE, run by the REVIEWER — coordinator clause 14.** Routing spec §4 said the panel is 'invoked by a new twelfth coordinator clause'; main's review-runs design (2026-09-14, #108) holds clause 12 ('a verified wave-done is READ by a review run, never by this session'). Merged as fourteen clauses (12 review run verbatim, 13 routing brief verbatim, 14 the panel as the shape); `review-brief.md`'s `Lenses:` line names `review-panel.md`; the panel's `repo` is the reviewer's own worktree at `reviewedTip`; spec §4/§7/§8 amended (d687fe3b, 839a2319, 24fe7a3b). The slice 2 plan's clause numbers are history.
- **D-2912 — The merge, ruling S4-R14: two suites `origin/main` (dba672ac) is red on itself were repaired on this branch.** `crossrepo-prose.test.ts:204` (#100) expected a SQL literal #108 replaced with `${INACTIVE_RUN_STATES_SQL}`; seven `chat.css` selectors from #106/#109 were unregistered in the contrast audit. Repaired here (24fe7a3b) so the merged tree runs green; main's gate did not run those pairs together — reported to the operator.
- **D-2913 — The merge: three census pins slice 4 never re-derived were red at the branch head.** `auth-gate`'s route counts (47 → 48 → 49 on the merge), the `_reg_get` census (142 → 150 → 151), and `_route_escape`'s `send-keys -t "$1"` (the target must derive from the session id; every routing typer now takes the id). All surfaced only at the merge's full-suite run (839a2319, 24fe7a3b).
- **D-2914 — The merge: prose the merger restated beyond the brief.** `wave-lifecycle.md` §5's opening (the handoff review IS a review run; the panel is its shape; the reviewer runs it), `review-panel.md`'s header, two more clause references 12 → 13, and the `finding`-mail send-back sentence dropped in favour of main's step 6 (advance to `working` + a `fix-round` mail) — then removed from `review-panel.md` too (839a2319). `RUN_TRANSITIONS` dropped from `store.ts`'s imports (main replaced every use with `transitionsFor`).
- **D-2915 — Final review #5 (a plan issue): the compactor and the applier may not type into one pane on one tick.** The plan put `_route_apply_check` 'beside `_auto_compact_check`' and said nothing about ordering; one tick at ctx 95% with a pending class sent `/compact`, `Enter`, `/model`, `Enter`, `Escape` into the same pane. `ROUTE_COMPACT_QUIET=30` and `_route_compact_settling` read the compactor's own `lastcompact` — gate 4 of 5 in the tick and the first arm of `--apply` (bae91973).
- **D-2916 — Final review #1 (Critical; a hole in ruling S4-R8): 'no `routeapplied` file' is now a fact the WRITERS maintain, not a proxy assumed at deploy.** The settle deletes the file for a session with no record, so a never-routed session written by `cmd_route` on a busy pane had no file either and the tick SEEDED it as applied instead of typing. `_route_applied_before_write` seeds the PRE-write stamp in both routing writers (`cmd_route`, `_route_argv_write`), so the write that follows is a genuine divergence; the seed is silent on empty words (bae91973). Narrows D-2901.
- **D-2917 — Final review #4: a class write voids a stale `degraded` stamp at write time.** A standing `degraded` overrode every later class write silently. `_route_stale_degrade_clear` extracts the settle's S3-R7 staleness test into one reader, called by both routing writers on a class write (through `_route_restore`, journaled) and by the settle as the backstop (bae91973).
- **D-2918 — Final review #3: the model acknowledgement is bound to the row the driver moved to.** `Set model to .* for this session only` bound no subject, so a stale line confirmed a change that never happened. `_route_ack_subject`/`_route_re_quote` bind on the target row's label or description-derived model name; `_route_ack_wait` reads a `rows` window (12, the picker's own); the codex `Default` row keeps `.*` deliberately — its ack is unmeasured (bae91973).
- **D-2919 — Final review #2: `start`/`enable --route` on a LIVE session writes the pairs.** D-2892's write sat below `cmd_start`'s `_alive` early return, unreachable in the suite because the stub made `_alive` false; the alive arm now writes before `already running` (`START_ALIVE` stub, two cases; bae91973).
- **D-2920 — Plan text never delivered, by design: the file table promised `pwa/src/lib/api.ts` a `workspaceAdd(project, route?)` no task built, and `api.projects(cls)` / `ProjectPlacement.none.class` ship with no PWA caller.** The fleet screen's class chooser (slice 5) is the consumer; the wire and the server side are in place so that chooser is one component.

## Carried to slice 5 / 6

- **Spec §5.3 "Coordinator decisions" vs coordinator clause 1** (a coordinator "runs `ccd route` locally" while clause 1 forbids running ccd to change fleet state): slice 5's escalation/demotion door is `POST /api/runs/:id/route` (box-token gated, built on `CCD_ARGV.route` with `dec`), and §5.3 is amended in that PR.
- **The doctor's `CLAUDE_CODE_SUBAGENT_MODEL` arm back to FAIL** (S1-R13) once every LIVE session carries a record — slice 5 adds a census of live sessions without one and flips the arm when it reads zero; the three lanes' keys are then the operator's to remove.
- **The `compact` field's read** in `_auto_compact_check` — slice 6, after the graphify compaction card ships.
- **A class chooser on the fleet screen** (so `GET /api/projects?class=` gains a PWA caller) — slice 5, with the coordinator's escalation door.
- **The `.agents/` sidecars** slice 0 found never written: the sweep is the subagent observer; no slice re-adds them.

## Self-review against the spec

- §5.3 writers: dispatch wave 1 (argv, `route-argv-v1`, omitted + journaled without it) — Task 3; wave N ≥ 2 (the verb before `/clear`) — Task 3; operator spawn (the sheet, unset = coordinator row, ccd writes after the mint, `_ws_slug_free` untouched) — Tasks 2 and 6; live change (pickers stop typing, `--apply`, queued until read-back) — Tasks 4 and 5; coordinator decisions (no `--apply`) — unchanged; the verb's grant — unchanged; the supervise tick (`_route_apply_check`, the compactor's own predicate, `routeskip` its own field) — Task 4; the audit trail (`route` rows, `recordRunEvent` on an open run) — Tasks 2–4; typers (exactly one writer) — Task 5's census. ✓
- §5.2 class live (`/model` session-only, D-2811's hazard, the cursor read off the picker) — Task 4; effort (session-only keys, D-2808/D-2810) — Task 4; `auto`/`workflow` inert live — Task 4. ✓
- §4 coordinator row for un-flagged operator spawns, and placement by that row's class — Task 2. ✓
- §7 slice 4 behaviour changes (workers on their row, operator sessions on Fable · ultracode, picker taps on the next idle tick) and gate (continuous attribution begins) — Task 8. ✓
- §8 rows 3 (the `route-v1` gate omits the flag on no evidence — Task 3's no-token case), 5 (the coordinator never passes `--apply` — unchanged, the skill test and the argv census), 6 (the idle predicate — Task 4's mid-turn fixture), 7 (`routeskip` its own field — Task 4's row-7 fixture). ✓
- Slice 1 carries: `--model <alias>` probe (Task 1), `{"enableWorkflows":false}` (Task 1), `CCD_ARGV.route` actor/reason (Task 3), `ROUTE_CAP`'s runtime consumer (Task 3), the `ccrc-api` row (Task 7). Slice 3 carries: the placement rung fallback and the reason arm (Task 2, D-2854), `ProjectPlacement.none.class` (Task 6, D-2854's TypeScript half). ✓
- Verified against the tree before commit (2026-09-15): `cmd_enable` forwards to `cmd_start` (so `--route` is forwarded, not parsed twice); no `GET /api/projects/:project/placement` exists — placement rides `ProjectRow.placement` on `GET /api/projects`, which is where `?class=` goes; the harness exposes `home`, `sh`, `reg`, `calls`, `makeRepo` — no `worktrees`/`cfgDir` helpers; `ccrc-api`'s table is `declare -A ROUTES` with two scanned count words; the compactor's note order is pane-unreadable, pane-blank, auto-continue, no-ctx-segment, (threshold), post-swap, mid-turn, no-prompt, no-pane-pid, status-unreadable, not-idle, quiet-unmeasured, not-quiet, drafting; `pwaDec(req)` is the human-driven dec; `modelOptions('gpt')` already maps GPT tiers onto the four class aliases.
