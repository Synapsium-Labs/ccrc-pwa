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
- **Platform:** `server/test/macos-platform.test.ts` refuses un-shimmed GNU calls in `ccd/ccd`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `ccd/ccrc-api` — no `stat -c`/`stat -f`, no `date +%s%3N`, no `date -d`, no `sha256sum`, no `uuidgen`, no bare `timeout`, no template-less `mktemp`, no `mv -T`, no `du -sb`. `readlink -f` and `realpath` are explicitly ALLOWED. **Use no `awk` in new shell code** (BSD awk refuses a newline inside `-v`). `sed -n "1,0p"` prints line 1, not nothing.
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
Expected: all PASS. (`install-session-hooks` proves the arm split did not change the derived event set; `macos-platform` proves `_hook_epoch_ms`'s two copies still agree.)

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

**(c) Pin the null degrade — three one-line assertions, without which Step 15's `?? 0` mutation row is a comment.** The seds above only touch *inputs*; nothing yet asserts what an assembled or revived session reports. The analogous field is pinned in all three places already, so put `graphQueries` beside `subagents` in each:

- `server/test/fleet.test.ts` — in `it('a hookless session carries all three fields as null')` (the `expect(s.subagents).toBeNull()` at ~:564), add `expect(s.graphQueries).toBeNull();` and rename the test to **`'a hookless session carries all four fields as null'`**.
- `server/test/fleetstate.test.ts` — beside `expect(s?.subagents).toBeNull()` (~:112) add `expect(s?.graphQueries).toBeNull();`, and add `'graphQueries'` to the `Object.keys(...)` `arrayContaining` list on the next line. (That list is hand-kept: a field revived as `undefined` instead of `null` would be silently omitted from `Object.keys`, which is the whole point of the assertion.)
- `server/test/fleet-health.test.ts` — beside `expect(body.sessions[0]?.subagents).toBeNull()` (~:167) add `expect(body.sessions[0]?.graphQueries).toBeNull();`.

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
| delete the `[ ! -f "$cwd/graphify-out/graph.json" ]` early return and emit unconditionally | "prints NOTHING when the tree has no graph and the sweep never mentioned it" |
| move the card call below `[[ "$src" == compact ]] && exit 0` | "is printed for compact too…" |
| replace `fresh=""` in the `''\|*[!0-9]*` case with `fresh="fresh"` | "exits 0 and still prints a card when the tree is not a git repo" |
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
      // hook's SessionStart card, worker clause 12, the PATH converge). What
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
# week after D-1243 deployed showed 109 query/path/explain calls across 4
# corpora, 103 of them in the one repository whose PROJECT CLAUDE.md had carried
# graphify's block, committed, since July. Zero in ccrc-pwa, the busiest project
# on the fleet, with five fresh graphs. "5/5 homes converged" was shape; that is
# effect. The read side now lives in `ccd/session-hook.sh`'s SessionStart card,
# worker clause 12, and `_inst_graphify_engine`'s PATH converge — artifacts ccrc
# installs and owns outright.
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
Measured over the week it was deployed: 109 `query`/`path`/`explain` calls across 4 corpora, 103 of
them in the one repository whose *project* `CLAUDE.md` had carried graphify's block since July, and
zero in ccrc-pwa — the busiest project on the fleet, with five fresh graphs.
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

---

- [ ] **Step 1: Write the failing README guards**

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

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts`
Expected: FAIL — the README mentions none of `SessionStart`, `clause 12`, `graphify-path`, `graphQueries`.

- [ ] **Step 3: Rewrite the README's step enumeration**

In `README.md`, in the "### Graph layer (graphify)" opening paragraph, change the one clause naming the retired step (the count stays **six** — `_inst_graph_always_on_off` is still one step in `cmd_install`'s sequence, and the enumeration guard derives it):

```markdown
skills, it has no vendored tree — into every rostered account's skills directory; the **read-rule
removal** (below), which takes back what D-1243 wrote into each rostered home's `CLAUDE.md`; the
**default noise list**, ccrc's own footprint converged to
```

- [ ] **Step 4: Add the read-side subsection**

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

- [ ] **Step 5: Run the README guards and the whole graphify story**

Run:
```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts
cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
```
Expected: PASS — including "the README's count matches the number of steps that actually run" (still six).

- [ ] **Step 6: Prove the new guard is a mechanism**

| mutation | expected red |
|---|---|
| delete the `graphQueries` bullet from the README | "the README documents the read side as it now is…" |
| re-insert the sentence "`_inst_graph_always_on` converges graphify's own packaged block into every rostered home's `CLAUDE.md`" | "never again describes the read side…" — measured red on the FIRST pattern |
| re-insert the sentence "`_inst_graph_always_on` installs graphify's packaged `always_on/claude-md.md` in each rostered home" | "never again describes the read side…" — measured red on the SECOND pattern (one row per pattern: a table row that only ever reddens one of two assertions leaves the other unmeasured) |
| replace Task 4's paragraph with the earlier draft ("converging graphify's packaged `always_on/claude-md.md` into every rostered home's…") | **stays GREEN, and must** — this is the history the README is there to record, and the guard's job is to forbid the present-tense claim, not the past-tense one. If this mutation goes red, the guard was re-widened and the paragraph and the guard are fighting again |

- [ ] **Step 7: Re-check the deviation number against `origin/main`**

The ledger allocation rule: grep `origin/main` across BOTH `docs/` and source, take the next number. `origin/main` carries `D-1244` today (PR #44, merged as `651f40c5`; re-measured at plan-review time and still `D-1244`), so this plan's three entries are `D-1245`, `D-1246` and `D-1247` — but re-measure at commit time, because another branch may have landed in between:

```bash
cd "$CCRC_REPO"
git fetch origin main --quiet
git grep -ohE 'D-1[0-9]{3}' origin/main -- docs/ ccd/ server/ agent/ pwa/ shared/ deploy/ README.md CLAUDE.md \
  | sort -u | tail -5
```
Expected: `…D-1242 D-1243 D-1244`. If the highest is **not** D-1244, renumber `D-1245`/`D-1246`/`D-1247` in this plan AND in every source comment and test name Tasks 4, 5 and 6 wrote (`git grep -n 'D-1245\|D-1246\|D-1247'` finds them all) to the next three free numbers, then re-run `server/test/deviation-refs.test.ts`.

- [ ] **Step 8: Run the whole suite, in the foreground**

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
cd "$CCRC_REPO"/pwa    && npx tsc --noEmit
cd "$CCRC_REPO" && bash -n ccd/ccrc && bash -n ccd/session-hook.sh && bash -n ccd/ccrc-doctor-checks
```

- [ ] **Step 9: Commit**

```bash
cd "$CCRC_REPO"
git add README.md server/test/ccrc-install-graphify.test.ts docs/superpowers/plans
git commit -m "docs(readme): the read side is the hook, the skill, the PATH and the number (D-1245)"
```

---

## Deviations found

- **D-1245** (2026-09-02) — D-1243 put a project-scoped instruction into an account-wide file ccrc
  does not own: graphify's `always_on/claude-md.md` opens "This project has a knowledge graph at
  `graphify-out/`" and was converged into every rostered home's config-dir `CLAUDE.md`, which Claude
  Code loads for every session under that account in every project — including the trees the sweep
  refuses. Measured effect over the week it was deployed: 109 `query`/`path`/`explain` calls across 4
  corpora, 103 of them in the one repository whose *project* `CLAUDE.md` had carried graphify's block,
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
