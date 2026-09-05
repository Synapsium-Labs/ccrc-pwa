# Graphify read side at the ccrc level — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move graphify's read side out of the account-wide `CLAUDE.md` block ccrc does not own and into the five artifacts ccrc installs outright — the session hook, the worker skill, the pinned venv on `PATH`, the hookstate file — and make its effect measurable instead of asserted.

**Architecture:** Five mechanisms, each landing in an artifact ccrc already owns and already tests. R4 puts a `graphQueries` counter in the hookstate the session hook already writes, carries it onto `FleetSession` additively and renders it as a `graph N` chip. R1 makes the hook print one `SessionStart` context card measured for the session's own tree. R2 adds clause 12 to the worker skill. R0 retires `_inst_graph_always_on` and replaces it with `_inst_graph_always_on_off`, a remover built from PR #44's own marker census. R3 converges `~/.local/bin/graphify` onto the pinned venv and gives the PATH question its own doctor check. R5 (the `PreToolUse` speed bump) is declined by the spec and has **no task here**.

**Tech Stack:** bash 4.4+ (`ccd/session-hook.sh`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`), `jq`, TypeScript 7 strict (`server/`, `shared/`, `pwa/`), vitest, React 19, node `>=22.13.0`.

**Spec:** `docs/superpowers/specs/2026-09-02-graphify-read-side-ccrc-level-design.md`

## Global Constraints

- **`$CCRC_REPO`** in every command below is the absolute path of your checkout (`export CCRC_REPO=$(git rev-parse --show-toplevel)` once per shell). The plan never spells a real path: the pre-push guard refuses identity residue, and a checkout path is one.

- **Branch:** all work happens on `feat/graphify-read-side-ccrc-level`, cut from `origin/main`. PR #44 is **already merged** (`origin/main` = `651f40c5`, "fix(graphify): the read rule clobbered exactly what its own header promised not to (D-1244) (#44)"), so `origin/main` already carries the hardened census/splice this plan reuses. Conventional commits; **each task ends in its own commit**; nothing is pushed by the implementer.
- **SAFETY (repo `CLAUDE.md`, sacred):** every test uses a FIXTURE `HOME` (`mkTmp`), never the live `$HOME`. Never run `ccd ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units. Never print the contents of a secret file. Deploy is **not** part of this plan (it is AGENT-FIRST and the orchestrator runs it).
- **No new ccd verb, no new agent read root, `EXEC_COMMANDS` unchanged, `gh` untouched.** The server never reads `~/.cache/graphify-queries.log`.
- **Wire discipline:** `FleetSession.graphQueries` is ADDITIVE. Do **not** bump `FLEET_PROTO` (=1). `reviveFleetSession` returns a literal, so the field goes in that literal.
- **Rings:** `shared/*.ts` (L0) imports NOTHING — not even `node:*`. `server/src/hookstate.ts` is an L3 adapter and **may not narrow a distinction it received**: `null` (no field) and `0` (measured none) stay distinct, for `graphQueries` exactly as for `subagents`.
- **The session hook's standing contract is absolute:** exit 0 on every path, write atomically or not at all, **no network, no locks, no waiting**. Every new read is a local file or a git ref. Stdout stays EMPTY on every event but `SessionStart` — on `PreToolUse` a stdout JSON is a permission decision.
- **Platform:** `server/test/macos-platform.test.ts` refuses un-shimmed GNU calls in every shebang'd file under `ccd/` except three named, ratcheted exemptions (`ccclip`, `ccd-graph-sweep`, `ccrc-adopt`) — it enumerated four files (`ccd/ccd`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `ccd/ccrc-api`) when this plan was written, which left `ccd/session-hook.sh` unscanned; **D-1250** derives the corpus from the directory instead, so this plan's own +91 lines of hook shell are covered. No `stat -c`/`stat -f`, no `date +%s%3N`, no `date -d`, no `sha256sum`, no `uuidgen`, no bare `timeout`, no template-less `mktemp`, no `mv -T`, no `du -sb`. `readlink -f` and `realpath` are explicitly ALLOWED. **Use no `awk` in new shell code** (BSD awk refuses a newline inside `-v`). `sed -n "1,0p"` prints line 1, not nothing.
- **Mutation-table discipline:** every guard ships WITH a test that goes RED when the guard is deleted or mutated. Measure the red before/after; a comment is a request, a red suite is a mechanism.
- **Test commands** (never bare `npx vitest` — it resolves a global copy with no jsdom and falsely reports "no tests"):
  - one suite: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts` (likewise in `agent/`, `pwa/`)
  - full suite: `cd server && npm run test` — **FOREGROUND, timeout ≥ 600000 ms**
  - typecheck: `cd server && npx tsc --noEmit -p tsconfig.json`; `cd pwa && npx tsc --noEmit`
  - after every shell edit: `bash -n ccd/ccrc`, `bash -n ccd/session-hook.sh`, `bash -n ccd/ccrc-doctor-checks`
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.

---

## File Structure

**Modified — shell (ships to the fleet host first; the orchestrator deploys):**

| file | responsibility after this plan |
|---|---|
| `ccd/session-hook.sh` | unchanged contract; gains `graphQueries` in the state it already writes (R4) and the single `SessionStart` stdout card (R1). |
| `ccd/ccrc` | `_inst_graph_always_on` DELETED; `_inst_graph_always_on_off` added in its place (R0). `_inst_graphify_engine` gains the `~/.local/bin/graphify` converge (R3). |
| `ccd/ccrc-doctor-checks` | `_check_graphify` loses its PATH-shadow bucket; new `graphify-path` table entry + `_check_graphify-path` owns that question and FAILs on it (R3). |
| `ccd/worker-skill/SKILL.md` | clause 12 (R2); "eleven" → "twelve" in two places. |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | §2 gains one sentence about quoting the card's freshness line in a brief (R2). |

**Modified — TypeScript:**

| file | responsibility |
|---|---|
| `server/src/hookstate.ts` | `HookState.graphQueries: number \| null`; a revive helper that keeps absent (`null`) apart from measured zero. |
| `shared/api.ts` | `FleetSession.graphQueries: number \| null`; `reviveFleetSession`'s literal gains it (absent on the wire → `null`). |
| `server/src/fleet.ts` | maps `hs?.graphQueries` onto the wire beside `subagents`. |
| `pwa/src/fleet/SessionLine.tsx` | `graph N` chip in `.sess-meta`, rendered only when non-null. |
| `pwa/src/screens/RunsScreen.tsx` | the same chip on the run board's worker row. |
| `pwa/src/fleet/fleet.css` | `.sess-graph`, in `.sess-tally`'s quiet register; added to the `.sess-line--active` ink override group. |
| `README.md` | the graphify section's step enumeration and its read-side paragraph, rewritten for R0–R4. |
| `CLAUDE.md` | "eleven clauses" → "twelve clauses". |

**Modified — tests:**

`server/test/session-hook.test.ts`, `server/test/hookstate.test.ts`, `server/test/fleet.test.ts`, `server/test/fleetstate.test.ts`, `server/test/fleet-health.test.ts`, `server/test/bucket.test.ts`, `server/test/worker-skill.test.ts`, `server/test/ccrc-install.test.ts`, `server/test/ccrc-install-graphify.test.ts`, `server/test/ccrc-doctor.test.ts`, `server/test/ccrc-doctor-graphify.test.ts`, `pwa/test/session-line.test.tsx`, `pwa/test/runs-screen.test.tsx`, and 25 PWA/server fixture files that build a whole `FleetSession` literal.

**TWO fixture shapes, not one:** the field lands on `FleetSession` *and* on `HookState`, and
the `HookState` literals are a different spelling the `FleetSession` seds do not touch —
`server/test/fleet.test.ts:24`'s `mkHookState`, `server/test/bucket.test.ts:298` and `:491`. Measured:
adding `graphQueries` to `HookState` alone errors those three sites (`TS2769`/`TS2322`) with tsc
otherwise clean, which is why both files are named above.

---

## Task 1: R4 — `graphQueries`, hook to chip

**Files:**
- Modify: `ccd/session-hook.sh` (the declaration line, the `PostToolUse` arm, the carry block, the `jq -cn` output)
- Modify: `server/src/hookstate.ts`
- Modify: `shared/api.ts` (the `FleetSession` interface, `reviveFleetSession`'s literal)
- Modify: `server/src/fleet.ts:431` (beside `subagents`)
- Modify: `pwa/src/fleet/SessionLine.tsx`, `pwa/src/screens/RunsScreen.tsx`, `pwa/src/fleet/fleet.css`
- Test: `server/test/session-hook.test.ts`, `server/test/hookstate.test.ts`, `server/test/fleet.test.ts`, `server/test/fleetstate.test.ts`, `server/test/fleet-health.test.ts`, `pwa/test/session-line.test.tsx`, `pwa/test/runs-screen.test.tsx`
- Fixtures (mechanical): `server/test/bucket.test.ts` and `server/test/fleet.test.ts` (the two `HookState` literal shapes), and 25 files under `pwa/test/` plus `server/test/fleetstate.test.ts` / `server/test/fleet-health.test.ts` (the `FleetSession` shape)

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first).
- Produces:
  - hookstate JSON field name **`graphQueries`** (integer ≥ 0), written by `ccd/session-hook.sh`
  - `HookState.graphQueries: number | null` (`server/src/hookstate.ts`) — **the one reader the spec names**, and the only place the integer/non-negative contract is enforced: absent → `null`, a non-integer or negative rejects the whole read
  - `FleetSession.graphQueries: number | null` (`shared/api.ts`), revived by the file's existing **`optNum(o, 'graphQueries')`** — absent or explicitly null → `null`, a non-number or non-finite value rejects the whole session. **Deliberately laxer than the reader above, and that is not an oversight:** `optNum` is `shared/api.ts`'s single reader for every numeric field (`shared/api.ts:1700`), a snapshot's value has already passed `hookstate.ts`'s guard on the server that wrote it, and a bespoke `optCount` here would be a second numeric-revive vocabulary in the L0 file — the thing "single-source-of-truth values are enumerated once" exists to stop. Say `optNum`, not "under an integer guard"; the guard lives one layer in.
  - shell regex constant **`GRAPH_QUERY_RE`** in `ccd/session-hook.sh`
  - CSS class **`.sess-graph`**, chip text `graph <N>`

---

- [ ] **Step 1: Write the failing hook tests**

Add to `server/test/session-hook.test.ts`. First change the `run` helper (top of the file) so it returns stdout — existing call sites ignore the return value and are unaffected:

```typescript
/** Run the hook with a payload; env overrides let each test break one leg.
 *  Returns the hook's STDOUT, which is empty on every event but SessionStart
 *  (R1) — `encoding: 'utf8'` is what makes execFileSync hand it back as a
 *  string rather than a Buffer. */
const run = (payload: object, env: Record<string, string> = {}): string =>
  execFileSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env, HOME: home,
      PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
      ...env,
    },
  });
```

Then append this describe block at the end of the file:

```typescript
// ── R4: the read side, MEASURED ───────────────────────────────────────────
// D-1243 shipped an instruction and no number. The whole argument for retiring
// the account-wide block is that its effect measured zero, and the only way
// that sentence stays true (or stops being true) is a counter the console can
// read. `graphify update` and builds deliberately do NOT count: this is
// measuring READS.
describe('graphQueries — the read counter the console can see', () => {
  const bash = (command: string): object =>
    ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } });

  it('counts query, path and explain — each one, once', () => {
    run(bash('graphify query "who calls assembleFleet"'));
    expect(readState().graphQueries).toBe(1);
    run(bash('graphify path "fleet.ts" "watch.ts"'));
    expect(readState().graphQueries).toBe(2);
    run(bash('graphify explain "the mail delivery gate"'));
    expect(readState().graphQueries).toBe(3);
  });

  it('counts a graphify that is not the first word of the line', () => {
    run(bash('cd /tmp && graphify query "x"'));
    expect(readState().graphQueries).toBe(1);
    run(bash('true; graphify explain "y"'));
    expect(readState().graphQueries).toBe(2);
  });

  it('does NOT count graphify update, a build, or a bare graphify', () => {
    run(bash('graphify update .'));
    run(bash('graphify build --all'));
    run(bash('graphify'));
    run(bash('graphify --version'));
    expect(readState().graphQueries).toBe(0);
  });

  it('does NOT count a command that merely contains the word', () => {
    run(bash('mygraphify query "x"'));
    run(bash('echo see-graphify-query-docs'));
    expect(readState().graphQueries).toBe(0);
  });

  it('does NOT count a non-Bash tool whose input happens to say it', () => {
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read',
      tool_input: { command: 'graphify query "x"' } });
    expect(readState().graphQueries).toBe(0);
  });

  it('carries the count across other events, the way subagents is carried', () => {
    run(bash('graphify query "x"'));
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState().graphQueries).toBe(1);
    run({ hook_event_name: 'Stop' });
    expect(readState().graphQueries).toBe(1);
    run({ hook_event_name: 'SubagentStart', agent_name: 'reviewer' });
    expect(readState().graphQueries).toBe(1);
  });

  it('resets to 0 on SessionStart(startup) and SessionStart(clear)', () => {
    run(bash('graphify query "x"'));
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    expect(readState().graphQueries).toBe(0);
    run(bash('graphify query "x"'));
    run({ hook_event_name: 'SessionStart', source: 'clear' });
    expect(readState().graphQueries).toBe(0);
  });

  it('is KEPT across resume and across compact — a compaction is not a new session', () => {
    run(bash('graphify query "x"'));
    run(bash('graphify path "a" "b"'));
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    expect(readState().graphQueries).toBe(2);
    // compact writes nothing at all (D-306), so the count on disk survives it
    run({ hook_event_name: 'SessionStart', source: 'compact' });
    expect(readState().graphQueries).toBe(2);
  });

  it('starts at 0 on a session that has never queried — 0 is a MEASUREMENT', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState().graphQueries).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts`
Expected: FAIL — every assertion on `graphQueries` reads `undefined`, not a number.

- [ ] **Step 3: Implement the counter in `ccd/session-hook.sh`**

(a) Declare the regex once, immediately after the `REG="$HOME/.cc-sessions"` line:

```bash
# ── R4: what counts as READING the graph ────────────────────────────────
# `query`, `path` and `explain` only. `graphify update` and every build are
# WRITES, and the sweep owns the write side — counting them here would make
# the number say the opposite of what it is for. The leading class is what
# stops `mygraphify query` and prose mentioning the command from counting;
# the trailing one stops `graphify querying-something-else`.
GRAPH_QUERY_RE='(^|[;&|[:space:]])graphify[[:space:]]+(query|path|explain)([[:space:]]|$)'
```

(b) Initialise the two new carriers on the existing declaration line (both must be SET before the case block, because the carry block below reads them for every event and this file runs under `set -u`):

```bash
state="" ask_json="null" interrupted="false" src="" gcmd=""
```

(c) Split the `UserPromptSubmit|PostToolUse` arm. `install-session-hooks.test.ts` derives the wired event set from these arm labels with `/^\s{2}([A-Za-z|]+)\)/`, so two arms at two-space indentation still yield both event names — the label TEXT is what must not change, not its grouping:

```bash
  UserPromptSubmit) state="working" ;;
  PostToolUse)
    state="working"
    # ONE payload read for the counter, on the one event that can carry a
    # command, and only for Bash: a tool_input.command on any other tool is
    # not a shell line this box ran.
    #
    # THE PREFILTER IS A BUDGET, NOT A STYLE CHOICE. This arm is the HOT PATH —
    # `session-hook.test.ts` pins p95 of 20 PostToolUse runs under 150 ms, and
    # a bare `jq` fork on this box measures ~5 ms against a ~46 ms run. A shell
    # line that runs `graphify` CANNOT fail to put the eight characters
    # `graphify` somewhere in the payload (JSON escaping never touches them),
    # so a payload without them needs no jq at all and the common tool call
    # pays nothing. `$gcmd` stays "" there, which the increment below already
    # treats as "no command".
    if [[ "$payload" == *graphify* ]]; then
      gcmd=$(jq -r 'if .tool_name == "Bash" then (.tool_input.command // "") else "" end' \
        <<<"$payload" 2>/dev/null) || gcmd=""
    fi ;;
```

(d) Fold the counter into the state-file read that is ALREADY there rather than adding a third fork against the same file. Replace the existing two lines

```bash
subs=$(jq -c '.subagents // []' "$f" 2>/dev/null) || subs="[]"
prev_state=$(jq -r '.state // empty' "$f" 2>/dev/null) || prev_state=""
```

with:

```bash
# ONE fork for all three fields (was two, and the counter would have made
# three). Same hot-path budget as the arm above: `$f` is read on every event,
# and `subs`/`prev_state` were already two forks over one file. Three values on
# three LINES, not `@tsv` — `@tsv` escapes a tab or newline inside a subagent
# name as a backslash sequence, which would hand `--argjson subagents` a string
# that is no longer JSON. `tostring` of a compact array contains no newline, so
# line-splitting is safe where tab-splitting is not.
#
# The read counter survives state transitions exactly as `subs` does, and a
# file that never carried the field reads as 0 — this is the WRITER, where 0
# is the honest start; `hookstate.ts` is the reader, and there absent stays
# `null` rather than folding to 0. A jq that fails (no file, corrupt file)
# prints nothing, all three `read`s come up empty, and each falls back to the
# degrade it already had. This file runs under `set -uo pipefail` and NOT
# `set -e`, so a `read` hitting EOF is inert.
subs=""; prev_state=""; gq=""
{ read -r subs; read -r prev_state; read -r gq; } < <(jq -r \
  '(.subagents // [] | tostring), (.state // ""),
   (if (.graphQueries | type) == "number" then (.graphQueries | floor) else 0 end)' \
  "$f" 2>/dev/null)
[[ "$subs" == \[* ]] || subs="[]"
[[ "$gq" =~ ^[0-9]+$ ]] || gq=0
# `startup` and `clear` are new sessions; `resume` and `compact` are the SAME
# session still going, and a counter that reset on compaction would erase the
# evidence at precisely the moment the session most needed the card (R1).
# `compact` never reaches this line at all — the SessionStart arm exits at its
# compact guard (D-306) — so its carry is STRUCTURAL, protected by that exit
# and not by this condition. `resume` is the source this condition protects.
#
# D-1248 (review): written as "everything except resume", NOT the allow-list
# `( "$src" == startup || "$src" == clear )` this plan first specified — see
# the deviation entry.
if [[ "$event" == SessionStart && "$src" != resume ]]; then gq=0; fi
if [[ -n "$gcmd" && "$gcmd" =~ $GRAPH_QUERY_RE ]]; then gq=$((gq + 1)); fi
```

The subagent branch below still reads `$subs` and `$prev_state` unchanged; only the number of forks
that produced them changed.

(e) Carry it onto the write. Replace the `out=$(jq -cn …)` invocation with:

```bash
out=$(jq -cn \
  --argjson v 1 --arg state "$state" --arg event "$event" \
  --arg sessionId "${CLAUDE_CODE_SESSION_ID:-}" --argjson pid "${CLAUDE_PID:-0}" \
  --argjson updatedAt "$(_hook_epoch_ms)" --argjson interrupted "$interrupted" \
  --argjson ask "$ask_json" --argjson subagents "$subs" --argjson graphQueries "$gq" \
  '{v:$v, state:$state, event:$event, sessionId:$sessionId, pid:$pid,
    updatedAt:$updatedAt, ask:$ask, subagents:$subagents, graphQueries:$graphQueries}
   + (if $interrupted then {interrupted:true} else {} end)') || exit 0
```

- [ ] **Step 4: Run the hook tests and the wiring guard**

Run:
```bash
bash -n ccd/session-hook.sh
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
cd server && ./node_modules/.bin/vitest run test/install-session-hooks.test.ts
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts
```
Expected: all PASS. (`install-session-hooks` proves the arm split did not change the derived event set; `macos-platform` proves `_hook_epoch_ms`'s two copies still agree — and, since **D-1250**, that this task's new hook lines carry no un-shimmed GNU call either, which is what this step was citing it for and could not deliver at the time.)

**Watch `session-hook`'s p95 test specifically** (`'p95 of 20 runs stays under the budget (150ms CI allowance; 50ms target)'`). This task touches the `PostToolUse` hot path, which is exactly what that test exercises, and step 3's two measures exist for it: the fold in (d) keeps the state-file reads at ONE fork instead of three, and the `*graphify*` prefilter in (c) means the p95 fixture's own payload (`{hook_event_name:'PostToolUse', tool_name:'Bash'}`, no command at all) forks nothing new. Baseline on this box: ~46 ms/run, a bare `jq` fork ~5 ms. `session-hook` is on the known-load-flake list, so re-run it IN ISOLATION before treating a red p95 as a real break — but if it is genuinely over, the cause is a fork on that arm, not the reader.

- [ ] **Step 5: Write the failing reader test**

In `server/test/hookstate.test.ts`, add `graphQueries: 0` to the `base()` helper's literal so the writer's real shape is what the suite seeds:

```typescript
/** A complete, valid hookstate body — the writer's own shape. */
const base = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, state: 'working', event: 'UserPromptSubmit', sessionId: UUID, pid: 1234,
  updatedAt: NOW, ask: null, subagents: [], graphQueries: 0,
  ...overrides,
});
```

Add `graphQueries: 0` to the full-object assertion in the `'fresh + matching round-trips every field, including subagents'` test (the `expect(out).toEqual({…})` at the top of the file), then append this describe:

```typescript
// ── graphQueries: null and 0 are two different answers ────────────────────
// An L3 adapter may not narrow a distinction it received. A session that
// reported no queries (`0`) and a session running a hook too old to report at
// all (`null`) are two facts the console shows differently — `graph 0` versus
// no chip — so folding absent to 0 would invent a measurement.
describe('graphQueries', () => {
  it('a measured zero is 0, not null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphQueries: 0 }));
    expect((await readHookState(localIO, reg, ID, UUID, NOW))?.graphQueries).toBe(0);
  });

  it('a count round-trips', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphQueries: 7 }));
    expect((await readHookState(localIO, reg, ID, UUID, NOW))?.graphQueries).toBe(7);
  });

  it('ABSENT is null — an older hook said nothing, which is not "said zero"', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    const body = base();
    delete body['graphQueries'];
    seed(reg, ID, body);
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out).not.toBeNull();
    expect(out?.graphQueries, 'an absent counter was folded to a measured zero').toBeNull();
  });

  it('explicit null is null too', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ graphQueries: null }));
    expect((await readHookState(localIO, reg, ID, UUID, NOW))?.graphQueries).toBeNull();
  });

  it('a non-integer, a negative or a non-number rejects the WHOLE read', async () => {
    // NOT `NaN`: this suite's `seed` helper `JSON.stringify`s the body, and
    // `JSON.stringify(NaN)` is the string `null` — which reads back as a
    // perfectly valid absent counter, so that element would fail the
    // assertion rather than prove it. `true` is the fifth wrong TYPE and
    // survives serialisation, which is what this loop is actually testing.
    for (const bad of [1.5, -1, '3', true, {}]) {
      const reg = mkTmp('ccrc-hookstate-');
      seed(reg, ID, base({ graphQueries: bad }));
      expect(await readHookStateMeasured(localIO, reg, ID, UUID, NOW),
        `graphQueries: ${String(bad)} was laundered into a reading`)
        .toEqual({ ok: false, reason: 'no-state' });
    }
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/hookstate.test.ts`
Expected: FAIL — `graphQueries` is not a property of `HookState` (a tsc error in the suite) and the assertions read `undefined`.

- [ ] **Step 7: Implement the reader**

In `server/src/hookstate.ts`, add the field to the `HookState` interface, immediately after `subagents`:

```typescript
  subagents: { name: string; startedAt: number }[];
  /** How many `graphify query` / `path` / `explain` calls this session has
   *  made since it last started or cleared, as the hook counted them
   *  (`ccd/session-hook.sh`'s `GRAPH_QUERY_RE`). R4 of the read-side design:
   *  the whole case for retiring the account-wide block is that its effect
   *  measured zero, and this is the number that keeps that claim honest.
   *
   *  `null` is NO FIELD — a hookstate written by a hook that predates the
   *  counter. `0` is a MEASUREMENT: this session reported, and it has read
   *  nothing. Folding the first into the second is exactly the narrowing an
   *  adapter may not do, and it would make an un-upgraded fleet box look like
   *  a fleet that ignores its graphs. */
  graphQueries: number | null;
```

Add the revive helper beside `reviveSubagents`:

```typescript
/** `graphQueries` — absent or explicitly null reads as `null` (the writer did
 *  not carry the field), any non-integer or negative number rejects the whole
 *  read. Same split `reviveSubagents` takes: degrade for a field an older
 *  writer never wrote, reject a value this build cannot parse. */
function reviveGraphQueries(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new Malformed('graphQueries');
  }
  return raw;
}
```

And in the `return { ok: true, state: { … } }` literal inside `readHookStateMeasured`, after `subagents,`:

```typescript
        subagents,
        graphQueries: reviveGraphQueries(raw['graphQueries']),
```

- [ ] **Step 8: Run the reader tests**

Run: `cd server && ./node_modules/.bin/vitest run test/hookstate.test.ts`
Expected: PASS.

- [ ] **Step 9: Add the field to the wire**

In `shared/api.ts`, in the `FleetSession` interface immediately after `subagents`:

```typescript
  subagents: { name: string; startedAt: number }[] | null;
  /** How many graph READS this session has made — `hookstate.ts`'s
   *  `graphQueries`, carried through unchanged. ADDITIVE: no `FLEET_PROTO`
   *  bump, and an older peer that omits it revives as `null` below.
   *
   *  `null` mirrors `hookState`/`subagents`: no fresh hook data, or a hook too
   *  old to count. `0` is a MEASUREMENT — the session reported and has read
   *  nothing — and the console shows the two differently (`graph 0` versus no
   *  chip at all), which is the whole reason this is not a `number`. */
  graphQueries: number | null;
```

In `reviveFleetSession`'s `revived` literal, immediately after `subagents: optSubagents(o, 'subagents'),`:

```typescript
      subagents: optSubagents(o, 'subagents'),
      // Absent → null, exactly as `optSubagents` degrades: a snapshot written
      // before this field existed is ignorant of the count, not a witness to
      // its being zero. Present-but-not-a-finite-number throws inside
      // `optNum`, which this function's catch turns into "reject the whole
      // session" — the same rule every other numeric field here follows.
      graphQueries: optNum(o, 'graphQueries'),
```

In `server/src/fleet.ts`, in the `const session: FleetSession = {` literal, immediately after `subagents: hs?.subagents ?? null,`:

```typescript
      subagents: hs?.subagents ?? null,
      // `?? null` and not `?? 0`: no hook data at all and a hook reporting
      // zero reads are two conditions, and `hookstate.ts` already keeps them
      // apart — collapsing them one layer out would undo that on the wire.
      graphQueries: hs?.graphQueries ?? null,
```

- [ ] **Step 10: Update every fixture, and PIN the null degrade at the assembly seam**

**(a) The `FleetSession` fixtures.** Two shapes cover all 27 sites (a 28th, `s({ subagents: null })` in `pwa/test/session-line.test.tsx:267`, is a partial override and needs nothing). Run exactly:

```bash
cd "$CCRC_REPO"
grep -rl 'subagents: null, held: null' pwa/test server/test \
  | xargs sed -i 's/subagents: null, held: null/subagents: null, graphQueries: null, held: null/'
grep -rl 'subagents: null,$' pwa/test server/test \
  | xargs sed -i 's/subagents: null,$/subagents: null, graphQueries: null,/'
```

**(b) The `HookState` fixtures — a SECOND shape the two seds above cannot see.** Those seds match `FleetSession` wire literals (`subagents: null`); a `HookState` literal spells it `subagents: [], interrupted: false`, and adding a required field to `HookState` makes each one a tsc error. Measured: exactly three sites, all sharing one substring — `server/test/fleet.test.ts:24` (`mkHookState`), `server/test/bucket.test.ts:298` and `:491`. One sed does all three, and it writes `0` rather than `null` deliberately: these stand for a session whose hook DID report, which is what makes `fleet.test.ts`'s hookless-null test below a real contrast rather than a repetition.

```bash
cd "$CCRC_REPO"
grep -rl 'subagents: \[\], interrupted: false' server/test \
  | xargs sed -i 's/subagents: \[\], interrupted: false/subagents: [], graphQueries: 0, interrupted: false/'
```

**(c) Pin the null degrade — three one-line assertions, without which Step 15's `?? 0` mutation row is a comment.** (D-1249: three `toBeNull()`s are only HALF the pin — see the extra bullet at the end of this step for the POSITIVE carry, without which the whole assembly seam is deletable.) The seds above only touch *inputs*; nothing yet asserts what an assembled or revived session reports. The analogous field is pinned in all three places already, so put `graphQueries` beside `subagents` in each:

- `server/test/fleet.test.ts` — in `it('a hookless session carries all three fields as null')` (the `expect(s.subagents).toBeNull()` at ~:564), add `expect(s.graphQueries).toBeNull();` and rename the test to **`'a hookless session carries all four fields as null'`**.
- `server/test/fleetstate.test.ts` — beside `expect(s?.subagents).toBeNull()` (~:112) add `expect(s?.graphQueries).toBeNull();`, and add `'graphQueries'` to the `Object.keys(...)` `arrayContaining` list on the next line. (That list is hand-kept: a field revived as `undefined` instead of `null` would be silently omitted from `Object.keys`, which is the whole point of the assertion.)
- `server/test/fleet-health.test.ts` — beside `expect(body.sessions[0]?.subagents).toBeNull()` (~:167) add `expect(body.sessions[0]?.graphQueries).toBeNull();`.

**(c2) Pin the POSITIVE carry too — the seam's other half (D-1249).** Every assertion in (c) is
`toBeNull()`, so all three stay green when `graphQueries: hs?.graphQueries ?? null` (`server/src/fleet.ts`)
is replaced by a literal `null` — the guard deleted outright, the count silently dropped for every LIVE
session, which is the one direction the deliverable actually cares about. `assembleFleet` is the only
seam that puts the counter on the live `/api/fleet` wire (the `reviveFleetSession` path is the
degraded-mode read), so it needs a test that a hookstate count of N arrives as N:

- `server/test/fleet.test.ts` — in the sibling positive test `it('a fresh hookstate carries hookState,
  askSummary and subagents onto the session')` (~:531), add `graphQueries: 7` to the `mkHookState({…})`
  override and `expect(s.graphQueries).toBe(7);` to the assertions, renaming the test to name the
  fourth field the way its hookless sibling was renamed: **`'a fresh hookstate carries all four fields —
  hookState, askSummary, subagents and graphQueries — onto the session'`**.
- …and a second test for the MEASURED ZERO, which `toBe(7)` alone does not cover in the one direction
  that matters: seed `mkHookState({ state: 'working', graphQueries: 0 })` and assert
  `expect(s.graphQueries).toBe(0);`. Together the three points (N, 0, hookless-null) leave no collapse
  at this seam unpinned — `?? 0`, a literal `null`, and `hs ? 0 : null` each redden at least one.

**(d)** Then prove the compiler agrees:

```bash
cd "$CCRC_REPO"/server && npx tsc --noEmit -p test/tsconfig.tests.json
cd "$CCRC_REPO"/pwa && npx tsc --noEmit
```
Expected: both clean. Any site a sed missed is named by tsc with a file and line — add `graphQueries: null,` beside that literal's `subagents:` entry (or `graphQueries: 0,` if it is a `HookState`).

- [ ] **Step 11: Write the failing PWA chip tests**

In `pwa/test/session-line.test.tsx`, append:

```tsx
describe('the graph chip', () => {
  it('renders graph N when the hook counted reads', () => {
    render(<SessionLine session={s({ graphQueries: 4 })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('graph 4')).toBeInTheDocument();
  });

  it('renders graph 0 — a measured zero is the finding, not the absence of one', () => {
    render(<SessionLine session={s({ graphQueries: 0 })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('graph 0')).toBeInTheDocument();
  });

  it('renders NO chip when the count is null — nothing was measured', () => {
    render(<SessionLine session={s({ graphQueries: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText(/^graph /)).toBeNull();
  });
});
```

In `pwa/test/runs-screen.test.tsx`, append. It uses that file's own `r()` / `sess()` / `makeStore()` / `NO_CAPS` helpers exactly as the `unmeasured` test at line ~416 does — `sess()`'s default id is `ccrc-pwa-clear-cove`, which is `r()`'s default `sessionId`, so a one-run/one-session store links them:

```tsx
describe('the run board worker row carries the graph chip', () => {
  const board = (over: Partial<FleetSession>): void => {
    const store = makeStore();
    act(() => {
      store.setState({ runs: [r()], runsFrameSeen: true, sessions: [sess(over)] });
    });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
  };

  it('shows graph N for the run session the hook counted reads for', () => {
    board({ graphQueries: 3 });
    expect(screen.getByText('graph 3')).toBeInTheDocument();
  });

  it('shows graph 0 — the row this chip exists for is the one that read nothing', () => {
    board({ graphQueries: 0 });
    expect(screen.getByText('graph 0')).toBeInTheDocument();
  });

  it('shows NO chip when nothing was measured', () => {
    board({ graphQueries: null });
    expect(screen.queryByText(/^graph /)).toBeNull();
  });
});
```

- [ ] **Step 12: Run them to verify they fail**

Run:
```bash
cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx
```
Expected: FAIL — "Unable to find an element with the text: graph 4".

- [ ] **Step 13: Render the chip**

In `pwa/src/fleet/SessionLine.tsx`, immediately after the `.sess-tally` block and before the subagent disclosure:

```tsx
          {/* The read counter (R4). `!== null` and NOT a truthiness test: a
              measured zero is the finding this chip exists to show — a session
              with a fresh graph in its tree that has queried it not once — and
              `graphQueries && …` would hide exactly that row. Null is the
              other answer (no hook data, or a hook too old to count), and it
              renders nothing at all rather than a `graph 0` nobody measured.
              A plain cell in .sess-meta, so the shared
              `.sess-meta > *:not(:first-child)::before` rule punctuates it
              like every sibling; no disclosure, because there is nothing
              underneath a count to open. */}
          {!dead && session.graphQueries !== null && (
            <span className="sess-graph" title={`${session.graphQueries} graphify read(s) this session`}>
              graph {session.graphQueries}
            </span>
          )}
```

In `pwa/src/screens/RunsScreen.tsx`, immediately after the `{verdict !== null && (…)}` block:

```tsx
      {/* The worker's read counter, in the fleet card's own class — the same
          reuse this row already makes of `.sess-spawn` and `.sess-unmeasured`
          next door, and for the same reason: a second `.run-…` class for one
          meaning is two vocabularies over one field. */}
      {session !== null && session.graphQueries !== null && (
        <span className="sess-graph" title={`${session.graphQueries} graphify read(s) this session`}>
          graph {session.graphQueries}
        </span>
      )}
```

In `pwa/src/fleet/fleet.css`, immediately after the `.sess-cleanup-fact { … }` rule:

```css
/* The hook's graph-read counter — same quiet register as .sess-tally, no
   colour of its own (it inherits .sess-meta's ink-secondary), so it brings no
   new contrast pair with it. */
.sess-graph {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  flex: none;
}
```

…and add it to the active-row ink override group, beside `.sess-line--active .sess-tally,`:

```css
.sess-line--active .sess-tally,
.sess-line--active .sess-graph,
```

- [ ] **Step 14: Run the PWA suites and typecheck**

Run:
```bash
cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx
cd pwa && ./node_modules/.bin/vitest run test/fleet-css.test.ts
cd pwa && npx tsc --noEmit
```
Expected: all PASS, tsc clean.

- [ ] **Step 15: Prove the guards are mechanisms, not comments**

Measure each mutation and record the result in the commit body. For each: apply, run, confirm RED, revert.

| mutation | file | expected red |
|---|---|---|
| drop `graphQueries:$graphQueries` from the hook's `jq -cn` object | `ccd/session-hook.sh` | `session-hook` — every `graphQueries` assertion |
| change `(query\|path\|explain)` to `(query\|path\|explain\|update)` | `ccd/session-hook.sh` | `session-hook` — "does NOT count graphify update…" |
| delete the `SessionStart && "$src" != resume` reset line | `ccd/session-hook.sh` | `session-hook` — "resets to 0 on SessionStart(startup)…", "…with NO source… (D-1248)", "…a source this build has never heard of" |
| narrow that reset condition to the allow-list `( "$src" == startup \|\| "$src" == clear )` | `ccd/session-hook.sh` | `session-hook` — "resets to 0 on a SessionStart with NO source… (D-1248)" AND "…a source this build has never heard of" |
| change that reset condition's `"$src" != resume` to `"$src" != startup` | `ccd/session-hook.sh` | `session-hook` — "is KEPT across resume and across compact…" AND "resets to 0 on SessionStart(startup) and SessionStart(clear)" |
| change `graphQueries: optNum(o, 'graphQueries')` to a literal `null` in `reviveFleetSession` | `shared/api.ts` | `fleetstate` — "revives a PRESENT graphQueries as the number the snapshot carried" AND "…a persisted graphQueries of 0 as 0" |
| drop the chip's `!dead &&` conjunct | `pwa/src/fleet/SessionLine.tsx` | `session-line` — "renders NO chip on a dead session, however many reads it made" |
| delete the `[[ "$src" == compact ]] && exit 0` guard in the `SessionStart` arm | `ccd/session-hook.sh` | `session-hook` — the existing D-306 "writes nothing on compact" tests |
| make `reviveGraphQueries` return `0` for `undefined` | `server/src/hookstate.ts` | `hookstate` — "ABSENT is null…" |
| change `graphQueries: hs?.graphQueries ?? null` to `?? 0` | `server/src/fleet.ts` | `fleet` — "a hookless session carries all four fields as null" (Step 10c); `fleet-health`/`fleetstate` red too if the cached-snapshot path is mutated the same way |
| replace `hs?.graphQueries ?? null` with a literal `null` — the guard DELETED, the direction `?? 0` cannot see (D-1249) | `server/src/fleet.ts` | `fleet` — "a fresh hookstate carries all four fields…" AND "carries a hookstate graphQueries of 0…as 0" (Step 10c2) |
| change `hs?.graphQueries ?? null` to `hs ? 0 : null` — the seam keeps the hookless distinction and throws the NUMBER away | `server/src/fleet.ts` | `fleet` — "a fresh hookstate carries all four fields…" |
| reorder the hook's one jq back to `subagents, state, graphQueries` — the unbounded-text field FIRST (D-1249) | `ccd/session-hook.sh` | `session-hook` — "a corrupted multi-line .subagents cannot shift state or the count onto the wrong line (D-1249)" |
| change the chip's `!== null` to a truthiness test | `pwa/src/fleet/SessionLine.tsx` | `session-line` — "renders graph 0…" |

**Why "add `compact` to the reset condition" is NOT in this table:** it cannot go red in either
direction. A `SessionStart` whose source is `compact` exits at the arm's own compact guard
(`ccd/session-hook.sh:123`, D-306) before the counter block is ever reached, so that leg of the
condition is unreachable code. Compact's carry is **structural** — protected by the early exit, and
pinned by the D-306 tests the third row above reddens — not by the reset condition. Claiming it here
would be exactly the guard-that-is-a-comment this table exists to prevent.

- [ ] **Step 16: Commit**

```bash
cd "$CCRC_REPO"
git add ccd/session-hook.sh server/src/hookstate.ts server/src/fleet.ts shared/api.ts \
        pwa/src/fleet/SessionLine.tsx pwa/src/fleet/fleet.css pwa/src/screens/RunsScreen.tsx \
        server/test pwa/test
git commit -m "feat(hook): count graphify reads into hookstate and onto the fleet card (R4)"
```

---

## Task 2: R1 — the `SessionStart` graph card

**Files:**
- Modify: `ccd/session-hook.sh` (two new functions near `_hook_epoch_ms`; one call inside the `SessionStart` arm)
- Test: `server/test/session-hook.test.ts`

**Interfaces:**
- Consumes: from Task 1 — the `src=""` initialisation on the declaration line (the card's arm sets `src` before it runs) and the extended `run()` helper in `server/test/session-hook.test.ts` that returns stdout.
- Produces:
  - shell functions **`_hook_emit_context <text>`** and **`_hook_graph_card`** (no arguments; reads the globals `payload`, `id`, `REG`, `HOME`)
  - the stdout JSON shape, on `SessionStart` only:
    `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<card>"}}`

---

- [ ] **Step 1: Write the failing tests**

Append to `server/test/session-hook.test.ts`:

```typescript
// ── R1: the graph card ────────────────────────────────────────────────────
// The ONE printf to stdout in this file, and it lives inside the SessionStart
// arm. On PreToolUse a stdout JSON is a PERMISSION DECISION, so a card that
// leaked onto another event would not be noise — it would answer a question
// nobody asked.
describe('the SessionStart graph card', () => {
  /** A tree with a graph in it. `built` is the sha the graph claims; the DECOY
   *  at the head of graph.json is the mutation this fixture exists to catch —
   *  `built_at_commit` is the file's LAST key on a real 8 MB graph, and a
   *  reader that parses from the head answers the decoy. */
  const plantGraph = (dir: string, opts: {
    built?: string; nodes?: number; engine?: string; report?: boolean;
  } = {}): void => {
    const out = path.join(dir, 'graphify-out');
    fs.mkdirSync(out, { recursive: true });
    const built = opts.built ?? 'a'.repeat(40);
    const decoy = `  "built_at_commit": "${'0'.repeat(40)}",\n`;
    const filler = `  "pad": "${'x'.repeat(9000)}",\n`;
    fs.writeFileSync(path.join(out, 'graph.json'),
      `{\n${decoy}${filler}  "hyperedges": [],\n  "built_at_commit": "${built}"\n}\n`);
    if (opts.report !== false) {
      fs.writeFileSync(path.join(out, 'GRAPH_REPORT.md'),
        `# Graph Report - demo  (2026-09-02)\n\n## Summary\n`
        + `- ${opts.nodes ?? 7662} nodes · 15645 edges · 423 communities\n`);
    }
    fs.writeFileSync(path.join(out, '.graphify_engine'), `${opts.engine ?? '0.9.9'}\n`);
  };

  /** A git repo whose HEAD is returned. `-c` on every commit so the box's own
   *  identity is never needed and never used. */
  const gitTree = (dir: string, commits = 1): string => {
    fs.mkdirSync(dir, { recursive: true });
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', dir, '-c', 'user.email=f@example.invalid',
        '-c', 'user.name=fixture', ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    const shas: string[] = [];
    for (let i = 0; i < commits; i++) {
      git('commit', '-q', '--allow-empty', '-m', `c${i}`);
      shas.push(git('rev-parse', 'HEAD'));
    }
    return shas[0]!;
  };

  const card = (stdout: string): string => {
    expect(stdout.trim(), 'the hook printed nothing').not.toBe('');
    const lines = stdout.trim().split('\n');
    expect(lines, 'the hook printed more than one line on stdout').toHaveLength(1);
    const j = JSON.parse(lines[0]!);
    expect(j.hookSpecificOutput.hookEventName).toBe('SessionStart');
    return String(j.hookSpecificOutput.additionalContext);
  };

  it('prints a card naming the graph, its node count, its engine and the pin', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first, nodes: 4242, engine: '0.9.9' });
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graphify.pin'), '0.9.9\n');
    const text = card(run({ hook_event_name: 'SessionStart', source: 'startup', cwd: tree }));
    expect(text).toContain('graphify-out/');
    expect(text).toContain('4242 nodes');
    expect(text).toContain(first.slice(0, 8));
    expect(text).toContain('fresh');
    expect(text).toContain('engine 0.9.9');
    expect(text).toContain('pin 0.9.9');
    expect(text).toContain('graphify query');
    expect(text).toContain('graphify path');
    expect(text).toContain('graphify explain');
    expect(text, 'the card must forbid a session-side build').toContain('graphify update');
  });

  it('reads built_at_commit from the TAIL — a decoy at the head must not win', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text, 'the head decoy was read instead of the real last key')
      .not.toContain('00000000');
    expect(text).toContain(first.slice(0, 8));
  });

  it('says how far behind HEAD the graph is, in commits', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 3);
    plantGraph(tree, { built: first });
    expect(card(run({ hook_event_name: 'SessionStart', cwd: tree })))
      .toContain('2 commits behind HEAD');
  });

  it('prints NOTHING when the tree has no graph and the sweep never mentioned it', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    expect(run({ hook_event_name: 'SessionStart', cwd: tree })).toBe('');
  });

  it('prints the sweep\'s own reason when the census says why there is no graph', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({
      passes: [
        { started: 'x', finished: 'x', pin: '0.9.9', status: 'ok', trees: [] },
        { started: 'y', finished: 'y', pin: '0.9.9', status: 'ok', trees: [
          { path: tree, outcome: 'refused-by-guard',
            reason: 'untracked paths entered the corpus: a.py b.py', duration_ms: 12 },
        ] },
      ],
    }));
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('refused-by-guard');
    expect(text).toContain('untracked paths entered the corpus');
  });

  it('is printed for compact too — compaction is when a session loses what it knew', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    // the state write stays skipped for compact (D-306); the card does not
    run({ hook_event_name: 'PreCompact' });
    const out = run({ hook_event_name: 'SessionStart', source: 'compact', cwd: tree });
    expect(card(out)).toContain('graphify-out/');
    expect(readState().event, 'the compact SessionStart wrote state after all').toBe('PreCompact');
  });

  it('prints NOTHING on every other event, even with a graph right there', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    for (const payload of [
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: tree },
      { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: tree },
      { hook_event_name: 'Stop', cwd: tree },
      { hook_event_name: 'UserPromptSubmit', cwd: tree },
      { hook_event_name: 'PreCompact', cwd: tree },
      { hook_event_name: 'PostCompact', trigger: 'auto', cwd: tree },
      { hook_event_name: 'SubagentStart', agent_name: 'reviewer', cwd: tree },
    ]) {
      expect(run(payload), `${payload.hook_event_name} printed on stdout`).toBe('');
    }
  });

  it('falls back to $REG/<id>.workdir when the payload carries no cwd', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.workdir'), `${tree}\n`);
    expect(card(run({ hook_event_name: 'SessionStart' }))).toContain('graphify-out/');
  });

  it('exits 0 and prints nothing when cwd does not exist', () => {
    // execFileSync THROWS on a non-zero exit, so a green run is the exit-0
    // assertion — the contract this whole file lives under.
    //
    // The census row is what makes the `[ -d "$cwd" ]` guard MEASURABLE. With
    // nothing seeded, deleting that guard is invisible: the no-graph branch is
    // taken anyway, the census read finds no file, and the card stays silent —
    // the same green. Seeded with a row FOR THIS PATH, a hook that skipped the
    // directory check would print the sweep's line about a directory that is
    // not there, and this assertion goes red.
    const gone = path.join(home, 'gone');
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({
      passes: [{ started: 'x', finished: 'x', pin: '0.9.9', status: 'ok', trees: [
        { path: gone, outcome: 'never-built', reason: 'no exclude entry', duration_ms: 3 },
      ] }],
    }));
    expect(run({ hook_event_name: 'SessionStart', cwd: gone })).toBe('');
    expect(readState().state).toBe('done');
  });

  it('exits 0 and still prints a card when the tree is not a git repo', () => {
    const tree = path.join(home, 'notarepo');
    fs.mkdirSync(tree, { recursive: true });
    plantGraph(tree, { built: 'b'.repeat(40) });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('graphify-out/');
    expect(text, 'freshness was claimed with no git to measure it against')
      .not.toContain('behind HEAD');
    expect(text).not.toContain('fresh');
  });

  it('omits the node count rather than inventing one when GRAPH_REPORT.md is absent', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first, report: false });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('graphify-out/');
    expect(text).not.toContain('nodes');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts`
Expected: FAIL — "the hook printed nothing" on every card test. The "prints NOTHING on every other event" test passes vacuously; it becomes a real guard once the card exists.

- [ ] **Step 3: Implement the card**

In `ccd/session-hook.sh`, insert these two functions immediately after `_hook_epoch_ms`'s closing brace and before the `[[ -n "${HOME:-}" ]] || exit 0` line:

```bash
# ── THE GRAPH CARD (R1) — the only printf to stdout in this file ─────────
# Claude Code reads a hook's stdout as a PER-EVENT CONTRACT, and on PreToolUse
# that contract is a permission decision. A card that leaked onto another event
# would not be noise; it would be an answer to a question nobody asked. So the
# emitter is called from inside the SessionStart arm and nowhere else, and
# every failure path in here prints NOTHING and returns 0 — this file's
# standing contract (exit 0 on every path, no network, no locks, no waiting) is
# unchanged. Every read below is a local file or a git ref.
_hook_emit_context() {   # <text> -> one JSON line on stdout, or nothing at all
  local j=""
  j=$(jq -cn --arg c "$1" \
    '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$c}}' 2>/dev/null) \
    || return 0
  printf '%s\n' "$j"
}

# Measured for THIS session's tree, never for the fleet in general — the block
# this replaces asserted "this project has a knowledge graph" of every project
# the account ever opened, including the trees the sweep refuses.
#
# COST. `built_at_commit` is the LAST key of graph.json, which is 8 MB on this
# repo, so it is read with `tail -c 4096` and never by parsing the file. The
# node count comes off the head of GRAPH_REPORT.md's summary line (`head -c
# 4096`) — the sweep census carries no node count and manifest.json is a
# per-file hash map, so neither of the design's two named sources actually
# holds the number (D-1246). `git rev-parse` and `git rev-list --count` are ref
# reads. Any failure omits its clause; a total failure prints nothing.
_hook_graph_card() {
  local cwd="" row="" nodes="" built="" tip="" behind="" engine="" pin="" fresh="" line=""
  cwd=$(jq -r '.cwd // empty' <<<"$payload" 2>/dev/null) || cwd=""
  # `$REG/<id>.workdir` is the registry's own durable answer, and the fallback
  # for a harness whose SessionStart payload carries no cwd at all.
  [ -n "$cwd" ] || cwd=$(cat "$REG/$id.workdir" 2>/dev/null) || cwd=""
  [ -n "$cwd" ] || return 0
  [ -d "$cwd" ] || return 0

  if [ ! -f "$cwd/graphify-out/graph.json" ]; then
    # SILENCE IS THE TRUE ANSWER for a tree the sweep has not reached: a card
    # asserting a graph that is not there is worse than no card. The one thing
    # worth saying instead is the sweep's OWN last word about this tree, when
    # its census carries one — a session that knows the tree was REFUSED does
    # not go hunting for a graph that is never going to appear. The census is
    # `{passes:[…]}`, last 10, newest LAST.
    row=$(jq -r --arg p "$cwd" \
      '(.passes // []) | last | (.trees // [])
       | map(select(.path == $p and ((.reason // "") != "")))
       | if length == 0 then empty else (.[0].outcome + ": " + .[0].reason) end' \
      "$HOME/.ccrc/graph-sweep.json" 2>/dev/null) || row=""
    [ -n "$row" ] || return 0
    _hook_emit_context "graphify: this tree has no knowledge graph — the ccrc sweep's last pass says $row. Do not build one here; the sweep owns the write side."
    return 0
  fi

  built=$(tail -c 4096 "$cwd/graphify-out/graph.json" 2>/dev/null \
    | grep -oE '"built_at_commit"[[:space:]]*:[[:space:]]*"[0-9a-f]+"' | tail -n1) || built=""
  built="${built##*:}"; built="${built//\"/}"; built="${built// /}"
  [[ "$built" =~ ^[0-9a-f]{7,40}$ ]] || built=""

  nodes=$(head -c 4096 "$cwd/graphify-out/GRAPH_REPORT.md" 2>/dev/null \
    | grep -oE '[0-9]+ nodes' | head -n1) || nodes=""
  nodes="${nodes% nodes}"
  [[ "$nodes" =~ ^[0-9]+$ ]] || nodes=""

  engine=$(head -c 64 "$cwd/graphify-out/.graphify_engine" 2>/dev/null | tr -d '[:space:]') || engine=""
  pin=$(head -c 64 "$HOME/.ccrc/graphify.pin" 2>/dev/null | tr -d '[:space:]') || pin=""

  # STALENESS IS MEASURED OR IT IS NOT CLAIMED. A tree with no git, or a
  # rev-list that will not answer, gets no freshness clause rather than a
  # "fresh" nobody checked — a session querying a graph 97 commits stale gets
  # confident wrong answers, which is the whole reason this clause exists.
  tip=$(git -C "$cwd" rev-parse HEAD 2>/dev/null) || tip=""
  if [ -n "$built" ] && [ -n "$tip" ]; then
    if [ "$tip" = "$built" ]; then
      fresh="fresh"
    else
      behind=$(git -C "$cwd" rev-list --count "$built..HEAD" 2>/dev/null) || behind=""
      case "$behind" in
        ''|*[!0-9]*) fresh="" ;;
        0)           fresh="fresh" ;;
        1)           fresh="1 commit behind HEAD" ;;
        *)           fresh="$behind commits behind HEAD" ;;
      esac
    fi
  fi

  line="graphify: this tree has a knowledge graph — graphify-out/"
  [ -z "$nodes" ]  || line="$line, $nodes nodes"
  [ -z "$built" ]  || line="$line, built at ${built:0:8}"
  [ -z "$fresh" ]  || line="$line ($fresh)"
  # The engine/pin pair earns its place: sessions were measured running an
  # unversioned July copy of graphify against 0.9.9 graphs, and that drift is
  # invisible until a query fails strangely.
  [ -z "$engine" ] || line="$line, engine $engine"
  [ -z "$pin" ]    || line="$line (pin $pin)"
  # Single-quoted: the sentence carries backticks and double quotes verbatim.
  line="$line"'. Answer codebase questions with `graphify query "<question>"` first; `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for one concept; read `graphify-out/GRAPH_REPORT.md` only for broad architecture. Do not run `graphify update` or any build here — the ccrc sweep owns the write side.'
  _hook_emit_context "$line"
  return 0
}
```

Then, in the `SessionStart)` arm, put the call between the `src=` read and the compact exit:

```bash
    src=$(jq -r '.source // empty' <<<"$payload" 2>/dev/null) || src=""
    # BEFORE the compact exit, deliberately: the hookstate write stays skipped
    # for compact (D-306 — PreCompact/PostCompact own that transition), and the
    # card is independent of it. Compaction is precisely when a session loses
    # what it knew, so it is the source that most needs the card.
    _hook_graph_card || true
    [[ "$src" == compact ]] && exit 0
    state="done" ;;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
bash -n ccd/session-hook.sh
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
cd server && ./node_modules/.bin/vitest run test/install-session-hooks.test.ts
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts
```
Expected: all PASS. If `session-hook`'s p95 budget test is the only red, re-run it in isolation first — it is on the known-flake list; if it is genuinely over 150 ms, the cause is a fork added to the PostToolUse path, not this task's SessionStart work.

- [ ] **Step 5: Prove the guards are mechanisms**

| mutation | expected red |
|---|---|
| move `_hook_graph_card \|\| true` out of the `SessionStart` arm to just before `f="$REG/$id.hookstate.json"` | "prints NOTHING on every other event, even with a graph right there" |
| change `tail -c 4096` to `head -c 4096` in the `built` read | "reads built_at_commit from the TAIL — a decoy at the head must not win" |
| delete `| tail -n1` from the `built` read (D-1361) | "takes the LAST built_at_commit when the decoy is INSIDE the byte window" — and only once the field split takes the FIRST colon; while it took the last, this mutation was green |
| delete the `[ ! -f "$cwd/graphify-out/graph.json" ]` early return and emit unconditionally | "prints NOTHING when the tree has no graph and the sweep never mentioned it" |
| move the card call below `[[ "$src" == compact ]] && exit 0` | "is printed for compact too…" |
| replace `fresh="freshness unmeasured"` in the `''\|*[!0-9]*` case with `fresh="fresh"` | "says the graph is undatable when rev-list will not answer for the built sha (D-1252, D-1336)" — **not** "…not a git repo", which cannot reach that `case` at all (no `tip`, so the whole block is skipped) and stayed green under the mutation |
| make `[ -z "$engine" ] \|\| line="$line, engine $engine"` unconditional | "omits engine and pin when the graph is unstamped and the box has no pin" (D-1334) — the row Task 2 never had, because `plantGraph` stamped `.graphify_engine` unconditionally and nothing could reach the empty arm |
| make `[ -z "$pin" ] \|\| line="$line (pin $pin)"` unconditional | same test (D-1334) — a box with no `~/.ccrc/graphify.pin` is every box `ccrc install` has not run on |
| delete `row="${row:0:400}"` from the no-graph arm | "clips a pathological census reason instead of injecting it whole" (D-1335) — `expected 100140 to be less than 600` |
| replace the `''\|*[!0-9]*` arm's `fresh="freshness unmeasured"` with `fresh=""`, merging it back onto the no-git silence | "says the graph is undatable when rev-list will not answer for the built sha (D-1252, D-1336)" |
| in `ccd/ccd-graph-sweep`'s `_gs_row`, rename the census field `reason` to `why` | BOTH census tests, in `session-hook.test.ts` (D-1337) — the hook goes silent, `the hook printed nothing` |
| in `ccd/ccd-graph-sweep`, rename `_gs_row()` itself | the same two, at the lift's own assertion: `ccd-graph-sweep no longer defines _gs_row()` |
| plant a FOURTH bash file under `ccd/` whose code spells `$HOME/.ccrc/graph-sweep.json` | `single-definition.test.ts`'s "the census path '.ccrc/graph-sweep.json' is spelled by writers/readers…" (D-1333) — the widened list is still exact-match |
| delete `[ -d "$cwd" ] \|\| return 0` and let the census read run on a missing dir | "exits 0 and prints nothing when cwd does not exist" — the card prints the sweep's row for a directory that is not there (this is why that test now seeds a census row for `$home/gone`; without it the mutation is invisible and the row would be a comment) |

- [ ] **Step 6: Commit**

```bash
cd "$CCRC_REPO"
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): print one measured graph card on SessionStart (R1)"
```

---

## Task 3: R2 — worker skill clause 12

**Files:**
- Modify: `ccd/worker-skill/SKILL.md` (two "eleven" occurrences, one new numbered clause)
- Modify: `server/test/worker-skill.test.ts` (the `CONTRACT` array, the comment above it, the test name)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` (§2, one paragraph)
- Modify: `CLAUDE.md:181`, `README.md:1142`, `README.md:1326`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: clause 12's exact text, pinned verbatim by `server/test/worker-skill.test.ts`'s `CONTRACT[11]`. Nothing later in this plan reads it.

---

- [ ] **Step 1: Write the failing pin**

In `server/test/worker-skill.test.ts`, append this entry to the end of the `CONTRACT` array (after the clause-11 string). **Straight apostrophes only, and no `"` character anywhere in a clause** — D-104's standing constraint, which is why these literals are double-quoted:

```typescript
  "When your workspace carries `graphify-out/graph.json`, a question about the codebase goes to `graphify query` before `grep` or a file read, and to `graphify path` / `graphify explain` for relationships and concepts. Never run `graphify update` or any graphify build in the workspace: the sweep owns the write side, and a session-side build holds you at `working` for minutes and wedges the next dispatch as `worker-busy`.",
```

Rename the test and update the comment above the array:

```typescript
// The twelve clauses, verbatim. Every entry is DOUBLE-quoted on purpose: clause 1
```

```typescript
  it('carries all twelve clauses verbatim', () => {
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts`
Expected: FAIL — "missing contract clause: When your workspace carries `graphify…".

- [ ] **Step 3: Add the clause to the skill**

In `ccd/worker-skill/SKILL.md`, append after clause 11 (byte-identical to the pin above):

```markdown
12. When your workspace carries `graphify-out/graph.json`, a question about the codebase goes to `graphify query` before `grep` or a file read, and to `graphify path` / `graphify explain` for relationships and concepts. Never run `graphify update` or any graphify build in the workspace: the sweep owns the write side, and a session-side build holds you at `working` for minutes and wedges the next dispatch as `worker-busy`.
```

In the same file's `## The contract` section, change both counts:

```markdown
These twelve clauses are the boundary between "a wave worker" and "an agent with
a shell on the fleet host". They are not advice.

**Editing note (D-104):** these twelve lines are pinned verbatim by
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts`
Expected: PASS — including the destructive-verb census (clause 12 names none of the five verbs) and the `references/` census (unchanged).

- [ ] **Step 5: Add the coordinator's one sentence**

In `ccd/coordinator-skill/references/wave-lifecycle.md`, §2, insert a new paragraph immediately after the "**The execution skill is the one list item that is not merely useful.**" paragraph and before the "**One sentence from the protocol goes in every brief anyway…**" paragraph. It must sit AFTER the block the coordinator suite's `A brief carries what only THIS wave knows:[\s\S]{0,320}deviations already ledgered` window covers, which is why it goes here rather than inside that list:

```markdown
**A brief may quote the worker's graph card.** Every session's `SessionStart`
prints one line for its own tree — node count, the commit the graph was built
at, and whether that is fresh or N commits behind HEAD. Quoting the freshness
half in the brief tells the worker what it is querying before it queries it: a
graph 97 commits stale answers confidently and wrongly, and worker clause 12
sends the worker to `graphify query` first. The card is measured per tree, so a
brief that quotes it is quoting THAT workspace, not the fleet.
```

- [ ] **Step 6: Verify the coordinator pins still hold**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`
Expected: PASS — the new paragraph sits outside the 320-character window the brief-block pin measures, and adds no refusal code.

- [ ] **Step 7: Update the three prose counts**

`CLAUDE.md`, in the worker-skill bullet:

```markdown
- **The worker has a skill too** (`ccd/worker-skill/SKILL.md`, `ccrc-worker`, twelve clauses pinned by
```

`README.md:1142` and `README.md:1326`: change `eleven clauses` to `twelve clauses` in both. Prove there is nothing left:

```bash
cd "$CCRC_REPO" && git grep -n "eleven clauses"
```
Expected: no output.

- [ ] **Step 8: Prove the guard is a mechanism**

| mutation | expected red |
|---|---|
| soften "Never run `graphify update`" to "Prefer not to run `graphify update`" in `SKILL.md` | `worker-skill` — "carries all twelve clauses verbatim" |
| delete clause 12 from `SKILL.md` | same |
| replace a straight apostrophe in clause 12 with a curly one | same (this is why D-104 exists) |

- [ ] **Step 9: Commit**

```bash
cd "$CCRC_REPO"
git add ccd/worker-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md \
        server/test/worker-skill.test.ts CLAUDE.md README.md
git commit -m "feat(worker-skill): clause 12 sends a codebase question to the graph first (R2)"
```

---

## Task 4: R0 — retire the account-wide block, keep its census as the remover

**Files:**
- Modify: `ccd/ccrc` — delete `_inst_graph_always_on` (its header comment block and body); add `_inst_graph_always_on_off` in the same position; rename the entry in `cmd_install`'s sequence
- Modify: `server/test/ccrc-install.test.ts` — the pinned step-sequence array
- Modify: `server/test/ccrc-install-graphify.test.ts` — delete the two converge describes, add the remover's
- Modify: `README.md` — replace the "Reading the graph…" paragraph

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the install step function **`_inst_graph_always_on_off`**, called from `cmd_install` where `_inst_graph_always_on` used to be (between `_inst_graphify_skill` and `_inst_graph_noise`). Task 6 rewrites the README section around it.
- Markers, verbatim, whole lines: `<!-- ccrc:graphify-always-on:start -->` and `<!-- ccrc:graphify-always-on:end -->`.

---

- [ ] **Step 1: Write the failing remover tests**

In `server/test/ccrc-install-graphify.test.ts`:

1. **Delete** the describe `'ccrc install: the read rule refuses malformed files rather than splicing (D-1244)'` (line ~552) in full.
2. **Delete** the describe `'ccrc install: the always-on READ rule (_inst_graph_always_on, D-1243)'` (line ~737) in full — **except one `it`, which MOVES into the new describe below rather than dying with it.** That describe holds the structural source scan `it('splices with line-addressed sed and no awk at all — the BSD -v hazard is retired, not guarded')` (~:883–908), which is the tree's ONLY defence against `awk` returning to this splice; `macos-platform.test.ts`'s corpora do not ban `awk` at all. The remover reuses the very same `sed -n "1,$((…-1))p"` construction, so retiring the guard while keeping the code it guards would leave the hazard uncovered. Carry it over with two edits and nothing else — the anchor and the addressed variable:

```typescript
    const at = src.indexOf('_inst_graph_always_on_off() {');
```
```typescript
    expect(body, 'the sed splice went missing').toMatch(/sed -n "1,\$\(\(lb-1\)\)p"/);
```

  Its executable-line scrape (`.filter((l) => l && !l.startsWith('#'))`) and its `not.toMatch(/(^|[^a-z])awk\s/m)` assertion apply unchanged — the remover's comments discuss `awk` by name for the same reason the converge's did.
3. **Keep** the engine, noise-list, exclude-writer and hooks-off describes untouched, and keep the `'README: the graphify step enumeration is DERIVED, not remembered (D-1243)'` describe (line ~685) for now — Task 6 retargets it. Its `it('the README documents the READ side, not only the write side')` asserts `toMatch(/graphify query/)` against the README, and README.md:1515 — the single occurrence of that string in the whole file — sits inside the paragraph Step 4 below replaces. **Step 4's replacement paragraph therefore carries `graphify query` deliberately**, so this describe stays green in the commit that invalidates the text around it. Do not drop that token from the paragraph "to tighten it".
4. Add this describe in their place:

```typescript
// ── R0: the block ccrc should never have written, removed ─────────────────
// D-1243 put a PROJECT-scoped instruction ("This project has a knowledge graph
// at graphify-out/") into an ACCOUNT-WIDE file — every rostered home's
// `~/.claude*/CLAUDE.md`, which Claude Code loads for every session under that
// account in every project, including the trees the sweep refuses. And that
// file is the OPERATOR's, not ccrc's: every one of D-1244's six data-loss
// classes existed only because ccrc was rewriting a file it does not own.
//
// The remover is D-1244's own hardened census doing its last job — same
// whole-line marker census, same exactly-one-ordered-pair rule, same symlink
// resolution, same mode preservation, same "left in place; remove by hand"
// for anything that is not provably wholly ccrc's — deleting lines ls..le
// instead of splicing a block in. `_inst_graph_hooks_off` is the idiom: ccrc
// already has a step whose whole job is removing what an earlier layer
// planted.
describe('ccrc install: the always-on block is REMOVED (_inst_graph_always_on_off, D-1245)', () => {
  const START = '<!-- ccrc:graphify-always-on:start -->';
  const END = '<!-- ccrc:graphify-always-on:end -->';
  const BLOCK = `${START}\n## graphify\n\n- first run \`graphify query\`\n${END}`;
  const claudeMd = (home: string) => join(home, '.claude', 'CLAUDE.md');
  const seed = (home: string, text: string, mode = 0o644): string => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(claudeMd(home), text, { mode });
    return claudeMd(home);
  };
  const backupDirs = (home: string): string[] => {
    const d = join(home, 'ccrc-backups');
    return existsSync(d) ? readdirSync(d) : [];
  };

  it('removes a well-formed block from mid-file, byte-identically around it', () => {
    const home = freshBox('ccrc-inst-gfx-off-mid-');
    plantFakeVenv(home);
    const f = seed(home, `# head\n\n- operator line\n\n${BLOCK}\n\n## OPERATOR TAIL\n- keep me\n`);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    // The block AND the one separating blank line the append path wrote.
    expect(readFileSync(f, 'utf8')).toBe('# head\n\n- operator line\n\n## OPERATOR TAIL\n- keep me\n');
    expect(r.stdout).toMatch(/always-on read rule — 1 home\(s\) cleared/);
  });

  it('removes a block that sits at LINE 1 without eating the line after it', () => {
    // `sed -n "1,0p"` does NOT print nothing — an addr2 at or below addr1 makes
    // sed match the ONE line at addr1 — and line 1 is exactly where the append
    // path put the block for a home that had no CLAUDE.md at all.
    //
    // NO BLANK LINE AFTER THE BLOCK, and that is the fixture being faithful
    // rather than convenient: the append path (`ccd/ccrc:5321-5326`) writes the
    // block LAST, `printf '%s\n' "$want"` with nothing after it, so a trailing
    // blank is never a shape the converge produced. `lb` only ever absorbs the
    // ONE blank line the append path wrote BEFORE a block, and at line 1 there
    // is none — the remover must not learn to eat a trailing blank, because
    // that whitespace would be the operator's, not ccrc's.
    const home = freshBox('ccrc-inst-gfx-off-line1-');
    plantFakeVenv(home);
    const f = seed(home, `${BLOCK}\n## OPERATOR\n- keep me\n`);
    expect(runInstall(home, ['install']).code).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('## OPERATOR\n- keep me\n');
  });

  it('removes a block that ends the file, leaving the operator text intact', () => {
    const home = freshBox('ccrc-inst-gfx-off-eof-');
    plantFakeVenv(home);
    const f = seed(home, `# head\n\n- keep me\n\n${BLOCK}\n`);
    expect(runInstall(home, ['install']).code).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('# head\n\n- keep me\n');
  });

  it('leaves a HALF block in place, reports it, and degrades the install', () => {
    const home = freshBox('ccrc-inst-gfx-off-half-');
    plantFakeVenv(home);
    const text = `# head\n\n${START}\nstale\n\n## OPERATOR TAIL\n- keep me\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8'), 'a half block was deleted instead of reported').toBe(text);
    // SEMICOLON, not an em dash: the tree's own idiom for this refusal is
    // `— left in place; remove by hand` (`_inst_graph_hooks_off`, ccd/ccrc:5411,
    // and the unmarked-section refusal at :5249). The spec quotes the phrase
    // with a second em dash; the tree is what ships, and D-1247 records the
    // divergence rather than making this file the odd one out.
    expect(r.stderr).toMatch(/left in place; remove by hand/);
    expect(r.stdout).not.toMatch(/^install: done — every step above converged$/m);
    expect(r.stdout).toMatch(/degraded step/);
  });

  it('leaves TWO blocks in place rather than guessing which one is ccrc\'s', () => {
    const home = freshBox('ccrc-inst-gfx-off-two-');
    plantFakeVenv(home);
    const text = `# head\n\n${BLOCK}\n\n${BLOCK}\n\n# tail\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe(text);
    expect(r.stderr).toMatch(/2 start and 2 end markers/);
  });

  it('leaves a CHAINED file — end marker before start — in place', () => {
    const home = freshBox('ccrc-inst-gfx-off-chained-');
    plantFakeVenv(home);
    const text = `# head\n${END}\nsomething\n${START}\n# tail\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe(text);
    expect(r.stderr).toMatch(/end marker before its start marker/);
  });

  it('treats markers QUOTED in the operator\'s prose as prose, not as markers', () => {
    const home = freshBox('ccrc-inst-gfx-off-quoted-');
    plantFakeVenv(home);
    const text = `# head\n\nccrc wrote between ${START} and ${END} in this file.\n\n- keep\n`;
    const f = seed(home, text);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8'), 'a sentence mentioning the markers was cut').toBe(text);
    // THE POSITIVE HALF, and the census mutation's only red. Byte-identity
    // alone is satisfied by a substring census too: with `grep -cF` the prose
    // line makes ns=1/ne=1, `grep -nxF` then finds no line, `ls`/`le` come back
    // EMPTY, every `[` on them errors non-zero (this file runs `set -uo
    // pipefail`, never `-e`), the splice fails and the `if !` arm leaves the
    // file untouched — the same bytes, arrived at by accident. What that path
    // cannot fake is the count: it takes the refusal branch, so `kept` is 1.
    expect(r.stdout, 'the census matched a marker QUOTED in prose')
      .toMatch(/always-on read rule — 0 home\(s\) cleared, 0 left in place/);
  });

  it('SKIPS a symlink this box cannot resolve — never writes through one', () => {
    const home = freshBox('ccrc-inst-gfx-off-badlink-');
    plantFakeVenv(home);
    mkdirSync(join(home, '.claude'), { recursive: true });
    symlinkSync(join(home, 'not-cloned-yet', 'CLAUDE.md'), claudeMd(home));
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(claudeMd(home)).isSymbolicLink(), 'the unresolvable link was replaced').toBe(true);
    expect(existsSync(claudeMd(home)), 'a file was created at the link target').toBe(false);
    expect(r.stderr).toMatch(/symlink this box cannot resolve/);
  });

  it('writes through a RESOLVABLE symlink to the TARGET, and the link stays a link', () => {
    const home = freshBox('ccrc-inst-gfx-off-link-');
    plantFakeVenv(home);
    const target = join(home, 'dotfiles', 'CLAUDE.md');
    mkdirSync(join(home, 'dotfiles'), { recursive: true });
    writeFileSync(target, `# shared\n\n${BLOCK}\n`);
    mkdirSync(join(home, '.claude'), { recursive: true });
    symlinkSync(target, claudeMd(home));
    expect(runInstall(home, ['install']).code).toBe(0);
    expect(lstatSync(claudeMd(home)).isSymbolicLink(), 'the link was replaced by a file').toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('# shared\n');
  });

  it('preserves the file\'s own mode instead of widening it to 644', () => {
    const home = freshBox('ccrc-inst-gfx-off-mode-');
    plantFakeVenv(home);
    const f = seed(home, `# private\n\n${BLOCK}\n`, 0o600);
    expect(runInstall(home, ['install']).code).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('# private\n');
    expect(statSync(f).mode & 0o777, 'a 0600 CLAUDE.md was silently widened').toBe(0o600);
  });

  it('leaves no CLAUDE.md.tmp.<pid> behind, on the write path or the refusal path', () => {
    const home = freshBox('ccrc-inst-gfx-off-notmp-');
    plantFakeVenv(home);
    seed(home, `# head\n\n${BLOCK}\n`);
    runInstall(home, ['install']);
    expect(readdirSync(join(home, '.claude')).filter((n) => n.includes('CLAUDE.md.tmp')),
      'a temp file was left in the operator\'s config directory').toEqual([]);
  });

  it('is idempotent: the second run removes nothing and cuts no backup', () => {
    const home = freshBox('ccrc-inst-gfx-off-idem-');
    plantFakeVenv(home);
    const f = seed(home, `# head\n\n${BLOCK}\n`);
    const first = runInstall(home, ['install']);
    expect(first.code, first.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('# head\n');
    const after = backupDirs(home).length;
    expect(after, 'the first run cut no backup of the file it rewrote').toBeGreaterThan(0);
    const second = runInstall(home, ['install']);
    expect(second.code, second.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe('# head\n');
    expect(second.stdout).toMatch(/always-on read rule — 0 home\(s\) cleared/);
    expect(backupDirs(home).length, 'a second run cut a backup of a file it did not touch')
      .toBe(after);
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-inst-gfx-off-server-');
    plantFakeVenv(home);
    const f = seed(home, `# head\n\n${BLOCK}\n`);
    runInstall(home, ['install', '--role', 'server']);
    expect(readFileSync(f, 'utf8'), 'a server box has no rostered homes to clear')
      .toContain(START);
  });
});
```

In `server/test/ccrc-install.test.ts`, change the pinned sequence entry and its comment:

```typescript
      // D-1245. The READ side moved OUT of the operator's account-wide
      // CLAUDE.md and into the artifacts ccrc owns outright (the session
      // hook's SessionStart card, worker clause 12, the PATH converge, and
      // the `graphQueries` counter the hook already writes). What
      // is left here is the REMOVER, in `_inst_graph_hooks_off`'s own shape:
      // a step whose whole job is taking back what an earlier layer planted.
      '_inst_graph_always_on_off',
```

- [ ] **Step 2: Run them to verify they fail**

Run:
```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts
cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
```
Expected: FAIL — the sequence pin reports `_inst_graph_always_on` where `_inst_graph_always_on_off` is expected, and every remover test finds the block still present (the converge is still writing it).

- [ ] **Step 3: Replace the step in `ccd/ccrc`**

Delete the whole `# ── _inst_graph_always_on — the READ side, which had no mechanism ───` comment block and the `_inst_graph_always_on() { … }` body, and put this in its place (same file position — between `_inst_graphify_skill` and `_inst_graph_noise`):

```bash
# ── _inst_graph_always_on_off — take back the account-wide block (D-1245) ─
# D-1243 installed graphify's `always_on/claude-md.md` into every rostered
# home's config-dir `CLAUDE.md`. Two things were wrong with that, and neither is
# a wording problem:
#
#   1. The block is written for a PROJECT file. Its first sentence is "This
#      project has a knowledge graph at graphify-out/". Planted account-wide it
#      asserts that of every project the account ever opens, including the trees
#      the sweep refuses.
#   2. That file is the OPERATOR's, not ccrc's. Every one of D-1244's six
#      data-loss classes — substring markers, a lost end marker, two blocks, the
#      line-1 splice, the unchecked `&&` chain, the symlink fallback — existed
#      ONLY because ccrc was rewriting a file it does not own.
#
# MEASURED EFFECT, which is what settled it: graphify's own query log over the
# one day since it was deployed (2026-09-01, measured 2026-09-02) showed 109
# query/path/explain calls across 4 corpora, 103 of them in the one repository
# whose PROJECT CLAUDE.md had carried graphify's block, committed, since July.
# Zero in ccrc-pwa, the busiest project on the fleet, with five fresh graphs.
# The design's other row is the WEEK one — 265 calls across 11 corpora over the
# last 7 days, ccrc-pwa zero in both — and the two are named apart here because
# this comment once paired that row's window word with this row's figures
# (D-1357/D-1362). "5/5 homes converged" was shape; that is effect.
# The read side now lives in `ccd/session-hook.sh`'s SessionStart card (R1),
# worker clause 12 (R2), `_inst_graphify_engine`'s PATH converge (R3), and the
# `graphQueries` counter in the hookstate the hook already writes (R4) —
# artifacts ccrc installs and owns outright.
#
# THIS IS D-1244'S CENSUS DOING ITS LAST JOB, not a second implementation of it:
# the same whole-line marker count, the same exactly-one-well-ordered-pair rule,
# the same symlink resolution that SKIPS rather than falling back to the link,
# the same `_plat_mode` preservation, the same backup-before-write. It deletes
# lines ls..le (plus the one separating blank line the append path wrote) where
# the converge spliced a block in.
#
# `_inst_graph_hooks_off` IS THE IDIOM, not a wart: ccrc already has a step
# whose whole job is removing what an earlier layer planted, and it states the
# rule this one follows — anything not provably WHOLLY ccrc's own is "left in
# place; remove by hand", counted, and reported. That is the TREE's spelling of
# the phrase (ccd/ccrc:5411 and :5249), not the spec's em-dashed one; D-1247
# records the divergence, and the half-block test asserts the semicolon. This
# step stays in the tree afterwards exactly as that one does.
_inst_graph_always_on_off() {
  [ "$INST_ROLE" = server ] && return 0
  local n=0 kept=0 ts backups
  if ! source "$HOME/.ccrc/accounts.sh" 2>/dev/null || [ "${#CCRC_ACCOUNTS[@]}" -eq 0 ]; then
    # DEGRADES, NEVER DIES — `_inst_enable`'s rule for the sweep timer, and it
    # binds harder here: a block ccrc failed to REMOVE is a stale instruction,
    # not a broken box, and taking the whole install down over it would be a
    # fix worse than the thing being fixed.
    echo "install: graphify: no usable roster at \$HOME/.ccrc/accounts.sh — always-on read rule not cleared"
    INST_DEGRADED+=(graphify-read-rule)
    return 0
  fi
  ts=$(date +%Y%m%d-%H%M%S); backups="$HOME/ccrc-backups/$ts"
  local a dir f start end phys ns ne ls le lb mode tmp
  start='<!-- ccrc:graphify-always-on:start -->'
  end='<!-- ccrc:graphify-always-on:end -->'
  for a in "${CCRC_ACCOUNTS[@]}"; do
    dir="$(_ccrc_cfg_dir "$a" 2>/dev/null)" || continue
    [ -n "$dir" ] || continue
    f="$dir/CLAUDE.md"
    [ -e "$f" ] || [ -L "$f" ] || continue
    # A SYMLINK IS RESOLVED, OR THE HOME IS SKIPPED (D-1244). `readlink -f`
    # answers empty for a link whose target's parent does not exist yet, and
    # falling back to the LINK path collapses "resolved" and "could not
    # resolve" into one value — the overloaded null this codebase forbids at a
    # seam, and here it would delete lines out of a file nobody identified.
    # Two homes on this fleet ARE symlinks to a third's file, so this is the
    # ordinary case, not the exotic one.
    if [ -L "$f" ]; then
      phys="$(readlink -f "$f" 2>/dev/null)" || phys=""
      if [ -z "$phys" ]; then
        echo "install: graphify: $f is a symlink this box cannot resolve — left in place; remove the block by hand" >&2
        kept=$((kept+1)); continue
      fi
      f="$phys"
    fi
    [ -f "$f" ] || continue
    # THE MARKER CENSUS, ON WHOLE LINES, EXACTLY ONE ORDERED PAIR OR NOTHING.
    # A substring match would cut a file at the operator's own MENTION of the
    # markers; a missing end marker would delete everything after the start.
    ns="$(grep -cxF "$start" "$f" 2>/dev/null || true)"; ns="${ns:-0}"
    ne="$(grep -cxF "$end" "$f" 2>/dev/null || true)"; ne="${ne:-0}"
    if [ "$ns" -eq 0 ] && [ "$ne" -eq 0 ]; then
      continue   # nothing of ours here; idempotence lives on this line
    fi
    if [ "$ns" -ne 1 ] || [ "$ne" -ne 1 ]; then
      echo "install: graphify: $f carries $ns start and $ne end markers, and exactly one pair is required — left in place; remove by hand" >&2
      kept=$((kept+1)); continue
    fi
    ls="$(grep -nxF "$start" "$f" | head -n1 | cut -d: -f1)"
    le="$(grep -nxF "$end" "$f" | head -n1 | cut -d: -f1)"
    if [ "$ls" -ge "$le" ]; then
      echo "install: graphify: $f carries ccrc's end marker before its start marker — malformed, left in place; remove by hand" >&2
      kept=$((kept+1)); continue
    fi
    # THE ONE SEPARATING BLANK LINE the append path wrote before the block
    # (`printf '%s\n\n' "$cur"`), and only when it really is blank and really
    # is ours to take: without this, removal leaves a growing run of blank
    # lines behind on a home the converge had appended to.
    lb="$ls"
    if [ "$ls" -gt 1 ] && [ -z "$(sed -n "$((ls-1))p" "$f")" ]; then lb=$((ls-1)); fi
    # PRESERVE THE FILE'S OWN MODE (D-1244): a symlink was resolved first, so
    # the file being rewritten may not even sit inside a ccrc home, and forcing
    # 644 would widen a CLAUDE.md an operator had restricted. `_plat_mode`, not
    # a bare `stat -c %a` — this file ships to macOS and `macos-platform.test.ts`
    # refuses a GNU-only call outside the platform block.
    mode="$(_plat_mode "$f" 2>/dev/null || true)"
    [ -n "$mode" ] || mode=644
    if ! { mkdir -p "$backups" && cp -a "$f" "$backups/$(echo "$f" | tr / _)"; }; then
      echo "install: graphify: cannot back up $f — left in place rather than rewritten unbacked" >&2
      kept=$((kept+1)); continue
    fi
    tmp="$f.tmp.$$"
    # EVERY PIECE'S STATUS, NOT JUST THE LAST (D-1244): a `{ a; b; } > tmp`
    # group carries only b's status, and b writes NOTHING when the block ends
    # the file — the layout the append path itself creates. The `&&` chain makes
    # the group's status the FIRST failure.
    #
    # `[ "$lb" -le 1 ] ||` GUARDS AN EMPTY PREFIX and is not padding: `sed -n
    # "1,0p"` does not print nothing — an addr2 at or below addr1 makes sed
    # match the ONE line at addr1, so a block at line 1 would have its own
    # start marker re-emitted. That layout is what the append path produced for
    # a home that had no CLAUDE.md at all.
    if ! { { [ "$lb" -le 1 ] || sed -n "1,$((lb-1))p" "$f"; } &&
           sed -n "$((le+1)),\$p" "$f"; } > "$tmp" 2>/dev/null; then
      rm -f "$tmp"
      echo "install: graphify: could not rewrite $f — left in place" >&2
      kept=$((kept+1)); continue
    fi
    if ! { chmod "$mode" "$tmp" && mv -f "$tmp" "$f"; }; then
      rm -f "$tmp"
      echo "install: graphify: could not replace $f — left in place" >&2
      kept=$((kept+1)); continue
    fi
    n=$((n+1))
  done
  [ "$kept" -eq 0 ] || INST_DEGRADED+=(graphify-read-rule)
  echo "install: graphify: always-on read rule — $n home(s) cleared, $kept left in place"
}
```

Rename the call in `cmd_install`'s sequence:

```bash
  _inst_graphify_skill
  _inst_graph_always_on_off
  _inst_graph_noise
```

- [ ] **Step 4: Replace the README's read-side paragraph**

In `README.md`, replace the whole "**Reading the graph, which is a separate problem from keeping it fresh.**" paragraph (README.md:1513–1526) with:

```markdown
**Reading the graph, which is a separate problem from keeping it fresh.** Everything above serves
the WRITE path, and for three deviations nothing served the read path at all: measured across the
five rostered homes, the rule "for codebase questions, run `graphify query` first" appeared in
**none** of them. D-1243's answer was graphify's own packaged block, `always_on/claude-md.md`,
appended to every rostered home's config-dir `CLAUDE.md` between ccrc's markers — and **D-1245
retired it**, because it was wrong on two counts. That block is written for a PROJECT file ("This
project has a knowledge graph at graphify-out/"), so account-wide it asserted that of every project
the account opens, including the trees the sweep refuses; and the file is the *operator's*, not
ccrc's, which is the sole reason every one of D-1244's six data-loss classes existed at all.
Measured over the one day since it was deployed (2026-09-01, measured 2026-09-02): 109
`query`/`path`/`explain` calls across 4 corpora, 103 of them in the one repository whose *project*
`CLAUDE.md` had carried graphify's block since July, and zero in ccrc-pwa — the busiest project on
the fleet, with five fresh graphs. (The block's own week-shaped window is a different row of the
spec's table — 265 calls across 11 corpora over the last 7 days, ccrc-pwa **zero** in both.)
`_inst_graph_always_on_off` now takes the block back, reusing D-1244's own hardened census:
whole-line markers, exactly one well-ordered pair or the file is left alone, symlinks resolved (and
SKIPPED when they cannot be), the file's own mode preserved, backed up before every write. Anything
else is *left in place; remove by hand*, counted, and reported as a degraded step. It is
`_inst_graph_hooks_off`'s shape and stays in the tree the same way. What replaced it — starting with
the `SessionStart` card that tells a session to run `graphify query` before it greps — is below.
```

**Two constraints on any rewording of this paragraph, both of them mechanised:**

1. It **must** contain the literal `graphify query`. README.md:1515 is the file's only occurrence, it
   lives inside the text being replaced, and `it('the README documents the READ side, not only the
   write side')` (kept by Step 1 item 3, retargeted only in Task 6) asserts `toMatch(/graphify query/)`.
   Drop the token and this task's own Step 5 goes red.
2. It **must not** put a present-tense `converges`/`writes`/`installs`/`plants`/`puts` in front of
   `block`/`read rule` … `CLAUDE.md`, or in front of `always_on/claude-md.md` — Task 6's derived guard
   forbids exactly that, and only that. Saying what D-1243 **did** is allowed and is the point of the
   paragraph; saying ccrc **does** it is what the guard catches. (The earlier draft of this paragraph
   read "converging graphify's packaged `always_on/claude-md.md` into every rostered home's…", which
   the guard's first spelling matched on the bare path-then-`into` sequence; both halves were fixed —
   the paragraph now separates the path from `into`, and the guard now requires a present-tense verb.)

- [ ] **Step 5: Run the suites**

Run:
```bash
bash -n ccd/ccrc
cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts
cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```
Expected: all PASS.

- [ ] **Step 6: Prove the guards are mechanisms**

| mutation | expected red |
|---|---|
| change `grep -cxF` to `grep -cF` (substring census) | "treats markers QUOTED in the operator's prose as prose" — on its `0 cleared, 0 left in place` assertion, NOT on its byte-identity one. Measured: the substring census makes `ns`/`ne` 1, `grep -nxF` still finds no line, `ls`/`le` are empty, the `[` comparisons error non-zero, the splice fails and the `if !` arm leaves the file alone — byte-identical by accident, but `kept` is 1 and stdout reads `0 home(s) cleared, 1 left in place` |
| relax `[ "$ns" -ne 1 ] \|\| [ "$ne" -ne 1 ]` to `[ "$ns" -lt 1 ]` | "leaves a HALF block in place…" and "leaves TWO blocks in place…" |
| drop the `[ -z "$phys" ]` skip and fall back to the link path | "SKIPS a symlink this box cannot resolve" |
| replace `chmod "$mode"` with `chmod 644` | "preserves the file's own mode…" |
| replace `[ "$lb" -le 1 ] \|\|` with an unconditional `sed -n "1,$((lb-1))p"` | "removes a block that sits at LINE 1…" |
| delete the `lb=$((ls-1))` blank-line adjustment | "removes a well-formed block from mid-file, byte-identically around it" |
| move `mkdir -p "$backups"` above the `ns`/`ne` census | "is idempotent: the second run removes nothing and cuts no backup" |
| delete `[ "$kept" -eq 0 ] \|\| INST_DEGRADED+=(graphify-read-rule)` | "leaves a HALF block in place, reports it, and degrades the install" |

- [ ] **Step 7: Commit**

```bash
cd "$CCRC_REPO"
git add ccd/ccrc README.md server/test/ccrc-install.test.ts server/test/ccrc-install-graphify.test.ts
git commit -m "feat(install): retire the account-wide read block; its census becomes the remover (R0, D-1245)"
```

---

## Task 5: R3 — the engine sessions run is the engine ccrc pins

**Files:**
- Modify: `ccd/ccrc` — `_inst_graphify_engine` gains the `~/.local/bin/graphify` converge
- Modify: `ccd/ccrc-doctor-checks` — `CCRC_DOCTOR_CHECKS` gains `graphify-path`; `_check_graphify` loses its PATH-shadow bucket; `_check_graphify-path` added
- Test: `server/test/ccrc-install-graphify.test.ts`, `server/test/ccrc-doctor-graphify.test.ts`, `server/test/ccrc-doctor.test.ts` (fixture only)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - the doctor check id **`graphify-path`** (table entry `graphify-path`, function `_check_graphify-path`; a hyphen is legal in a bash function name and `cmd_doctor` calls `"_check_$name"`). Its verdict lines MUST be printed under that exact id — `cmd_doctor` counts `"PASS $name: "` and reports "the check printed no verdict line of its own" otherwise.
  - the converged path **`$HOME/.local/bin/graphify`** → symlink to `$HOME/.ccrc/graphify-venv/bin/graphify`.

---

- [ ] **Step 1: Write the failing install tests**

Append to `server/test/ccrc-install-graphify.test.ts`:

```typescript
// ── R3: what a session runs when it types `graphify` ──────────────────────
// MEASURED on the reference fleet: `command -v graphify` resolved to
// `~/.local/bin/graphify`, a pip console-script shim importing a July copy of
// the package with no dist-info and no `__version__`, while the venv the sweep
// builds every graph with is pinned at 0.9.9. The WRITE side resolves the
// engine by absolute path everywhere; the READ side was never given a path at
// all, so it ran whatever was on PATH.
describe('ccrc install: ~/.local/bin/graphify converges onto the pinned venv (R3)', () => {
  const link = (home: string) => join(home, '.local', 'bin', 'graphify');
  const venv = (home: string) => join(home, '.ccrc', 'graphify-venv', 'bin', 'graphify');
  const SHIM = '#!/usr/bin/python3\n# -*- coding: utf-8 -*-\nimport sys\n'
    + 'from graphify.__main__ import main\nsys.exit(main())\n';

  it('WRITES the link when nothing is there', () => {
    const home = freshBox('ccrc-inst-gfx-path-new-');
    plantFakeVenv(home);
    rmSync(link(home), { force: true });
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(link(home)).isSymbolicLink()).toBe(true);
    expect(realpathSync(link(home))).toBe(realpathSync(venv(home)));
  });

  it('REPLACES a pip console-script shim — detected by content, not assumed', () => {
    const home = freshBox('ccrc-inst-gfx-path-shim-');
    plantFakeVenv(home);
    writeFileSync(link(home), SHIM, { mode: 0o755 });
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(link(home)).isSymbolicLink(), 'the stale pip shim survived').toBe(true);
    expect(realpathSync(link(home))).toBe(realpathSync(venv(home)));
  });

  it('is a NO-OP on a link that already points into the venv, and cuts no backup', () => {
    const home = freshBox('ccrc-inst-gfx-path-noop-');
    plantFakeVenv(home);
    rmSync(link(home), { force: true });
    symlinkSync(venv(home), link(home));
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/graphify on \$PATH already points at the pinned venv/);
  });

  it('REFUSES a hand-written launcher with a remedy, and does not fail the install', () => {
    // A launcher ccrc did not write is the operator's, and this verb has no
    // --force: the `cmd_wrappers` rule, which refuses rather than destroying
    // something on the strength of a judgement it never made.
    const home = freshBox('ccrc-inst-gfx-path-hand-');
    plantFakeVenv(home);
    const hand = '#!/bin/bash\n# my own launcher\nexec /opt/graphify/bin/graphify "$@"\n';
    writeFileSync(link(home), hand, { mode: 0o755 });
    const r = runInstall(home, ['install']);
    expect(readFileSync(link(home), 'utf8'), 'a hand-written launcher was overwritten').toBe(hand);
    expect(r.stderr).toMatch(/ccrc did not write it/);
    expect(r.stderr).toMatch(/move it aside/);
    expect(r.stdout).toMatch(/degraded step/);
  });

  it('never touches /usr/local/bin/graphify', () => {
    // THE SLICE STARTS AT THE SIGNATURE, so the function's HEADER comment —
    // which does name that path, and should, since it is the reason the write
    // side resolves the engine absolutely — is outside it. Everything from
    // `_inst_graphify_engine() {` to the closing brace is in, comments
    // included, so no sentence inside the body may spell the path either.
    // `ccd/ccrc` carries three other mentions of `_inst_graphify_engine`
    // (the pin's single-definition comment, `cmd_install`'s sequence, and the
    // hooks-off header), none of them followed by `() {`, so the anchor is
    // unambiguous.
    const home = freshBox('ccrc-inst-gfx-path-root-');
    plantFakeVenv(home);
    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    const src = readFileSync(join(treeRoot(home), 'ccd', 'ccrc'), 'utf8');
    const at = src.indexOf('_inst_graphify_engine() {');
    expect(at, 'the function scan went vacuous').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body, 'the converge names a path outside $HOME').not.toMatch(/\/usr\/local\/bin/);
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-inst-gfx-path-server-');
    plantFakeVenv(home);
    rmSync(link(home), { force: true });
    runInstall(home, ['install', '--role', 'server']);
    expect(existsSync(link(home)), 'a server box runs no graphify').toBe(false);
  });
});
```

Add `realpathSync` to that file's `node:fs` import list.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts`
Expected: FAIL — `lstatSync` throws ENOENT: no link is ever written.

- [ ] **Step 3: Implement the converge**

In `ccd/ccrc`, append to `_inst_graphify_engine`, after the `printf '%s\n' "$GRAPHIFY_PIN" > "$HOME/.ccrc/graphify.pin"` line and before its closing `echo`:

```bash
  # ── R3: the engine SESSIONS run is the engine ccrc pins ────────────────
  # The write side resolves this engine by ABSOLUTE PATH everywhere. The read
  # side was never given a path at all: a session types `graphify`, PATH answers
  # `~/.local/bin/graphify`, and on this fleet that was a pip console-script
  # shim importing a July copy of the package with no dist-info and no
  # `__version__`, while every graph on the box was built by the 0.9.9 venv.
  # The drift is invisible until a query fails strangely.
  #
  # `cmd_wrappers`' DISCIPLINE, and no flags: write when absent; replace when
  # the file is already a link into the venv, or is a pip/pipx console-script
  # shim (matched BY CONTENT — a `#!` first line and a `from graphify.__main__
  # import main` line, the shape measured on this fleet, never assumed);
  # REFUSE anything else, because a hand-written launcher is the operator's and
  # this step has no `--force` for anyone to type.
  #
  # ONE PATH ONLY: `$HOME/.local/bin`. The root-owned copy a shared box may
  # carry higher up the system tree is an unprivileged install's business
  # nowhere — the header above this function already says why — and it is not
  # spelled out anywhere inside this body, because the guard
  # `it('never touches /usr/local/bin/graphify')` slices this function from
  # `_inst_graphify_engine() {` to its closing brace and refuses that literal.
  # The slice starts AT the signature, so the header comment is outside it;
  # a sentence like this one is inside. Name the path in the header, never here.
  local gpath="$HOME/.local/bin/graphify" gvenv="$venv/bin/graphify" gcur=""
  if ! mkdir -p "$HOME/.local/bin" 2>/dev/null; then
    echo "install: graphify: cannot create \$HOME/.local/bin — bare 'graphify' still resolves to whatever is on PATH" >&2
    INST_DEGRADED+=(graphify-path)
  elif [ -L "$gpath" ] && [ "$(readlink -f "$gpath" 2>/dev/null)" = "$(readlink -f "$gvenv" 2>/dev/null)" ]; then
    echo "install: graphify: graphify on \$PATH already points at the pinned venv"
  elif [ ! -e "$gpath" ] && [ ! -L "$gpath" ]; then
    ln -sfn "$gvenv" "$gpath" \
      && echo "install: graphify: \$HOME/.local/bin/graphify -> the pinned venv engine (written)" \
      || { echo "install: graphify: cannot write $gpath" >&2; INST_DEGRADED+=(graphify-path); }
  else
    gcur=""
    [ -f "$gpath" ] && [ -r "$gpath" ] && gcur="$(head -c 4096 "$gpath" 2>/dev/null)"
    if [ -n "$gcur" ] \
       && printf '%s' "$gcur" | head -n1 | grep -q '^#!' \
       && printf '%s' "$gcur" | grep -qxF 'from graphify.__main__ import main'; then
      ln -sfn "$gvenv" "$gpath" \
        && echo "install: graphify: \$HOME/.local/bin/graphify was a pip console-script shim -> repointed at the pinned venv" \
        || { echo "install: graphify: cannot replace $gpath" >&2; INST_DEGRADED+=(graphify-path); }
    else
      echo "install: graphify: $gpath is not a pip shim and ccrc did not write it — left in place. Remedy: inspect it (ls -l \"$gpath\"), and if you want ccrc's pinned engine on PATH, move it aside and re-run; nothing here overrides that." >&2
      INST_DEGRADED+=(graphify-path)
    fi
  fi
```

- [ ] **Step 4: Run the install tests**

Run:
```bash
bash -n ccd/ccrc
cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts
```
Expected: PASS.

- [ ] **Step 5: Write the failing doctor tests**

In `server/test/ccrc-doctor-graphify.test.ts` — first add `readFileSync` to its `node:fs` import list (it currently imports `writeFileSync, mkdirSync, symlinkSync, rmSync, utimesSync` only), then:

1. **Delete** the `it('WARNs when PATH resolves graphify outside the pinned venv', …)` test — the question moves to its own check, and a WARN there is exactly the verdict R3 replaces.
2. Extend `graphifyHealthy()` so a healthy box has the converged link (a fixture that does not have it would make the new check FAIL on every other test in the file):

```typescript
  writeFileSync(join(home, '.ccrc', 'graphify.pin'), '0.9.9\n');
  // R3: a converged box has `graphify` on PATH resolving into the pinned venv.
  // `<home>/.local/bin` is the head of every contained PATH in this fixture, so
  // this is what `command -v graphify` answers.
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  rmSync(join(home, '.local', 'bin', 'graphify'), { force: true });
  symlinkSync(join(venvBin, 'graphify'), join(home, '.local', 'bin', 'graphify'));
```

3. Append:

```typescript
describe('ccrc doctor: graphify-path', () => {
  it('PASSes when bare graphify resolves into the pinned venv', () => {
    const home = healthy('ccrc-doctor-gfxpath-ok-'); graphifyHealthy(home);
    expect(lineFor(runDoctor(home).stdout, 'graphify-path')).toMatch(/^PASS graphify-path:/);
  });

  it('FAILs when PATH resolves graphify outside the venv — a WARN understates it', () => {
    // The session runs the wrong build silently, and every answer it gets from
    // it looks exactly like an answer from the right one.
    const home = healthy('ccrc-doctor-gfxpath-shadow-'); graphifyHealthy(home);
    rmSync(join(home, '.local', 'bin', 'graphify'), { force: true });
    stub(home, 'graphify', 'echo "shadow graphify"; exit 0');
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'graphify-path')).toMatch(/^FAIL graphify-path:/);
  });

  it('FAILs when there is no graphify on PATH at all', () => {
    const home = healthy('ccrc-doctor-gfxpath-none-'); graphifyHealthy(home);
    rmSync(join(home, '.local', 'bin', 'graphify'), { force: true });
    expect(lineFor(runDoctor(home).stdout, 'graphify-path')).toMatch(/^FAIL graphify-path:/);
  });

  it('SKIPs on a server-role box, like every other graphify condition', () => {
    const home = healthy('ccrc-doctor-gfxpath-srv-'); graphifyHealthy(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    expect(lineFor(runDoctor(home).stdout, 'graphify-path')).toMatch(/^SKIP graphify-path:/);
  });

  it('the graphify check no longer answers the PATH question, and its wrong remedy is gone', () => {
    // Two checks answering one question is two vocabularies over one field, and
    // the old remedy was FACTUALLY WRONG: "only the operator can clear a
    // root-owned link outside $HOME" describes neither a user-owned file inside
    // $HOME (the measured case) nor anything a session can act on.
    const checks = readFileSync(CHECKS_SRC, 'utf8');
    expect(checks, 'the old, factually wrong remedy is still in the tree')
      .not.toContain('root-owned link outside');
    expect(checks).not.toContain('gfx_shadow_warn');
  });

  it('the table and the functions agree about graphify-path', () => {
    const names = execFileSync(BASH, ['-c',
      `set -uo pipefail; . ${JSON.stringify(CHECKS_SRC)}; printf '%s\\n' "\${CCRC_DOCTOR_CHECKS[@]}"`],
    { encoding: 'utf8' }).trim().split('\n');
    expect(names).toContain('graphify-path');
  });
});
```

In `server/test/ccrc-doctor.test.ts`'s `healthy()` fixture, after the graphify venv/pin writes (~line 997), add the link **and a real `realpath`** so every summary-count test keeps its "every check PASSES" contract:

```typescript
  writeFileSync(join(home, '.ccrc', 'graphify.pin'), '0.9.9\n');
  // R3: `graphify-path` is a check, and healthy()'s contract is that every
  // check PASSES. `<home>/.local/bin` is already the head of the contained
  // PATH (`ghContainedEnv` -> `harnessBin`, which also creates the directory),
  // so the link is what `command -v graphify` finds.
  //
  // `linkReal(home, 'realpath')` IS LOAD-BEARING, not tidiness. This file's
  // contained PATH is `<home>/.local/bin:<home>/stub-bin` and NO system
  // directory — it links in only jq, timeout, stat and date. `_check_graphify-path`
  // resolves both sides with `realpath` and falls back to the UNRESOLVED path
  // when it is unavailable; without a real one on PATH the two sides are the
  // link path and the engine path, they differ, and the check FAILs on a box
  // whose whole contract is that nothing fails. Measured: with `realpath` on
  // PATH the check PASSes; without it, `FAIL graphify-path` and rc=1, which
  // reds `runDoctor(healthy(...)).code === 0`, the `fail === 0` assertion and
  // the `"… 1 warned, 1 failed"` summary pin. (`ccrc-doctor-graphify.test.ts`
  // already links a real `realpath` in its own `healthy()`, which is why the
  // new check is green there and would not have been here.)
  linkReal(home, 'realpath');
  symlinkSync(join(home, '.ccrc', 'graphify-venv', 'bin', 'graphify'),
    join(home, '.local', 'bin', 'graphify'));
```

- [ ] **Step 6: Run them to verify they fail**

Run:
```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor-graphify.test.ts
```
Expected: FAIL — `lineFor(out, 'graphify-path')` is `undefined` (no such check), and the "wrong remedy is gone" test finds it still there.

- [ ] **Step 7: Implement the doctor check**

In `ccd/ccrc-doctor-checks`:

(a) Add the table entry, immediately after `graphify`:

```bash
  graphify
  graphify-path
```

(b) In `_check_graphify`'s header, replace the numbered item 3 with:

```bash
#   3. PATH         — MOVED OUT to its own check, `graphify-path`: what a
#                     session runs when it types `graphify` is a FAIL, not a
#                     warning, and its remedy is a different verb from this
#                     check's (this file's own "grouped by remedy" rule).
```

(c) Delete `gfx_shadow_warn=()` from the `local -a` declaration, delete the whole "── (3) PATH shadow" block (`local shadow` through the `gfx_shadow_warn+=(…)` fi), and delete its verdict block at the bottom (the `if [ "${#gfx_shadow_warn[@]}" -gt 0 ]` arm and its `root-owned link outside \$HOME` remedy).

(d) Add the new check immediately after `_check_graphify`'s closing brace:

```bash
# ── graphify-path: what a session runs when it types `graphify` (R3) ──────
# ITS OWN CHECK, not a bucket inside `graphify`, for this file's own stated
# reason: a condition whose fix is a DIFFERENT verb gets its own bucket and its
# own line, and this one's remedy is neither `ccrc install` alone nor anything
# the sweep can do. A FAIL rather than a WARN, because the failure mode is
# silent: the wrong build answers, and its answers look exactly like the right
# build's. Measured on the reference fleet — `~/.local/bin/graphify` was a pip
# console-script shim importing a July copy with no dist-info and no
# `__version__`, while every graph on the box was built by the pinned 0.9.9 venv.
#
# The hyphen in the name is deliberate and legal: `cmd_doctor` calls
# `"_check_$name"` and counts verdict lines matching `"PASS $name: "`, so the
# printed id and the table entry must be the same string, and bash permits a
# hyphen in a function name defined this way.
_check_graphify-path() {
  # The server-role SKIP, in `_check_graphify`'s own shape and for its own
  # reason: a server box runs no sessions that would type `graphify`.
  local role=""
  if [ -f "$BOX_ENV_FILE" ] && [ -r "$BOX_ENV_FILE" ] && declare -F _box_env_value >/dev/null 2>&1; then
    role="$(_box_env_value "$BOX_ENV_FILE" CCRC_ROLE)"
  fi
  if [ "$role" = server ]; then
    _dr_skip graphify-path "this box's role is server — no fleet session runs here, so nothing types graphify"
    return 3
  fi

  local engine="$HOME/.ccrc/graphify-venv/bin/graphify"
  local found="" resolved="" want=""
  found="$(command -v graphify 2>/dev/null)"
  if [ -z "$found" ]; then
    _dr_fail graphify-path "nothing on \$PATH answers 'graphify' — the pinned engine at $engine is reachable only by absolute path, so every bare invocation a session makes fails" \
      "run: ccrc install — it links \$HOME/.local/bin/graphify at the pinned venv"
    return 1
  fi
  # `realpath` is explicitly ALLOWED by `macos-platform.test.ts` (so is
  # `readlink -f`), and both sides are resolved with the SAME tool so a box
  # without it degrades symmetrically: each side falls back to its own
  # unresolved path. That fallback is honest but blunt — the link path and the
  # engine path are never equal — so any FIXTURE that expects a PASS here must
  # carry a real `realpath` on its contained PATH. Both doctor suites do; see
  # the `linkReal(home, 'realpath')` note in Step 5.
  resolved="$(realpath "$found" 2>/dev/null)" || resolved=""
  [ -n "$resolved" ] || resolved="$found"
  want="$(realpath "$engine" 2>/dev/null)" || want=""
  [ -n "$want" ] || want="$engine"
  if [ "$resolved" = "$want" ]; then
    _dr_pass graphify-path "graphify resolves to $found -> the pinned venv engine"
    return 0
  fi
  _dr_fail graphify-path "\$PATH resolves graphify to $found (-> $resolved), which is not the pinned engine at $engine — a session that types graphify runs a build this box does not pin, and its answers are indistinguishable from the right one's" \
    "run: ccrc install — it links \$HOME/.local/bin/graphify at the venv and refuses rather than replacing a launcher it did not write; if $found is one ccrc will not touch, move it aside, or put \$HOME/.local/bin ahead of it on \$PATH"
  return 1
}
```

- [ ] **Step 8: Run the doctor suites**

Run:
```bash
bash -n ccd/ccrc-doctor-checks
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor-graphify.test.ts
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts
cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts
```
Expected: all PASS — including `ccrc-doctor`'s "every name in the table has a `_check_<name>` function, and vice versa" and its summary-count tests.

- [ ] **Step 9: Prove the guards are mechanisms**

| mutation | expected red |
|---|---|
| change `_dr_fail graphify-path` to `_dr_pass graphify-path` in the mismatch arm | "FAILs when PATH resolves graphify outside the venv…" |
| delete the `[ -z "$found" ]` arm and PASS on an empty resolution | "FAILs when there is no graphify on PATH at all" |
| restore the old remedy string in `_check_graphify` | "the graphify check no longer answers the PATH question, and its wrong remedy is gone" |
| remove `graphify-path` from `CCRC_DOCTOR_CHECKS` | `ccrc-doctor` — "every name in the table has a `_check_<name>` function, and vice versa" (ORPHAN) |
| widen the shim detector to accept any `#!` file | "REFUSES a hand-written launcher with a remedy…" |
| drop the `[ -L "$gpath" ] && …readlink -f…` no-op arm | "is a NO-OP on a link that already points into the venv…" |

- [ ] **Step 10: Commit**

```bash
cd "$CCRC_REPO"
git add ccd/ccrc ccd/ccrc-doctor-checks server/test/ccrc-install-graphify.test.ts \
        server/test/ccrc-doctor-graphify.test.ts server/test/ccrc-doctor.test.ts
git commit -m "feat(install,doctor): converge PATH onto the pinned graphify venv, and FAIL when it drifts (R3)"
```

---

## Task 6: README, the derived guards, the ledger, and the whole-suite pass

**Files:**
- Modify: `README.md` (the graphify section's step enumeration and a new read-side subsection)
- Modify: `server/test/ccrc-install-graphify.test.ts` (retarget the README-derived describe; add the new guard)
- Modify: `docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md` (this file's `## Deviations found`, if the re-check moves the numbers)

**Interfaces:**
- Consumes: `_inst_graph_always_on_off` (Task 4), the `graphify-path` check id (Task 5), clause 12 (Task 3), the `graphQueries` field name and the `graph N` chip (Task 1), the `SessionStart` card (Task 2).
- Produces: nothing later reads.

**Two prose items this task was carrying, both already shipped — checked, not redone:**

- `CLAUDE.md`'s "eleven clauses" → **"twelve clauses"** (the File Structure table above): shipped with
  clause 12 itself in `c1955022` (R2). Verified at Task 6: `CLAUDE.md:181` reads "twelve clauses
  pinned by", and `server/test/worker-skill.test.ts` is the mechanism behind the number.
- the comment above `INST_DEGRADED+=(linger)` in `ccd/ccrc`, which claimed that step was the array's
  **only** writer — false since the graphify steps landed, and deferred to this task by Task 5's
  reviewers: shipped in `119dec11` (D-1347..D-1350). Verified at Task 6 (`ccd/ccrc:4975`): the comment
  now says the "only" sentence "stopped being true the day the graphify steps landed" and names both
  other writers, `graphify-read-rule` (`_inst_graph_always_on_off`) and `graphify-path`
  (`_inst_graphify_engine`), as a census rather than a claim.

---

- [x] **Step 1: Write the failing README guards** — done ahead of this task by **D-1355** and
**D-1356** (`c6d38193`), which found the branch's one standing README guard passing by SUBSTRING and
replaced it with exactly these two `it()` blocks. Not a deviation; the shipped guards are the text
below plus what that round measured on top of it — the token list gained `additionalContext` and
`graphReadCount`, because `SessionStart` and `graphQueries` alone left R1's and R4's bullets
deletable with the loop still green, and the `PreToolUse` decline gained an assertion of its own.

In `server/test/ccrc-install-graphify.test.ts`, replace the `it('the README documents the READ side, not only the write side', …)` test with:

```typescript
  it('the README documents the read side as it now is — hook, skill, PATH, counter', () => {
    // The whole point of this plan, and the thing the canonical overview would
    // otherwise still describe as a block in somebody else's CLAUDE.md.
    expect(readme, 'the canonical overview never mentions querying the graph')
      .toMatch(/graphify query/);
    for (const token of [
      '_inst_graph_always_on_off',   // R0, the remover
      'SessionStart',                // R1, the card
      'clause 12',                   // R2, the worker skill
      'graphify-path',               // R3, the doctor check
      'graphQueries',                // R4, the counter
    ]) {
      expect(readme, `the README never mentions ${token}`).toContain(token);
    }
  });

  it('never again describes the read side as something ccrc writes into a CLAUDE.md (D-1245)', () => {
    // THE RULE THIS GUARD ENFORCES, in one sentence, so the next editor of
    // README.md does not trip it by accident: the README may say what D-1243
    // DID — past tense, and that history is the whole point of the paragraph
    // above — and may say that `_inst_graph_always_on_off` TAKES a block back;
    // what it may never say again is that ccrc, in the PRESENT tense, puts one
    // into a `CLAUDE.md`. Both patterns therefore hinge on a present-tense
    // verb, and neither fires on `converged`/`wrote`/`appended`/`planted`.
    //
    // DERIVED, not a spelling test. The second pattern was once written as a
    // bare `always_on/claude-md\.md`? into` — no verb at all — and it matched
    // the honest history sentence in the paragraph above, forcing a choice
    // between the guard and the record. A guard that forbids the truth is a
    // guard nobody can keep.
    const flat = readme.replace(/\s+/g, ' ');
    const NOW = /\b(converges|writes|installs|plants|puts)\b/.source;
    expect(flat, 'the README describes ccrc writing a read rule into a CLAUDE.md again')
      .not.toMatch(new RegExp(`${NOW}[^.]{0,140}\\b(block|read rule)\\b[^.]{0,140}CLAUDE\\.md`, 'i'));
    expect(flat, "the README says ccrc installs graphify's packaged block again")
      .not.toMatch(new RegExp(`${NOW}[^.]{0,140}always_on/claude-md\\.md`, 'i'));
  });
```

- [x] **Step 2: Run it to verify it fails** — moot as written, and honestly so: **D-1355**
(`c6d38193`) wrote the guard against the README as it then stood, and MEASURED the red this step
asks for from the other direction — the pre-D-1355 guard was GREEN on a README that documented none
of the read side, which is spec §4's last mutation row in its mutated state. Step 6 below re-measures
the shipped guard's red on the shipped tree.

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts`
Expected: FAIL — the README mentions none of `SessionStart`, `clause 12`, `graphify-path`, `graphQueries`.

- [x] **Step 3: Rewrite the README's step enumeration** — done ahead of this task by **D-1355**
(`c6d38193`); the count is still **six** and the enumeration guard is green (Step 5). Not a
deviation.

In `README.md`, in the "### Graph layer (graphify)" opening paragraph, change the one clause naming the retired step (the count stays **six** — `_inst_graph_always_on_off` is still one step in `cmd_install`'s sequence, and the enumeration guard derives it):

```markdown
skills, it has no vendored tree — into every rostered account's skills directory; the **read-rule
removal** (below), which takes back what D-1243 wrote into each rostered home's `CLAUDE.md`; the
**default noise list**, ccrc's own footprint converged to
```

- [x] **Step 4: Add the read-side subsection** — done ahead of this task by **D-1356**
(`c6d38193`), which is why the shipped section is NOT the draft below: this text was written before
Tasks 1–5 shipped, and transcribing it verbatim would have put five stale claims into the canonical
overview (the freshness vocabulary of D-1353/D-1336, the converge arms of D-1348/D-1351/D-1352, the
doctor's SKIP of D-1350, `graphReadCount` from D-1251, the card's clipping from D-1335). Not a
deviation — read the shipped section, not this draft.

Immediately after the "**Reading the graph…**" paragraph Task 4 wrote, insert:

```markdown
**What replaced it: four mechanisms, each in an artifact ccrc owns outright.** The rule D-1245 states
is that the read side lives only where ccrc owns the file it is written in, and that its effect is
*measured* rather than asserted.

- **The graph card.** On `SessionStart` — every source, `compact` included, because compaction is
  exactly when a session loses what it knew — `ccd/session-hook.sh` prints one JSON object on stdout:
  `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`. The card is
  measured for *that session's tree* (`cwd` from the payload, `$REG/<id>.workdir` as the fallback):
  node count, the commit the graph was built at, whether that is **fresh** or *N commits behind
  HEAD*, and the engine/pin pair — sessions were measured querying 0.9.9 graphs with an unversioned
  July build, and that drift is otherwise invisible until a query fails strangely. No `graph.json`
  prints **nothing**, except that when `~/.ccrc/graph-sweep.json` carries a row for the tree the
  sweep's own refusal reason is printed instead. `built_at_commit` is the last key of an 8 MB
  `graph.json`, so it is read with `tail -c 4096`, never by parsing the file; the freshness pair are
  git ref reads. **Stdout stays empty on every other event** — on `PreToolUse` a stdout JSON is a
  permission decision — and that is pinned in both directions by `server/test/session-hook.test.ts`.
- **Worker clause 12.** `ccd/worker-skill/SKILL.md` now carries twelve clauses, pinned verbatim: a
  workspace with a `graphify-out/graph.json` takes a codebase question to `graphify query` before
  `grep`, and never runs `graphify update` or any build in the workspace — a session-side build holds
  the worker at `working` for minutes and wedges the next dispatch `worker-busy`.
- **The engine on `PATH`.** `_inst_graphify_engine` converges `~/.local/bin/graphify` onto
  `~/.ccrc/graphify-venv/bin/graphify`: written when absent, repointed when the file is already a link
  into the venv or a pip console-script shim (matched by content), and **refused with a remedy** for
  anything else — a hand-written launcher is the operator's. `/usr/local/bin/graphify` is never
  touched. Doctor's `graphify-path` check FAILs (it does not warn) when `command -v graphify` resolves
  anywhere but the pinned venv, because the wrong build's answers are indistinguishable from the right
  build's.
- **The number.** The hook increments `graphQueries` in the hookstate it already writes, on a
  `PostToolUse` whose `Bash` command runs `graphify query`/`path`/`explain`. Builds do not count — this
  measures reads. It is carried the way `subagents` is, reset on any `SessionStart` that is not a
  `resume` (D-1248) and kept across `resume` and `compact`. `server/src/hookstate.ts` is its one reader and keeps **`null`
  (no field — an older hook) apart from `0` (measured none)**; it rides `FleetSession.graphQueries`
  additively (no `FLEET_PROTO` bump) and renders as a `graph N` chip on the fleet card and on the run
  board's worker row. The server never reads `~/.cache/graphify-queries.log`: it is not under the agent
  whitelist and this design adds no read root.

The `PreToolUse` speed bump — one deny on a session's first `Grep` in a tree with a fresh graph and a
`graphQueries` of 0 — was considered and **declined**: `PreToolUse` fires for subagents, which never
saw the card; a deny path would be the first thing in the hook that can wedge a turn; and the counter
above is what makes adoption measurable, so the gate belongs *after* there is a number, not before.
```

- [x] **Step 5: Run the README guards and the whole graphify story**

Run:
```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts
cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
```
Expected: PASS — including "the README's count matches the number of steps that actually run" (still six).

MEASURED (2026-09-02, on the shipped tree at `da4ded09`):

```
test/ccrc-install-graphify.test.ts   Tests  43 passed (43)
test/ccrc-install.test.ts            Tests  103 passed | 18 skipped (121)
```

- [x] **Step 6: Prove the new guard is a mechanism**

Each mutation was applied to `README.md` on the shipped tree at `da4ded09`,
`ccrc-install-graphify` was run, and the file was restored from a scratchpad copy before the next
one. The bullet the first row deletes is R4's — "**The number (R4).**" through the end of that list
item.

| mutation | expected red | MEASURED |
|---|---|---|
| delete the `graphQueries` bullet from the README | "the README documents the read side as it now is…" | `Tests  1 failed \| 42 passed (43)` — red on the `graphReadCount` token, which D-1355 added *because* `graphQueries` survives this very deletion in the R5 decline paragraph below it ("a `graphQueries` of 0"). This row is why: the draft token list above would have stayed GREEN on it |
| re-insert the sentence "`_inst_graph_always_on` converges graphify's own packaged block into every rostered home's `CLAUDE.md`" | "never again describes the read side…" — measured red on the FIRST pattern | `Tests  1 failed \| 42 passed (43)` — `the README describes ccrc writing a read rule into a CLAUDE.md again` |
| re-insert the sentence "`_inst_graph_always_on` installs graphify's packaged `always_on/claude-md.md` in each rostered home" | "never again describes the read side…" — measured red on the SECOND pattern (one row per pattern: a table row that only ever reddens one of two assertions leaves the other unmeasured) | `Tests  1 failed \| 42 passed (43)` — `the README says ccrc installs graphify's packaged block again`, the OTHER assertion of the same `it()`, so neither pattern is left unmeasured |
| replace Task 4's paragraph with the earlier draft ("converging graphify's packaged `always_on/claude-md.md` into every rostered home's…") | **stays GREEN, and must** — this is the history the README is there to record, and the guard's job is to forbid the present-tense claim, not the past-tense one. If this mutation goes red, the guard was re-widened and the paragraph and the guard are fighting again | `Tests  43 passed (43)` — GREEN, as required: `converging` is not one of the five present-tense verbs, so the honest history sentence survives the guard that forbids the present-tense claim |

- [x] **Step 7: Re-check the deviation number against `origin/main`**

The ledger allocation rule: grep `origin/main` across BOTH `docs/` and source, take the next number. `origin/main` carries `D-1244` today (PR #44, merged as `651f40c5`; re-measured at plan-review time and still `D-1244`), so this plan's three entries are `D-1245`, `D-1246` and `D-1247` — but re-measure at commit time, because another branch may have landed in between:

```bash
cd "$CCRC_REPO"
git fetch origin main --quiet
git grep -ohE 'D-1[0-9]{3}' origin/main -- docs/ ccd/ server/ agent/ pwa/ shared/ deploy/ README.md CLAUDE.md \
  | sort -u | tail -5
```
MEASURED (2026-09-02, at Task 6): `origin/main` is `5e9f650d`, which CARRIES `651f40c5` (PR #44,
this branch's cut point), and its highest defined number is **D-1332** — not D-1244. That re-check
was first taken and acted on mid-branch; see the NUMBERING note at the head of the D-1333 block
below. Nothing renumbers now: `D-1245`–`D-1252` are still unused on `origin/main` (0 hits each
across `docs/ ccd/ server/ agent/ pwa/ shared/ deploy/ README.md CLAUDE.md`), main skipped the
1245–1293 range entirely, and every later entry on this branch already allocates above D-1332.

Expected: `…D-1242 D-1243 D-1244`. If the highest is **not** D-1244, renumber `D-1245`/`D-1246`/`D-1247` in this plan AND in every source comment and test name Tasks 4, 5 and 6 wrote (`git grep -n 'D-1245\|D-1246\|D-1247'` finds them all) to the next three free numbers, then re-run `server/test/deviation-refs.test.ts`.

- [x] **Step 8: Run the whole suite, in the foreground**

Run each in the FOREGROUND with `timeout` ≥ 600000 ms:
```bash
cd "$CCRC_REPO"/server && npm run test
cd "$CCRC_REPO"/agent  && npm run test
cd "$CCRC_REPO"/pwa    && npm run test
```
Expected: all green. Anything red among `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state` is a KNOWN LOAD FLAKE — re-run that one suite IN ISOLATION before calling it a real break, and remember that a single green isolated run of `ccd-session-state` is not proof it was the load.

Then the typecheck gates:
```bash
cd "$CCRC_REPO"/server && npx tsc --noEmit -p tsconfig.json
cd "$CCRC_REPO"/server && npx tsc --noEmit -p test/tsconfig.tests.json   # the tests, which the project above excludes
cd "$CCRC_REPO"/pwa    && npx tsc --noEmit
cd "$CCRC_REPO" && bash -n ccd/ccrc && bash -n ccd/session-hook.sh && bash -n ccd/ccrc-doctor-checks
```

MEASURED (2026-09-02, on the shipped tree at `da4ded09` plus this task's plan edits — no source
file changed in Task 6, so the suites are measuring Tasks 1–5 and the branch-review rounds):

```
server   Test Files  248 passed (248)     Tests  6346 passed | 56 skipped (6402)
agent    Test Files   18 passed (18)      Tests   281 passed (281)
pwa      Test Files   77 passed (77)      Tests  2116 passed (2116)     Type Errors  no errors
```

All green on the FIRST run — none of the five known load flakes (`ccd-ws-gc`, `pr-sweep`,
`session-hook`, `typecheck-tests`, `ccd-session-state`) fired, so nothing needed an isolated re-run.
The four typecheck/`bash -n` gates above are clean: `tsc -p tsconfig.json`, `tsc -p
test/tsconfig.tests.json`, the PWA project (also reported inline by its own suite), and all three
shell files.

- [x] **Step 9: Commit**

```bash
cd "$CCRC_REPO"
git add README.md server/test/ccrc-install-graphify.test.ts docs/superpowers/plans
git commit -m "docs(readme): the read side is the hook, the skill, the PATH and the number (D-1245)"
```

AS RUN: `README.md` and `server/test/ccrc-install-graphify.test.ts` were already committed at
`c6d38193` under exactly that message and its two D-numbers (D-1355, D-1356), so this task's commit
carries **only** `docs/superpowers/plans/` — the ticks above, Step 6's measured table, and the two
stale ledger cells re-measured. Committing the two source files again would be an empty diff.

---

## Deviations found

- **D-1245** (2026-09-02) — D-1243 put a project-scoped instruction into an account-wide file ccrc
  does not own: graphify's `always_on/claude-md.md` opens "This project has a knowledge graph at
  `graphify-out/`" and was converged into every rostered home's config-dir `CLAUDE.md`, which Claude
  Code loads for every session under that account in every project — including the trees the sweep
  refuses. Measured effect over the one day since it was deployed (2026-09-01, measured 2026-09-02):
  109 `query`/`path`/`explain` calls across 4 corpora, 103 of them in the one repository whose
  *project* `CLAUDE.md` had carried graphify's block,
  committed, since 2026-07-08; **zero** in ccrc-pwa, the busiest project on the fleet, with five fresh
  graphs. Every one of D-1244's six data-loss classes existed only because ccrc was rewriting a file
  it does not own. Retired for R0–R4: the read side now lives only in artifacts ccrc installs and owns
  outright — `ccd/session-hook.sh`'s `SessionStart` card, worker clause 12, the `~/.local/bin/graphify`
  converge, and the `graphQueries` counter in the hookstate the hook already writes.

- **D-1246** (2026-09-02) — the design named two sources for the card's node count and **neither
  carries one**. Measured on this box: `~/.ccrc/graph-sweep.json` is `{"passes":[{started, finished,
  pin, status, trees:[{path, outcome, reason, duration_ms}]}]}` — a rolling window of the last ten
  passes (newest LAST, not a single top-level object as the spec's §2 R1 states), and a tree's row
  carries no node count at all; `graphify-out/manifest.json` (122,918 bytes) is a per-FILE map of
  `{mtime, ast_hash, semantic_hash}`, so its only count is of files. The number the card wants is on
  `GRAPH_REPORT.md`'s summary line (`- 7662 nodes · 15645 edges · 423 communities`), which is inside
  the file's first 4 KB and therefore just as cheap a read as the two the spec named. The card reads
  it with `head -c 4096` and omits the clause when it is absent — the spec's own "else is omitted"
  arm, reached by a different route. The census is still read, for the refusal reason on a tree with
  no graph, and the reader now takes `.passes | last` rather than the top level.

- **D-1247** (2026-09-02) — the spec quotes the remover's refusal phrase as *"left
  in place — remove by hand"* (§2 R0, spec line 75), with an em dash before the remedy. **The tree
  spells it with a semicolon**, in both places that already say it: `_inst_graph_hooks_off`'s chained-
  content refusal (`ccd/ccrc:5411`, "— left in place; remove by hand") and the converge's unmarked-
  section refusal (`ccd/ccrc:5249`, "— left in place; remove it by hand"). The remover is explicitly
  built as `_inst_graph_hooks_off`'s idiom, so it follows the tree: every `_inst_graph_always_on_off`
  refusal ends `— left in place; remove by hand`, and Task 4's half-block test asserts
  `/left in place; remove by hand/`. Recorded because the mismatch was live for one review cycle in
  the opposite direction — the plan's test regex carried the spec's em dash against messages that
  never had one, which no message in the function could ever have satisfied.

  *(Snapshot note, added by D-1343: the two line numbers above — `ccd/ccrc:5411` and `:5249` — are
  as-of-authoring and are BOTH wrong in the shipped tree. `:5249` was the converge's
  unmarked-`## graphify` refusal, which Task 4's own commit deletes, so it names no site at all any
  more. The entry is kept as written because a ledger entry is a snapshot; the SHIPPED comments cite
  `_inst_graph_hooks_off` by name instead.)*

- **D-1248** (2026-09-02, Task 1 review) — the plan spelled the counter's reset as the ALLOW-LIST
  `SessionStart && ( "$src" == startup || "$src" == clear )`, which makes one file give two different
  answers to one payload. Ten lines above it, the `SessionStart` arm reads an ABSENT `source` by
  absence-permits — "startup, resume, clear, or ABSENT on an older harness — is a real idle boundary
  … the pre-`source` payload was the F1 startup" (`ccd/session-hook.sh:146-147`), pinned by
  `session-hook.test.ts`'s "SessionStart(startup) is done — and so is a payload with no source at
  all". Under the allow-list, that same source-less payload was a NEW session for `state` and the SAME
  session for `graphQueries`. MEASURED against a fixture HOME (never the live `$HOME`): two counted
  `graphify` reads then `{"hook_event_name":"SessionStart"}` with no `source` left
  `{"graphQueries":2,"state":"done","event":"SessionStart"}` — state re-stamped as a new session, the
  count kept. Because the hookstate file is keyed `cc-<id>`, which survives a restart of the same tmux
  session name, the count would accumulate across sessions forever on a harness that sends no
  `source`, and the card would report previous sessions' reads as this one's — the exact way this
  counter can lie about the number the whole plan exists to produce. **Shipped as
  `SessionStart && "$src" != resume`**: `resume` is the only source that is genuinely the same session
  still going (`compact` never reaches the line — the arm exits at the D-306 guard, so its carry is
  structural), and everything else, absent or unknown to this build, resets. The degrade points the
  safe way: an unrecognised boundary costs a count rather than inventing one. Two new tests pin both
  polarities and the allow-list spelling is now a measured RED row in Step 15's mutation table.

- **D-1249 — the plan pinned only the NULL half of the assembly seam, and read the hook's three fields
  in an order that let one of them shift the other two.** Two findings, one commit, both from the
  second review round.

  **(a) The positive carry was unpinned.** Step 10(c) asked for three `toBeNull()` assertions and
  Step 15's table named one mutation on `server/src/fleet.ts` (`?? 0`). Both look at the ABSENCE half.
  Nothing anywhere asserted that a hookstate count of N reaches `FleetSession.graphQueries` as N —
  `grep -rn graphQueries server/test pwa/test` found no non-null assertion downstream of
  `assembleFleet` — so the seam `graphQueries: hs?.graphQueries ?? null` could be replaced by a literal
  `null`, deleting the guard and dropping the count for every live session, with the full server suite
  still green (MEASURED by the reviewer: 248 files / 6286 tests, zero failures). That is lens-(d)
  exactly, and the identical class the first review round blocked on for `shared/api.ts`'s `optNum` —
  fixed there, left open here, because `assembleFleet` is the LIVE `/api/fleet` path and
  `reviveFleetSession` is only the degraded-mode read. Fixed by extending the sibling positive test in
  `server/test/fleet.test.ts` (seed `graphQueries: 7`, assert `7`, rename to "all four fields") and
  adding a measured-zero test beside it (`graphQueries: 0` → `0`), which also closes `hs ? 0 : null`.
  Three rows added to Step 15's table, all measured RED.

  **(b) The hook's one-fork three-field read was positionally fragile.** The fork-merge that put
  `graphQueries` into `subs`/`prev_state`'s existing jq kept the original field order, so the filter
  read `(.subagents | tostring), (.state), (.graphQueries)` over a LINE-delimited channel with the one
  field that can carry arbitrary text FIRST. The comment was right that `tostring` escapes a newline
  inside an ARRAY, but on a JSON *string* `tostring` returns the text raw: an externally-corrupted
  `.subagents` that is a string containing a newline emits four lines and shifts `prev_state` and `gq`
  onto the wrong ones. `subs` self-heals through its `\[*` guard and `gq` through `^[0-9]+$`, but
  `prev_state` has NO guard and is written into the file as `state` on the SubagentStart/Stop path — a
  robustness regression against the pre-merge code, which read `.state` with its own jq and could not
  be shifted at all. It degrades rather than lies (an out-of-set `state` reaches
  `server/src/hookstate.ts:233` and returns `NO_STATE`) and it needs an externally-corrupted file, but
  the fix is free: the order is now `(.state), (.graphQueries), (.subagents | tostring)` with the three
  `read -r` names swapped to match, so a shift can only corrupt `subs`, which was already caught. Same
  one fork, same hot-path budget. Pinned by a new `session-hook` test that seeds
  `subagents: "evil\nline"` and asserts `state` and the count survive; measured RED against the old
  order.

- **D-1250** (2026-09-02, whole-branch review) — **the branch's 91 new lines of shell landed in the
  one hot-path ccd file the standing GNU sweep did not scan.** `macos-platform.test.ts`'s "THE SWEEP,
  STANDING" exists, by its own header, so that "anything main adds later merges cleanly with nothing
  prompting a BSD-compatibility review" is caught by a mechanism — but its corpus was a hand-kept list
  of the four files the macOS port itself had touched (`ccd/ccd`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`,
  `ccd/ccrc-api`; this plan enumerates them at line 23 and cites the suite at its own verification
  step, line 318). `ccd/session-hook.sh` was in none of them. MEASURED: five GNU-only spellings
  planted in Task 1's new block at `ccd/session-hook.sh:194` — `stat -c %Y`, `date +%s%3N`,
  `sha256sum`, `uuidgen`, a bare `timeout` — passed `bash -n` and left the suite byte-identically
  green (`Tests  25 passed | 10 skipped (35)`). That is the file whose own header (:12-27) names a BSD
  `date` answering `…3N` as the worst way it can fail: `jq` rejects the non-number, `|| exit 0`
  swallows it, THE HOOK WRITES NOTHING, and every session on the box reads as unsupervised while
  looking healthy from the inside. Nothing on the branch is actually broken — re-running the suite's
  own ten `gnuOnly` regexes over the hook finds exactly one hit, the VALIDATED `date +%s%3N` fallback
  inside `_hook_epoch_ms` — which is why the fix is a guard, not a code change, and why a bare append
  to `corpora` does not work (measured: it fails on that one legitimate line).
  **Shipped:** the corpus is now DERIVED from `ccd/`'s shebang'd files rather than listed, so the next
  file added there is a decision someone records in this suite instead of a gap nobody sees; the
  hook's `_hook_epoch_ms` is cut out of its scanned text the way the platform block is cut out of ccd
  and ccrc, exempt because the body-equality pin already ties it byte-for-byte to ccd's
  `_plat_epoch_ms` inside ccd's own scanned block. Three files carry named `unowned` exemptions with
  the spellings they still use (`ccclip`, `ccd-graph-sweep`, `ccrc-adopt` — 10 hits between them,
  measured; porting them is out of this branch's scope), each under a RATCHET that goes red once its
  GNU-only calls are gone, and the census refuses a shebang'd file that is in neither list. Seven
  previously-unscanned clean files (`ccd-cap-scopes`, `ccrc-wrapper-shape`, the four `install-*.sh`,
  `statusline-command.sh`) come into the corpus for free. Three mutations measured RED: the five
  planted calls in the hook (`Tests  1 failed | 37 passed`), dropping the hook back out of the corpus
  (2 failed — the census and the ratchet), and widening the epoch exemption to swallow the event
  dispatch (1 failed — the three body anchors).

- **D-1251** (2026-09-02, whole-branch review) — **the branch took the additive-wire compatibility and
  did not honour it on the read side.** `graphQueries` ships ADDITIVE with `FLEET_PROTO` deliberately
  held at 1 (Task 2's own interfaces block, and the field's docstring at `shared/api.ts`), which is a
  promise that a server predating it keeps talking to a newer client. Absence-permits, though, was
  implemented on the REVIVE path only (`optNum(o, 'graphQueries')` inside `reviveFleetSession`, whose
  one consumer is `loadFleetSnapshot`), and the tree already states twice — `pwa/src/lib/offline.ts`
  and `unmeasuredFields`' docstring — that a LIVE `fleet` frame never revives: `asFleetMsg` validates
  `Array.isArray(sessions)` and returns `m as FleetMsg`. Both new chips read the field raw
  (`session.graphQueries !== null`, `pwa/src/fleet/SessionLine.tsx` and
  `pwa/src/screens/RunsScreen.tsx`), so on a row from an older server `undefined !== null` is true.
  MEASURED on BOTH surfaces, by rendering a session with the key `delete`d — the shape such a server
  actually sends: `<span class="sess-graph" title="undefined graphify read(s) this session">graph
  </span>`. That is the exact inversion of the contract the chip exists to carry: `null` means nothing
  measured and must render NO chip, `0` means measured-and-read-nothing; the numberless chip paints an
  ignorant row as one that reported. It is also CLAUDE.md's wire rule broken in its own words — a
  newer peer tolerates an older peer's omission "through a SINGLE reader per field", and here there
  were two inline readers and no tolerant one. Scenario reachability is not hypothetical in this repo:
  `unmeasuredFields`' docstring already enumerates the causes (a rollback, a `dist-pwa` deployed
  before the process restarts, a cached client shell reconnecting to an old process) and records that
  reading such a field directly was measured as a TypeError that killed the renderer.
  **Shipped:** `graphReadCount` in `shared/api.ts`, beside `unmeasuredFields`/`substrateFault` and in
  their idiom — the ONE place both surfaces read the field, so they cannot drift onto two fallbacks.
  Absence degrades to `null`, the OPPOSITE direction from `unmeasuredFields`' `[]` and deliberately
  so: an older server is ignorant of the count, never a witness that the session read nothing. A
  present-but-unusable value (a string, `NaN`, `Infinity`) degrades to `null` too, matching `optNum`'s
  rule on the revival path. Three mutations measured RED: reverting `SessionLine` to the raw read
  (`Tests  2 failed | 87 passed (89)` — the omitted-key row and the non-number row, the first failing
  with the finding's own `title="undefined graphify read(s) this session"` byte-for-byte), reverting
  `RunsScreen` to the raw read (`Tests  1 failed | 82 passed (83)`), and gutting `graphReadCount` to
  `return s.graphQueries as number | null` (`Tests  3 failed | 169 passed (172)` across both suites);
  the weaker mutation `return s.graphQueries ?? null` still reds the non-number pin (`Tests  1 failed
  | 171 passed (172)`), so the finite check is pinned separately from the absence check. The two
  surfaces carry their own tests rather than sharing one: a single reader is what stops them drifting,
  and a pin on only one of them cannot see the other drift. Both assert on the `.sess-graph` CLASS,
  not the text — RTL's matcher trims, so `graph ` normalises to `graph` and a text query would miss
  the very chip the test forbids.

- **D-1252** (2026-09-02, Task 2) — **Task 2's Step 5 row 5 named a mutation its test cannot see.**
  The table pins `''|*[!0-9]*) fresh=""` — the freshness arm's "a `rev-list` that will not answer gets
  no clause" degrade — with *"exits 0 and still prints a card when the tree is not a git repo"*. That
  test's tree has no git at all, so `tip` is empty and the whole `[ -n "$built" ] && [ -n "$tip" ]`
  block is SKIPPED: the `case` the mutation edits is never reached. MEASURED against a fixture HOME:
  flipping that arm to `fresh="fresh"` left the suite **`Tests  45 passed (45)`**, byte-identically
  green — the guard the comment calls the whole reason the clause exists was a comment, not a
  mechanism. The arm's own condition is a tree that HAS a HEAD but carries a `built` sha git will not
  measure against (`git rev-list --count <unknown-sha>..HEAD` exits 128, `behind=""`), which is
  reachable in a fixture and is the live shape too — a graph built before a force-push, or copied in
  from another checkout. **Shipped:** one added test, "omits freshness when rev-list will not answer
  for the built sha", planting `built: 'c'.repeat(40)` in a one-commit repo and asserting the card
  still names `built at cccccccc` while claiming neither `fresh` nor `behind HEAD`. Re-measured with
  it in place, the same mutation is RED (`Tests  1 failed | 45 passed (46)`). No shell changed: the
  guard was already right, only unpinned.

> **NUMBERING, RE-MEASURED AT COMMIT TIME (and the reason these jump).** The Task-2 review sheet said
> the next free number was **D-1253**. It is not: that measurement read this branch and this plan
> only. `origin/main` has moved from `651f40c5` (the commit this branch was cut from, carrying
> `D-1244`) to `5e9f650d` — **corrected at Task 6**, where Step 7 re-took this measurement: the sha
> first written here, `551a6cb6`, is PR #42's merge, an ANCESTOR of the cut point rather than
> anywhere main had moved TO. The move is real (`5e9f650d` is PR #43's merge and carries
> `651f40c5`); only the sha was mis-transcribed. The wave-7 program-leverage plan that landed in
> between allocated
> **D-1294..D-1332** from `POST /api/ledger/deviations`. Grepping BOTH trees, as the ledger rule
> says, the highest defined number anywhere is **D-1332**, so this round takes **D-1333..D-1337**.
> The branch's own earlier entries (D-1245..D-1252) collide with nothing — main skipped the 1245-1293
> range entirely — so they are left exactly as they are rather than renumbered under a rewritten
> commit. Re-measure again before the next allocation; main moves.

- **D-1333** (2026-09-02, Task 2 review) — **the card's census read left a standing single-source-of-
  truth guard RED on the branch.** `single-definition.test.ts` pins the files that may spell
  `graph-sweep.json` as exactly `['ccd/ccd-graph-sweep', 'ccd/ccrc-doctor-checks']` — "the sweep WRITES
  it, doctor READS it". `_hook_graph_card`'s no-graph arm reads the same census, which makes
  `ccd/session-hook.sh` a third holder, and Task 2's Step 4 named only `session-hook` /
  `install-session-hooks` / `macos-platform`, so the suite that guard lives in was never run: MEASURED
  at `888124ef` on a clean tree, `npm run test` was `Test Files  1 failed | 247 passed (248)` with the
  single failure `+ "ccd/session-hook.sh"`. **Shipped: the pin widened, not the read removed.** What
  the guard forbids is a SECOND DEFINITION — a `CENSUS=`-shaped copy nothing derives from — and the
  hook cannot derive: it is installed on its own into `~/.cc-sessions` and runs as Claude Code's hook
  with no ccd around to source, so spelling the path is the only thing available to it. The list stays
  exact-match, so a fourth holder still reddens it (MEASURED: a planted fourth bash file under `ccd/`
  gives `Tests  1 failed | 98 passed (99)`).

- **D-1334** (2026-09-02, Task 2 review) — **two shipped guards had no fixture that could reach them.**
  `[ -z "$engine" ] || …` and `[ -z "$pin" ] || …` were both unmeasurable: `plantGraph` wrote
  `.graphify_engine` UNCONDITIONALLY (`${opts.engine ?? '0.9.9'}` — and `??` cannot express absence,
  it would keep `''`), and no test asserted the card is silent about a pin. MEASURED before the fix,
  making either clause unconditional left the suite byte-identically green at `Tests  46 passed (46)`
  while the shipped card would read `…, built at deadbeef, engine  (pin )`. Both absences are LIVE, not
  hypothetical: the fleet-integration design states outright that an unstamped graph is legal
  ("`unstamped` is not an outcome"), and `~/.ccrc/graphify.pin` exists only after `ccrc install`'s
  `_inst_graphify_engine` has run on that box. **Shipped:** `plantGraph` takes `engine: null` on its own
  branch, plus one test — "omits engine and pin when the graph is unstamped and the box has no pin" —
  that plants neither stamp nor pin. Both mutations are now RED at `Tests  1 failed | 47 passed (48)`.
  No shell changed; the guards were right, only unpinned.

- **D-1335** (2026-09-02, Task 2 review) — **the card was the one payload this file emitted with no
  cap.** `$row` is `graph-sweep.json`'s `.reason`, which `ccd-graph-sweep` fills from ONE LINE of the
  engine's stderr (`BUILD_REASON="$first"`, a bare `head -n1`) or from a whole matched refusal line —
  repo-controlled, unbounded — and it lands verbatim in `additionalContext` on every subsequent
  SessionStart for that tree. The same file already clips everything else it produces (`.[0:200]` on
  the approval summary, the 64KB envelope cap), so this was an omission and not a policy. **Shipped:**
  `row="${row:0:400}"` before the interpolation, pinned by "clips a pathological census reason instead
  of injecting it whole" (a 100 000-character reason; the emitted context must stay under 600).
  MEASURED: deleting the clip gives `expected 100140 to be less than 600`, `Tests  1 failed | 47
  passed (48)`. The other arm needs no cap — each of its fields is bounded at the read (a validated
  7–40 hex sha sliced to 8, digits off a 4096-byte head, `head -c 64` on engine and pin).

- **D-1336** (2026-09-02, Task 2 review) — **`fresh` was an overloaded null at the card's seam.** With
  a `built` sha in hand and a `tip` in hand but `rev-list --count "$built..HEAD"` exiting 128, the arm
  set `fresh=""` and the card emitted `…, built at cccccccc` with no clause — byte-identical to the
  card for a tree with no git at all, which names no sha and has nothing to measure against. Two
  conditions a reading session handles differently collapsed onto one value, which this repo's own
  conventions call a defect and not a style; and a card that names a sha and then says nothing about
  it reads as NEUTRAL rather than as undatable, which is the opposite of what the clause exists for.
  D-1252's new test pinned the SILENCE, so it pinned the collapse. **Shipped:** that arm now says
  `freshness unmeasured`; the D-1252 test asserts the words, and the not-a-git-repo test asserts their
  ABSENCE, so the two silences can no longer be merged. MEASURED: merging them back (`fresh=""`) is
  RED at `Tests  1 failed | 47 passed (48)`.

- **D-1337** (2026-09-02, Task 2 review) — **the hook became a second, hand-rolled reader of the sweep
  census schema with nothing coupling it to the writer** — the D-306 shape. `_gs_row` in
  `ccd/ccd-graph-sweep` builds `{path, outcome, reason, duration_ms}`; `_hook_graph_card` re-spells
  that shape in its own jq filter, `graph-sweep.test.ts` reads the census through its own TS helper and
  never feeds a real census to the hook, and `session-hook.test.ts` hand-wrote its census fixture.
  Renaming `reason` to `why` in the sweep would have left every suite green while the shipped card went
  permanently silent on the no-graph path. **Shipped:** the hook suite now BUILDS its census with the
  sweep's own writer — `_gs_row` and `_gs_finish` lifted verbatim out of `ccd/ccd-graph-sweep` and run
  in a bash subshell against the fixture HOME (`install-session-hooks.test.ts` derives its event list
  from the hook's own `case` block for the same reason). MEASURED: the `reason` -> `why` rename now
  reds both census tests with `the hook printed nothing` (`Tests  2 failed | 46 passed (48)`), and
  renaming `_gs_row()` itself reds them at the lift's own assertion, `ccd-graph-sweep no longer defines
  _gs_row()`.

- **D-1338** (2026-09-02, Task 3) — **Step 7's proof command can never print nothing.** The step ends
  `git grep -n "eleven clauses"` with *Expected: no output*, but `git grep` scans the whole tree,
  including `docs/`, and the phrase lives there for reasons no edit to the skill can remove: this very
  plan spells it three times (its own File Structure row and Step 7's two lines), the spec it
  implements spells it once (`…-design.md:56`, an artifact table describing the skill as it stood when
  the spec was written), and two shipped plans record it as history
  (`2026-08-24-build9b-peers-claims-allocator.md`, five hits from the ten→eleven change; a plan's
  ledger is authoritative history and is not edited backwards). MEASURED after Step 7's three edits:
  the bare command prints 10 lines, all of them in `docs/`. The proof that actually holds is the one
  scoped to shipped source — `git grep -n "eleven clauses" -- . ':!docs/'` — which exits 1 with no
  output, and the broader `git grep -nE "\b(11|eleven) (clause|line)" -- ccd/ server/ pwa/ shared/
  README.md CLAUDE.md` finds a single unrelated hit (`ccd/ccd:5801`, "the close is eleven lines").
  Recorded because a verification step whose expected output is unreachable teaches the next reader to
  ignore it, which is the same failure mode as a comment standing in for a mechanism.

- **D-1339** (2026-09-02, Task 3) — **Step 8's third mutation row names an edit clause 12 cannot
  carry.** The row is *"replace a straight apostrophe in clause 12 with a curly one"*, cited as the
  reason D-104 exists. Clause 12 contains **zero** apostrophes of either kind (MEASURED:
  `sed -n 69p ccd/worker-skill/SKILL.md | grep -o "'" | wc -l` → 0), so the mutation as written cannot
  be applied and the row would have been reported as measured without anything having been measured.
  The row's real content is two separate claims, and both were measured on their own terms.
  (a) *A curly apostrophe reds the pin* — applied to clause 2's `workspace's`, the nearest clause that
  has one: RED at `Tests  1 failed | 10 passed (11)`, failing on clause 2's own literal. (b) *An
  invisible lookalike byte inside clause 12 reds the pin* — the ASCII hyphen in `session-side` swapped
  for U+2011: RED at `Tests  1 failed | 10 passed (11)`, failing on clause 12's literal with the
  file rendering identically in every editor. Recorded rather than silently substituted, because the
  substitution changes which clause the row proves anything about.

  A second, sharper note from the same step: **`git checkout -- <file>` is the wrong revert for a
  mutation applied to a file whose task edits are still unstaged.** Following the standing rule
  literally after mutation 1 discarded the whole of clause 12 along with the mutation — Step 3's work,
  silently, with the suite then green for the wrong reason had it not been re-run. The mutation loop
  here keeps a pristine copy of the edited file outside the tree and restores from that, verifying
  with `diff` and a re-run before moving on. Any task that measures a mutation table before its commit
  needs the same, or must stage first.

- **D-1340** (2026-09-02, Task 3, R2 review fix) — **Step 5's paragraph describes a `SessionStart`
  card the hook does not print.** The block was authored before Task 2's own fix commit landed
  (`2e77f98e`, D-1333..D-1337) and collapses precisely the distinctions that commit exists to
  preserve. (a) It opens *"Every session's `SessionStart` prints one line for its own tree"*, but
  `_hook_graph_card` returns SILENTLY for a tree with no `graphify-out/graph.json` and no sweep-census
  row (`ccd/session-hook.sh:78-103`, `[ -n "$row" ] || return 0`) and prints a DIFFERENT sentence —
  `graphify: this tree has no knowledge graph — the ccrc sweep's last pass says …` — for a tree the
  sweep refused. (b) It states freshness as *"fresh or N commits behind HEAD"*, two values, where the
  hook emits four states plus absence: `fresh`, `1 commit behind HEAD`, `<n> commits behind HEAD`, and
  D-1336's `freshness unmeasured` (`:130-140`), whose own comment in the hook calls the two-value
  collapse "a defect and not a style ('no overloaded null at a seam')" — and node count, built-sha and
  freshness are each omitted individually when their measurement fails (`:148-152`). A coordinator
  following the paragraph as written quotes a clause that is not there, or reports a missing card as a
  fault. THE TREE GOVERNS: the paragraph is restated from the hook as shipped.
  And because nothing under `server/test/` read that paragraph, the drift could never go red — so it
  is now BOUND, in the idiom `coordinator-skill.test.ts` already uses to cross-check SKILL.md's
  refusal codes against `wave-lifecycle.md`. A new describe harvests every `fresh="…"` assignment out
  of `ccd/session-hook.sh` (the count placeholder normalised away, leaving `fresh`,
  `behind HEAD`, `freshness unmeasured`) and requires each in the paragraph; harvests the refused-tree
  sentence from the hook's own `_hook_emit_context` call and requires it quoted; and requires the
  paragraph to say a tree can get NOTHING. MEASURED — renaming the hook's `freshness unmeasured` to
  `freshness unknown` reds BOTH suites (`Tests  2 failed | 77 passed (79)` across the pair), and
  deleting the paragraph's absence half reds the coordinator suite
  (`Tests  1 failed | 64 passed (65)`).

- **D-1341** (2026-09-02, Task 3, R2 review fix) — **Clause 12 as Steps 1/3 spell it consumes nothing
  of the card Task 2 built, and the clause COUNT was pinned nowhere.** Two holes, both cardinality-
  or decision-shaped, both closed in the same commit.
  (a) **The branch.** The plan's clause 12 is unconditional — a codebase question goes to
  `graphify query` before `grep` or a file read, conditioned only on `graphify-out/graph.json`
  existing — while the coordinator paragraph three files away exists to hand the worker a freshness
  figure and says *"a graph 97 commits stale answers confidently and wrongly"*. A worker whose own
  card reads `97 commits behind HEAD` was told by its contract to prefer that graph's answer over
  reading the file: information delivered with no decision rule attached, the same shape as a comment
  standing in for a mechanism. Clause 12 now carries the rule the card was built to feed — *"only
  `fresh` licenses taking it as read, while `N commits behind HEAD`, `freshness unmeasured`, or no
  freshness clause at all makes every query answer a LEAD to verify by opening the file it names"* —
  and `CONTRACT[11]` in `server/test/worker-skill.test.ts` was updated byte-identically in the same
  edit. Its vocabulary is bound to the hook by the same harvest as D-1340, so a card word the hook
  stops printing reds the clause that branches on it.
  (b) **The count.** After Step 7 the number `twelve` was hand-maintained in five places
  (`SKILL.md:49`, `SKILL.md:52`, `CLAUDE.md:181`, `README.md:1142`, `README.md:1326`) and asserted in
  none — no test anywhere contained the string. MEASURED at the review: reverting any one of them to
  `eleven` left the suite GREEN, and so did APPENDING a 13th clause to `SKILL.md`, because the
  `CONTRACT` pin is a subset check with no cardinality — the contract could be extended with no pin,
  which is the one thing "pinned verbatim" exists to prevent. D-1338 exists only because proving the
  old count gone had to be done by `git grep`; a mechanism makes that step unnecessary. Two derived
  assertions close both: the `^\d+\. ` clause numbering must equal `1..CONTRACT.length` exactly, and
  the spelled-out count — `WORDS[CONTRACT.length]`, `box-token-census.test.ts`'s index-addressed idiom
  — is harvested out of `SKILL.md`'s own prose and out of the window following each
  `ccd/worker-skill/SKILL.md` mention in `README.md` and `CLAUDE.md`, so the sites are DERIVED rather
  than listed by line number.
  **Step 8's table gains four rows, all MEASURED** (pristine-copy revert per D-1339, `git diff --stat`
  and `md5sum -c` clean after each):

  | mutation | measured red |
  |---|---|
  | drop clause 12's freshness branch (back to the plan's own wording) | `worker-skill` — `Tests  1 failed / 13 passed (14)`, "carries all twelve clauses verbatim" |
  | `These twelve clauses` → `These eleven clauses` in `SKILL.md` | `worker-skill` — "spells that same count…": `SKILL.md says eleven where the CONTRACT pins 12` |
  | `twelve clauses` → `eleven clauses` at `README.md:1142` | `worker-skill` — same test: `README.md says eleven clauses where the CONTRACT pins 12` |
  | append a 13th clause to `SKILL.md` | `worker-skill` — "numbers exactly as many clauses as the CONTRACT pins": `[1..13]` vs `[1..12]` |

  The three rows the plan already had were re-measured against the new clause text and all still red
  at `Tests  1 failed | 13 passed (14)` on "carries all twelve clauses verbatim": delete clause 12
  (which now reds the numbering pin too, `2 failed | 12 passed`), soften "Never run `graphify update`",
  and the U+2011 lookalike-byte swap in `session-side` (D-1339's substitute for the impossible
  apostrophe row — clause 12 still carries zero apostrophes).

- **D-1342** (2026-09-02, Task 3, second R2 review fix) — **D-1340/D-1341's two harvest bindings were
  VACUOUS on `fresh`, the one state that licenses trusting the graph.** Both describes compared with
  `toContain`, and the harvest yields `['fresh', 'freshness unmeasured', 'behind HEAD']`: `fresh` is a
  SUBSTRING of `freshness unmeasured`, so its arm was satisfied by the longer word's mere presence and
  could never fail. That is precisely the failure the describes were written to prevent — "a clause
  that branches on a word the hook stopped printing is a rule that can never fire" — landing on the
  most load-bearing word in the card, and on the wave-lifecycle paragraph, which carries NO verbatim
  pin and so had that harvest as its ONLY binding. Both now match on a word BOUNDARY
  (`new RegExp('\\b' + escape(word) + '\\b')`, `.toMatch`) instead of a raw substring: `\bfresh\b` is
  false on `freshness unmeasured` and true on both docs' own backticked `` `fresh` ``, so all three
  arms stay green today and all three became mechanisms. The backticked-form alternative was rejected
  because the harvest normalises the count away to a bare `behind HEAD`, which neither doc backticks
  in that form.

  Measured, on top of `5bcbc881` (baseline `Test Files  2 passed (2)` / `Tests  79 passed (79)`):

  | mutation | red |
  | --- | --- |
  | clause 12 + its `CONTRACT` literal: ``only `fresh` licenses`` → ``only `up to date` licenses`` | `worker-skill` — `Tests  1 failed \| 13 passed (14)`, "clause 12 branches on no card word matching `fresh`" — the review's own probe, GREEN before this fix |
  | `wave-lifecycle.md`: BOTH of the paragraph's `` `fresh` `` → `` `up to date` `` | `coordinator-skill` — `Tests  1 failed \| 64 passed (65)`, "the graph-card paragraph never names the `fresh` state the hook prints" — GREEN before this fix |
  | clause 12 + `CONTRACT`: `` `N commits behind HEAD` `` → `` `N commits stale` `` | `worker-skill` — `Tests  1 failed \| 13 passed (14)`, "…no card word matching `behind HEAD`" |
  | `ccd/session-hook.sh`: `fresh="freshness unmeasured"` → `fresh="freshness unknown"` (re-measured) | BOTH — `Test Files  2 failed (2)` / `Tests  2 failed \| 77 passed (79)`, each now naming the regex: `expected … to match /\bfreshness unknown\b/` |

  One measurement worth keeping: replacing only the FIRST of the paragraph's two `` `fresh` ``
  occurrences left `coordinator-skill` green at `Tests  65 passed (65)`, correctly — the paragraph
  still named the state once. The binding is "this doc names the word", not "names it twice"; the
  review's probe had to edit both, and so did the mutation row above.


- **D-1343** (2026-09-02, Task 4 review fix) — **two defects the R0 step shipped with, both in the
  half of the work that is supposed to prove the other half.**

  **(a) The backup guard had no mutation test.** `_inst_graph_always_on_off`'s backup is the ONLY
  copy of the operator's `CLAUDE.md` that exists before a destructive delete, and its
  `if ! { mkdir -p "$backups" && cp -a …; }` refusal shipped with no row that goes red when it is
  deleted: no fixture ever made the backup fail, so replacing the whole chain with an unconditional
  `mkdir -p …; cp -a … || true` left all 28 rows green (measured). The positive half was loose in the
  same way — `expect(backupDirs(home).length).toBeGreaterThan(0)` counts `~/ccrc-backups/<ts>`
  DIRECTORIES and says nothing about which file was copied, which is exactly the assertion
  `_inst_graph_hooks_off`'s own backup row had already refused one function over ("NOT a global
  `readdirSync(ccrc-backups).length === 1` count … the assertion should not depend on that staying
  true"). Both halves are now bound: the idempotence row asserts some backup dir holds an entry
  ending `_CLAUDE.md`, and a new row plants `$HOME/ccrc-backups` as a REGULAR FILE so `mkdir -p`
  fails, then asserts the file is byte-identical, `stderr` says `left in place rather than rewritten
  unbacked`, and the install degrades. That fixture is safe in this suite because the only other
  install step writing there (`_inst_graph_hooks_off`) backs up solely what it finds pre-existing,
  which a `freshBox` has none of.

  **(b) The step's header comment cited two line numbers, and the same commit deleted one of the
  sites.** The plan prescribed `(ccd/ccrc:5411 and :5249)` verbatim (plan line 1481, authored before
  Task 4 existed), and Task 4 copied it into `ccd/ccrc` and into the half-block test. Both numbers
  were wrong the moment the commit landed: `sed -n '5249p;5411p'` prints unrelated prose, and `:5249`
  had been the converge's unmarked-`## graphify` refusal, which R0 removes. Per the standing rule the
  TREE wins over the plan, so both comments now cite `_inst_graph_hooks_off`'s chained-content
  refusal BY NAME — the one other place the tree says the phrase — and drop the deleted site. Line
  numbers into a 6 000-line file that every future edit shifts are not citations; this codebase asks
  readers to follow its `D-N` comments as authoritative history, and a citation that resolves to
  unrelated prose teaches them to stop.

  Measured, on top of `8589a0c4` (baseline `Tests  29 passed (29)` with the two test edits in place):

  | mutation | red |
  | --- | --- |
  | `ccd/ccrc`: the whole backup guard → `mkdir -p "$backups" 2>/dev/null; cp -a … 2>/dev/null \|\| true` (the review's own probe, GREEN against the 28-row suite) | `Tests  1 failed \| 28 passed (29)` — 'REFUSES to rewrite a file it could not back up, and degrades the install': the block was deleted with no backup of the file taken |
  | `ccd/ccrc`: drop only the `cp -a` from the guard, keep `mkdir -p` (the mutation a bare directory COUNT cannot see) | `Tests  1 failed \| 28 passed (29)` — 'is idempotent…': "no backup dir holds a copy of the CLAUDE.md the first run rewrote", `expected true, received false` |

  The second row is the point of the scoping change: with `mkdir -p` still running, the timestamp
  directory exists and empty, so the old `backupDirs(home).length > 0` assertion stayed GREEN while
  the operator's file was rewritten with nothing kept.


- **D-1344** (2026-09-02, Task 5) — **Task 5 Step 3's own comment block violated the guard it was
  citing.** The step prescribes a `_inst_graphify_engine` body comment that explains the guard by
  quoting its test name in full — `` `it('never touches /usr/local/bin/graphify')` `` — while that
  guard slices the function from `_inst_graphify_engine() {` to its closing brace and refuses the
  literal `/usr/local/bin` *anywhere inside*, comments included. The comment is inside the slice, so
  the paragraph asserting "it is not spelled out anywhere inside this body" spelled it. MEASURED, with
  the converge implemented exactly as Step 3 writes it: `Tests  1 failed | 34 passed (35)` —
  'never touches /usr/local/bin/graphify': `the converge names a path outside $HOME`, the offending
  text being the citation itself. Per the standing rule the TREE (here, the guard) wins over the plan:
  the comment now cites the guard by FILE and by the words its name *begins* with, never the path, and
  says out loud that citing it in full is itself a violation. Nothing about the guard or the converge
  changed — this is the plan's prose, not its mechanism.

- **D-1345** (2026-09-02, Task 5) — **the doctor's output-contract test pinned an alphabet nobody had
  chosen, and R3's check id is outside it.** `ccrc-doctor.test.ts`'s "every line is exactly
  PASS|WARN|FAIL|SKIP <name>: <detail>" asserted `/^(PASS|WARN|FAIL|SKIP) [a-z0-9_]+: \S/`. The
  charset was never a stated rule — it is simply the alphabet the 26 pre-existing check ids happened
  to use — but `graphify-path`, whose hyphen the spec (§R3), the plan's own Interfaces block and
  `_check_graphify-path`'s header all choose deliberately (bash permits it in a function name defined
  as `name() {`, and `cmd_doctor` matches the printed id against the table entry byte-for-byte), made
  it report a SHAPE violation for a line that has exactly the shape the test is named for. MEASURED
  before the fix: `Tests  1 failed | 313 passed | 3 skipped (317)` — `expected 'PASS graphify-path:
  graphify resolves…' to match /^(PASS|WARN|FAIL|SKIP) [a-z0-9_]+: \S/`. Neither renaming the check
  (the spec names the id) nor widening the class to `[a-z0-9_-]+` (a second guess at an alphabet) is
  right: the name half is now DERIVED from `CCRC_DOCTOR_CHECKS` via the file's existing
  `tableNames()`, this project's "enumerate once, derive" rule, and the result is STRICTER than the
  old regex — a verdict line printed under a name the table does not carry used to pass the shape
  assertion and is now red. The plan listed this file as "fixture only" for Task 5; it is not.

- **D-1346** (2026-09-02, Task 5) — **R3 adds a fifth entry to `~/.local/bin` and a standing census
  said there were four.** `ccrc-install.test.ts`'s "runs the wrapper converger with no flags…" ends
  with an exact-set assertion over everything in `$HOME/.local/bin` that the FIXTURE did not plant —
  the four executables `_inst_bins` installs — as its proof that the default roster generates no
  wrapper and the verb leaves no temp file or staged leftover behind. The R3 converge writes a fifth
  name there deliberately, so the census had to learn it. MEASURED before the fix: `Tests  1 failed |
  102 passed | 18 skipped (121)` — `expected [ 'ccd', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccrc',
  'graphify' ] to deeply equal [ 'ccd', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccrc' ]`. `graphify` is
  added to BOTH platform arms, unlike the two entries above it: `_inst_bins` gates `ccd-cap-scopes` on
  cgroups and `ccd-graph-sweep` on a systemd timer, while `_inst_graphify_engine` is gated only on the
  server role. The assertion stays an exact set — it is not loosened to "contains".

- **D-1347** (2026-09-02, Task 5 fix round) — **R3 grew a fifth name in `~/.local/bin` and the
  uninstall's census of that directory is HAND-KEPT, so it still knew four.** `_inst_graphify_engine`
  converges `$HOME/.local/bin/graphify` onto the pinned venv; `_uninst_tree_bins` removes `ccd`,
  `ccrc`, `ccd-cap-scopes` and `ccd-graph-sweep` and named the four in its own closing sentence.
  `ccrc uninstall` therefore STRANDED the link, and `--purge` — which removes `~/.ccrc` whole a few
  lines later — turned it into a **dangling `graphify` first on every session's PATH**: strictly worse
  than the box was before ccrc, because the pip shim that used to answer there was copied aside by the
  install (D-1349) and never put back. This is the same defect class as D-1346 one verb over: a census
  that is a sentence rather than a derivation. Removed ONLY WHEN IT IS OURS, which is `_uninst_wrappers`'
  rule in its own words ("everything ccrc could not prove it wrote was left in place") — proof is the
  link's own target, read with a ONE-HOP `readlink` (no `-f`, so no box is asked for a tool it may not
  have — D-1348's lesson on the install side) against the exact literal the install writes. A regular
  file (the hand-written launcher the install REFUSES to touch) and a symlink pointing anywhere else
  are both reported and kept, because an uninstall that removed one would be destroying an operator's
  launcher on the strength of a judgement the install had already declined to make.

  | mutation | expected red | MEASURED |
  |---|---|---|
  | `if [ -L "$glink" ]` → `if false` in `_uninst_tree_bins` (the whole census deleted) | `ccrc-uninstall` — "the tree and the executables go…" AND "graphify: a launcher ccrc did not write SURVIVES uninstall…" | `Tests  2 failed \| 19 passed \| 4 skipped (25)` |
  | `[ "$gtgt" = "$HOME/.ccrc/graphify-venv/bin/graphify" ]` → `[ -n "$gtgt" ]` (remove ANY symlink) | `ccrc-uninstall` — "graphify: a launcher ccrc did not write SURVIVES uninstall…" | `Tests  1 failed \| 20 passed \| 4 skipped (25)` |
  | add `rm -f -- "$glink"` to the regular-file arm that only reports | same test | `Tests  1 failed \| 20 passed \| 4 skipped (25)` |

- **D-1348** (2026-09-02, Task 5 fix round) — **the converge's no-op arm compared two `readlink -f`
  substitutions inline, and EMPTY = EMPTY is TRUE.** The arm shipped as
  `elif [ -L "$gpath" ] && [ "$(readlink -f "$gpath")" = "$(readlink -f "$gvenv")" ]`. On a box whose
  `readlink` has no `-f` — macOS below 12.3, a floor this repo ACCEPTS rather than enforces
  (`macos-platform.test.ts`) — both substitutions answer empty, the test passes, and **any** symlink,
  including one pointing at a completely different engine, was declared "already points at the pinned
  venv" and left alone. That is the overloaded null this codebase bans at a seam, in exactly the shape
  D-1244 named one step below. Fixed the way `_inst_graph_always_on_off` fixed it: both sides resolved
  ONCE into locals, both required non-empty before any equality is claimed, and an unresolvable link
  LEFT IN PLACE, said out loud with a remedy, and counted `INST_DEGRADED+=(graphify-path)` — degraded,
  never acted on unmeasured. Also recorded here: this step resolves with `readlink -f` while
  `_check_graphify-path` resolves with `realpath`; both are allowed by `macos-platform.test.ts` and
  neither is preferred, but the two halves must agree that EMPTY means "unmeasured" and never
  "unequal" — the install degrades, the doctor SKIPs (D-1350), and both files now say so in a comment.
  The review that found this named the measurement nobody had taken: **no fixture in the suite ever
  planted a link pointing OUTSIDE the venv**, so the whole resolution comparison could be deleted with
  all six R3 tests still green. Two new cases plant it — one resolvable, one with a `readlink` stub
  whose `-f` fails the way that userland's does.

  | mutation | expected red | MEASURED |
  |---|---|---|
  | reduce the no-op arm to `elif [ -L "$gpath" ]; then` — the mutation nobody had measured | `ccrc-install-graphify` — "REFUSES a symlink at a NON-SHIM engine — the state the no-op arm used to swallow" | `Tests  2 failed \| 41 passed (43)`, RE-MEASURED at Task 6 on `da4ded09`. The row shipped citing "REFUSES a symlink that resolves OUTSIDE the venv…" at `Tests  1 failed \| 36 passed (37)`: honest when it was taken, stale twice over since. `6ae35e56` **renamed** that test to the title above (D-1351 narrowed it to what its `#!/bin/sh` fixture ever pinned) and added the pipx case, which this mutation reddens too — hence 2, not 1 — and D-1358/D-1360 then took the file from 39 tests to 43 |
  | `elif [ -L "$gpath" ] && { [ -z "$gnow" ] \|\| [ -z "$gwant" ]; }` → `elif false` (the unresolvable arm deleted) | `ccrc-install-graphify` — "LEAVES a link this box cannot resolve in place, degraded — empty is not \"equal\"" | `Tests  1 failed \| 36 passed (37)` |

- **D-1349** (2026-09-02, Task 5 fix round) — **the pip-shim arm destroyed a file ccrc did not write,
  with no backup and no atomic swap, while its own header claimed `cmd_wrappers`' discipline.** The
  arm was one `ln -sfn "$gvenv" "$gpath"`. `cmd_wrappers`' discipline is a `cp -p` copy to
  `<name>.pre-ccrc-<UTC>` BEFORE the overwrite, and `ln -sfn` over a live path is unlink+symlink — a
  session that types `graphify` in that window gets ENOENT. A pip console-script shim is replaceable
  because its CONTENT proves what it is, not because it is ccrc's, so it earns the keep-aside rather
  than losing it. Shipped: `cp -p` first, a failed backup **degrades instead of replacing unbacked**
  (`_inst_graph_always_on_off`'s own "left in place rather than rewritten unbacked"), and the swap is
  `ln` to a dot-prefixed temp name then one `mv -f`. The "." in both names is load-bearing for the
  reason `cmd_wrappers` gives — no legal wrapper id carries one, so neither copy nor leftover is
  visible to `ccrc adopt`'s scan, to `_check_wrappers`, or to the `*` glob `_uninst_wrappers` walks.
  `_uninst_keep_asides` gains the THIRD glob, `$HOME/.local/bin/graphify.pre-ccrc-*`: it runs after
  `_uninst_tree_bins` has freed that path (D-1347), so the `mv` it prints is the difference between
  "off ccrc" and "off ccrc with a hole where your graphify used to be".

  | mutation | expected red | MEASURED |
  |---|---|---|
  | `if ! cp -p -- "$gpath" "$gbak"` → `if false` (the backup deleted, the swap kept) | `ccrc-install-graphify` — "REPLACES a pip console-script shim…" (its D-1349 backup assertions) | `Tests  1 failed \| 36 passed (37)` |
  | drop `"$HOME/.local/bin/graphify.pre-ccrc-"*` from `_uninst_keep_asides`' glob list | `ccrc-uninstall` — "keep-asides: the restore commands are PRINTED and the files untouched" | `Tests  1 failed \| 20 passed \| 4 skipped (25)` |

- **D-1350** (2026-09-02, Task 5 fix round) — **the doctor check folded "could not resolve either
  side" into "the wrong engine is on PATH".** Step 7(d) shipped `[ -n "$resolved" ] || resolved="$found"`
  and `[ -n "$want" ] || want="$engine"`, and a link path is never equal to an engine path — so a
  fully CONVERGED box that simply has no `realpath` was told `FAIL graphify-path: … which is not the
  pinned engine …`: a mismatch verdict on a comparison nobody made, carrying a remedy (`ccrc install`)
  that cannot put coreutils on the box. An adapter may not narrow a distinction it received, and
  unmeasurable is this file's stated FOURTH OUTCOME. Now a SKIP naming the missing tool, in
  `_check_scopes`' own shape (no remedy line, by contract — the fact goes in the detail). The
  genuinely-missing ENGINE is a different condition and keeps its FAIL: it is measured directly with
  `-e` and answered before the resolution question is asked, so it is never folded into the skip. The
  plan's own Step 7(d) comment ("that fallback is honest but blunt") described the defect and shipped
  it anyway; the shipped comment now says what the arm must not do instead. Both new arms have a
  fixture: one removes `realpath` from the contained PATH of an otherwise-converged box, one plants a
  foreign `graphify` with the venv deleted.

  | mutation | expected red | MEASURED |
  |---|---|---|
  | replace the `[ -z "$resolved" ] \|\| [ -z "$want" ]` SKIP arm with the old `\|\| resolved="$found"` / `\|\| want="$engine"` fallback | `ccrc-doctor-graphify` — "SKIPs — never FAILs — when the box has no usable realpath…" | `Tests  1 failed \| 23 passed (24)` |
  | delete the `[ ! -e "$engine" ]` FAIL arm, letting a missing engine fall into the skip | `ccrc-doctor-graphify` — "FAILs when something answers graphify but there is NO pinned engine…" | `Tests  1 failed \| 23 passed (24)` |

- **D-1351** (2026-09-02, Task 5 review round) — **a symlink whose TARGET is a console-script shim —
  the commonest real state this step exists to fix — took the replace arm by accident, pinned by
  nothing.** `pipx install graphify` leaves `~/.local/bin/graphify -> ~/.local/pipx/venvs/graphify/bin/graphify`.
  That link resolves fine and is not the venv, so no link arm answers it: `[ -f ]` and both content
  probes FOLLOW the link, it reads as a shim, and it is replaced. That verdict is defensible — content
  proves what the thing is, and being reached through a link does not make it the operator's
  hand-written launcher — but no fixture planted the state, so the behaviour was unspecified and could
  have flipped silently in either direction, while the header comment's "REFUSE anything else" and the
  neighbouring test title read as though no foreign symlink is ever touched. Shipped: a fixture that
  plants exactly that pipx shape and asserts the verdict, including the two surprising consequences —
  `cp -p` DEREFERENCES, so the keep-aside is a regular-file copy of the shim rather than a copy of the
  link, and the pipx-owned file at the far end is left untouched. The header comment now states the
  rule ("content decides, and it decides through a link too") and the sibling test's title is narrowed
  to `REFUSES a symlink at a NON-SHIM engine`, which is all its `#!/bin/sh` fixture ever pinned.

  | mutation | expected red | MEASURED |
  |---|---|---|
  | `if [ -f "$gpath" ] && [ -r "$gpath" ]` → `if [ ! -L "$gpath" ] && [ -f "$gpath" ] && [ -r "$gpath" ]` (links refused instead of judged by content) | `ccrc-install-graphify` — "REPLACES a shim reached THROUGH a symlink, and orphans nothing (D-1351)" | `Tests  1 failed \| 42 passed (43)`, RE-MEASURED at Task 6 on `da4ded09`. The row shipped as `Tests  2 failed \| 37 passed (39)` "(the second is D-1352's case, measured on the same run before its arm was re-applied)" — which is not a mutation table entry at all but a MEASUREMENT SLIP: the number was copied off a run whose tree was carrying a SECOND mutation, so it reported another mutation's collateral as this one's red. A mutation table's count is the count for the mutation in its own row, on an otherwise-shipped tree, or the row proves less than it looks like it proves |

- **D-1352** (2026-09-02, Task 5 review round) — **the arm that stopped overloading EMPTY then printed
  a cause it never measured.** D-1348's new arm said `is a symlink this box cannot resolve (its
  readlink has no -f)`. EMPTY from `readlink -f` is itself overloaded across at least two conditions:
  a userland without `-f`, and a chain the tool cannot walk. Measured with GNU coreutils 9.4 on the
  box this was written on: `ln -s /gone/deeper/bin/graphify x; readlink -f x` exits 1 printing
  nothing, because `-f` requires every component but the last to exist. So an operator whose coreutils
  is perfectly capable — after an ordinary `pipx uninstall graphify` — was told their readlink was the
  problem. Same defect class as the commit it shipped in, one message over. Shipped: the
  distinguishable half is MEASURED FIRST, mirroring what `_check_graphify-path` does with
  `[ ! -e "$engine" ]` — `elif [ -L "$gpath" ] && [ ! -e "$gpath" ]` gets its own sentence naming the
  target it read with a plain one-hop `readlink` — and what remains states only what it measured, the
  way `_inst_graph_always_on_off` (`ccd/ccrc`) has always said it, with no cause claimed. The new arm
  also catches the shape whose parents DO exist, which resolved non-empty and used to fall through to
  the not-a-shim refusal; both routes are planted by the fixture.

  | mutation | expected red | MEASURED |
  |---|---|---|
  | `elif [ -L "$gpath" ] && [ ! -e "$gpath" ]` → `elif false` (the broken-link arm deleted) | `ccrc-install-graphify` — "names a BROKEN link for what it measured — not for a cause it guessed (D-1352)" | `Tests  1 failed \| 38 passed (39)` |
  | `elif [ -L "$gpath" ] && { [ -z "$gnow" ] \|\| [ -z "$gwant" ]; }` → `elif false` (D-1348's arm, re-measured after the message change) | `ccrc-install-graphify` — "LEAVES a link this box cannot resolve in place, degraded — empty is not \"equal\"" | `Tests  1 failed \| 38 passed (39)` |


- **D-1353** (2026-09-02, whole-branch review) — **`fresh` was overloaded a SECOND time, on the arm
  D-1336 left standing.** D-1336 fixed the silence at this seam and kept the measurement that feeds
  it: `behind=$(git rev-list --count "$built..HEAD")`, whose `0` arm said `fresh`. That count is a
  ONE-SIDED question — how many commits HEAD carries that the graph's commit cannot reach — and it
  answers `0` for two conditions the card must not collapse. The legitimate one is the only way to
  reach the arm at all: `built` is an ABBREVIATED sha of this very HEAD, so the string equality above
  missed it. The illegitimate one is a graph built at a commit HEAD cannot reach FORWARD to — a
  descendant of HEAD, the shape the sweep produces routinely (`_gs_trees` sweeps
  `$PROJECTS_ROOT/*/`, so it builds at a feature-branch tip and the session then `git checkout main`).
  That graph describes a tree the session is not on, and it was announced as `fresh`. The severity is
  not the label: `ccd/worker-skill/SKILL.md` clause 12, pinned verbatim at
  `server/test/worker-skill.test.ts:61`, says *only `fresh` licenses taking it as read* — so the false
  word is exactly the token that switches a dispatched worker's verification duty OFF over a graph of
  a tree it is not reading. This is the collapse the block's own D-1336 comment names two lines below
  ("no overloaded null at a seam"), landing on the state that comment was written to protect.
  A second, more reachable case rode the same one-sidedness: on a DIVERGED branch (`ws/<slug>` cut
  from a main the sweep later built at) the count is not "behind" at all, and the card said
  `1 commit behind HEAD` for a graph that also carried a commit the tree has never had.
  **Shipped:** ancestry is asked on BOTH sides — `git rev-list --left-right --count "$built...HEAD"`,
  three dots — and the pair is matched WHOLE (`^([0-9]+)[[:space:]]+([0-9]+)$`) so a half-read number
  can never stand in for both. Any left-hand count at all means the graph carries commits this tree
  does not, and the card says `not an ancestor of HEAD`. Descendant and divergence share that ONE word
  deliberately: a reading session does the same thing in both (the graph is not of this tree, so every
  answer is a lead), and the rule forbids collapsing conditions a caller handles DIFFERENTLY, not
  naming one condition once. `0 0` keeps `fresh`, which is what preserves the abbreviated-sha arm.
  The new word is a fifth `fresh="…"` assignment, so D-1340/D-1341/D-1342's harvests demanded it in
  both consumers or went red: clause 12 (and `CONTRACT[11]`, byte-identically) and the
  `wave-lifecycle.md` graph-card paragraph now carry it with the rule attached — the harvest working
  exactly as designed, not scope creep.

  Measured, on top of `6ae35e56` (baseline `Test Files  3 passed (3)` / `Tests  130 passed (130)`
  across `session-hook`, `worker-skill`, `coordinator-skill`; pristine-copy revert per D-1339, all
  five `md5sum -c` clean afterwards):

  | mutation | red |
  | --- | --- |
  | the hook's measurement back to the one-sided `rev-list --count "$built..HEAD"` (left side forced to `0`, the pre-fix behaviour exactly) | `session-hook` — `Tests  2 failed \| 49 passed (51)`: "refuses to call a graph built at a DESCENDANT of HEAD fresh" and "…on a DIVERGED branch merely behind HEAD". The abbreviated-sha control stayed GREEN, so the two reds are the defect and not the rewrite |
  | `fresh="not an ancestor of HEAD"` → `fresh="fresh"` (the collapse itself, restored) | `session-hook` — `Tests  2 failed \| 128 passed (130)`, same two tests |
  | `fresh="not an ancestor of HEAD"` → `fresh="built off this HEAD"` in the hook | BOTH doc suites — `Test Files  2 failed (2)` / `Tests  2 failed \| 77 passed (79)`: `expected … to match /\bbuilt off this HEAD\b/` in clause 12 and in the paragraph |
  | drop the new phrase from clause 12 **and** its `CONTRACT` literal | `worker-skill` — `Tests  1 failed \| 13 passed (14)`, "clause 12 branches on no card word matching `not an ancestor of HEAD`" |
  | drop the new phrase from `wave-lifecycle.md`'s paragraph | `coordinator-skill` — `Tests  1 failed \| 64 passed (65)`, "the graph-card paragraph never names the `not an ancestor of HEAD` state the hook prints" |

  **Stale anchor, corrected here rather than silently:** this plan's Task 2 mutation table (`:1058`,
  `:1062`) names the `''|*[!0-9]*` `case` arm as the site of `fresh="freshness unmeasured"`. That
  `case` block is gone — the arm is now the `else` of the pair match — and the two mutations it
  describes are still available, one branch over.


- **D-1354** (2026-09-02, whole-branch review) — **a `Measured:` sentence outlived the code it
  measured: the fixture comment that justifies `healthy()`'s `realpath` link went on describing the
  arm D-1350 deleted.** R3 (`464c2a65`) added `linkReal(home, 'realpath')` to
  `server/test/ccrc-doctor.test.ts`'s `healthy()` and wrote the reason above it: `_check_graphify-path`
  "resolves both sides with `realpath` and falls back to the UNRESOLVED path when it is unavailable",
  so without the link the check "FAILs on a box whose whole contract is that nothing fails —
  *Measured:* … `FAIL graphify-path` and rc=1, which reds `runDoctor(healthy(...)).code === 0`, the
  `fail === 0` assertion and the `"… 1 warned, 1 failed"` summary pin". One commit later `119dec11`
  (D-1350) removed exactly that fallback — `resolved=""` / `want=""` and a `_dr_skip` — and touched
  neither this file nor its paragraph (`git show --name-only 119dec11` lists `ccd/ccrc`,
  `ccd/ccrc-doctor-checks` and three other suites). So the branch shipped its own refutation: the arm's
  header says verbatim "WHAT THIS ARM MUST NOT DO is fall back to the UNRESOLVED paths when it cannot
  answer (D-1350)", `ccrc-doctor-graphify.test.ts` pins `/^SKIP graphify-path:/` for that condition,
  and the biggest doctor suite's fixture still taught the guessing arm as current. No shipped
  behaviour is wrong here; what is wrong is the recorded history, which this repo's own rule says to
  read as authoritative — and it is the WHOLE recorded justification for a line that is still needed,
  so the next reader either trusts a defect or deletes a load-bearing link.
  **Shipped:** the paragraph now states the mechanism that actually holds — an unreachable `realpath`
  is a SKIP, so the missing link is a COUNTING defect (`HEALTHY_SKIPS`, and every summary pin that
  reads it), never a failing one — with the re-measurement below quoted in it. And because a comment
  cannot be enforced by being careful, `ccrc-doctor-graphify.test.ts` gained a test that binds its two
  ends: the shipped arm must emit the SKIP and carry no unresolved-path fallback, and the sibling
  fixture's paragraph (read between its opening claim and the `linkReal` line it justifies) must not
  say `falls back to the UNRESOLVED` / `rc=1` / `FAIL graphify-path`, and must name both `SKIP` and
  `HEALTHY_SKIPS`.

  Re-measured 2026-09-02 on top of `e1b0d782`, since the old sentence's numbers were the thing in
  doubt (baselines: `ccrc-doctor` `Tests  314 passed | 3 skipped (317)`; `ccrc-doctor-graphify`
  `Tests  25 passed (25)` with the new test, 24 before it):

  | mutation | red |
  | --- | --- |
  | delete `linkReal(home, 'realpath');` from `healthy()` (the line the paragraph justifies) | `ccrc-doctor` — `Tests  7 failed \| 307 passed \| 3 skipped (317)`, doctor printing `SKIP graphify-path: this box has no usable realpath …`. All seven are skip/verdict COUNTS: three `(N skipped)` summary pins (tmux_skew, config fleet-role, fleet local), both `expect(skipped).toBe(HEALTHY_SKIPS)`, the `1 warned, 1 failed` pin (red on `(0 skipped)`, its verdict half unchanged) and `expect(verdicts).toBe(total - HEALTHY_SKIPS)` (27 vs 28). **rc stayed 0 and `fail === 0` never red** — the three consequences R3's sentence claimed to have measured are all false |
  | restore R3's stale paragraph verbatim (`git checkout --` the fixture) | `ccrc-doctor-graphify` — `Tests  1 failed \| 24 passed (25)`, the D-1354 test on "it still describes the pre-D-1350 arm, which guessed from the unresolved paths" |
  | re-add the fallback to the shipped arm (`[ -n "$resolved" ] \|\| resolved="$found"`, `[ -n "$want" ] \|\| want="$engine"`) | `ccrc-doctor-graphify` — `Tests  2 failed \| 23 passed (25)`: the new D-1354 test **and** D-1350's own `SKIPs — never FAILs …` case, i.e. the binding reds from either end |

- **D-1355** (2026-09-02, whole-branch review) — **the one README guard the branch left standing
  passed by SUBSTRING, so the canonical overview documented none of the read side and nothing said
  so.** Spec §4's last mutation row is "README describes the read side as a `CLAUDE.md` block →
  derived README guard", and README.md was in exactly that mutated state while
  `it('the README documents the READ side, not only the write side')` stayed green. Its two
  assertions were `toMatch(/graphify query/)` and `toMatch(/_inst_graph_always_on/)`; after Task 4
  the README's ONLY occurrence of the second is inside `_inst_graph_always_on_off` — the name of the
  step that REMOVES the block — so the assertion matched as a prefix of its own refutation, and both
  assertions were satisfiable by a README describing nothing but the retired writer (reproduced
  against a synthetic README that said ccrc "converges graphify's packaged `always_on/claude-md.md`
  into every rostered home's `CLAUDE.md`": green). MEASURED on the shipped file: `grep -c
  'graphify-path' README.md` → 0, no `graphQueries`, no `graphReadCount`, no `clause 12` — four of
  the five mechanisms this branch shipped were absent from the file `CLAUDE.md` designates the
  canonical system overview, as was the R5 decline the spec asks to be "Recorded so it is not
  re-derived". Worse than an omission: `8589a0c4`, already on this branch, ended the read-side
  paragraph with "What replaced it — starting with the `SessionStart` card … — is below" while
  nothing below described any replacement (the next paragraph is "**The sweep.**"), so the branch
  shipped a dangling forward reference into the overview and the guard could not see it.
  **Shipped:** Task 6 Steps 1, 3 and 4 — the read-side subsection, the enumeration clause, and the
  guard replaced by two: a token census matched with `toContain` (whole tokens, never prefixes) plus
  the derived present-tense pattern pair that forbids re-describing the read side as something ccrc
  writes into a `CLAUDE.md` while still permitting the history sentence that says D-1243 did.

  **Two of the plan's five tokens do not bind what they name, MEASURED, and the fix is two more
  tokens.** `SessionStart` appears twice in the README outside this section (the D-1245 history
  sentence and the presence hook) and `graphQueries` appears in the R5 decline paragraph
  legitimately, so deleting the card bullet or the counter bullet outright left the loop GREEN
  (measured, both). The census now also carries `additionalContext` (the one field the card emits,
  named nowhere else in the file) and `graphReadCount` (D-1251's single tolerant reader, likewise
  unique) — one token per mechanism that only that mechanism's own text can satisfy. The plan's own
  Task 6 Step 2 is wrong for the same reason and is corrected here rather than in place: its
  "Expected: FAIL — the README mentions none of `SessionStart` …" was already false when written.

  | mutation | red |
  | --- | --- |
  | delete the R4 counter bullet from the README | `Tests  1 failed \| 3 passed \| 36 skipped (40)` — "the README never mentions graphReadCount". With the plan's five tokens only, this mutation was **green** (`graphQueries` survives in the R5 paragraph) — which is why the sixth token exists |
  | delete the R1 card bullet from the README | `Tests  1 failed \| 3 passed \| 36 skipped (40)` — "the README never mentions additionalContext". Green under `SessionStart` alone, same reason |
  | spell `_inst_graph_always_on_off` as `_inst_graph_always_on` throughout the README (the retired WRITER named where the remover belongs) | `Tests  1 failed \| 3 passed \| 36 skipped (40)` — "the README never mentions `_inst_graph_always_on_off`". This is the substring hole itself: the ancestor assertion was green on this exact text |
  | delete the R5 decline paragraph | `Tests  1 failed \| 3 passed \| 36 skipped (40)` — "the README does not record the DECLINED PreToolUse speed bump" |
  | re-insert "`_inst_graph_always_on` converges graphify's own packaged block into every rostered home's `CLAUDE.md`" | `Tests  1 failed \| 3 passed \| 36 skipped (40)` — "the README describes ccrc writing a read rule into a CLAUDE.md again" (FIRST pattern) |
  | re-insert "`_inst_graph_always_on` installs graphify's packaged `always_on/claude-md.md` in each rostered home" | `Tests  1 failed \| 3 passed \| 36 skipped (40)` — "the README says ccrc installs graphify's packaged block again" (SECOND pattern; one row per pattern, or one of the two stays unmeasured) |
  | rewrite the history sentence in the earlier draft's words ("D-1243's answer was converging graphify's packaged `always_on/claude-md.md` into every rostered home's config-dir file") | **GREEN, and must be** — `Tests  4 passed \| 36 skipped (40)`. The guard forbids the present-tense claim, never the past-tense record; a guard that forbids the truth is one nobody keeps |

- **D-1356** (2026-09-02, whole-branch review) — **Task 6's draft README text describes a card, a
  check and a chip the branch had already moved past, and Task 5 left a sentence in the same section
  saying doctor still measures what it no longer measures.** The plan's Step 4 was written before
  Tasks 1–5 shipped and before six deviations landed on top of them, so transcribing it verbatim
  would have put five stale claims into the canonical overview: the card's freshness vocabulary is
  not "fresh or *N* commits behind" but the four words D-1353 and D-1336 shipped (`fresh`, `N commits
  behind HEAD`, `not an ancestor of HEAD`, `freshness unmeasured` — ancestry, not distance, and the
  unmeasured case said out loud rather than left silent); the node count comes off `GRAPH_REPORT.md`,
  not the census or `manifest.json`, neither of which carries one (D-1246); the no-graph arm's
  census row is clipped to 400 characters because it is repo-controlled text (D-1335); the PATH
  converge judges a shim BY CONTENT through a link too and backs it up before an atomic rename
  (D-1349, D-1351), and its refusals and the doctor check agree that an unresolvable pair is
  *unmeasured* — the doctor **SKIPs** there, which the draft's flat "FAILs when `command -v graphify`
  resolves anywhere but the pinned venv" would have contradicted (D-1348, D-1350, D-1352); and both
  chips read the field through `graphReadCount`, not raw (D-1251). Separately, the section's doctor
  paragraph still listed "PATH shadows" among what `_check_graphify` reads — Task 5 MOVED that
  question out to `graphify-path` (the function's own header now says so at item 3) and no plan step
  touched the README, so the overview described a bucket that no longer exists. All six corrected
  against the shipped tree; the tree governs, and this entry is the record that the plan's Step 4
  text is a snapshot rather than the specification of what the README should say.

  One file outside the plan's list moves with it, and a guard is why: `oss-metadata.test.ts`'s
  "CLAUDE.md's README size claim is still true" holds `CLAUDE.md`'s `~N lines` within 10% of the real
  file, and the read-side subsection took README.md from 2102 to 2165 lines — 1931 was 8.1% off before
  and 10.8% after, MEASURED as `Tests  1 failed | 21 passed (22)` (`expected 0.108… to be less than
  0.1`). The claim is now `~2165 lines`. Noted rather than silently fixed because it is the same class
  this whole entry is about: a number in prose that only a mechanism keeps honest.

- **D-1357** (2026-09-02, whole-branch review) — **the one sentence carrying the evidence for
  retiring D-1243 stated a week-shaped window over a one-day row's numbers.** The design spec's §0
  table reports the query log over TWO windows — `| last 7 days | 265 | 11 | 0 |` and
  `| since D-1243 deployed (2026-09-01) | 109 | 4 | 0 |`, measured 2026-09-02 — and the README, this
  plan's Step 4 draft text, and the permanent D-1245 ledger entry above all said "Measured over the
  **week** it was deployed: 109 … across 4 corpora": the week row's window word with the since-deploy
  row's figures. The block shipped 2026-09-01 (`git log -S'_inst_graph_always_on' -- ccd/ccrc` →
  `551a6cb6`, 2026-09-02 01:37), so 109/4 spans one day, and no calendar-week reading rescues it —
  the seven-day span is the OTHER row. The conclusion is untouched (ccrc-pwa measures **zero** in
  both rows, and 103/109 in MekWarLive is the load-bearing fact), which is exactly why it survived
  three copies: nothing about it was wrong except the thing this repo says a measurement may never
  get wrong. All three now read "the one day since it was deployed (2026-09-01, measured 2026-09-02)"
  and the README additionally names the week row so the two are not confusable again.

  The guard is DERIVED, not a spelling test (`ccrc-install-graphify.test.ts`, "README: the
  retirement's evidence sentence names the window its numbers came from"): it parses the spec's §0
  table, looks the README's quoted figures up IN it, and holds the sentence to the row it actually
  quotes — week-shaped window word iff week-shaped row, plus the row's anchor date if it has one.
  Re-measure over a different window and it stays green; cross the rows either way and it reddens.

  | mutation | measured |
  | --- | --- |
  | restore "Measured over the week it was deployed: 109 … across 4 corpora" in README.md | `Tests  1 failed \| 1 passed \| 40 skipped (42)` — `expected true to be false` at the WEEKISH equality |
  | keep the one-day window but drop its anchor date ("the one day since it was deployed") | `Tests  1 failed \| 1 passed \| 40 skipped (42)` — `Received: "the one day since it was deployed"`, does not contain `2026-09-01` |
  | keep the dated one-day window, swap in the week row's figures (265 across 11 corpora) | `Tests  1 failed \| 1 passed \| 40 skipped (42)` — same WEEKISH equality, reddening in the OTHER direction |
  | unmutated | `Tests  42 passed (42)` (whole file) |


- **D-1358** (2026-09-02, whole-branch review) — **the remover's backup was never read back, so an
  EMPTY backup kept the whole suite green.** R0 deletes lines out of the operator's own `CLAUDE.md` —
  the file this plan's own R0 header calls "the OPERATOR's, not ccrc's" — and
  `cp -a "$f" "$backups/$(echo "$f" | tr / _)"` (`ccd/ccrc`, `_inst_graph_always_on_off`) is the ONLY
  copy of it that exists before the delete. It is also the only copy anywhere: `ccrc update`'s
  pre-install backup covers dists, `ccd`, `session-hook.sh`, `notify.sh`, units and a `coord.db`
  snapshot, never a wrapper HOME's `CLAUDE.md`. Nothing on the branch read that copy back. The
  idempotence row asserted `readdirSync(...).some(b => b.endsWith('_CLAUDE.md'))` — a predicate over
  FILENAMES — and the row beside it ('REFUSES to rewrite a file it could not back up') plants
  `~/ccrc-backups` as a regular file so `mkdir -p` fails, which binds the NEGATIVE arm only: it proves
  the refusal fires, not that the copy holds anything. MEASURED: one line, same name, same success
  status, the whole `if !` refusal chain intact —
  `cp -a "$f" "$backups/…"` → `: > "$backups/…"`, `bash -n` clean — and the file's rows stayed green
  while the operator's `CLAUDE.md` was still rewritten and its only surviving copy was zero bytes.
  This is the repo's own "tests pin shape, not effect" in its purest form, and the suite already used
  the stronger idiom two describes down (the `.local/bin` shim rows compare `readFileSync(...)` to
  `SHIM`), which made R0's name-only check the outlier.
  **`_inst_graph_hooks_off` had the identical gap** — `cp -a "$h" … && rm -f "$h"` under a
  `.some(f => f.endsWith('_post-commit'))` name predicate — and is fixed in the same commit, because
  R0 is explicitly built as that function's idiom and a fix to one of two identical sites teaches the
  next reader the wrong lesson.

  Severity is a GUARD LEFT UNBOUND on a data-loss path, not live loss: the shipped `cp -a` is correct
  today and the delete is bounded by the whole-line one-ordered-pair census, so no operator loses
  bytes now. The backup is the net for a splice bug — the class D-1244 found six of — and that net was
  what nothing held. **Shipped:** both rows now locate EXACTLY ONE backup copy (`flatMap` +
  `toBe(1)`, not `some` — two copies under one run would mean the remover visited one physical path
  twice, which the symlink arm makes reachable) and compare its bytes to the pre-removal file.

  | mutation | measured |
  | --- | --- |
  | `ccd/ccrc` `_inst_graph_always_on_off`: `cp -a "$f" "$backups/…"` → `: > "$backups/…"` | `Tests  1 failed \| 41 passed (42)` — `the backup does not hold the pre-removal bytes`, `expected '' to be '# head\n\n<!-- ccrc:graphify-always-o…'` |
  | `ccd/ccrc` `_inst_graph_hooks_off`: `cp -a "$h" "$backups/…"` → `: > "$backups/…"` | `Tests  1 failed \| 41 passed (42)` — `the backup does not hold the removed hook's bytes`, `expected '' to be '#!/bin/sh\n# graphify-hook-start…'` |
  | unmutated | `Tests  42 passed (42)` (whole file) |


- **D-1359** (2026-09-02, whole-branch review) — **half of R4's counting rule was deletable with the
  suite green: the trailing word boundary that keeps the read counter from over-counting.**
  `GRAPH_QUERY_RE` (`ccd/session-hook.sh:194`) carries two boundary classes and its comment gives each
  a separate job — the leading one stops `mygraphify query` and prose, the trailing one stops
  `graphify querying-something-else`. The leading half was bound ("does NOT count a command that
  merely contains the word"); the trailing half was bound by nothing. Both of that test's fixtures are
  stopped by the LEADING class, and all four fixtures in "does NOT count graphify update, a build, or
  a bare graphify" die on the VERB alternation, so no fixture anywhere planted a
  `graphify query…`-prefixed word and the clause could be deleted with `Tests  48 passed (48)`
  unchanged (measured on the branch before this fix).

  Behaviour today is correct — nothing miscounts on a live box — so this is an unpinned guard, not a
  wrong number. It is worth a ledger entry anyway because of WHICH number it guards: R4 exists so the
  sentence the whole R0 removal rests on ("the account-wide block measured zero effect") stays
  honest, and over-counting is the one failure direction that would manufacture adoption out of
  commands that are not reads at all. Fix is test-only — no behaviour change, `ccd/session-hook.sh`
  untouched — a fifth negative case, "does NOT count a verb that is merely the prefix of a longer
  word", spelling out all three verbs so a boundary that holds for `query` and not for `explain` is
  still caught.

  | mutation | measured |
  | --- | --- |
  | `ccd/session-hook.sh:194`: delete the trailing `([[:space:]]\|$)` from `GRAPH_QUERY_RE` (`bash -n` clean) | `Tests  1 failed \| 51 passed (52)` — `expected 4 to be +0`, i.e. all four prefix-extended words counted |
  | unmutated | `Tests  52 passed (52)` (whole file) |


- **D-1360** (2026-09-02, whole-branch review) — **the row titled "leaves no `CLAUDE.md.tmp.<pid>`
  behind, on the write path or the refusal path" never exercised the refusal path, so BOTH
  `rm -f "$tmp"` lines were deletable with the suite green.** The fixture seeded a well-formed block
  and ran one successful install, and on THAT path the temp file is consumed by
  `mv -f "$tmp" "$f"` (`ccd/ccrc`, `_inst_graph_always_on_off`) — never by either cleanup line. Every
  other refusal fixture in that describe (the marker census, the two/half-marker rows, the chained
  file, the unresolvable symlink, the failed backup) takes its `continue` BEFORE
  `tmp="$f.tmp.$$"` is ever assigned, so nothing in the branch could leak a tmp, let alone clean one.
  The title asserted a guard the file did not hold — the same "tests pin shape, not effect" shape
  D-1358 records one entry up, and the deviation from this plan is that the plan prescribes that row
  verbatim (`docs/…-graphify-read-side-ccrc-level.md:1385`) with the two-path title.

  Behaviour today is correct — nothing leaks on a live box — so this is an unpinned guard, not a
  live defect, and the cost of it being unpinned is a stray temp file beside the operator's own
  `CLAUDE.md`, not lost bytes (the file is untouched on both refusal arms and a backup was already
  cut). **Fix is test-only; `ccd/ccrc` is untouched.** The old row is retitled to name the WRITE path
  it actually walks, and a second row drives the splice arm: a `sed` shim planted through
  `runInstall`'s existing `opts.stubs` door refuses the ONE two-address read
  (`sed -n "1,Np" <CLAUDE.md>`) that runs inside `> "$tmp"` and delegates every other call to the
  real `sed`. `> "$tmp"` is opened before the group runs, so the temp file exists when the splice
  fails — which is the honest, reachable shape of this arm (the home filesystem filling between the
  redirection and the last byte of the block's tail), and `ccd/ccrc` has exactly one two-address
  `sed` in the whole file, so the shim changes no other step.

  **The `chmod`/`mv` arm's `rm -f` (`ccd/ccrc:5422`) stays unbound, deliberately.** `$tmp` sits in the
  directory the process just created it in, so chmod-on-our-own-file and a same-directory rename do
  not fail without something exotic (an immutable directory), and a fixture for it would be a
  contrivance that teaches the next reader the wrong lesson. Recorded here so it is not re-derived.

  | mutation | measured |
  | --- | --- |
  | `ccd/ccrc`: delete BOTH `      rm -f "$tmp"` lines in `_inst_graph_always_on_off` (`:5417`, `:5422`; `bash -n` clean) | `Tests  1 failed \| 42 passed (43)` — `a half-written temp file was left in the operator's config directory: expected [ 'CLAUDE.md.tmp.2549620' ] to deeply equal []` |
  | `ccd/ccrc`: delete the splice arm's line ALONE (`:5417`; `bash -n` clean) | `Tests  1 failed \| 42 passed (43)` — same assertion, so the new row binds THAT line and not the other |
  | unmutated | `Tests  43 passed (43)` (whole file) |


- **D-1361** (2026-09-02, whole-branch review) — **the card's decoy defence answered the right sha
  through TWO mechanisms for one decision, and so one of them was deletable with the suite green.**
  The `built` read (`ccd/session-hook.sh`) is `tail -c 4096 … | grep -oE … | tail -n1`, and the line
  under it was `built="${built##*:}"`. The whole-branch review's counter-evidence finding credited
  the card with a "combined decoy defence"; measured, the combination was the problem. `plantGraph`'s
  9000-byte pad puts the head decoy OUTSIDE the byte window, so "reads built_at_commit from the TAIL"
  binds `tail -c 4096` (swap it for `head -c` and 8 of the file's tests go red) and can say nothing
  about `| tail -n1`: one match reaches the pipe either way. And a fixture small enough to put both
  matches inside the window still could not bind it, because `##*:` strips through the LAST colon of
  a two-line grep result and therefore re-implemented last-wins by itself — `| tail -n1` deleted,
  `bash -n` clean, `Tests  53 passed (53)`.

  Behaviour today is correct — every live read has one match in the window — so this is a redundant
  mechanism, not a wrong sha, and the reason it is worth a change rather than a note is which word it
  guards: the sha the card names is what `fresh` is computed from, and `fresh` is the word clause 12
  of the worker skill says licenses taking a query answer as read (D-1353's entry above). **The
  deviation from the plan is a shipped line**: Task 2 prescribes `built="${built##*:}"` verbatim
  (`docs/…-graphify-read-side-ccrc-level.md:980`) and the tree now spells it `built="${built#*:}"`.
  The key being stripped carries no colon, so on the single match `| tail -n1` always yields, the two
  spellings are byte-identical; what changes is that a two-match read no longer resolves to a sha at
  all, which is what makes the pipeline clause a mechanism a test can redden. The new case, "takes the LAST
  built_at_commit when the decoy is INSIDE the byte window", plants a `pad: 0` graph.json and asserts
  its own premise (`size < 4096`) so a pad that grows back stops the test rather than silently
  stopping the measurement.

  | mutation | measured |
  | --- | --- |
  | `ccd/session-hook.sh`: delete `\| tail -n1` from the `built` read, with `##*:` still in place (`bash -n` clean) | `Tests  53 passed (53)` — the gap this entry records |
  | `ccd/session-hook.sh`: the same deletion, with `#*:` shipped (`bash -n` clean) | `Tests  1 failed \| 52 passed (53)` — `the card named no sha at all …: expected 'graphify: this tree has a knowledge g…' to contain 'ebc1d529'` |
  | `ccd/session-hook.sh`: `tail -c 4096` -> `head -c 4096` in the `built` read (`bash -n` clean) | `Tests  8 failed \| 45 passed (53)`, the byte bound's own row among them — `the head decoy was read instead of the real last key` — so the pair now has one row each |
  | unmutated | `Tests  53 passed (53)` (whole file) |

- **D-1362** (2026-09-02, whole-branch review) — **D-1357 fixed the sentence and bound the file, and
  the copy that mattered most was in neither.** The evidence for retiring D-1243 lives in three
  places: `README.md`, this plan's Task 4 draft, and — the one this repo's own conventions call
  authoritative history — `_inst_graph_always_on_off`'s header comment in `ccd/ccrc`. D-1357
  enumerated the README and the ledger entry; the shipped comment still read *"graphify's own query
  log over the **week** after D-1243 deployed showed 109 query/path/explain calls across 4 corpora"*,
  the exact week-word/one-day-figures pairing D-1357 names as the defect, and it cost nothing:
  D-1357's guard is `readFileSync(path.resolve(REPO, 'README.md'))` and both its `it()`s parse that
  one file, MEASURED on the shipped unmutated tree as `Tests  43 passed (43)`. A guard whose corpus
  is one copy of a duplicated sentence is a guard for the copy, not for the claim.

  The same comment's closing census had the second half of it: *"the read side now lives in
  `ccd/session-hook.sh`'s SessionStart card, worker clause 12, and `_inst_graphify_engine`'s PATH
  converge"* — THREE artifacts where spec §1 and the permanent D-1245 entry above both name FOUR. The
  missing one is R4, the `graphQueries` counter, which is the mechanism that makes adoption
  *measurable*: the census dropped precisely the item that answers "did any of this work?". A short
  census reads as complete, which is how it survived a whole-branch review.

  Fixed in the shipped comment and in the Task 4 step text that prescribes it (both now state *"the
  one day since it was deployed (2026-09-01, measured 2026-09-02)"* and name the week row explicitly
  so the two rows cannot be confused again, and both list all four artifacts, R-tagged). The
  identical three-item parenthetical in `server/test/ccrc-install.test.ts`'s sequence-pin comment —
  and its copy in this plan's Task 4 — got the counter too.

  The guard is now DERIVED IN BOTH DIMENSIONS (`ccrc-install-graphify.test.ts`, "the retirement's
  evidence sentence names the window its numbers came from (D-1357, D-1362)"). Its corpus is a
  `CORPORA` list — `README.md` and `ccd/ccrc`, comment leaders stripped before the whitespace
  collapse — and each file gets the same spec-row lookup: parse §0's table, look that file's quoted
  figures up IN it, hold its window phrase to the row it actually quotes (week-shaped word iff
  week-shaped row, plus the row's anchor date), and require the count of windowed statements to equal
  the count of bare ones, so a copy that states the figures and names no window reddens too. A third
  file is one row. The census check derives its R-numbers from the README's own replacement bullets
  rather than a hard-coded list, so adding an R5 mechanism to the README and not to the shipped
  comment reddens it.

  | mutation | measured |
  | --- | --- |
  | `ccd/ccrc`: restore "over the week after D-1243 deployed showed 109 … across 4 corpora" (`bash -n` clean) | `Tests  1 failed \| 1 passed \| 43 skipped (45)` — `ccd/ccrc states the window as "the week after D-1243 deployed" but quotes the "since D-1243 deployed (2026-09-01)" row's figures … expected true to be false` |
  | `ccd/ccrc`: drop the `graphQueries` counter (R4) from the census, leaving the three-item list (`bash -n` clean) | `Tests  1 failed \| 44 skipped (45)` — census names `R[1,2,3]`, README's bullets are `R[1,2,3,4]`; `- "4"` in the diff |
  | `README.md`: restore "Measured over the week it was deployed: 109 …" (D-1357's own row, re-measured against the new corpus loop) | `Tests  1 failed \| 1 passed \| 43 skipped (45)` — same assertion, `README.md` row |
  | unmutated | `Tests  45 passed (45)` (whole file) |


- **D-1363** (2026-09-03, completeness pass) — **the harvest idiom reached both skill docs and not the
  canonical overview.** D-1340 and D-1342 established this branch's binding rule for R1's freshness
  vocabulary: a doc that quotes the card's words is HARVESTED against `ccd/session-hook.sh`'s own
  `fresh="…"` assignments, word-boundary matched (never `toContain` — `fresh` is a substring of
  `freshness unmeasured`), so a word the hook stops printing reddens the doc that branches on it. It
  was applied in exactly two places: `coordinator-skill.test.ts` against `wave-lifecycle.md`'s
  graph-card paragraph, and `worker-skill.test.ts` against clause 12. Neither reads `README.md` —
  which `CLAUDE.md` designates *the canonical system overview*, and whose R1 bullet quotes all four
  states. The one README-side guard that touches this section is a TOKEN census
  (`_inst_graph_always_on_off`, `SessionStart`, `additionalContext`, `clause 12`, `graphify-path`,
  `graphQueries`, `graphReadCount`) and says nothing about card words.

  MEASURED as the gap, before the fix: replacing the README's `not an ancestor of HEAD` with `built
  off a commit HEAD cannot reach` and `freshness unmeasured` with `freshness unknowable` — two cards
  the hook never prints — and running `ccrc-install-graphify`, `coordinator-skill`, `worker-skill`,
  `oss-metadata` and `session-hook` gave `Test Files  5 passed (5)` / `Tests  197 passed (197)`. So
  the canonical overview could describe a card that does not exist, in the one direction this branch
  had already closed twice for the two skill docs.

  Closed in `server/test/ccrc-install-graphify.test.ts` (which already reads `README.md`), as the
  third instance of the same harvest — copied deliberately rather than extracted, for the reason the
  new block's own comment states: the two skill suites pin their own docs and neither exports it, and
  a shared helper would put the vocabulary one indirection away from the file that WRITES it. The
  corpus is the **R1 bullet alone**, sliced from `**The graph card (R1).**` to the next `- **` list
  item, whitespace-collapsed (the bullet wraps `freshness\n  unmeasured` across two lines, and
  `behind HEAD` occurs elsewhere in a 1900-line README — a whole-file match would go green on a
  bullet that had lost the words entirely).

  A second `it()` binds the RULE and not only the nouns, because the four words can all be present in
  a bullet that describes freshness as a distance: the hook decides the `$ahead` arm BEFORE the
  `$behind` arms, so a graph at zero distance on an unreachable commit is `not an ancestor of HEAD`
  and not `fresh` (D-1353). That arm order is derived from the `if/elif` chain's own sequence rather
  than from the spelling of `-gt 0`, so an editor who writes `-ge 1` does not get a red suite for a
  rule they did not change.

  | mutation | measured |
  | --- | --- |
  | `ccd/session-hook.sh`: `fresh="not an ancestor of HEAD"` -> `fresh="built on a commit HEAD cannot reach"` (`bash -n` clean) | `Tests  1 failed \| 46 passed (47)` — *the canonical overview's graph-card bullet never names the `built on a commit HEAD cannot reach` state the hook prints*. Across the three harvest suites: `Test Files  3 failed (3)` / `Tests  3 failed \| 123 passed (126)` — one row each, where the README had none |
  | `README.md`: `freshness unmeasured` -> `freshness unknowable` in the R1 bullet (the gap's own mutation) | `Tests  1 failed \| 46 passed (47)` — *never names the `freshness unmeasured` state the hook prints*; previously `197 passed (197)` |
  | `README.md`: `Freshness is **ancestry, not distance**` -> `Freshness is **a distance from HEAD**` | `Tests  1 failed \| 46 passed (47)` — *the R1 bullet quotes the card words but not the ancestry rule that picks them* |
  | `ccd/session-hook.sh`: decide `[ "$behind" -eq 0 ]` before `[ "$ahead" -gt 0 ]` (`bash -n` clean) | `Tests  1 failed \| 46 passed (47)` — *decides `behind` before `ahead`, so a graph at zero distance on an unreachable commit now reads `fresh` — D-1353 was reversed: expected 'behind' to be 'ahead'* |
  | unmutated | `Tests  47 passed (47)` (whole file) |


- **D-1364** (2026-09-03, completeness pass) — **the one read-side artifact whose text ccrc neither
  owned nor pinned.** Spec §1's artifact table lists five artifacts the read side is allowed to live
  in, and row 3 is the graphify skill: it "reaches every session — its description **already** says
  *'especially when graphify-out/ exists, where the question should be treated as a graphify query
  first'*". That sentence is the whole of the row's claim, and nothing in the tree measured it.
  `install-graphify-skill.sh:40` is `cp -a "$PKG/skill.md" "$STAGE/SKILL.md"` — the text is the pip
  package's, copied verbatim — `install-graphify-skill.test.ts` said nothing about it (no `description`
  and no `graphify query` in the file), and doctor's `_check_graphify` compares `.graphify_version`
  stamps against `GRAPHIFY_PIN` only, never content (`ccd/ccrc-doctor-checks:2747-2753`). So a
  `GRAPHIFY_PIN` bump whose packaged `skill.md` reworded the clause away would delete a fifth of the
  read side with every suite green — the class of D-1355, a guard passing on a README that documented
  none of the read side.

  **The guard could not go in the suite alone**, which is the deviation worth recording: the suite's
  package is a FIXTURE the test itself writes, so an assertion over the assembled `SKILL.md` would only
  measure the fixture. Only the installer ever sees the REAL package. So the check went into
  `ccd/install-graphify-skill.sh` — extract the frontmatter `description` (folded continuations
  included, the value ending at the next top-level key), and when it lacks either `graphify-out/` or
  `graphify query`, print one WARNING to stderr naming the pin. It **reports, never refuses**: a skill
  whose description drifted is still worth installing, and the point is to make the rewording a
  decision someone records at the pin bump rather than a silent loss. It matches the two load-bearing
  tokens, not the whole sentence, so a harmless rewording stays quiet. The report is not swallowed —
  `_inst_graphify_skill` (`ccd/ccrc:5262`) and deploy.sh's box-side run (`deploy/deploy.sh:744`) both
  invoke it with no redirection, so the line lands in the operator's install output.

  The suite pins BOTH arms. The fixture package's `skill.md` now carries the real 0.9.9 frontmatter
  (read from the installed skill, 2026-09-02) instead of `# graphify skill body`, and its BODY says
  both tokens too — as the real package's does — so a guard that read the whole file instead of the
  description could not go green on a body mention. `execFileSync` became `spawnSync` because the
  report is a stderr line on an exit-0 run. Two drifted descriptions, one per token (one keeps the tree
  and loses the instruction, one keeps the instruction and loses the tree it applies to), so neither
  half of the match can be dropped and the `||` cannot become `&&` without a red row.

  | mutation | measured |
  | --- | --- |
  | `ccd/install-graphify-skill.sh`: delete the report block entirely (`bash -n` clean) | `Tests  2 failed \| 5 passed (7)` — both drift rows: *expected '' to match /graphify query/* |
  | the condition's `\|\|` -> `&&`, i.e. report only when BOTH tokens are gone (`bash -n` clean) | `Tests  2 failed \| 5 passed (7)` |
  | drop the `graphify query` half of the match (`!= *graphify-out/*` alone) | `Tests  1 failed \| 6 passed (7)` — the "keeps the tree, loses the instruction" row |
  | drop the `graphify-out/` half of the match (`!= *"graphify query"*` alone) | `Tests  1 failed \| 6 passed (7)` — the "keeps the instruction, loses the tree it applies to" row |
  | read the whole `SKILL.md` instead of the frontmatter description (`_gfx_desc="$(cat "$STAGE/SKILL.md")"`) | `Tests  2 failed \| 5 passed (7)` — the body's own `graphify query` masked both drifted descriptions |
  | unmutated | `Tests  7 passed (7)` (whole file) |

- **D-1365** (2026-09-03, completeness pass) — **R5's decline is conditional on a number nobody was
  told to take, and nothing in the tree retains it.** §2 R5 declines the `PreToolUse` speed bump on
  three grounds, and the third is a measurement: *"R4 makes adoption measurable. Gate **after** the
  number says the card and the clause did not move it — not before there is a number… Revisit with
  one week of R4 data."* The DECLINE was recorded and pinned (README's R5 paragraph;
  `ccrc-install-graphify.test.ts`'s `/PreToolUse[\s\S]{0,240}?declined/i`). The DATA it defers to had
  no retention mechanism of any kind: `graphQueries` exists in `~/.cc-sessions/<id>.hookstate.json`,
  which the hook rewrites on every event, and on the live `FleetSession` / `~/.ccrc/state-cache.json`
  snapshot — **MEASURED**: the whole of `server/src` names it in exactly two files, `hookstate.ts`
  (the reader) and `fleet.ts:435` (the projection), and nothing writes it to `coord.db`, to a run
  row, to the ledger or to any series. It also resets on every `SessionStart` that is not a `resume`
  (`ccd/session-hook.sh`, D-1248), and dispatch `/clear`s a worker on every wave >= 2 (worker clause
  1), so a dispatched worker's count is per-wave, not per-week. "One week of R4 data" was therefore
  obtainable only by somebody sampling chips before each reset, and no surface scheduled or recorded
  that act — the same shape as the pre-R4 state §0 criticises ("5/5 homes converged was shape; this
  is effect").

  **Shipped: (a), the cheap arm — the criterion now names the act.** Both R5 texts (README's decline
  paragraph and spec §2 R5) say that the figure is a **sample somebody takes, not a series the tree
  keeps**, why (live-state only, reset on every non-`resume` `SessionStart`, per-wave for a
  dispatched worker), what is read (R4's own `graph N` chips across the live fleet, on one dated
  day, a week or more after deploy) and where the reading is recorded (this file's
  `## Deviations found`, the way §0's table recorded the retired block's own effect). The spec also
  names arm (b) — stamping a worker's `graphQueries` into its run row at wave close, which would make
  the week's figure re-derivable — and puts it out of this round's scope; spec §4 gains the mutation
  row. **No reading is taken here:** sampling the live fleet means reading `~/.cc-sessions` and the
  live `~/.ccrc` state, which this branch's work is forbidden to touch. The act is the operator's,
  and it is now written down.

  **The guard is derived three ways, not a spelling test** (`ccrc-install-graphify.test.ts`, new
  describe): the PREMISE is a census of `graphQueries` over all of `server/src`, so the day arm (b)
  ships it reddens first and both texts get re-derived against a series that then exists; the
  DESTINATION is extracted from each text by pattern and checked on disk, `## Deviations found`
  heading and all; the RESET WORD is harvested from the hook's own `!= resume` condition (the D-1363
  idiom). Both texts are SLICED to their R5 sections — each file names `graphQueries` and the plans
  directory elsewhere, so a whole-file assertion would stay green with the criterion deleted, which
  is the hole D-1355 measured twice.

  | mutation | measured |
  | --- | --- |
  | delete the added revisit criterion from README's R5 paragraph | `Tests  2 failed \| 49 passed (51)` — "README.md: the revisit criterion names an act…" plus the harvest case, which the same deletion takes with it |
  | delete the added revisit criterion from spec §2 R5 | `Tests  2 failed \| 49 passed (51)` — "spec §2 R5: the revisit criterion names an act…" plus the harvest case; one row per file, or one of the two texts stays unguarded |
  | `ccd/session-hook.sh`: reset condition `"$src" != resume` -> `!= resumed` (`bash -n` clean) | `Tests  1 failed \| 50 passed (51)` — the harvest case alone: both texts explain the sampling by a source the hook no longer exempts |
  | a third `server/src` file names `graphQueries` (one comment in `coord/routes.ts`) | `Tests  1 failed \| 50 passed (51)` — the premise case: *expected [ 'coord/routes.ts', 'fleet.ts', …(1) ] to deeply equal [ 'fleet.ts', 'hookstate.ts' ]* |
  | unmutated | `Tests  51 passed (51)` (whole file) |


- **D-1366** (2026-09-03, whole-suite pass after the completeness fixes) — **D-1364's guard shipped
  red against the install suites' own fixtures.** The guard warns, correctly, when the packaged
  skill's frontmatter description no longer carries the query-first sentence — and two install
  suites (`ccrc-install.test.ts`, `ccrc-install-graphify.test.ts`) planted `skill.md` as a one-line
  stub with no frontmatter at all, so the warning fired on the FIXTURE, not the package, and
  `ccrc install: a fresh box › finishes clean: exit 0, nothing on stderr` went red deterministically
  (re-run twice in isolation; not a load flake). The fixer had run only its own suite. The shipped
  description now lives in ONE place, `server/test/graphifySkillFixture.ts` (`PKG_DESCRIPTION`,
  `skillMd`), imported by all three install suites — a fixture plants the shipped artifact, never a
  paraphrase of it ([[a-green-test-can-go-stale-untouched]]'s rule, applied to the fixture the
  guard's own author did not look at). The guard's negative case in
  `install-graphify-skill.test.ts` is unchanged and still the one that pins the warning.

- **D-1367** (2026-09-03, live-fleet measurement after the read-side deploy) — **the sweep's discovery
  predicate accepted every SUBDIRECTORY of a work tree and the one shape that matters least: the tree
  itself.** `_gs_trees` globbed one level under `$PROJECTS_ROOT` and TWO under `$WORKTREES_ROOT`, then
  admitted a candidate on `git rev-parse --is-inside-work-tree`. That predicate is true of every
  directory inside a work tree, `.git` included, and false of nothing that sits under one — so a
  worktree living at DEPTH 1 (`~/worktrees/<name>`, its own toplevel, which is what `ccd ws-add`
  leaves for a single-workspace repo) was never discovered at all, while each of its immediate
  subdirectories was discovered as a tree in its own right and BUILT INTO. Measured on the live fleet
  2026-09-03: **8 stray `graphify-out/` directories under one worktree** — `node_modules/graphify-out`
  and `graphify-out/graphify-out` among them — plus two `failed` census rows every pass, for ever.
  **Those 8 directories are the operator's to delete: this fix stops the sweep creating them, and
  deletes nothing** (the sweep's only removal site is the ownership-gated `.graphifyignore` one,
  D-1161, and widening it to `graphify-out/` would be exactly the class of act this file refuses).

  The fix asks the question the sweep actually means. A candidate is a tree **iff the realpath of its
  own `git rev-parse --show-toplevel` is the realpath of itself** — "are you a tree", not "are you
  inside one". `"$WORKTREES_ROOT"/*/` joins the glob so the depth-1 shape is asked at all; the two
  worktree globs now overlap, so candidates are **deduped by realpath**, which also collapses two
  names that reach one tree (a symlink and its target) and would otherwise be built twice in a pass.
  The canonicaliser is a named shim, `_gs_realpath` (`realpath`, then `readlink -f`) — both spellings
  are acceptable on both userlands, and `ccd-graph-sweep` is already outside `macos-platform.test.ts`'s
  owned corpus for the GNU calls it still carries. **Its empty answer is a SKIP, never a value**: the
  predicate is an equality, so an unmeasurable path spent rather than skipped makes every candidate
  compare equal to every other and walks the whole subdirectory class straight back in. The census row
  keeps the path AS GLOBBED rather than the canonical one — `$REG/<id>.workdir` and the hook's `cwd`
  are compared against it verbatim, and canonicalising it would silently unmatch every reader.

  Measured (`server/test/graph-sweep.test.ts`, baseline `Tests  42 passed | 2 skipped (44)`):

  | mutation | measured red |
  | --- | --- |
  | restore the `--is-inside-work-tree` predicate in place of the toplevel equality | `Tests  1 failed \| 40 passed \| 2 skipped (43)` — *a subdirectory of a work tree was censused as a tree of its own: expected [ Array(1) ] to deeply equal []* |
  | drop `"$WORKTREES_ROOT"/*/` from the glob | `Tests  1 failed \| 40 passed \| 2 skipped (43)` — the depth-1 tree is not discovered, nothing else is either, and the pass exits `probed-zero`: *expected 1 to be +0* |
  | drop the realpath dedupe loop | `Tests  1 failed \| 40 passed \| 2 skipped (43)` — *one tree, censused 2 times: …/projects/beta, …/projects/beta-link: expected […(2)] to have a length of 1 but got 2* |
  | drop `_gs_realpath`'s empty skip (`[ -n "$p" ] \|\| return 1`), so two empties compare equal | `Tests  1 failed \| 41 passed \| 2 skipped (44)` — *an unmeasurable canonical path was spent as if it were a measurement: expected [ Array(1) ] to deeply equal []* |

  The last row's fixture puts stub `realpath` and `readlink` on the sweep's `PATH` that print nothing,
  which is the only way to make the shim's failure arm reachable at all; without it the empty-skip
  clause was a guard no test could redden.

- **D-1368** (2026-09-03, live-fleet measurement after the read-side deploy) — **freshness was keyed
  on COMMIT IDENTITY, so a squash merge made a tree permanently stale to the sweep and permanently
  suspect to the card, both about a graph whose content IS HEAD's.** `_gs_stale` said stale when
  `built_at_commit != HEAD`. After a squash merge — or any history rewrite that keeps the tree —
  HEAD's tree is byte-identical to the built commit's, so `graphify update` writes nothing, the stamp
  keeps the old sha, and EVERY pass records `stale-rebuilt` for that tree, for ever. MEASURED on the
  live fleet 2026-09-03: `graph.json` mtime 01:18, census `stale-rebuilt … head` at 16:09, built
  `0281e084` vs HEAD `6a26a9a3`, and `git rev-parse 0281e084^{tree} 6a26a9a3^{tree}` identical.
  Three places shared the root, one spelling of the predicate each:

  1. **The sweep** (`_gs_stale`) rebuilt on every pass, burning the whole per-pass budget on a tree
     that needed nothing.
  2. **The card** (`_hook_graph_card`) reported `not an ancestor of HEAD` for a graph whose content is
     HEAD's. That is the D-1353 direction spent the other way and it costs the same trust: `fresh` is
     the one word clause 12 of the worker skill says licenses taking a query answer as read
     (D-1341/D-1342), so the wrong answer here switches a dispatched worker's verification duty ON
     over a graph that needs none.
  3. **`_gs_busy`'s O3 escape hatch** counted `rev-list --count "$built..HEAD"`, which for a
     NON-ANCESTOR counts everything since the merge-base — so a squashed history could fire the
     `build anyway` escape against a busy session over commits that changed nothing at all.

  The fix, once per file: if `git rev-parse "$built^{tree}"` equals `git rev-parse "HEAD^{tree}"`
  and both are non-empty, the graph is FRESH — the sweep does not rebuild (outcome `fresh`, reason
  empty), the card says `fresh`, and the hatch treats the distance as 0. When the trees DIFFER,
  today's ancestry/distance logic is untouched. **Either side answering empty is not a match**: a
  garbage-collected built commit, or a HEAD whose tree cannot be peeled, falls through to today's
  behaviour (`freshness unmeasured` in the card, stale with reason `head` in the sweep) rather than to
  a freshness nobody measured. `git rev-parse X^{tree}` is git, not GNU userland, so
  `macos-platform.test.ts` is unaffected.

  **The card's new text is a QUALIFIER, not a fifth state.** It reads `fresh` and appends
  `— same content as HEAD` only when the built commit is not HEAD itself (an abbreviated sha naming
  this very HEAD resolves to the tip and keeps the bare word). That is a decision about the contract:
  `fresh` stays the word both skill docs harvest out of this file's freshness assignments
  (D-1340/D-1342), because a reader does exactly the same thing in both cases, and a new STATE would
  have to be named by both docs and by clause 12 for a branch that does not exist.

  **The 8 stray `graphify-out/` directories D-1367 records on the live fleet are the operator's to
  delete.** Neither fix deletes anything: D-1367 stops the sweep creating them, and this one stops it
  rebuilding into the tree it should have left alone.

  **Fixture shape changed with the semantics.** Every "make it stale again" step in
  `graph-sweep.test.ts` was `git commit --allow-empty`, and `session-hook.test.ts`'s `gitTree` built
  its whole distance ladder out of empty commits — all of which leave `HEAD^{tree}` byte-identical to
  the built commit's, i.e. the exact shape this entry makes FRESH. Those fixtures now commit real
  content (`bump()` in the sweep suite, one file per commit in `gitTree`), so the distance and
  ancestry rows still measure the arm they were written for.

  Measured (baselines `graph-sweep` `Tests  47 passed | 2 skipped (49)`, `session-hook`
  `Tests  56 passed (56)`):

  | mutation | measured red |
  | --- | --- |
  | `ccd/ccd-graph-sweep`: `_gs_stale` back to `[ "$built" = "$head" ] \|\| { REASON=head; return 0; }` | `graph-sweep` — `Tests  2 failed \| 44 passed \| 2 skipped (48)`: the empty-commit and the SQUASH rows, both *expected 'stale-rebuilt' to be 'fresh'* |
  | `ccd/ccd-graph-sweep`: the escape hatch back to the bare `rev-list --count "$built..HEAD"` | `graph-sweep` — `Tests  1 failed \| 45 passed \| 2 skipped (48)`: *the one-sided distance count fired the build-anyway escape over 20 commits that changed nothing at all: expected 'stale-rebuilt' to be 'skipped-busy'* |
  | `ccd/ccd-graph-sweep`: `_gs_same_tree` drops its non-empty guards (`[ "$bt" = "$ht" ]` alone) | `graph-sweep` — `Tests  1 failed \| 46 passed \| 2 skipped (49)`: *a tree whose content could not be measured at all was called fresh: expected 'fresh' to be 'stale-rebuilt'* |
  | `ccd/session-hook.sh`: delete the whole `elif _hook_same_tree …` arm | `session-hook` — `Tests  2 failed \| 54 passed (56)`: *…reported as behind HEAD* and *…was called off this tree's history* (`not an ancestor`) |
  | `ccd/session-hook.sh`: append the qualifier unconditionally (drop the `bcommit` test) | `session-hook` — `Tests  1 failed \| 55 passed (56)`: *an abbreviated sha of HEAD stopped reading as fresh: expected … to contain '(fresh)'* |
  | `ccd/session-hook.sh`: `_hook_same_tree` drops its non-empty guards | `session-hook` — `Tests  1 failed \| 55 passed (56)`: *a graph whose content could not be measured at all was announced as fresh: expected … not to match /\bfresh\b/* |

  The last row of each pair needed a fixture that could reach the failure arm at all: a branch ref
  overwritten with a sha no object answers to, where `git rev-parse HEAD` still exits 0 with the raw
  sha while `HEAD^{tree}` cannot be peeled — so BOTH sides of the comparison come back empty. Without
  it, "never compare two empties as equal" was a guard no test could redden.

- **D-1369** (2026-09-03, review of the D-1367/D-1368 diff) — **D-1368 made the sweep spend an
  UNVALIDATED `built_at_commit` as a git REVISION for the first time, and a rev NAME resolves to a
  comparison with itself.** `_gs_same_tree` peels `"$2^{tree}"` against `HEAD^{tree}`. `built_at_commit`
  comes out of a `graph.json` any tree can write, and if it reads `HEAD` — or `@`, or a branch name —
  both sides peel to the SAME tree object, the equality holds trivially, and the tree reads `fresh` for
  ever and is never rebuilt again. This is a NEW failure mode, not a pre-existing one: the old
  `[ "$built" = "$head" ]` compared the value as a STRING, where a rev name is simply unequal and the
  tree rebuilt every pass. It is also invisible — `fresh` is what the census reports — which makes it
  the mirror image of the wedge D-1368 was written to fix. MEASURED against the shipped script with a
  fixture HOME: cold pass `{"outcome":"never-built"}`, then `graph.json` rewritten to
  `{"built_at_commit":"HEAD"}` plus a REAL content commit, second pass `{"outcome":"fresh"}` with
  `engine calls: 1`.

  The asymmetry was explicit in the tree and only on one side of it: the card validates the same field
  one line before it peels it (`ccd/session-hook.sh`: `[[ "$built" =~ ^[0-9a-f]{7,40}$ ]] || built=""`),
  and `grep -n built ccd/ccd-graph-sweep` showed no validation anywhere in the file. **Fix:** the same
  input contract, at the top of `_gs_same_tree` — `[[ "$2" =~ ^[0-9a-f]{7,40}$ ]] || return 1` — so an
  unvalidated repo-controlled string can never resolve to a self-referential comparison. Only the
  rev-NAME class is reachable: `git rev-parse --verify -q "^{tree}"` already exits 1 for the empty and
  the `-`-leading forms.

  **The README carried the same drift, and the D-1363 harvest could not see it.** `README.md`'s R1
  bullet — the canonical system overview, per `CLAUDE.md` — still said freshness was *"ancestry, not
  distance"* and listed only `fresh`, `N commits behind HEAD`, `not an ancestor of HEAD` and
  `freshness unmeasured`, which is precisely the wrong answer for the squash case D-1368 makes read
  `fresh — same content as HEAD`. The guard written for this class stayed green over it twice over:
  its harvest de-dupes `/\bfresh="([^"]+)"/`, so D-1368's fifth assignment `fresh="fresh"` left the
  vocabulary SET identical, and the qualifier is APPENDED (`fresh+=`), which that regex never matches
  — measured `Test Files 8 passed (8), Tests 364 passed | 10 skipped (374)` over the drifted bullet.
  The bullet now states the rule as **content first, then ancestry** and names the qualifier, and the
  harvest in `ccrc-install-graphify.test.ts` collects `fresh+=` sites too (throwing when there are
  none) and derives the content-first claim from the hook's own decision ORDER — the index of the
  `_hook_same_tree` call against the index of the two-sided `rev-list`, so no spelling of either
  predicate is pinned.

  Measured (baseline `graph-sweep` `Tests  50 passed | 2 skipped (52)`, `ccrc-install-graphify`
  `Tests  52 passed (52)`):

  | mutation | measured red |
  | --- | --- |
  | new tests against the un-fixed `ccd/ccd-graph-sweep` (red-first) | `graph-sweep` — `Tests  3 failed \| 47 passed \| 2 skipped (52)`, incl. *a self-referential revision compared equal to itself and a genuinely stale graph was declared fresh: expected 'fresh' to be 'stale-rebuilt'* |
  | `ccd/ccd-graph-sweep`: drop `_gs_same_tree`'s `[[ "$2" =~ ^[0-9a-f]{7,40}$ ]] \|\| return 1` | `graph-sweep` — `Tests  1 failed \| 49 passed \| 2 skipped (52)`: *a built_at_commit that is a rev NAME is not a sha, and never resolves to "fresh"* |
  | `README.md`: the R1 bullet back to its ancestry-only wording | `ccrc-install-graphify` — `Tests  1 failed \| 51 passed (52)`: *states that CONTENT is asked first, and names the qualifier it appends (D-1369)* |
  | `ccd/session-hook.sh`: delete the `fresh+=" — same content as HEAD"` append | `ccrc-install-graphify` — `Test Files  1 failed (1)`, `Tests  no tests`: *ccd/session-hook.sh appends no freshness qualifier at all — the card was rewritten, and the README bullet that names one has to be re-derived against it rather than left standing* |
  | `ccd/session-hook.sh`: reword the qualifier to `" — identical bytes to HEAD"` | `ccrc-install-graphify` — `Tests  1 failed \| 51 passed (52)`: *the canonical overview's graph-card bullet never names the `identical bytes to HEAD` qualifier the hook appends to a freshness word* |

- **D-1370** (2026-09-03, review of the D-1367/D-1368 diff) — **the realpath dedupe was justified by a
  false premise, and in the one case where it does anything it dropped the tree's own real name in
  favour of an alias — unmatching both readers the comment three lines below it promises to keep
  matched.** D-1367's comment said the two worktree globs "now overlap", so candidates are deduped by
  realpath. They do not: `"$WORKTREES_ROOT"/*/` and `"$WORKTREES_ROOT"/*/*/` can never yield the same
  path (that would need `~/worktrees/a/b == ~/worktrees/c`), and neither can reach `$PROJECTS_ROOT`.
  The three globs are DISJOINT as paths and no candidate is ever globbed twice. What does collapse two
  candidates onto one tree is a SYMLINK, and there the survivor was decided by glob order —
  `$PROJECTS_ROOT` is listed first — so an alias under `projects/` won over the real toplevel under
  `worktrees/`.

  That contradicts the contract stated in the same comment block: the row keeps the path AS GLOBBED
  because `$REG/<id>.workdir` and the hook's `cwd` are compared against it VERBATIM
  (`_gs_busy`'s `[ "$(cat "$wd")" = "$tree" ]`; the card's `.path == $p` census lookup), *"and
  canonicalising the census would silently unmatch every reader"*. A census carrying the alias
  unmatches them just as silently for a session recorded under the real name: no idle-gate match — the
  sweep BUILDS while that session is `working`, the one thing the gate exists to prevent — and no
  "the sweep refused this tree" card. MEASURED with a fixture HOME: a real tree at
  `<home>/worktrees/foo` plus `ln -s <home>/worktrees/foo <home>/projects/foo` gave a pass carrying
  exactly one row, and it was the ALIAS `…/projects/foo`; the real workspace path was absent from the
  pass entirely.

  **Fix:** the rationale is corrected (the dedupe exists for symlink aliases, not glob overlap), and
  the survivor becomes a DECISION — prefer the candidate that is its own realpath, the tree named by
  its real path, falling back to first-seen when neither is (two symlinks, where the names are equally
  arbitrary and only the count is a claim). `_gs_trees` therefore buffers its rows rather than
  streaming them, so a later real name can displace an earlier alias. The existing test symlinked
  WITHIN `projects/`, where both names are arbitrary, so it pinned the count and never the survivor;
  the new cross-root fixture pins the name, and a second one pins the EFFECT — a session whose
  `.workdir` records the real path still defers its tree as `skipped-busy`, with the engine never run.

  Measured (baseline `graph-sweep` `Tests  50 passed | 2 skipped (52)`):

  | mutation | measured red |
  | --- | --- |
  | new tests against the un-fixed `ccd/ccd-graph-sweep` (red-first) | `graph-sweep` — `Tests  3 failed \| 47 passed \| 2 skipped (52)`, incl. *the census carries the ALIAS …: expected '…/projects/foo' to be '…/worktrees/foo'* and *the sweep built a graph under a WORKING session …: expected undefined to be 'skipped-busy'* |
  | `ccd/ccd-graph-sweep`: drop `[ "$d" = "$real" ] && named["$dup"]="$d"` (survivor back to glob order) | `graph-sweep` — `Tests  2 failed \| 48 passed \| 2 skipped (52)`: *keeps the REAL path, not the alias, when the two names live under different roots* and *an alias row would unmatch the idle gate — a session on the real path still defers it* |

- **D-1371** (2026-09-03, review of the D-1369/D-1370 diff) — **D-1370's survivor rule was INERT on
  the path shape the fleet actually has, and measured green only because the fixture roots are real
  directories.** The predicate shipped was `[ "$d" = "$real" ]` — *is this candidate spelled as its
  own realpath* — which is a question about the WHOLE path, ancestry included. MEASURED on the live
  box: `~/projects` is itself a symlink (`~/projects -> /data/projects`, `/data -> /mnt/…`), so
  `realpath ~/projects/<x>` lands under the mounted volume `/data` points at, and **no** candidate under
  `$PROJECTS_ROOT` can ever equal its own realpath. Nothing is preferred, the survivor falls back to
  glob order, and the ALIAS wins — exactly the failure D-1370 was written to stop. MEASURED with a
  fixture HOME reproducing that shape (`$HOME/projects` a symlink to a real directory, the real tree
  at `$HOME/projects/zeta`, the alias `$HOME/projects/alpha -> zeta`): the pass carried exactly one
  row and it was `…/projects/alpha`, the real name absent from the pass entirely. D-1370's two new
  tests stayed GREEN throughout — `makeRepo`/`makeWorktreeRoot` build under a real `/tmp`, which is
  the one shape where the shipped predicate happens to be true of the real name.

  **Fix:** ask about the candidate's OWN last component, which is the only thing that distinguishes
  the two names — `if [ ! -L "$d" ] && [ -L "${named[$dup]}" ]`. The real name displaces an alias;
  nothing displaces a real name; two aliases (or two names that differ only in a symlinked ancestor)
  leave the first-seen standing, where the names are equally arbitrary and only the count is a claim.
  This is correct regardless of ancestor symlinks. A third fixture pins it on the shape the fleet has
  rather than the one `/tmp` has; the two cross-root fixtures from D-1370 stay green under either
  spelling, which is why they could not catch this.

  Measured (baseline `graph-sweep` `Tests  51 passed | 2 skipped (53)`):

  | mutation | measured red |
  | --- | --- |
  | `ccd/ccd-graph-sweep`: survivor back to D-1370's `[ "$d" = "$real" ]` | `graph-sweep` — `Tests  1 failed \| 50 passed \| 2 skipped (53)`: *prefers the real name when the ROOT ITSELF is a symlink (the live fleet shape)* — `expected '…/projects/alpha' to be '…/projects/zeta'` |
  | `ccd/ccd-graph-sweep`: drop the survivor rule entirely (glob order) | `graph-sweep` — `Tests  3 failed \| 48 passed \| 2 skipped (53)`: the two D-1370 fixtures *and* the new one |

- **D-1372** (2026-09-03, review of the D-1369/D-1370 diff) — **D-1369 fixed the freshness drift in
  `README.md` and left the identical drift standing in the sibling doc a coordinator quotes into
  briefs.** `ccd/coordinator-skill/references/wave-lifecycle.md`'s graph-card paragraph enumerated the
  clause as exactly `fresh` / `1 commit behind HEAD` / `N commits behind HEAD` / `not an ancestor of
  HEAD` / `freshness unmeasured`, and explained the third as firing when the graph was built at a
  commit the tree cannot reach *"(a branch tip the session has since checked away from, or a diverged
  branch)"*. After D-1368 a diverged branch whose TREE is identical reads `fresh — same content as
  HEAD`, so both the enumeration and its explanation are falsified for that case — and
  `server/test/session-hook.test.ts`'s *calls a SQUASHED history fresh* pins exactly that shape
  (`rev-list --left-right --count` = `1 1`, a diverged branch) as reading `fresh — same content as
  HEAD` and NOT `not an ancestor`.

  The guard was blind to it in precisely the way D-1369 records for the README:
  `coordinator-skill.test.ts`'s FRESHNESS harvest de-dupes `/\bfresh="([^"]+)"/`, so D-1368's new
  `fresh="fresh"` assignment left the vocabulary SET identical, and the qualifier is APPENDED with
  `fresh+=`, which that regex never matches. `coordinator-skill` measured GREEN over the drifted
  paragraph in the baseline run (`Tests  66 passed (66)`) — the same vacuous pass D-1369 recorded.

  **Fix:** the paragraph is scoped the way the README bullet now is — content decides first, the card
  APPENDS ` — same content as HEAD`, and the enumerated ancestry words apply *only* when the two trees
  differ — and `ccrc-install-graphify.test.ts`'s `QUALIFIERS` harvest (same `fresh\+="([^"]+)"`
  collection, same throw-on-empty) is mirrored into `coordinator-skill.test.ts` so the sibling doc is
  bound by mechanism rather than by an author remembering it. The order arm is DERIVED from the hook's
  own call sites (`_hook_same_tree` before `rev-list --left-right --count`), pinning which predicate
  decides first and no spelling of either.

  **`ccd/worker-skill/SKILL.md` clause 12 is deliberately left alone**, recorded here rather than
  implied: its parenthetical fires on `not an ancestor of HEAD`, and that word is still reached only
  when the trees genuinely differ, so the sentence is true post-D-1368. Clause 12 is pinned VERBATIM
  by `worker-skill.test.ts`, so touching it for tidiness would cost a verbatim re-pin for no
  correctness gain. `worker-skill` measured green.

  Measured (baseline `coordinator-skill` `Tests  66 passed (66)`):

  | mutation | measured red |
  | --- | --- |
  | `wave-lifecycle.md`: the graph-card paragraph back to its enumeration-only wording | `coordinator-skill` — `Tests  1 failed \| 65 passed (66)`: *the graph-card paragraph never names the `same content as HEAD` qualifier the hook appends…* |
  | `wave-lifecycle.md`: keep the qualifier named, drop only the `CONTENT decides that clause first` scoping | `coordinator-skill` — `Tests  1 failed \| 65 passed (66)`: *…enumerates the ancestry words without saying that CONTENT is asked first* |
  | `ccd/session-hook.sh`: delete the `fresh+=" — same content as HEAD"` append entirely | `coordinator-skill` — `Test Files  1 failed (1)`, `Tests  no tests`: *Error: ccd/session-hook.sh appends no freshness qualifier at all — … the graph-card paragraph that names one has to be re-derived against it* |
  | `ccd/session-hook.sh`: reword the qualifier to `" — identical bytes to HEAD"` without touching the doc | `coordinator-skill` — `Tests  1 failed \| 65 passed (66)`: *the graph-card paragraph never names the `identical bytes to HEAD` qualifier the hook appends…* |

- **D-1449** (2026-09-04, T1 — the guard compares git's truth, not git's quoting) — **the corpus
  guard measured a TRACKED file as untracked whenever its name carried a non-ASCII byte, refusing the
  tree for ever with no remedy on the box.** `_gs_guard` (`ccd/ccd-graph-sweep`) built the tracked
  side with `git -C "$tree" ls-files` and `comm -23`'d it against `detect()`'s output. `detect()`
  prints raw UTF-8 relative paths; `git ls-files` C-QUOTES any path with a byte above 0x7f — the whole
  line wrapped in double quotes with each byte as an octal escape — unless `core.quotepath` is off.
  Measured directly:

  ```
  $ git ls-files                              $ git -c core.quotepath=false ls-files
  "J\303\240rn \303\266/pic \303\266.png"          Jàrn ö/pic ö.png
  "J\303\240rnb\303\254tar.json"                 Jàrnbìtar.json
  ```

  So the tracked side spelled a name the corpus side never spells, `comm -23` emitted the corpus
  spelling as a breach, and the tree was refused. **MEASURED on the live fleet: `mm-data` was refused
  over exactly two tracked files** — a JSON named with `à`/`ò` and a PNG named with `ö` — both
  committed, both in HEAD, neither in any way untracked. The refusal is permanent: nothing an operator
  can do to the tree changes what `ls-files` prints, and the noise-list remedy (`<repo>.list`) does not
  apply because the paths are not noise.

  **Fix:** one spelling — `git -C "$tree" -c core.quotepath=false ls-files`. The flag is set per
  invocation rather than in the repo's config, so ccrc changes no state in a tree it does not own.
  **SUPERSEDED by D-1450 below** — that spelling silences only the NON-ASCII quoting class and left
  three others (backslash, double quote, control byte) refusing tracked trees exactly as before; the
  shipped spelling is now `ls-files -z | tr '\0' '\n'`. The paragraph is kept as written because it
  is the history of what was measured on the fleet, not because it is the current fix.

  **The other git listings in this file were checked and left alone, deliberately.** `rev-parse`
  ignores `core.quotepath` entirely (measured: `--show-toplevel` and `--path-format=absolute
  --git-common-dir` both print raw UTF-8 from inside a non-ASCII subdirectory), so `_gs_trees`'
  toplevel discovery and `_gs_guard`'s repo-basename derivation were never affected. The RULE 3 probe
  `git -C "$tree" ls-files -c -i -X "$probe" | head -n1` DOES quote, but its output is only ever tested
  for EMPTINESS — quoting cannot turn a hit into a miss — so it feeds no path comparison and is left
  as it is. That reasoning is written into the source comment beside the fix so the next reader does
  not have to re-derive why one call got the flag and the other did not.

  Baseline `graph-sweep` `Tests  53 passed | 2 skipped (55)`.

  | mutation | measured red |
  | --- | --- |
  | drop `-c core.quotepath=false` (the pre-fix spelling) | `graph-sweep` — `Tests  1 failed \| 52 passed \| 2 skipped (55)`: *a TRACKED non-ASCII path is not read as untracked* — `expected 'refused-by-guard' not to be 'refused-by-guard'` |
  | `-c core.quotepath=true` (a wrong VALUE, not an absent flag) | `graph-sweep` — `Tests  1 failed \| 52 passed \| 2 skipped (55)`: same test, same assertion |
  | `if [ -n "$breach" ]` → `if false` (the breach refusal deleted, to prove the inverse test is not vacuous) | `graph-sweep` — `Tests  3 failed \| 50 passed \| 2 skipped (55)`: *an UNTRACKED non-ASCII path still refuses…* plus row 2 and the armed-trap case |

  **Number allocated as D-1449, not the D-1373 the brief named.** The brief's premise was that
  `origin/main`'s highest was D-1372; re-grepping `origin/main` across `docs/` AND source per
  `CLAUDE.md`'s rule finds **D-1448** (`docs/superpowers/plans/2026-09-02-program-leverage-wave8-f8.md`,
  `agent/src/fileops.ts`, `shared/api.ts`) — this ledger's own tail ends at D-1372, which is exactly
  the "a number taken from a plan alone collides with shipped refs" trap the rule warns about.

- **D-1450** (2026-09-04, T1 review — the quoting fix was a QUARTER of the fix) — **`-c
  core.quotepath=false` silences only the non-ASCII quoting class.** D-1449 above read the tracked
  side with that flag and its comment headline claimed the comparison now saw git's truth. It did
  not. `git ls-files` C-quotes a path — wrapping it in double quotes with C escapes — in **four**
  classes, and the flag touches **one**. Measured in a scratch repo tracking four files
  (never a live tree):

  | file, raw | `ls-files` | `-c core.quotepath=false ls-files` | `ls-files -z \| tr '\0' '\n'` |
  | --- | --- | --- | --- |
  | `Jàrnbìtar.py` | `"J\303\240rnb\303\254tar.py"` | `Jàrnbìtar.py` | `Jàrnbìtar.py` |
  | `back\slash.py` | `"back\\slash.py"` | `"back\\slash.py"` | `back\slash.py` |
  | `quo"te.py` | `"quo\"te.py"` | `"quo\"te.py"` | `quo"te.py` |
  | `tab<TAB>name.py` | `"tab\tname.py"` | `"tab\tname.py"` | `tab<TAB>name.py` |

  So for a tracked file carrying a backslash, a double quote or any control byte, D-1449's defect
  survived **unchanged and in full**: the tracked side spells a name the corpus side never spells,
  `comm -23` emits it as a breach, and the tree is refused **for ever**, with the same
  no-remedy-on-the-box property — nothing an operator does to the tree changes what `ls-files`
  prints, and `<repo>.list` does not apply because the path is not noise. Narrower than mm-data's
  measured case, identical in kind and in consequence.

  **Fix:** read the tracked side NUL-separated — `tracked="$(git -C "$tree" ls-files -z | tr '\0'
  '\n')"`. One call, raw for every class, and it makes `core.quotepath` irrelevant rather than
  configuring around it, so the flag is dropped instead of being kept as a second half-mechanism.
  `tr` is POSIX, so the macOS lens is unaffected (`macos-platform` green). The one shape `-z | tr`
  cannot represent is a **newline inside a filename** — and that breaks the line-based corpus side
  identically, so the two sides stay in step rather than disagreeing; that limit is now stated in the
  source comment, which also enumerates all four quoting classes instead of asserting a coverage
  claim the code did not deliver.

  **What was NOT changed, re-checked:** the `ls-files -c -i -X` probe still quotes and is still left
  alone, for the same reason as in D-1449 — its output is only ever tested for EMPTINESS, so quoting
  cannot turn a hit into a miss. `rev-parse` remains unaffected. That reasoning stays in the source
  comment beside the fix.

  Baseline `graph-sweep` after the fix: `Tests  55 passed | 2 skipped (57)` (two new rows).

  | mutation | measured red |
  | --- | --- |
  | the shipped D-1449 spelling `-c core.quotepath=false ls-files` (i.e. this fix reverted) | `graph-sweep` — `Tests  1 failed \| 54 passed \| 2 skipped (57)`: *a TRACKED path git C-quotes for a backslash, a quote or a tab is not read as untracked* |
  | plain `ls-files` (the original pre-D-1449 spelling) | `graph-sweep` — `Tests  2 failed \| 53 passed \| 2 skipped (57)`: that row **plus** *a TRACKED non-ASCII path is not read as untracked* |
  | `-z` kept, the `tr` decode dropped (`$( )` eats the NULs, so every name concatenates into one line) | `graph-sweep` — `Tests  6 failed \| 49 passed \| 2 skipped (57)`: both tracked-path rows plus the four `.graphifyignore`-ownership/noise rows |

  The first row is the point: the previously shipped guard passes the whole suite as it stood, and
  goes red only against the new coverage — which is what made this a real finding and not a style
  note. The two new tests are the inverse pair, tracked and untracked, matching D-1449's own shape.

  **Number:** highest across `origin/main` and this branch, both `docs/` and source, is **D-1449**
  (this branch's own previous commit); `D-1450` is unallocated in `origin/main`, at `HEAD`, and in
  the working tree outside these edits.

- **D-1451** (2026-09-04, T2 — what git ignores never enters the corpus) — **detect() never reads a
  NESTED `.gitignore`, so gitignored build artifacts entered the corpus untracked and the guard
  refused the tree — for ever, with no remedy on the box.** `_load_graphifyignore`
  (`graphify/detect.py:793-836`) walks the ancestor chain from the VCS root **down to** the scan root
  — `ceiling` → `root`, and never below it — merging each directory's `.gitignore` and
  `.graphifyignore` on the way. A `.gitignore` that lives *under* the scan root is therefore never
  loaded at all, and everything it excludes is scanned as ordinary source. `_gs_guard`
  (`ccd/ccd-graph-sweep`) then measures those paths as untracked (they are: git ignores them) and
  refuses the build. Nothing an operator does to the tree changes what detect picks up, and
  `<repo>.list` does not apply because the path is not ccrc's noise — so the refusal is permanent.

  MEASURED live: **synapsium-platform** refused over `frontend/exposynapse-site/.astro/settings.json`
  (ignored by `frontend/exposynapse-site/.gitignore`), **MekWarLive/swift-harbor** over `.husky/_/*`
  (ignored by `.husky/_/.gitignore`).

  **Fix:** derive **git's own verdicts** into the generated `.graphifyignore`, so the two sides answer
  with one authority instead of two —
  `git -C "$tree" ls-files -o -i --exclude-standard --directory -z | tr '\0' '\n'`, one ENTRY per
  line, each anchored at the tree root with a leading `/` (a directory entry keeps its trailing `/`),
  appended after the noise-list patterns in the same file, under the same ownership marker, so
  `_gs_rm_generated` still removes it and every existing ownership rule keeps applying unchanged.
  Nothing else is skipped and the list is **not capped**: a capped corpus is one this guard could not
  explain. The entry count is logged in the pass output instead
  (`git-ignored entries derived into the corpus filter: N`).

  **Anchoring is load-bearing, not cosmetic.** detect anchors on a leading `/` against the directory
  holding the file (`detect.py:883-895`) — here the tree root — and takes a directory entry's whole
  subtree through the ancestor walk (`detect.py:924-931`). Unanchored, `build/` matches **at every
  depth**, so an ignored root `build/` would hide a tracked `src/build/`.

  **The invariant is measured, not argued.** These entries ALMOST never hide tracked content:
  `--directory` collapses a directory only when it holds no tracked file (measured — a
  directory with one tracked and one ignored file lists `mixed/skip.log`, never `mixed/`), and a file
  entry names an untracked path. Every derived entry is still run through the existing RULE-3 probe
  (`git ls-files -c -i -X`) and withheld-and-reported if it would. **CORRECTED by D-1452:** this
  paragraph originally said *cannot* hide tracked content *by construction*, and the mutation table
  below justified a green probe row with "no reachable fixture makes the probe fire". Both are false —
  a filename carrying a glob metacharacter is the reachable class, and the probe now carries its own
  red row. See D-1452. The probe runs **once over the
  whole set** in the common case — git's answer over a union is empty iff it is empty for every
  member — and falls back to one call per entry only when that union is non-empty, i.e. when there is
  a culprit to name.

  **Two rules deliberately left standing.** A tree carrying a FOREIGN `.graphifyignore` derives
  nothing: that file is not the sweep's to write, and D-1161's "hands off" outweighs the new filter
  (without this the derivation would have clobbered a repo's own committed file). **CORRECTED by
  D-1452:** this parenthesis originally ended "…which the ownership tests catch". They do not, and it
  was measured that they do not — every ownership fixture lacked a gitignored untracked path, so the
  derivation was vacuous and all three stayed green with the skip deleted. The skip is pinned by its
  own row, ownership (d), from D-1452 onward. And `graphify-out/` — ignored on every tree by `ccrc install`'s own exclude lines — is
  derived like any other entry rather than special-cased, because `graphify-out/memory/` bypasses the
  ignore filter inside detect itself (`detect.py:1160-1166`: `if not in_memory and _is_ignored(…)`),
  so the entry cannot cost the corpus the query results the guard exempts. Checked in the installed
  0.9.9, not assumed.

  **Harness:** the fake detect stub (`plantGuardPython`) echoed `$HOME/fixture-corpus` verbatim and
  ignored `.graphifyignore` entirely — it could not tell a filter that works from one that does
  nothing. It now filters its echoed corpus through the generated file's exact entries the way real
  detect applies them: a leading `/` stripped (it anchors at the root, where the file is written), a
  directory entry by prefix, a file entry by equality, and `graphify-out/memory/` exempt as
  `detect.py:1160-1166` has it.

  **Cost, measured** on a fixture repo with **300 ignored entries** (30 directories each holding a
  tracked `keep.py` beside ten ignored `*.log` files; the live custom-tools tree has 308): the
  derivation call **7 ms**, the union probe **6 ms**, whole-pass wall time **170/148/150 ms** with the
  derivation against **127/151/128 ms** without it — ~20 ms on a tree whose real build is minutes.
  The per-entry fallback, which only runs when the union probe finds a culprit, costs **1063 ms** for
  those 300 entries; that is the price of naming which entry is at fault, paid only when there is one.
  **CORRECTED by D-1452:** every number in this paragraph is the SHELL side only — and **by D-1453**:
  they are also the shell side of a fixture where the pruning loop is DEGENERATE (`dirs: 0`), so they
  say nothing about the pruning cost. In the fixture
  detect IS the stub, so the pass timing cannot see the cost the entries impose where it is actually
  paid — inside detect, which evaluates every entry against every scanned path, twice per tree per
  pass (the guard's own `detect()` and `graphify update`). That cost is O(entries x paths); measured
  against the installed 0.9.9 in D-1452. **SUPERSEDED by D-1458: the whole paragraph measures the
  cost of a derivation that no longer exists.** The derivation is no longer driven by git's ignored
  census at all — it is driven by the BREACH, so the 300-entry fixture derives ZERO entries and the
  shell numbers above are the cost of a code path that is not entered. What replaces them: 300
  derived entries cost the REAL detect **43.3 s** on a 2000-file tree against **1.4 s** with none,
  and the narrowed derivation costs **1.4 s** — the same as a tree with no ignored files at all.

  Baseline `graph-sweep` after the fix: `Tests  59 passed | 2 skipped (61)` (four new rows; D-1450
  left it at `Tests  55 passed | 2 skipped (57)`).

  | mutation | measured red |
  | --- | --- |
  | the derivation dropped (`done < <(true)`) | `graph-sweep` — `Tests  3 failed \| 56 passed \| 2 skipped (61)`: *a NESTED .gitignore below the tree root is honoured*, *a directory holding BOTH a tracked and an ignored file is NOT collapsed*, *a derived entry is ANCHORED* |
  | the leading `/` dropped (`derived+=("$e")`) | `graph-sweep` — `Tests  3 failed \| 56 passed \| 2 skipped (61)`: the same three rows, and the anchoring row fails as designed — `expected [ 'never-built', 'stale-rebuilt' ] to include 'refused-by-guard'`, i.e. the RULE-3 probe withheld the unanchored `build/` because it hides the tracked `src/build/x.ts`, and `build/junk.js` then breached |
  | the entry-count log dropped | `graph-sweep` — `Tests  1 failed \| 58 passed \| 2 skipped (61)`: *a NESTED .gitignore …* — the count is bound, not decorative |
  | the RULE-3 probe over derived entries dropped (`if false; then`) | ~~`Tests  59 passed \| 2 skipped (61)`, GREEN — no reachable fixture makes the probe fire~~ **SUPERSEDED by D-1452: that sentence was a measured falsehood.** The reachable fixture is a filename carrying a glob metacharacter; with it, the same mutation reddens — `graph-sweep` — `Tests  1 failed \| 61 passed \| 2 skipped (64)`: *a derived entry whose FILENAME carries a glob metacharacter is withheld* |

  **Deviations from the brief, both deliberate.** (1) The brief specified
  `-c core.quotepath=false … ls-files`; the shipped call is `-z | tr '\0' '\n'`, because D-1450 —
  landed on this branch one commit earlier — measured that `core.quotepath=false` silences only the
  non-ASCII quoting class and leaves backslash, double-quote and control-byte names C-quoted. A
  C-quoted entry is a pattern that matches nothing (or the wrong thing), so the brief's spelling would
  have shipped the defect D-1450 had just removed from the other side of the same comparison. (2) The
  brief allocated **D-1374**; the highest number across `origin/main` and this branch, in both `docs/`
  and source, is **D-1450** (this branch's own previous commit), so this entry is **D-1451** — the
  brief's number is long since taken.

- **D-1452** (2026-09-04, T2 review follow-up — the derivation's three unmeasured claims) — **D-1451
  shipped a guard whose failure DELETES a tracked file with no red row, and a ledger that said
  otherwise.** Three findings, all measured before being believed.

  **(1) The `foreign` skip shipped unpinned, and the ledger claimed coverage the tree did not have.**
  D-1451's fourth deviation said the derivation is skipped on a tree carrying a foreign
  `.graphifyignore` "which the ownership tests catch". MEASURED: mutate the skip to `if true; then`
  and the whole file stays green — `graph-sweep` — `Tests  59 passed | 2 skipped (61)`. The reason is
  structural, not luck: `trackForeignIgnore` force-ADDS the file (so `ls-files -o` never lists it) and
  `makeRepo` plants NO gitignored untracked path, so `derived` is empty in (a), (a2) and (b) either
  way and the write block never runs at all. The hazard the skip prevents is the worst in this file:
  the generated filter overwrites the repo's own COMMITTED file, and `_gs_rm_generated` — now
  marker-matching (D-1161) — reads its own marker on what is now a marker-bearing file and `rm -f`s
  it at exit, leaving the repo with a DELETED TRACKED FILE. **Fix:** ownership row **(d)**, the same
  fixture as (a2) plus the missing precondition — `.gitignore` = `*.log` committed and an untracked
  `noise.log` — asserting the committed file exists, is byte-identical, `git status --porcelain` is
  empty, and the tree is not `refused-by-guard`.

  **(2) The RULE-3 probe over derived entries has a reachable fixture; the ledger said it does not.**
  **CORRECTED by D-1453: the seam below is THREE-way, not two-way, and this fixture measures only the
  half where the two glob dialects happen to AGREE.** `git ls-files -X` is wildmatch (`*` does not
  cross `/`); detect is `fnmatch.fnmatch` (`*` does). With the tracked file at the SAME depth as the
  entry they agree and the probe fires, as below; move it one directory deeper and the probe goes
  silent while detect still eats the tracked file. The real fix is to neutralize the metacharacter so
  the entry is literal in BOTH dialects — see D-1453 (1).**
  D-1451's mutation table recorded the probe as green-under-mutation and justified that with "with
  `--directory` and anchoring in place no reachable fixture makes the probe fire". That sentence is a
  measured falsehood, and the class it misses is the seam between the readings of an entry: **git
  spells an entry as a PATH; detect and `ls-files -X` each spend it as a GLOB — but not the SAME glob
  dialect (D-1453).** MEASURED (git 2.43.0):
  `.gitignore` carrying `/a\*.log` — an ESCAPED star, so only the file literally named `a*.log` is
  ignored — with a tracked, committed `ab.log` and an untracked `a*.log`. Then `ls-files -o -i
  --exclude-standard --directory` prints `a*.log`, and that entry as a probe pattern gives `ls-files
  -c -i -X` the answer `ab.log`: the derived entry WOULD hide a tracked file. **Fix:** that fixture as
  a fifth D-1451 row, asserting the `derived ignore entries withheld, repo tracks matching files:
  /a*.log` stderr line, that the withheld entry never reaches the generated filter, and that no count
  is logged because nothing survived. The assertion sits on the stderr line and the generated file,
  not on the outcome, because the corpus stub matches file entries by EQUALITY while real detect
  globs — the one place in this file where the stub cannot mirror the engine. **CORRECTED by D-1453:
  that is exactly the place where the mirror is LOAD-BEARING — a derived entry that eats a tracked
  file out of the corpus shows up nowhere else — so the stub now globs, tees the corpus, and this
  row was replaced by two.**

  **(3) git emits REDUNDANT entries, and every one of them is paid for per scanned path.** MEASURED
  (git 2.43.0): `.gitignore` = `*.log` and a directory `f/` holding only `a.log` and `b.log` — `git
  ls-files -o -i --exclude-standard --directory` prints **`f/`, `f/a.log`, `f/b.log`**, three entries
  for one collapsed subtree. (`--directory` collapses the directory, but git still lists the files
  under it whenever the directory is not itself named by a rule; contrast a directly-named
  `node_modules/`, which prints one entry.) **Why it matters, MEASURED against the installed 0.9.9**
  (`graphify.detect._is_ignored`, pure path math, shared ancestor `_cache`, 2000 synthetic paths):
  **4 anchored patterns → 0.588 s; 300 anchored patterns → 30.296 s** — ~50 us per (pattern, path),
  because the anchored arm recomputes `target.relative_to(anchor)` INSIDE the per-pattern loop
  (`detect.py:891-895`) instead of once per target. That is tens of seconds per detect call on a
  300-entry tree, doubled per pass (the guard's own `detect()` and `graphify update`), against
  `CCRC_GRAPH_BUILD_TIMEOUT=600` — i.e. entry count moves a big tree toward a `timed-out` row, which
  D-1451's shell-side timings could not show. It also inflated the logged count, which over-reported
  what the filter carries. **Fix:** after the read loop, drop any entry already covered by a derived
  DIRECTORY entry — pure shell, no new process, `case "$e" in "$d"*)` with `$d` QUOTED so a
  metacharacter in a directory name stays literal. The count log then states the entries the filter
  actually carries. **CORRECTED by D-1453 (2): that fix was written as a nested loop, O(entries ×
  directories), and the 300-entry cost fixture below never entered it — a tracked file in every
  directory means git collapses nothing, so `dirs` is empty. On the shape pruning exists for (5500
  entries under 500 collapsed `__pycache__/`) the nested loop cost 14555 ms of bash per tree per pass.
  It is now a single forward pass: 54 ms, identical result.**
  **SUPERSEDED by D-1458 — and this is the paragraph that got it wrong.** It measured 30.296 s of
  added detect time for 300 entries, named `CCRC_GRAPH_BUILD_TIMEOUT=600` as the thing that had not
  been breached, and moved on. A measured cost was ACCEPTED instead of REMOVED. What the pruning
  ACHIEVED — one entry per collapsed subtree — stays; the code that achieved it does not (see
  D-1453's own correction below). What it could not fix either way is that the multiplier was 308 on
  custom-tools where the corpus needed 0. Since D-1458 the derivation reads the breach, not the
  census, and the collapse applies to the handful of entries that survive.

  **Not done, and why.** The per-(pattern, path) cost is a defect in the installed engine, not in this
  tree — pruning cuts the multiplier, it does not fix the loop. Hoisting `relative_to(anchor)` out of
  the per-pattern loop is an upstream graphify change and is out of this task's scope; recorded here
  so the next reader has the measurement rather than re-deriving it.

  Baseline `graph-sweep` after the fix: `Tests  62 passed | 2 skipped (64)` (three new rows; D-1451
  left it at `Tests  59 passed | 2 skipped (61)`).

  | mutation | measured red |
  | --- | --- |
  | the `foreign` skip dropped (`if [ "$foreign" -eq 0 ]; then` -> `if true; then`) | `graph-sweep` — `Tests  1 failed \| 59 passed \| 2 skipped (62)` (measured before rows 2-3 existed): *(d) a foreign file plus a GITIGNORED untracked path* — `AssertionError: the repo's own committed file must still exist: expected false to be true`, i.e. the derived filter overwrote the tracked file and the exit trap then deleted it |
  | the RULE-3 probe over derived entries dropped (`if false; then`) | `graph-sweep` — `Tests  1 failed \| 61 passed \| 2 skipped (64)`: *a derived entry whose FILENAME carries a glob metacharacter is withheld* — the withheld line never appears, and `/a*.log` reaches the filter |
  | the redundant-entry pruning dropped (the inner `for d in ${dirs[@]}` test removed) | `graph-sweep` — `Tests  1 failed \| 61 passed \| 2 skipped (64)`: *redundant entries under a COLLAPSED directory are pruned* — the generated filter carries `/f/`, `/f/a.log`, `/f/b.log` and the count logs 3 |

  **Number:** highest across `origin/main` and this branch, both `docs/` and source, is **D-1451**
  (this branch's own previous commit), so this entry is **D-1452**; `git grep D-1452 HEAD origin/main`
  is empty.

  **One PRE-EXISTING red, measured and left alone.** `server/test/typecheck-tests.test.ts` is red in
  this checkout — `Tests  2 failed | 7 passed (9)`, "these server files are compiled by NO typecheck
  project" over 349 files including `src/askkey.ts`, plus the helpers row. It is a PATH-SPELLING
  artefact of this box, not a code defect and not this task's: `/data` is a symlink to
  `/mnt/<volume>`, and `tsc --listFiles` reports `src/` and `shared/` files under the
  `/data/projects/ccrc-pwa/...` spelling while the suite's own `readdirSync` walk enumerates the
  `/mnt/...` one, so every such file reads as uncovered. MEASURED at pristine `HEAD` with all four of
  this commit's files restored from `git show HEAD:<path>`: identical failure, identical summary line
  — then this commit's versions were put back and `git status --porcelain` re-checked. Recorded so
  the next reader does not attribute it to the derivation.


- **D-1453** (2026-09-04, T2 review follow-up 2 — the seam is THREE-way, and the loop was quadratic)
  — **D-1452 fixed the loud half of the glob seam and shipped a comment asserting it had fixed the
  quiet half too. It had not: a derived entry can pass the RULE-3 probe and still drop a TRACKED file
  from the corpus, silently.** Two findings, both measured on scratch fixtures before being believed.

  **(1) git's path, wildmatch's glob and fnmatch's glob are THREE readings, not two.** D-1452 (2)
  corrected D-1451's "can never hide tracked content by construction" to "git spells an entry as a
  PATH, detect and `ls-files -X` spend it as a GLOB" — but that sentence still conflates the two
  CONSUMERS, and the source comment D-1452 shipped went further and said outright that "the RULE-3
  probe above is what keeps that spelling from hiding a tracked file". **Measured false.** The probe
  is `git ls-files -X`, i.e. **wildmatch**, where `*` does NOT cross a `/`; detect is
  **`fnmatch.fnmatch`** (`detect.py:866`, anchored arm), where `*` DOES. D-1452's own fixture put the
  tracked file at the SAME depth as the entry (`ab.log` beside `a*.log`), which is exactly where the
  two dialects agree — so the probe fired and the row went green. Move the tracked file **one
  directory deeper** and the probe goes silent while detect still eats it.

  MEASURED, scratch fixture, no live path touched — repo with `.gitignore` = `/a\*.py` (an ESCAPED
  star, so only the literal name is ignored), tracked `ax/b.py` and `keep.py`, untracked ignored
  `a*.py`:

  | step | measured |
  | --- | --- |
  | `git ls-files -o -i --exclude-standard --directory` | `a*.py` |
  | RULE-3 probe, `git ls-files -c -i -X <(echo /a*.py)` | **EMPTY** — the guard KEEPS the entry |
  | real detect (installed 0.9.9), no generated filter | `['a*.py', 'ax/b.py', 'keep.py']` |
  | real detect WITH the kept entry `/a*.py` | `['keep.py']` — the **TRACKED `ax/b.py` is gone** |
  | `_is_ignored(root/'ax/b.py', root, [(root, '/a*.py')])` | `True` |

  And unlike the probe's own case this is **SILENT**: no withheld line, no breach, the guard returns
  0. The harm is the wedge `ccd/graph-noise.default.list`'s D-1160/D-1161 header already names — the
  sweep drops tracked nodes from the corpus, graphify's shrink guard sees an unaccounted net loss and
  refuses the write, and the tree wedges at `refused-shrink` on every pass, for ever.

  **Fix:** make a derived entry literal in BOTH dialects before anyone spends it — neutralize each
  glob metacharacter into a one-character class, `[` → `[[]` FIRST (so the brackets the next two
  insert are not re-escaped), then `*` → `[*]`, then `?` → `[?]`. Pure parameter expansion, no new
  process. MEASURED on the same fixture: with `/a[*].py` the probe still reports no tracked file AND
  real detect returns `['ax/b.py', 'keep.py']` — the tracked file survives and the untracked `a*.py`
  is still excluded. (`_is_ignored(ax/b.py, root, [(root,'/a[*].py')])` → `False`;
  `_is_ignored(a*.py, …)` → `True`.)

  **The probe stays, and is now honestly a belt.** After neutralization an entry matches exactly the
  path git named, plus — for a directory — its subtree, which `--directory` only collapses when it
  holds no tracked file. Its one remaining reachable class is the OTHER dialect gap, and it errs
  SAFE there: a backslash is LITERAL to `fnmatch` but an ESCAPE to wildmatch. MEASURED: `.gitignore`
  `a\\b.log` (one literal backslash) with a tracked `ab.log` and an ignored untracked `a\b.log` — git
  derives `a\b.log`; `git ls-files -c -i -X` on that entry prints **`ab.log`** (TRACKED, so the probe
  fires and withholds), while `_is_ignored(ab.log, root, [(root, '/a\b.log')])` is **False** — detect
  would never have hidden it. A visible false positive, which is the direction a belt may fail in,
  and it is that row that now pins the probe.

  **The stub could not SEE the class, and that was the load-bearing gap.** D-1452 recorded the corpus
  stub's equality match on file entries as "the one place in this file where the stub cannot mirror
  the engine" and moved the assertions off the corpus onto stderr. That is precisely backwards: it is
  the one place where the mirror is load-bearing, because an entry that eats a tracked file shows up
  NOWHERE ELSE. `plantGuardPython` now matches a file entry with an UNQUOTED `case "$p" in $pat)` —
  bash's `case` lets `*` cross a `/` exactly as `fnmatch` does — and tees the filtered corpus to
  `$HOME/seen-corpus`, so a row can assert what SURVIVED rather than only what the filter carries.
  MEASURED that this matters: with neutralization removed AND the stub put back to equality, the
  corpus assertion goes GREEN (blind) and only the filter-shape assertion reddens.

  **(2) The pruning loop was O(entries × directories), and D-1452's cost fixture never entered it.**
  D-1452's 300-entry fixture is "30 directories each holding a tracked `keep.py` beside ten ignored
  `*.log` files" — a tracked file in every directory means git collapses NOTHING, so `dirs` is empty
  and the inner loop never runs. REPRODUCED: `raw entries 300, dirs 0`, loop **5 ms**, kept 300 —
  which is what the ~7/6 ms shell-side numbers were measuring. The shape pruning EXISTS for is the
  opposite one. MEASURED on it, same loop verbatim — `.gitignore` = `*.pyc`, 500 `p<i>/__pycache__/`
  each holding 10 `.pyc`, plus a tracked `p<i>/m.py` outside them: `raw entries 5500, dirs 500`,
  loop **14555 ms**, kept 500. Fifteen seconds of bash per tree per pass, inside the serialized sweep,
  BEFORE the build, on a 15-minute timer, against `CCRC_GRAPH_BUDGET`. It scales as entries × dirs, so
  2000 dirs / 20000 entries is minutes.

  **Fix:** ONE FORWARD PASS. git's listing is sorted, so a collapsed directory is immediately followed
  by every entry under it (`f/` sorts before `f/a.log`; any `g/…` sorts after all of `f/…`), and
  nested collapsed directories fall out of the same test — so a single `cur` prefix variable suffices:
  skip while the entry is under `cur`, else emit and set `cur` to the entry when it ends in `/`.
  MEASURED on the same 5500-entry fixture: **IDENTICAL result (kept 500) in 54 ms against 14555 ms** —
  ~270×, and O(n). The shipped loop, neutralization included, re-timed: 5500/500 → **64 ms**,
  300/0 → **12 ms**, 1 entry → **2 ms**. Both numbers are the SHELL side only; the corpus-side cost
  (~50 us per (pattern, path), 300 anchored patterns → 30.296 s over 2000 paths) is D-1452 (3)'s
  measurement and is unchanged — pruning cuts the multiplier, and that is still the reason it matters.
  **SUPERSEDED in part by D-1458:** cutting the multiplier was never enough, because on custom-tools
  the multiplier after pruning was still 308 against a corpus that needed 0. The pruning's EFFECT and the neutralization both stay
  — but the FORWARD PASS ITSELF IS GONE, deleted rather than narrowed (`grep -n 'forward pass'
  ccd/ccd-graph-sweep` returns nothing). It could not survive the narrowing: it is a property of
  git's SORTED `--directory` listing, and D-1458 no longer walks that listing — it walks the breach,
  in corpus order. Since D-1458 each breach path walks its OWN prefixes against a hash of the
  collapsed directories (`local -A dirset`, `acc="$acc${rest%%/*}/"`), which is O(depth) per path and
  never entries x directories either. The neutralization is unchanged and still runs last, over
  whatever the collapse mapped. The sentence "pruning cuts the multiplier, and that is still the
  reason it matters" was the last place this ledger let a measured 30 s stand as acceptable. Re-measured with the REAL detect on a 2000-file
  tree: 300 derived entries **43.3 s**, none **1.4 s**, and the narrowed derivation **1.4 s**.

  **Not done, and why.** Hoisting `relative_to(anchor)` out of detect's per-pattern loop remains an
  upstream graphify defect, out of this task's scope (D-1452 already records it). A backslash in a
  derived filename is left as git spells it: no single string is literal to both dialects there, and
  the failure it causes is the probe's SAFE direction — withheld and reported, never a silent loss.

  Baseline `graph-sweep` after the fix: `Tests  63 passed | 2 skipped (65)` (D-1452 left it at
  `Tests  62 passed | 2 skipped (64)`: one row replaced, two added).

  | mutation | measured red |
  | --- | --- |
  | the glob neutralization dropped (`esc="${e//\[/[[]}"; esc="${esc//\*/[*]}"; esc="${esc//\?/[?]}"` -> `esc="$e"`) | `graph-sweep` — `Tests  1 failed \| 62 passed \| 2 skipped (65)`: *a derived entry whose FILENAME carries a glob metacharacter is made LITERAL — a tracked file one directory deeper survives* — `AssertionError: the TRACKED file one directory deeper is still in the corpus: expected [ 'keep.py', '' ] to include 'ax/b.py'` |
  | the same mutation PLUS the stub's file arm put back to equality (`case "$p" in $pat)` -> `[ "$p" = "$pat" ]`) | `graph-sweep` — `Tests  1 failed \| 62 passed \| 2 skipped (65)`, but the corpus assertion is GREEN and the red is *the metacharacter is neutralized into a one-character class* — i.e. with the old stub the tracked-file loss is invisible, which is why the stub change ships with the source change |
  | the RULE-3 probe over derived entries dropped (`if false; then`) | `graph-sweep` — `Tests  1 failed \| 62 passed \| 2 skipped (65)`: *the RULE-3 probe still withholds — a backslash is an escape to wildmatch and a literal to fnmatch* — the withheld line never appears |
  | the single-pass prefix skip dropped (`if [ -n "$cur" ]; then case "$e" in "$cur"*) continue ;; esac; fi` -> `:`) | `graph-sweep` — `Tests  1 failed \| 62 passed \| 2 skipped (65)`: *redundant entries under a COLLAPSED directory are pruned* — `expected '# generated by ccd-graph-sweep for on…' not to match /^\/f\/a\.log$/` |

  **Number:** highest across `origin/main` and this branch, both `docs/` and source, is **D-1452**
  (this branch's own previous commit), so this entry is **D-1453**; `git grep D-1453 HEAD origin/main`
  is empty.

- **D-1454** (2026-09-04, T3 — a refused tree is a finding, and a capped list is a lie about its size)
  — **the census recorded eleven refused trees per pass and doctor answered `PASS graphify: … census
  ok`, and the one refusal reason it did record capped its evidence at five paths without saying so.**
  Two halves of one blindness, both measured on the reference fleet 2026-09-04:

  **(a) `_check_graphify` read the pass STATUS and never the pass's ROWS.** `~/.ccrc/graph-sweep.json`
  carries `.passes[-1].trees[]`, one row per tree with its own `outcome` and `reason`; the check
  looked only at `.passes[-1].status`, which answers "did the pass run", not "did the trees build".
  On the live fleet that is `status: "ok"` over **11 of 51 trees `refused-by-guard` and 2 `failed`,
  every pass** — repositories that have had no graph for as long as the census window remembers,
  reported to their operator as `census ok`. Nothing else prints those rows: the sweep runs off a
  timer and writes to nobody's terminal, the hook's card names only the CURRENT tree, and there is no
  `ccrc graph` verb at all (`grep '^cmd_' ccd/ccrc` — the census has no printer, which is why the
  remedy names `$HOME/.ccrc/graph-sweep.json` itself and invents no verb). The check now counts
  those two outcomes and WARNs naming both counts and the per-repository remedy.

  **WARN, never FAIL — a ruling, not a hedge.** A refused tree is the corpus guard (D-1449, D-1451)
  doing exactly its job: the graph it already had is untouched and it builds again the moment its
  corpus is clean. The repair lives in the REPOSITORY (commit the path, ignore it, or name it in
  `~/.ccrc/graph-noise/<repo>.list`), not on the box, so a FAIL would red `ccrc doctor` — hence
  `ccrc install`'s closing gate (D-139, "a fresh install ends green") — for a condition no ccrc verb
  can clear, on every box, for as long as any tree has an untracked artifact. The two counts share
  one bucket (one remedy: read the rows, act per tree) and its own `_dr_warn` line, separate from the
  census bucket above it, whose remedy is about the TIMER and answers nothing here. An unparseable
  count is left to the existing "does not parse" arm rather than reported as `0 refused` — a
  measurement that failed is not a measurement of zero.

  **(b) `head -5` cannot report what it dropped.** The reason string was built as `comm … | head -5`,
  so a tree with six untracked paths and one with sixty produced character-identical reasons. Those
  are different problems with different remedies — one commit against a corpus filter — and the row
  is the only place the refusal is ever stated. The cap stays (a census row is read on a phone); the
  FULL breach is now computed once, capped after, and the remainder counted: ` (+N more)`. The
  suffix needs no separator of its own because the existing `tr '\n' ' '` already leaves a trailing
  space, so an uncapped reason keeps byte-for-byte the text it has always had — pinned by the
  five-path test, which asserts the clause is ABSENT there.

  | mutation | measured red |
  | --- | --- |
  | the whole `gfx_rows_warn` verdict branch deleted from `_check_graphify` | `ccrc-doctor-graphify` — `Tests  1 failed \| 26 passed (27)`: *WARNs, naming both counts, when the last pass carries refused-by-guard and failed rows* — `expected 'PASS graphify: engine 0.9.9, skills c…' to match /^WARN graphify:/` |
  | that branch's `_dr_warn graphify` -> `_dr_fail graphify` (the never-FAIL ruling) | `ccrc-doctor-graphify` — `Tests  1 failed \| 26 passed (27)`: same row, the FAIL verdict where the WARN belongs |
  | the count clause dropped (`[ "${breach_n:-0}" -gt 5 ] && more="(+$((breach_n - 5)) more)"` -> `:`) | `graph-sweep` — `Tests  1 failed \| 64 passed \| 2 skipped (67)`: *the refusal reason says how many breach paths the 5-path cap cut* — `expected 'untracked paths entered the corpus: b…' to match /\(\+3 more\)$/` |

  **Number:** highest across `origin/main` and this branch, both `docs/` and source, is **D-1453**
  (this branch's own previous commit), so this entry is **D-1454** — the brief's own "D-1375" was allocated
  against a stale reading of `origin/main` (whose own highest is **D-1448**, not D-1372) and is long
  since spent — `git grep D-1375` finds nothing anywhere, because the series ran past it before this
  branch was cut.
  `git grep D-1454 HEAD origin/main` is empty.

- **D-1455** (2026-09-04, T3 review — a one-pass fixture cannot tell "the last pass" from "every pass")
  — **D-1454's row census shipped with its LAST-pass dimension unpinned.** Both new fixtures planted a
  census holding exactly ONE pass, so `.passes[-1].trees[]` and `.passes[].trees[]` had identical
  answers and nothing in the suite could tell them apart. MEASURED by the reviewer and reproduced
  here: rewriting all three jq filters at `ccd/ccrc-doctor-checks:2879-2881` to `.passes[]` left
  `ccrc-doctor-graphify` fully green at `Tests  27 passed (27)`.

  That is not a cosmetic gap. The census keeps **ten** passes (`ccd/ccd-graph-sweep:44`,
  `.passes = ((.passes // []) + $p | .[-10:])`), so on the reference fleet the mutant would count
  roughly ten passes of rows — ~110 refused, ~20 failed — and keep naming repositories that were
  fixed nine passes ago, while the line still ends `— of N tree(s) in the last graph-sweep pass`. A
  false sentence carrying an inflated number is precisely the shape D-1454(b)'s own prose objects to,
  and the fix for a refusal is a commit in the REPOSITORY, so the pass right after the repair is
  clean while the census still carries the old rows: reading every pass would warn forever about a
  tree already fixed.

  **Fixture, not implementation.** The guard was right; only its binding was missing. Both D-1454
  tests now plant a SECOND, older pass whose rows would change the answer if they were counted:
  the WARN test's older pass carries four more `refused-by-guard` rows (so `.passes[]` reads
  `7 refused … of 10 tree(s)` instead of `3 refused … of 6 tree(s)`), and the clean-rows test's
  older pass carries one refused and one failed row (so `.passes[]` WARNs on a census whose last
  pass is spotless). A third assertion, `of 6 tree(s)`, pins the TOTAL against the same drift — it
  was the one number on the line no test read.

  | mutation | measured red |
  | --- | --- |
  | all three jq filters `.passes[-1].trees[]?` -> `.passes[].trees[]?` (`ccd/ccrc-doctor-checks:2879-2881`) | `ccrc-doctor-graphify` — `Tests  2 failed \| 25 passed (27)`: *WARNs, naming both counts…* — `expected 'WARN graphify: 7 refused (untracked p…' to contain '3 refused'`; and *says nothing new when every row of the last pass is clean* — `expected 'WARN graphify: 1 refused (untracked p…' to match /^PASS graphify:/` |
  | the TOTAL filter alone, line 2881 `.passes[-1].trees[]?]` -> `.passes[].trees[]?]` | `ccrc-doctor-graphify` — `Tests  1 failed \| 26 passed (27)`: *WARNs, naming both counts…* — `expected 'WARN graphify: 3 refused (untracked p…' to contain 'of 6 tree(s)'` |

  **Number:** highest across `origin/main` and this branch, `docs/` and source, is **D-1454** (this
  branch's previous commit), so this entry is **D-1455**; `git grep D-1455 HEAD origin/main` is empty.

- **D-1456** (2026-09-04, T4 — "every rostered home" was measured against one home) — **every
  install suite in this tree seeds a ONE-account box, so no row could tell "every" from "at least
  one".** `deploy/accounts.default.json` declares a single account and `_inst_roster` seeds it, so
  `ccrc-install-graphify.test.ts`'s 52 rows measured `_inst_graph_always_on_off`, `_inst_skills` and
  `_inst_graphify_skill` — three steps whose own report lines say "each account's" and "N home(s)" —
  against exactly one directory. D-1244's plan wrote the gap down rather than closing it (`2026-09-02-d1244-the-read-rule-clobbered-what-it-promised-not-to.md`,
  "Known, and deliberately not fixed here"): *"the `$n`/`$same` counters double-counting one
  physical file is unmeasured. A two-account fixture would close all three and is the next thing to
  do here."*

  **Fixture, not implementation — the shipped behaviour was right and is now bound.** `seedTwoAccountRoster`
  writes `$HOME/.ccrc/accounts.json` BEFORE the run, which is the supported door (`_inst_roster`
  seeds the shipped default only when that file is absent; an existing roster is user-owned and
  never overwritten), and `_inst_accounts_sh` then generates the `accounts.sh` every step reads
  through `_ccrc_cfg_dir`. The second account is `exec.kind: external`: exactly one account may be
  `upstream` (`shared/roster-json.mjs`), and `generated` would put `_inst_wrappers` to work writing
  a launcher these rows are not about, while `external` is the kind ccrc never writes. Two fixture
  facts were MEASURED rather than guessed: doctor's `wrappers` check FAILs on an external account
  with no `$HOME/.local/bin/<id>` (`install` exits with doctor's code, so every row died at
  `expected 1 to be +0` until the fixture planted that operator-owned launcher), and doctor's
  `graphify` check reads the skill census across ALL homes, which is why truncating
  `install-graphify-skill.sh`'s home loop fails the whole install rather than just the skill row.

  Three rows: both homes' blocks removed with the count line reading `2 home(s) cleared`; the worker
  skill and the graphify skill (bytes, plus the `.graphify_version` stamp) converged into both; and
  the D-1244 case itself — two rostered homes sharing ONE physical `CLAUDE.md` through a symlink,
  where the step must report `1 home(s) cleared`, leave the alias a link, add no `graphify-read-rule`
  to `INST_DEGRADED`, and cut exactly one backup.

  | mutation | measured red |
  | --- | --- |
  | `_inst_graph_always_on_off`'s loop header `"${CCRC_ACCOUNTS[@]}"` -> `"${CCRC_ACCOUNTS[0]}"` (stop after the first home) | `ccrc-install-graphify` — `Tests  1 failed \| 54 passed (55)`: *clears the always-on block from BOTH homes…* — `/tmp/…/.claude-second still carries the block: expected '# head\n\n- operator line\n\n<!-- ccr…' to be '# head\n\n- operator line\n\n## TAIL\…'` |
  | the same function's symlink arm, `f="$phys"` -> `f="$phys"; n=$((n+1))` (count the alias as a second file) | `ccrc-install-graphify` — `Tests  1 failed \| 54 passed (55)`: *counts ONE physical file once…* — `expected 'install: box: /tmp/ccrc-inst-gfx-two-…' to match /always-on read rule — 1 home\(s\) cle…/` |
  | `install-worker-skill.sh`'s home enumeration `"${CCRC_ACCOUNTS[@]}"` -> `"${CCRC_ACCOUNTS[0]}"` | `ccrc-install-graphify` — `Tests  1 failed \| 54 passed (55)`: *converges the worker skill and the graphify skill into BOTH homes* — `/tmp/…/.claude-second has no ccrc-worker skill: expected false to be true` |
  | `install-graphify-skill.sh`'s home enumeration, same edit | `ccrc-install-graphify` — `Tests  3 failed \| 52 passed (55)`: all three new rows, each `expected 1 to be +0` — doctor's `graphify` census refuses the whole install, which is the honest shape of that defect |
  | the broader spelling of row 2 — the census's `continue   # nothing of ours here` -> `n=$((n+1)); continue` | `ccrc-install-graphify` — `Tests  3 failed \| 52 passed (55)`: the new symlink row plus the two pre-existing count rows (*treats markers QUOTED…*, *is idempotent…*) |

  **Number:** highest across `origin/main` and this branch, `docs/` and source, is **D-1455** (this
  branch's previous commit), so this entry is **D-1456**; `git grep D-1456 HEAD origin/main` is empty.
  The brief proposed **D-1376**, which is already inside the range this branch has spent — the
  standing rule (grep both trees, add one) wins over a number quoted in a brief.

- **D-1457** (2026-09-04, T4 review — the row that closed D-1244 could not see its own fixture
  degrade) — **a two-account fixture is a premise, and a row that does not assert its premise is
  measuring something else.** D-1456's symlink row (`counts ONE physical file once when two homes
  share it through a symlink`) is bound entirely by EFFECTS that a ONE-home box produces
  byte-identically: with only `.claude` rostered the remover visits one home, clears the real file,
  leaves `b/CLAUDE.md` an untouched symlink, prints the same `1 home(s) cleared, 0 left in place`,
  adds no `graphify-read-rule`, and cuts exactly one backup. Its two siblings are self-guarding —
  row 1 already asserted `rosteredAccounts(home)`, row 2 asserts files inside `.claude-second`,
  which a one-home box does not have — so the one row whose entire subject is TWO homes sharing ONE
  file was the one row that would have stayed green if the roster never reached the box. Measured,
  not argued: deleting the `{ id: 'second', … }` entry from `seedTwoAccountRoster` reddened rows 1
  and 2 and left row 3 **passing**.

  Fix: the premise assertion `expect(rosteredAccounts(home), 'the two-account roster never reached
  the box').toMatch(/claude.*second/)` now sits immediately after the `r.code` check in the symlink
  row, and in the skills row for symmetry (that one was already bound by effect; the line costs
  nothing and states the premise out loud). No production change — the shipped behaviour was and is
  correct.

  | mutation | measured red |
  | --- | --- |
  | the FIXTURE degraded: drop the `{ id: 'second', … }` account from `seedTwoAccountRoster` (a roster that never reaches the box) | `ccrc-install-graphify` — `Tests  3 failed \| 52 skipped (55)`: all three D-1456 rows, the symlink row now among them — `the two-account roster never reached the box: expected '(claude)' to match /claude.*second/` (before this fix that row PASSED) |
  | re-measured, `_inst_graph_always_on_off`'s symlink arm `f="$phys"` -> `f="$phys"; n=$((n+1))` | `ccrc-install-graphify` — `Tests  1 failed \| 2 passed \| 52 skipped (55)`: *counts ONE physical file once…* — `expected 'install: box: /tmp/ccrc-inst-gfx-two-…' to match /always-on read rule — 1 home\(s\) cle…/` |
  | re-measured, the census's `continue   # nothing of ours here` -> `n=$((n+1)); continue` | `ccrc-install-graphify` — `Tests  3 failed \| 52 passed (55)`: the symlink row plus the two pre-existing count rows |
  | re-measured, `install-worker-skill.sh`'s home enumeration `"${CCRC_ACCOUNTS[@]}"` -> `"${CCRC_ACCOUNTS[0]}"` (row 2 still reddens on EFFECT, not on the new premise line) | `ccrc-install-graphify` — `Tests  1 failed \| 2 passed \| 52 skipped (55)`: *converges the worker skill and the graphify skill into BOTH homes* — `/tmp/…/.claude-second has no ccrc-worker skill: expected false to be true` |

  **Number:** highest across `origin/main` and this branch, `docs/` and source, is **D-1456** (this
  branch's previous commit), so this entry is **D-1457**; `git grep D-1457 HEAD origin/main` is empty.

- **D-1458** (2026-09-04, T6 follow-up — a measured cost was ACCEPTED instead of REMOVED) —
  **D-1451..D-1453 derived EVERY path git ignores into the generated `.graphifyignore`, D-1452
  measured what that costs detect, and the ledger signed the number off as "inside the timeout". That
  acceptance was the mistake.** A cost you have measured and can remove is not a cost you get to
  keep, and this one was 30 s per pass for a value of approximately zero.

  **MEASURED on the live fleet (2026-09-04 21:43, `custom-tools`, read-only).** The generated filter
  carried **308 derived entries**: 211 individual files under `.superpowers/`, 59 under `tools/`, 24
  under `.remember/` — individual files rather than directories because `--directory` collapses a
  directory only when it holds no TRACKED file, and every one of those directories holds one.
  detect's matcher costs **~50 us per (pattern, path)** and re-resolves `target.relative_to(anchor)`
  INSIDE the per-pattern loop (`detect.py:891-895`), so 308 entries over that tree's **1938-file**
  corpus is ~600k matches — **~30 s added to EVERY rebuild of that tree**, twice per pass (the
  guard's own `detect()` and `graphify update`). **And the value was near zero:** `detect()` run
  read-only over that tree with no ephemeral filter shows only **22 of the 308** entries cover a file
  graphify would ingest at all — **all 22 under `.remember/`**, which the DEFAULT noise list already
  excludes. The three cases the derivation exists for (`.astro/`, `.husky/_/`,
  `apps/web/static/parts/`) are **one directory entry each**.

  **Fix — derive only what the corpus needs.** `_gs_guard` already computes the breach (corpus ∖
  tracked) it would refuse on; that set is exactly where detect and git disagree, and every other
  ignored path in the tree is a pattern detect evaluates against 1938 files to no effect. So the
  guard now runs as: (1) write the noise-list patterns and run `detect()` ONCE, as before; (2)
  compute the breach; (3) ask git whether each BREACH path is ignored — `git check-ignore --no-index
  -z --stdin`, ONE call over the whole breach — and derive ONE entry per ignored one: the path
  itself, anchored, or the collapsed directory that is a prefix of it when git's `--directory` census
  names one, so a whole ignored tree still costs one line; D-1453's metachar neutralisation and the
  RULE-3 probe run on every derived entry, unchanged; (4) only if entries were derived, append them
  and re-run `detect()` ONCE more for the census. Zero derived entries and zero extra cost on a tree
  like custom-tools; one to three entries on the trees this was written for; at most one extra
  `detect()` run, and only when something was derived. The ownership marker, `_gs_open_filter`'s
  header and `_gs_rm_generated`'s cleanup are unchanged — the filter is now opened once and appended
  to twice instead of written once.

  **`--no-index` is load-bearing, and it is a genuine finding.** Without it `check-ignore` first
  drops every input the INDEX matches — and it matches it as a **pathspec**, not as a pathname, so a
  filename carrying a glob metacharacter is dropped because some OTHER, tracked file matches it.
  MEASURED (git 2.43.0) on D-1453's own fixture: with a tracked `ax/b.py` and an ignored untracked
  `a*.py`, `check-ignore --stdin` answers NOTHING for `a*.py` (exit 1) while `--no-index` answers
  `.gitignore:1:/a\*.py`; identically for `a\b.log` beside a tracked `ab.log`, where the backslash
  is a pathspec escape. Both of D-1453's rows went red on the first cut for exactly this reason.
  Skipping the index costs nothing: the input IS the breach, i.e. corpus paths git does not track, so
  a tracked path can never reach that call.

  **TIMING — the ledger's 300-entry fixture, re-run with the REAL `detect()`** (read-only, scratch
  fixture under the scratchpad; `~/.ccrc/graphify-venv/bin/python`, graphify 0.9.9; 2000 tracked
  `.py` files across 40 directories, 300 ignored `*.tmp` at a root that holds tracked content so
  `--directory` collapses nothing — the shape custom-tools has). Two runs each, wall clock:

  | tree / filter | detect() |
  | --- | --- |
  | BEFORE — 300 derived entries (the census-wide derivation) | **43.30 s**, **43.45 s** |
  | AFTER — 0 derived entries (the breach on this tree is empty) | **1.35 s**, **1.38 s** |
  | control — a tree with NO ignored files at all | **1.41 s**, **1.37 s** |

  The after number is **within 0.06 s** of a tree with no ignored files at all, against the required
  "within a second". The 43.3 s also says D-1452's own 30.296 s under-measured the real thing by
  ~40%: that number came from calling `_is_ignored` directly over synthetic paths, not from
  `detect()` over a real tree.

  **TIMING — the cost this fix ADDS, on a tree that DOES derive.** The table above measures the
  ZERO-derivation case, where the narrowing is free, and that is not the whole bill. On a tree the
  derivation exists FOR, the FIRST `detect()` now runs with the nested-ignored subtree still
  UNFILTERED — before this entry, the census-derived entries were already in the file when the single
  `detect()` ran — and the second, filtered run is added on top. Recording only the free case would be
  the same omission this entry exists to condemn, so: MEASURED on the same box and engine as the table
  above (read-only scratch fixture under the scratchpad, graphify 0.9.9; 2000 tracked `.py` across 40
  directories plus a TRACKED `sub/.gitignore` carrying `vendor/` over an untracked 5000-file
  `sub/vendor/` — the nested-`.gitignore` shape D-1451 was written for; two runs each, warm):

  | pass | corpus `detect()` ingests | wall clock |
  | --- | --- | --- |
  | NEW step 1 — noise patterns only, the ignored subtree unfiltered | 7000 files | **4.55 s**, **4.24 s** |
  | NEW step 4 — `/sub/vendor/` derived and appended, re-measured | 2000 files | **1.40 s**, **1.38 s** |
  | OLD — ONE run, the census-derived `/sub/vendor/` already in the filter | 2000 files | **1.40 s**, **1.38 s** |

  So ~5.9 s where the old shape paid ~1.4 s: **+~3 s on this fixture**, and that extra pass is the
  WHOLE of the new cost — the bash side is strictly cheaper than it was, because the prefix walk is
  O(breach) where the old prune loop was O(the whole census). Two properties bound it. It is paid
  EXACTLY on the trees the derivation serves: a tree that derives nothing — custom-tools, and every
  tree with no nested `.gitignore` — still runs `detect()` once, which is the row above. And it scales
  with the size of the NESTED-IGNORED SUBTREE, not with the corpus: shrinking `sub/vendor/` from 5000
  files to 1000 takes step 1 from 4.55 s / 4.24 s to **1.89 s**, **1.86 s** against the same 1.38 s
  floor — ~0.6 ms per ignored file. ACCEPTED, and the reason is stated rather than assumed: measuring
  the corpus BEFORE deriving from it is what makes the derivation narrow at all, and the only way to
  skip the unfiltered pass is to know what to filter before anything has been measured — which is the
  census-wide derivation this entry removed, at 43.3 s on the fixture above. An order of magnitude
  more, on every pass, on every tree, including the ones that need no derivation at all.

  **Consequences pinned, not asserted.** Two existing rows changed shape because a withheld or
  underivable path is now, by construction, a path already IN the corpus: the RULE-3 backslash row
  (`a\b.log`) now puts that path in the fixture corpus and asserts the tree is REFUSED over it — the
  probe's safe direction is still a visible false positive, and it is now visible in the census row
  rather than costing nothing; and ownership row (d) does the same, so it keeps its power to catch a
  deleted `foreign` skip (with the skip gone the derived filter overwrites the repo's committed
  `.graphifyignore` and the exit trap deletes it). The stub gained two capabilities the narrowing
  needs a test to see: it appends one line per invocation to `$HOME/detect-calls` (a detect() CALL
  COUNT is otherwise unobservable) and copies the filter as detect saw it to `$HOME/detect-ignore`
  (the engine's own capture is unreachable on a refused tree).

  Baseline `graph-sweep` after the fix: `Tests  68 passed | 2 skipped (70)` (three new rows;
  `origin/main` at `f6fb08f2` leaves it at `Tests  65 passed | 2 skipped (67)`, measured).

  RED FIRST, measured: the new rows against `origin/main`'s `ccd/ccd-graph-sweep` —
  `Tests  2 failed | 66 passed | 2 skipped (70)`: *a NESTED .gitignore below the tree root is
  honoured* (its new `detectCalls()` assertion — the census-wide derivation runs detect once, having
  derived before measuring) and *a tree with hundreds of ignored files NONE of which reach the corpus
  derives nothing, and detect() runs once*.

  | mutation | measured red |
  | --- | --- |
  | derive every ignored path — the breach gate dropped (`if [ -n "$breach_all" ] && …` -> `if …`) AND the `check-ignore` call replaced by `git ls-files -o -i --exclude-standard -z`, i.e. the census-wide derivation restored | `graph-sweep` — `Tests  3 failed \| 65 passed \| 2 skipped (70)`: *a tree with hundreds of ignored files NONE of which reach the corpus derives nothing* (`not one of the 300 covers a file detect would ingest, so not one is derived: expected [ '/n000.tmp', …' ] to deeply equal []`), *a repo with nothing ignored gets no derived entries at all*, *the RULE-3 probe still withholds* |
  | the `check-ignore` step dropped (`done < <(printf '%s\n' "$breach_all")` — every breach path treated as ignored) | `graph-sweep` — `Tests  6 failed \| 62 passed \| 2 skipped (70)`: *a breach path git does NOT ignore is never derived*, *row 2 — an untracked corpus path refuses the BUILD*, *an UNTRACKED non-ASCII path still refuses*, *a guard refusal after the filter was written leaves no armed trap*, and both D-1454 cap rows — the guard would filter away the very paths it exists to refuse |
  | the SECOND `detect()` run dropped (the `corpus=`/`breach_all=` pair after the append removed, the append kept) | `graph-sweep` — `Tests  7 failed \| 61 passed \| 2 skipped (70)`: *a NESTED .gitignore below the tree root is honoured*, *a directory holding BOTH a tracked and an ignored file is NOT collapsed*, *a breach path git does NOT ignore is never derived*, *a NON-ASCII ignored corpus path survives the check-ignore round trip*, *a derived entry is ANCHORED*, *a derived entry whose FILENAME carries a glob metacharacter is made LITERAL*, *redundant entries under a COLLAPSED directory are pruned* — the filter is written and nothing re-reads it, so the census still sees the breach |
  | the collapsed-directory mapping dropped (`if [ -n "${dirset["$acc"]+x}" ]` -> `if false`) | `graph-sweep` — `Tests  3 failed \| 65 passed \| 2 skipped (70)`: *a NESTED .gitignore below the tree root is honoured* (the entry is `/frontend/.astro/settings.json`, not `/frontend/.astro/`), *a derived entry is ANCHORED*, *redundant entries under a COLLAPSED directory are pruned* |
  | `--no-index` dropped from the `check-ignore` call | `graph-sweep` — `Tests  2 failed \| 66 passed \| 2 skipped (70)`: *a derived entry whose FILENAME carries a glob metacharacter is made LITERAL* and *the RULE-3 probe still withholds* — git drops both inputs because the index matches them as pathspecs |

  **Number:** highest across `origin/main` and this branch, `docs/` and source, is **D-1457** (PR #50,
  merged), so this entry is **D-1458**; `git grep D-1458 HEAD origin/main` was empty before this
  commit.

- **D-1459** (2026-09-04, D-1458 review follow-up — a guard that became a comment when its write site
  moved) — **D-1458 gave the two write steps a SHARED helper, `_gs_open_filter`, and in doing so
  turned an inline ownership test into prose.** Before it, the one place that wrote the generated
  `.graphifyignore` carried the "is this file ours?" condition on the same line as the write. After
  it, the helper writes the marker header whenever the file is not already ours — and "present but
  FOREIGN" takes that branch identically to "absent". The header goes over a TRACKED file the repo
  committed, and `_gs_rm_generated`, reading its own marker on what is now a marker-bearing file,
  DELETES it at exit: D-1161's failure one step worse.

  **Not reachable on `main`, and the review verified why:** RULE 2 sets `foreign=1` and empties
  `noise_files` in the same branch, so `patterns` is empty and call site 1 is skipped; call site 2
  sits inside `if [ -n "$breach_all" ] && [ "$foreign" -eq 0 ]`. The helper's own header said so —
  and that is the defect. The safety had become a non-local invariant asserted in a comment across
  ~250 lines and TWO call sites, an enumeration that goes stale the moment a third appears, against
  this repo's own doctrine that a comment is a request and a red suite is a mechanism.

  **Fix — structural, not documented.** `_gs_owns_ignore "$1" || return 1` is now the FIRST line of
  `_gs_open_filter`, which therefore returns `0 filter open (trap armed) / 1 foreign, nothing
  written`; the inner `[ -f ] && _gs_owns_ignore` compound collapses to `[ ! -f ]`, since by then
  "absent or ours" is all that can reach it, and the happy paths are unchanged. Both call sites
  became `if <precondition> && _gs_open_filter "$tree"; then`, so a refusal means "append nothing"
  rather than "append to a file the repo owns". The `foreign` skip at the derivation stays — it no
  longer owns the FILE's safety (deleting it now costs the file nothing, measured) but it still owns
  the WORK: on a tree the sweep may not filter, none of the derivation is worth doing.

  **The rows this needed, and why they are unit-level.** No caller can reach the helper on a foreign
  tree, so rows (a)-(d) all stay GREEN with the new line deleted — measured. Row **(e)** therefore
  exercises `_gs_open_filter` DIRECTLY, `eval`-ing the two function definitions out of the SHIPPED
  file (`sed -n '/^_gs_owns_ignore() {/,/^}/p; /^_gs_open_filter() {/,/^}/p'`) rather than retyping
  them, and asserts rc=1, the committed file byte-identical, the tree undirtied, `GS_FILTER_TREE`
  still carrying its sentinel and NO `EXIT` trap armed. Row **(f)** pins the happy paths the guard
  must not cost: absent gets the header (rc=0, trap armed), ours is appended to without a second
  header. `trap -p EXIT` runs at TOP LEVEL, never inside `$( )` — bash resets non-ignored traps in a
  subshell, so a command substitution prints nothing either way and could not tell armed from
  disarmed. Row **(d)** gains one line, `expect(r.stderr).not.toContain('derived into the corpus
  filter')`: with the helper now refusing structurally, that count log is the only thing that still
  reddens when the outer `foreign` skip alone is deleted.

  Baseline `graph-sweep` after the fix: `Tests  70 passed | 2 skipped (72)` (two new rows; D-1458
  left it at `Tests  68 passed | 2 skipped (70)`).

  RED FIRST, measured: the new rows against this branch's own pre-fix `ccd/ccd-graph-sweep`
  (`e0ea3e60`) — `Tests  1 failed | 69 passed | 2 skipped (72)`: *(e) `_gs_open_filter` REFUSES a
  foreign tree itself* — `expected 'rc=0\ntree=/tmp/ccrc-gfxsweep-…' to contain 'rc=1'`. Row (f) is
  green pre-fix by construction: it characterises the paths the fix must NOT change.

  | mutation | measured red |
  | --- | --- |
  | `_gs_owns_ignore "$1" || return 1` deleted from `_gs_open_filter` (the guard itself) | `graph-sweep` — `Tests  1 failed \| 69 passed \| 2 skipped (72)`: *(e) … REFUSES a foreign tree itself* — the helper answers rc=0 on a file the repo committed |
  | the outer skip dropped (`if [ -n "$breach_all" ] && [ "$foreign" -eq 0 ]` -> `if [ -n "$breach_all" ]`) | `graph-sweep` — `Tests  1 failed \| 69 passed \| 2 skipped (72)`: *(d) …* — `expected 'graph-sweep: /tmp/ccrc-gfxsweep-…' not to contain 'derived into the corpus filter'`. **Sub-measurement, with row (d)'s stderr line alone muted: `Tests  70 passed \| 2 skipped (72)`** — i.e. the committed file survives byte-identical and the tree is undirtied even with the skip gone, which is precisely what D-1459 bought. On `e0ea3e60` this same mutation destroyed the file. |
  | call site 2 ignores the refusal (`&& _gs_open_filter "$tree"` -> a bare call on its own line), outer skip also dropped, row (d) stderr line muted | `graph-sweep` — `Tests  1 failed \| 69 passed \| 2 skipped (72)`: *(d) …* — `and be byte-identical — never overwritten by the derived filter: expected 'upstream-owned-rule/\n/noise.log\n' to be 'upstream-owned-rule/\n'`. The helper's refusal is only worth what the caller does with it. |

  **Call site 1's `&&` is unmeasurable and ships anyway.** RULE 2 empties `patterns` on every foreign
  tree, so no fixture can make that site run there; it is symmetry with call site 2 rather than a
  guard with a test, and is recorded as such instead of being claimed as covered.

  **Number:** highest across `origin/main` and this branch, `docs/` and source, is **D-1458** (this
  branch's previous commit), so this entry is **D-1459**; `git grep D-1459 HEAD origin/main` was
  empty before this commit.

- **D-1458 annotation corrections** (same commit, review finding 2) — the two D-1458 annotations on
  the D-1452 and D-1453 entries claimed the pruning IMPLEMENTATION survived the narrowing. It did
  not: the single forward pass over git's sorted `--directory` listing was DELETED, not narrowed —
  it is a property of that sorted listing, and D-1458 walks the breach in corpus order instead. Only
  the EFFECT (one entry per collapsed subtree) and the metacharacter neutralisation survive, over an
  O(depth) prefix walk of each breach path against a `dirset` hash. The in-code comment was already
  accurate ("Walking prefixes is O(depth), never entries x dirs"); only the ledger misdirected, and a
  reader chasing D-1453's own "single forward pass: 54 ms" through the annotation was told the pass
  still existed. Both clauses now separate effect from algorithm. No source change; no new number
  (the correction is to D-1458's own annotations).

- **D-1458 timing completion** (2026-09-04, D-1459 review follow-up — the one cost the fix ADDS went
  unmeasured) — **D-1458's timing table recorded only the case where the narrowing is free.** It
  measured a tree that derives NOTHING (43.30 s -> 1.35 s) and signed the new shape off with the
  prose "at most one extra `detect()` run, and only when something was derived" — a sentence with no
  number against it. On a tree that DOES derive, that extra run is not the whole change either: the
  FIRST `detect()` now runs over the nested-ignored subtree UNFILTERED, where the old shape had the
  census-derived entries in the file before its single run. An unmeasured cost stated as a bound is
  the same omission D-1458 exists to condemn, one level up.

  Now MEASURED and recorded in D-1458's own entry, in a second table beside the first: on a 2000-file
  tree with a tracked nested `.gitignore` over a 5000-file ignored subtree, step 1 costs **4.55 s /
  4.24 s** (7000 files ingested) and step 4 **1.40 s / 1.38 s** (2000), against **1.40 s / 1.38 s**
  for the old single filtered run — **+~3 s**, paid exactly on the trees the derivation serves, and
  bounded by the size of the nested-ignored subtree rather than the corpus (the same subtree at 1000
  files: **1.89 s / 1.86 s**, ~0.6 ms per ignored file over a 1.38 s floor). Same box, same engine
  (graphify 0.9.9), same read-only scratch-fixture method as the first table, two runs each. The
  README bullet gained the same sentence, since it quotes the 43.3 s / 1.4 s pair.

  **No source change, and none is called for:** the two-step order is what makes the derivation narrow
  — the corpus has to be measured before anything can be derived from it — and the only way to skip
  the unfiltered pass is to know what to filter before measuring, which is the census-wide derivation
  D-1458 removed at 43.3 s. **No new number** (the correction completes D-1458's own measurements),
  and no new mutation row: nothing executable moved, so the `graph-sweep` mutation table stands as
  measured under D-1458 and D-1459.

- **D-1509** (2026-09-05, post-#51 live measurement — a REBUILD WAS RECORDED AS A FACT WHEN IT WAS A
  CLAIM) — **graphify's full rebuild exits 0 without writing anything when the candidate graph's
  topology equals the existing one, and the sweep took that exit code for a rebuild.** `watch.py`'s
  `_rebuild_code` (0.9.9) has two short-circuits on the full path: `same_topology` → `save_manifest` →
  "No code-graph topology changes detected; outputs left untouched." → `return True`, and after
  `to_json` to a temp file, "No code-graph changes detected; graph.json/GRAPH_REPORT.md left
  untouched." Neither rewrites `graph.json`, so `built_at_commit` keeps the sha of the LAST write, and
  `graphify update` still prints "Code graph updated." and exits 0. `_gs_build` reads rc 0 as built;
  the loop writes `stale-rebuilt`; `_gs_stale` on the next pass reads the same old stamp against the
  same HEAD; and the tree is rebuilt again — every 15 minutes, for ever.

  **Measured on the live fleet, six consecutive passes 2026-09-04T23:19Z → 2026-09-05T00:35Z:**
  `worktrees/data-internal/session-identity` and `worktrees/expoAI-assistant/quiet-meadow` read
  `stale-rebuilt … head` on every pass, 6806 ms and 73830 ms respectively; their `graph.json` mtimes
  stayed 2026-08-14 18:50 and 2026-09-02 14:57 while `manifest.json` and `.graphify_engine` were
  rewritten each pass; `~/.ccrc/graph-sweep.log` carried "No code-graph topology changes detected;
  outputs left untouched." for both (195 and 2483 files re-extracted). The doctor said PASS — it
  counts only `refused-by-guard` and `failed`. The card in quiet-meadow said "1 commit behind HEAD",
  in session-identity "16 commits behind HEAD". D-1368's own comment already named this shape
  ("graphify's own `update` then writes nothing, the stamp keeps the old sha") and fixed the one case
  where the trees are EQUAL; this is the general case — the trees differ, and graphify says the
  difference has no topology. quiet-meadow's is a `.html` doc (`DOC_EXTENSIONS` lists it,
  `_get_extractor` has no extractor for it, so it yields no node); session-identity's is D-1511.

  **Fix: a build's success is re-measured on the stamp, and graphify's own verdict is what earns a
  restamp.** `_gs_build` now captures the engine's stdout to a temp file (still appended to the log)
  and, after rc 0, re-reads `built_at_commit`. Stamp advanced to HEAD → `stale-rebuilt`/`never-built`
  as before. Stamp not advanced AND stdout carries either "left untouched" verdict → the sweep
  restamps: `graph.json` is copied, the 40-hex value of its last `"built_at_commit"` key is spliced in
  place (same length; the key is the last one, read from the tail exactly as the card reads it), and
  the copy is renamed over the original — one atomic rename, no torn read for a concurrent
  `tail -c 4096`; `GRAPH_REPORT.md`'s "- Built from commit: `<8hex>`" line is rewritten the same way.
  Row outcome `restamped`, reason `unchanged topology; <old8> -> <head8>`, plus `; N tracked file(s)
  modified` when `git status --porcelain --untracked-files=no` is non-empty (D-1511). Stamp not
  advanced AND no verdict in stdout → row `failed`, reason "exit 0 but built_at_commit did not
  advance and graphify reported no unchanged verdict", nothing written: a stamp nobody verified is not
  a stamp. The restamp asserts exactly what graphify would have written had it not short-circuited:
  its stamp is `_git_head()` at build time (`export.py:537`), and its verdict is a full fresh
  extraction of the disk compared against the graph. Both readers — `_gs_stale` and the card — then
  read `fresh` through the predicate they already have; no marker, no second spelling.
  **Mutation:** delete the restamp arm → the fixture's second pass rebuilds again and reads
  `stale-rebuilt` (the test asserts `restamped` then `fresh` with engine calls 1, then 1). Delete
  the verdict test → an engine that exits 0 with a stale stamp and no verdict reads `restamped`
  (the test asserts `failed`, stamp untouched). README's census vocabulary gains `restamped`; the
  doctor's WARN set is unchanged (`failed` was already in it).

  **The refusal set was a comment, not a mechanism — pinned 2026-09-05 (review finding, no new
  number: this completes D-1509's own measurements).** `_gs_restamp`'s "WHAT IT REFUSES" block is
  what makes splicing bytes into an 8 MB file the engine wrote admissible at all, and nothing
  measured any of it: the stamp-mismatch guard could be neutralised (`if val != …` →
  `if False and val != …`) with `graph-sweep` at `Tests  76 passed | 2 skipped (78)`, ZERO red —
  the mutated sweep splices HEAD into a graph.json whose `built_at_commit` is not the value this
  build measured, i.e. exactly the racing write the block says it refuses. Four rows now put a
  census reading behind the refusals a fixture can reach: outcome `failed`, a reason that NAMES the
  refusal, and a graph.json byte-identical to what the pass found. The mismatch row's fixture is a
  venv `python` shim that rewrites graph.json's stamp before exec'ing the real interpreter — the
  window between `_gs_stamp` and the splice is the guard's whole reason to exist, and the shim is
  the only injection point inside it. Baseline after: `Tests  80 passed | 2 skipped (82)`.

  | mutation | measured red |
  | --- | --- |
  | the stamp-mismatch guard neutralised (`if val != (old if is_graph …)` -> `if False and val != …`) | `graph-sweep` — `Tests  1 failed \| 79 passed \| 2 skipped (82)`: *a graph.json that MOVED under the sweep is refused* — `expected 'restamped' to be 'failed'`, and the racing writer's bytes are overwritten with HEAD |
  | `[[ "$old" =~ ^[0-9a-f]{7,40}$ ]] \|\| …` deleted (the sweep's OWN measurement of the stamp) | `graph-sweep` — `Tests  1 failed \| 79 passed \| 2 skipped (82)`: *a graph.json with NO built_at_commit is refused* — `expected 'restamp refused: no built_at_commit in the last 23 bytes of graph.json' to be '…: no built_at_commit to replace'`. A refusal survives; the DISTINCTION between "the sweep measured nothing" and "the tail holds nothing" does not |
  | the tail-window refusal deleted (`if m is None: if is_graph: print(…); sys.exit(1)` -> `sys.exit(0)` for both files) | `graph-sweep` — `Tests  1 failed \| 79 passed \| 2 skipped (82)`: *a built_at_commit outside the tail the CARD reads is refused* — `… to be 'restamp refused: no replacement written for graph.json'`, i.e. the vacuous-python arm (`[ -z "$res" ]`) is what stops a silent interpreter reading as success |
  | the interpreter's exit code ignored (`if [ "$rc" -ne 0 ]` -> `if false`) | `graph-sweep` — `Tests  3 failed \| 77 passed \| 2 skipped (82)`: three of the four rows, each falling through to `replacement for graph.json is not a file` / `no replacement written for graph.json` — a python that dies is refused by the arm AFTER it, but with the wrong reason |
  | a refused restamp recorded as one (`BUILD_OUTCOME=failed` -> `restamped` in `_gs_build`'s `restamp refused:` arm) | `graph-sweep` — `Tests  4 failed \| 76 passed \| 2 skipped (82)`: all four rows — the arm that turns a refusal into the census reading the doctor's WARN set counts |

  **Two refusals ship unmeasured and are recorded as such rather than claimed.** `no graph.json`:
  `_gs_stamp` reads that same file, so a valid `old` with the file gone is a race whose window holds
  no fixture-controlled command (the shim above cannot help — the check is bash, before the
  interpreter runs). `HEAD unreadable`: reaching it wants a tree whose `rev-parse HEAD` fails, i.e.
  one with no commit at all, which no discovery fixture builds. Both are guarded downstream by the
  `restamp refused: …` arm the last row measures.

  **Completed 2026-09-05 (review findings 1–4; no new number — these are D-1509's own arms, the
  way D-1458's timing completion was).** The pinning above measured what the restamp REFUSES; the
  review then measured what it WRITES, and four things did not hold.

  **(1) A failed build still stamped the engine pin.** `printf '%s\n' "$PIN" >
  graphify-out/.graphify_engine` ran at the TOP of the rc-0 arm, before the stamp was re-measured,
  so BOTH `failed` arms — "exit 0 … no unchanged verdict" and "restamp refused: …" — advanced
  `.graphify_engine` for a build that wrote nothing. The next pass then reads the engine dimension
  as fresh, falls through to `head`, and `_gs_busy`'s O3 SECONDS hatch measures the age of a stamp
  no build ever earned. This entry's own spec says of that arm "nothing written". The pin is now
  written on the two arms that return 0 — advanced, restamped — and nowhere else.

  **(2) `failed` was carrying two conditions at once.** graph.json is renamed at the END of its own
  loop iteration, so a refusal raised for GRAPH_REPORT.md returned 1 over a graph.json ALREADY
  carrying HEAD: the row read `failed` — the word the doctor's WARN set counts — for a tree whose
  stamp HAD advanced and which `_gs_stale` and the card both then read as fresh ("no overloaded
  null at a seam", CLAUDE.md). This is the shape the paragraph this one replaces reported as an
  unfixed `D-TBD-<slug>` marker in `_gs_restamp`'s own comment block: fixed, not deferred, and the
  marker is gone from the source — where, being a CONCRETE placeholder, it was reddening
  `server/test/dtbd.test.ts` on every commit it stood.
  graph.json is the stamp every reader in ccrc spends; GRAPH_REPORT.md's "- Built from commit" line
  is graphify's human echo (the card reads only the node count, from its head). So the report step
  is best-effort: any failure there — python rc≠0, no file printed, a failed rename — appends one
  line `graph-sweep: <tree>: GRAPH_REPORT.md not restamped (<why>)` to `~/.ccrc/graph-sweep.log`
  and the row stays `restamped`. `_gs_restamp_refuse` is the single place that decides which of the
  two files may refuse, so "refusal writes NOTHING" is now true of every refusal without exception.

  **(3) A python that died after `mkstemp` leaked its temp copy INSIDE graphify-out/.** A copy of an
  8 MB graph.json, left by an ENOSPC or a killed interpreter, that the sweep never names again and
  that sits in the very directory the corpus guard measures. Everything after `mkstemp` now runs
  under a try/except that unlinks the temp and prints the reason on stdout, so the census names it
  (`restamp refused: graph.json: <errno text>`) instead of a bare "python refused (graph.json)".

  **(4) `shutil.copy2` → `copyfile` + `copymode` — and the finding that prompted it does NOT hold.**
  The review read `copy2` as carrying the old build's mtime onto the restamped graph.json, which
  would make a healthy restamped tree read exactly like the wedge this entry was FOUND by
  (graph.json's mtime frozen while manifest.json moves every pass). MEASURED, twice — standalone and
  as a mutation: the splice write that FOLLOWS the copy resets the mtime to now, so copy2's
  preservation never survived it, and reverting the shipped code to `copy2` leaves the new mtime row
  GREEN (`Tests 85 passed | 2 skipped (87)`). What was actually wrong is the COMMENT — "mode and
  mtime of the engine's own file" claimed a preservation the code did not perform. The primitive now
  says what it does, and the row is kept as a pin on the operator signal rather than dropped: the
  mutation that really implements the finding — `os.utime(tmp, …)` after the splice — reds it.

  Baseline before these five rows: `Tests 80 passed | 2 skipped (82)`; after: `85 passed | 2 skipped
  (87)`. Each row was red before its fix.

  | mutation | measured red |
  | --- | --- |
  | the pin write moved back to the top of the rc-0 arm | `graph-sweep` — `Tests  1 failed \| 84 passed \| 2 skipped (87)`: *a FAILED build does not advance the engine pin* — `expected true to be false` |
  | `_gs_restamp_refuse` refuses for BOTH files (`RESTAMP_WHY="$3"; return 1`) | `graph-sweep` — `Tests  1 failed \| 84 passed \| 2 skipped (87)`: *a restamp whose GRAPH_REPORT.md cannot be rewritten is still a restamp* — `expected 'failed' to be 'restamped'` |
  | the `os.unlink(tmp)` cleanup deleted from the except arm (the reason still printed) | `graph-sweep` — `Tests  1 failed \| 84 passed \| 2 skipped (87)`: *a python that dies after mkstemp leaves no temp copy* — `expected [ '.graph.json.fu4qxvv6' ] to deeply equal []` |
  | `copyfile` + `copymode` reverted to `copy2` (the finding AS STATED) | **GREEN** — `Tests  85 passed \| 2 skipped (87)`. The finding is not observable: the splice write resets the mtime the copy preserved |
  | the old build's mtime carried onto the restamp (`os.utime(tmp, (st.st_atime, st.st_mtime))` after the splice) | `graph-sweep` — `Tests  1 failed \| 84 passed \| 2 skipped (87)`: *a restamped graph.json carries the mtime of the restamp* — `expected 1788487101526.999 to be greater than or equal to 1788573499545` |

- **D-1510** (2026-09-05, same measurement — DISCOVERY DOES NOT REACH CLAUDE CODE'S OWN WORKTREES) —
  `ccd ls` 2026-09-05 shows `claude-corp-intake-platform` running in
  `$PROJECTS_ROOT/intake-platform/.claude/worktrees/board-phase-1` — the directory Claude Code's
  EnterWorktree creates — and `_gs_trees` globs only `$PROJECTS_ROOT/*/`, `$WORKTREES_ROOT/*/` and
  `$WORKTREES_ROOT/*/*/`. That tree has a `graph.json` dated 2026-08-28 11:21 with no
  `.graphify_engine` beside it (not the sweep's build) and reads fresh today only because no commit
  has landed since; its card will say stale at the first commit and nothing will ever rebuild it. Its
  session is one of 18 live ones; the other 17 sit in swept trees (5 under `$PROJECTS_ROOT`, spelled
  `$HOME/projects/<x>` in the census — the symlink form — 12 under `$WORKTREES_ROOT`).
  **Fix:** two more globs, `$PROJECTS_ROOT/*/.claude/worktrees/*/` and
  `$WORKTREES_ROOT/*/*/.claude/worktrees/*/`; the toplevel predicate and the realpath dedupe apply
  unchanged, and the noise-list key already resolves to the parent project (it is the basename of
  `--git-common-dir`'s parent, not of the path). The parent project's own corpus is unaffected: the
  default noise list already withholds `.claude/` unless the parent tracks files there.
  **Mutation:** remove the globs → a fixture `git worktree add .claude/worktrees/x` leaves the census
  (the test asserts it is a row; a plain subdirectory `.claude/worktrees/notatree` is not).

  **Completed 2026-09-05 (review finding 5; no new number — this is D-1510's own glob list).** The
  two globs above miss the DEPTH-1 workspace shape D-1367 exists to support: `$WORKTREES_ROOT/<name>`
  is ITSELF a git toplevel there, so a session's `.claude/worktrees/<x>` sits one level shallower
  than under a depth-2 workspace and `$WORKTREES_ROOT/*/*/.claude/worktrees/*/` never reaches it —
  the same class of miss this entry was written about, one shape further in. Three
  `.claude/worktrees` globs now, one per shape of workspace the fleet actually has: `$PROJECTS_ROOT/*/`,
  `$WORKTREES_ROOT/*/` and `$WORKTREES_ROOT/*/*/`, each suffixed `.claude/worktrees/*/`. The
  toplevel predicate, the realpath dedupe and the noise-list key are untouched.
  **Mutation:** remove the depth-1 glob → `graph-sweep` — `Tests  1 failed | 84 passed | 2 skipped
  (87)`: *discovers one under a DEPTH-1 workspace as well* — `expected [ Array(1) ] to include
  '…/worktrees/solo/.claude/worktrees/z'`.

- **D-1511** (2026-09-05, recorded LIMITATION, not fixed — COMMIT-KEYED FRESHNESS CANNOT SEE A
  WORKING TREE THAT DIFFERS FROM HEAD) — session-identity's working tree differs from HEAD in 70
  tracked files, all staged (51 modified, 18 deleted, 1 added); the 179 functions and classes HEAD
  added since the built commit are absent from the DISK, and a cold rebuild in a scratch copy
  produced a graph without them too. graphify's "unchanged" is TRUE of the disk. ccrc's freshness
  is `built^{tree} == HEAD^{tree}` (D-1368) and reads the tree as 16 commits stale; no reader in ccrc
  measures the disk. graphify's own stamp is HEAD at build time whatever the disk holds
  (`export.py:537`), so a REAL rebuild on a dirty tree stamps HEAD exactly as D-1509's restamp does —
  the restamp adopts the engine's semantics rather than inventing stricter ones, and names the dirty
  count in the row so the census does not hide it. **The hole this leaves, pre-existing for every
  real rebuild on a dirty tree:** a tree built or restamped at HEAD while dirty, then reset to HEAD's
  content, reads fresh while describing the old disk until the next commit moves HEAD. Disk-keyed
  freshness (graphify's `manifest.json` is the engine's own mtime+hash fingerprint of the corpus;
  `graphify check-update` exists) is a design pass, ledgered here so the next reader does not
  rediscover it from a census row.

- **D-1512** (2026-09-05, same measurement — THE SWEEP LOG NAMES NO TREE) — `~/.ccrc/graph-sweep.log`
  holds the engine's stdout and stderr for every build with no tree name and no timestamp;
  attributing "No code-graph topology changes detected" to a tree took correlating re-extracted file
  counts and durations against the census. **Fix:** `_gs_build` writes one header line,
  `graph-sweep: build <tree> at <UTC>`, before the engine's output. **Mutation:** remove it → the
  test that reads the fixture tree's name from the log goes red.

### Corrections to the brief's facts, recorded so nobody re-derives them

- The engine install step is **`_inst_graphify_engine`**, not `_inst_graph_engine` (`ccd/ccrc`).
- The graphify doctor check does not live in `ccd/ccrc` at all: it is **`_check_graphify` in
  `ccd/ccrc-doctor-checks`**, driven by the `CCRC_DOCTOR_CHECKS` data table, and the wrong remedy
  ("only the operator can clear a root-owned link outside `$HOME`") is its `gfx_shadow_warn` bucket's.
  `cmd_doctor` counts verdict lines matching `"PASS $name: "`, so the spec's `graphify-path` has to be
  a real table entry with a matching `_check_graphify-path` function — a verdict printed under an id
  that is not in the table is reported as "the check printed no verdict line of its own".
- **PR #44 is already merged**: `origin/main` is `651f40c5` and its tree is identical to
  `origin/fix/graphify-read-rule-hardening` (`8951f2d8`). `feat/graphify-read-side-ccrc-level` is cut
  from `origin/main` directly; nothing needs to be cherry-picked.
- `ccd/install-session-hooks.sh`'s `EVENTS_JSON` already wires both `SessionStart` and `PostToolUse`,
  so **no installer change is needed**. Its guard derives the expected set from
  `/^\s{2}([A-Za-z|]+)\)/` over the hook's `case` block, which is why Task 1 may split
  `UserPromptSubmit|PostToolUse)` into two two-space-indented arms without changing what is wired.
- **`server/test/ccrc-doctor.test.ts`'s contained PATH carries no `realpath`.** It is
  `<home>/.local/bin:<home>/stub-bin` and no system directory, and that file `linkReal`s only `jq`,
  `timeout`/`gtimeout`, `stat` and `date` at fixture level. `ccrc-doctor-graphify.test.ts` DOES link a
  real `realpath` in its own `healthy()`, which is why R3's new check is green there and would have
  been red in the other file on a fixture whose contract is that every check PASSES. Task 5 Step 5
  adds `linkReal(home, 'realpath')` for exactly this reason; do not drop it as redundant.
- **`optNum` is not an integer guard.** `shared/api.ts:1700` rejects only non-numbers and non-finite
  values, so the WIRE accepts `1.5` and `-1` while `server/src/hookstate.ts` — the one reader the spec
  names — rejects them. That asymmetry is deliberate and is now stated in Task 1's Interfaces block;
  the plan's earlier wording ("revived by `optNum` under an integer guard") described a guard that
  does not exist in that function.
- **The counter's fixtures come in TWO shapes.** `FleetSession` literals spell it `subagents: null`;
  `HookState` literals spell it `subagents: [], interrupted: false`. The two `FleetSession` seds reach
  27 sites and cannot see the three `HookState` ones (`server/test/fleet.test.ts:24`,
  `server/test/bucket.test.ts:298` and `:491`) — measured as `TS2769`/`TS2322` with tsc otherwise
  clean. Task 1 Step 10 carries a third sed for them.
- **`ccd/session-hook.sh` runs `set -uo pipefail` and NOT `set -e`** (`ccd/session-hook.sh:10`), which
  is what makes Task 1's folded three-value `read` safe: a `read` that hits EOF because `jq` failed is
  inert, and each variable falls back to the degrade it already had.
