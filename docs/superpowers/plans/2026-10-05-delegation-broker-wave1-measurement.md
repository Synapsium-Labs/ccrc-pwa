# Delegation broker wave 1: measurement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute,
> `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) with
> `superpowers:test-driven-development` for every code step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Programme:** `delegation-broker`, **wave 1 of 6** (ledger `docs/superpowers/programs/delegation-broker.md`; of 7
since the 2026-10-07 renumbering, see the numbering note at the top of "Mutation table").
Deploy class: the hook and installer change reach homes through `ccrc update`; everything else is tests, a test
rig and committed fixtures. One PR from a fresh child workspace.

**Goal:** Measure, per Claude Code version on the fleet, exactly what hook events and on-disk artifacts `Agent`,
`Workflow` and raw `git worktree add` produce — so waves 2–6 build only on measured fields.

**Architecture:** Three instruments. (1) The hook's existing `-hookcap` capture arm gains `SessionEnd`, and the
capture reducer gains a delegation block, so a real fleet lane can be measured without any raw payload leaving the
box. (2) A mock-API capture rig — ported into the tree from a scratch rig that already drove Claude Code
2.1.280–2.1.283 through real `Workflow` calls — runs every installed Claude Code binary through fourteen scripted
scenarios inside a private tmux server and a fixture HOME; its synthetic payloads are sanitised and committed as a
fixture corpus, and a matrix is DERIVED from that corpus. (3) A read-only census reads the fleet box's leftover
worktrees and their subagent metadata, path-free.

**Tech Stack:** bash (`ccd/session-hook.sh`, `ccd/install-session-hooks.sh`, the rig driver), Node ≥ 22.13 ESM with
no dependencies (`mockapi.mjs`, `sanitize.mjs`, `build-matrix.mjs`, `deploy/*.mjs`), vitest from `server/`.

**Spec:** `docs/superpowers/specs/2026-10-04-delegation-broker-design.md` — covers §3.1 (re-measured), §5.3's
`SessionEnd` registration, §7 stage 1, §8.1 (questions 1-8 and 10 measured, except that one situation of Q5,
compaction, is unmeasured (D-4364), and two of their situations only by a proxy — a parent OOM by a SIGKILL of the
parent, an account swap by a config-dir swap (D-4066); 9 by a proxy (D-4001)), §8.2 (the fixture corpus and its rig).
Lists ten pre-planned entries under "Deviations found": eight departures from the spec (stage placement of `SessionEnd`,
the matrix's shape, the rig's committed payloads, and five smaller ones) and two method notes that depart from no
spec sentence (D-3994, D-3995).

**Measured at:** `origin/main` `698f679da`, 2026-10-05, read-only. Every `file:line` below is a HINT; each task's
Step 0 re-anchors by content. **Planner's limit:** the plan was written without running the rig on any binary newer
than 2.1.283, so every rig outcome below is EXPECTED, not measured — the measurement is this wave's product, and a
step whose expectation fails records what happened rather than forcing it.

## Preconditions

Stop and report if one fails.

1. This plan is on `origin/main`: `git ls-tree origin/main docs/superpowers/plans/2026-10-05-delegation-broker-wave1-measurement.md` prints one line.
   Merge `origin/main` into this workspace's branch first; every Step 0 re-anchors against the merged tree.
2. `tmux` (≥ 3.0, for its multi-argument command form), `jq`, `git`, `curl` and `node` (≥ 22.13) are on `PATH`:
   `command -v tmux jq git curl node` prints five lines and `tmux -V` reports 3.0 or later.
3. At least one Claude Code binary is installed: `ls ~/.local/share/claude/versions/` prints one or more version names.
4. `cd server && ./node_modules/.bin/vitest run test/session-hook-turnmark.test.ts test/install-session-hooks.test.ts test/hook-capture-reduce.test.ts` is green before any edit (the baseline).

## Global Constraints

- **Fixture HOMEs only.** No test and no rig step runs `ccd` or Claude Code with the real `$HOME`. The rig's HOME is
  always under a root whose basename starts `ccrc-dlg-rig.` and which is outside `$HOME`; the guard is code, not prose.
- **Private tmux only.** Every rig `tmux` call is `tmux -L <sock> -f /dev/null` with `<sock>` matching
  `^dlg[A-Za-z0-9_-]*$`. The default tmux server is never named. Never `send-keys` into a fleet pane.
- **Raw real-lane captures never leave the fleet box.** Only `deploy/hook-capture-reduce.mjs` output from a real lane
  is committed. Rig captures are synthetic (mock API, fixture HOME, fixture repo); they are committed only after
  `sanitize.mjs`, and `topology-clean.test.ts` must pass on them.
- **No `WorktreeCreate` / `WorktreeRemove` registration anywhere** — not in the installer, not in the rig's settings
  (spec §3.1: either replaces Claude Code's native worktree handling).
- **No permission bypass.** The rig grants tools through an explicit `permissions.allow` list in its fixture
  `settings.json`; it never passes `--dangerously-skip-permissions`.
- Tests run from `server/`: `./node_modules/.bin/vitest run test/<file>.test.ts`, in the FOREGROUND, timeout ≥ 600000 ms,
  never bare `npx vitest`.
- Nothing new lands above `ccd/session-hook.sh`'s README anchor (`:2900`); edits above it are in place and line-neutral.
  `server/test/session-hook.test.ts` gains no line (its lines are cited); new hook rows go in
  `server/test/session-hook-turnmark.test.ts`.
- Mutation-table discipline: every guard below ships with a row that goes red when it is deleted, measured.
- No NEW `D-` number is spelled in this plan or in code until the coordinator mints one; departures are named by slug.
- Commit on this workspace's branch only; merge `origin/main` (never rebase) before the handoff.
- Fixtures speak only placeholder vocabulary: `/rig`, `you@example.com`, `Rig Fixture`, 127.0.0.1.

## Review Focus

The five failures most likely to bite, and the task whose tests pin each:

1. **A committed fixture leaks a real path, user name or host name.** `sanitize.mjs` must fail closed — exit 1, write
   nothing — on any residue, not print it (Task 5, rows "fails closed …").
2. **The rig touches the real HOME or the default tmux server.** `rig.sh`'s root and socket guards refuse, and the
   `setup` subcommand writes nothing outside its root (Task 4, rows "guard …" and "setup writes only under its root").
3. **`SessionEnd` changes the stall watch's view.** Its arm must write no hookstate and no turn marker, or a quitting
   session would look like activity (Task 1, rows "writes no hookstate.json … and no turn marker" and "byte-identical").
4. **"Never fired" read as "not measured", or the reverse.** A cell whose run failed must be `unmeasured`, never a
   zero count; a measured zero must stay a zero (Task 7, row "a failed run is unmeasured, a measured zero is zero").
5. **The reducer's new block prints a value.** It prints top-level KEY names of Agent/Task/Workflow inputs and
   responses by design, and nothing else from them: values, isolation values outside the enum, ids and `cwd` paths
   must never reach the output, and a Bash call's key names neither (Task 2, the sentinel rows).

## File Structure

| File | Change | Task |
|---|---|---|
| `ccd/install-session-hooks.sh` | `SessionEnd` joins `EVENTS_JSON` (same line) | 1 |
| `ccd/session-hook.sh` | `sessend` declared (same line); a `SessionEnd)` arm; the StopFailure exit also exits for it (same line) | 1 |
| `server/test/install-session-hooks.test.ts` | twelve events; SessionEnd's foreign entries kept, one managed appended | 1 |
| `server/test/session-hook.test.ts` | the unknown-event row uses `Notification` (in place, no line added) | 1 |
| `server/test/session-hook-turnmark.test.ts` | a `SessionEnd` describe appended | 1 |
| `deploy/hook-capture-reduce.mjs` | `--root` arguments; the `delegation` block | 2 |
| `server/test/hook-capture-reduce.test.ts` | a delegation describe appended | 2 |
| `server/test/delegation-rig/mockapi.mjs` | new: the mock Anthropic API | 3 |
| `server/test/delegation-rig/rig.sh` | new: guards, `setup`, `run`, `all` | 4 |
| `server/test/delegation-rig/scenarios/*.json` | new: fourteen scenarios | 4 |
| `server/test/delegation-rig/README.md` | new: what the rig is, how to re-capture | 4 |
| `server/test/delegation-rig/sanitize.mjs` | new: raw run → committed fixture, fail-closed | 5 |
| `server/test/fixtures/delegation/<version>/<scenario>.json` | new: the corpus | 6 |
| `server/test/delegation-rig/build-matrix.mjs` | new: fixtures → `matrix.json` | 7 |
| `server/test/fixtures/delegation/matrix.json` | new, derived | 7 |
| `server/test/delegation-rig.test.ts` | new: mock, guards, setup, sanitiser, matrix | 3, 4, 5, 7 |
| `deploy/delegation-census.mjs` | new: read-only, path-free census | 8 |
| `server/test/delegation-census.test.ts` | new | 8 |
| `README.md` | registered events; capture section; the rig and census | 1, 2, 8 |
| `docs/superpowers/programs/delegation-broker.md` | the measurement matrix section | 9 |

## Baseline (the step before Task 1)

- [ ] Run precondition 4 and record the pass counts. Run `git fetch origin main` and
  `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/topology-clean.test.ts`; both green.

---

### Task 1: `SessionEnd` registered, captured, otherwise inert

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `ccd/install-session-hooks.sh` (the `EVENTS_JSON=` line)
- Modify: `ccd/session-hook.sh` (the `state="" ask_json=` declaration line; the case block's `StopFailure)` arm; the `[[ -n "$stopfail" ]] && exit 0` line)
- Modify: `server/test/install-session-hooks.test.ts`, `server/test/session-hook.test.ts`, `server/test/session-hook-turnmark.test.ts`
- Modify: `README.md` (the registered-event list; the capture-arm paragraph)

**Interfaces:**
- Consumes: nothing.
- Produces: on every home `ccrc update` reaches, `SessionEnd` payloads reach `session-hook.sh`; in a `-hookcap`
  session they are captured as `$HOME/.ccrc/hook-capture/<id>/SessionEnd-<ms>-<pid>.cap`; otherwise the hook writes
  nothing for them. Task 4's rig and the after-merge cross-check rely on this.

- [ ] **Step 0: Re-anchor.** Each prints exactly one line:

```bash
grep -nF "EVENTS_JSON='[" ccd/install-session-hooks.sh
grep -nF 'state="" ask_json="null" interrupted="false"' ccd/session-hook.sh
grep -nF '  StopFailure) stopfail=1;' ccd/session-hook.sh
grep -nF '[[ -n "$stopfail" ]] && exit 0' ccd/session-hook.sh
grep -nF "run({ hook_event_name: 'SessionEnd' });" server/test/session-hook.test.ts
grep -nF "expect(s.hooks.SessionEnd).toEqual(EXISTING.hooks.SessionEnd);" server/test/install-session-hooks.test.ts
```

- [ ] **Step 1: Write the failing tests.**

In `server/test/install-session-hooks.test.ts`:
- Replace the test title `'registers the eleven measured events and preserves existing entries byte-identically'`
  with `'registers the twelve measured events and preserves existing entries byte-identically'`.
- In the event array of that test, add `'SessionEnd'` after `'SessionStart'`.
- Replace `expect(s.hooks.SessionEnd).toEqual(EXISTING.hooks.SessionEnd);` with these four lines:

```ts
    expect(s.hooks.SessionEnd.slice(0, EXISTING.hooks.SessionEnd.length)).toEqual(EXISTING.hooks.SessionEnd);
    expect(s.hooks.SessionEnd).toHaveLength(EXISTING.hooks.SessionEnd.length + 1);   // one managed entry, appended (delegation broker §5.3)
    expect(s.hooks.WorktreeCreate).toBeUndefined();   // registering either REPLACES Claude Code's own worktree handling (delegation broker §3.1)
    expect(s.hooks.WorktreeRemove).toBeUndefined();
```

- Replace the fixture comment's last sentence `The installer must preserve every byte of these.` with
  `Every foreign entry survives byte-identically; managed ones are appended after them.`

In `server/test/session-hook.test.ts`, in the row `'an unrecognized event writes nothing'`, replace
`run({ hook_event_name: 'SessionEnd' });` with `run({ hook_event_name: 'Notification' });` (same line; `SessionEnd`
is now a handled event, so it no longer proves the `*)` arm).

Append to the end of `server/test/session-hook-turnmark.test.ts`:

```ts
// ── SessionEnd (delegation broker wave 1, spec §5.3): registered, captured in a -hookcap
// session, and otherwise inert — no hookstate, no turn marker, nothing printed. A quitting
// session must not look like activity to the stall watch (STALL_PLUMBING_EVENTS). ──
describe('SessionEnd (delegation broker §5.3)', () => {
  const markFile = (id = 'demo-quiet-basin'): string => path.join(reg(), `${id}.turn.json`);

  it('prints nothing on either stream and exits 0', () => {
    expect(runFull({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' })).toEqual({ stdout: '', stderr: '' });
  });

  it('writes no hookstate.json when none existed, and no turn marker', () => {
    run({ hook_event_name: 'SessionEnd', reason: 'clear' });
    expect(fs.existsSync(stateFile())).toBe(false);
    expect(fs.existsSync(markFile())).toBe(false);
  });

  it('control: a Stop in the same fixture writes both', () => {
    run({ hook_event_name: 'Stop' });
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop' });
    expect(fs.existsSync(markFile())).toBe(true);
  });

  it('leaves an existing hookstate.json and turn marker byte-identical', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    const state = fs.readFileSync(stateFile());
    const mark = fs.readFileSync(markFile());
    run({ hook_event_name: 'SessionEnd', reason: 'logout' });
    expect(fs.readFileSync(stateFile())).toEqual(state);
    expect(fs.readFileSync(markFile())).toEqual(mark);
  });

  it('is captured in a -hookcap session as one .cap file, and still writes no hookstate', () => {
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), '#!/bin/sh\necho "cc-demo-hookcap"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(reg(), 'demo-hookcap.generation'), GENERATION);
    run({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    const dir = path.join(home, '.ccrc', 'hook-capture', 'demo-hookcap');
    const caps = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith('SessionEnd-') && n.endsWith('.cap')) : [];
    expect(caps).toHaveLength(1);
    const [meta, body] = fs.readFileSync(path.join(dir, caps[0] as string), 'utf8').split('\n');
    expect(meta).toBe('{"envSid":"uuid-1"}');
    expect(JSON.parse(body as string)).toEqual({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    expect(fs.existsSync(path.join(reg(), 'demo-hookcap.hookstate.json'))).toBe(false);
    expect(fs.existsSync(markFile('demo-hookcap'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them red.**

```bash
cd server && ./node_modules/.bin/vitest run test/install-session-hooks.test.ts test/session-hook-turnmark.test.ts
```

Expected (measured by the plan review): `install-session-hooks` red on the twelve-events row (its loop:
`SessionEnd: expected false to be true`) and green on the derived-set row (both sides still agree); `session-hook-turnmark` red on
`'is captured in a -hookcap session …'` only (`SessionEnd` falls to `*) exit 0` before the capture arm: expected
length 1, received 0). The three inert rows pass already — they are the guards Step 6 mutates.

- [ ] **Step 3: Implement.**

`ccd/install-session-hooks.sh` — the `EVENTS_JSON=` line becomes (one line, in place):

```bash
EVENTS_JSON='["UserPromptSubmit","PostToolUse","PermissionRequest","Stop","StopFailure","SubagentStart","SubagentStop","PreCompact","PostCompact","SessionStart","SessionEnd"]'
```

`ccd/session-hook.sh`:
- On the declaration line `state="" ask_json="null" interrupted="false" src="" gcmd="" stopfail="" bg="-1" bgk="" bgi="" err="" hts="" msid=""`,
  append ` sessend=""` before the end of the line (same line; the hook runs under `set -u`).
- Directly after the line that begins `  StopFailure) stopfail=1;`, insert one line:

```bash
  SessionEnd) sessend=1 ;;   # delegation broker §5.3: a termination HINT only — captured below in a -hookcap session, otherwise inert (no hookstate, no marker)
```

- Replace the line `[[ -n "$stopfail" ]] && exit 0` with:

```bash
[[ -n "$stopfail$sessend" ]] && exit 0
```

The turn marker's own `case "$event"` has no `SessionEnd` arm, so `tmkind` stays empty and no marker is written;
the inert rows prove it.

`README.md`: find the registered-event list (`grep -nF 'is not among them' README.md`) and add `SessionEnd` to the
list it names, on the same lines; in the capture section (`grep -nF 'Capturing what a new Claude Code actually sends' README.md`
prints its one heading line), add one sentence to its paragraph: "`SessionEnd` is registered for the delegation broker's measurement (spec 2026-10-04 §5.3): it is captured
in a `-hookcap` session and otherwise writes nothing."

- [ ] **Step 4: Run green.**

```bash
cd server && ./node_modules/.bin/vitest run test/install-session-hooks.test.ts test/session-hook-turnmark.test.ts test/session-hook.test.ts
```

Expected: all green. Then run the citation census, which must stay green with no anchor repaired:

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

- [ ] **Step 5: Run the neighbours.** `test/stall-vocabulary.test.ts`, `test/ccrc-account.test.ts`,
  `test/ccrc-install.test.ts` (it runs the installer; allow ≥ 600000 ms) — all green.

- [ ] **Step 6: Mutations** (each alone; restore from a saved copy; re-run the named file):

| # | Mutation | Expected red |
|---|---|---|
| T1-M1 | drop `"SessionEnd"` from `EVENTS_JSON` | `install-session-hooks`: the twelve-events row and the derived-set row |
| T1-M2 | delete the `SessionEnd)` arm | `install-session-hooks` derived-set row; `session-hook-turnmark` capture row |
| T1-M3 | exit line back to `[[ -n "$stopfail" ]] && exit 0` | `session-hook-turnmark`: "writes no hookstate.json …", "byte-identical" and the capture row (it writes hookstate) |
| T1-M4 | remove ` sessend=""` from the declaration line | `session-hook-turnmark`: every row whose event is not SessionEnd and that runs the hook to the exit line fails the exit-0 contract (`sessend: unbound variable`) — 52 of 59 (measured at `fc2dd5ee9`, and again at `e47f3689f`). The 7 survivors: the three rows that run SessionEnd alone reach the exit line with `sessend=1` already set by its arm, and four never reach it (an unknown event exits in the default arm; three rows run no hook) — corrected in fix round 2 (review 296 F7) |
| T1-M5 | add `"WorktreeCreate"` to `EVENTS_JSON` | `install-session-hooks`: the twelve-events row (`toBeUndefined`) and the derived-set row |
| T1-M6 | the turn-marker case's `Stop) tmkind=done` becomes `Stop\|SessionEnd) tmkind=done` | `session-hook-turnmark`: the three SessionEnd rows on their marker assertions — "writes no hookstate.json when none existed, and no turn marker", "leaves an existing hookstate.json and turn marker byte-identical", "is captured in a -hookcap session as one .cap file, and still writes no hookstate" (3 of 59, measured at `fc2dd5ee9`; added in fix round 1, review 277) |

- [ ] **Step 7: Commit.**

```bash
git add ccd/install-session-hooks.sh ccd/session-hook.sh server/test/install-session-hooks.test.ts \
  server/test/session-hook.test.ts server/test/session-hook-turnmark.test.ts README.md
git commit -m "feat(hook): register SessionEnd — captured in -hookcap sessions, otherwise inert (delegation broker w1)"
```

---

### Task 2: the reducer's delegation block

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `deploy/hook-capture-reduce.mjs`
- Modify: `server/test/hook-capture-reduce.test.ts` (append one describe)
- Modify: `README.md` (the capture-arm paragraph: one sentence)

**Interfaces:**
- Consumes: Task 1's `SessionEnd` captures (any `.cap` the arm writes).
- Produces: `node deploy/hook-capture-reduce.mjs <dir> [--root <label>=<abs-path>]...` prints the existing document plus
  `delegation: { toolNames, calls, sessionEndReasons, ids, sequence }` (shapes below). The after-merge cross-check
  and Task 9 read it. Exit 2, one stderr line, empty stdout on a malformed `--root`.

- [ ] **Step 0: Re-anchor.** Each prints one line:

```bash
grep -nF "const dir = process.argv[2];" deploy/hook-capture-reduce.mjs
grep -nF "walkObject(p, [], a.keys);" deploy/hook-capture-reduce.mjs
grep -nF "const out = { v: 1, files: files.length, unparsed, events: {}, sessionStarts, sequence };" deploy/hook-capture-reduce.mjs
```

- [ ] **Step 1: Write the failing tests.** Append to `server/test/hook-capture-reduce.test.ts`:

```ts
// ── The delegation block (delegation broker wave 1, spec §8.1): tool names from a fixed set,
// Agent/Task/Workflow top-level key names, isolation as a token, SessionEnd's reason, ordinals
// in place of ids, and cwd as a root label. Still no value, no id, no path. ──
describe('the delegation block (delegation broker wave 1)', () => {
  interface Call { count: number; inputKeys: string[][]; responseKeys: string[][]; isolation: Record<string, number> }
  interface Dlg {
    toolNames: Record<string, Record<string, number>>;
    calls: Record<string, Call>;
    sessionEndReasons: string[];
    ids: { sessions: number; agents: number; toolUses: number };
    sequence: Array<{ event: string; sid: string | null; agent: string | null; toolUse: string | null;
      tool: string | null; cwd: string; transcriptNamesAgent: boolean | null }>;
  }
  const dlgOf = (args: string[] = []): Dlg => {
    const r = reduceRaw([dir, ...args]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    // `sentinel_secret_key` is a KEY name, which this block prints for Agent/Task/Workflow calls by
    // design; every VALUE sentinel must still be absent.
    for (const s of SENTINELS.filter((x) => x !== 'sentinel_secret_key')) expect(r.stdout, s).not.toContain(s);
    return (JSON.parse(r.stdout) as { delegation: Dlg }).delegation;
  };

  it('names only Agent, Task, Workflow and Bash; every other tool name counts as (other)', () => {
    cap('PreToolUse', 1, 'sid-sentinel-0001', leaky('PreToolUse', { tool_name: 'Agent' }));
    cap('PreToolUse', 2, 'sid-sentinel-0001', leaky('PreToolUse', { tool_name: 'Bash' }));
    cap('PreToolUse', 3, 'sid-sentinel-0001', leaky('PreToolUse', { tool_name: 'SENTINEL-tool-value' }));
    cap('PostToolUse', 4, 'sid-sentinel-0001', leaky('PostToolUse', { tool_name: 'Workflow' }));
    expect(dlgOf().toolNames).toEqual({
      PreToolUse: { Agent: 1, Bash: 1, '(other)': 1 },
      PostToolUse: { Workflow: 1 },
    });
  });

  it('reports top-level input and response key names and isolation as a token, never a value', () => {
    cap('PreToolUse', 1, 'sid-sentinel-0001', leaky('PreToolUse', {
      tool_name: 'Agent', tool_use_id: 'agent-sentinel-7',
      tool_input: { description: 'SENTINEL-tool-value', prompt: 'SENTINEL-prompt-text', isolation: 'worktree' },
    }));
    cap('PostToolUse', 2, 'sid-sentinel-0001', leaky('PostToolUse', {
      tool_name: 'Agent', tool_use_id: 'agent-sentinel-7',
      tool_input: { description: 'SENTINEL-tool-value', prompt: 'SENTINEL-prompt-text' },
      tool_response: { worktreePath: '/home/secret-host/x', status: 'SENTINEL-response-value' },
    }));
    const d = dlgOf();
    expect(d.calls['PreToolUse:Agent']).toEqual({
      count: 1, inputKeys: [['description', 'isolation', 'prompt']], responseKeys: [['sentinel_secret_key']],
      isolation: { worktree: 1, remote: 0, absent: 0, other: 0 },
    });
    expect(d.calls['PostToolUse:Agent']?.responseKeys).toEqual([['status', 'worktreePath']]);
    expect(d.calls['PostToolUse:Agent']?.isolation).toEqual({ worktree: 0, remote: 0, absent: 1, other: 0 });
  });

  it('prints no key name of a Bash call\'s input or response', () => {
    cap('PreToolUse', 1, 'sid-sentinel-0001', leaky('PreToolUse', { tool_name: 'Bash' }));
    const r = reduceRaw([dir]);
    expect(r.status, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { delegation: { calls: object } }).delegation.calls).toEqual({});
    expect(r.stdout).not.toContain('sentinel_secret_key');
  });

  it('counts an isolation value outside worktree and remote as other, without printing it', () => {
    cap('PreToolUse', 1, 'sid-sentinel-0001', leaky('PreToolUse', {
      tool_name: 'Task', tool_input: { isolation: 'SENTINEL-tool-value' },
    }));
    expect(dlgOf().calls['PreToolUse:Task']?.isolation).toEqual({ worktree: 0, remote: 0, absent: 0, other: 1 });
  });

  it('replaces every id with an ordinal, first seen first, so equality shows and the id does not', () => {
    cap('SubagentStart', 1, 'sid-sentinel-0001', leaky('SubagentStart', { agent_id: 'agent-sentinel-7' }));
    cap('PreToolUse', 2, 'sid-sentinel-0001', leaky('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b989ocn62', agent_id: 'agent-sentinel-7' }));
    cap('SubagentStop', 3, 'sid-sentinel-0001', leaky('SubagentStop', { agent_id: 'agent-sentinel-7' }));
    cap('Stop', 4, 'sid-sentinel-0001', leaky('Stop', { session_id: 'other-session-xyz' }));
    const d = dlgOf();
    expect(d.sequence.map((e) => [e.event, e.sid, e.agent, e.toolUse])).toEqual([
      ['SubagentStart', 's1', 'a1', null],
      ['PreToolUse', 's1', 'a1', 't1'],
      ['SubagentStop', 's1', 'a1', null],
      ['Stop', 's2', null, null],
    ]);
    expect(d.ids).toEqual({ sessions: 2, agents: 1, toolUses: 1 });
  });

  it('classifies cwd against --root labels (equal, below, other, absent) and never prints a path', () => {
    cap('PreToolUse', 1, null, leaky('PreToolUse', { cwd: '/home/secret-host/x' }));
    cap('PreToolUse', 2, null, leaky('PreToolUse', { cwd: '/home/secret-host/x/.claude/worktrees/agent-q' }));
    cap('PreToolUse', 3, null, leaky('PreToolUse', { cwd: '/elsewhere/SENTINEL-cwd' }));
    cap('PreToolUse', 4, null, { hook_event_name: 'PreToolUse' });
    const d = dlgOf(['--root', 'repo=/home/secret-host/x', '--root', 'worktrees=/home/secret-host/x/.claude/worktrees']);
    expect(d.sequence.map((e) => e.cwd)).toEqual(['repo', 'worktrees/*', 'other', '(absent)']);
    expect(dlgOf().sequence.map((e) => e.cwd)).toEqual(['unclassified', 'unclassified', 'unclassified', '(absent)']);
  });

  it('marks a SubagentStop transcript path that names its own agent, without printing either', () => {
    cap('SubagentStop', 1, null, leaky('SubagentStop', { agent_id: 'agent-sentinel-7', agent_transcript_path: '/home/secret-host/x/subagents/agent-agent-sentinel-7.jsonl' }));
    cap('SubagentStop', 2, null, leaky('SubagentStop', { agent_id: 'agent-sentinel-7', agent_transcript_path: '/home/secret-host/x/subagents/agent-other.jsonl' }));
    cap('SubagentStop', 3, null, leaky('SubagentStop', {}));
    expect(dlgOf().sequence.map((e) => e.transcriptNamesAgent)).toEqual([true, false, null]);
  });

  it('reports SessionEnd reason through the enum test only, and only for SessionEnd', () => {
    cap('SessionEnd', 1, null, leaky('SessionEnd', { reason: 'prompt_input_exit' }));
    cap('SessionEnd', 2, null, leaky('SessionEnd', { reason: 'SENTINEL-last-message' }));
    cap('SessionEnd', 3, null, leaky('SessionEnd', {}));
    cap('Stop', 4, null, leaky('Stop', { reason: 'clear' }));
    expect(dlgOf().sessionEndReasons).toEqual(['(absent)', '(unprintable)', 'prompt_input_exit']);
  });

  it('refuses a malformed --root with exit 2, one stderr line and no stdout', () => {
    cap('Stop', 1, null, { hook_event_name: 'Stop' });
    for (const bad of [['--root'], ['--root', 'repo'], ['--root', 'Repo=/x'], ['--root', 'repo=relative'], ['--bogus']]) {
      const r = reduceRaw([dir, ...bad]);
      expect(r.status, bad.join(' ')).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr.trim().split('\n')).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Run them red.**

```bash
cd server && ./node_modules/.bin/vitest run test/hook-capture-reduce.test.ts
```

Expected: the new rows red (`delegation` is undefined; the `--root` row exits 0 because the extra arguments are
ignored) except "prints no key name of a Bash call's …", which needs the block to exist and so is red too
(`delegation` undefined); every existing row green.

- [ ] **Step 3: Implement.** In `deploy/hook-capture-reduce.mjs`:

1. Extend the header comment's usage line to
   `// Usage: node deploy/hook-capture-reduce.mjs <capture-dir> [--root <label>=<abs-path>]...` and add, before
   `// Usage:`, this paragraph:

```js
// THE DELEGATION BLOCK (delegation broker wave 1, spec §8.1) adds what the real-lane
// cross-check needs and the document above cannot show — still no value, no id, no path:
//   - tool names from a FIXED set (`Agent`, `Task`, `Workflow`, `Bash`); any other name
//     counts as `(other)`, so a plugin's tool name is never printed;
//   - for an Agent/Task/Workflow call, the TOP-LEVEL key names of `tool_input` and
//     `tool_response` (the KEY test and the same width and digit collapse as above) — the one
//     place the never-descend rule above bends, and only for key NAMES; a Bash call's are never
//     printed — and `tool_input.isolation` counted as `worktree`, `remote`, `absent` or `other`;
//   - SessionEnd's `reason` through the enum test (`[a-z_]`, at most 40);
//   - ordinals in place of ids: the n-th distinct session_id is `s<n>`, agent_id `a<n>`,
//     tool_use_id `t<n>`, first seen first — equality is visible, the id is not;
//   - `cwd` classified against `--root <label>=<abs-path>` arguments: the label when equal,
//     `<label>/*` when below the longest matching root, `other`, `(absent)`, or
//     `unclassified` when no root was given;
//   - whether SubagentStop's `agent_transcript_path` is named `agent-<its agent_id>.jsonl`.
```

2. Below the existing constants (after `const ABSENT = '(absent)';`), add:

```js
const MEASURED_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'Bash']);
const DELEGATION_TOOLS = new Set(['Agent', 'Task', 'Workflow']);
const ISOLATION = new Set(['worktree', 'remote']);
const ENUM = /^[a-z_]{1,40}$/;
const LABEL = /^[a-z][a-z0-9-]{0,20}$/;
```

3. Replace `const dir = process.argv[2];` with:

```js
const argv = process.argv.slice(2);
const dir = argv[0];
const roots = [];
let badArgs = false;
for (let i = 1; i < argv.length; i += 2) {
  const m = argv[i] === '--root' && typeof argv[i + 1] === 'string' ? /^([^=]+)=(\/.*)$/.exec(argv[i + 1]) : null;
  if (m === null || !LABEL.test(m[1])) { badArgs = true; break; }
  roots.push({ label: m[1], path: m[2].replace(/\/+$/, '') || '/' });
}
if (badArgs) {
  process.stderr.write('usage: node deploy/hook-capture-reduce.mjs <capture-dir> [--root <label>=<abs-path>]... (bad argument)\n');
  process.exit(2);
}
```

4. Below `function newAcc() { … }`, add:

```js
const ords = { s: new Map(), a: new Map(), t: new Map() };
/** The ordinal standing in for an id: `s1`, `a2`, `t3` — first seen first; null when absent or empty. */
const ord = (kind, v) => {
  if (typeof v !== 'string' || v.length === 0) return null;
  const m = ords[kind];
  if (!m.has(v)) m.set(v, `${kind}${m.size + 1}`);
  return m.get(v);
};
/** A cwd as a root label, never as a path. */
const cwdClass = (v) => {
  if (v === undefined || v === null) return ABSENT;
  if (typeof v !== 'string') return UNPRINTABLE;
  if (roots.length === 0) return 'unclassified';
  const p = v.replace(/\/+$/, '') || '/';
  let best = null;
  for (const r of roots) {
    if (p === r.path) return r.label;
    if (p.startsWith(`${r.path}/`) && (best === null || r.path.length > best.path.length)) best = r;
  }
  return best === null ? 'other' : `${best.label}/*`;
};
/** Top-level key names of a value, under the same KEY test and collapse as the walk. */
const topKeys = (v) => {
  if (!isObject(v)) return [`(${typeOf(v)})`];
  const names = Object.keys(v);
  return asMap(names, false) ? [MAP] : names.map(seg).sort();
};
const dlg = { toolNames: {}, calls: new Map(), sessionEndReasons: new Set(), sequence: [] };
```

5. Directly after `walkObject(p, [], a.keys);` in the loop, add:

```js
  const tn = typeof p.tool_name === 'string' ? (MEASURED_TOOLS.has(p.tool_name) ? p.tool_name : '(other)') : null;
  if (tn !== null) {
    const h = (dlg.toolNames[f.event] ??= {});
    h[tn] = (h[tn] ?? 0) + 1;
  }
  if (tn !== null && DELEGATION_TOOLS.has(tn)) {
    const k = `${f.event}:${tn}`;
    let c = dlg.calls.get(k);
    if (c === undefined) {
      c = { count: 0, inputKeys: new Set(), responseKeys: new Set(), isolation: { worktree: 0, remote: 0, absent: 0, other: 0 } };
      dlg.calls.set(k, c);
    }
    c.count += 1;
    c.inputKeys.add(JSON.stringify(p.tool_input === undefined ? [ABSENT] : topKeys(p.tool_input)));
    if (p.tool_response !== undefined) c.responseKeys.add(JSON.stringify(topKeys(p.tool_response)));
    const iso = isObject(p.tool_input) ? p.tool_input.isolation : undefined;
    c.isolation[iso === undefined ? 'absent' : ISOLATION.has(iso) ? iso : 'other'] += 1;
  }
  if (f.event === 'SessionEnd') {
    dlg.sessionEndReasons.add(p.reason === undefined ? ABSENT
      : typeof p.reason === 'string' && ENUM.test(p.reason) ? p.reason : UNPRINTABLE);
  }
  const tp = p.agent_transcript_path;
  dlg.sequence.push({
    event: f.event, sid: ord('s', p.session_id), agent: ord('a', p.agent_id), toolUse: ord('t', p.tool_use_id),
    tool: tn, cwd: cwdClass(p.cwd),
    transcriptNamesAgent: typeof tp === 'string' && typeof p.agent_id === 'string' && p.agent_id.length > 0
      ? path.basename(tp) === `agent-${p.agent_id}.jsonl` : null,
  });
```

6. Directly before the final `process.stdout.write(…)`, add:

```js
out.delegation = {
  toolNames: dlg.toolNames,
  calls: Object.fromEntries(sorted(dlg.calls.keys()).map((k) => {
    const c = dlg.calls.get(k);
    return [k, {
      count: c.count,
      inputKeys: sorted(c.inputKeys).map((s) => JSON.parse(s)),
      responseKeys: sorted(c.responseKeys).map((s) => JSON.parse(s)),
      isolation: c.isolation,
    }];
  })),
  sessionEndReasons: sorted(dlg.sessionEndReasons),
  ids: { sessions: ords.s.size, agents: ords.a.size, toolUses: ords.t.size },
  sequence: dlg.sequence,
};
```

`README.md`, the capture section's paragraph (the heading Task 1 anchored on): add "The reducer's `delegation` block (`--root <label>=<path>` classifies
`cwd`) reports tool names from a fixed set, Agent/Workflow key names, isolation as a token and ordinals in place of
ids — still no value, id or path."

- [ ] **Step 4: Run green.** `cd server && ./node_modules/.bin/vitest run test/hook-capture-reduce.test.ts test/session-hook-turnmark.test.ts` — all green (the turnmark round-trip row reads the reducer too).

- [ ] **Step 5: Mutations.**

| # | Mutation | Expected red |
|---|---|---|
| T2-M1 | `MEASURED_TOOLS` gains a pass-through: `tn = p.tool_name` when not in the set | "names only Agent, Task, Workflow and Bash" (and the sentinel scan) |
| T2-M2 | `topKeys` returns `JSON.stringify(v)` values instead of key names | "reports top-level input and response key names …" (sentinel scan) |
| T2-M8 | `DELEGATION_TOOLS` gains `'Bash'` | "prints no key name of a Bash call's input or response" |
| T2-M3 | isolation counted by raw value (`c.isolation[iso] = …`) | "counts an isolation value outside … as other" |
| T2-M4 | `ord` returns the id itself | "replaces every id with an ordinal …" (sentinel scan) |
| T2-M5 | `cwdClass` returns `p` when no root matches | "classifies cwd …" (sentinel scan) |
| T2-M6 | the `badArgs` refusal deleted | "refuses a malformed --root …" |
| T2-M7 | `ENUM` widened to `/^.{1,200}$/` | "reports SessionEnd reason through the enum test only …" |

- [ ] **Step 6: Commit.**

```bash
git add deploy/hook-capture-reduce.mjs server/test/hook-capture-reduce.test.ts README.md
git commit -m "feat(hookcap): the reducer's delegation block — tool names, key names, ordinals, cwd labels (delegation broker w1)"
```

---

### Task 3: the mock Anthropic API, in the tree

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `server/test/delegation-rig/mockapi.mjs`
- Create: `server/test/delegation-rig.test.ts` (the mock's rows; Tasks 4, 5 and 7 append theirs)

**Interfaces:**
- Consumes: nothing.
- Produces: `node server/test/delegation-rig/mockapi.mjs` with env `MOCK_SCRIPT` (required), `MOCK_PORT` (`0` =
  ephemeral), optional `MOCK_LOG` and `MOCK_REQDIR`. Prints exactly one stdout line `mock listening 127.0.0.1:<port>`
  once bound. Answers `HEAD|GET /api/hello`, `POST /v1/messages` (SSE when `stream`), `POST /v1/messages/count_tokens`,
  `GET /__rig/state` → `{ script, entries, consumed, consumedLabels, requests }`, `POST /__rig/reset`. Script entries
  as documented in the file header; Task 4's scenarios are such scripts with extra keys the mock ignores.

This is the scratch rig's `mockapi.mjs` (it drove Claude Code 2.1.280–2.1.283 through real `Workflow` calls), with
five changes: no file is written unless `MOCK_LOG` / `MOCK_REQDIR` name one; `MOCK_PORT=0` binds an ephemeral port and
the bound port is printed; entries may carry a `label`, reported in `consumedLabels`; a `tool_use` may name
`nameAny: [...]` and the mock picks the first name the request offers (a version may call the tool `Task`); and a
response header value `$NOW+<s>` is replaced by the epoch second `<s>` seconds from now (for the rate-limit scenario).

- [ ] **Step 1: Write the failing tests.** Create `server/test/delegation-rig.test.ts`:

```ts
// The delegation broker's capture rig (wave 1, spec 2026-10-04 §8.1-§8.2): the mock Anthropic
// API, the driver's guards and setup, the sanitiser and the matrix builder. Hermetic: no row
// starts Claude Code, names the real HOME, or touches any tmux server.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const RIG = path.resolve(__dirname, 'delegation-rig');
const MOCK = path.join(RIG, 'mockapi.mjs');

const children: ChildProcess[] = [];
afterEach(() => { for (const c of children.splice(0)) c.kill('SIGKILL'); });

/** Start the mock on an ephemeral port with `script` as its MOCK_SCRIPT; resolves to its base URL. */
async function startMock(script: object): Promise<string> {
  const dir = mkTmp('ccrc-dlg-mock-');
  const file = path.join(dir, 'script.json');
  fs.writeFileSync(file, JSON.stringify(script));
  const child = spawn(process.execPath, [MOCK], { env: { ...process.env, MOCK_PORT: '0', MOCK_SCRIPT: file }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const port = await new Promise<string>((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`mock did not start: ${out}`)), 10_000);
    child.stdout!.on('data', (b: Buffer) => {
      out += b.toString();
      const m = /^mock listening 127\.0\.0\.1:(\d+)$/m.exec(out);
      if (m) { clearTimeout(t); resolve(m[1] as string); }
    });
  });
  return `http://127.0.0.1:${port}`;
}

const MAIN_SYSTEM = [{ type: 'text', text: 'You are an interactive agent that helps users.' }];
const SUB_SYSTEM = [{ type: 'text', text: 'x-anthropic-billing-header: cc_is_subagent=true;' }];
const messages = (base: string, body: object): Promise<Response> =>
  fetch(`${base}/v1/messages?beta=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** The SSE stream as its parsed `data:` objects, in order. */
const events = async (r: Response): Promise<Array<Record<string, any>>> =>
  (await r.text()).split('\n\n').filter((b) => b.includes('data: ')).map((b) => JSON.parse(b.slice(b.indexOf('data: ') + 6)));

describe('mockapi.mjs (the rig\'s mock Anthropic API)', () => {
  it('answers the connectivity probe, and 404s an unknown route', async () => {
    const base = await startMock({ entries: [] });
    expect((await fetch(`${base}/api/hello`, { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(`${base}/v1/nope`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('streams a scripted tool_use as message_start … input_json_delta … message_stop, stop_reason tool_use', async () => {
    const input = { description: 'dlg', prompt: 'dlg-sub', isolation: 'worktree' };
    const base = await startMock({ entries: [{ label: 'call', match: { kind: 'tools', lastUser: '^dlg go$' }, tool_use: { name: 'Agent', input } }] });
    const r = await messages(base, { model: 'm', stream: true, system: MAIN_SYSTEM, tools: [{ name: 'Agent' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'dlg go' }] }] });
    const ev = await events(r);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['message_start', 'content_block_start', 'content_block_stop', 'message_delta', 'message_stop']));
    const start = ev.find((e) => e.type === 'content_block_start');
    expect(start?.content_block).toMatchObject({ type: 'tool_use', name: 'Agent' });
    const json = ev.filter((e) => e.delta?.type === 'input_json_delta').map((e) => e.delta.partial_json).join('');
    expect(JSON.parse(json)).toEqual(input);
    expect(ev.find((e) => e.type === 'message_delta')?.delta.stop_reason).toBe('tool_use');
  });

  it('nameAny picks the first name the request offers', async () => {
    const base = await startMock({ entries: [{ match: { kind: 'tools' }, tool_use: { nameAny: ['Agent', 'Task'], input: {} }, repeat: true }] });
    const ask = async (tools: string[]): Promise<string> => {
      const ev = await events(await messages(base, { model: 'm', stream: true, system: MAIN_SYSTEM,
        tools: tools.map((name) => ({ name })), messages: [{ role: 'user', content: 'x' }] }));
      return ev.find((e) => e.type === 'content_block_start')?.content_block.name;
    };
    expect(await ask(['Bash', 'Task'])).toBe('Task');
    expect(await ask(['Agent', 'Task'])).toBe('Agent');
  });

  it('matches a subagent request by its billing-header marker, and a tool_result by its text', async () => {
    const base = await startMock({ entries: [
      { label: 'sub', match: { kind: 'sub', lastUser: 'DLG-ACK-1' }, text: 'DLG-SUB-DONE' },
    ] });
    const ev = await events(await messages(base, { model: 'm', stream: true, system: SUB_SYSTEM, tools: [{ name: 'Bash' }],
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'DLG-ACK-1\n' }] }] }));
    expect(ev.filter((e) => e.delta?.type === 'text_delta').map((e) => e.delta.text).join('')).toBe('DLG-SUB-DONE');
  });

  it('reports consumed labels, and never consumes a repeat entry', async () => {
    const base = await startMock({ entries: [
      { label: 'once', match: { kind: 'tools', lastUser: '^a$' }, text: 'A' },
      { label: 'always', match: { kind: 'tools', lastUser: '^b$' }, text: 'B', repeat: true },
    ] });
    const ask = (t: string): Promise<Response> => messages(base, { model: 'm', stream: false, system: MAIN_SYSTEM, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: t }] });
    await (await ask('a')).text();
    await (await ask('b')).text();
    await (await ask('b')).text();
    const state = await (await fetch(`${base}/__rig/state`)).json() as { consumedLabels: string[]; requests: number };
    expect(state.consumedLabels).toEqual(['once']);
  });

  it('synthesises a side request\'s JSON from its schema', async () => {
    const base = await startMock({ entries: [] });
    const r = await messages(base, { model: 'm', stream: false, system: 'title', messages: [{ role: 'user', content: 'x' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { title: { type: 'string' } } } } } });
    const body = await r.json() as { content: Array<{ text: string }> };
    expect(JSON.parse(body.content[0]!.text)).toEqual({ title: 'Rig session' });
  });

  it('replaces a $NOW+<s> header value with an epoch second', async () => {
    const base = await startMock({ entries: [{ match: { kind: 'tools' }, status: 429, headers: { 'anthropic-ratelimit-unified-reset': '$NOW+60' } }] });
    const before = Math.floor(Date.now() / 1000);
    const r = await messages(base, { model: 'm', stream: true, system: MAIN_SYSTEM, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'x' }] });
    expect(r.status).toBe(429);
    const reset = Number(r.headers.get('anthropic-ratelimit-unified-reset'));
    expect(reset).toBeGreaterThanOrEqual(before + 59);
    expect(reset).toBeLessThanOrEqual(before + 62);
  });

  it('refuses to start without MOCK_SCRIPT, and writes no file when MOCK_LOG and MOCK_REQDIR are unset', () => {
    const r = spawnSync(process.execPath, [MOCK], { env: { ...process.env, MOCK_SCRIPT: '', MOCK_PORT: '0' }, encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(2);
    expect(fs.readdirSync(RIG).filter((n) => /\.log$|^reqs/.test(n))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them red.** `cd server && ./node_modules/.bin/vitest run test/delegation-rig.test.ts` — every row red
  (`mockapi.mjs` does not exist: the mock never prints its port, or `spawnSync` exits 1).

- [ ] **Step 3: Implement.** Create `server/test/delegation-rig/mockapi.mjs`:

```js
#!/usr/bin/env node
// mockapi.mjs — a scriptable mock of the Anthropic Messages API for the delegation broker's
// capture rig (wave 1, spec 2026-10-04 §8.2). No dependencies; 127.0.0.1 only. Ported from the
// scratch rig that drove Claude Code 2.1.280-2.1.283 through real Workflow calls.
//
// Env:
//   MOCK_SCRIPT  REQUIRED: path of the JSON script, re-read on EVERY request
//   MOCK_PORT    listen port; 0 binds an ephemeral one (default 0). Once bound, exactly one stdout
//                line is printed: `mock listening 127.0.0.1:<port>`
//   MOCK_LOG     optional: one line per request is appended here
//   MOCK_REQDIR  optional: each request body is dumped here as NNNN-<kind>.json
//
// Script shape: { "entries": [entry, ...], "default": entry, "sideDefault": entry } (or a bare
// array of entries). Any other top-level key (a scenario's "steps", "covers", ...) is ignored.
// An entry is consumed by the first request it MATCHES, in list order, unless "repeat": true.
// Request kinds: main = the interactive loop (system prompt carries MOCK_MAIN_MARKER, default
//   "You are an interactive agent"); sub = offered tools and stamped `cc_is_subagent=true`, or
//   offered tools without the main marker; side = offered NO tools.
//   "match": "main" | "sub" | "side" | "tools" (main or sub) | "any", or an object
//   { kind, model, system, lastUser, tool, hasToolResult } — regexes for model/system/lastUser;
//   lastUser is the last user message minus <system-reminder> blocks, a tool_result rendered as
//   `[tool_result <content>]`. A missing "match" means "main".
// Response (one of): { "text" } | { "tool_use": { "name" | "nameAny": [...], "input", "id"? } }
//   | { "blocks": [ {thinking}|{text}|{tool_use} ] } | { "status": 4xx|5xx, "headers"?, "body"? }
//   plus optional "label", "hang_ms" (N<0 never answers), "headers", "usage", "stop_reason",
//   "chunk_ms", "stall_ms", "repeat". `nameAny` picks the first name the request offers (else the
//   first listed). A header VALUE of the form `$NOW+<s>` is sent as the epoch second <s> from now.
// Fallbacks: "default" for main and sub (else text "(mock default reply)"); "sideDefault" for side
//   (else JSON synthesised from the request's json_schema, or "Rig session").
// Control: GET /__rig/state -> { script, entries, consumed, consumedLabels, requests };
//   POST /__rig/reset forgets consumption (as does any change to the script's content).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCRIPT = process.env.MOCK_SCRIPT || '';
if (SCRIPT === '') { process.stderr.write('mockapi: MOCK_SCRIPT is required\n'); process.exit(2); }
const PORT = Number(process.env.MOCK_PORT || 0);
const LOG = process.env.MOCK_LOG || '';
const REQDIR = process.env.MOCK_REQDIR || '';
if (REQDIR !== '') fs.mkdirSync(REQDIR, { recursive: true });

let scriptHash = null;
let consumed = new Set();
const consumedLabels = [];
let seq = 0;
let toolSeq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => { if (LOG !== '') fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); };

function loadScript() {
  let raw = '[]';
  try { raw = fs.readFileSync(SCRIPT, 'utf8'); } catch { /* absent = empty */ }
  const h = crypto.createHash('sha1').update(raw).digest('hex');
  if (h !== scriptHash) { scriptHash = h; consumed = new Set(); consumedLabels.length = 0; log(`SCRIPT reloaded sha1=${h.slice(0, 10)}`); }
  let j;
  try { j = JSON.parse(raw); } catch (e) { log(`SCRIPT parse error: ${e.message}`); j = []; }
  if (Array.isArray(j)) j = { entries: j };
  return { entries: j.entries || [], def: j.default, sideDef: j.sideDefault };
}

function systemText(body) {
  const s = body.system;
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.map((b) => (typeof b === 'string' ? b : b.text || '')).join('\n');
}
function lastUser(body) {
  const ms = body.messages || [];
  for (let i = ms.length - 1; i >= 0; i -= 1) if (ms[i].role === 'user') return ms[i];
  return null;
}
function resultText(c) {
  if (typeof c === 'string') return c;
  return (c || []).map((x) => x.text || `[${x.type}]`).join(' ');
}
/** The typed prompt: the last user message's text blocks that are not <system-reminder> injections. */
function userPrompt(body) {
  const lu = lastUser(body);
  if (!lu) return '';
  if (typeof lu.content === 'string') return lu.content;
  const parts = [];
  for (const b of lu.content || []) {
    if (b.type === 'text' && !/^\s*<system-reminder>/.test(b.text)) parts.push(b.text);
    else if (b.type === 'tool_result') parts.push(`[tool_result ${resultText(b.content)}]`);
  }
  return parts.join(' ');
}
const MAIN_MARKER = new RegExp(process.env.MOCK_MAIN_MARKER || 'You are an interactive agent');
function classify(body) {
  const tools = (body.tools || []).map((t) => t.name);
  const sys = systemText(body);
  const kind = tools.length === 0 ? 'side' : /cc_is_subagent=true/.test(sys) ? 'sub' : MAIN_MARKER.test(sys) ? 'main' : 'sub';
  return { kind, tools, sys };
}
function schemaOf(body) {
  const oc = body.output_config?.format || body.output_format;
  return oc && oc.type === 'json_schema' ? oc.schema : null;
}
function synth(schema) {
  if (!schema) return null;
  switch (schema.type) {
    case 'object': { const o = {}; for (const [k, v] of Object.entries(schema.properties || {})) o[k] = synth(v); return o; }
    case 'array': return [];
    case 'number': case 'integer': return 0;
    case 'boolean': return false;
    case 'string': return schema.enum ? schema.enum[0] : 'Rig session';
    default: return schema.enum ? schema.enum[0] : null;
  }
}
function matches(entry, req) {
  let m = entry.match ?? 'main';
  if (typeof m === 'string') m = { kind: m };
  const kind = m.kind ?? 'main';
  if (kind !== 'any' && kind !== req.kind && !(kind === 'tools' && req.kind !== 'side')) return false;
  if (m.model && !new RegExp(m.model).test(req.body.model || '')) return false;
  if (m.system && !new RegExp(m.system).test(req.sys)) return false;
  if (m.lastUser && !new RegExp(m.lastUser).test(userPrompt(req.body))) return false;
  if (m.tool && !req.tools.includes(m.tool)) return false;
  if (m.hasToolResult !== undefined) {
    const lu = lastUser(req.body);
    const has = !!(lu && Array.isArray(lu.content) && lu.content.some((b) => b.type === 'tool_result'));
    if (has !== m.hasToolResult) return false;
  }
  return true;
}
function pick(req) {
  const { entries, def, sideDef } = loadScript();
  for (let i = 0; i < entries.length; i += 1) {
    if (consumed.has(i)) continue;
    if (matches(entries[i], req)) {
      if (!entries[i].repeat) { consumed.add(i); if (typeof entries[i].label === 'string') consumedLabels.push(entries[i].label); }
      return { entry: entries[i], label: `entry#${i}` };
    }
  }
  if (req.kind !== 'side') return { entry: def ?? { text: '(mock default reply)' }, label: 'default' };
  if (sideDef) return { entry: sideDef, label: 'sideDefault' };
  const sch = schemaOf(req.body);
  return { entry: { text: sch ? JSON.stringify(synth(sch)) : 'Rig session' }, label: 'sideDefault(synth)' };
}
function blocksOf(entry) {
  if (entry.blocks) return entry.blocks;
  const b = [];
  if (entry.thinking) b.push({ thinking: entry.thinking });
  if (entry.text !== undefined) b.push({ text: entry.text });
  if (entry.tool_use) b.push({ tool_use: entry.tool_use });
  return b.length ? b : [{ text: '' }];
}
function toolName(tu, offered) {
  if (Array.isArray(tu.nameAny)) return tu.nameAny.find((n) => offered.includes(n)) ?? tu.nameAny[0];
  return tu.name;
}
function contentBlocks(entry, offered) {
  return blocksOf(entry).map((b) => {
    if (b.tool_use) {
      toolSeq += 1;
      return { type: 'tool_use', id: b.tool_use.id || `toolu_rig${String(toolSeq).padStart(6, '0')}`, name: toolName(b.tool_use, offered), input: b.tool_use.input || {} };
    }
    if (b.thinking !== undefined) return { type: 'thinking', thinking: b.thinking, signature: 'rigsig' };
    return { type: 'text', text: b.text ?? '' };
  });
}
/** Headers with `$NOW+<s>` values resolved to epoch seconds. */
function resolveHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    const m = typeof v === 'string' ? /^\$NOW\+(\d+)$/.exec(v) : null;
    out[k] = m ? String(Math.floor(Date.now() / 1000) + Number(m[1])) : v;
  }
  return out;
}
function chunks(s, n = 12) { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out.length ? out : ['']; }

async function answer(res, req, entry) {
  if (entry.hang_ms !== undefined) {
    if (entry.hang_ms < 0) { log(`  #${req.n} hanging forever`); return; }
    await sleep(entry.hang_ms);
  }
  const extra = resolveHeaders(entry.headers);
  if (entry.status && entry.status >= 400) {
    const type = { 401: 'authentication_error', 429: 'rate_limit_error', 529: 'overloaded_error', 500: 'api_error' }[entry.status] || 'api_error';
    res.writeHead(entry.status, { 'content-type': 'application/json', 'request-id': `req_rig${req.n}`, ...extra });
    res.end(JSON.stringify(entry.body ?? { type: 'error', error: { type, message: `mock ${entry.status}` } }));
    return;
  }
  const model = req.body.model || 'claude-mock';
  const blocks = contentBlocks(entry, req.tools);
  const stop = entry.stop_reason || (blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn');
  const usage = { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...(entry.usage || {}) };
  const outTokens = Math.max(1, JSON.stringify(blocks).length >> 2);
  const hdrs = { 'request-id': `req_rig${req.n}`, 'anthropic-organization-id': '00000000-0000-0000-0000-000000000000', ...extra };
  const id = `msg_rig${req.n}`;
  if (!req.body.stream) {
    res.writeHead(200, { 'content-type': 'application/json', ...hdrs });
    res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model, content: blocks, stop_reason: stop, stop_sequence: null, usage: { ...usage, output_tokens: outTokens } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...hdrs });
  const ev = (type, data) => { if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`); };
  const gap = entry.chunk_ms ?? 15;
  let first = true;
  const afterDelta = async () => {
    if (first && entry.stall_ms !== undefined) { first = false; if (entry.stall_ms < 0) await new Promise(() => {}); await sleep(entry.stall_ms); }
    first = false;
    if (gap) await sleep(gap);
  };
  ev('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } });
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b.type === 'text') {
      ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      for (const c of chunks(b.text)) { ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: c } }); await afterDelta(); }
    } else if (b.type === 'thinking') {
      ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
      for (const c of chunks(b.thinking)) { ev('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: c } }); await afterDelta(); }
      ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: 'rigsig' } });
    } else {
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      for (const c of chunks(JSON.stringify(b.input), 20)) { ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: c } }); await afterDelta(); }
    }
    ev('content_block_stop', { index: i });
  }
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: outTokens } });
  ev('message_stop', {});
  res.end();
}

const server = http.createServer((rq, res) => {
  const chunksIn = [];
  rq.on('data', (c) => chunksIn.push(c));
  rq.on('end', async () => {
    seq += 1;
    const n = seq;
    const raw = Buffer.concat(chunksIn).toString('utf8');
    const url = new URL(rq.url, 'http://x');
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-json */ }
    try {
      if (url.pathname === '/__rig/reset') { consumed = new Set(); consumedLabels.length = 0; res.end('ok\n'); return; }
      if (url.pathname === '/__rig/state') {
        const s = loadScript();
        res.setHeader('content-type', 'application/json');
        res.end(`${JSON.stringify({ script: path.basename(SCRIPT), entries: s.entries.length, consumed: [...consumed], consumedLabels, requests: seq - 1 })}\n`);
        return;
      }
      if (rq.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: Math.max(1, raw.length >> 2) }));
        return;
      }
      if (rq.method === 'POST' && url.pathname === '/v1/messages') {
        const { kind, tools, sys } = classify(body);
        const req = { n, body, kind, tools, sys };
        const { entry, label } = pick(req);
        log(`#${n} MESSAGES kind=${kind} tools=${tools.length} -> ${label}${entry.label ? ` (${entry.label})` : ''} prompt="${userPrompt(body).replace(/\s+/g, ' ').slice(0, 100)}"`);
        if (REQDIR !== '') fs.writeFileSync(path.join(REQDIR, `${String(n).padStart(4, '0')}-${kind}.json`), JSON.stringify({ n, url: rq.url, kind, picked: label, body }, null, 1));
        await answer(res, req, entry);
        return;
      }
      if (url.pathname === '/api/hello') { res.writeHead(200); res.end(); return; }
      log(`#${n} UNHANDLED ${rq.method} ${rq.url} -> 404`);
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `mock: no route ${rq.method} ${url.pathname}` } }));
    } catch (e) {
      log(`#${n} MOCK ERROR ${e.stack}`);
      try { res.writeHead(500); res.end(); } catch { /* already streaming */ }
    }
  });
});
server.on('error', (e) => { process.stderr.write(`mockapi: ${e.message}\n`); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => { process.stdout.write(`mock listening 127.0.0.1:${server.address().port}\n`); });
```

- [ ] **Step 4: Run green.** `cd server && ./node_modules/.bin/vitest run test/delegation-rig.test.ts` — the eight mock rows green.

- [ ] **Step 5: Mutations.**

| # | Mutation | Expected red |
|---|---|---|
| T3-M1 | `toolName` ignores `nameAny` (returns `tu.name`) | "nameAny picks the first name the request offers" |
| T3-M2 | `consumedLabels.push` deleted | "reports consumed labels …" |
| T3-M3 | `resolveHeaders` returns `h` unchanged | "replaces a $NOW+<s> header value …" |
| T3-M4 | the `MOCK_SCRIPT` refusal deleted | "refuses to start without MOCK_SCRIPT …" |

- [ ] **Step 6: Commit.**

```bash
git add server/test/delegation-rig/mockapi.mjs server/test/delegation-rig.test.ts
git commit -m "test(rig): the mock Anthropic API for the delegation capture rig (delegation broker w1)"
```

---

### Task 4: the rig driver and its fourteen scenarios

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `server/test/delegation-rig/rig.sh`
- Create: `server/test/delegation-rig/scenarios/` — the fourteen files listed in Step 3
- Create: `server/test/delegation-rig/README.md`
- Modify: `server/test/delegation-rig.test.ts` (append the guard and setup rows)

**Interfaces:**
- Consumes: Task 1 (the hook and installer in the tree, copied into the fixture HOME), Task 3 (the mock).
- Produces: `bash server/test/delegation-rig/rig.sh run <version> <scenario.json> <out-dir>` leaves a RAW bundle in
  `<out-dir>` (never inside the source tree): `root` (two lines: the run root and its physical path), `version`,
  `versions-dir`, `scenario`, `caps/*.cap`, `snapshots/<name>/{admin-records,worktrees}`,
  `admin/<record>/{files,gitdir,HEAD,CLAUDE_BASE,locked,first-log-sha}` (present files only), `worktrees-left`,
  `worktree-list`, `branches`, `meta/<cfg>/<project>/<uuid>/subagents/**.meta.json`, `labels` (a JSON array) and
  `notes` (one line per step that did not go as scripted). `rig.sh all <raw-root>` runs every installed version ×
  every scenario into `<raw-root>/<version>/<scenario>/` and then writes `<raw-root>/.done`; `rig.sh reap` removes what
a killed run left; `rig.sh check-scenario <file>` validates a scenario. The fixture HOME is `<root>/fixhome` (never a
directory named `home`, so no clean path ever contains `/home/`). Task 5 reads exactly these names.

- [ ] **Step 1: Write the failing tests.** Append to `server/test/delegation-rig.test.ts`:

```ts
const RIGSH = path.join(RIG, 'rig.sh');
const TREE = path.resolve(__dirname, '../..');
const rigsh = (args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync('bash', [RIGSH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('rig.sh guards (the rig never names the real HOME or the default tmux server)', () => {
  it('guard-root accepts only an absolute, canonical ccrc-dlg-rig.* path outside $HOME', () => {
    const home = mkTmp('ccrc-dlg-home-');
    expect(rigsh(['guard-root', '/tmp/ccrc-dlg-rig.Ab12'], { HOME: home }).status).toBe(0);
    for (const bad of ['ccrc-dlg-rig.rel', '/tmp/other', `${home}/ccrc-dlg-rig.x`, '/tmp/ccrc-dlg-rig.x/../y',
      '/tmp//ccrc-dlg-rig.x', '/tmp/./ccrc-dlg-rig.x', '/tmp/ccrc-dlg-rig.x/', '/']) {
      expect(rigsh(['guard-root', bad], { HOME: home }).status, bad).not.toBe(0);
    }
    expect(rigsh(['guard-root', `${home}/ccrc-dlg-rig.x`], { HOME: `${home}/` }).status, 'a HOME with a trailing slash').not.toBe(0);
  });

  it('guard-sock accepts only ^dlg[A-Za-z0-9_-]*$', () => {
    expect(rigsh(['guard-sock', 'dlg123']).status).toBe(0);
    for (const bad of ['default', '', 'dlg/x', 'xdlg', 'dlg x']) expect(rigsh(['guard-sock', bad]).status, bad).not.toBe(0);
  });

  it('setup refuses a root the guard refuses, and creates nothing there', () => {
    const home = mkTmp('ccrc-dlg-home-');
    const r = rigsh(['setup', path.join(home, 'ccrc-dlg-rig.inside')], { HOME: home });
    expect(r.status).toBe(2);
    expect(fs.existsSync(path.join(home, 'ccrc-dlg-rig.inside'))).toBe(false);
  });

  it('check-scenario refuses a non-integer wait, a tmux separator among keys, and an unknown verb', () => {
    const dir = mkTmp('ccrc-dlg-sc-');
    const write = (name: string, steps: object[]): string => {
      const f = path.join(dir, `${name}.json`);
      fs.writeFileSync(f, JSON.stringify({ steps, entries: [] }));
      return f;
    };
    expect(rigsh(['check-scenario', write('ok', [{ waitReady: 60 }, { keys: ['Enter'] }, { probeLabels: ['a-1'], timeoutS: 9 }, { snapshot: 'before-kill' }])]).status).toBe(0);
    expect(rigsh(['check-scenario', write('arith', [{ waitReady: 'SECONDS[$(touch x)]' }])], { PWD: dir }).status).toBe(2);
    expect(rigsh(['check-scenario', write('chain', [{ keys: ['Enter', ';', 'run-shell'] }])]).status).toBe(2);
    expect(rigsh(['check-scenario', write('verb', [{ bogus: 1 }])]).status).toBe(2);
  });

  it('no line of rig.sh calls tmux except through the private-socket helper', () => {
    const lines = fs.readFileSync(RIGSH, 'utf8').split('\n').filter((l) => /\btmux\b(?!-)/.test(l) && !/^\s*#/.test(l));
    const ok = (l: string): boolean => l.includes('tmux -L "$s" -f /dev/null') || l.includes('for c in jq tmux git');
    expect(lines.filter((l) => !ok(l))).toEqual([]);
  });

  it('reap removes a run root whose owner is gone and keeps one whose owner lives', () => {
    const tmp = mkTmp('ccrc-dlg-tmp-');
    const dead = fs.mkdtempSync(path.join(tmp, 'ccrc-dlg-rig.'));
    const live = fs.mkdtempSync(path.join(tmp, 'ccrc-dlg-rig.'));
    fs.writeFileSync(path.join(dead, '.owner'), `${spawnSync('true').pid}\n`);   // a finished child's pid
    fs.writeFileSync(path.join(live, '.owner'), `${process.pid}\n`);
    const r = rigsh(['reap'], { TMPDIR: tmp, TMUX_TMPDIR: mkTmp('ccrc-dlg-tmux-'), HOME: mkTmp('ccrc-dlg-home-') });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(dead)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
  });
});

describe('rig.sh setup (fixture HOME and repo)', () => {
  it('builds the fixture HOME and repo under its root, with ccrc\'s own hook registered by ccrc\'s own installer', () => {
    const home = mkTmp('ccrc-dlg-home-');
    const root = mkTmp('ccrc-dlg-rig.');
    const r = rigsh(['setup', root, '2.1.999'], { HOME: home });
    expect(r.status, r.stderr).toBe(0);
    const s = JSON.parse(fs.readFileSync(path.join(root, 'fixhome/cfg/settings.json'), 'utf8'));
    for (const ev of ['PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'SessionStart', 'SessionEnd', 'Stop']) {
      expect(JSON.stringify(s.hooks[ev] ?? []), ev).toContain('/session-hook.sh');
    }
    expect(s.hooks.WorktreeCreate).toBeUndefined();
    expect(s.hooks.WorktreeRemove).toBeUndefined();
    expect(s).toMatchObject({ enableWorkflows: true, worktree: { baseRef: 'head' } });
    expect(s.permissions.allow).toEqual(expect.arrayContaining(['Bash', 'Agent', 'Workflow']));
    expect(fs.readFileSync(path.join(root, 'fixhome/.cc-sessions/session-hook.sh')))
      .toEqual(fs.readFileSync(path.join(TREE, 'ccd/session-hook.sh')));
    expect(fs.readFileSync(path.join(root, 'fixhome/.cc-sessions/rig-hookcap.generation'), 'utf8'))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(fs.statSync(path.join(root, 'key')).mode & 0o777).toBe(0o600);
    const log = spawnSync('git', ['-C', path.join(root, 'repo'), 'log', '--format=%an <%ae>'], { encoding: 'utf8' });
    expect(log.stdout.trim()).toBe('Rig Fixture <you@example.com>');
    const cj = JSON.parse(fs.readFileSync(path.join(root, 'fixhome/cfg/.claude.json'), 'utf8'));
    expect(cj.projects[path.join(root, 'repo')]).toMatchObject({ hasTrustDialogAccepted: true });
    expect(cj.lastReleaseNotesSeen).toBe('2.1.999');
  });

  it('setup writes only under its root: the HOME it ran with is left empty', () => {
    const home = mkTmp('ccrc-dlg-home-');
    const root = mkTmp('ccrc-dlg-rig.');
    expect(rigsh(['setup', root], { HOME: home }).status).toBe(0);
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('every scenario passes check-scenario, names itself, and its waits and probes name its labels', () => {
    const dir = path.join(RIG, 'scenarios');
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    expect(files).toHaveLength(14);
    for (const f of files) {
      expect(rigsh(['check-scenario', path.join(dir, f)]).status, f).toBe(0);
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { scenario: string; covers: string[]; steps: Array<Record<string, unknown>>; entries: Array<{ label?: string }> };
      expect(s.scenario, f).toBe(f.replace(/\.json$/, ''));
      expect(s.covers.length, f).toBeGreaterThan(0);
      const labels = new Set(s.entries.map((e) => e.label).filter(Boolean));
      for (const st of s.steps) {
        const verb = Object.keys(st)[0] as string;
        if (verb === 'waitLabels' || verb === 'probeLabels') for (const l of st[verb] as string[]) expect(labels.has(l), `${f}: ${l}`).toBe(true);
      }
      expect(JSON.stringify(s), f).not.toMatch(/WorktreeCreate|WorktreeRemove|dangerously/);
    }
  });
});
```

- [ ] **Step 2: Run them red.** `cd server && ./node_modules/.bin/vitest run test/delegation-rig.test.ts` — the ten new
  rows red (`rig.sh` and `scenarios/` do not exist); the mock rows stay green.

- [ ] **Step 3: Implement.** Create `server/test/delegation-rig/rig.sh`:

```bash
#!/usr/bin/env bash
# rig.sh — the delegation broker's capture rig (wave 1; spec 2026-10-04 §8.1-§8.2).
#
# Runs an INSTALLED Claude Code binary against mockapi.mjs inside a PRIVATE tmux server and a
# FIXTURE HOME, with ccrc's own session-hook.sh registered by ccrc's own installer, in a tmux
# session named cc-rig-hookcap — so the hook's -hookcap capture arm records every payload. The
# real HOME is read for ONE thing, the binary's directory; nothing is written outside the run root.
#
#   rig.sh guard-root <path>         exit 0 iff <path> may be a run root: absolute, canonical
#                                    spelling, basename ccrc-dlg-rig.*, not $HOME and not under it
#   rig.sh guard-sock <name>         exit 0 iff <name> matches ^dlg[A-Za-z0-9_-]*$
#   rig.sh check-scenario <file>     exit 0 iff every step is well formed (verbs, integers, key names)
#   rig.sh setup <root> [<version>]  fixture HOME <root>/fixhome (config <root>/fixhome/cfg), repo <root>/repo
#   rig.sh run <version> <scenario.json> <out-dir>   one run; a raw bundle lands in <out-dir>
#   rig.sh all <raw-root>            reap, then every installed version x every scenario -> <raw-root>/<v>/<s>/,
#                                    then <raw-root>/.done
#   rig.sh reap                      remove what killed runs left: dlg<pid> tmux servers and
#                                    ccrc-dlg-rig.* roots whose owning rig.sh pid is gone
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TREE=$(cd "$HERE/../../.." && pwd)
REAL_HOME=$HOME
VERSIONS=$REAL_HOME/.local/share/claude/versions
SOCK_RE='^dlg[A-Za-z0-9_-]*$'
SESSION=cc-rig-hookcap
VERBS='waitReady type keys waitLabels probeLabels answerDialog sleep kill9 swapConfig relaunch snapshot'
RUN_CAP_S=1200

die() { printf 'rig: %s\n' "$*" >&2; exit 2; }
guard_root() {
  local r=${1-} b h x
  [[ $r == /* && $r != */ && $r != *//* ]] || return 1
  [[ /$r/ != */./* && /$r/ != */../* ]] || return 1
  b=${r##*/}
  [[ $b == ccrc-dlg-rig.?* ]] || return 1
  h=$(cd -P -- "$REAL_HOME" 2>/dev/null && pwd) || h=""
  for x in "${REAL_HOME%/}" "${h%/}"; do
    [[ -n $x ]] || return 1
    [[ $r != "$x" && $r != "$x"/* ]] || return 1
  done
  return 0
}
guard_sock() { [[ ${1-} =~ $SOCK_RE ]]; }
guard_out() {   # an output directory must not sit inside the source tree (raw bundles are never git-add-able)
  local o=${1-} p
  [[ -n $o ]] || return 1
  mkdir -p -- "$o" || return 1
  p=$(cd -P -- "$o" && pwd) || return 1
  [[ $p != "$TREE" && $p != "$TREE"/* ]]
}
# THE ONLY tmux CALL IN THIS FILE: a private server, no config file, socket name guarded.
T() { local s=$1; shift; guard_sock "$s" || die "refusing tmux socket '$s'"; tmux -L "$s" -f /dev/null "$@"; }
rig_uuid() { local u; u=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen); printf '%s' "$u" | tr 'A-Z' 'a-z'; }
# A key-SHAPED placeholder, built at run time, written 0600 under the run root, never into the tree
# and never onto a command line; the mock ignores it.
rig_key() { printf 'sk-ant-api03-%sAA' "$(printf 'r%.0s' $(seq 93))"; }
rig_path() {
  local c d out=""
  for c in jq tmux git timeout gtimeout node curl; do
    d=$(command -v "$c" 2>/dev/null) || continue
    d=${d%/*}
    [[ ":$out:" == *":$d:"* ]] || out=${out:+$out:}$d
  done
  printf '%s:/usr/bin:/bin' "$out"
}
# Scenario steps are DATA that reaches bash arithmetic and tmux argv, so each is checked first:
# a known verb, integers where a number is due, tmux key NAMES only (no `;`, no command text).
check_scenario() {
  local f=${1-} step verb n k
  [[ -f $f ]] || return 1
  jq -e '(.steps | type) == "array" and (.entries | type) == "array"' "$f" >/dev/null 2>&1 || return 1
  while IFS= read -r step; do
    verb=$(jq -r 'keys_unsorted[0]' <<<"$step")
    [[ " $VERBS " == *" $verb "* ]] || return 1
    for n in waitReady sleep timeoutS; do
      k=$(jq -r --arg n "$n" 'if has($n) then .[$n] | tostring else "" end' <<<"$step")
      [[ -z $k || $k =~ ^[0-9]{1,5}$ ]] || return 1
    done
    if [[ $verb == keys ]]; then
      jq -e '(.keys | type) == "array" and (.keys | length) > 0 and all(.keys[]; type == "string" and test("^[A-Za-z][A-Za-z0-9-]{0,15}$"))' <<<"$step" >/dev/null || return 1
    fi
    if [[ $verb == waitLabels || $verb == probeLabels ]]; then
      jq -e --arg v "$verb" '(.[$v] | type) == "array" and all(.[$v][]; type == "string" and test("^[a-z0-9-]{1,40}$"))' <<<"$step" >/dev/null || return 1
    fi
    if [[ $verb == snapshot ]]; then jq -e '.snapshot | type == "string" and test("^[a-z0-9-]{1,40}$")' <<<"$step" >/dev/null || return 1; fi
  done < <(jq -c '.steps[]' "$f")
  k=$(jq -r '.settleS // 8 | tostring' "$f"); [[ $k =~ ^[0-9]{1,5}$ ]] || return 1
  return 0
}

g() { local R=$1; shift; HOME=$R/fixhome GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git -c core.hooksPath=/dev/null -C "$R/repo" "$@"; }
cmd_setup() {
  local R=${1-} V=${2:-0.0.0} H
  guard_root "$R" || die "refusing root '$R': it must be absolute, canonical, named ccrc-dlg-rig.*, and outside \$HOME"
  H=$R/fixhome
  mkdir -p "$H/cfg" "$H/.cc-sessions" "$H/.ccrc" "$R/repo" "$R/tmp"
  if [[ ! -d $R/repo/.git ]]; then
    g "$R" init -q -b main
    g "$R" config user.name 'Rig Fixture'
    g "$R" config user.email 'you@example.com'
    g "$R" config commit.gpgsign false
    printf '# rig fixture repo\n' > "$R/repo/README.md"
    g "$R" add README.md
    GIT_AUTHOR_DATE=2026-01-01T00:00:00Z GIT_COMMITTER_DATE=2026-01-01T00:00:00Z g "$R" commit -q -m 'fixture: initial commit'
  fi
  cp "$TREE/ccd/session-hook.sh" "$H/.cc-sessions/session-hook.sh"
  rig_uuid > "$H/.cc-sessions/rig-hookcap.generation"
  ( umask 077; rig_key > "$R/key" )
  # Tools are GRANTED, never bypassed: no permission-bypass flag anywhere in this rig.
  jq -n '{env: {DISABLE_AUTOUPDATER: "1"}, enableWorkflows: true, worktree: {baseRef: "head"},
          permissions: {allow: ["Bash", "Read", "Write", "Edit", "Agent", "Task", "Workflow"]}}' > "$H/cfg/settings.json"
  HOME=$H bash "$TREE/ccd/install-session-hooks.sh" --homes "$H/cfg" >/dev/null
  jq -n --arg tail "$(tail -c 20 "$R/key")" --arg repo "$R/repo" --arg v "$V" '{
      numStartups: 5, hasCompletedOnboarding: true, firstStartTime: "2026-01-01T00:00:00.000Z",
      lastOnboardingVersion: $v, lastReleaseNotesSeen: $v, lastClawdEntranceVersion: $v,
      fullscreenUpsellSeenCount: 3, officialMarketplaceAutoInstallAttempted: true,
      customApiKeyResponses: {approved: [$tail], rejected: []},
      projects: {($repo): {hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true,
                           projectOnboardingSeenCount: 5, allowedTools: []}}}' > "$H/cfg/.claude.json"
}

# ── run ─────────────────────────────────────────────────────────────────────────────
VER="" SCEN="" RUN_R="" RUN_H="" SOCK="" CFG="" PORT="" MOCK_PID="" OUT_DIR="" COLLECTED=0
note() { printf '%s\n' "$*" >> "$RUN_R/notes"; }
pane() { T "$SOCK" capture-pane -p -t "$SESSION" 2>/dev/null || true; }
wait_text() {
  local text=$1 end=$(( $(date +%s) + $2 ))
  while (( $(date +%s) <= end )); do pane | grep -qF -- "$text" && return 0; sleep 0.25; done
  return 1
}
wait_labels() {
  local want=$1 end=$(( $(date +%s) + $2 ))
  while (( $(date +%s) <= end )); do
    curl -fsS "http://127.0.0.1:$PORT/__rig/state" 2>/dev/null \
      | jq -e --argjson w "$want" '($w - .consumedLabels) == []' >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}
# The session to resume: the payload session_id of the newest MAIN-thread capture (no agent_id) —
# whether a subagent's events carry the parent's id is one of the questions being measured.
current_sid() {
  local f
  while IFS= read -r f; do
    sed -n 2p "$f" | jq -er 'select(((.agent_id // "") | tostring) == "") | .session_id // empty' 2>/dev/null && return 0
  done < <(ls -1 "$RUN_H/.ccrc/hook-capture/rig-hookcap"/*.cap 2>/dev/null \
           | awk -F/ '{n=$NF; split(n, p, "-"); print p[2] "\t" $0}' | sort -rn | cut -f2)
  return 1
}
# The Claude Code process of the pane: the pane's process when it is the binary, else its child
# that is (the launch line runs the binary under `timeout`). Linux identifies by /proc/<pid>/exe.
claude_pid() {
  local p dead c exe
  read -r dead p < <(T "$SOCK" display-message -p -t "$SESSION" '#{pane_dead} #{pane_pid}') || return 1
  [[ $dead == 0 && $p =~ ^[0-9]+$ ]] || return 1
  for c in "$p" $(pgrep -P "$p" 2>/dev/null); do
    exe=$(readlink "/proc/$c/exe" 2>/dev/null) || exe=""
    if [[ -z $exe && ! -d /proc ]]; then [[ $c != "$p" ]] && { printf '%s' "$c"; return 0; }; continue; fi
    [[ $exe == "$VERSIONS"/* ]] && { printf '%s' "$c"; return 0; }
  done
  return 1
}
launch_cmd() {   # [claude args...] -> one shell command line for the pane (run by `bash -c`)
  local bin=$VERSIONS/$VER gen args="" a to=""
  [[ -x $bin ]] || die "no Claude Code binary '$VER' under $VERSIONS"
  gen=$(cat "$RUN_H/.cc-sessions/rig-hookcap.generation")
  for a in "$@"; do args+=" $(printf '%q' "$a")"; done
  if command -v timeout >/dev/null 2>&1; then to="timeout -k 10 $RUN_CAP_S "; elif command -v gtimeout >/dev/null 2>&1; then to="gtimeout -k 10 $RUN_CAP_S "; fi
  # TMUX/TMUX_PANE are expanded by the PANE's bash: inside this private server they name the
  # private socket, so the hook's own display-message asks the rig, never the default server.
  # The key is read from its 0600 file by that bash, so it never appears on a command line.
  printf 'cd %q && exec env -i PATH=%q TERM=tmux-256color LANG=C.UTF-8 LC_ALL=C.UTF-8 HOME=%q TMPDIR=%q CLAUDE_CONFIG_DIR=%q ANTHROPIC_API_KEY="$(cat %q)" ANTHROPIC_BASE_URL=http://127.0.0.1:%s DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_NO_FLICKER=0 CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 CCRC_SESSION_GENERATION=%q TMUX="$TMUX" TMUX_PANE="$TMUX_PANE" %s%q%s' \
    "$RUN_R/repo" "$(rig_path)" "$RUN_H" "$RUN_R/tmp" "$CFG" "$RUN_R/key" "$PORT" "$gen" "$to" "$bin" "$args"
}
snapshot() {   # <name>: the admin records and the .claude/worktrees entries, at this instant
  local d=$RUN_R/snapshots/$1
  mkdir -p "$d"
  { ls -A "$RUN_R/repo/.git/worktrees" 2>/dev/null || true; } > "$d/admin-records"
  { ls -A "$RUN_R/repo/.claude/worktrees" 2>/dev/null || true; } > "$d/worktrees"
}
run_steps() {
  local step verb sid pid
  while IFS= read -r step; do
    verb=$(jq -r 'keys_unsorted[0]' <<<"$step")
    case $verb in
      waitReady)    wait_text '? for shortcuts' "$(jq -r .waitReady <<<"$step")" || note "waitReady: no ready prompt" ;;
      type)         T "$SOCK" send-keys -t "$SESSION" -l -- "$(jq -r .type <<<"$step")" ;;
      keys)         mapfile -t ks < <(jq -r '.keys[]' <<<"$step"); T "$SOCK" send-keys -t "$SESSION" "${ks[@]}" ;;
      waitLabels)   wait_labels "$(jq -c .waitLabels <<<"$step")" "$(jq -r '.timeoutS // 120' <<<"$step")" \
                      || note "waitLabels $(jq -c .waitLabels <<<"$step"): timeout" ;;
      probeLabels)  wait_labels "$(jq -c .probeLabels <<<"$step")" "$(jq -r '.timeoutS // 120' <<<"$step")" \
                      || note "probe $(jq -c .probeLabels <<<"$step"): not reached" ;;
      answerDialog) if wait_text "$(jq -r .answerDialog <<<"$step")" "$(jq -r '.timeoutS // 10' <<<"$step")"; then
                      T "$SOCK" send-keys -t "$SESSION" Enter; note "dialog answered: $(jq -r .answerDialog <<<"$step")"
                    fi ;;
      sleep)        sleep "$(jq -r .sleep <<<"$step")" ;;
      kill9)        if pid=$(claude_pid); then kill -9 "$pid"; else note "kill9: no pid"; fi ;;
      swapConfig)   mkdir -p "$RUN_H/cfg2"; cp -a "$RUN_H/cfg/." "$RUN_H/cfg2/"; CFG=$RUN_H/cfg2 ;;
      relaunch)     if sid=$(current_sid) && [[ -n $sid ]]; then
                      T "$SOCK" respawn-pane -k -t "$SESSION" bash -c "$(launch_cmd --resume "$sid")"
                    else note "relaunch: no session id captured"; fi ;;
      snapshot)     snapshot "$(jq -r .snapshot <<<"$step")" ;;
      *)            note "unknown step verb $verb" ;;
    esac
  done < <(jq -c '.steps[]' "$SCEN")
}
collect() {
  local O=$1 a n f c m
  COLLECTED=1
  mkdir -p "$O/caps" "$O/admin" "$O/meta" "$O/snapshots"
  printf '%s\n%s\n' "$RUN_R" "$(cd -P "$RUN_R" && pwd)" > "$O/root"
  printf '%s\n' "$VER" > "$O/version"
  printf '%s\n' "$VERSIONS" > "$O/versions-dir"
  basename "$SCEN" .json > "$O/scenario"
  cp "$RUN_H"/.ccrc/hook-capture/rig-hookcap/*.cap "$O/caps/" 2>/dev/null || true
  for a in "$RUN_R"/repo/.git/worktrees/*/; do
    [[ -d $a ]] || continue
    n=$(basename "$a"); mkdir -p "$O/admin/$n"
    ls -A "$a" > "$O/admin/$n/files"
    for f in gitdir HEAD CLAUDE_BASE locked; do [[ -f $a/$f ]] && cp "$a/$f" "$O/admin/$n/$f"; done
    # The first reflog line names the creator (`Rig Fixture <you@example.com>`); keep its NEW sha only.
    [[ -f $a/logs/HEAD ]] && head -n 1 "$a/logs/HEAD" | awk '{print $2}' > "$O/admin/$n/first-log-sha"
  done
  { ls -A "$RUN_R/repo/.claude/worktrees" 2>/dev/null || true; } > "$O/worktrees-left"
  g "$RUN_R" worktree list --porcelain > "$O/worktree-list" 2>/dev/null || true
  g "$RUN_R" for-each-ref --format='%(refname:short)' refs/heads > "$O/branches" 2>/dev/null || true
  for c in "$RUN_H/cfg" "$RUN_H/cfg2"; do
    [[ -d $c/projects ]] || continue
    while IFS= read -r m; do
      mkdir -p "$O/meta/${c##*/}/$(dirname "$m")"; cp "$c/projects/$m" "$O/meta/${c##*/}/$m"
    done < <(cd "$c/projects" && find . -path '*/subagents/*' -name '*.meta.json' -type f)
  done
  [[ -d $RUN_R/snapshots ]] && cp -R "$RUN_R/snapshots/." "$O/snapshots/"
  curl -fsS "http://127.0.0.1:$PORT/__rig/state" 2>/dev/null | jq -c '.consumedLabels' > "$O/labels" || printf '[]\n' > "$O/labels"
  if [[ -f $RUN_R/notes ]]; then cp "$RUN_R/notes" "$O/notes"; else : > "$O/notes"; fi
}
cleanup_run() {
  if [[ $COLLECTED == 0 && -n $OUT_DIR && -n $RUN_R && -d $RUN_R ]]; then note "run aborted"; collect "$OUT_DIR" || true; fi
  [[ -n $SOCK ]] && T "$SOCK" kill-server 2>/dev/null || true
  [[ -n $MOCK_PID ]] && kill "$MOCK_PID" 2>/dev/null || true
  if [[ -n $RUN_R ]] && guard_root "$RUN_R"; then rm -rf -- "$RUN_R"; fi
}
cmd_run() {
  VER=${1-}; SCEN=${2-}; OUT_DIR=${3-}
  [[ -n $VER && -n $OUT_DIR ]] || die "usage: rig.sh run <version> <scenario.json> <out-dir>"
  check_scenario "$SCEN" || die "scenario '$SCEN' is malformed (rig.sh check-scenario names the rule)"
  guard_out "$OUT_DIR" || die "refusing out-dir '$OUT_DIR': it must not be inside the source tree"
  local made phys
  made=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-dlg-rig.XXXXXX") || die "mktemp failed"
  phys=$(cd -P -- "$made" && pwd) || { rmdir -- "$made"; die "cannot resolve '$made'"; }
  guard_root "$phys" || { rmdir -- "$made"; die "refusing run root '$phys' (TMPDIR inside \$HOME?)"; }
  RUN_R=$phys; RUN_H=$RUN_R/fixhome; CFG=$RUN_H/cfg; SOCK=dlg$$
  trap cleanup_run EXIT
  trap 'exit 130' INT TERM HUP
  printf '%s\n' "$$" > "$RUN_R/.owner"
  cmd_setup "$RUN_R" "$VER"
  MOCK_PORT=0 MOCK_SCRIPT=$SCEN MOCK_LOG=$RUN_R/mock.log node "$HERE/mockapi.mjs" > "$RUN_R/mock.out" 2>&1 &
  MOCK_PID=$!
  for _ in $(seq 100); do
    PORT=$(sed -n 's/^mock listening 127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' "$RUN_R/mock.out")
    [[ -n $PORT ]] && break; sleep 0.1
  done
  [[ -n $PORT ]] || die "the mock did not start"
  T "$SOCK" start-server ';' set -g remain-on-exit on ';' new-session -d -s "$SESSION" -x 200 -y 50 bash -c "$(launch_cmd)"
  run_steps
  sleep "$(jq -r '.settleS // 8' "$SCEN")"
  collect "$OUT_DIR"
}
cmd_reap() {
  local d s pid base
  base=${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)
  for s in "$base"/dlg*; do
    [[ -S $s ]] || continue
    s=${s##*/}; pid=${s#dlg}
    [[ $pid =~ ^[0-9]+$ ]] || continue
    kill -0 "$pid" 2>/dev/null || { T "$s" kill-server 2>/dev/null || true; printf 'rig: reaped tmux server %s\n' "$s" >&2; }
  done
  for d in "${TMPDIR:-/tmp}"/ccrc-dlg-rig.*; do
    [[ -d $d && -f $d/.owner ]] || continue
    pid=$(cat "$d/.owner")
    [[ $pid =~ ^[0-9]+$ ]] || continue
    kill -0 "$pid" 2>/dev/null && continue
    d=$(cd -P -- "$d" && pwd) || continue
    guard_root "$d" && { rm -rf -- "$d"; printf 'rig: reaped run root %s\n' "${d##*/}" >&2; }
  done
  return 0
}
cmd_all() {
  local RAW=${1-} v s
  [[ -n $RAW ]] || die "usage: rig.sh all <raw-root>"
  guard_out "$RAW" || die "refusing raw-root '$RAW': it must not be inside the source tree"
  cmd_reap
  rm -f "$RAW/.done"
  for v in $(ls "$VERSIONS" | sort -t. -k1,1n -k2,2n -k3,3n); do
    [[ -x $VERSIONS/$v && $v =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
    for s in "$HERE"/scenarios/*.json; do
      bash "$0" run "$v" "$s" "$RAW/$v/$(basename "$s" .json)" \
        || printf 'rig: run %s %s failed rc=%s\n' "$v" "$(basename "$s")" "$?" >&2
    done
  done
  date -u +%Y-%m-%dT%H:%M:%SZ > "$RAW/.done"
}

case ${1-} in
  guard-root)     guard_root "${2-}" ;;
  guard-sock)     guard_sock "${2-}" ;;
  check-scenario) check_scenario "${2-}" || exit 2 ;;
  setup)          shift; cmd_setup "$@" ;;
  run)            shift; cmd_run "$@" ;;
  all)            shift; cmd_all "$@" ;;
  reap)           cmd_reap ;;
  *)              sed -n '2,22p' "$0" >&2; exit 2 ;;
esac
```

Create the fourteen scenarios under `server/test/delegation-rig/scenarios/`. Every entry matches `kind: "tools"`
(main or sub) on a unique text, so a version whose main-loop marker changed still matches; every scenario's
`default` is `{"text": "DLG-WAIT", "repeat": true}`. `covers` names the spec §8.1 questions it measures. A
subagent's scripted Bash command always contains `DLG-ACK-` (the matrix finds subagent-side events by that marker);
the main loop's never does. A wait whose outcome IS the measurement is a `probeLabels` step: missing it writes
`probe [...]: not reached`, an outcome, never a failure.

`agent-plain.json`:

```json
{
  "scenario": "agent-plain", "covers": ["Q2", "Q4"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg agent-plain"}, {"keys": ["Enter"]},
    {"waitLabels": ["main-done"], "timeoutS": 120}
  ],
  "settleS": 8,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg agent-plain"},
     "tool_use": {"nameAny": ["Agent", "Task"], "input": {"description": "dlg plain", "prompt": "dlg-sub-plain", "subagent_type": "general-purpose", "run_in_background": false}}},
    {"label": "sub-bash", "match": {"kind": "tools", "lastUser": "dlg-sub-plain"},
     "tool_use": {"name": "Bash", "input": {"command": "echo DLG-ACK-plain", "description": "ack"}}},
    {"label": "sub-done", "match": {"kind": "tools", "lastUser": "DLG-ACK-plain"}, "text": "DLG-SUB-DONE-plain"},
    {"label": "main-done", "match": {"kind": "tools", "lastUser": "DLG-SUB-DONE-plain"}, "text": "DLG-DONE"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`agent-iso-unchanged.json` — the same shape with `"covers": ["Q2", "Q3", "Q6"]`, the prompt `dlg agent-iso-unchanged`,
`"isolation": "worktree"` added to the Agent input, its sub prompt `dlg-sub-iso-u`, and no sub tool call:

```json
{
  "scenario": "agent-iso-unchanged", "covers": ["Q2", "Q3", "Q6"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg agent-iso-unchanged"}, {"keys": ["Enter"]},
    {"waitLabels": ["main-done"], "timeoutS": 120}
  ],
  "settleS": 10,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg agent-iso-unchanged"},
     "tool_use": {"nameAny": ["Agent", "Task"], "input": {"description": "dlg iso unchanged", "prompt": "dlg-sub-iso-u", "subagent_type": "general-purpose", "run_in_background": false, "isolation": "worktree"}}},
    {"label": "sub-done", "match": {"kind": "tools", "lastUser": "dlg-sub-iso-u"}, "text": "DLG-SUB-DONE-iso-u"},
    {"label": "main-done", "match": {"kind": "tools", "lastUser": "DLG-SUB-DONE-iso-u"}, "text": "DLG-DONE"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`agent-iso-changed.json`:

```json
{
  "scenario": "agent-iso-changed", "covers": ["Q3", "Q6"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg agent-iso-changed"}, {"keys": ["Enter"]},
    {"waitLabels": ["main-done"], "timeoutS": 120}
  ],
  "settleS": 10,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg agent-iso-changed"},
     "tool_use": {"nameAny": ["Agent", "Task"], "input": {"description": "dlg iso changed", "prompt": "dlg-sub-iso-c", "subagent_type": "general-purpose", "run_in_background": false, "isolation": "worktree"}}},
    {"label": "sub-bash", "match": {"kind": "tools", "lastUser": "dlg-sub-iso-c"},
     "tool_use": {"name": "Bash", "input": {"command": "printf 'x\\n' > changed.txt && git add changed.txt && git commit -qm dlg-changed && echo DLG-ACK-iso-c", "description": "commit a change"}}},
    {"label": "sub-done", "match": {"kind": "tools", "lastUser": "DLG-ACK-iso-c"}, "text": "DLG-SUB-DONE-iso-c"},
    {"label": "main-done", "match": {"kind": "tools", "lastUser": "DLG-SUB-DONE-iso-c"}, "text": "DLG-DONE"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`agent-iso-dirty.json`:

```json
{
  "scenario": "agent-iso-dirty", "covers": ["Q6"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg agent-iso-dirty"}, {"keys": ["Enter"]},
    {"waitLabels": ["main-done"], "timeoutS": 120}
  ],
  "settleS": 10,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg agent-iso-dirty"},
     "tool_use": {"nameAny": ["Agent", "Task"], "input": {"description": "dlg iso dirty", "prompt": "dlg-sub-iso-d", "subagent_type": "general-purpose", "run_in_background": false, "isolation": "worktree"}}},
    {"label": "sub-bash", "match": {"kind": "tools", "lastUser": "dlg-sub-iso-d"},
     "tool_use": {"name": "Bash", "input": {"command": "printf 'x\\n' > dirty.txt && echo DLG-ACK-iso-d", "description": "leave an uncommitted file"}}},
    {"label": "sub-done", "match": {"kind": "tools", "lastUser": "DLG-ACK-iso-d"}, "text": "DLG-SUB-DONE-iso-d"},
    {"label": "main-done", "match": {"kind": "tools", "lastUser": "DLG-SUB-DONE-iso-d"}, "text": "DLG-DONE"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`agent-iso-bg.json` (background is the default on 2.1.289; the run waits on the subagent, not on the main loop):

```json
{
  "scenario": "agent-iso-bg", "covers": ["Q3", "Q6"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg agent-iso-bg"}, {"keys": ["Enter"]},
    {"waitLabels": ["sub-done"], "timeoutS": 150}
  ],
  "settleS": 20,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg agent-iso-bg"},
     "tool_use": {"nameAny": ["Agent", "Task"], "input": {"description": "dlg iso bg", "prompt": "dlg-sub-iso-bg", "subagent_type": "general-purpose", "run_in_background": true, "isolation": "worktree"}}},
    {"label": "sub-bash", "match": {"kind": "tools", "lastUser": "dlg-sub-iso-bg"},
     "tool_use": {"name": "Bash", "input": {"command": "printf 'x\\n' > bg.txt && git add bg.txt && git commit -qm dlg-bg && echo DLG-ACK-iso-bg", "description": "commit a change"}}},
    {"label": "sub-done", "match": {"kind": "tools", "lastUser": "DLG-ACK-iso-bg"}, "text": "DLG-SUB-DONE-iso-bg"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`wf-plain.json`:

```json
{
  "scenario": "wf-plain", "covers": ["Q1", "Q2", "Q4"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg wf-plain"}, {"keys": ["Enter"]},
    {"answerDialog": "Run a dynamic workflow", "timeoutS": 10},
    {"waitLabels": ["wf-p1", "wf-p2"], "timeoutS": 180}
  ],
  "settleS": 15,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg wf-plain"},
     "tool_use": {"name": "Workflow", "input": {"script": "export const meta = { name: 'dlgwfp', description: 'dlg wf plain' }\nconst r = await Promise.all([agent('dlg-wf-p1', { label: 'p1' }), agent('dlg-wf-p2', { label: 'p2' })])\nreturn r\n"}}},
    {"label": "wf-p1", "match": {"kind": "tools", "lastUser": "dlg-wf-p1"}, "text": "DLG-WF-P1"},
    {"label": "wf-p2", "match": {"kind": "tools", "lastUser": "dlg-wf-p2"}, "text": "DLG-WF-P2"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`wf-iso.json`:

```json
{
  "scenario": "wf-iso", "covers": ["Q1", "Q3", "Q6"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg wf-iso"}, {"keys": ["Enter"]},
    {"answerDialog": "Run a dynamic workflow", "timeoutS": 10},
    {"waitLabels": ["wf-i1-done", "wf-i2"], "timeoutS": 180}
  ],
  "settleS": 20,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg wf-iso"},
     "tool_use": {"name": "Workflow", "input": {"script": "export const meta = { name: 'dlgwfi', description: 'dlg wf iso' }\nconst r = await Promise.all([agent('dlg-wf-i1', { label: 'i1', isolation: 'worktree' }), agent('dlg-wf-i2', { label: 'i2', isolation: 'worktree' })])\nreturn r\n"}}},
    {"label": "wf-i1-bash", "match": {"kind": "tools", "lastUser": "dlg-wf-i1"},
     "tool_use": {"name": "Bash", "input": {"command": "printf 'x\\n' > wf.txt && git add wf.txt && git commit -qm dlg-wf && echo DLG-ACK-wf-i1", "description": "commit a change"}}},
    {"label": "wf-i1-done", "match": {"kind": "tools", "lastUser": "DLG-ACK-wf-i1"}, "text": "DLG-WF-I1"},
    {"label": "wf-i2", "match": {"kind": "tools", "lastUser": "dlg-wf-i2"}, "text": "DLG-WF-I2"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`raw-worktree.json`:

```json
{
  "scenario": "raw-worktree", "covers": ["Q3", "Q6"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg raw-worktree"}, {"keys": ["Enter"]},
    {"waitLabels": ["main-done"], "timeoutS": 90}
  ],
  "settleS": 5,
  "entries": [
    {"label": "main-bash", "match": {"kind": "tools", "lastUser": "dlg raw-worktree"},
     "tool_use": {"name": "Bash", "input": {"command": "git worktree add -q -b dlg-raw ../raw-wt && echo DLG-RAW-OK", "description": "add a worktree by hand"}}},
    {"label": "main-done", "match": {"kind": "tools", "lastUser": "DLG-RAW-OK"}, "text": "DLG-DONE"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`parent-kill.json`:

```json
{
  "scenario": "parent-kill", "covers": ["Q6"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg parent-kill"}, {"keys": ["Enter"]},
    {"waitLabels": ["sub-hang"], "timeoutS": 120}, {"sleep": 5}, {"snapshot": "before-kill"}, {"kill9": true}, {"sleep": 5}
  ],
  "settleS": 3,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg parent-kill"},
     "tool_use": {"nameAny": ["Agent", "Task"], "input": {"description": "dlg kill", "prompt": "dlg-sub-kill", "subagent_type": "general-purpose", "run_in_background": false, "isolation": "worktree"}}},
    {"label": "sub-hang", "match": {"kind": "tools", "lastUser": "dlg-sub-kill"}, "hang_ms": 600000, "text": "never"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`interrupt-exit.json`:

```json
{
  "scenario": "interrupt-exit", "covers": ["Q6"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg interrupt-exit"}, {"keys": ["Enter"]},
    {"waitLabels": ["sub-hang"], "timeoutS": 120}, {"sleep": 5}, {"keys": ["Escape"]}, {"sleep": 5},
    {"type": "/exit"}, {"keys": ["Enter"]}, {"sleep": 5}
  ],
  "settleS": 3,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg interrupt-exit"},
     "tool_use": {"nameAny": ["Agent", "Task"], "input": {"description": "dlg interrupt", "prompt": "dlg-sub-int", "subagent_type": "general-purpose", "run_in_background": false, "isolation": "worktree"}}},
    {"label": "sub-hang", "match": {"kind": "tools", "lastUser": "dlg-sub-int"}, "hang_ms": 600000, "text": "never"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`clear-compact-resume.json`:

```json
{
  "scenario": "clear-compact-resume", "covers": ["Q5"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg c1"}, {"keys": ["Enter"]}, {"waitLabels": ["c1"], "timeoutS": 60},
    {"type": "/clear"}, {"keys": ["Enter"]}, {"sleep": 3},
    {"type": "dlg c2"}, {"keys": ["Enter"]}, {"waitLabels": ["c2"], "timeoutS": 60},
    {"type": "/compact"}, {"keys": ["Enter"]}, {"sleep": 15},
    {"kill9": true}, {"sleep": 3}, {"relaunch": true}, {"waitReady": 60},
    {"type": "dlg c3"}, {"keys": ["Enter"]}, {"waitLabels": ["c3"], "timeoutS": 60},
    {"type": "/exit"}, {"keys": ["Enter"]}, {"sleep": 5}
  ],
  "settleS": 3,
  "entries": [
    {"label": "c1", "match": {"kind": "tools", "lastUser": "dlg c1"}, "text": "DLG-C1"},
    {"label": "c2", "match": {"kind": "tools", "lastUser": "dlg c2"}, "text": "DLG-C2"},
    {"label": "c3", "match": {"kind": "tools", "lastUser": "dlg c3"}, "text": "DLG-C3"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`swap-resume.json`:

```json
{
  "scenario": "swap-resume", "covers": ["Q5"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg s1"}, {"keys": ["Enter"]}, {"waitLabels": ["s1"], "timeoutS": 60},
    {"type": "/exit"}, {"keys": ["Enter"]}, {"sleep": 5},
    {"swapConfig": true}, {"relaunch": true}, {"waitReady": 60},
    {"type": "dlg s2"}, {"keys": ["Enter"]}, {"waitLabels": ["s2"], "timeoutS": 60},
    {"type": "/exit"}, {"keys": ["Enter"]}, {"sleep": 5}
  ],
  "settleS": 3,
  "entries": [
    {"label": "s1", "match": {"kind": "tools", "lastUser": "dlg s1"}, "text": "DLG-S1"},
    {"label": "s2", "match": {"kind": "tools", "lastUser": "dlg s2"}, "text": "DLG-S2"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`wf-iso-resume.json`:

```json
{
  "scenario": "wf-iso-resume", "covers": ["Q7"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg wf-iso-resume"}, {"keys": ["Enter"]},
    {"answerDialog": "Run a dynamic workflow", "timeoutS": 10},
    {"waitLabels": ["r1-hang", "r2"], "timeoutS": 180}, {"sleep": 5}, {"snapshot": "before-kill"},
    {"kill9": true}, {"sleep": 3}, {"relaunch": true}, {"waitReady": 60}, {"sleep": 30},
    {"probeLabels": ["r1-resumed"], "timeoutS": 120}
  ],
  "settleS": 10,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg wf-iso-resume"},
     "tool_use": {"name": "Workflow", "input": {"script": "export const meta = { name: 'dlgwfr', description: 'dlg wf resume' }\nconst r = await Promise.all([agent('dlg-wf-r1', { label: 'r1', isolation: 'worktree' }), agent('dlg-wf-r2', { label: 'r2', isolation: 'worktree' })])\nreturn r\n"}}},
    {"label": "r1-hang", "match": {"kind": "tools", "lastUser": "dlg-wf-r1"}, "hang_ms": 600000, "text": "never"},
    {"label": "r2", "match": {"kind": "tools", "lastUser": "dlg-wf-r2"}, "text": "DLG-WF-R2"},
    {"label": "r1-resumed", "match": {"kind": "tools", "lastUser": "dlg-wf-r1"}, "text": "DLG-WF-R1"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

`wf-limit-pause.json` (an ATTEMPT: whether a mock 429 provokes the five-hour pause is itself measured; the header
names follow the scratch rig's `anthropic-ratelimit-unified-*` family):

```json
{
  "scenario": "wf-limit-pause", "covers": ["Q7"],
  "steps": [
    {"waitReady": 60}, {"type": "dlg wf-limit-pause"}, {"keys": ["Enter"]},
    {"answerDialog": "Run a dynamic workflow", "timeoutS": 10},
    {"waitLabels": ["l1-limited"], "timeoutS": 120}, {"sleep": 70},
    {"probeLabels": ["l1-done"], "timeoutS": 180}
  ],
  "settleS": 10,
  "entries": [
    {"label": "main-call", "match": {"kind": "tools", "lastUser": "dlg wf-limit-pause"},
     "tool_use": {"name": "Workflow", "input": {"script": "export const meta = { name: 'dlgwfl', description: 'dlg wf limit' }\nconst r = await agent('dlg-wf-l1', { label: 'l1', isolation: 'worktree' })\nreturn r\n"}}},
    {"label": "l1-limited", "match": {"kind": "tools", "lastUser": "dlg-wf-l1"}, "status": 429,
     "headers": {"anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-reset": "$NOW+60",
                 "anthropic-ratelimit-unified-representative-claim": "five_hour", "retry-after": "60"},
     "body": {"type": "error", "error": {"type": "rate_limit_error", "message": "mock five-hour limit"}}},
    {"label": "l1-done", "match": {"kind": "tools", "lastUser": "dlg-wf-l1"}, "text": "DLG-WF-L1"}
  ],
  "default": {"text": "DLG-WAIT", "repeat": true}
}
```

Create `server/test/delegation-rig/README.md`:

```markdown
# The delegation capture rig

What Claude Code emits for `Agent`, `Workflow` and a raw `git worktree add` — hook payloads, admin records,
subagent metadata — measured per installed binary, so the delegation broker (spec
`docs/superpowers/specs/2026-10-04-delegation-broker-design.md` §8.1-§8.2) builds only on measured fields.

- `mockapi.mjs` — a scripted mock of the Anthropic Messages API (header comment documents the script grammar).
- `rig.sh` — runs one binary against the mock in a PRIVATE tmux server (`tmux -L dlg… -f /dev/null`) and a FIXTURE
  HOME under a `ccrc-dlg-rig.*` root, with ccrc's own hook registered by ccrc's own installer in a session named
  `cc-rig-hookcap`. It never names the real HOME (except to find the binary) or the default tmux server, and
  grants tools through `permissions.allow` — never a permission bypass.
- `scenarios/*.json` — one per measured situation; `covers` names the spec §8.1 questions.
- `sanitize.mjs` — raw run bundles → `server/test/fixtures/delegation/<version>/<scenario>.json`, fail-closed on any
  residue of a real path, user or host.
- `build-matrix.mjs` — the fixtures → `server/test/fixtures/delegation/matrix.json` (derived; never hand-edited).

Re-capture (on a box with the binaries; takes hours, runs in the foreground):

    RAW=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-dlg-raw.XXXXXX")
    bash server/test/delegation-rig/rig.sh all "$RAW" 2>&1 | tee "$RAW/all.log"
    node server/test/delegation-rig/sanitize.mjs "$RAW" server/test/fixtures/delegation
    node server/test/delegation-rig/build-matrix.mjs server/test/fixtures/delegation server/test/delegation-rig/scenarios --write

The captures are SYNTHETIC — a mock API, a fixture HOME, a fixture repo — which is why their payloads may be
committed after `sanitize.mjs`. A capture from a REAL fleet lane never leaves the box; only
`deploy/hook-capture-reduce.mjs` output from one is committed.
```

- [ ] **Step 4: Run green.** `cd server && ./node_modules/.bin/vitest run test/delegation-rig.test.ts` — all rows green.

- [ ] **Step 5: Smoke one run (measurement, not a test).** On the box with the binaries:

```bash
OUT=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-dlg-raw.XXXXXX")/smoke   # outside the tree: the rig refuses an out-dir inside it
bash server/test/delegation-rig/rig.sh run "$(ls ~/.local/share/claude/versions | sort -t. -k3,3n | tail -n1)" \
  server/test/delegation-rig/scenarios/agent-plain.json "$OUT"
ls "$OUT/caps" | sed 's/-.*//' | sort | uniq -c; cat "$OUT/labels" "$OUT/notes"
```

Expected (DERIVED from the 2.1.283 scratch runs): `labels` lists all four entries; `caps` includes `SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop`; `notes` is empty. If a step
fails, read `$OUT/notes`, fix the RIG (never a fixture), and record the fix in "Deviations found". Then confirm
nothing is left: `ls "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)/" | grep '^dlg'` and `ls -d "${TMPDIR:-/tmp}"/ccrc-dlg-rig.*`
both print nothing (`bash server/test/delegation-rig/rig.sh reap` removes what a killed run left).

- [ ] **Step 6: Mutations.**

| # | Mutation | Expected red |
|---|---|---|
| T4-M1 | `guard_root`'s `$REAL_HOME` clause deleted | "guard-root refuses a root under HOME by either spelling … (F10b)" (with HOME spelled through a symlink, a root under the link spelling passes) — 1 red, measured at `e47f3689f`; "guard-root accepts only …" stays green, its `${home}/ccrc-dlg-rig.x` still refused by the physical-HOME arm (D-4002) — corrected in fix round 2 (review 296 F6) |
| T4-M2 | `SOCK_RE` widened to `^.*$` | "guard-sock accepts only …" |
| T4-M3 | `cmd_setup`'s `guard_root` line deleted | "setup refuses a root by its SPELLING alone … (F10a)" — 1 red, measured at `e47f3689f`; "setup refuses a root the guard refuses …" stays green, its root still refused by the physical-path guard that follows (D-4062) — corrected in fix round 2 (review 296 F6) |
| T4-M4 | a bare `tmux ls` line added to `cleanup_run` | "no line of rig.sh calls tmux except …" |
| T4-M5 | the installer call removed from `cmd_setup` | "builds the fixture HOME …" (no `/session-hook.sh` under `PreToolUse`) |
| T4-M6 | `check_scenario`'s key-name rule deleted | "check-scenario refuses …" (the `;` chain passes) |
| T4-M7 | `cmd_reap`'s `kill -0` check deleted | "reap removes … and keeps one whose owner lives" |
| T4-M8 | `guard_root`'s `*//*` clause deleted | "guard-root accepts only …" (`/tmp//ccrc-dlg-rig.x` passes) |

- [ ] **Step 7: Commit.**

```bash
git add server/test/delegation-rig/rig.sh server/test/delegation-rig/scenarios server/test/delegation-rig/README.md \
  server/test/delegation-rig.test.ts
git commit -m "test(rig): the delegation capture rig's driver and fourteen scenarios (delegation broker w1)"
```

---

### Task 5: the sanitiser — raw bundles to committed fixtures, fail-closed

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `server/test/delegation-rig/sanitize.mjs`
- Modify: `server/test/delegation-rig.test.ts` (append the sanitiser rows)

**Interfaces:**
- Consumes: Task 4's raw bundle layout.
- Produces: `node sanitize.mjs <raw-root> <fixtures-dir>` writes `<fixtures-dir>/<version>/<scenario>.json` for every
  `<raw-root>/<version>/<scenario>/` bundle, shaped:

```ts
interface Fixture {
  v: 1; version: string; scenario: string; labels: string[]; notes: string[];
  events: Array<{ seq: number; dtMs: number; event: string; envSid: string | null; payload: Record<string, unknown> | null }>;
  disk: {
    admin: Record<string, { files: string[]; gitdir: string | null; head: string | null; claudeBase: string | null;
      locked: boolean; firstLogSha: string | null }>;
    worktreesLeft: string[]; branches: string[]; worktreeList: string;
    metas: Record<string, unknown>;   // key: '<cfg>/<project>/<uuid>/subagents/…/<name>.meta.json'
    snapshots: Record<string, { adminRecords?: string[]; worktrees?: string[] }>;
  };
}
```

  Every occurrence of the run root (both spellings in `root`) becomes `/rig`, its munged form (every
  non-alphanumeric character as `-`) `-rig`, and the binaries' directory (`versions-dir`) `/rig/versions`. The scan is
  an ALLOWLIST: any absolute path whose first segment is not `rig`, `usr` or `bin` (or that is not exactly
  `/dev/null`) is residue, and so are `ccrc-dlg-rig`, `sk-ant-`, and the running user's name or the host's first
  label as a whole word (4+ characters). On any finding it exits 1 with one stderr line per finding naming
  `<version>/<scenario>` and a JSON pointer — a key named by its index (`#<n>`) unless the key itself is a plain,
  clean name — never a value, and writes NOTHING. A scenario directory not named `[a-z0-9-]{1,40}` is a finding too.
  Exit 2 on bad arguments.

- [ ] **Step 1: Write the failing tests.** Append to `server/test/delegation-rig.test.ts`:

```ts
const SANITIZE = path.join(RIG, 'sanitize.mjs');
/** A raw bundle as rig.sh's `collect` leaves it, for a run root that is only a STRING here. */
function rawBundle(raw: string, root: string, version: string, scenario: string, caps: Array<[string, number, object]>, versionsDir = '/opt/fake-claude/versions'): string {
  const d = path.join(raw, version, scenario);
  fs.mkdirSync(path.join(d, 'caps'), { recursive: true });
  fs.writeFileSync(path.join(d, 'root'), `${root}\n${root}\n`);
  fs.writeFileSync(path.join(d, 'version'), `${version}\n`);
  fs.writeFileSync(path.join(d, 'versions-dir'), `${versionsDir}\n`);
  fs.writeFileSync(path.join(d, 'scenario'), `${scenario}\n`);
  for (const [event, ms, payload] of caps) fs.writeFileSync(path.join(d, 'caps', `${event}-${ms}-100.cap`), `{"envSid":"u-1"}\n${JSON.stringify(payload)}\n`);
  const adm = path.join(d, 'admin', 'agent-abc');
  fs.mkdirSync(adm, { recursive: true });
  fs.writeFileSync(path.join(adm, 'files'), 'CLAUDE_BASE\nHEAD\ngitdir\nlogs\n');
  fs.writeFileSync(path.join(adm, 'gitdir'), `${root}/repo/.claude/worktrees/agent-abc/.git\n`);
  fs.writeFileSync(path.join(adm, 'HEAD'), 'aaaa\n');
  fs.writeFileSync(path.join(adm, 'CLAUDE_BASE'), 'bbbb');
  fs.writeFileSync(path.join(adm, 'first-log-sha'), 'bbbb\n');
  const munged = root.replace(/[^A-Za-z0-9]/g, '-');
  const meta = path.join(d, 'meta', 'cfg', `${munged}-repo`, 'uuid-1', 'subagents');
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, 'agent-abc.meta.json'), JSON.stringify({ worktreePath: `${root}/repo/.claude/worktrees/agent-abc`, toolUseId: 't' }));
  const snap = path.join(d, 'snapshots', 'before-kill');
  fs.mkdirSync(snap, { recursive: true });
  fs.writeFileSync(path.join(snap, 'admin-records'), 'agent-abc\n');
  fs.writeFileSync(path.join(snap, 'worktrees'), 'agent-abc\n');
  fs.writeFileSync(path.join(d, 'worktrees-left'), 'agent-abc\n');
  fs.writeFileSync(path.join(d, 'worktree-list'), `worktree ${root}/repo\nHEAD bbbb\nbranch refs/heads/main\n`);
  fs.writeFileSync(path.join(d, 'branches'), 'main\nworktree-agent-abc\n');
  fs.writeFileSync(path.join(d, 'labels'), '["main-call"]\n');
  fs.writeFileSync(path.join(d, 'notes'), '');
  return d;
}
const sanitize = (raw: string, out: string): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [SANITIZE, raw, out], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('sanitize.mjs (raw bundles -> committed fixtures, fail-closed)', () => {
  const ROOT = '/tmp/ccrc-dlg-rig.Ab12Cd';
  const MUNGED = ROOT.replace(/[^A-Za-z0-9]/g, '-');
  const leakRun = (payload: object): { status: number | null; stderr: string; written: string[] } => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'leak', [['Stop', 1, { hook_event_name: 'Stop', ...payload }]]);
    const r = sanitize(raw, out);
    return { status: r.status, stderr: r.stderr, written: fs.readdirSync(out) };
  };

  it('replaces the run root, its munged form and the binaries directory; orders events; keeps shas and snapshots', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'agent-plain', [
      ['SubagentStart', 20, { hook_event_name: 'SubagentStart', agent_id: 'abc', cwd: `${ROOT}/repo` }],
      ['SessionStart', 10, { hook_event_name: 'SessionStart', session_id: 's', cwd: `${ROOT}/repo`,
        transcript_path: `${ROOT}/fixhome/cfg/projects/${MUNGED}-repo/s.jsonl`, sink: '/dev/null', git: '/usr/bin/git',
        bin: '/opt/fake-claude/versions/2.1.999' }],
    ]);
    const r = sanitize(raw, out);
    expect(r.status, r.stderr).toBe(0);
    const text = fs.readFileSync(path.join(out, '2.1.999', 'agent-plain.json'), 'utf8');
    for (const bad of ['ccrc-dlg-rig', '/tmp/', '/opt/']) expect(text.includes(bad), bad).toBe(false);
    const f = JSON.parse(text);
    expect(f).toMatchObject({ v: 1, version: '2.1.999', scenario: 'agent-plain', labels: ['main-call'], notes: [] });
    expect(f.events.map((e: { event: string; seq: number; dtMs: number }) => [e.event, e.seq, e.dtMs])).toEqual([['SessionStart', 1, 0], ['SubagentStart', 2, 10]]);
    expect(f.events[0].payload).toMatchObject({ transcript_path: '/rig/fixhome/cfg/projects/-rig-repo/s.jsonl', sink: '/dev/null', git: '/usr/bin/git', bin: '/rig/versions/2.1.999' });
    expect(f.events[1].payload.cwd).toBe('/rig/repo');
    expect(f.disk.admin['agent-abc']).toEqual({ files: ['CLAUDE_BASE', 'HEAD', 'gitdir', 'logs'], gitdir: '/rig/repo/.claude/worktrees/agent-abc/.git',
      head: 'aaaa', claudeBase: 'bbbb', locked: false, firstLogSha: 'bbbb' });
    expect(Object.keys(f.disk.metas)).toEqual(['cfg/-rig-repo/uuid-1/subagents/agent-abc.meta.json']);
    expect(f.disk.snapshots).toEqual({ 'before-kill': { adminRecords: ['agent-abc'], worktrees: ['agent-abc'] } });
    expect(f.disk.worktreesLeft).toEqual(['agent-abc']);
  });

  it('fails closed on residue: exit 1, the finding named by place not value, and NOTHING written', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    rawBundle(raw, ROOT, '2.1.999', 'dirty', [['Stop', 1, { hook_event_name: 'Stop', cwd: '/home/someone-else/x' }]]);
    const r = sanitize(raw, out);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('2.1.999/dirty /events/0/payload/cwd');
    expect(r.stderr).not.toContain('someone-else');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('treats any absolute path outside /rig, /usr, /bin and /dev/null as residue, and a key-shaped string too', () => {
    for (const leak of ['/mnt/vol-0000/acme', '/srv/box/x', '/dev/shm/x', '/devnull', 'sk-ant-xyz']) {
      const r = leakRun({ note: leak });
      expect(r.status, leak).toBe(1);
      expect(r.stderr, leak).toContain('2.1.999/leak /events/0/payload/note');
      expect(r.stderr, leak).not.toContain(leak);
      expect(r.written, leak).toEqual([]);
    }
  });

  it('names a leaking KEY by its index, never its text', () => {
    const r = leakRun({ tool_response: { '/home/someone-else/acme-client': 1 } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/tool_response/#0 (key)');
    expect(r.stderr).not.toContain('someone-else');
  });

  it.skipIf(os.userInfo().username.length < 4)('fails closed on the running user\'s name as a whole word', () => {
    const r = leakRun({ note: `x-${os.userInfo().username}-y` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/note');
    expect(r.written).toEqual([]);
  });

  it('refuses missing arguments with exit 2', () => {
    expect(spawnSync(process.execPath, [SANITIZE], { encoding: 'utf8' }).status).toBe(2);
  });
});
```

- [ ] **Step 2: Run them red.** `cd server && ./node_modules/.bin/vitest run test/delegation-rig.test.ts -t sanitize` —
  all six rows red: `sanitize.mjs` does not exist, so node exits 1 with its own module-not-found message — no fixture,
  no named place in stderr, never exit 2.

- [ ] **Step 3: Implement.** Create `server/test/delegation-rig/sanitize.mjs`:

```js
#!/usr/bin/env node
// sanitize.mjs — the delegation capture rig's raw run bundles -> the committed fixture corpus
// (delegation broker wave 1, spec 2026-10-04 §8.2). The captures are SYNTHETIC (mock API, fixture
// HOME, fixture repo); what could still leak is the box they ran on. So every spelling of the run
// root becomes `/rig` (its munged form `-rig`) and the binaries' directory `/rig/versions`, and then the WHOLE corpus is scanned by ALLOWLIST:
// an absolute path is residue unless its first segment is `rig`, `usr` or `bin`, or it is
// `/dev/null`; so is `ccrc-dlg-rig`, `sk-ant-`, and the running user's name or the host's first
// label as a whole word (4+ characters). Any finding exits 1 naming the bundle and a JSON pointer —
// a key is named by its INDEX, never its text — and NOTHING is written.
// Usage: node sanitize.mjs <raw-root> <fixtures-dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [raw, outDir] = process.argv.slice(2);
if (!raw || !outDir || process.argv.length > 4) { process.stderr.write('usage: node sanitize.mjs <raw-root> <fixtures-dir>\n'); process.exit(2); }

const CAP_NAME = /^([A-Za-z]{1,40})-([0-9]{1,16})-([0-9]{1,10})\.cap$/;
const NAME = /^[a-z0-9-]{1,40}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const munge = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
const readLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length > 0); } catch { return []; } };
const readTrim = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function replacer(roots, versionsDir) {
  const pairs = [];
  for (const r of roots) pairs.push([r, '/rig'], [munge(r), '-rig']);
  if (versionsDir) pairs.push([versionsDir, '/rig/versions'], [munge(versionsDir), '-rig-versions']);
  pairs.sort((a, b) => b[0].length - a[0].length);
  const fix = (s) => { let t = s; for (const [from, to] of pairs) t = t.split(from).join(to); return t; };
  const walk = (v) => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [fix(k), walk(x)]));
    return v;
  };
  return walk;
}

function readTree(dir) {
  const out = {};
  const visit = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) visit(path.join(d, e.name), r);
      else out[r] = e.name.endsWith('.json') ? readJson(path.join(d, e.name)) : readLines(path.join(d, e.name));
    }
  };
  if (fs.existsSync(dir)) visit(dir, '');
  return out;
}

function bundle(dir) {
  const walk = replacer([...new Set(readLines(path.join(dir, 'root')))], readTrim(path.join(dir, 'versions-dir')));
  const capDir = path.join(dir, 'caps');
  const caps = (fs.existsSync(capDir) ? fs.readdirSync(capDir) : [])
    .map((name) => ({ name, m: CAP_NAME.exec(name) })).filter((c) => c.m !== null)
    .map((c) => ({ name: c.name, event: c.m[1], ms: Number(c.m[2]), pid: Number(c.m[3]) }))
    .sort((a, b) => a.ms - b.ms || a.pid - b.pid);
  const t0 = caps.length > 0 ? caps[0].ms : 0;
  const events = caps.map((c, i) => {
    const text = fs.readFileSync(path.join(capDir, c.name), 'utf8');
    const nl = text.indexOf('\n');
    let envSid = null;
    try { const m = JSON.parse(nl === -1 ? text : text.slice(0, nl)); envSid = typeof m.envSid === 'string' && m.envSid !== '' ? m.envSid : null; } catch { /* null */ }
    let payload = null;
    try { const p = JSON.parse(nl === -1 ? '' : text.slice(nl + 1)); payload = p !== null && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { /* null */ }
    return { seq: i + 1, dtMs: c.ms - t0, event: c.event, envSid, payload };
  });
  const admin = {};
  const admDir = path.join(dir, 'admin');
  for (const n of (fs.existsSync(admDir) ? fs.readdirSync(admDir).sort() : [])) {
    const a = path.join(admDir, n);
    admin[n] = {
      files: readLines(path.join(a, 'files')), gitdir: readTrim(path.join(a, 'gitdir')), head: readTrim(path.join(a, 'HEAD')),
      claudeBase: readTrim(path.join(a, 'CLAUDE_BASE')), locked: fs.existsSync(path.join(a, 'locked')),
      firstLogSha: readTrim(path.join(a, 'first-log-sha')),
    };
  }
  const metas = {};
  for (const [k, v] of Object.entries(readTree(path.join(dir, 'meta')))) if (k.endsWith('.meta.json')) metas[k] = v;
  const snapshots = {};
  for (const [k, v] of Object.entries(readTree(path.join(dir, 'snapshots')))) {
    const [name, file] = k.split('/');
    (snapshots[name] ??= {})[file === 'admin-records' ? 'adminRecords' : 'worktrees'] = v;
  }
  const labels = readJson(path.join(dir, 'labels'));
  return walk({
    v: 1, version: readTrim(path.join(dir, 'version')), scenario: readTrim(path.join(dir, 'scenario')),
    labels: Array.isArray(labels) ? labels : [], notes: readLines(path.join(dir, 'notes')), events,
    disk: {
      admin, worktreesLeft: readLines(path.join(dir, 'worktrees-left')), branches: readLines(path.join(dir, 'branches')),
      worktreeList: readTrim(path.join(dir, 'worktree-list')) ?? '', metas, snapshots,
    },
  });
}

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORDS = [os.userInfo().username, os.hostname().split('.')[0]]
  .filter((w) => typeof w === 'string' && w.length >= 4)
  .map((w) => new RegExp(`(^|[^A-Za-z0-9])${esc(w)}($|[^A-Za-z0-9])`));
const ABS = /(?<![A-Za-z0-9._~:/-])\/([A-Za-z0-9._-]+)/g;
const ALLOWED_TOP = new Set(['rig', 'usr', 'bin']);
function residue(s) {
  for (const m of s.matchAll(ABS)) {
    if (ALLOWED_TOP.has(m[1])) continue;
    if (m[1] === 'dev' && s.startsWith('/null', m.index + m[0].length) && !/[A-Za-z0-9._-]/.test(s[m.index + m[0].length + 5] ?? '')) continue;
    return true;
  }
  return s.includes('ccrc-dlg-rig') || s.includes('sk-ant-') || WORDS.some((re) => re.test(s));
}
const SAFE_SEG = /^[A-Za-z0-9_.-]{1,40}$/;
const findings = [];
const scan = (v, ptr, where) => {
  if (typeof v === 'string') { if (residue(v)) findings.push(`${where} ${ptr || '/'}`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${ptr}/${i}`, where)); return; }
  if (v !== null && typeof v === 'object') {
    Object.entries(v).forEach(([k, x], i) => {
      const seg = SAFE_SEG.test(k) && !residue(k) ? k : `#${i}`;
      if (residue(k)) findings.push(`${where} ${ptr}/#${i} (key)`);
      scan(x, `${ptr}/${seg}`, where);
    });
  }
};

const fixtures = [];
for (const v of fs.readdirSync(raw).filter((n) => VERSION.test(n)).sort()) {
  for (const s of fs.readdirSync(path.join(raw, v)).sort()) {
    const d = path.join(raw, v, s);
    if (!fs.existsSync(path.join(d, 'root'))) continue;
    if (!NAME.test(s)) { findings.push(`${v}/#name (scenario directory name)`); continue; }
    const f = bundle(d);
    scan(f, '', `${v}/${s}`);
    fixtures.push({ v, s, f });
  }
}
if (findings.length > 0) {
  for (const x of findings) process.stderr.write(`sanitize: residue in ${x}\n`);
  process.exit(1);
}
for (const { v, s, f } of fixtures) {
  fs.mkdirSync(path.join(outDir, v), { recursive: true });
  fs.writeFileSync(path.join(outDir, v, `${s}.json`), `${JSON.stringify(f, null, 1)}\n`);
}
process.stdout.write(`sanitize: ${fixtures.length} fixture(s) written\n`);
```

- [ ] **Step 4: Run green.** `cd server && ./node_modules/.bin/vitest run test/delegation-rig.test.ts` — all green.

- [ ] **Step 5: Mutations.**

| # | Mutation | Expected red |
|---|---|---|
| T5-M1 | the munged pair removed from `replacer` | "replaces the run root …" (`ccrc-dlg-rig` in `transcript_path`) |
| T5-M2 | write fixtures BEFORE the findings check | "fails closed on residue …" (the clean bundle is written) |
| T5-M3 | a key's pointer segment printed as its text (`seg = k`) | "names a leaking KEY by its index …" |
| T5-M4 | `WORDS` emptied | "fails closed on the running user's name …" |
| T5-M5 | `ALLOWED_TOP` gains `mnt` | "treats any absolute path outside /rig …" |
| T5-M6 | the `versions-dir` pair removed from `replacer` | "replaces the run root …" (`/opt/` in `bin`) |

- [ ] **Step 6: Commit.**

```bash
git add server/test/delegation-rig/sanitize.mjs server/test/delegation-rig.test.ts
git commit -m "test(rig): the fail-closed sanitiser for the delegation fixture corpus (delegation broker w1)"
```

---

### Task 6: capture the corpus (measurement)

**Model routing:** `sonnet`, effort `medium`. This task runs the rig; it writes no code.

**Files:**
- Create: `server/test/fixtures/delegation/<version>/<scenario>.json` — one per installed version × scenario

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces: the committed corpus Task 7 derives the matrix from. A run that did not go as scripted is still committed:
  its `notes` say what happened, and Task 7 marks its cell `unmeasured`.

- [ ] **Step 1: Record the binaries.** `ls ~/.local/share/claude/versions/ | sort -t. -k1,1n -k2,2n -k3,3n` — record the
  list in the commit message. The fleet's lanes each pick their own version; a version missing here is recorded as
  not covered in Task 9, never guessed.

- [ ] **Step 2: Run every version × every scenario, DETACHED, and watch it.** It takes hours (fourteen scenarios of
  one to six minutes, per version) — longer than one foreground tool call may run — so it runs detached and is
  watched in short foreground polls. The raw root is OUTSIDE the repository, and its path is kept in a file because
  shell variables do not survive between tool calls:

```bash
RAW=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-dlg-raw.XXXXXX") && printf '%s\n' "$RAW" > "$SCRATCH/dlg-raw-root"
setsid nohup bash server/test/delegation-rig/rig.sh all "$RAW" > "$RAW/all.log" 2>&1 < /dev/null &
# then, in later calls (each well under ten minutes):
RAW=$(cat "$SCRATCH/dlg-raw-root"); [[ $RAW == */ccrc-dlg-raw.* ]] || { echo "lost the raw root"; exit 1; }
until [[ -f $RAW/.done ]]; do sleep 30; tail -n 2 "$RAW/all.log"; done   # bound each poll; repeat until .done
grep -c . "$RAW"/*/*/notes | grep -v ':0$' || echo "no run left a note"
```

  (`$SCRATCH` is this session's scratchpad.) If the detached run dies, `bash server/test/delegation-rig/rig.sh reap`
  removes what it left, and the missing `(version, scenario)` pairs are re-run one at a time as in Step 3.

- [ ] **Step 3: Retry a FAILED run once.** For each `(version, scenario)` whose `notes` name a timeout, a missing
  prompt, a missing pid or session id, or `run aborted` (a `probe … not reached` note is an OUTCOME, not a failure),
  delete that one directory and re-run it alone:

```bash
RAW=$(cat "$SCRATCH/dlg-raw-root"); [[ $RAW == */ccrc-dlg-raw.* ]] || exit 1
rm -rf -- "$RAW/<version>/<scenario>"
bash server/test/delegation-rig/rig.sh run <version> server/test/delegation-rig/scenarios/<scenario>.json "$RAW/<version>/<scenario>"
```

  A second failure stands; its notes are the record. A failure that is the RIG's (a wrong wait text, a scenario
  entry that never matches on any version) is fixed in the rig — then that scenario is re-run on every version — and
  the fix is listed in "Deviations found". A fixture is never edited by hand.

- [ ] **Step 4: Sanitise into the tree.**

```bash
RAW=$(cat "$SCRATCH/dlg-raw-root"); [[ $RAW == */ccrc-dlg-raw.* ]] || exit 1
node server/test/delegation-rig/sanitize.mjs "$RAW" server/test/fixtures/delegation
git add server/test/fixtures/delegation
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts
```

  Expected: `sanitize: <N> fixture(s) written` with N = versions × 14, and `topology-clean` green on the staged corpus.
  A `sanitize` exit 1 names a bundle and a pointer: find the cause in the RIG (a path the replacer did not know, a
  system path the allowlist does not name), fix the rig or the allowlist — each change listed in "Deviations found" —
  and re-run Step 4. Never hand-scrub a fixture.

- [ ] **Step 5: Commit.**

```bash
git commit -m "test(fixtures): the delegation capture corpus — <versions> x 14 scenarios (delegation broker w1)"
```

---

### Task 7: the matrix, derived from the corpus

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `server/test/delegation-rig/build-matrix.mjs`
- Create: `server/test/fixtures/delegation/matrix.json` (written by the builder, never by hand)
- Modify: `server/test/delegation-rig.test.ts` (append the matrix rows)

**Interfaces:**
- Consumes: Task 5's `Fixture` shape; the committed corpus (Task 6).
- Produces: `node build-matrix.mjs <fixtures-dir> <scenarios-dir> [--write]` prints (or writes `matrix.json`):

```ts
interface Matrix {
  v: 1; versions: string[]; scenarios: string[];      // versions sorted numerically
  cells: Record<string, MeasuredCell | UnmeasuredCell>;  // key `<version>/<scenario>`
}
interface UnmeasuredCell { status: 'unmeasured'; reason: string; eventsSeen?: Record<string, number> }
type Share = 'all' | 'some' | 'none' | null;   // null: nothing of that kind was observed in this run
interface MeasuredCell {
  status: 'measured';
  events: Record<string, { count: number; withAgentId: number; keys: string[] }>;
  labels: string[];                      // the mock entries consumed
  probesMissed: string[];                // probe labels never reached — an outcome
  agentTool: string | null;              // the main loop's PreToolUse tool_name for the Agent call: 'Agent' | 'Task'
  agentIsolationInInput: boolean | null; // that call's tool_input carries `isolation`
  subagentStarts: number;                // SubagentStart events (0 is a MEASURED zero)
  subagentTypes: Array<string | null>;   // their distinct agent_type values
  agentIdNamesWorktree: boolean | null;  // every agent-<id> record left has a SubagentStart whose agent_id is <id>
  metaHasWorktreePath: Share;            // spawnedWithWorktree metas carrying a worktreePath
  recordsWithMeta: Share;                // agent-*/wf_* records left that some meta's worktreePath names
  claudeBase: Share;                     // agent-*/wf_* records carrying a 40-hex CLAUDE_BASE
  claudeBaseIsFirstLog: Share;
  delegatedRecordsLeft: number;          // agent-*/wf_* admin records at the run's end
  otherRecordsLeft: number;              // any other admin record (a raw `git worktree add`)
  otherClaudeBase: Share;
  worktreesLeft: number;                 // entries left in .claude/worktrees
  sessionEnd: { count: number; reasons: Array<string | null> };
  sessionIds: number;                    // distinct payload session_id values in the run
  sessionStarts: Array<[string | null, string | null]>;  // each SessionStart: [source, session ordinal s1, s2, …]
  subagentBash: null | {                 // subagent-side Bash events, found by the scripted `DLG-ACK-` marker
    count: number; withAgentId: number;
    firstSessionId: Share;               // … carrying the run's first session id
    cwdInWorktree: Share;                // … whose cwd is under /rig/repo/.claude/worktrees/
  };
  transcriptNamesAgent: Share;           // SubagentStop transcript named agent-<agent_id>.jsonl
  snapshots: Record<string, string[]>;   // agent-*/wf_* records present at each named snapshot
}
```

  A fixture with no events, with a note naming a timeout, a missing prompt, a missing session id, a missing pid, an
  unknown step or an aborted run, or with 200+ events (the capture arm's cap), is `unmeasured` with that reason and
  carries NO question field — so "never fired" can only be read from a `measured` cell. A missed PROBE is an outcome:
  the cell stays `measured` and lists it in `probesMissed`.

- [ ] **Step 1: Write the failing tests.** Append to `server/test/delegation-rig.test.ts`:

```ts
const BUILD = path.join(RIG, 'build-matrix.mjs');
const FIX = path.resolve(__dirname, 'fixtures/delegation');
const SCEN = path.join(RIG, 'scenarios');
const build = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const fixture = (over: Record<string, unknown>): Record<string, unknown> => ({
  v: 1, version: '2.1.1', scenario: 's', labels: [], notes: [], events: [],
  disk: { admin: {}, worktreesLeft: [], branches: [], worktreeList: '', metas: {}, snapshots: {} }, ...over,
});
const ev = (seq: number, event: string, payload: Record<string, unknown>) => ({ seq, dtMs: seq, event, envSid: 'u', payload });

describe('build-matrix.mjs (the corpus -> matrix.json, derived)', () => {
  function corpus(): { fix: string; scen: string } {
    const fix = mkTmp('ccrc-dlg-mx-');
    const scen = mkTmp('ccrc-dlg-sc-');
    for (const s of ['measured', 'failed', 'missing', 'probe']) fs.writeFileSync(path.join(scen, `${s}.json`), '{}');
    for (const v of ['2.1.9', '2.1.10']) {
      fs.mkdirSync(path.join(fix, v), { recursive: true });
      fs.writeFileSync(path.join(fix, v, 'measured.json'), JSON.stringify(fixture({
        version: v, scenario: 'measured', labels: ['b', 'a'],
        events: [
          ev(1, 'SessionStart', { session_id: 'S', source: 'startup' }),
          ev(2, 'PreToolUse', { session_id: 'S', tool_name: 'Agent', tool_input: { isolation: 'worktree' } }),
          ev(3, 'SubagentStart', { session_id: 'S', agent_id: 'x1', agent_type: 'general-purpose' }),
          ev(4, 'PreToolUse', { session_id: 'S', agent_id: 'x1', tool_name: 'Bash', tool_input: { command: 'echo DLG-ACK-1' }, cwd: '/rig/repo/.claude/worktrees/agent-x1' }),
          ev(5, 'SessionStart', { session_id: 'T', source: 'clear' }),
          // a subagent-side Bash event WITHOUT agent_id: found by its DLG-ACK- marker all the same
          ev(6, 'PostToolUse', { session_id: 'S', tool_name: 'Bash', tool_input: { command: 'echo DLG-ACK-1' }, cwd: '/rig/repo/.claude/worktrees/agent-x1' }),
        ],
        disk: {
          admin: {
            'agent-x1': { files: [], gitdir: '/rig/repo/.claude/worktrees/agent-x1/.git', head: 'h', claudeBase: 'a'.repeat(40), locked: false, firstLogSha: 'a'.repeat(40) },
            'raw-wt': { files: [], gitdir: '/rig/raw-wt/.git', head: 'h', claudeBase: null, locked: false, firstLogSha: 'c'.repeat(40) },
          },
          worktreesLeft: ['agent-x1'], branches: [], worktreeList: '',
          metas: { m: { spawnedWithWorktree: true, worktreePath: '/rig/repo/.claude/worktrees/agent-x1' } },
          snapshots: { 'before-kill': { adminRecords: ['agent-x1', 'raw-wt'], worktrees: ['agent-x1'] } },
        },
      })));
      fs.writeFileSync(path.join(fix, v, 'failed.json'), JSON.stringify(fixture({
        version: v, scenario: 'failed', notes: ['waitLabels ["x"]: timeout'], events: [ev(1, 'SessionStart', { session_id: 'S' })],
      })));
      fs.writeFileSync(path.join(fix, v, 'probe.json'), JSON.stringify(fixture({
        version: v, scenario: 'probe', notes: ['probe ["r1-resumed"]: not reached'], events: [ev(1, 'SessionStart', { session_id: 'S' })],
      })));
    }
    return { fix, scen };
  }

  it('a failed run is unmeasured with no question field; a measured zero is a zero; a missed probe is an outcome', () => {
    const { fix, scen } = corpus();
    const r = build([fix, scen]);
    expect(r.status, r.stderr).toBe(0);
    const m = JSON.parse(r.stdout);
    expect(m.cells['2.1.9/failed']).toEqual({ status: 'unmeasured', reason: 'waitLabels ["x"]: timeout', eventsSeen: { SessionStart: 1 } });
    expect(m.cells['2.1.9/missing']).toEqual({ status: 'unmeasured', reason: 'no fixture' });
    expect(m.cells['2.1.9/probe']).toMatchObject({ status: 'measured', probesMissed: ['r1-resumed'], subagentStarts: 0 });
  });

  it('derives the per-question fields from payloads and disk', () => {
    const { fix, scen } = corpus();
    const c = JSON.parse(build([fix, scen]).stdout).cells['2.1.10/measured'];
    expect(c).toMatchObject({
      labels: ['a', 'b'], agentTool: 'Agent', agentIsolationInInput: true, subagentStarts: 1, subagentTypes: ['general-purpose'],
      agentIdNamesWorktree: true, metaHasWorktreePath: 'all', recordsWithMeta: 'all', claudeBase: 'all', claudeBaseIsFirstLog: 'all',
      delegatedRecordsLeft: 1, otherRecordsLeft: 1, otherClaudeBase: 'none', worktreesLeft: 1,
      sessionEnd: { count: 0, reasons: [] }, sessionIds: 2, sessionStarts: [['startup', 's1'], ['clear', 's2']],
      subagentBash: { count: 2, withAgentId: 1, firstSessionId: 'all', cwdInWorktree: 'all' },
      snapshots: { 'before-kill': ['agent-x1'] },
    });
  });

  it('sorts versions numerically and lists every scenario of the scenarios directory', () => {
    const { fix, scen } = corpus();
    const m = JSON.parse(build([fix, scen]).stdout);
    expect(m.versions).toEqual(['2.1.9', '2.1.10']);
    expect(m.scenarios).toEqual(['failed', 'measured', 'missing', 'probe']);
    expect(Object.keys(m.cells)).toHaveLength(8);
  });

  it('refuses bad arguments with exit 2', () => {
    expect(build([]).status).toBe(2);
    expect(build(['a', 'b', '--bogus']).status).toBe(2);
  });

  it('the committed matrix.json is exactly what the builder derives from the committed corpus', () => {
    const r = build([FIX, SCEN]);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(FIX, 'matrix.json'), 'utf8')).toBe(r.stdout);
  });

  it('the committed corpus covers every scenario on at least one version, and carries no residue', () => {
    const m = JSON.parse(fs.readFileSync(path.join(FIX, 'matrix.json'), 'utf8'));
    expect(m.versions.length).toBeGreaterThan(0);
    for (const s of m.scenarios) {
      expect(m.versions.some((v: string) => m.cells[`${v}/${s}`].status === 'measured'), s).toBe(true);
    }
    for (const v of m.versions) for (const s of m.scenarios) {
      const f = path.join(FIX, v, `${s}.json`);
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      for (const bad of ['/tmp/', '/home/', '/Users/', '/var/folders/', '/mnt/', 'ccrc-dlg-rig', 'sk-ant-']) expect(text.includes(bad), `${v}/${s}: ${bad}`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run them red.** `cd server && ./node_modules/.bin/vitest run test/delegation-rig.test.ts -t build-matrix` —
  all six rows red (no builder; no `matrix.json`).

- [ ] **Step 3: Implement.** Create `server/test/delegation-rig/build-matrix.mjs`:

```js
#!/usr/bin/env node
// build-matrix.mjs — the delegation fixture corpus -> matrix.json (delegation broker wave 1, spec
// 2026-10-04 §8.1). DERIVED, never hand-edited: delegation-rig.test.ts compares the committed file
// with this builder's output. A run that did not go as scripted (a timeout, a missing prompt, an
// aborted run, the capture cap) is `unmeasured` and carries no question field, so every value in a
// `measured` cell was observed; inside one, `null` means "not observed in this run", never "unmeasured".
// A PROBE that was not reached (`probe [...]: not reached`) is an outcome, recorded in `probesMissed`.
// Usage: node build-matrix.mjs <fixtures-dir> <scenarios-dir> [--write]
import fs from 'node:fs';
import path from 'node:path';

const [fixDir, scenDir, flag] = process.argv.slice(2);
if (!fixDir || !scenDir || (flag !== undefined && flag !== '--write') || process.argv.length > 5) {
  process.stderr.write('usage: node build-matrix.mjs <fixtures-dir> <scenarios-dir> [--write]\n');
  process.exit(2);
}
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const cmpV = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const FAIL_NOTE = /timeout|no ready prompt|no session id|no pid|unknown step|run aborted/;
const PROBE_NOTE = /^probe (\[.*\]): not reached$/;
const CAPTURE_CAP = 200;
const share = (xs, pred) => (xs.length === 0 ? null : xs.every(pred) ? 'all' : xs.some(pred) ? 'some' : 'none');
const isStr = (v) => typeof v === 'string' && v.length > 0;
const DELEGATED = /^(agent-|wf_)/;

function cell(f) {
  const seen = {};
  for (const e of f.events) seen[e.event] = (seen[e.event] ?? 0) + 1;
  const failed = f.notes.filter((n) => FAIL_NOTE.test(n));
  if (f.events.length === 0) return { status: 'unmeasured', reason: f.notes.join('; ') || 'no events captured', eventsSeen: seen };
  if (failed.length > 0) return { status: 'unmeasured', reason: failed.join('; '), eventsSeen: seen };
  if (f.events.length >= CAPTURE_CAP) return { status: 'unmeasured', reason: 'capture cap reached', eventsSeen: seen };

  const by = {};
  for (const e of f.events) {
    const b = (by[e.event] ??= { count: 0, withAgentId: 0, keys: new Set() });
    b.count += 1;
    if (e.payload && isStr(e.payload.agent_id)) b.withAgentId += 1;
    if (e.payload) for (const k of Object.keys(e.payload)) b.keys.add(k);
  }
  const events = Object.fromEntries(Object.keys(by).sort().map((k) => [k, { count: by[k].count, withAgentId: by[k].withAgentId, keys: [...by[k].keys].sort() }]));
  const withP = f.events.filter((e) => e.payload);
  const sidOrd = new Map();
  const ordOf = (s) => { if (!isStr(s)) return null; if (!sidOrd.has(s)) sidOrd.set(s, `s${sidOrd.size + 1}`); return sidOrd.get(s); };
  for (const e of withP) ordOf(e.payload.session_id);
  const firstSid = withP.map((e) => e.payload.session_id).find(isStr);
  const agentCall = withP.find((e) => e.event === 'PreToolUse' && ['Agent', 'Task'].includes(e.payload.tool_name) && !isStr(e.payload.agent_id));
  const starts = withP.filter((e) => e.event === 'SubagentStart');
  const startIds = new Set(starts.map((e) => e.payload.agent_id).filter(isStr));
  const admin = Object.entries(f.disk.admin);
  const delegated = admin.filter(([n]) => DELEGATED.test(n));
  const others = admin.filter(([n]) => !DELEGATED.test(n));
  const agentRecords = admin.filter(([n]) => n.startsWith('agent-'));
  const metas = Object.values(f.disk.metas).filter((m) => m && m.spawnedWithWorktree === true);
  // Subagent-side Bash calls are found by the SCRIPTED marker in their command (`DLG-ACK-`), not by
  // agent_id — whether they carry an agent_id is one of the questions.
  const acks = withP.filter((e) => (e.event === 'PreToolUse' || e.event === 'PostToolUse') && e.payload.tool_name === 'Bash'
    && typeof e.payload.tool_input?.command === 'string' && e.payload.tool_input.command.includes('DLG-ACK-'));
  const stops = withP.filter((e) => e.event === 'SubagentStop' && isStr(e.payload.agent_transcript_path) && isStr(e.payload.agent_id));
  const ends = withP.filter((e) => e.event === 'SessionEnd');
  const probesMissed = f.notes.map((n) => PROBE_NOTE.exec(n)).filter(Boolean).flatMap((m) => JSON.parse(m[1])).sort();
  const snapshots = Object.fromEntries(Object.entries(f.disk.snapshots ?? {}).sort()
    .map(([k, v]) => [k, (v.adminRecords ?? []).filter((n) => DELEGATED.test(n)).sort()]));
  return {
    status: 'measured',
    events,
    labels: [...f.labels].sort(),
    probesMissed,
    agentTool: agentCall ? agentCall.payload.tool_name : null,
    agentIsolationInInput: agentCall ? Object.prototype.hasOwnProperty.call(agentCall.payload.tool_input ?? {}, 'isolation') : null,
    subagentStarts: starts.length,
    subagentTypes: [...new Set(starts.map((e) => (isStr(e.payload.agent_type) ? e.payload.agent_type : null)))].sort(),
    agentIdNamesWorktree: agentRecords.length === 0 ? null : agentRecords.every(([n]) => startIds.has(n.slice('agent-'.length))),
    metaHasWorktreePath: share(metas, (m) => isStr(m.worktreePath)),
    recordsWithMeta: share(delegated, ([, a]) => metas.some((m) => isStr(m.worktreePath) && a.gitdir === `${m.worktreePath}/.git`)),
    claudeBase: share(delegated, ([, a]) => typeof a.claudeBase === 'string' && /^[0-9a-f]{40}$/.test(a.claudeBase)),
    claudeBaseIsFirstLog: share(delegated, ([, a]) => isStr(a.claudeBase) && a.claudeBase === a.firstLogSha),
    delegatedRecordsLeft: delegated.length,
    otherRecordsLeft: others.length,
    otherClaudeBase: share(others, ([, a]) => isStr(a.claudeBase)),
    worktreesLeft: f.disk.worktreesLeft.length,
    sessionEnd: { count: ends.length, reasons: [...new Set(ends.map((e) => (isStr(e.payload.reason) ? e.payload.reason : null)))].sort() },
    sessionIds: sidOrd.size,
    sessionStarts: withP.filter((e) => e.event === 'SessionStart').map((e) => [isStr(e.payload.source) ? e.payload.source : null, ordOf(e.payload.session_id)]),
    subagentBash: acks.length === 0 ? null : {
      count: acks.length,
      withAgentId: acks.filter((e) => isStr(e.payload.agent_id)).length,
      firstSessionId: share(acks, (e) => e.payload.session_id === firstSid),
      cwdInWorktree: share(acks, (e) => isStr(e.payload.cwd) && e.payload.cwd.startsWith('/rig/repo/.claude/worktrees/')),
    },
    transcriptNamesAgent: share(stops, (e) => path.basename(e.payload.agent_transcript_path) === `agent-${e.payload.agent_id}.jsonl`),
    snapshots,
  };
}

const versions = fs.readdirSync(fixDir).filter((n) => VERSION.test(n) && fs.statSync(path.join(fixDir, n)).isDirectory()).sort(cmpV);
const scenarios = fs.readdirSync(scenDir).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length)).sort();
const cells = {};
for (const v of versions) {
  for (const s of scenarios) {
    let f = null;
    try { f = JSON.parse(fs.readFileSync(path.join(fixDir, v, `${s}.json`), 'utf8')); } catch { f = null; }
    cells[`${v}/${s}`] = f === null ? { status: 'unmeasured', reason: 'no fixture' } : cell(f);
  }
}
const text = `${JSON.stringify({ v: 1, versions, scenarios, cells }, null, 1)}\n`;
if (flag === '--write') fs.writeFileSync(path.join(fixDir, 'matrix.json'), text);
else process.stdout.write(text);
```

  Then write the matrix: `node server/test/delegation-rig/build-matrix.mjs server/test/fixtures/delegation server/test/delegation-rig/scenarios --write`.

- [ ] **Step 4: Run green.** `cd server && ./node_modules/.bin/vitest run test/delegation-rig.test.ts` — all green. If
  "covers every scenario on at least one version" is red, a scenario FAILED (not merely missed a probe) on every
  version: that is a rig defect (Task 6 Step 3), not a matrix one.

- [ ] **Step 5: Mutations.**

| # | Mutation | Expected red |
|---|---|---|
| T7-M1 | the `failed.length > 0` arm deleted (a timed-out run counts as measured) | "a failed run is unmeasured …" |
| T7-M2 | `cmpV` replaced by a string sort | "sorts versions numerically …" |
| T7-M3 | `subagentStarts` reported as `starts.length \|\| null` | "… a measured zero is a zero …" |
| T7-M5 | `PROBE_NOTE` folded into `FAIL_NOTE` (`not reached` added to it) | "… a missed probe is an outcome" |
| T7-M6 | `subagentBash` selects by `agent_id` instead of the `DLG-ACK-` marker | "derives the per-question fields …" (`count: 1`, not 2) |
| T7-M4 | one cell of the committed `matrix.json` edited by hand | "the committed matrix.json is exactly what the builder derives …" |

- [ ] **Step 6: Commit.**

```bash
git add server/test/delegation-rig/build-matrix.mjs server/test/fixtures/delegation/matrix.json server/test/delegation-rig.test.ts
git commit -m "test(fixtures): the delegation matrix, derived from the corpus (delegation broker w1)"
```

---

### Task 8: the on-box census (read-only, path-free)

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `deploy/delegation-census.mjs`
- Create: `server/test/delegation-census.test.ts`
- Modify: `README.md` (one sentence beside the capture-arm paragraph)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `node deploy/delegation-census.mjs --repo <main checkout> [--ccd-root <dir>] --home <config home> [--home …]`
  prints one JSON document — per admin record of the repository, classes, booleans and counts only; never a path, a
  record name, an id, a session uuid or a metadata value — and exits 0; exit 2 with one stderr line on bad arguments.
  Shape:

```ts
interface Census {
  v: 1; adminRead: 'ok' | 'absent' | 'unreadable';
  records: Array<{
    kind: 'agent' | 'wf' | 'other';
    head: 'ref' | 'detached' | 'unreadable' | 'malformed';
    claudeBase: 'ok' | 'absent' | 'malformed';
    baseAgreesFirstLog: boolean | null; movedFromBase: boolean | null; locked: boolean;
    worktreeDir: 'present' | 'absent' | 'unmeasured';
    ageBucket: '<1h' | '<1d' | '<7d' | '>=7d' | 'unmeasured';
    meta: null | { found: boolean; homes: number; uuids: number; worktreePathEquals: boolean | null;
      keys: string[]; parentCwdClass: 'main-checkout' | 'ccd-workspace' | 'other' | 'mixed' | null };
  }>;
  totals: { records: number; agent: number; wf: number; other: number; metaFound: number; metaMissing: number;
    multiHome: number; worktreeAbsent: number; byAge: Record<string, number>; byParent: Record<string, number> };
}
```

- [ ] **Step 1: Write the failing tests.** Create `server/test/delegation-census.test.ts`:

```ts
// deploy/delegation-census.mjs (delegation broker wave 1, spec §8.1 questions 3, 6, 9): a read-only,
// path-free census of one repository's leftover Claude Code worktrees and their subagent metadata.
// Every row runs the real CLI over a fixture repository and fixture config homes.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const CENSUS = path.resolve(__dirname, '../../deploy/delegation-census.mjs');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const munge = (p: string): string => p.replace(/[^A-Za-z0-9]/g, '-');

function world(): { repo: string; ccd: string; h1: string; h2: string } {
  const repo = mkTmp('ccrc-census-repo-');
  const ccd = mkTmp('ccrc-census-ccd-');
  const h1 = mkTmp('ccrc-census-h1-');
  const h2 = mkTmp('ccrc-census-h2-');
  const rec = (name: string, files: Record<string, string>, wt: string | null): void => {
    const a = path.join(repo, '.git', 'worktrees', name);
    fs.mkdirSync(path.join(a, 'logs'), { recursive: true });
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(a, f), body);
    if (wt !== null) { fs.mkdirSync(wt, { recursive: true }); fs.writeFileSync(path.join(a, 'gitdir'), `${wt}/.git\n`); }
  };
  const wtA = path.join(repo, '.claude', 'worktrees', 'agent-abc');
  const wtW = path.join(repo, '.claude', 'worktrees', 'wf_run1-1');
  rec('agent-abc', { HEAD: `${SHA_B}\n`, CLAUDE_BASE: SHA_A, 'logs/HEAD': `${'0'.repeat(40)} ${SHA_A} Rig <you@example.com> 1 +0000\tbranch: Created\n` }, wtA);
  rec('wf_run1-1', { HEAD: 'ref: refs/heads/x\n', CLAUDE_BASE: SHA_A, 'logs/HEAD': `${'0'.repeat(40)} ${SHA_A} R <you@example.com> 1 +0000\tx\n` }, wtW);
  rec('plain', { HEAD: `${SHA_A}\n` }, path.join(repo, '..', 'gone-elsewhere-xyz'));
  fs.rmSync(path.join(repo, '..', 'gone-elsewhere-xyz'), { recursive: true });
  const meta = (home: string, proj: string, rel: string, body: object): void => {
    const f = path.join(home, 'projects', proj, 'uuid-sentinel-1', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(body));
  };
  const agentMeta = { agentType: 'g', description: 'SENTINEL-description', toolUseId: 'toolu_sentinel', worktreePath: wtA, spawnedWithWorktree: true };
  meta(h1, munge(repo), 'subagents/agent-abc.meta.json', agentMeta);
  meta(h2, munge(repo), 'subagents/agent-abc.meta.json', agentMeta);
  meta(h1, munge(path.join(ccd, 'proj', 'slug')), 'subagents/workflows/wf_run1/agent-q.meta.json',
    { workflowPhase: 'p', description: 'SENTINEL-description', worktreePath: wtW, spawnedWithWorktree: true });
  return { repo, ccd, h1, h2 };
}
const census = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [CENSUS, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('delegation-census (read-only, path-free)', () => {
  it('classifies each admin record and finds its metadata across homes', () => {
    const w = world();
    const r = census(['--repo', w.repo, '--ccd-root', w.ccd, '--home', w.h1, '--home', w.h2]);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.adminRead).toBe('ok');
    expect(out.totals).toMatchObject({ records: 3, agent: 1, wf: 1, other: 1, metaFound: 2, metaMissing: 0, multiHome: 1, worktreeAbsent: 1 });
    const agent = out.records.find((x: { kind: string }) => x.kind === 'agent');
    expect(agent).toMatchObject({ head: 'detached', claudeBase: 'ok', baseAgreesFirstLog: true, movedFromBase: true, locked: false, worktreeDir: 'present' });
    expect(agent.meta).toMatchObject({ found: true, homes: 2, uuids: 1, worktreePathEquals: true, parentCwdClass: 'main-checkout' });
    expect(agent.meta.keys).toEqual(['agentType', 'description', 'spawnedWithWorktree', 'toolUseId', 'worktreePath']);
    const wf = out.records.find((x: { kind: string }) => x.kind === 'wf');
    expect(wf).toMatchObject({ head: 'ref', movedFromBase: null });
    expect(wf.meta).toMatchObject({ found: true, homes: 1, parentCwdClass: 'ccd-workspace', worktreePathEquals: true });
    const other = out.records.find((x: { kind: string }) => x.kind === 'other');
    expect(other).toMatchObject({ claudeBase: 'absent', worktreeDir: 'absent', meta: null });
  });

  it('prints no path, record name, id, uuid or metadata value', () => {
    const w = world();
    const r = census(['--repo', w.repo, '--ccd-root', w.ccd, '--home', w.h1, '--home', w.h2]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).totals.records).toBe(3);   // the scan below ran over a real document
    const text = r.stdout;
    for (const bad of [w.repo, w.h1, w.h2, w.ccd, 'abc', 'run1', 'uuid-sentinel-1', 'SENTINEL-description', 'toolu_sentinel', SHA_A, '/tmp/']) {
      expect(text.includes(bad), bad).toBe(false);
    }
  });

  it('reports an absent admin directory as absent, with no records', () => {
    const repo = mkTmp('ccrc-census-empty-');
    fs.mkdirSync(path.join(repo, '.git'));
    const out = JSON.parse(census(['--repo', repo, '--home', mkTmp('ccrc-census-h-')]).stdout);
    expect(out).toMatchObject({ adminRead: 'absent', records: [] });
  });

  it('refuses bad arguments with exit 2, one stderr line and no stdout', () => {
    for (const bad of [[], ['--home', '/x'], ['--repo'], ['--repo', '/x', '--bogus']]) {
      const r = census(bad);
      expect(r.status, bad.join(' ')).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr.trim().split('\n')).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Run them red.** `cd server && ./node_modules/.bin/vitest run test/delegation-census.test.ts` — four rows red
  (no CLI: exit 1, empty stdout).

- [ ] **Step 3: Implement.** Create `deploy/delegation-census.mjs`:

```js
// delegation-census.mjs — a READ-ONLY, path-free census of one repository's leftover Claude Code
// worktrees and their subagent metadata (delegation broker wave 1, spec 2026-10-04 §8.1 questions
// 3, 6 and 9). It reads `<repo>/.git/worktrees/*` and, in each config home given, only the
// `projects/<project>/<uuid>/subagents/` entries that name a record it found. It prints classes,
// booleans and counts — never a path, a record name, an id, a session uuid or a metadata VALUE
// (a description can carry user text); metadata KEY names are printed.
// Usage: node deploy/delegation-census.mjs --repo <main checkout> [--ccd-root <dir>] --home <dir> [--home <dir>]...
import fs from 'node:fs';
import path from 'node:path';

const usage = () => { process.stderr.write('usage: node deploy/delegation-census.mjs --repo <main checkout> [--ccd-root <dir>] --home <dir> [--home <dir>]...\n'); process.exit(2); };
let repo = null;
let ccdRoot = null;
const homes = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const v = argv[i + 1];
  if (typeof v !== 'string' || v === '') usage();
  if (argv[i] === '--repo' && repo === null) repo = v;
  else if (argv[i] === '--ccd-root' && ccdRoot === null) ccdRoot = v;
  else if (argv[i] === '--home') homes.push(v);
  else usage();
}
if (repo === null || homes.length === 0) usage();

const SHA = /^[0-9a-f]{40}$/;
const KEY = /^[A-Za-z0-9_]{1,40}$/;
const munge = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const text = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const json = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const exists = (f) => { try { fs.statSync(f); return true; } catch { return false; } };

const admin = path.join(repo, '.git', 'worktrees');
let adminRead = 'ok';
let names = [];
try { names = fs.readdirSync(admin).sort(); } catch (e) { adminRead = e.code === 'ENOENT' ? 'absent' : 'unreadable'; }

const wantAgent = new Set(names.filter((n) => /^agent-[A-Za-z0-9]+$/.test(n)).map((n) => n.slice('agent-'.length)));
const wantRun = new Set(names.map((n) => /^(wf_[A-Za-z0-9-]+)-[0-9]+$/.exec(n)).filter(Boolean).map((m) => m[1]));
const agentMetas = new Map();
const wfMetas = new Map();
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
if (wantAgent.size + wantRun.size > 0) {
  for (const home of homes) {
    const projects = path.join(home, 'projects');
    for (const proj of ls(projects)) {
      for (const uuid of ls(path.join(projects, proj))) {
        const sub = path.join(projects, proj, uuid, 'subagents');
        const entries = ls(sub);
        for (const e of entries) {
          const m = /^agent-([A-Za-z0-9]+)\.meta\.json$/.exec(e);
          if (m && wantAgent.has(m[1])) push(agentMetas, m[1], { home, proj, uuid, meta: json(path.join(sub, e)) });
        }
        if (!entries.includes('workflows')) continue;
        for (const run of ls(path.join(sub, 'workflows'))) {
          if (!wantRun.has(run)) continue;
          for (const e of ls(path.join(sub, 'workflows', run))) {
            if (!e.endsWith('.meta.json')) continue;
            const meta = json(path.join(sub, 'workflows', run, e));
            if (meta && typeof meta.worktreePath === 'string') push(wfMetas, meta.worktreePath, { home, proj, uuid, meta });
          }
        }
      }
    }
  }
}

const parentClass = (proj) => {
  if (proj === munge(repo)) return 'main-checkout';
  if (ccdRoot !== null && proj.startsWith(`${munge(ccdRoot)}-`)) return 'ccd-workspace';
  return 'other';
};
function metaSummary(list, wt) {
  if (list === undefined || list.length === 0) return { found: false, homes: 0, uuids: 0, worktreePathEquals: null, keys: [], parentCwdClass: null };
  const keys = new Set();
  for (const x of list) if (x.meta && typeof x.meta === 'object') for (const k of Object.keys(x.meta)) keys.add(KEY.test(k) ? k : '(unprintable)');
  const classes = new Set(list.map((x) => parentClass(x.proj)));
  return {
    found: true, homes: new Set(list.map((x) => x.home)).size, uuids: new Set(list.map((x) => x.uuid)).size,
    worktreePathEquals: wt === null ? null : list.every((x) => x.meta?.worktreePath === wt),
    keys: [...keys].sort(), parentCwdClass: classes.size === 1 ? [...classes][0] : 'mixed',
  };
}
const ageBucket = (dir) => {
  let ms;
  try { ms = fs.statSync(dir).mtimeMs; } catch { return 'unmeasured'; }
  const h = (Date.now() - ms) / 3_600_000;
  return h < 1 ? '<1h' : h < 24 ? '<1d' : h < 168 ? '<7d' : '>=7d';
};

const records = [];
for (const n of names) {
  const a = path.join(admin, n);
  const kind = /^agent-[A-Za-z0-9]+$/.test(n) ? 'agent' : /^wf_[A-Za-z0-9-]+-[0-9]+$/.test(n) ? 'wf' : 'other';
  const gd = text(path.join(a, 'gitdir'));
  const wt = gd === null ? null : path.dirname(gd.trim());
  const headTxt = text(path.join(a, 'HEAD'));
  const head = headTxt === null ? 'unreadable' : /^ref: /.test(headTxt) ? 'ref' : SHA.test(headTxt.trim()) ? 'detached' : 'malformed';
  const baseTxt = text(path.join(a, 'CLAUDE_BASE'));
  const base = baseTxt !== null && SHA.test(baseTxt.trim()) ? baseTxt.trim() : null;
  const firstLine = (text(path.join(a, 'logs', 'HEAD')) ?? '').split('\n')[0];
  const firstLog = firstLine.split(' ')[1] ?? null;
  records.push({
    kind, head,
    claudeBase: baseTxt === null ? 'absent' : base === null ? 'malformed' : 'ok',
    baseAgreesFirstLog: base !== null && firstLog !== null && SHA.test(firstLog) ? base === firstLog : null,
    movedFromBase: base !== null && head === 'detached' ? headTxt.trim() !== base : null,
    locked: exists(path.join(a, 'locked')),
    worktreeDir: wt === null ? 'unmeasured' : exists(wt) ? 'present' : 'absent',
    ageBucket: ageBucket(a),
    meta: kind === 'agent' ? metaSummary(agentMetas.get(n.slice('agent-'.length)), wt)
      : kind === 'wf' ? metaSummary(wt === null ? undefined : wfMetas.get(wt), wt) : null,
  });
}
const count = (pred) => records.filter(pred).length;
const tally = (f) => { const t = {}; for (const r of records) { const k = f(r); if (k !== null) t[k] = (t[k] ?? 0) + 1; } return t; };
const out = {
  v: 1, adminRead, records,
  totals: {
    records: records.length, agent: count((r) => r.kind === 'agent'), wf: count((r) => r.kind === 'wf'), other: count((r) => r.kind === 'other'),
    metaFound: count((r) => r.meta?.found === true), metaMissing: count((r) => r.meta !== null && !r.meta.found),
    multiHome: count((r) => (r.meta?.homes ?? 0) > 1), worktreeAbsent: count((r) => r.worktreeDir === 'absent'),
    byAge: tally((r) => r.ageBucket), byParent: tally((r) => r.meta?.parentCwdClass ?? null),
  },
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
```

  `README.md`: in the capture section's paragraph (the heading Task 1 anchored on), add: "`deploy/delegation-census.mjs` is a read-only, path-free census
  of one repository's leftover Agent/Workflow worktrees and their subagent metadata (delegation broker wave 1)."

- [ ] **Step 4: Run green.** `cd server && ./node_modules/.bin/vitest run test/delegation-census.test.ts test/topology-clean.test.ts` — green.

- [ ] **Step 5: Run it on the fleet box (measurement, read-only).** For each project under the projects root with an
  `agent-*` or `wf_*` admin record. Project NAMES are operator data and never reach a commit: the census output is
  keyed by an ordinal (`this repo`, `project-1`, `project-2`, …), and the name-to-ordinal map stays in the scratchpad.

```bash
n=0
for d in "$PROJECTS_ROOT"/*/.git/worktrees; do
  c=$(ls "$d" 2>/dev/null | grep -cE '^(agent-|wf_)'); [ "$c" -gt 0 ] || continue
  repo=${d%/.git/worktrees}
  if [ "$repo" = "$(git rev-parse --path-format=absolute --git-common-dir | sed 's#/.git$##')" ]; then label="this-repo"; else n=$((n+1)); label="project-$n"; fi
  printf '%s\t%s\n' "$label" "$repo" >> "$SCRATCH/census-map.tsv"
  HOMES=(); for h in "$HOME"/.claude*/; do [ -d "$h/projects" ] && HOMES+=(--home "${h%/}"); done
  node deploy/delegation-census.mjs --repo "$repo" --ccd-root "<the ccd worktrees root>" "${HOMES[@]}" > "$SCRATCH/census-$label.json"
  printf '%s ' "$label"; jq -c '.totals' "$SCRATCH/census-$label.json"
done
```

  (`$PROJECTS_ROOT`, the ccd worktrees root and `$SCRATCH` are the worker's own box values; nothing is written outside
  `$SCRATCH`.) Keep only each label's `.totals` for Task 9.

- [ ] **Step 6: Mutations.**

| # | Mutation | Expected red |
|---|---|---|
| T8-M1 | a record's `name` added to its output object | "prints no path, record name, id …" |
| T8-M2 | `keys` filled from metadata VALUES | with D-4008's key allow-list every value maps to `(unprintable)`, so the key-equality rows go red — "classifies each admin record …", "prints only allow-listed meta key names …", "marks an unparsable agent meta malformed …" (3, measured at `fc2dd5ee9`) — and the "prints no …" privacy row stays green |
| T8-M3 | `uuids` counted per meta file (`list.length`) instead of per distinct uuid | "classifies each admin record …" (`uuids: 1` becomes 2: the same session's file under two homes) |
| T8-M4 | the `--repo`-required refusal deleted | "refuses bad arguments …" |

- [ ] **Step 7: Commit.**

```bash
git add deploy/delegation-census.mjs server/test/delegation-census.test.ts README.md
git commit -m "feat(census): a read-only, path-free census of leftover delegated worktrees (delegation broker w1)"
```

---

### Task 9: the measurement write-up

**Model routing:** `opus`, effort `high` — the amendments are judgment.

**Files:**
- Modify: `docs/superpowers/programs/delegation-broker.md` (the "Measurement matrix" section only)

**Interfaces:**
- Consumes: `matrix.json` (Task 7), the census totals (Task 8), and Step 2's listing cost.
- Produces: the section waves 2–6 plan from: per spec §8.1 question, per version, the measured answer or
  `unmeasured`; the census totals; and a list of AMENDMENTS — each a slug plus one sentence naming the spec rule the
  measurement contradicts or narrows.

- [ ] **Step 1: Extract the answers.** For each version `V` in `matrix.json` (status FIRST: a non-measured cell is
  `unmeasured`; inside a measured cell `null` is "not observed" and `[]` is "none"):

```bash
M=server/test/fixtures/delegation/matrix.json
jq -r --arg v "$V" '
  def show: if . == null then "not observed" elif type == "array" then (if length == 0 then "none" else map(tojson) | join(" ") end) else tojson end;
  def q($s; f): .cells[$v + "/" + $s] as $c | if $c == null or $c.status != "measured" then "unmeasured" else ($c | f | show) end;
  [ "Q1 SubagentStart count, types (wf-plain)", q("wf-plain"; .subagentStarts), q("wf-plain"; .subagentTypes) ],
  [ "Q1 SubagentStart count (wf-iso)", q("wf-iso"; .subagentStarts) ],
  [ "Q2 Agent tool name", q("agent-plain"; .agentTool) ],
  [ "Q2 isolation in PreToolUse input", q("agent-iso-unchanged"; .agentIsolationInInput) ],
  [ "Q3 agent_id names agent-<id>", q("agent-iso-changed"; .agentIdNamesWorktree) ],
  [ "Q3 meta carries worktreePath (agent, wf)", q("agent-iso-changed"; .metaHasWorktreePath), q("wf-iso"; .metaHasWorktreePath) ],
  [ "Q3 records named by a meta (agent, wf)", q("agent-iso-changed"; .recordsWithMeta), q("wf-iso"; .recordsWithMeta) ],
  [ "Q3 CLAUDE_BASE (agent, wf, raw)", q("agent-iso-changed"; .claudeBase), q("wf-iso"; .claudeBase), q("raw-worktree"; .otherClaudeBase) ],
  [ "Q4 subagent Bash: count, with agent_id", q("agent-plain"; .subagentBash.count), q("agent-plain"; .subagentBash.withAgentId) ],
  [ "Q4 subagent Bash: first session id, cwd in worktree", q("agent-plain"; .subagentBash.firstSessionId), q("agent-iso-changed"; .subagentBash.cwdInWorktree) ],
  [ "Q5 SessionStarts (clear/compact/resume)", q("clear-compact-resume"; .sessionStarts) ],
  [ "Q5 SessionStarts (swap)", q("swap-resume"; .sessionStarts) ],
  [ "Q6 left: unchanged/changed/dirty/bg/killed/interrupted/raw",
     q("agent-iso-unchanged"; .worktreesLeft), q("agent-iso-changed"; .worktreesLeft), q("agent-iso-dirty"; .worktreesLeft),
     q("agent-iso-bg"; .worktreesLeft), q("parent-kill"; .worktreesLeft), q("interrupt-exit"; .worktreesLeft), q("raw-worktree"; .otherRecordsLeft) ],
  [ "Q6 SessionEnd reasons (interrupt-exit, parent-kill)", q("interrupt-exit"; .sessionEnd.reasons), q("parent-kill"; .sessionEnd.count) ],
  [ "Q7 resume: probes missed, records before kill, records at end", q("wf-iso-resume"; .probesMissed), q("wf-iso-resume"; .snapshots["before-kill"]), q("wf-iso-resume"; .delegatedRecordsLeft) ],
  [ "Q7 five-hour pause: probes missed", q("wf-limit-pause"; .probesMissed) ]
  | @tsv' "$M"
```

  For Q7: a `probesMissed` of `none` means the workflow resumed (or the paused agent re-ran); the before-kill record
  list against the end state says whether the worktrees were reused. A missed probe is recorded as "did not
  resume / was not re-run within the probe window", never as "cannot".

- [ ] **Step 2: Measure Q8 (the hook-side costs)** with the repository holding the most admin records, in the
  scratchpad only:

```bash
d="<repo with the most records>"
bash -c 'TIMEFORMAT=%R; time (for i in $(seq 1000); do a=("'"$d"'/.git/worktrees"/*); done)' 2>&1 | tail -n1            # the listing
bash -c 'TIMEFORMAT=%R; time (for i in $(seq 1000); do IFS= read -r l < "'"$d"'/.git" 2>/dev/null || [[ -d "'"$d"'/.git" ]]; done)' 2>&1 | tail -n1   # finding the common dir, no fork
f="$SCRATCH/spool-bench"; line=$(printf '%01024d' 0)
bash -c 'TIMEFORMAT=%R; time (for i in $(seq 1000); do printf "%s\n" "'"$line"'" >> "'"$f"'"; done)' 2>&1 | tail -n1    # one ~1 KiB spool append
rm -f "$f"
```

  Record seconds per 1000 for each, and the record count; the budget they are compared against is the PostToolUse
  p95 of 150 ms pinned in `session-hook.test.ts`. The spool numbers are a micro-benchmark of the operations, not of
  the wave-2 hook itself (`q8-spool-cost-is-a-micro-benchmark`).

- [ ] **Step 3: Q9 and Q10.** Q9: each label's census `totals.byParent`. `main-checkout` is ALSO where every ccd
  `<wrapper>-<project>` session runs, so the census cannot tell a ccd parent from a non-ccd one; record Q9 as a proxy
  (`q9-parent-class-is-a-proxy`) — wave 2's spool answers it exactly (a tree whose parent wrote no spool line had a
  non-ccd parent). Q10: answered from source — `$REG/<id>.generation` (D-2605) is minted once at row creation and
  never rewritten; the hook reads its value from `CCRC_SESSION_GENERATION` (`_hook_generation_ok`, `ccd/session-hook.sh`),
  which ccd does not set on every spawn path, so wave 2 reads the FILE, not the variable.

- [ ] **Step 4: Write the section.** Replace the body of "## Measurement matrix" in
  `docs/superpowers/programs/delegation-broker.md` with: the versions covered (and any fleet lane version NOT covered);
  one table, questions × versions, from Step 1, with a note mapping each scenario to its spec §8.1 source (Agent,
  isolated Agent, Workflow worker, isolated Workflow worker, raw `git worktree add`); Step 2's costs; the census totals
  per LABEL (`this-repo`, `project-<n>` — never a project name or path); Q9 as a proxy and Q10; and "### Amendments the measurement forces" — one bullet per contradiction, `slug — sentence
  — spec §`. Example of the form (not a prediction): `workflow-agents-fire-no-subagentstart — on 2.1.28x Workflow agents
  emit no SubagentStart, so rung 2 links a wf_ tree by the workflow transcript lookup alone — spec §5.4 rung 2`.
  Never quote a payload value.

- [ ] **Step 5: Verify and commit.**

```bash
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts test/deviation-refs.test.ts
git add docs/superpowers/programs/delegation-broker.md
git commit -m "docs(delegation-broker): the wave-1 measurement matrix and its amendments"
```

---

## Handoff gate

- [ ] `git fetch origin main`, then from `server/`, in the foreground, each with a timeout ≥ 600000 ms:
  `./node_modules/.bin/vitest run test/session-hook-turnmark.test.ts test/install-session-hooks.test.ts test/hook-capture-reduce.test.ts test/delegation-rig.test.ts test/delegation-census.test.ts test/topology-clean.test.ts test/deviation-refs.test.ts test/single-definition.test.ts`
  and `./node_modules/.bin/vitest run test/session-hook.test.ts` (alone: a known load flake — re-run in isolation
  before calling a red real).
- [ ] The full server suite, sharded as the box allows; any red is reproduced in isolation and named in the wave-done.
- [ ] Every mutation row below measured red and restored; the measured cells recorded in the wave-done mail.
- [ ] `git status` clean; no raw bundle, capture file or scratch output in the tree. `bash server/test/delegation-rig/rig.sh reap`,
  then `ls -d "$(bash server/test/delegation-rig/rig.sh run-base)"/ccrc-dlg-rig.* "${TMPDIR:-/tmp}"/ccrc-dlg-rig.*` (both
  places a run root can be made, D-4003) and `ls "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)/" | grep '^dlg'` print nothing.
  The capture's raw root (`ccrc-dlg-raw.*`, UNSANITISED) is never in the tree; the rig's README says where it may
  live, that a box `/tmp` reaper may remove it, and how to remove it.
- [ ] The wave-done fingerprint names the workspace branch tip; the PR body lists the versions covered and the
  departures by slug.

## Mutation table

**Wave numbers in this plan (the 2026-10-07 renumbering, #313).** The programme was six waves and is now seven: the
measurement close-out (run 306) is wave 2, and the observe stage, which was wave 2, is wave 3, so the old waves 3 to 6
are now 4 to 7. A "wave 2" here means the close-out where the passage is marked as the close-out's: the "Wave 2
close-out (review 304)" and "Wave 2 fix round (review 318)" sub-tables below, any passage that cites review 304 or
review 318, and, wherever they stand, "wave 2's close-out", "wave 2's tree", "Corrected in wave 2", "Extended in
wave 2" and "reworded in wave 2". Every other "wave 2" in this plan was written before 2026-10-07 and means the
observe stage, now wave 3, and every other "wave 3" to "wave 6" there is one lower than today's number. Those
passages stay as the dated snapshots they are; a sentence that could be read either way says which.

Each row was given in its task; this is the index the wave-done reports against.

| Task | Rows | Guards |
|---|---|---|
| 1 | T1-M1 … T1-M6 | SessionEnd registered; its arm present; inert: no hookstate (T1-M3) and no marker (T1-M6); declared under `set -u`; no Worktree* registration |
| 2 | T2-M1 … T2-M8 | fixed tool-name set; key names not values; isolation as a token; ordinals not ids; cwd as a label; `--root` refusal; reason enum; Bash keys never printed |
| 3 | T3-M1 … T3-M4 | `nameAny`; consumed labels; `$NOW+<s>`; `MOCK_SCRIPT` required |
| 4 | T4-M1 … T4-M8 | root guard (HOME clause, `//`); socket guard; setup guarded; no bare `tmux`; ccrc's installer registers the hook; scenario key names; reap spares a live owner |
| 5 | T5-M1 … T5-M6 | munged root and binaries dir replaced; nothing written on a finding; a key named by index; user residue; the path allowlist |
| 7 | T7-M1 … T7-M6 | failed → unmeasured; numeric version order; measured zero; matrix not hand-edited; a missed probe is an outcome; subagent Bash by marker |
| 8 | T8-M1 … T8-M4 | no name; key names not values; distinct uuids (T8-M3; distinct homes is fix round 1's row below); `--repo` required |

**Fix round 1 (review 277).** Rows added for guards that had none, each measured red by deleting its arm alone (a
guard that cannot have a row says so); the wave-done reports the cells.

| Task | Finding | Guard | Row |
|---|---|---|---|
| 1 | F32 | SessionEnd writes no turn marker | T1-M6 (above) |
| 2 | F3 | `seg` on the delegation block's top-level key names | "prints a hostile or over-long top-level key of an Agent or Workflow input or response as (unprintable), never the key" |
| 2 | F3 | the id-keyed or over-wide map collapse | "prints an id-keyed or over-wide Agent or Workflow input or response as the single (map) token, never a key" |
| 2 | F3 (task B review) | a non-object input or response prints as its JSON type | "prints a non-object Agent, Task or Workflow input or response as its JSON type, never the value" |
| 2 | F15 | `--root` normalised, and a root of `/` refused (D-4064) | "refuses a --root that normalises to the filesystem root …" |
| 4 | F10a | `cmd_setup`'s spelling guard (T4-M3, now red as worded) | "setup refuses a root by its SPELLING alone (relative, a `..` segment, a trailing slash) when its physical path is acceptable, and creates nothing there (F10a)" |
| 4 | F10b | `guard_root`'s spelling arm (T4-M1, now red as worded) and its physical-HOME arm | "guard-root refuses a root under HOME by either spelling: HOME spelled through a symlink refuses the link spelling and the physical path alike (F10b)" |
| 4 | F10c | `cleanup_run` calls `wait_run_quiet`, and keeps a root it cannot measure without `/proc` (D-4010, D-4061) | the two rows of the "cleanup_run (F10c …)" describe, Linux-only |
| 4 | F10d | `wait_run_quiet` waits within its bound before it kills (D-4010) | "wait_run_quiet WAITS, within its bound, for a process under the root that exits on its own: it is never signalled (F10d)" |
| 4 | F10e | the fixture `settings.json`'s `disableAutoMode` (D-4004) | the setup row, "builds the fixture HOME and repo under its root, …" |
| 4 | F10g | the ready footer: each alternative, never the version banner (D-4004) | the two rows of the "rig.sh wait_ready (F10g …)" describe |
| 4 | F10g | `cleanup_run` removes its own socket file, and only that one (D-4004) | "cleanup_run's rm removes its own socket file, and only that one: a neighbour's and `default` stay (F10g)" |
| 4 | F10h | reap's numeric-pid filter on `dlg<pid>` sockets (D-4004) | "reap keeps a socket named dlg plus anything but digits: only a numeric pid can name a dead owner (F10h)" |
| 4 | F10f | reap's foreign-owner skip (`! -O`, D-4006) | none: untestable without a second uid (D-4062) |
| 5 | F1 | a path after an allowed loopback host is scanned; only the URL's end, `:<digits>` or a `/`-path may follow (D-4007) | the F1a row, and the userinfo, non-numeric port, glued name, `?`/`#`/`\`, and end-character rows; "the loopback port is read AT the host, not anywhere after it …"; "a path after the loopback `/` whose first segment is outside the allowlist or glued to a character outside the class is residue …" |
| 5 | F1 | an allowed top at a host position takes the loopback rule without a port; a `//` before a character that cannot start a name is residue (D-4007) | "an allowed top used as a HOST gets the loopback rule without a port …"; "a `//` at a host position followed by a character that cannot start a name is residue …"; "a `//`-led path whose first segment is an allowed top passes …" |
| 5 | F1 | an allowed top is a whole segment: only `/`, `:`, the end or a URL/word ender may follow it (D-4007) | "an allowed top glued to a character outside the segment class is residue …"; "what may follow an allowed top …" |
| 5 | F1, F2 | `/dev/null` exempt only as the whole path, with nothing path-like after it | the two `/dev/null` rows (F1b, F2a); "`/dev/null` glued to a character outside the segment class is residue …"; "`/dev/null` is a first segment exemption only …" |
| 5 | F2 | the `\/` escape | "fails closed on a JSON-escaped slash …" (F2b); "scans the decoded spelling of a JSON-escaped slash …" (N1) |
| 5 | F13 | every destination checked before anything moves: not a regular file, unreadable, an unwritable version directory, an unwritable fixtures directory | "writes NOTHING when a later version directory holds a directory or a link where a fixture file would go …"; "a destination it cannot look at is not an absent one …"; "a version directory that exists but cannot be written is refused …"; "a fixtures directory that cannot be written, when a version directory has to be created in it, is refused …" (the last three skipped as root); "refuses a symbolic link where a version directory would go, before any version moves …" (N2) |
| 7 | F9 | rig.sh's notes are all read and decided: two outcomes and the failures (six in fix round 1, seven from fix round 2, D-4058) | "rig.sh writes nine notes, every one read here, each decided: two outcomes (a probe, a dialog) and seven failures" (fix round 1's "eight notes … six failures", retitled in fix round 2); the scanner's own row |
| 7 | F9 | each `FAIL_NOTE` alternative, fed from rig.sh's own note text (D-4060) | "rig.sh writes %j: a run carrying it is unmeasured …" (one row per failure note) |
| 7 | F9 | the start anchor: a failure quoted in an outcome is no failure (D-4060) | "FAIL_NOTE is anchored: %j quoted inside a dialog's text or a probe's label …" (one row per failure note) |
| 7 | F9 | no end anchor: a failure note with text after it stays a failure (D-4060) | "rig.sh writes %j with text after it: the run is still unmeasured" (one row per failure note) |
| 7 | F9 | an outcome note keeps the run measured | "rig.sh writes %j: an outcome, so the run stays measured …" (the probe and the dialog note) |
| 7 | F35 | each `shaped()` clause: `notes`, `labels`, `disk`, `disk.admin`, `disk.worktreesLeft`, `disk.metas` (D-4009) | "a fixture whose %s is missing, null or mistyped is unreadable …" (one row per field), with the control row "each shaped() row's fixture, with the right shape in the field, is measured …" |
| 7 | F35 | `shaped()`'s `typeof f === 'object'` | none: an equivalent mutant (`JSON.parse` yields no non-null non-object with an array `events`) |
| 8 | F11 | ENOTDIR is "nothing there" | "treats a <uuid>.jsonl file beside a <uuid>/ dir as nothing there, not as an unreadable home" |
| 8 | F11 | distinct homes | "counts distinct homes: two metas for one record under the same home are one home, not multiHome" |
| 8 | F14 | a `ref:` HEAD resolved read-only, `'unmeasured'` when it cannot be (D-4065) | the `movedFromBase` describe |

**Fix round 2 (review 296).** Every guard arm the round added or touched, each measured red by mutating that arm alone
in a scratch copy. The counts are the implementers', over the filter each task ran (the sanitiser's: its block and the
corpus row), unless a row names another run, and each is the count AT THE COMMIT it was taken at: a guard's row set
grows as later rows land, so the same mutation re-measured at a later commit can red more rows. Each task's reviewer
re-measured them, task A's follow-up arms (`12f7c4aac`) included: its re-review ran 26 mutations of its own.

Review 304 re-measured the rows at `3efb0ac37`. Every count its report lists reproduced exactly except five, which came
out higher and never lower (the old `%2F`-only decode 6 to 7, the closing-tag lookahead 8 to 9, `--scan`'s scan call 6
to 7, pointer findings named by text 4 to 5, every lstat failure null 1 to 2), and the F11 block-wide counts, which
read differently because they are dated by their row counts (73 rows at `858caf47d`, 77 at `3efb0ac37`: a letter 39, a
digit 40 and `.` 3 where the plan has 37, 38 and 2). Its report lists no re-run of three figures: the 14 that task A's
review found a broader base64 decode to red, and the two taken at `858caf47d` (the `\u` half's 0, and the first two m4
deletions reddening nothing), which no later tree reproduces. Each of the five cells below gives both numbers and names
the extra row, and the F11 cell gives both row counts. The dated number of each of the five was re-run at its dated
commit in wave 2's close-out, and the F11 counts were re-run at `858caf47d`.

A commit beside a count means one of two things. "at X" is a commit the count was measured at, by the cell's own words
or by a re-run. "written at X" is only the commit whose plan text first carried the count: the implementer's own run
may be a task commit earlier, and what is established is what the plan says and when. No count here is re-measured on
wave 2's tree.

Two counts carry no task reviewer's re-run in fix round 2, and their rows say so: the residue-bearing-key arm's and the
implementer's base64 decode (task A's review measured both with mutations of its own, and review 304 reproduced both:
3 and 1). Two rows are the controller's measurements: Task 8's ENOTDIR fold (re-run by the write-up's reviewer: 1 red
of 27) and the `--scan` file index row (first `a4d1da74f`, hardened after the write-up's re-review 2 to plant every
fixture of a version; its counts are in its row). From `12f7c4aac` every known limit the sanitiser's header declares is
pinned by a row that reds when the limit closes (at `858caf47d` the `\u` half of the one-pass limit was not: 0 red,
task A's review).

| Task | Finding | Guard | Row |
|---|---|---|---|
| 4 | F2 | `answerDialog`'s else arm: a dialog that never shows is a failure note, and nothing is pressed (D-4058) | "answerDialog: a dialog that never appears sends no key and writes a failure note, so the run is unmeasured and not a measured zero (F2)" and the notes census "rig.sh writes nine notes …" (the else line deleted: 2 red, written at `0d38a6549`) |
| 7 | F2 | `FAIL_NOTE`'s `answerDialog: no dialog:` alternative (D-4058) | "answerDialog: a dialog that never appears …", and for the new note the "rig.sh writes %j: a run carrying it is unmeasured …" row and its "with text after it" twin (the alternative removed: 3 red, written at `0d38a6549`) |
| 4 | F2 (task B review C1) | an `answerDialog` step only where every committed fixture of its scenario recorded it answered, and interrupt-exit's answered in every version (D-4058, `wf-dialog-step-replaced-by-sleep`) | "a scenario carries an answerDialog step only if EVERY committed fixture of it holds that dialog's answered note, and interrupt-exit's step is answered in every version (C1)": 1 red each for the old workflow step put back (all nine `*/wf-plain` named), an unanswered step on another scenario, interrupt-exit losing its step, one interrupt-exit fixture unanswered, and a version without one (written at `0d38a6549`) |
| 4 | F8 | `wait_run_quiet` waits before it kills (D-4062) | "wait_run_quiet WAITS, within its bound, … (F10d)": a wait that returns at once (`returned after 3 ms`) and round 1's `end=$SECONDS` each red it (1 red each in the F10d filter, re-measured after M1, written at `0d38a6549`; over the whole file the first reds 3, F10d with the stuck-holder and F10c rows, task B's re-review, written at `c532060ee`) |
| 4 | F8 (task B review M1) | F10d's timer starts before the go file | F10d: the old order with a 1 s stall injected reds a correct wait (1 red); the new order with the same stall stays green (both written at `0d38a6549`) |
| 4 | F10 | `claude_pid` compares against the physically resolved versions directory, keeps the spelling when it cannot resolve it, and still compares (D-4006) | "claude_pid finds the Claude Code process when HOME is spelled through a symlink … (F10)", Linux-only: 1 red each for the unresolved comparison, the fallback widened to empty, and the comparison deleted (written at `0d38a6549`) |
| 5 | F1 | every `%XX` is decoded (D-4007) | the three "a percent-escaped spelling of %s is residue as a value …" rows, "the same percent-escaped string as a KEY …", "decodes every `%XX`, in either case …" and "the user's name with its first letter percent-escaped …" (the old `%2F`-only decode: 6 red at `0d38a6549`, where it was written; 7 at `12f7c4aac` and at `3efb0ac37`, review 304: the extra red is "an escape IS chased where an earlier pass produces a later kind …", the row `12f7c4aac` added after the count was written) |
| 5 | F1 | the decode never throws | "what the percent decode leaves alone passes …" (a `decodeURIComponent` decode: 1 red, written at `0d38a6549`) |
| 5 | F1 | one decode pass per kind: the percent kind twice is not chased (a known limit) | "a double-encoded spelling is NOT chased …" (the percent pass applied twice: 1 red, written at `c532060ee`; at `0d38a6549` the plan read "the decode applied twice: 1 red", the whole decode) |
| 5 | F1 (task A review m1) | the `\u` kind twice is not chased (a known limit) | "a double-encoded spelling is NOT chased …" (a second `\u` pass appended: 1 red, from `12f7c4aac`; 0 at `858caf47d`) |
| 5 | F1 (task A review m1) | the pass order `\uXXXX`, `%XX`, `\/` (a later kind producing an earlier one is not chased; an earlier one producing a later one is) | "a double-encoded spelling is NOT chased …" and "an escape IS chased where an earlier pass produces a later kind …" (the `%` pass moved before the `\u` pass: 2 red); "an escape IS chased …" (the `\/` pass moved before the `%` pass: 1 red) (both written at `c532060ee`) |
| 5 | F11 (task A review m2) | a complete closing tag `</name>` is a tag, not a path (a known limit; D-4010's exemption) | "a complete closing tag `</name>` is a tag, not a path (declared limit, not a guarantee) …", "reads a closing tag as a tag, not a path …", the unplanted `--scan` control, both planted-value `--scan` rows, the planted-KEY and not-JSON `--scan` rows and the corpus row (the lookahead deleted from `ABS`: 8 red, since the committed fixtures hold closing tags, at `12f7c4aac` and at `c532060ee`, where it was written; 9 at `3efb0ac37`, review 304: the extra red is the `--scan` file-index row, which `a4d1da74f` added and `00fd9df34` reworked) |
| 5 | F1 | either case | "decodes every `%XX`, in either case …" and the user's-name row (upper-case hex only: 2 red, written at `0d38a6549`) |
| 5 | F9 | `--scan` runs the bundle scan over the committed corpus (D-4007) | "--scan of an unplanted copy …", the two "--scan names the file and the pointer of %s planted …" rows, "--scan reads KEYS too …", "--scan reads the matrix.json …" and the build-matrix row "the committed corpus covers every scenario on at least one version, and carries no residue" (the scan call deleted: 6 red at `0d38a6549`, where it was written, and the same 6 at `858caf47d`, `12f7c4aac` and `c532060ee`; 7 at `3efb0ac37`, review 304: the extra red is the `--scan` file-index row) |
| 5 | F9 | `--scan` reads `matrix.json` | "--scan reads the matrix.json …" and the corpus row (2 red, written at `0d38a6549`) |
| 5 | F9 | a residue-bearing key is a finding (the shared `scan()`) | "names a leaking KEY by its index …", the F1 KEY row and "--scan reads KEYS too …" (the key finding deleted: 3 red, the implementer's count, written at `0d38a6549`; task A's review, guarding that finding off in `--scan` mode only, reds 1, "--scan reads KEYS too …", written at `3900782cc`) |
| 5 | F9 | a file that is not JSON, a badly named version directory or file, nothing to scan, the argument count | "--scan fails closed on a fixture file that is not JSON …"; "--scan fails closed on a directory that is not a version and on a fixture file whose name is not a name …" (each name arm); "--scan of a directory with nothing to scan fails …"; "--scan refuses a missing directory argument and a surplus one …" (each way): 1 red each (written at `0d38a6549`) |
| 5 | F9 | the string and key tallies | "--scan of an unplanted copy …" and the corpus row (2 red each, written at `0d38a6549`) |
| 5 | F9 (task A re-review n1/n2; re-review 2 m2) | the `--scan` file index is a file's place among its directory's `*.json` regular files, in UTF-16 code-unit order (the same as `LC_ALL=C ls` gives over them only for BMP-only names) | "--scan names a file by its place in the code-unit-sorted list of its directory: every fixture of a version, each planted, pairs index and file exactly (F9)" — all 14 fixtures of a version planted under keys that name them: the pointer finding's `#${i}` made `#0` reds 1; a punctuation-blind locale sort reds 2 (this row and the bad-names row); deleting `jsonIn`'s `.sort()` is an EQUIVALENT mutant (0 red): Node's `readdirSync` already returns names in `strcmp` order (libuv sorts scandir; `ls -U` lists the same directory otherwise, measured). The controller's measurements, at the row's final form in wave 1 (`00fd9df34`), written at `3efb0ac37`, where review 304 reproduced all three |
| 5 | F9 (task A review m3) | `--scan` refuses a fixture file name with residue, and reads no further into it | "--scan refuses a fixture file whose name passes the shape test but carries residue, named by index and never by its text (m3)" (` \|\| residue(base)` deleted: 1 red; the `return` after the name finding deleted: 1 red, its planted-body half; both written at `c532060ee`) |
| 5 | F9 (task A review m3) | `--scan` names every file by index, never by its name | "--scan fails closed on a fixture file that is not JSON …" (the unreadable-JSON finding named by text: 1 red, written at `c532060ee`); the two planted-value rows, the planted-KEY row and "--scan reads the matrix.json …" (pointer findings named by text: 4 red at `12f7c4aac` and at `c532060ee`, where it was written; 5 at `3efb0ac37`, review 304: the extra red is the `--scan` file-index row) |
| 5 | F9 (task A review m4) | main mode's argument check: a surplus argument, a missing fixtures directory, a missing raw root | "refuses missing arguments with exit 2, and a surplus one, and an empty one (m4)": 1 red each for ` \|\| args.length > 2`, `!outDir` and `!raw` deleted, written at `c532060ee` (at `858caf47d` the first two reddened nothing, task A's review) |
| 5 | F11 | the declared glue set is exactly `ABS`'s lookbehind (a known limit) | "a `/` glued after a letter, a digit, `.`, `_`, `~` or `-` is not scanned (declared limit, not a guarantee) …" reds for each of the six characters dropped from the lookbehind, and for `@` added. Counted in that one row: 1 each, written at `c532060ee`. Over the sanitiser block and the corpus row (73 rows at `858caf47d`, task A's review, written at `c532060ee`): `~`, `_`, `-` and `@` 1 each, `.` 2 (also the corpus row, a committed fixture's shell command), a letter 37, a digit 38. At `3efb0ac37` the same block and row are 77 rows, and review 304 reads a letter 39, a digit 40 and `.` 3, the rest 1 each, as dated |
| 5 | F12 | `MUNGED_FOREIGN`'s ten tops (a known limit) | "a munged foreign path whose top MUNGED_FOREIGN does not list passes (declared limit, not a guarantee) …": 1 red each for `data`, `media` or `/i` added, and for `proc` dropped (written at `0d38a6549`) |
| 5 | header (`base64-pin-row`) | base64 is not decoded (a known limit) | "base64 of residue is not decoded (declared limit, not a guarantee) …" (a base64 decode of runs of 12 or more characters added: 1 red, the implementer's count, written at `0d38a6549`; task A's review, decoding more broadly, reds 14, this row among them, written at `c532060ee`) |
| 8 | F13 | an lstat ENOENT is "nothing there" (D-4065) | "a ref: HEAD resolves through packed-refs when there is no loose ref …" and "still answers from packed-refs when nothing at all is at the loose path …" (every lstat failure unreadable: 2 red, written at `0d38a6549`) |
| 8 | F13 | an lstat failing other than ENOENT is unreadable | "reports 'unmeasured' when the loose path cannot be examined at all (its parent directory refuses search) …" (every lstat failure null: 1 red at `b51022014`, before `d87b3263d` added the ENOTDIR row below; written at `0d38a6549`, after it, when the count was already 2; 2 at `d87b3263d`, at `0d38a6549` and at `3efb0ac37`, review 304: the extra red is the ENOTDIR row, census test `:430` at that commit; skipped as root); "reports 'unmeasured' when a parent component of the loose path is a file (lstat ENOTDIR) …" (ENOTDIR folded into nothing-there: 1 red, the controller's measurement, written at `0d38a6549`) |
| 8 | F13 | a real directory falls through to `packed-refs` | "a ref: HEAD resolves through packed-refs when there is no loose ref …", its directory assertion (1 red, written at `0d38a6549`) |
| 8 | F13 | a failed read is unreadable | round 1's "reports 'unmeasured' for a loose ref that exists but cannot be read …", the DANGLING-symlink row, the symlink-to-a-DIRECTORY row and the KNOWN LIMIT text-link row (4 red, written at `0d38a6549`) |
| 8 | F13 | lstat, not stat | the DANGLING, DIRECTORY-symlink and KNOWN LIMIT rows (3 red, written at `0d38a6549`) |
| 8 | F13 | a symlink is never a directory | the DANGLING, DIRECTORY-symlink, VALID-symlink and KNOWN LIMIT rows (4 red, written at `0d38a6549`) |
| 8 | F13 | a valid symlink to a file is followed, as git follows it | "follows a loose ref that is a VALID symlink, as git does …" (a symlink refused: 1 red, written at `0d38a6549`) |

**Wave 2 close-out (review 304).** Every guard arm this wave added or touched has either a red-capable row or a recorded
equivalence argument (the "arms with no row" line below). An arm with a row was measured red by deleting that arm alone
in a scratch snapshot (`git archive` of the commit with `server/node_modules` linked); each count counts rows red, not
assertions. Each line is dated by the commit it names and counted over the rows its own task chose, so no one sha or
filter governs the table: task A's lines (`A`, the rig scripts) are dated `e56a9e0ef` and count the rows whose names carry
`(review 304 F7)` or `(review 304 F12 …)` (`vitest run test/delegation-rig.test.ts -t 'F7|F12'`); task B's lines (`5`, the
sanitiser) are dated `c51428ae8` and `b93dc9894` and count over `test/delegation-rig.test.ts`, whose rows include ones
outside that filter, among them the `--scan` file-index row, the build-matrix corpus row and the N1, I3b and m1 rows; task
C's lines (`8`, the census) are dated `b0b0c78db` and count over `test/delegation-census.test.ts`. The Task column reads `A`
for task A's lines and, for tasks B and C, the wave-1 task whose code the arm lives in (5 the sanitiser, 8 the census).
Later close-out tasks append their lines here.

| Task | Finding | Guard | Row |
|---|---|---|---|
| A | F7 | `cmd_run` refuses a version that is not installed, before it makes anything (`need_version "$VER"`) | the six "run refuses … (F7)" rows and "run asks about the binary first and the scenario second …" (the call deleted: 7 red), `e56a9e0ef` |
| A | F7 | that refusal comes before `check_scenario` | "run asks about the binary first and the scenario second …" (moved after `check_scenario`: 1 red), `e56a9e0ef` |
| A | F7 | that refusal comes before the run root and the out-dir exist | the six "run refuses … (F7)" rows, "no run root, no tmux directory, no out-dir" (moved after `mktemp`: 7 red; after `guard_out`: 7 red), `e56a9e0ef` |
| A | F7 | `version_ok`: the `x.y.z` shape, anchored at both ends | the four "run refuses a version spelled with two numbers / that climbs out / with a leading letter / with trailing text" rows, "all refuses a malformed version …", "which versions all runs" and the `rig.sh versions` rows (the arm deleted: 12 red; loosened to digits and dots: 3; unanchored: 8; the end unanchored: 7; the start unanchored: 1), `e56a9e0ef` |
| A | F7 | `version_ok`: the entry is executable (`-x`) | "run refuses a version whose entry is not executable …", "all refuses a version whose entry is not executable …", the `which versions all runs` and `rig.sh versions` rows (the arm deleted: 20 red; `-x` loosened to `-e`: 10), `e56a9e0ef` |
| A | F7 | `need_version` dies, naming the version, rather than returning | the "run refuses …" and "all refuses …" rows (the `die` replaced by a no-op: 22 red), `e56a9e0ef` |
| A | F7 | `pick_versions` checks every named version before it returns | the four "all refuses …" rows and "rig.sh versions refuses the first bad version it is given …" (the loop deleted: 15 red), `e56a9e0ef` |
| A | F7 | named versions are in numeric order | "with versions named, runs only those, in numeric order and once each …", "rig.sh versions … given versions …", and recapture.sh's "--dry-run with versions named …" (not sorted: 4 red; sorted lexically: 3), `e56a9e0ef` |
| A | F7 | named versions are de-duplicated | the same three rows (`uniq` deleted: 3 red), `e56a9e0ef` |
| A | F7 | the installed listing is in numeric order, and holds only installed, version-shaped, executable entries | "with no version named, runs every installed … entry, in numeric order …", "rig.sh versions lists every installed … entry …", recapture.sh's "--dry-run, no version named …" (sorted lexically: 3 red; not sorted: 3; the filter deleted: 5), `e56a9e0ef` |
| A | F7 | a missing versions directory is "none installed", not an error printed | "rig.sh versions lists nothing, and succeeds, for an empty versions directory and for a HOME with none" (`ls`'s stderr not suppressed: 1 red), `e56a9e0ef` |
| A | F7 | `cmd_all` takes its versions from `pick_versions` (and shifts the raw root off first) | "which versions all runs …" rows, the four "all refuses …" rows (the call deleted: 9 red; the `shift` deleted: 7; the loop over every installed version, ignoring the pick: 3), `e56a9e0ef` |
| A | F7 | `cmd_all` checks the versions before it makes the raw root, reaps, or removes `.done` | "all refuses …" (four rows, "no raw root") and "all checks the versions it is given before it reaps or removes anything …" (after `guard_out`: 4 red; after `cmd_reap`: 6; after `rm -f .done`: 6), `e56a9e0ef` |
| A | F7 (found in passing) | `cmd_all`'s failed-run line reads `$?` before the `$(basename)` resets it (it printed `rc=0` for every failure) | "a failed run is reported with its rc and does not stop the sweep, and .done is still written" (the old order: 1 red), `e56a9e0ef` |
| A | F7 | `cmd_all`'s failed-run arm keeps the sweep going; `.done` is written last | the same row (the arm deleted: 1 red); the three sweep rows (`.done` not written: 3 red), `e56a9e0ef` |
| A | F7 | the `versions` verb prints the selection, one per line | the four `rig.sh versions` rows, recapture.sh's selection rows and its real runs (the verb deleted: 28 red; printing nothing: 17), `e56a9e0ef` |
| A | F7 | the usage text is the whole header, and not the code after it | "an unknown verb prints the header as the usage …" (the range one line short: 1 red; one line long: 1), `e56a9e0ef` |
| A | F12 | `recapture.sh` is an executable bash script, and its corpus and scenarios paths are the real ones | "is an executable bash script, and names the committed corpus and the rig's scenarios directory as its own" (`chmod -x`: 1 red; a non-bash shebang: 1), `e56a9e0ef` |
| A | F12 | the options: `--dry-run`, `--missing`, an unknown option refused, versions taken as arguments, `--missing` with versions refused | the `--dry-run` and `--missing` rows and the "(an option it does not know)", "(--missing together with a version)" and named-version refusal rows (`--dry-run` ignored: 4 red; `--missing` ignored: 4; the unknown-option arm deleted: 2; named versions dropped: 14; the conflict arm deleted: 2), `e56a9e0ef` |
| A | F12 | the versions come from `rig.sh versions`, and its refusal stops the script (exit 2, nothing made) | the refusal rows, dry run and real (`$( )` made forgiving: 8 red); "with no Claude Code version installed it refuses …" (the arm deleted: 1; an empty selection read as one empty version: 1), `e56a9e0ef` |
| A | F12 | `--missing`: the installed versions the corpus has no directory for; nothing missing says so, exits 0, makes nothing | "--dry-run --missing selects …" and "--missing with every installed version already in the corpus says so …" (the filter inverted: 3 red; deleted: 2; the nothing-missing block skipped: 1; it exits 1: 1; its line not printed: 1), `e56a9e0ef` |
| A | F12 | the five steps, each in the printed list and in the real run | the `--dry-run` rows and "a real run makes the raw root, runs the five steps in the printed order on it …" (step 1 deleted: 13 red; step 2: 12; step 3: 10; step 4: 9; step 5: 8), `e56a9e0ef` |
| A | F12 | step 1: `mktemp -d` of `ccrc-dlg-raw.*`, with the versions and the start time recorded | the same rows (the prefix changed: 6 red; `mktemp` without `-d`: 12; the versions not recorded: 6; the start time not recorded: 6), `e56a9e0ef` |
| A | F12 | step 2: stderr folded into `all.log`, the output teed, `.done` required | the same rows (`2>&1` dropped: 6 red; the `tee` dropped: 6; the `.done` requirement dropped: 6), and "stops at rig.sh all finishing without its .done …", `e56a9e0ef` |
| A | F12 | steps 4 and 5: `--write`, and the corpus scan's `--scan` | the same rows (`--write` dropped: 7 red; `--scan` dropped: 8), `e56a9e0ef` |
| A | F12 | a failing step stops the script with its exit, names the step and its label, and keeps and names the raw root; a success says nothing on stderr | the five "stops at … " rows, "a failure before the raw root exists …", the clean-run `stderr` assertions (`set -e` removed: 15 red; `pipefail` removed: 2; the EXIT trap deleted: 6; the failed-step line deleted: 6; its label emptied: 6; the next step's label: 6; the kept-root line deleted: 5; printed with no root: 1; the failed-step line printed on success: 3), `e56a9e0ef` |
| A | F12 | `<raw>` is the real raw root in a real run; `--dry-run` runs nothing; the root is told after step 1 and at the end | "a real run makes the raw root …", the `--dry-run` rows, "--dry-run makes nothing and runs nothing …" (`<raw>` not replaced: 7 red; `--dry-run` runs the steps: 4; the root not told after step 1: 1; the closing path line deleted: 2; the closing UNSANITISED line deleted: 2), `e56a9e0ef` |
| A | F12 | the dry-run header: its notice, the versions line, the fixtures and scenarios directories; the step numbers | "--dry-run, no version named …" and its siblings (the notice deleted: 1 red; the versions line: 3; the fixtures line: 2; the scenarios line: 1; the numbering off by one: 12), `e56a9e0ef` |
| A | F12 | every path resolved from the script's own location (`HERE`, `TREE`, `FIX`, `SCEN`) | "resolves every path from its own location …" and every row over the scratch tree (`HERE` from the caller's directory: 24 red; `TREE` one level short: 8; `FIX` another directory: 9; `SCEN` another directory: 8), `e56a9e0ef` |
| A | F12 | `--dry-run` needs no tmux, node or mock | "--dry-run needs no tmux, no node and no mock …" (a `tmux` call inserted before the steps: 1 red; an INSERTION, since there is no arm to delete), `e56a9e0ef` |
| A | F12 | the steps run over the REAL sanitiser and matrix builder | "end to end over the REAL sanitiser and matrix builder …" (it reds, among the arms above, when any of the five steps is deleted, `--write` or `--scan` is dropped, `mktemp` loses `-d`, `<raw>` is not replaced, a path constant is wrong, the `--missing` filter is inverted or the `versions` verb is gone: 16 of the mutations measured, and it is the row that would red if the real tools' argument shapes changed), `e56a9e0ef` |
| A | F7, F12 | arms with no row | `pick_versions`'s `VERS=()` reset and `cmd_all`'s `${VERS[@]+"${VERS[@]}"}` (equivalent on bash 4.4 and later, and one call per process); `launch_cmd`'s own `-x` check, untouched (it guards `relaunch`, a step of a live pane, which no hermetic row can reach). This line used to list five more arms as having no row: `CUR=0`, `on_exit`'s `CUR > 0` and the three path-quoting arms (`:64`, `:66`, `:84`). They have rows now, and their lines are in the review-318 sub-table below; the earlier "equivalent" reading of the first two was wrong (a closed stdout fails after the trap and before `CUR=1`). Measured `e56a9e0ef` |
| 5 | F1 | a `..` stays caught only at the string's start or right after a `/` (the known limit: `DOTDOT` is not widened) | "a `..` that is not at the start of the string or right after a `/` is not scanned (declared limit, not a guarantee) … (review 304 F1)" (`DOTDOT` widened to `/(^\|[^A-Za-z0-9._~-])\.\.(\/\|$)/`: 3 red: that row, "--scan names a file by its place in the code-unit-sorted list of its directory …" and the build-matrix row "the committed corpus covers every scenario on at least one version, and carries no residue"), `c51428ae8` |
| 5 | F1 | the committed corpus holds the ` ../raw-wt` spelling the header names | the same F1 row, its last assertion (every ` ../raw-wt` in the corpus respelled ` /rig/raw-wt`: 1 red, that row), `c51428ae8` |
| 5 | F1 | a `..` at the start of the string or after a `/` is residue (`if (DOTDOT.test(s)) return true`) | the retitled "fails closed on a `..` path segment at the string's start or right after a `/`, however the path before it reads (review 304 F1)" and the F1 limit row's two controls, `../srv/acme` and `cd ../../srv/acme` (the check deleted: 4 red: those two rows, "scans the decoded spelling of an escaped string …" and "decodes every `%XX`, in either case …"), `c51428ae8` |
| 5 | F4 | an absolute path whose first segment starts outside `ABS`'s class stays unscanned (the known limit: `ABS` is not closed) | "an absolute path whose first segment starts outside `[A-Za-z0-9._-]` is not scanned (declared limit, not a guarantee) … (review 304 F4)" (a `/` followed by a character outside the class, and not an end character, made residue: 2 red: that row and "scans the decoded spelling of a JSON-escaped slash … (N1)", whose benign `\/\/` controls (`a \/\/ b`) the broad form refuses; the same with `\` left out of the character set: 1 red, that row; the corpus row stays green, 0 such strings), `c51428ae8` |
| 5 | F5 | an empty `--scan` directory argument is a usage error: exit 2 and the usage text, not the internal-error line | "--scan refuses an EMPTY directory argument with exit 2 and the usage text, not the internal-error line (review 304 F5)" (`\|\| !outDir` deleted from the scan arm of the argument check: 1 red), `c51428ae8` |
| 5 | F6 | `jsonIn` counts only regular files: a `*.json` directory or dangling link is skipped, uncounted and unnamed (the header's wording) | "--scan skips a `*.json` entry that is not a regular file, uncounted and unnamed: a later file keeps its index among the regular files (review 304 F6)" (the `isFile` filter deleted, which reddened nothing before this row: 1 red; the filter moved into `readAll`, so the skipped entries are counted: 1 red), `c51428ae8` |
| 5 | F4 | only the FIRST segment goes unscanned: a later `/` is scanned like any other (the header's wording, task B fix round 1) | the F4 row's refused side, `x /@/srv/acme`, `x /~x:/srv/acme`, `x /~x@/srv/acme`, `x /~x=/srv/acme`, `x //~someone/acme` (`ABS`'s lookbehind widened by `@`: 2 red, that row and "a `/` glued after a letter, a digit, `.`, `_`, `~` or `-` is not scanned … (F11)"; the `DOUBLE_ODD` check deleted: 4 red, that row, "a `//` at a host position followed by a character that cannot start a name is residue … (I3b)", "scans the decoded spelling of a JSON-escaped slash … (N1)" and "an escape IS chased where an earlier pass produces a later kind … (m1)"; the three mutations of the F1 and F4 pin lines above, re-measured at this sha, give the same 3, 2 and 1 red), `b93dc9894` |
| 5 | F6 | `jsonIn` stats, it does not lstat: a link to a regular file is a file of its directory, counted and read (the header's "a stat, so a link to one counts") | "--scan counts a link to a regular file and reads it: residue behind the link is named by the link's index among the regular files (review 304 F6)" (`jsonIn` on an lstat: 1 red; it reddened nothing before this row), `b93dc9894` |
| 5 | F6 | a directory named `*.json` in the top directory is judged as a version directory: a finding named by index, never skipped (the header's "one in the top directory is judged as a version directory") | "--scan judges a directory named `*.json` in the top directory as a version directory: a finding named by index, never skipped (review 304 F6)" (the version-directory pass skipping a `*.json` name: 1 red; it reddened nothing before this row), `b93dc9894` |
| 8 | F8 | `json()` answers UNREADABLE for a read that fails (EACCES, EISDIR), where it answered MALFORMED | the five F8 rows: "marks an agent meta that cannot be READ unreadable …", "marks a workflow meta that cannot be READ on its run …", "a workflow run that holds a good meta beside an unreadable one and an unparsable one …", "marks an agent meta and a workflow meta whose file refuses to be read (mode 000) …" and "an unreadable meta contributes no keys and no path comparison …" (the failed read folded back into MALFORMED: 5 red; the mode-000 row is skipped as root), `b0b0c78db` |
| 8 | F8 | `json()` keeps MALFORMED for a parse failure (the control) | the two existing malformed rows, now with `unreadable: false` ("marks an unparsable agent meta malformed …", "marks a malformed workflow meta and a path-less one …") and the four F8 rows' unparsable controls (a parse failure answered UNREADABLE: 6 red), `b0b0c78db` |
| 8 | F8 | `json()` keeps MALFORMED for a value that parses and is not an object | "marks a malformed workflow meta and a path-less one …", its `[1,2]` meta (a parsed non-object answered UNREADABLE: 1 red), `b0b0c78db` |
| 8 | F8 | a workflow run's unreadable meta marks the run (`wfUnreadableRuns`) | "marks a workflow meta that cannot be READ on its run …", "a workflow run that holds a good meta beside an unreadable one …" and the mode-000 row (the arm deleted, so the meta falls through to the path-less arm: 3 red), `b0b0c78db` |
| 8 | F8 | the not-found `metaSummary` shape carries `unreadable` | "marks a workflow meta that cannot be READ on its run …" and the mode-000 row (`unreadable: false` in that shape: 2 red), `b0b0c78db` |
| 8 | F8 | the found shape carries `unreadable` from the record's own metas | "marks an agent meta that cannot be READ unreadable …", the mode-000 row and "an unreadable meta contributes no keys …" (only the run's marker kept: 3 red), `b0b0c78db` |
| 8 | F8 | the found shape carries the run's `unreadable` marker | "a workflow run that holds a good meta beside an unreadable one and an unparsable one …" (the run's marker dropped, only the record's own metas kept: 1 red; no row reached this arm before), `b0b0c78db` |
| 8 | F8 | the found shape keeps the run's `malformed` marker (an arm no row reached before: at `60ec0a706`, `runMalformed ||` dropped from that line gave 0 red) | the same row (the run's marker dropped: 1 red), `b0b0c78db` |
| 8 | F8 | an unreadable meta is not `valid`: no keys, no `worktreePath` comparison, not path-less | "marks an agent meta that cannot be READ unreadable …" (`pathless`, `worktreePathEquals: null`), the mode-000 row and "an unreadable meta contributes no keys …" (`worktreePathEquals: true` beside a valid one) (`valid` filtering MALFORMED only: 3 red), `b0b0c78db` |
| 8 | F8 | an unreadable meta is not counted malformed, and an unparsable one not unreadable | the same three rows (the old `valid.length < list.length` formula for `malformed`: 3 red), `b0b0c78db` |
| 8 | F8 | `totals.metaUnreadable` | the five F8 rows (the total fixed at 0: 5 red), `b0b0c78db` |
| 8 | F8 | the workflow call site passes the run's `unreadable` marker to `metaSummary` | "marks a workflow meta that cannot be READ on its run …", "a workflow run that holds a good meta beside an unreadable one …" and the mode-000 row (`false` passed: 3 red), `b0b0c78db` |
| 8 | F9 | `--home` goes through `path.resolve`, like `--repo` and `--ccd-root` | "resolves --home like --repo: one home spelled two ways is one home, not multiHome …" (`<h>`, `<h>/`, `<h>/.`; a second home still counts) and "counts one unreadable home spelled two ways once …" (skipped as root) (the resolve removed: 2 red), `b0b0c78db` |
| 8 | F10 | `worktreeDir`: ENOENT and ENOTDIR are 'absent' | "reads a worktree path under a regular file (ENOTDIR) and a missing one (ENOENT) as 'absent' …" (ENOTDIR answered 'unreadable': 1 red; every failure answered 'unreadable': 2 red, that row and "classifies each admin record …"), `b0b0c78db` |
| 8 | F10 | `worktreeDir`: any other stat failure is 'unreadable' | "reads a worktree directory that cannot be examined (its parent refuses search) as 'unreadable' …" (every failure answered 'absent': 1 red; skipped as root), `b0b0c78db` |
| 8 | F10 | `totals.worktreeUnreadable` | the same row (the total fixed at 0: 1 red), `b0b0c78db` |
| 8 | F10 | CLAUDE_BASE: ENOENT and ENOTDIR are 'absent' (`textMeasured`) | "is 'absent' when there is no CLAUDE_BASE (ENOENT) or the record is not a directory (ENOTDIR) …" (ENOTDIR answered unreadable: 1 red; every failure answered unreadable: 4 red, that row, "classifies each admin record …", "reports locked, a malformed HEAD and a malformed CLAUDE_BASE" and "keeps null only for a record with no valid CLAUDE_BASE …"), `b0b0c78db` |
| 8 | F10 | CLAUDE_BASE: any other read failure is unreadable, not null (`textMeasured`) | the two "a CLAUDE_BASE that cannot be read" rows (a DIRECTORY, EISDIR; a mode-000 file, skipped as root) and the KNOWN LIMIT row's `claudeBase: 'unreadable'` (every failure answered null: 3 red), `b0b0c78db` |
| 8 | F10 | `claudeBase: 'unreadable'` is its own value | the same three rows (answered 'absent': 3 red), `b0b0c78db` |
| 8 | F10 | `movedFromBase` is 'unmeasured' for an unreadable CLAUDE_BASE, never null | the two "a CLAUDE_BASE that cannot be read" rows, over a detached HEAD and a resolvable `ref:` HEAD (the arm deleted: 2 red; answering `null`: 2 red), `b0b0c78db` |
| 8 | F10 | `baseAgreesFirstLog` stays null for an unreadable CLAUDE_BASE | the same two rows, their first log line a valid sha (compared whenever a CLAUDE_BASE exists, so `false`: 2 red), `b0b0c78db` |
| 8 | F10 | `text` folds an unreadable file to `null` for every read but CLAUDE_BASE (`gitdir`, `HEAD`, `logs/HEAD`, `packed-refs`): the convenience read over `textMeasured` | "reads a gitdir, HEAD, logs/HEAD or packed-refs that is a DIRECTORY (EISDIR) as an unreadable one, and still answers …" (EISDIR fails for root too, so this row runs as root) and the KNOWN LIMIT row (the fold removed, so the UNREADABLE symbol reaches a `.trim()`, a regex or a `.split` and the census dies on a TypeError: 2 red; before the EISDIR row existed only the KNOWN LIMIT row, which skips as root, reddened), `b0b0c78db` |
| 8 | F10 | the known limit: three reads still fold a failure, `locked`, `baseAgreesFirstLog` and `gitdir` (the header names them; a pin, not a guard) | "KNOWN LIMIT: locked reads false when its stat fails, baseAgreesFirstLog null when logs/HEAD cannot be read, and an unreadable gitdir reads as an absent one …" (skipped as root) and, root-proof, "reads a gitdir, HEAD, logs/HEAD or packed-refs that is a DIRECTORY (EISDIR) …"; closing each makes a visible edit: `locked` made three-valued: 1 red (the KNOWN LIMIT row); `baseAgreesFirstLog` answering 'unmeasured' for an unreadable `logs/HEAD`: 2 red (both rows); an unreadable `gitdir` answering `worktreeDir: 'unreadable'`: 2 red (both rows), `b0b0c78db` |

**Wave 2 fix round (review 318).** Every guard arm the fix round added or touched has either a red-capable row or a
recorded equivalence argument (the two EQUIVALENT mutants below stay at 0 red). An arm with a row was measured red by
deleting or mutating that arm alone in a scratch snapshot (`git archive` of the commit named, with `server/node_modules`
linked); each count counts rows red over `test/delegation-rig.test.ts`, not assertions; the review 324 lines are
appended to this table too, and a count on an older line is the one measured at its own sha, so it does not count a row
added after that sha. Task 5's review-318 lines name the seven rows review 318's fix round
added by a short name; each title is "--scan …" and ends "(review 318 F2)", and they sit together after "--scan
refuses a fixture file whose name passes the shape test but carries residue …": the **version-file** row ("… fails closed
on a file inside a version directory whose name is not valid UTF-8 …"), the **version-dir** row ("… fails closed on a
version directory whose name is not valid UTF-8, and does not descend into it …"), the **top-file** row ("… fails closed
on a plain file at the top of the fixtures directory whose name is not valid UTF-8 …"), the **index** row ("… names a
valid entry by the index it has with no non-UTF-8 sibling …"), the **j** row ("… counts a directory's non-UTF-8 entries
among themselves and not among its valid ones …"), the **kinds** row ("… makes a finding of every kind of entry whose name is not
valid UTF-8, whatever its suffix …") and the **valid-names** row ("… does not call a valid UTF-8 name bad …"). The six
rows that make a bad name (all but valid-names) skip, by the create throwing and nothing else, on a filesystem that
refuses such a name; they run on this box (7 of 7 passed, none skipped).

Task A's lines (review 318 F3) name four rows the fix round added to the `recapture.sh` rows, each title ending "(review 318 F3)":
the **closed-stdout** row, and three rows over a tree named `ccrc-dlg-rc my tree-…` and, for the real runs, a `TMPDIR` named
`ccrc-dlg-tmp my dir-…`, so that `HERE`, `RIG`, `FIX`, `SCEN` and the raw root all carry a space: the spaced **dry-run** row (the
steps' paths as bash's own `printf %q` spells them, the header's paths as `%s` prints them), the spaced **real-run** row (each
step handed its paths whole, read from a second log with one bracketed word per argument, which the space-joined log cannot
show) and the spaced **end-to-end** row (the real sanitiser and matrix builder). They pin behaviour the unchanged scripts already
have, so none of them is red against them: the counts below are the proof, each by mutating one arm in a scratch snapshot. The last line (F3c) records a guard of the wave itself, `rig.sh:451`, which the close-out sub-table above should have carried.

| Task | Finding | Guard | Row |
|---|---|---|---|
| 5 | F2 (review 318) | `--scan` lists each directory's names as Buffers and decodes each with a fatal UTF-8 decoder; an entry that fails is a finding (a string read turned its name into U+FFFD, a path `isFile`/`isDir` answer false about, and skipped it) | the version-file, version-dir, top-file, index, j and kinds rows (the Buffer read replaced by the old string read, the guard deleted: 6 red; the decoder made non-fatal, so nothing throws: 6, and 7 at `ee41f7853`: those six and the review 324 F7 row below), `5971214f5` |
| 5 | F2 (review 318) | the top directory's listing is checked (the root-level arm) | the version-dir, top-file and index rows (the root-level check deleted alone, the top listing read as strings: 3 red), `5971214f5` |
| 5 | F2 (review 318) | each version directory's listing is checked (the version-level arm) | the version-file, index, j and kinds rows (the version-level check deleted alone: 4 red), `5971214f5` |
| 5 | F2 (review 318) | a finding inside a version directory is named `<version>/#<j>` | the version-file, index, j and kinds rows (the `<version>/` prefix dropped: 4 red), `5971214f5` |
| 5 | F2 (review 318) | the finding never prints the name, a byte of it, or U+FFFD | the six rows that make a bad name, each reading both streams as Buffers for a 0xff byte, a U+FFFD and any byte outside ASCII (the decoded name printed after the index: 6 red; its bytes printed as latin1: 6), `5971214f5` |
| 5 | F2 (review 318) | a non-UTF-8 entry is in neither the `*.json` sequence nor the directory sequence | the j row, which holds a real valid file named `\u{FFFD}.json` (what a lossy decode of `\xff.json` spells) beside the bad `\xff.json` (the entry also kept in the name list under its lossy spelling, so that file is read twice: 1 red); and, for the two sequences themselves, a bad entry made to pass the stat so that it takes an index (SIMULATED, since on Linux a lossy spelling that is no other entry's names no path): counted as a `*.json` file, 5 red (the version-file, top-file, index, j and kinds rows); counted as a directory, 4 red (the version-dir, top-file, index and j rows), `5971214f5` |
| 5 | F2 (review 318) | `j` counts the directory's non-UTF-8 entries among themselves | the version-file, version-dir, top-file, j and kinds rows (`j` the entry's place among ALL the directory's entries: 5 red); the index, j and kinds rows (`j` fixed at 0: 3 red), `5971214f5` |
| 5 | F2 (review 318) | EVERY kind of entry is a finding, whatever its suffix or type | the version-dir, index and kinds rows (only a name ending `.json` flagged: 3 red; only a regular file flagged, so a directory and a link are skipped: 3 red), `5971214f5` |
| 5 | F2 (review 318) | a directory's non-UTF-8 findings come ahead of its other findings | the index and j rows (them printed after the directory's file findings: 2 red), `5971214f5` |
| 5 | F2 (review 318) | a valid UTF-8 name is not a bad one: a non-ASCII letter, U+FFFD itself and a leading U+FEFF, which the decoder keeps (`ignoreBOM`) | the valid-names row (a BOM stripped from the name, so `\u{FEFF}x.json` is `x.json`, a path that does not exist, and a BOM-led directory decodes to its BOM-less spelling, which names no path (or, beside a real twin, lists the twin twice), so its contents are never read: 1 red; any non-ASCII name flagged: 2 red, that row and the j row), `5971214f5` |
| 5 | F2 (review 318) | the two `.sort`s of `namesIn`: `.sort(Buffer.compare)`, which orders `j`, and the valid names' `.sort()`, moved there from `jsonIn` | EQUIVALENT mutants, 0 red each (`j` in listing order; the valid names unsorted), `5971214f5`, for two different reasons. `.sort(Buffer.compare)` (`j` in listing order) is equivalent on every platform: every non-UTF-8 finding prints `<prefix>#<j> (entry name not UTF-8)` for j = 0, 1, … in that order, so any order of the bad entries prints the same lines. The sort fixes only which entry `#j` means (the j-th such name in `LC_ALL=C ls` order), which no output shows. The valid names' `.sort()` (names unsorted) is equivalent only because Node's `fs.readdirSync` returns names in `strcmp` (byte) order: libuv's scandir sorts them, while the directory's own order is not sorted (on ext4, `fs.opendirSync` and `ls -U` list a 300-entry directory in hash order, measured). Byte order and UTF-16 code-unit order also differ only between two non-ASCII names, each a `(fixture file name)` or `(version directory name)` finding of one text, while every name that passes NAME or VERSION is ASCII and keeps its rank. That `.sort()` is the guarantee that the index does not depend on the listing API, not dead code |
| 5 | F2 (review 318) | a version directory whose name is not UTF-8 is not descended into | the version-dir row's one-finding assertion (the residue behind the bad name is never read). A descent added into such a directory over Buffer paths (it reads each `*.json` under the bad name and scans it): 1 red, the version-dir row, measured at review (at `5971214f5`) |
| 5 | F9 (review 318) | wording only, no guard and no row: the `--scan` index is in UTF-16 code-unit order, the same as `LC_ALL=C ls` only for BMP-only names (a UTF-8 locale's `ls` may differ too) | the sanitiser's file header and the comment above `scanCorpus`, the comment above the index row in `test/delegation-rig.test.ts`, the D-4007 text and this plan's guard row for the index; nothing in the code changed for it |
| A | F3 (review 318) | `CUR=0` before the first step (`recapture.sh:23`): a failure before step 1 names no step. NOT equivalent to `CUR=1`, as the close-out line above once said: the trap is installed at `:78` and the stdout `printf`s at `:80`-`:83` (`:80` on a dry run only) run before `CUR=1` at `:86`, so a closed stdout fails with `CUR` still 0 | the closed-stdout row ("with stdout CLOSED before step 1 it fails and names no step and no raw root …", a dry run and a real run, each with stdout closed by `exec 1>&-` and not redirected; its control runs the same arguments with stdout open) (`CUR=1`: 1 red, it prints "step 1 failed (exit 1): make the raw root …"), `6778b20a5` |
| A | F3 (review 318) | `on_exit`'s `CUR > 0` (`recapture.sh:75`): no "step N failed" line for a failure that no step caused | the same row (`CUR > 0` dropped: 1 red, it prints "step 0 failed (exit 1): scan the committed corpus for residue", the last step's label through `WHY[-1]`), `6778b20a5` |
| A | F3 (review 318) | step 2 hands `rig.sh` its path through `%q` (`:64`, `$(printf '%q' "$RIG")`) | the three rows that run over a tree whose path carries a space: the spaced `--dry-run` row, the spaced real-run row and the spaced end-to-end row (each title ends "(review 318 F3)") (`$RIG` bare: 3 red), `6778b20a5` |
| A | F3 (review 318) | step 3 hands the sanitiser and the fixtures directory their paths through `%q` (`:66`) | the same three rows (both `%q` bare: 3 red), `6778b20a5` |
| A | F3 (review 318) | steps 4 and 5 quote their paths the same way (`:68` the matrix builder, fixtures and scenarios; `:70` the scan) | the same three rows (each line bare, alone: 3 red, 3 red), `6778b20a5` |
| A | F3 (review 318) | the `<raw>` substitution splices `"$RAW"` (`:84`, `rawref='"$RAW"'`), so a raw root whose path carries a space stays one word | the spaced real-run row and the spaced end-to-end row (`rawref='$RAW'`: 2 red; the spaced `--dry-run` row cannot see this arm, since a dry run prints `<raw>` and never substitutes it), `6778b20a5` |
| A | F3c (review 318) | `rig.sh versions` prints nothing for an empty selection (`rig.sh:451`, `if (( ${#VERS[@]} )); then printf …; fi`); an unconditional `printf '%s\n' "${VERS[@]}"` would print one empty line. The guard and its row already existed; only this record was missing | "rig.sh versions … lists nothing, and succeeds, for an empty versions directory and for a HOME with none" (the guard replaced by an unconditional `printf`: 1 red), `6778b20a5` |
| 5 | F7 (review 324) | the decoder keeps no state between names (each name decoded alone, never `{ stream: true }`) | the truncated-tail row ("--scan decodes each entry name on its own: a name ending in a truncated multibyte sequence, listed before a continuation-led one …", title ending "(review 324 F7)"): `zz.json\xe2\x82` (two bytes of a three-byte sequence, so a stream decoder holds them back and answers the name as valid) listed straight before `\xac.json` (the byte that completes them: `e2 82 ac` is U+20AC), both holding residue, beside the clean `agent-plain.json`; the row asserts that listing order, rc 1 and both findings `2.1.999/#0` and `2.1.999/#1`, and no 0xe2, 0x82, 0xac, 0xff, U+FFFD, `zz.json` or U+20AC in either stream. Every bad name in the seven review 318 rows carries an invalid lead byte, which throws even in stream mode, so none could tell the two decoders apart (`utf8.decode(b, { stream: true })` at `sanitize.mjs:391`: 1 red, this row only, which gets rc 0 "no residue" over two names it reads as `zz.json` and `\u{20AC}.json`, neither a file on disk; on the fleet box the row ran, it did not skip), `ee41f7853` |

## After the merge (coordinator): the real-lane cross-check

The rig measures every installed binary against a mock; this checks two REAL lanes against the rig, so a difference
between mock and real API traffic is caught. Standing rules (the stall-watch capture precedent): never type into a
pane or touch tmux; never hand-edit a rostered `settings.json`; drive by mail only; only `ccd start` / `ccd stop` on
`-hookcap` ids; raw captures never leave the box; the box token is never printed; never roll the fleet out by hand —
if the release has not arrived, stop and ask the operator; no wrapper name, session id or path in a committed table —
a lane is named by its Claude Code version.

1. Wait for the merge's release to reach the fleet box (`ccrc version`). Confirm, per lane config dir, that
   `jq '.hooks | has("SessionEnd")' <config dir>/settings.json` answers `true`; if not, stop and ask the operator.
2. Choose the lane with the LOWEST and the one with the HIGHEST Claude Code version (each lane's
   `.last-update-result.json` `version_to`).
3. Make a scratch git repository with one commit (`git init`, one file, one commit) outside the projects root. Use a
   fresh id for every attempt (`dlgx-hookcap`, then `dlgx2-hookcap`, …) and confirm
   `~/.ccrc/hook-capture/<wrapper>-<id>` does not exist before `ccd start` — the capture arm stops at 200 files.
4. For each chosen lane: `ccd start <wrapper> dlgx-hookcap <scratch repo>` (the id ends `-hookcap`, so the capture arm
   records), then mail it through `~/.local/bin/ccrc-api mail send` a numbered request: (1) call the Agent tool once
   with `isolation: "worktree"` asking the subagent to commit one file and report; (2) run one Workflow with one
   agent `{ isolation: 'worktree' }` doing the same; (3) reply "done". Peer mail is rate-limited (12 an hour); a lane
   that declines a mailed instruction is recorded as such, not pushed. A lane stopped at a permission dialog (the
   Workflow tool's "Run a dynamic workflow") is recorded `blocked-on-approval` and stopped with `ccd stop` — nobody
   types into its pane; the operator may answer it from the PWA if they choose.
5. After "done", `ccd stop <id>` and reduce on the box:
   `node deploy/hook-capture-reduce.mjs ~/.ccrc/hook-capture/<id> --root scratch=<scratch repo> --root worktrees=<scratch repo>/.claude/worktrees`
   and run the census on the scratch repo with that lane's config dir as `--home`.
6. Compare with the rig's cells for the same version (`agent-iso-changed`, `wf-iso`): event names and order, key
   sets, isolation tokens, ordinal patterns, `cwd` labels, `CLAUDE_BASE`, metadata `worktreePath`. Write the
   comparison — reduced tables only — into the programme ledger's measurement section under "Real-lane cross-check",
   with each difference as an amendment slug. Registry rows of the `-hookcap` ids are the operator's to remove.
   Wave 2's plan is written only after this section is filled.

## Not in this wave

The spool, ingestion, the `delegation_*` migration, correlation, reconciliation and the coordinator-intent route
(wave 2); the `delegation` frame and PWA rows (wave 3); `ws-lease-mark`, `ws-lease-audit`, adoption, promotion and
`ws-add --base` (wave 4); shadow audits (wave 5); `ws-lease-clean` (wave 6). `CLAUDE.md`'s amendments land with the
wave that ships each verb or route. `WorktreeCreate` / `WorktreeRemove` are never registered in any wave.

## Deviations found

Numbers are minted at run-open; the worker writes each issued number beside its slug, in this section, in its
first commit (allocate and define in the same act), and cites only those. Each slug names what it departs from.
A "wave 2" below means the close-out (run 306) where the passage is marked as the close-out's, and the observe stage
(now wave 3) where it is not; see the numbering note at the top of "Mutation table".

- **D-3992** — `sessionend-registered-in-stage-1` — spec §7's table ships hooks in stage 2. Measuring `SessionEnd` (§8.1 Q6)
  needs it registered, and its arm is inert outside a `-hookcap` session (Task 1's rows), so registering it now
  changes nothing a fleet session does.
- **D-3993** — `rig-fixtures-are-sanitised-synthetic-payloads` — the capture precedent commits only reduced output. That rule
  protects REAL payloads; the rig's are synthetic (mock API, fixture HOME, fixture repo), and wave 2's parser tests
  need whole payloads. They are committed after a fail-closed, allowlist sanitiser, and `topology-clean` passes on
  them. Real-lane captures stay reduced-only.
- **D-3994** — `mock-tool-name-alias` — a method note: it departs from no spec sentence. Spec §8.1 Q2 asks whether
  the tool is `Agent` or `Task`; the mock answers with whichever name the request offers, so one scenario measures
  both versions. The fixtures record the name actually used.
- **D-3995** — `real-lane-crosscheck-two-lanes` — a method note: it departs from no spec sentence (it bounds a
  check the spec never asks for). Spec §8.1 asks for every version. The rig runs every installed binary; the
  real-lane cross-check runs only the lowest and highest lane, to bound token cost and operator acts.
- **D-3996** — `incarnation-is-the-row-generation` — spec §5.1 and §8.1 Q10 leave the parent's incarnation field to
  measurement; `$REG/<id>.generation` (D-2605) already is one, so Task 9 records it from source.
- **D-3997** — `wf-limit-pause-is-an-attempt` — whether a mock 429 provokes Claude Code's five-hour pause is unknown; the
  scenario's last wait is a PROBE, so an unprovoked pause is recorded as "not re-run within the probe window", never
  as "cannot pause".
- **D-3998** — `matrix-keyed-by-scenario` — spec §8.1 frames the matrix as event × source × version rows. The derived matrix is
  keyed version × scenario, each scenario standing for one source (or one situation of a source), with per-event
  fields inside; Task 9's table maps scenarios back to §8.1's five sources.
- **D-3999** — `recapture-steps-in-rig-readme` — spec §8.2 puts the capture steps "beside the fixtures"; they live in
  `server/test/delegation-rig/README.md` beside the rig that runs them, and the fixtures directory holds only data.
  Corrected in wave 2 (review 304 F12): spec §8.2's "one re-capture script" now exists, `server/test/delegation-rig/recapture.sh`,
  beside the rig (not beside the fixtures, which still hold only data), and the README's four-command recipe became that
  script's steps: `recapture.sh [--dry-run] [--missing | <version>...]` resolves the versions once, makes the raw root,
  runs `rig.sh all`, the sanitiser, the matrix builder and the corpus scan in order, stops at the first failing step with its
  exit and keeps the raw root. `--missing` is every installed version the corpus has no `<version>/` directory for, and
  `rig.sh all` gained an optional version list (and `rig.sh versions`, the one reader of "installed") for it. The rows are the
  `recapture.sh (review 304 F12 …)` describe in `server/test/delegation-rig.test.ts` (its `--dry-run` rows over a scratch tree
  of stub steps, the five "stops at …" rows, "a real run makes the raw root, runs the five steps in the printed order on it …"
  and "end to end over the REAL sanitiser and matrix builder …") and, in the `(review 304 F7)` describe, "which versions all
  runs" and "rig.sh versions".
  Two follow-ups, ruled 2026-10-07 (review 318, the coordinator's fix-round mail) as tooling follow-ups and not part of
  that fix round: `recapture.sh` exits 0 when single runs failed (`cmd_all` logs `failed rc=` and still writes `.done`;
  a failed run that leaves a bundle builds `unmeasured` cells, and `--missing`, which keys on the version directory
  existing, then skips that version), and `rig.sh versions` reads an unreadable versions directory as none installed
  (recapture, given no version or `--missing`, still fails closed with exit 2; `rig.sh all <raw>` called directly with
  no version list captures nothing, writes `.done` and exits 0). The observe stage's plan (wave 3) closes both before
  a later capture relies on `--missing`; until then an unmeasured cell is not coverage.
  A third, ruled 2026-10-07 (review 324): `recapture.sh`'s closing cleanup hint (`rm -rf %s`) prints the raw root
  unescaped, so with a spaced `TMPDIR` the line, pasted, removes other paths and leaves the root. Wave 3 escapes it
  before any later capture relies on it, red-first. The obvious `%q` change reds two existing rows, not one: the spaced
  real-run row, which asserts the unescaped text, and the "--dry-run, no version named …" row, whose `<raw>`
  placeholder `%q` turns into `\<raw\>`; that fix updates and proves both. `recapture.sh` is not edited in the fix
  round for review 324.
- **D-4000** — `q8-spool-cost-is-a-micro-benchmark` — the spool append's cost against the hook budget is measured as a bash
  micro-benchmark of the same operations; the hook itself is wave 2's, and its own timing pin lands there.
- **D-4001** — `q9-parent-class-is-a-proxy` — §8.1 Q9 (the share of trees whose parent is not a ccd session) cannot be read
  from disk: a ccd main session's working directory is the main checkout too. Wave 1 reports the census's parent
  working-directory class as a proxy; wave 2's spool answers it exactly.

Found mid-wave (issued from the run's block; each defined in the commit after the work that makes it):

- **D-4002** — `rig-plan-text-corrections` (Task 4): three places where the plan's own text could not hold as written —
  the reap line `printf 'rig: reaped tmux server …'` reds the plan's own "no line of rig.sh calls tmux" row (reworded to
  "private server"); T4-M1 as worded SURVIVES because `guard_root`'s physical-HOME arm still refuses both cases (measured
  0 red; measured instead by deleting the whole HOME loop: 2 red when first measured, before `bf336c8b9` added the
  symlinked-setup row, and 3 red at `a64a8ee03`, where this entry was written, and at `fc2dd5ee9`); and rows that
  spawn `rig.sh` carry explicit timeouts (the fourteen-scenario check measured 5.7 s against vitest's 20 s default).
  Corrected in fix round 1 (review 277 F10b, F20): the survival was a missing row, not a dead arm. Fix round 1's row
  "guard-root refuses a root under HOME by either spelling … (F10b)" runs with HOME spelled through a symlink, so
  T4-M1 now bites AS WORDED (1 red, that row); the same row also pins `guard_root`'s physical-HOME arm. With it in
  place, deleting the whole HOME loop reds 4: "guard-root accepts only …", "setup refuses a root the guard refuses
  …", the F10b row, and "setup refuses a root that resolves, through a symlink, …" (measured on fix round 1's tree,
  task D's rows in place).
  Extended in fix round 2 (review 296 F17) to rows that spawn the sanitiser at scale. "The characters that END a
  loopback URL …" spawns it 64 times and once failed at 26.3 s, under load, against vitest's 20 s default, so every
  row of the sanitiser block that spawns it 10 times or more (counted by instrumenting `spawnSync`) carries an
  explicit timeout: 120 s at 40 spawns or more, 60 s at 10 to 39. At 120 s: that row (64), "an allowed top glued to
  a character outside the segment class …" (51) and "a `//` at a host position followed by a character that cannot
  start a name …" (48). At 60 s: "a path after the loopback `/` whose first segment is outside the allowlist …" (30),
  "`/dev/null` glued to a character outside the segment class …" (29), "what may follow an allowed top …" (19), "an
  allowed top used as a HOST …" (19), the F12 denylist pin (14), the F11 glue pin (13), "scans the path after an
  allowed loopback host and port …" (12), "what the percent decode leaves alone …" (11), "`/dev/null` is exempt only
  when nothing path-like follows it …" (11) and "scans the decoded spelling of a JSON-escaped slash …" (10).
- **D-4003** — `rig-root-base-falls-back-to-tmp` (Task 4): a fleet session's `TMPDIR` is `~/.cc-tmp/<id>`, inside
  `$HOME`, so every run root `mktemp` made there was refused by `guard_root` and no bundle was written while `all`
  still wrote `.done`. `rig.sh run-base` now answers `${TMPDIR:-/tmp}` unless it is under `$HOME` by spelling or by
  physical path, and then `/tmp`; `run` and `reap` use it, and `guard_root` is unchanged. Its blind spot, named in
  fix round 1 (review 277 F30): the Handoff gate's leftover check, like Task 4 Step 5's, listed only
  `${TMPDIR:-/tmp}`, while a fleet session's roots went to `/tmp`, so it passed however many roots were left. The
  gate now lists `rig.sh run-base` as well, and the rig's README names both places and the raw capture root.
- **D-4004** — `rig-measured-2-1-289-adaptations` (Task 4, smoke on 2.1.289): the ready footer no longer prints
  "? for shortcuts", so `waitReady` also accepts the "<mode> on" line; the fixture `settings.json` sets
  `permissions.defaultMode: "default"` and `disableAutoMode`, so an unanswered auto-mode modal cannot block a run (no
  bypass: tools are still granted by `permissions.allow` alone, pinned by the setup row); `cleanup_run` retries the
  root's removal and removes its socket file, and `reap` removes stale `dlg<pid>` sockets.
  Fix round 2 captured 2.1.290 and 2.1.291 with the rig as it stood (`e47f3689f`): no adaptation was needed, and each
  version's labels and notes equal 2.1.289's on all 14 scenarios. The capture ran only the versions installed when it
  started (2.1.285 to 2.1.291, two of them new to the corpus); a version installed later was to be the observe stage's
  first step (then wave 2, now wave 3), and the close-out took it instead.
  Wave 2's close-out (run 306) captured 2.1.292 with the rig as it stood at `ccf0167b9` (`recapture.sh --missing`,
  2026-10-07 10:11:46–10:20:55 UTC; the capture's `rig.sh`, scenarios, mock and `ccd/` are those of the snapshot, and
  the rig directory at `e8a096253` differs from it in `sanitize.mjs` alone): no adaptation was needed, and its labels
  and notes equal 2.1.291's on all 14 scenarios. The labels equal as sets: a fixture lists them in the order they were
  reached and the matrix sorts them, and interrupt-exit's two hang labels were reached `sub-hang` first, as on 2.1.285
  to 2.1.288 (2.1.280, 2.1.281 and 2.1.289 to 2.1.291 have `main-hang` first); the notes are the same two as before
  (`dialog answered: Background work is running` on interrupt-exit, `probe ["r1-resumed"]: not reached` on
  wf-iso-resume) and nothing else. The capture ran only the version the corpus lacked of those installed when it started
  (2.1.285, 2.1.286, 2.1.287, 2.1.289, 2.1.290, 2.1.291, 2.1.292), which was 2.1.292 alone; a version installed later
  waits for the next such capture.
- **D-4005** — `scenario-agent-wait-covers-sub-done` (Task 4): on 2.1.289 the Agent call runs in the background even
  with `run_in_background: false` and its result reaches the main loop only inside a reminder-only turn, so the plan's
  `main-done` regex could not match; it gained `|^$`, and because that alone could end a step before the subagent's
  last reply (a false "worktree left" for Q6), the four Agent scenarios wait on `["sub-done","main-done"]`.
  Widened by Task 9 (the corpus): measured on every captured version (2.1.280, .281, .285, .286, .287, .288, .289,
  and .290 and .291 from fix round 2's capture, and .292 from wave 2's close-out), in the rig every Agent call launches
  in the background (`async_launched`), whether the mock set `run_in_background` false (six scenarios) or true
  (agent-iso-bg), and the key never appears in PreToolUse input; a foreground Agent call is unmeasured.
- **D-4006** — `rig-guard-hardening-from-review` (Task 4 review): `reap` skips a `ccrc-dlg-rig.*` entry that is a symlink
  or not owned by the user before it resolves anything (roots now live in the shared `/tmp`); `setup` guards the
  PHYSICAL root as well as its spelling; `check-scenario` refuses an `answerDialog` or `type` that is not a one-line
  string, so a scenario cannot forge a `notes` line Task 7 parses.
  Fix round 2 (review 296 F10) hardens the same spelling-versus-physical seam in `claude_pid`, which compared
  `/proc/<pid>/exe` (always physical) with `$VERSIONS` (spelled from `$REAL_HOME`), so on a box whose HOME is a
  symlink every `kill9` noted `kill9: no pid` (failing closed, but costing parent-kill, wf-iso-resume and
  clear-compact-resume). It now compares with the versions directory resolved physically (`cd -P`), as `guard_root`
  and `run-base` resolve HOME, and keeps the spelling when that cannot be resolved, never wider. The Linux-only
  behaviour row "claude_pid finds the Claude Code process when HOME is spelled through a symlink … (F10)" pins it.
  Wave 2 (review 304 F7): `cmd_run` refuses a version that is not `x.y.z`-shaped or not installed (an executable under the
  versions directory), exit 2, before it makes anything, because `launch_cmd`'s own check ran only inside
  `bash -c "$(launch_cmd)"`, where its `exit 2` ended the command substitution's subshell and nothing else: `rig.sh run
  <missing-version>` carried on with an empty pane command, waited out `waitReady`'s 60 s and landed an `unmeasured` bundle.
  The six "run refuses … (F7)" rows and "run asks about the binary first and the scenario second …" pin it; `launch_cmd`'s
  check stays, for `relaunch`.
  Found in passing in the same fix (close-out task A, review 304 F7; recorded here in answer to review 318 F4):
  `cmd_all`'s failed-run line now reads `$?` into `rc` before the `$(basename …)` command substitution resets it;
  before, it printed `rc=0` for every failure. The row is "a failed run is reported with its rc and does not stop the
  sweep, and .done is still written" (the old order: 1 red, `e56a9e0ef`; the "F7 (found in passing)" line of the
  "Wave 2 close-out" sub-table). The shipped `cmd_all` departs in this way from Task 4's listing earlier in this plan,
  which still shows the old order (`"$?"` after the substitution); that code block is left as written.
- **D-4007** — `sanitize-leak-shapes-closed` (Task 5 and its review): the plan's T5-M3 row SURVIVED its own mutation
  (measured 0 red; the `(key)` finding is pushed by index whatever `seg` is) and now uses residue-bearing keys so it
  bites; and the plan's allowlist let residue through that a leak probe found — a `:`-joined path (the `ABS` lookbehind
  excluded `:`), `//`-led hosts and `file:///…`, `..` traversal, case and digit variants of the user and host words,
  `SK-ANT-`, munged foreign paths, `\/` / `\u002f` / `%2f` escapes, an unchecked scenario directory name, silently
  dropped bundles, a stack trace naming paths, and a half-written corpus on a mid-write failure (fixtures now build in
  a temp sibling and move in after every bundle passes). Each closed shape has a row and a measured mutation. Base64
  is a declared limit; every non-loopback URL is refused, so a Claude Code help link in a payload fails the corpus
  closed rather than passing.
  Corrected in fix round 1 (review 277 F1, F2, F12, F13): at `347b7b64` two of the shapes above had no row that went
  red — the `/dev/null` exactness (deleting its next-character test left the sanitiser's rows green) and the `\/`
  escape (no row had a `\/` input) — so "each closed shape has a row and a measured mutation" was not true of them.
  It is true from `78f5a2bae`: fix round 1 added both rows, and every shape below has a row measured red by deleting
  its arm alone (at `82fae4d7b` the run-of-slashes arm of the `//` rule below still survived its own mutation). Fix
  round 1 also closed:
  - **An allowed top is a WHOLE segment.** After `rig`, `usr` or `bin` the next character must be `/`, `:`, the end
    of the string or a character that ends a URL or a word (whitespace, a quote, a closer, `<`, `>`, `,`, `;`); after
    `/dev/null` the same, minus `/`. So `/rig~/srv/acme`, `/dev/null~/x`, `/dev/null/srv/acme` and `/dev/nullsrv` are
    residue.
  - **`//` hosts.** After an allowed `//` host — the loopback `127.0.0.1`, or an allowed top at a host position —
    only the end of the URL, `:<digits>` (the loopback only) or a `/`-path scanned like any absolute path may follow.
    So userinfo, a non-numeric port, a glued name, and `?`, `#` or `\` are residue. A loopback URL WITH a path
    (`http://127.0.0.1:<port>/v1/…`) is residue too, `loopback-api-path-now-residue` (the rig hands Claude Code only
    the bare `http://127.0.0.1:<port>`), and so are `//rig/home/x` and `x //bin/sh y`
    (`double-slash-allowed-top-is-a-host`). Both sub-slugs are tightenings inside review 277's F1 ruling ("fix both
    shapes"), accepted with it, and carry no number of their own. `file:///rig/x`, `//usr/bin/git` and `/rig//x`
    still pass. A `//` at a host position followed by a character that cannot start a name (`[`, `@`, `%`, `~`, `:`,
    `\`) is residue; a `//`
    followed by whitespace, a quote, a closer, `<`, `>`, `,`, `;` or the end stays allowed (a code comment). A run of
    slashes is judged where it ends (`http:///[fd00::abcd]:8080/…`, `///~/srv/acme` are residue).
  - **A JSON-escaped `\/` is decoded** like `\uXXXX` and `%2F` before the second scan, so a host written
    `http:\/\/[fd00::abcd]:8080` is residue; a single decoding pass, so a doubly-escaped spelling is covered by the
    "other encodings" limit.
  - **Nothing moves before every destination is checked (F13).** The move refuses, with nothing moved, when any
    destination is not a regular file (a directory or a link), when a destination version directory cannot be
    written, when a version directory in the fixtures directory is a symbolic link (a dangling one included), or
    when the fixtures directory cannot be written and a version directory must be created in it.
  - **The header is true to the code (F12).** A finding's pointer prints a key as text only when the key is
    `SAFE_SEG`-shaped and carries no residue; any other key prints as `#<index>`. The header also names the known
    limits: base64 and other encodings, and a scheme-less `<host>:<port>/<path>` (`127.0.0.1:4000/home/x`), which the
    relative-path design does not scan.

  Both raw captures are gone (a box-level `/tmp` reaper removed them after they were sanitised and committed), so the
  re-sanitise-and-diff check is replaced by a scan of the committed corpus under the final sanitiser: 99 files,
  44,378 strings and keys, 0 findings (that total measured with `82fae4d7b`'s `scan`, and again with `78f5a2bae`'s;
  the split, 20,486 strings and 23,892 keys, is `858caf47d`'s `--scan` over the same 99 files); the corpus holds no
  `127.0.0.1`.

  Corrected in fix round 2 (review 296 F1, F9, F11, F12), true from `858caf47d`, or from the later commit a sentence
  names (`12f7c4aac`, task A's review m1–m4; `dda34c43c`; `a4d1da74f`):
  - **Every percent escape is decoded (F1).** Until then the decode turned only `%2F` into `/`, so a `%2F` glued
    after another escape or a name character sat where both lookbehinds skip it: `cat%20%2Fhome%2F…`,
    `http%3A%2F%2Fsrv.corp%2Fx` and the first of these as a key passed, as they did at `347b7b64`. So "`%2f`
    escapes" above, and "every non-loopback URL is refused", did not hold of a percent-escaped spelling. Now EVERY
    `%XX` (two hex digits, either case) is decoded, after `\uXXXX` and before `\/`; a `%` not followed by two hex
    digits is left as it is, and nothing in the decode can throw. The corpus holds no percent escape (0 of 99 files
    then, 0 of 127 before `3cad0d2cd`, 0 of 141 at `3cad0d2cd`: counted over the `*.json` files, none holds a `%` followed
    by two hex digits), so it was a guard gap, not a leak. Within the known limits below, "every non-loopback URL
    is refused" now holds of a percent-escaped spelling too.
  - **The sanitiser scans the committed corpus itself (F9).** `node sanitize.mjs --scan <fixtures-dir>` runs the same
    scan (the same `residue()` over every string value and every key, the same pointers) over every `*.json` in the
    directory and in its version directories, the fixtures and `matrix.json`. It writes nothing, and it fails closed on
    a file that is not JSON, a version directory or fixture file whose name has the wrong shape, and an empty or
    unreadable directory. From `12f7c4aac` it refuses a fixture file name by the test `main` applies to a scenario name
    (the NAME shape AND no residue in it), reads no further into a refused file, and names every file by
    `<version>/#<index>` (or `#<index>`), never by its name, the index counting the directory's `*.json` entries that
    are regular files, in code-unit order (`a4d1da74f`; reworded in wave 2 to what the code counts, review 304 F6, in
    the last paragraph of this entry). The build-matrix row
    "the committed corpus covers every scenario on at least one version, and carries no residue" runs it, so a fixture
    committed with residue reds the suite; before, that row checked only `/tmp/` outside `/rig` and six literals. At
    `158bc2227` it reads 127 files, 26,328 strings and 30,705 keys, and finds no residue.
  - **The known limits, as the header names them at `dda34c43c`** (`12f7c4aac`'s text with its three escape examples
    respelled with a literal backslash; the code they describe is `12f7c4aac`'s), each pinned by a row that reds when
    the limit closes. At `858caf47d` one half was not: with the `\u` pass applied twice every row stayed green (task A's
    review), and the header's one-pass sentence named only the same kind twice.
    - base64, or any other encoding the decode does not know, is not decoded. "base64 of residue is not decoded
      (declared limit, not a guarantee) …" passes a base64 foreign path and a base64 `//` URL.
    - The decode is ONE pass per kind, in the fixed order `\uXXXX`, `%XX`, `\/`. So an escape is chased only where an
      earlier pass produces a later kind, and nothing else is: neither the same kind twice nor a later kind producing
      an earlier one. "a double-encoded spelling is NOT chased …" passes `%252Fhome%252Fsomeone-else` and
      `cat%20%252Fhome%252Fx` (the percent kind twice: `%252F` reads `%2F`), `cat \u005Cu002Fhome…` (the `\u` kind
      twice: it reads `\u002F`) and `cat %5Cu002Fhome…` (a percent escape producing a `\u` escape: it reads
      `\u002F`). "an escape IS chased where an earlier pass produces a later kind …" refuses `x \u00252Fhome…`
      (`\u0025` is `%`, then `%2F` is `/`) and `http:%5C%2F%5C%2F[fd00::abcd]:8080` (`%5C%2F` is `\/`, then `/`).
    - A `/` glued straight after a letter, a digit, `.`, `_`, `~` or `-` is not scanned (`ABS`'s lookbehind; F11).
      The F11 row, "a `/` glued after a letter, a digit, `.`, `_`, `~` or `-` is not scanned (declared limit, not a
      guarantee) …", passes `~/srv/acme`, `./srv/acme`, `a_/srv/acme`, `x/srv/acme`, `1/srv/acme`, `a-/srv/acme` and
      a scheme-less `127.0.0.1:4000/home/x`, and refuses the same path after a space, `=`, `:`, a quote, `(` or `@`.
    - A `/` after any other character is scanned, except the `/` of a COMPLETE closing tag `</name>` (`<`, `/`, a
      plain name, `>`): a tag, not a path, which hides one bare segment at most (D-4010 made the exemption, for Claude
      Code's `<task-notification>` XML). "a complete closing tag `</name>` is a tag, not a path (declared limit, not
      a guarantee) …" passes `x </srv> y`, `</srv>` and `%3C%2Fsrv%3E` and refuses `x </srv/x> y`, `</srv.corp>`,
      `x </srv y` and `x /srv> y`; the block's first row, "reads a closing tag as a tag, not a path …", still fails a
      foreign output file inside the tags closed.
    - `MUNGED_FOREIGN` is a DENYLIST of ten tops, not a class (F12): a munged foreign path is caught only when its top
      is one of `home mnt tmp srv opt var root Users private proc`, case-sensitive, and inside an allowed `/rig` path
      it is the only check on a munged spelling. "Munged foreign paths" above means the paths under those ten tops,
      not the class. "a munged foreign path whose top MUNGED_FOREIGN does not list passes (declared limit, not a
      guarantee) …" passes `-media-vol-client`, `-data-acme-client-proj`, `-Home-x` and `x -Mnt-vol-0000`, and
      refuses each of the ten listed tops.

  Corrected in wave 2 (review 304 F1, F4, F5, F6): true from `c51428ae8`, and from `b93dc9894` where task B's fix round 1
  narrowed F4's and F6's wording again (below); the coordinator ruled F1, F4, F5 and F6, and no number is issued for
  them. The sanitiser's behaviour is unchanged except F5; the rest is claims narrowed to the code, each limit pinned by
  a row that reds when it closes:
  - **F1: a `..` is residue only at the string's start or right after a `/`.** The "`..` traversal" earlier in this
    entry, and the header's "a `..` path segment", meant exactly that, what `DOTDOT = /(^|\/)\.\.(\/|$)/` catches
    (`../srv/x`, `/rig/../srv/x`, `cd ../../srv/x`). A `..` after a space, `=` or a quote (`x ../srv/acme`,
    `x=../srv/acme`, `"../srv/acme"` inside a longer string, `x ..`) is a KNOWN LIMIT, and since the `/` behind it
    follows a `.` (F11's glued slash) the path after it is not scanned either. The committed corpus holds such
    strings: raw-worktree's own ` ../raw-wt`, the rig's relative path to its own raw worktree, 20 of them in 10 files
    (`grep -rhoF ' ../raw-wt'` over the corpus: 18 in 9 files measured at `c51428ae8`, 20 in 10 once `3cad0d2cd` added
    2.1.292's). `DOTDOT` is not widened: that would red every one of the 20, two to a file in each version's
    `raw-worktree.json` (10 files, one per version, 2.1.280 to 2.1.292), installed versions included. A re-capture could
    respell the installed ones, but not the six in 2.1.280, 2.1.281 and 2.1.288, which are not installed now (the
    ledger's lane read of 2026-10-07 12:38 UTC). "a `..` that is not at the start of the string or right after a `/` is
    not scanned (declared limit, not a guarantee) … (review 304 F1)" passes `x ../srv/acme`, `x=../srv/acme`,
    `cmd ../raw-wt`, `x ..` and `x "../srv/acme" y`, refuses `../srv/acme` and `cd ../../srv/acme`, and asserts that the
    corpus does hold the ` ../raw-wt` spelling; the block's "fails closed on a `..` path segment …" row is retitled "…
    at the string's start or right after a `/`, however the path before it reads (review 304 F1)", its assertions
    unchanged.
  - **F4: a first segment that starts outside `[A-Za-z0-9._-]` is not scanned.** `ABS` is a `/` followed by that class,
    so `x /~someone-else/acme`, `"/~someone-else/acme"`, `cd /~someone-else/acme && ls`, `x /@scope/srv/acme`,
    `x /$HOME/srv/acme`, `x /+x/srv/acme`, `x /=x/srv/acme` and `x /%7Esomeone-else/acme` pass, and `x /srv/acme` does
    not. Only the FIRST segment goes unscanned: a later `/` is scanned like any other, so the rest of the path escapes
    only where that `/` follows a name character (F11's glued slash; in each of the eight probes it does), and
    `x /@/srv/acme`, `x /~x:/srv/acme`, `x /~x@/srv/acme`, `x /~x=/srv/acme` and `x //~someone/acme` are refused (task B's
    fix round 1 narrowed the header's first wording, which said the whole path passes). It is a second exception to
    fix round 2's "A `/` after any other character is scanned, except the `/` of a COMPLETE closing tag" above, which
    presented its one exception as the only one, and the header's allowlist rule (an absolute path is residue unless its
    first segment is `rig`, `usr` or `bin`) holds of a path whose first segment starts inside the class. Both header sentences are corrected, and the limit has its own header bullet. "an absolute
    path whose first segment starts outside `[A-Za-z0-9._-]` is not scanned (declared limit, not a guarantee) …
    (review 304 F4)" passes the eight probes and refuses the control and those five. The corpus holds none of these
    shapes (0 in 127 files before `3cad0d2cd` added 2.1.292's 14; 0 in 141 files at `3cad0d2cd`, counted over all
    29,254 strings and 34,120 keys of the `*.json` files: a `/` that `ABS`'s lookbehind lets start a match and that is
    followed by a character outside its segment class).
  - **F5: `--scan ''` is a usage error.** It passed the argument check, reached `readdirSync('')`, printed
    `sanitize: internal error (no detail printed)` and exited 1, so a usage error and an I/O fault gave one answer. An
    empty directory argument now prints the usage text and exits 2, as `--scan` with no argument and main mode's empty
    argument already did. "--scan refuses an EMPTY directory argument with exit 2 and the usage text, not the
    internal-error line (review 304 F5)" sits beside "--scan refuses a missing directory argument and a surplus one
    with exit 2 (F9)", which keeps its title.
  - **F6: the `--scan` index is worded as the code counts.** A file finding's index counts the directory's `*.json`
    entries that are REGULAR FILES (`jsonIn` stats each one, so a link to a file counts), in UTF-16 code-unit order,
    the same as `LC_ALL=C ls` gives over those entries only for names in the Basic Multilingual Plane (BMP-only
    names); `ls` lists the entries that are not `*.json` regular files too, so its positions agree with the index only
    where there are none (the sentence above, "as `LC_ALL=C ls` lists them", was corrected in place for that). An entry
    named `*.json` that is not a regular file is not counted, and no file finding names it: a directory of that name
    inside a version directory, and a dangling link anywhere, give no finding at all, and one in the top directory is
    judged as a version directory (its name fails `VERSION`: a finding `#<i> (version directory name)`). That
    finding, `#<i>` for a directory whose name fails `VERSION`, counts among the directories, a sequence of its own, told
    apart from a file finding only by its suffix `(version directory name)`; a directory whose name passes is named by
    its text. The header's `--scan` lines and the comment above `scanCorpus` say
    so. No code changed; the wording is pinned by "--scan skips a `*.json` entry that is not a regular file, uncounted
    and unnamed … (review 304 F6)", added because the `isFile` filter had no row (deleting it reddened nothing), and,
    from `b93dc9894`, by one row for each of the two clauses that still had none: "--scan counts a link to a regular
    file and reads it … (review 304 F6)" (an lstat in `jsonIn` reddened nothing before it) and "--scan judges a directory
    named `*.json` in the top directory as a version directory … (review 304 F6)" (skipping such a directory in the
    version-directory pass reddened nothing before it). The comment above `scanCorpus` had said a version directory is
    named `#<i>` once it passes `VERSION`; it is the reverse, and is now worded as the code does: a name that FAILS
    `VERSION` is `#<i>`, one that passes is named by its text.
- **D-4008** — `census-malformed-and-unreadable-distinct` (Task 8 review): the plan's census folded an unparsable meta
  into `found:true, keys:[]` (identical to a valid meta with no `worktreePath` — an overloaded value at a seam), a
  malformed or path-less wf meta into `metaMissing`, and an unreadable home into "nothing there". It now reports
  `meta.malformed` and `meta.pathless` separately (a path-less meta is the ordinary shape, never malformed),
  `totals.metaMalformed`, `totals.metaPathless`, `totals.homesUnreadable`, and `adminRead: 'not-main'` for a linked
  worktree passed as `--repo`; meta key NAMES print only from an allow-list of Claude Code's own meta keys (an
  id-shaped key name became `(unprintable)`); `--repo` / `--ccd-root` are resolved (a trailing slash had turned
  `main-checkout` into `other`) and a relative `gitdir` resolves against its admin record. Additive to the plan's
  `Census` shape; each with a row and a measured mutation.

  Extended in wave 2 (review 304 F8, F9, F10): true from `5187caf52` (the third sibling, `gitdir`, and the root-proof row for
  `text`'s fold from `b0b0c78db`, the task review's Minors 1 and 2); the coordinator ruled the three findings, and no number
  is issued for them. The output stays additive (every field keeps its name and meaning) and prints no path, name, id or value:
  - **F8: an unreadable meta is not a malformed one.** `json()` answered `MALFORMED` for any failure, a failed READ (EACCES,
    EISDIR) included, so a meta the census could not read was counted as corruption. It now answers `UNREADABLE` (the symbol the
    loose-ref read already used, moved up beside `MALFORMED`) for a read that fails, and `MALFORMED` only for a parse failure or a
    value that is not an object. The marker is `meta.unreadable`, beside `meta.malformed` and `meta.pathless` (in that order
    wherever the three appear) in both `metaSummary` shapes, the not-found one included; a workflow meta marks its run
    (`wfUnreadableRuns`, as `wfMalformedRuns` does); and `totals.metaUnreadable` sits beside `totals.metaMalformed`. An unreadable
    meta is not `valid`: it contributes no key and no `worktreePath` comparison, and counts as neither malformed nor path-less.
    The header contradicted itself (it listed a path-less meta among the `meta.malformed` markers, then said a path-less one is
    `meta.pathless`, not corruption); it now names each condition's own marker once. Rows: "marks an agent meta that cannot be
    READ unreadable …" (a DIRECTORY named `agent-<id>.meta.json`, EISDIR, which runs as root too), "marks a workflow meta that
    cannot be READ on its run …", "a workflow run that holds a good meta beside an unreadable one and an unparsable one …",
    "marks an agent meta and a workflow meta whose file refuses to be read (mode 000) …" (skipped as root) and "an unreadable
    meta contributes no keys and no path comparison …"; the controls are the two existing malformed rows, which now assert
    `unreadable: false` on an unparsable meta.
  - **F9: `--home` is resolved.** `--repo` and `--ccd-root` went through `path.resolve` and `--home` was kept as spelled, so
    `--home <h> --home <h>/` read every meta twice, reported `homes: 2` and counted the record in `totals.multiHome` (the
    F11(b) row claims distinct homes, but `homes` counted spellings). It goes through `path.resolve` the same way, which also makes
    `homesUnreadable` count one home spelled twice once. Rows: "resolves --home like --repo …" (three spellings of one home are
    one home; a second, different home still counts) and "counts one unreadable home spelled two ways once …" (skipped as root).
  - **F10: an unreadable worktree directory or CLAUDE_BASE is not 'absent'.** `exists(wt)` folded every stat failure into "nothing
    there". `worktreeDir` is now `'present'`, `'absent'` for ENOENT or ENOTDIR only (the census already reads ENOTDIR so for
    homes), or `'unreadable'` for any other failure, with `totals.worktreeUnreadable` beside `totals.worktreeAbsent`. CLAUDE_BASE
    is read three-valued too (`textMeasured`: `null` for ENOENT or ENOTDIR, `UNREADABLE` otherwise; `text` stays the convenience
    read that folds both to `null`, for every other file): `claudeBase: 'unreadable'` for a failed read, `movedFromBase:
    'unmeasured'` for it (D-4065's `null` means ONLY "no valid CLAUDE_BASE", and an unreadable one may be valid), and
    `baseAgreesFirstLog` stays `null`. The header names both new values and extends the `movedFromBase` sentence. Rows: "reads a
    worktree directory that cannot be examined (its parent refuses search) as 'unreadable' …" (skipped as root), "reads a
    worktree path under a regular file (ENOTDIR) and a missing one (ENOENT) as 'absent' …", and the three rows of "a CLAUDE_BASE
    that cannot be read": a DIRECTORY (EISDIR, runs as root too) and a mode-000 file (skipped as root), each over a detached HEAD
    and a `ref:` HEAD, and the ENOENT and ENOTDIR 'absent' control. "reads a gitdir, HEAD, logs/HEAD or packed-refs that is a
    DIRECTORY (EISDIR) …" (runs as root too) pins `text`'s fold: with the fold removed the UNREADABLE symbol reaches a `.trim()`,
    a regex or a `.split` and the census dies on a TypeError.
  - **Three siblings stay folded, named and pinned.** `locked` (false when its stat fails), `baseAgreesFirstLog` (null when
    `logs/HEAD` cannot be read, as when it is absent) and `gitdir` (an unreadable one reads as an absent one: `worktreeDir:
    'unmeasured'` and, for a workflow record, `meta.found: false`, counted in `totals.metaMissing`, although its meta is on disk)
    still fold a failure into their "nothing there" value. The review did not ask for them and the ruling covers `worktreeDir`
    and `CLAUDE_BASE` only, so they are left as they were; the header says so (KNOWN LIMIT), "KNOWN LIMIT: locked reads false
    when its stat fails, baseAgreesFirstLog null when logs/HEAD cannot be read, and an unreadable gitdir reads as an absent one …"
    (skipped as root) pins all three, and the EISDIR row above pins `baseAgreesFirstLog` and `gitdir` as root, so closing any of
    them on purpose is a visible edit. (`HEAD` folds too, the other way round: an absent one reads `head: 'unreadable'`, which
    is no "nothing there" value, so it stays out of the list.) Ruled 2026-10-07 (review 318, the coordinator's fix-round
    mail): the three folds are accepted as named, pinned known limits within D-4008, and no new number is issued. The
    observe stage (wave 3) treats each fold's value (`locked` false, `baseAgreesFirstLog` null, an unreadable `gitdir`
    read as absent) as no positive cleanup or adoption evidence.
  - Each guard arm's mutation, its rows and its red count are in the "Wave 2 close-out" sub-table of the mutation table (Task `8`).
- **D-4009** — `matrix-unmeasured-arms-and-pins` (Task 7 review): the plan's builder counted an event with an
  unparseable payload in `events` but derived every question field without it, so a lost `SubagentStart` read as a
  MEASURED zero (Review Focus 4); it is now `unmeasured`, reason `unparseable payload`. Also: a corrupt fixture is
  `fixture unreadable` (no longer `no fixture`), a fixture whose `version`/`scenario` disagree with its path is
  `fixture misplaced`, a non-version directory is named on stderr by ordinal rather than dropped, and
  `transcriptNamesAgent` judges every `SubagentStop` (a stop missing its fields was `null`, "none observed"). The
  plan's untested guards — no events, the 200-event cap, the main-loop filter on `agentTool`, the `Task` spelling —
  gained rows and measured mutations.
- **D-4010** — `capture-run-fixes` (Task 6, from the 98-run capture itself): two of 98 runs left a run root behind —
  a dying Claude Code flushed its transcript after `cleanup_run` removed the root, and `reap` keys on `.owner` — so
  `cleanup_run` now waits (bounded) for the pane tree and every process whose cwd is under the root, re-reads each
  straggler's cwd before it kills, and `reap` also clears an ownerless root quiet for ten minutes with no process in
  it; the sanitiser failed the whole corpus closed on Claude Code's `<task-notification>` XML, whose closing tags
  (`</result>`) read as absolute paths, so a COMPLETE closing tag of a plain name is exempt and nothing else (an
  exemption of every `<` let a shell redirect such as `wc -l</etc/hosts` through, and a row now pins that);
  and Task 7's residue row matched `/rig/tmp/`, the sanitised TMPDIR, so it skips `/tmp/` led by `/rig`.
- **D-4011** — `writeup-evidence-beyond-matrix` (Task 9): the measurement write-up rests on four kinds of evidence
  the plan's Step 1–3 text does not name. `q8-bench-on-this-repo-not-the-largest`: Q8 ran on `this-repo`'s main
  checkout (74 admin records), because the largest repository's (`project-1`, 181) path was taken to be unread, and
  the figure for the largest is a linear extrapolation, labelled as one. That reason did not hold — Task 8 Step 5
  passed `project-1`'s path to the census — and fix round 1 (review 277 F16) re-ran Q8 on `project-1`'s main
  checkout (185 records), so this sub-slug now records the earlier run as superseded; the ledger carries the
  re-run. `matrix-table-plus-fixture-shapes`: beside the Step 1
  table, facts are read from the fixtures' event order and key sets (async launch, launch-response ids, arrival
  order, task notification, compaction's SubagentStop), and several amendments rest on them rather than on a matrix
  field. `census-record-aggregates`: some census figures (`CLAUDE_BASE` coverage, the kinds of `worktreeAbsent`
  records) aggregate the census `records` (kind and flags only, no names) rather than `.totals`.
  `q10-amendment-grounded-in-source`: the incarnation amendment is grounded in source (D-3996), not in a matrix cell
  or a census total. D-4011 is the last number of the run's original block (3992–4011); fix round 1 was issued
  4058–4067, and all ten are defined — 4058–4065 in fix round 1, 4066–4067 in fix round 2 — none unused.

Fix round 1 (review 277; the block 4058–4067 issued; 4058–4065 defined here, 4066–4067 in fix round 2 below — none
unused):

- **D-4058** — `interrupt-exit-rescripted-to-a-live-turn` (review 277 F4): departs from Task 4's interrupt-exit
  scenario, which could not do its scripted thing. Its main turn had ENDED before the Escape — the mock answered the
  parent's post-launch request with `DLG-WAIT` and Stop fired — so the Escape interrupted nothing, and the `/exit`
  that followed opened Claude Code's "Background work is running" dialog, which the scenario never answered: the
  parent never exited, and no SessionEnd was captured on any version. The idle prompt and the unanswered dialog were
  OBSERVED on 2.1.289 only, from the pane while re-scripting; on the other six versions they are inferred, from the
  Stop that ends every old fixture (with no SessionEnd and no note, 7 of 7) and from the dialog the re-capture met on
  all seven. Task 6 Step 3 says a failure that is the rig's is fixed in the rig and re-run on every version. Fixed:
  the mock HOLDS the parent's post-launch request (`main-hang`: kind `main`, carrying the launch's `tool_result`,
  hang 600 s; its match by kind with no unique text, and the scenario's final sleep raised from 5 s to 15 s, are
  D-4067); the run waits on `["sub-hang","main-hang"]` before the Escape, so the Escape lands in a live main-loop
  turn; and after `/exit`, `answerDialog "Background work is running"` presses Enter on the dialog's default option
  — "Exit and stop tasks" as read from the pane on 2.1.280 and 2.1.289 only (the fixture note names the dialog,
  never the option). Re-captured on all seven versions, re-sanitised into the corpus and `matrix.json` re-derived:
  only the seven interrupt-exit cells changed, and each now records one SessionEnd (`prompt_input_exit`), no Stop, no
  SubagentStop, and one tree left, locked.
  Widened in fix round 2 (review 296 F2), which departs further from Task 4's `run_steps` (its `answerDialog` arm has no
  else) and from Task 7's `FAIL_NOTE` (as D-4060 already re-spelled it). The interrupt-exit SessionEnd cell rests on
  `answerDialog`, and a dialog that never showed used to leave no note: a re-capture without it would have built a
  MEASURED zero SessionEnd, the defect this entry fixed. Since `a7647d942` a dialog that does not appear within the
  step's timeout notes `answerDialog: no dialog: <text>`, nothing is pressed, and `FAIL_NOTE`'s alternative for that
  note builds the cell `unmeasured`, with the note as its reason. Rows: "answerDialog: a dialog that never appears sends
  no key and writes a failure note, so the run is unmeasured and not a measured zero (F2)", beside its control
  "answerDialog: a dialog that appears is answered with Enter and noted as an outcome, so the run stays measured"; the
  notes census, now "rig.sh writes nine notes, every one read here, each decided: two outcomes (a probe, a dialog) and
  seven failures"; and the rows fed from rig.sh's own note text ("rig.sh writes %j: a run carrying it is unmeasured …",
  its "with text after it" twin, and "FAIL_NOTE is anchored: …"), which now run for the new note too.
  The same else arm reached Task 4's four workflow scenarios, `wf-plain.json`, `wf-iso.json`, `wf-iso-resume.json` and
  `wf-limit-pause.json`, each of which carries `{"answerDialog": "Run a dynamic workflow", "timeoutS": 10}` after its
  prompt; this entry also departs from those four copies, which stay as Task 4 wrote them. That dialog never shows,
  because the rig grants `Workflow` through `permissions.allow`: none of the 36 committed workflow fixtures carries a
  `dialog answered:` note. So the step waited out its timeout and pressed nothing; `wait_text` counts whole seconds and
  polls the pane every 0.25 s, so that took 10 to 11 s (10.5 s and 11.1 s measured, task B's re-review). That was
  harmless while an unanswered dialog left no note; once F2 made one a failure, it would have turned every workflow
  capture `unmeasured`, and Q1 and Q7 rest on those scenarios. The step is now `{"sleep": 10}` in the same position
  (`39a2e2565`): `wf-dialog-step-replaced-by-sleep`, a consequence of the F2 ruling recorded here, with no number of its
  own (as the F4 ruling did for D-4007's sub-slugs). It presses nothing either and is at most about 1.1 s shorter. The
  polling `waitLabels` after it never waited in a committed run: its labels were in long before the old step ended
  (measured from each fixture's `dtMs`, counted from the prompt's UserPromptSubmit: every wf-plain and wf-iso event
  within 5.1 s, wf-iso-resume's and wf-limit-pause's SubagentStarts within 2.4 s, and wf-iso-resume's resumed
  SessionStart at 19.1 to 20.4 s, which leaves that wait no time to have waited). So every later step, and the settle
  window, now starts up to about 1.1 s earlier, and none of them depends on that: wf-plain's and wf-iso's last event
  came at 1.1 to 3.5 s and 1.3 to 5.1 s, long before they settle (15 s and 20 s); wf-iso-resume's snapshot and kill act
  on a run quiet since 0.9 to 2.7 s (r2 done, r1 hung); wf-limit-pause's 70 s sleep ended about 17 to 20 s after the run's
  final Stop, the parent's (61.2 to 63.1 s), and its probe allows 180 s; and `build-matrix.mjs`, which derives the matrix, reads
  neither `dtMs` nor `seq`. If a workflow dialog ever does show, nothing answers it, the workflow never runs, that
  `waitLabels` times out and the cell builds `unmeasured`. The row "a scenario carries an answerDialog step only if
  EVERY committed fixture of it holds that dialog's answered note, and interrupt-exit's step is answered in every
  version (C1)" pins it: interrupt-exit is now the only scenario with such a step, answered in 9 of 9 versions.
- **D-4059** — `no-merge-before-handoff` (review 277 F7): departs from Precondition 1 ("Merge `origin/main` into
  this workspace's branch first") and from the Global Constraint "merge `origin/main` (never rebase) before the
  handoff", which this run did not do. Both are superseded: worker clause 16 licenses an absorb only on a measured
  conflict (or its two other triggers), coordinator clause 15 asks for one only on a measured conflict, and review
  277 measured the merge clean (`git merge-tree` rc 0). The run-260 overlap rule stands: if #284 lands second, it
  absorbs main then. The coordinator records the two plan sentences as its own planning error.
- **D-4060** — `fail-note-anchored-to-rig-notes` (review 277 F8a, F9): departs from Task 7's `FAIL_NOTE`, the loose
  alternation `/timeout|no ready prompt|no session id|no pid|unknown step|run aborted/`. Commit `9cd2f6fa7` (the
  final review's fix) anchored it, `^…$`, to rig.sh's own note lines, which changes which runs Task 7 marks
  unmeasured: a note that merely contains one of those words (a probe label holding `timeout`, a dialog's text) no
  longer fails its run. Fix round 1 derives the rows from rig.sh's own text: the test reads every `note "…"` call out
  of rig.sh (eight at `82fae4d7b`: two outcomes, a probe and a dialog, and six failures), each failure alternative has
  its own row, a reworded note reds its row, and a new note reds the row that counts them until it is decided. Fix
  round 1 also DROPPED the `$`, so `FAIL_NOTE` reads `/^(…)/`: an outcome note begins `probe ` or
  `dialog answered: `, never with a failure template, so the end anchor could only turn a failure note with text
  after it into "measured" — the unsafe direction, in which a failed run's zeros read as observed. A row pins that
  such a note stays unmeasured, and the start anchor is pinned by the rows that quote each failure inside a probe's
  label and a dialog's text.
- **D-4061** — `rig-proc-linux-only` (review 277 F8b–d): departs from Task 4's `cleanup_run`, which always removed
  a guarded run root, and from D-4010's ownerless reap as recorded. `9cd2f6fa7` made the rig's `/proc` dependence
  explicit: `cleanup_run` keeps the root when there is no `/proc` (without it the bounded wait cannot see a process
  by its cwd, so it never removes what it cannot measure); the ownerless reap fails closed without `/proc`;
  `RIG_PROC_ROOT` is a test seam naming the proc root; and the `/proc`-dependent rows are `skipIf(!LINUX)` (five at
  `347b7b64`: two reap rows and the three rows of the `wait_run_quiet` describe). Fix round 1 (task D) adds rows
  under that same Linux-only describe that pin, by behaviour, `cleanup_run`'s call to `wait_run_quiet` and its
  no-`/proc` refusal (review 277 F10c), each red when its arm alone is deleted.
- **D-4062** — `rig-guard-rows-declared` (review 277 F10): departs from the Global Constraint "every guard below ships
  with a row that goes red when it is deleted, measured" and from fix round 1's rule that every guard arm it adds or
  touches ships with a row measured red by deleting that arm alone. Reap's foreign-owner skip (`! -O`, D-4006) has no
  row, because a hermetic row would need a directory owned by a second uid, which an unprivileged test cannot make; it
  is declared untestable here. And fix round 1's F10 rows are BEHAVIOUR rows, not the source-text pins the ruling
  allowed: each runs `rig.sh`'s own function text, extracted by name (a renamed function fails the row loudly), in a
  harness — `cleanup_run`'s call to `wait_run_quiet` and its no-`/proc` refusal, `wait_run_quiet`'s waiting half, the
  ready footer, `cleanup_run`'s socket removal — or `rig.sh` itself (the `dlg<non-digit>` socket filter,
  `disableAutoMode`). No substitution is recorded for T4-M3: a relative, a `..`-spelled and a trailing-slash root are
  each refused only by `cmd_setup`'s spelling guard, so deleting that line alone reds the row "setup refuses a root by
  its SPELLING alone … (F10a)" (1 red, measured), and T4-M3 bites as worded.
  Fix round 2 (review 296 F8): the waiting half was not pinned by the F10d row on its own. Its holder finished by
  itself about 1 s after the go file, inside the row's 5 s poll, so a `wait_run_quiet` that returned at once,
  neither waiting nor killing, left it green; only the stuck-holder row and the F10c row caught that. The row now
  times the call in its harness, the timer started before the go file, and asserts at least 1900 ms against a holder
  that lives 2 s after that file, so a wait that returns at once reds it (measured: `returned after 3 ms`), as the
  Mutation table's F10d line says.
- **D-4063** — `plan-rows-strengthened` (review 277 F28): plan-prescribed Task 3 and Task 4 rows were split, renamed
  or changed with no number, each a strengthening: the plan's "refuses to start without MOCK_SCRIPT, and writes no
  file when MOCK_LOG and MOCK_REQDIR are unset" row became two; `SUB_SYSTEM` gained the main-loop marker;
  `startMock` uses `mockEnv()` and rejects on an early exit; and the check-scenario row uses `cwd` and asserts that
  no arithmetic ran.
- **D-4064** — `reducer-root-normalised-and-slash-refused` (review 277 F15, and N2 of task B's review): departs from
  Task 2's code, which stored a `--root` path as `m[2].replace(/\/+$/, '') || '/'`, so `--root <label>=/` classified
  every cwd `other`. The path is now `path.posix.normalize`d and stripped of trailing slashes, and a root that
  normalises to `/` is refused with exit 2 (`=/`, `=//`, `=///`, `=/.`, `=/..` and `=//.` each exit 2, and `=/srv/.`
  is accepted, measured on the CLI). Rows pin the refusal, and the non-object arm of the delegation block's key names
  (a non-object Agent, Task or Workflow input or response prints as its JSON type, never the value).
- **D-4065** — `census-moved-from-base-resolves-ref-head` (review 277 F14): departs from Task 8's census, which
  computed `movedFromBase` for a detached HEAD only, so it was `null` for every `ref:` HEAD — 102 of the 123
  delegated records of the Task 8 census (the HEAD-shape line of the ledger's census section: 102 `ref:`, 21
  detached), and every delegated admin record in the corpus (49 of 49 then; 63 of 63 with fix round 2's two
  versions, every one a `ref:` HEAD). It now resolves
  a `ref:` HEAD read-only (the loose ref, else `packed-refs`; never git), and answers `'unmeasured'` for a ref that
  does not resolve, an unreadable loose ref, a ref name not shaped `refs/<safe chars>` or holding a `..` segment, and
  an unreadable or malformed HEAD; `null` now means only "no valid `CLAUDE_BASE`". Each arm has a row measured red.
  Fix round 2 (review 296 F13) reads the loose ref lstat-first, as git's files backend does. Only nothing at the
  path, or a real directory there, falls through to `packed-refs`. A dangling symlink, a symlink to a directory, a
  path whose parent refuses search (lstat EACCES) and a path under a file component (lstat ENOTDIR) are
  `'unmeasured'`, where a stale packed line used to answer for the first two; git fails `rev-parse HEAD` "unknown
  revision" on each (measured read-only in temp repos). A valid symlink to a file is followed, as git follows it.
  KNOWN LIMIT: a symlink whose text is a ref name (git's symbolic-ref form) is read as a path under the link's own
  directory, so it normally reads `'unmeasured'`, fail-closed; where that doubled relative path exists
  (`refs/heads/refs/heads/<n>`, which git makes under `core.preferSymlinkRefs` with such a branch), the census reads
  the wrong ref and its boolean can be wrong. No Claude Code producer of either shape is known. Each arm has a row
  measured red.

Fix round 2 (review 296; 4066–4067, the last two of fix round 1's block):

- **D-4066** — `oom-and-account-swap-are-proxies` (review 296 F3): departs from spec §8.1's column "parent SIGKILL /
  OOM behaviour" (`:549`) and from Q5's "account swaps" (`:558`), and so from §7's stage-1 gate, "every §8.1 row
  filled for every version on the fleet" (`:536`): the rig reaches both situations only through a proxy. A parent
  crash is a SIGKILL of the parent's Claude Code process (`kill9`, in parent-kill, wf-iso-resume and
  clear-compact-resume). A cgroup OOM kill of the pane's scope can take the whole process tree, not the parent
  alone; whether it does is the unit's OOM policy, an assumption about the box's systemd and cgroup settings, and
  that case is unmeasured. An account swap is swap-resume's `swapConfig` step, which copies the fixture config dir to
  a second one under the same fixture HOME (`rig.sh`'s `swapConfig` arm: `cp -a "$RUN_H/cfg/." "$RUN_H/cfg2/"`),
  with the same mock auth, and resumes there: a config-dir swap, not a swap between accounts. Measured: `kill9`
  (three scenarios) and `swapConfig` (one) are the only crash and swap steps the fourteen scenarios use. The ledger's
  Measurement matrix has declared both proxies since review 277's F17 ruling ("one line each"); this entry gives
  them a number, after D-4001's precedent that a declared proxy carries one, and the plan header now names both.
- **D-4067** — `main-hang-matches-by-kind` (review 296 F18): two departures inside the interrupt-exit entry that
  D-4058 describes (`scenarios/interrupt-exit.json`, from `fc2dd5ee9`), neither recorded there. First, from Task 4's
  scenario rule ("Every entry matches `kind: "tools"` (main or sub) on a unique text, so a version whose main-loop
  marker changed still matches"): `main-hang` matches `{"kind": "main", "hasToolResult": true}`, by kind and with no
  `lastUser` text, because the request it must hold offers none. Measured by the controller on 2.1.291 (an
  exploratory interrupt-exit run with the mock dumping request bodies, 2026-10-06 14:16 UTC, in a private directory,
  not committed): the parent's post-launch request's last user message is ONE `tool_result`, whose text is Claude
  Code's own background-launch notice ("Async agent launched successfully. …", a random agent id, the task's
  output-file path, and instructions); it carries no scenario-controlled text, neither the Agent call's
  `description` ("dlg interrupt") nor its `prompt` ("dlg-sub-int"). The cost fails closed: the mock tells `main`
  only by `MAIN_MARKER` in the system prompt (`mockapi.mjs`'s `classify`), so on a version whose main-loop marker
  changed the request classifies `sub`, `main-hang` is never reached, the step `waitLabels ["sub-hang","main-hang"]`
  times out (its note is a `FAIL_NOTE` alternative), and the cell builds `unmeasured`, never a measured zero. Every
  interrupt-exit fixture in the corpus lists `main-hang` among its labels. Second, the scenario's final `sleep`,
  after the answered dialog, went from 5 s to 15 s (`fc2dd5ee9`), so that the stop of the background task, the
  parent's exit and its SessionEnd hook complete before the run is collected.

Wave 2 close-out (run 306; the block 4364–4373, issued 2026-10-07). "Wave 2" is this close-out, as the numbering note
at the top of "Mutation table" says; the observe stage was wave 2 in text written before 2026-10-07 and has been wave 3
since the 2026-10-07 renumbering (#313), and that old text stays a dated snapshot:

- **D-4364** — `compaction-is-unmeasured` (review 304 F2): departs from the spec's §8.1 (Measurement matrix, stage 1),
  question 5 of "It must answer, per version", "how a session's Claude session id changes across `/clear`, compaction,
  resume and account swaps" (`docs/superpowers/specs/2026-10-04-delegation-broker-design.md`), and so from §7's
  (Rollout) stage-1 gate, the `1 Measure` row's "Gate to leave it" cell, "every §8.1 row filled for every version on the
  fleet": the rig compacts a session (clear-compact-resume) but never measures how the id changes across compaction.
  The hook exits in its SessionStart arm for a `compact` source before the capture arm (`ccd/session-hook.sh`, the
  arm's `[[ "$src" == compact ]] && exit 0`; the stall-watch exclusion the capture arm's comment documents, "all but
  SessionStart `compact`, which exits in its arm"), so a `compact` SessionStart is never captured. Compaction shows
  only as PreCompact and PostCompact,
  which carried the pre-compaction session id, and the rig's resume by that id continued under it (clear-compact-resume,
  on every version in the corpus, all ten, 2.1.280 to 2.1.292: no fixture holds a `compact` SessionStart, each
  PreCompact and PostCompact carries the id of the session that `/clear` began, and the `resume` SessionStart carries
  the same id). So "rotates on compaction" is unmeasured, and the ledger's amendment
  `compact-sessionstart-is-not-captured` names what the observe stage's spool (spec §7 stage 2; wave 3 since the
  2026-10-07 renumbering) must do about it: write its line inside the arm, before the exit. As D-3997 numbers the
  five-hour pause and D-4066 the two proxies, a §8.1 situation the corpus does not answer carries a number; the plan
  header and the ledger's "Versions covered" now say that Q5's compaction is unmeasured.

## Self-review (record)

- **Spec coverage:** §3.1 re-measured by the corpus; §5.3's `SessionEnd` → Task 1; §7 stage 1 → Tasks 3–9; §8.1
  Q1 (wf-plain, wf-iso: SubagentStart count and types), Q2 (agent-plain, agent-iso-*), Q3 (agent-iso-changed,
  wf-iso, raw-worktree, census), Q4 (agent-plain, agent-iso-changed: subagent Bash by marker), Q5
  (clear-compact-resume, swap-resume: the SessionStart sequence), Q6 (agent-iso-unchanged/-changed/-dirty/-bg,
  parent-kill, interrupt-exit, raw-worktree), Q7 (wf-iso-resume with a before-kill snapshot, wf-limit-pause; probes),
  Q8 (Task 9 Step 2, a micro-benchmark), Q9 (a proxy, declared), Q10 (from source); §8.2 → Tasks 4–7. The after-merge
  cross-check covers "a new Claude Code version is supported once its capture lands" for the two real lanes.
- **Plan review (2026-10-05):** three independent lenses (code run in a throwaway copy, spec fidelity, safety); two
  blockers fixed (a fixture HOME named `home` made every clean path residue; a sentinel the new block prints by design
  was banned), and every important finding folded in: probes for outcome waits, snapshots, the subagent-Bash marker,
  status-first queries, an allowlist sanitiser naming keys by index, scenario validation against injection, `reap`,
  detached long runs, canonical root guards, a 0600 key file, `TMPDIR` inside the run root, ordinal project labels.
- **Placeholders:** none in code; box-specific values in Task 8 Step 5 and the cross-check are named as the worker's
  own values, not left blank.
- **Type consistency:** the raw bundle names in Task 4's `collect` are exactly those Task 5 reads; Task 5's `Fixture`
  is Task 7's input; Task 2's `delegation` block is what the cross-check reads.
- **Review Focus:** each line maps to a named row (Tasks 5, 4, 1, 7, 2).
