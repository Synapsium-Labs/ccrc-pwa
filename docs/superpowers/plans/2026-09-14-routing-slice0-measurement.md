# Routing slice 0 — measurement: the usage sidecar, the accounting sweep and the run signals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ccrc a read-only measurement of what every supervised session is running (model, effort, context, cost, per subagent), an offline accounting sweep of the fleet's transcripts, and per-run speed and quality signals, so the routing strategy that follows can be validated on this fleet's own work.

**Architecture:** Three seams, no behaviour change. (1) The statusline hook, which already writes `~/.cc-limits/<account>.json` as a side-effect of every render, gains a second side-effect: a per-session sidecar `~/.cc-sessions/usage/<ccd-id>.json` keyed by the ccd id (never the rotating Claude uuid), with subagent renders in `<ccd-id>.agents/`; ccd reaps it with the registry row and the server reads it through the agent's existing `.cc-sessions/` read root onto the fleet wire additively. (2) A scheduled, read-only sweep on the fleet box (owned exactly as `ccd-graph-sweep` is: one script, one systemd `--user` timer, one census file) de-duplicates the last seven days of transcript usage records globally by message id and emits per-session, per-model, per-effort, per-agent totals plus the per-account Fable share estimate the design needs because no `get_usage` channel delivers buckets. (3) The coordination store computes speed and quality per closed run from its own `run_events`, the refused wave-dones it already records in `mail_rejections`, and the worker session's `lifecycle_events`, behind one new read route.

**Tech Stack:** bash (ccd, statusline hook, sweep runner), python3 (transcript scanner; already a doctor-required binary), TypeScript (server reader, wire field, store query, route), vitest, systemd `--user` timer.

**Spec:** `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md` — §6 (measurement), §7 slice 0, §8 rows "sidecar keyed by ccd id with `ts`; agent renders go to the subdirectory". Research base: `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` §4 and §6 (the plan-time probes of 2026-09-14: `get_usage` carries no buckets headless; the served catalogue carries no cost index).

## Global Constraints

- **Read-only; steers nothing.** Nothing in this slice types a keystroke, changes a spawn argv, or moves a session. Spec §6 first sentence.
- **AGENT-FIRST.** Every change under `ccd/` (the statusline hook, `ccd/ccd`, the sweep scripts, `ccd/ccrc`) ships to the fleet host before the server (`CLAUDE.md` "Build / test / deploy"): the server reads what the hook writes.
- **The sidecar is keyed by the ccd id, carries `ts` (epoch seconds, the writer's clock), and an `agent` render never writes the main-loop row.** Spec §6 first bullet; §8 mutation row. The Claude session uuid rotates on `/clear` and compaction (`_sync_uuid`, `ccd/ccd:12644`) and keys nothing.
- **`model.id` is what is recorded; class is derived by `familyClassOf` (`shared/models.mjs`), never by a new id-to-class list.** Spec §6. Confirmed at plan time against the 2.1.270 statusline builder: the payload is `{…, model:{id, display_name}, …, cost:{total_cost_usd,…}, context_window:{used_percentage,…}, effort:{level}, rate_limits, agent:{name}, …}`.
- **No per-class buckets.** Probed 2026-09-14 (research note §6): `get_usage` answers a headless client with `rate_limits_available: false` under every credential shape. The Fable share is the sweep's estimate, labelled as an estimate wherever it is shown. Spec §5.4, §6.
- **Dollars are API-rate equivalents, labelled.** The subscription's per-class window weights are unpublished (research note §6). The sweep's rate table is one constant block, named `PROXY_RATES_USD_PER_MTOK`.
- **Wire discipline, additive-only.** A new `FleetSession` field is optional on the wire, read through ONE reader (`reviveFleetSession`), tolerated absent from an older peer. `FLEET_PROTO` stays 1.
- **Rings.** `shared/api.ts` carries exactly ONE import line today (`import type { Hue } from './roster.js'`), and `server/test/peers-claims-l0.test.ts` pins that; the new wire types add NO import — `SessionUsage.class` is a `string | null` the server derives, and the reviver checks shape only. `server/src/usage.ts` is an L3 adapter (fs through `FleetIO`); it may not narrow a distinction it received (`readFileMeasured`'s absent/unreadable stay apart until the documented fold).
- **Mutation-table discipline.** Every guard ships with a test measured red on deletion. Doctrine: a comment is a request; a red suite is a mechanism.
- **Tests use FIXTURE HOMEs only** (`makeCcdHarness`, `mkTmp`), never the live `$HOME`. Run suites from inside the package: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`, foreground, `timeout ≥ 600000`. Never bare `npx vitest`.
- **No account names in any shipped source file.** Test rosters use the fixture ids `claude`, `zeta`, `gpt`.
- **D-numbers are ISSUED, never looked up.** `ccrc-api ledger allocate` (or `POST /api/ledger/deviations`) mints a block; define in the same act; a session that cannot reach it writes `D-TBD-<slug>` and reports.
- **Never touch the live fleet's tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units by hand.** Task 8's deploy goes through `deploy/deploy.sh agent` only.

---

## File structure

| File | Responsibility |
|---|---|
| `ccd/statusline-command.sh` | one new side-effect block after the limits writer: the usage sidecar |
| `ccd/ccd` | `_usage_purge`, called from `_reg_purge` |
| `server/src/usage.ts` (new) | L3 reader: sidecar path, parse, measured read, documented fold |
| `shared/api.ts` | `SessionUsage` wire type, `FleetSession.usage`, `reviveUsage`, `RunSignals` — no new import: this file carries exactly one import line, pinned by `peers-claims-l0.test.ts` |
| `shared/models.mjs` | `FAMILY_TOKENS` becomes an export (the one id-to-class table; the sweep reads it, never copies it) |
| `server/src/fleet.ts` | `assembleFleet` takes `usageReadings` and carries `usage` onto each session |
| `server/src/watch.ts` | `sweepUsage` on its own clock (`USAGE_SWEEP_MS`, the `TASK_SWEEP_MS` shape); `currentUsage()` |
| `server/src/server.ts`, `server/src/coord/routes.ts` | the two `server.ts` `assembleFleet` calls pass the watcher's usage map (the two `routes.ts` calls pass `undefined`, as they do for hook state); `GET /api/runs/:id/signals` |
| `server/src/coord/store.ts` | `runSignals(runId)` |
| `ccd/ccd-usage-sweep.py` (new) | the transcript scanner and aggregator (python3); classifies with the token table it is HANDED |
| `ccd/ccd-usage-sweep` (new) | the bash runner: roster map, lock, census, orphan reaping |
| `deploy/systemd/ccd-usage-sweep.{service,timer}` (new) | the schedule |
| `ccd/ccrc` | install / enable / uninstall arms for the two executables and the two units |
| `deploy/gen-wrappers.mjs` | `TOOLCHAIN_EXECUTABLES` gains the two names |
| tests | `server/test/statusline-script.test.ts`, `server/test/ccd-usage-purge.test.ts` (new), `server/test/usage-sidecar.test.ts` (new), `server/test/fleet.test.ts` and the six other files that build `FleetSession` literals, `server/test/run-signals.test.ts` (new), `server/test/run-routes.test.ts`, `server/test/usage-sweep.test.ts` (new), the install/uninstall pinned-list tests |

---

### Task 1: The usage sidecar side-effect in the statusline hook

**Files:**
- Modify: `ccd/statusline-command.sh` (after the `.cc-limits` side-effect block, before "Assemble single-line output")
- Test: `server/test/statusline-script.test.ts`

**Interfaces:**
- Consumes: the statusline payload on stdin (`session_id`, `model.id`, `effort.level`, `context_window.used_percentage`, `cost.total_cost_usd`, `agent.name`); `TMUX_PANE` and `tmux display-message -p '#S'` (the same derivation `ccd/session-hook.sh:1061-1069` uses); `$acct_id` computed earlier in the script.
- Produces: `~/.cc-sessions/usage/<ccd-id>.json` and `~/.cc-sessions/usage/<ccd-id>.agents/<agent-name>.json`, each one JSON object per line: `{"ts":<epoch s>,"uuid":<string|null>,"account":<string|null>,"model":<string|null>,"effort":<string|null>,"ctxPct":<number|null>,"cost":<number|null>,"agent":<string|null>}`. Task 3 parses exactly this.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/statusline-script.test.ts`, after the existing `limitsRow` helper:

```ts
/** The payload with the fields the usage sidecar reads. `model.id` beside
 *  `display_name`: the id is what `familyClassOf` classifies (routing spec §6). */
function usagePayload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: '11111111-2222-3333-4444-555555555555',
    model: { id: 'claude-opus-5', display_name: 'Opus 5' },
    effort: { level: 'high' },
    workspace: { current_dir: '/nonexistent-for-this-test' },
    context_window: { used_percentage: 12 },
    cost: { total_cost_usd: 1.25 },
    rate_limits: {
      five_hour: { used_percentage: 41, resets_at: 1_800_000_000 },
      seven_day: { used_percentage: 63, resets_at: 1_800_600_000 },
    },
    ...extra,
  });
}

/** A fake tmux on PATH whose `display-message -p '#S'` answers `sessionName`.
 *  The real hook derives the ccd id from exactly that call, gated on
 *  `TMUX_PANE` being set. */
function tmuxSaying(home: string, sessionName: string): string {
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'tmux'),
    `#!/bin/sh\n[ "$1" = display-message ] && printf '%s\\n' '${sessionName}'\nexit 0\n`, { mode: 0o755 });
  return bin;
}

interface UsageRun { out: string; code: number }
function runUsage(home: string, payload: string, opts: { tmux?: string; pane?: boolean; cfgDir?: string } = {}): UsageRun {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env['CLAUDE_CONFIG_DIR']; delete env['TMUX_PANE'];
  env['CLAUDE_CONFIG_DIR'] = opts.cfgDir ?? path.join(home, '.zeta');
  if (opts.pane !== false) env['TMUX_PANE'] = '%3';
  if (opts.tmux !== undefined) env['PATH'] = `${tmuxSaying(home, opts.tmux)}:${env['PATH'] ?? ''}`;
  const r = spawnSync('bash', [SCRIPT], { input: payload, encoding: 'utf8', env });
  return { out: r.stdout ?? '', code: r.status ?? -1 };
}

const usageFile = (home: string, rel: string): unknown => {
  const p = path.join(home, '.cc-sessions', 'usage', rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

describe('statusline-command.sh writes the per-session usage sidecar (routing spec 2026-09-14 §6)', () => {
  const seedReg = (home: string): void => { mkdirSync(path.join(home, '.cc-sessions'), { recursive: true }); };

  it('writes ~/.cc-sessions/usage/<ccd-id>.json keyed by the tmux name with cc- stripped, carrying ts', () => {
    const home = seed('ccrc-statusline-usage-'); seedReg(home);
    const before = Math.floor(Date.now() / 1000);
    const r = runUsage(home, usagePayload(), { tmux: 'cc-demo-quiet-basin' });
    expect(r.code).toBe(0);
    const row = usageFile(home, 'demo-quiet-basin.json') as Record<string, unknown>;
    expect(row).toEqual({
      ts: expect.any(Number), uuid: '11111111-2222-3333-4444-555555555555', account: 'zeta',
      model: 'claude-opus-5', effort: 'high', ctxPct: 12, cost: 1.25, agent: null,
    });
    expect(row['ts'] as number).toBeGreaterThanOrEqual(before);
    expect(row['ts'] as number).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
    // keyed by the ccd id, NEVER the uuid
    expect(usageFile(home, '11111111-2222-3333-4444-555555555555.json')).toBeNull();
    // the limits row still lands — the second side-effect did not displace the first
    expect(limitsRow(home, 'zeta')).toMatchObject({ five: 41, seven: 63 });
  });

  it('an agent render writes <ccd-id>.agents/<name>.json and leaves the main-loop row untouched', () => {
    const home = seed('ccrc-statusline-usage-agent-'); seedReg(home);
    mkdirSync(path.join(home, '.cc-sessions', 'usage'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'usage', 'demo-a.json'), '{"ts":1,"marker":true}\n');
    const r = runUsage(home, usagePayload({ agent: { name: 'refute-1' }, model: { id: 'claude-sonnet-5', display_name: 'Sonnet 5' } }),
      { tmux: 'cc-demo-a' });
    expect(r.code).toBe(0);
    expect(usageFile(home, 'demo-a.agents/refute-1.json')).toMatchObject({ agent: 'refute-1', model: 'claude-sonnet-5' });
    expect(usageFile(home, 'demo-a.json')).toEqual({ ts: 1, marker: true });
  });

  it('an agent name outside [A-Za-z0-9._-] writes NOTHING — not the agents file and not the main row', () => {
    const home = seed('ccrc-statusline-usage-badagent-'); seedReg(home);
    mkdirSync(path.join(home, '.cc-sessions', 'usage'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'usage', 'demo-a.json'), '{"ts":1,"marker":true}\n');
    runUsage(home, usagePayload({ agent: { name: '../escape' } }), { tmux: 'cc-demo-a' });
    expect(usageFile(home, 'demo-a.json')).toEqual({ ts: 1, marker: true });
    expect(existsSync(path.join(home, '.cc-sessions', 'usage', 'demo-a.agents'))).toBe(false);
  });

  it.each([
    ['no TMUX_PANE', { tmux: 'cc-demo-a', pane: false }],
    ['a tmux session not named cc-*', { tmux: 'scratch' }],
    ['a tmux name with a character outside the id alphabet', { tmux: 'cc-demo a' }],
  ] as const)('%s: no sidecar, and the status line still renders', (_label, opts) => {
    const home = seed('ccrc-statusline-usage-none-'); seedReg(home);
    const r = runUsage(home, usagePayload(), opts);
    expect(r.code).toBe(0);
    expect(plain(r.out)).toContain('Opus 5');
    expect(existsSync(path.join(home, '.cc-sessions', 'usage'))).toBe(false);
  });

  it('no ~/.cc-sessions at all (a box without ccd): no sidecar, no error', () => {
    const home = seed('ccrc-statusline-usage-noreg-');
    const r = runUsage(home, usagePayload(), { tmux: 'cc-demo-a' });
    expect(r.code).toBe(0);
    expect(existsSync(path.join(home, '.cc-sessions'))).toBe(false);
  });

  it('a payload with no effort block and no cost writes nulls, not empty strings', () => {
    const home = seed('ccrc-statusline-usage-nulls-'); seedReg(home);
    const p = JSON.parse(usagePayload()) as Record<string, unknown>;
    delete p['effort']; delete p['cost'];
    runUsage(home, JSON.stringify(p), { tmux: 'cc-demo-a' });
    expect(usageFile(home, 'demo-a.json')).toMatchObject({ effort: null, cost: null, model: 'claude-opus-5' });
  });
});
```

`mkdirSync`, `writeFileSync`, `existsSync`, `readFileSync`, `spawnSync`, `path`, `SCRIPT`, `seed`, `plain`, `limitsRow` already exist in that file (check the import line at its top; add `mkdirSync`/`writeFileSync` to the `node:fs` import if absent).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/statusline-script.test.ts`
Expected: the six new tests FAIL (`usageFile(...)` is `null`); every pre-existing test in the file stays green.

- [ ] **Step 3: Add the side-effect block to the hook**

In `ccd/statusline-command.sh`, insert immediately after the `.cc-limits` block (the `if [ "$measured" = 1 ] … fi` that ends with the `mv -f … "$HOME/.cc-limits/$acct_id.json"` line) and before `# ── Assemble single-line output`:

```bash
# ── Side-effect 2: the per-session usage sidecar (routing spec 2026-09-14 §6) ──
#    Keyed by the CCD ID — the tmux session name with `cc-` stripped, derived
#    exactly as session-hook.sh derives it — and NEVER by the Claude session
#    uuid: Claude Code rotates the uuid on /clear and on compaction (`_sync_uuid`
#    in ccd exists for that reason), so the uuid cannot key anything durable.
#    `ts` is THIS writer's clock, so a reader can tell a live reading from a
#    stale one the way `.cc-limits` rows carry it. A render that names an
#    `agent` is a SUBAGENT's status bar: it shares the parent's session id and
#    would overwrite the main-loop row, so it goes to `<id>.agents/<name>.json`.
#    Gated on `~/.cc-sessions` existing: a laptop with the same dotfiles and no
#    ccd gets no sidecar and no error. `model.id`, not `display_name`: the id is
#    what the server classifies (`familyClassOf`); the display name is for
#    people. Every failure below is silent on purpose — this runs on every
#    render of every session and must never cost the status bar.
usage_dir="$HOME/.cc-sessions/usage"
ccd_id=""
if [ -n "${TMUX_PANE:-}" ] && [ -d "$HOME/.cc-sessions" ]; then
  tname=$(tmux display-message -p '#S' 2>/dev/null)
  case "$tname" in cc-?*) ccd_id="${tname#cc-}" ;; esac
  case "$ccd_id" in *[!A-Za-z0-9._-]*) ccd_id="" ;; esac
fi
if [ -n "$ccd_id" ]; then
  agent_name=$(printf '%s' "$input" | jq -r '.agent.name // empty' 2>/dev/null)
  agent_ok=1
  if [ -n "$agent_name" ]; then
    case "$agent_name" in *[!A-Za-z0-9._-]*|.|..) agent_ok=0 ;; esac
  fi
  if [ "$agent_ok" = 1 ]; then
    usage_json=$(printf '%s' "$input" | jq -c \
      --arg ts "$(date +%s)" --arg acct "$acct_id" --arg agent "$agent_name" '{
        ts: ($ts | tonumber),
        uuid: (.session_id // null),
        account: (if $acct == "" then null else $acct end),
        model: (.model.id // null),
        effort: (.effort.level // null),
        ctxPct: (.context_window.used_percentage // null),
        cost: (.cost.total_cost_usd // null),
        agent: (if $agent == "" then null else $agent end)
      }' 2>/dev/null)
    if [ -n "$usage_json" ]; then
      if [ -n "$agent_name" ]; then
        usage_target_dir="$usage_dir/$ccd_id.agents"; usage_file="$usage_target_dir/$agent_name.json"
      else
        usage_target_dir="$usage_dir"; usage_file="$usage_dir/$ccd_id.json"
      fi
      # atomic tmp-and-rename, the registry's own discipline (`_reg_set`)
      usage_tmp="$usage_target_dir/.$ccd_id.$$.tmp"
      mkdir -p "$usage_target_dir" 2>/dev/null \
        && { printf '%s\n' "$usage_json" > "$usage_tmp"; } 2>/dev/null \
        && mv -f "$usage_tmp" "$usage_file" 2>/dev/null \
        || rm -f "$usage_tmp" 2>/dev/null
    fi
  fi
fi
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/statusline-script.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Measure the mutation rows**

Delete the `if [ -n "$agent_name" ]; then … else` branch so both arms take the main-row assignments (`usage_target_dir="$usage_dir"; usage_file="$usage_dir/$ccd_id.json"`), run the suite: the "agent render … leaves the main-loop row untouched" test must FAIL while the first test (the control) stays green, so the red is attributable. Revert. Delete `ts: ($ts | tonumber),` from the jq program, run: the first test must FAIL on `ts`. Revert. Record both red-then-green results in the commit body.

- [ ] **Step 6: Commit**

```bash
git add ccd/statusline-command.sh server/test/statusline-script.test.ts
git commit -m "feat(statusline): per-session usage sidecar keyed by the ccd id (routing slice 0, Task 1)"
```

---

### Task 2: ccd reaps the sidecar with the registry row

**Files:**
- Modify: `ccd/ccd` — new `_usage_purge`, called from `_reg_purge` (`ccd/ccd:2158-2305`; the call goes after the field loop, beside the `hookstate.json` removal)
- Test: `server/test/ccd-usage-purge.test.ts` (new)

**Interfaces:**
- Consumes: `$REG` (`ccd/ccd:791`), `_reg_purge`.
- Produces: `_usage_purge <id>` — removes `$REG/usage/<id>.json` and `$REG/usage/<id>.agents/`, exact names only, always returns 0.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccd-usage-purge.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-usage-purge-'); });
afterEach(() => { h.cleanup(); });

const usage = (rel: string): string => path.join(h.home, '.cc-sessions', 'usage', rel);
const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude; _reg_set ${id} uuid 00000000-0000-0000-0000-000000000000`);
  fs.mkdirSync(usage(`${id}.agents`), { recursive: true });
  fs.writeFileSync(usage(`${id}.json`), '{"ts":1}\n');
  fs.writeFileSync(usage(`${id}.agents/scout.json`), '{"ts":1,"agent":"scout"}\n');
};

describe('_reg_purge reaps the usage sidecar so a reused id never inherits a dead reading (routing spec §6)', () => {
  it('removes the main row and the agents directory of the purged id, and ONLY that id', () => {
    seed('demo-a'); seed('demo-ab');
    h.sh('_reg_purge demo-a');
    expect(fs.existsSync(usage('demo-a.json'))).toBe(false);
    expect(fs.existsSync(usage('demo-a.agents'))).toBe(false);
    // `_reg_purge`'s own unanchored-glob hazard, applied here: demo-a must not take demo-ab with it
    expect(fs.existsSync(usage('demo-ab.json'))).toBe(true);
    expect(fs.existsSync(usage('demo-ab.agents/scout.json'))).toBe(true);
    expect(h.reg('demo-ab', 'uuid')).not.toBeNull();
  });

  it('is a silent no-op for an id with no sidecar', () => {
    h.sh('_reg_set demo-b wrapper claude');
    expect(h.sh('_reg_purge demo-b; echo rc=$?')).toContain('rc=0');
  });

  it('_usage_purge on its own returns 0 whether or not anything existed', () => {
    seed('demo-c');
    expect(h.sh('_usage_purge demo-c; echo rc=$?')).toContain('rc=0');
    expect(h.sh('_usage_purge demo-never; echo rc=$?')).toContain('rc=0');
    expect(fs.existsSync(usage('demo-c.json'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-usage-purge.test.ts`
Expected: FAIL — `_usage_purge: command not found` in the third test; the sidecar files survive in the first.

- [ ] **Step 3: Implement**

In `ccd/ccd`, directly above `_reg_purge() {` (line 2158):

```bash
_usage_purge() {   # id — the usage sidecar (routing spec 2026-09-14 §6) is keyed by
  # the ccd id, so a REUSED id must never inherit a dead session's reading. Exact
  # names, never a glob: `_reg_purge`'s own unanchored-glob hazard (an id that is
  # a prefix of another) applies to this directory too. Always 0 — a purge that
  # cannot remove a sidecar is not a reason to stop purging the row.
  rm -f -- "$REG/usage/$1.json" 2>/dev/null
  [[ -d "$REG/usage/$1.agents" ]] && rm -rf -- "$REG/usage/$1.agents" 2>/dev/null
  return 0
}
```

Inside `_reg_purge`, after `rm -f "$REG/$id.hookstate.json"` add:

```bash
  _usage_purge "$id"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-usage-purge.test.ts test/ccd-reg-claim.test.ts`
Expected: PASS.

- [ ] **Step 5: Measure the mutation**

Delete the `_usage_purge "$id"` call line, run `test/ccd-usage-purge.test.ts`: the first test must FAIL. Restore. Note it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-usage-purge.test.ts
git commit -m "feat(ccd): _reg_purge reaps the usage sidecar with the row (routing slice 0, Task 2)"
```

---

### Task 3: The server reader

**Files:**
- Create: `server/src/usage.ts`
- Modify: `shared/api.ts` — `SessionUsage` (beside `TaskProgress`)
- Test: `server/test/usage-sidecar.test.ts` (new)

**Interfaces:**
- Consumes: `FleetIO.readFileMeasured` (`server/src/io.ts:46`, `MeasuredRead = { ok: true; content } | { ok: false; reason: 'absent' | 'unreadable' }`), `familyClassOf` from `shared/models.ts` (re-exported from `models.mjs` at line 174); `localIO` from `server/src/io.ts` is an exported CONST OBJECT, not a factory — pass it, never call it.
- Produces (for Task 4):
  - `shared/api.ts`: `export interface SessionUsage { readonly ts: number; readonly model: string | null; readonly class: string | null; readonly effort: string | null; readonly ctxPct: number | null; readonly cost: number | null; readonly stale: boolean }`
  - `server/src/usage.ts`: `USAGE_FRESH_S = 1800`; `usageSidecarPath(registryDir, id): string`; `parseUsageSidecar(content, nowS): { kind: 'reading'; usage: SessionUsage } | { kind: 'malformed' }`; `readUsageMeasured(io, registryDir, id, nowS): Promise<UsageRead>` with `UsageRead = { kind: 'reading'; usage } | { kind: 'absent' } | { kind: 'unreadable' } | { kind: 'malformed' }`; `readUsage(io, registryDir, id, nowS): Promise<SessionUsage | null>` (the documented fold).

- [ ] **Step 1: Add the wire type**

In `shared/api.ts`, beside `TaskProgress`, add — with NO new import line (the file has exactly one, pinned by `server/test/peers-claims-l0.test.ts`, and a value import of `shared/models.mjs` would drag it into the PWA bundle):

```ts
/** What a session was measured running, from its usage sidecar
 *  (`~/.cc-sessions/usage/<ccd-id>.json`, written by the statusline hook on
 *  every render — routing spec 2026-09-14 §6). `ts` is the hook's clock in
 *  epoch SECONDS; `stale` is the server's verdict against `USAGE_FRESH_S`.
 *  `class` is one of `shared/models.ts`'s `CLASSES` or null, derived from
 *  `model` by `familyClassOf` on the SERVER and never carried by the hook; it
 *  is spelled `string` here because this file imports nothing (one pinned
 *  import line) and a second copy of the class list is what
 *  `single-definition.test.ts` forbids — a consumer compares by string.
 *  Additive on the wire: an older server omits the whole field. */
export interface SessionUsage {
  readonly ts: number;
  readonly model: string | null;
  readonly class: string | null;
  readonly effort: string | null;
  readonly ctxPct: number | null;
  readonly cost: number | null;
  readonly stale: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// server/test/usage-sidecar.test.ts
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import {
  USAGE_FRESH_S, parseUsageSidecar, readUsageMeasured, readUsage, usageSidecarPath,
} from '../src/usage.js';

const NOW = 1_800_000_000;
const row = (over: Record<string, unknown> = {}): string => JSON.stringify({
  ts: NOW - 10, uuid: 'u', account: 'zeta', model: 'claude-opus-5', effort: 'high',
  ctxPct: 12, cost: 1.25, agent: null, ...over,
});

describe('parseUsageSidecar', () => {
  it('reads a fresh row and derives the class from model.id', () => {
    expect(parseUsageSidecar(row(), NOW)).toEqual({ kind: 'reading', usage: {
      ts: NOW - 10, model: 'claude-opus-5', class: 'opus', effort: 'high', ctxPct: 12, cost: 1.25, stale: false,
    } });
  });
  it.each([
    ['claude-fable-5-1', 'fable'], ['claude-sonnet-5', 'sonnet'], ['claude-haiku-4-5-20251001', 'haiku'], ['gpt-6-astra', null],
  ])('%s classifies as %s through familyClassOf, never a local list', (model, cls) => {
    const r = parseUsageSidecar(row({ model }), NOW);
    expect(r.kind === 'reading' && r.usage.class).toBe(cls);
  });
  it('flags stale past USAGE_FRESH_S and not at it', () => {
    expect(USAGE_FRESH_S).toBe(1800);
    const at = parseUsageSidecar(row({ ts: NOW - USAGE_FRESH_S }), NOW);
    const past = parseUsageSidecar(row({ ts: NOW - USAGE_FRESH_S - 1 }), NOW);
    expect(at.kind === 'reading' && at.usage.stale).toBe(false);
    expect(past.kind === 'reading' && past.usage.stale).toBe(true);
  });
  it('nulls ride through as nulls; strings where numbers belong are nulls too', () => {
    const r = parseUsageSidecar(row({ effort: null, cost: null, ctxPct: '12' }), NOW);
    expect(r).toEqual({ kind: 'reading', usage: {
      ts: NOW - 10, model: 'claude-opus-5', class: 'opus', effort: null, ctxPct: null, cost: null, stale: false,
    } });
  });
  it.each([
    ['not json', '{'], ['an array', '[]'], ['no ts', row({ ts: undefined })], ['a string ts', row({ ts: '1' })],
  ])('%s is malformed, never a reading', (_l, content) => {
    expect(parseUsageSidecar(content, NOW)).toEqual({ kind: 'malformed' });
  });
});

describe('readUsageMeasured keeps absent, unreadable and malformed apart', () => {
  it('absent', async () => {
    const home = mkTmp('ccrc-usage-read-');
    expect(await readUsageMeasured(localIO, path.join(home, '.cc-sessions'), 'demo-a', NOW)).toEqual({ kind: 'absent' });
  });
  it('unreadable', async () => {
    const io = { readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }) } as unknown as FleetIO;
    expect(await readUsageMeasured(io, '/reg', 'demo-a', NOW)).toEqual({ kind: 'unreadable' });
  });
  it('malformed, and a reading, from the real path', async () => {
    const home = mkTmp('ccrc-usage-read-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(path.join(reg, 'usage'), { recursive: true });
    expect(usageSidecarPath(reg, 'demo-a')).toBe(path.join(reg, 'usage', 'demo-a.json'));
    writeFileSync(usageSidecarPath(reg, 'demo-a'), '{');
    expect(await readUsageMeasured(localIO, reg, 'demo-a', NOW)).toEqual({ kind: 'malformed' });
    writeFileSync(usageSidecarPath(reg, 'demo-a'), row());
    const r = await readUsageMeasured(localIO, reg, 'demo-a', NOW);
    expect(r.kind).toBe('reading');
  });
  it('readUsage is the documented fold: every non-reading is null', async () => {
    const home = mkTmp('ccrc-usage-read-');
    expect(await readUsage(localIO, path.join(home, '.cc-sessions'), 'demo-a', NOW)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/usage-sidecar.test.ts`
Expected: FAIL — cannot resolve `../src/usage.js`.

- [ ] **Step 4: Implement the reader**

```ts
// server/src/usage.ts
import path from 'node:path';
import type { FleetIO } from './io.js';
import type { SessionUsage } from '../../shared/api.js';
import { familyClassOf } from '../../shared/models.js';

/** A sidecar older than this is STALE: carried, but flagged. Thirty minutes,
 *  the bound `HOOKSTATE_FRESH_MS` gives the hook state, in the sidecar's own
 *  unit (seconds — the hook writes `date +%s`). */
export const USAGE_FRESH_S = 30 * 60;

export type UsageRead =
  | { kind: 'reading'; usage: SessionUsage }
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'malformed' };

/** `~/.cc-sessions/usage/<ccd-id>.json` — under the agent's `.cc-sessions/`
 *  read root (`agent/src/whitelist.ts`), so the remote adapter reads it with
 *  no whitelist change. */
export function usageSidecarPath(registryDir: string, id: string): string {
  return path.join(registryDir, 'usage', `${id}.json`);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Pure. `nowS` in epoch seconds, the sidecar's unit. A row with no numeric
 *  `ts` is MALFORMED, not a reading: without a clock nothing can tell it fresh
 *  from stale, and a reading that cannot be aged would be shown as current
 *  forever. */
export function parseUsageSidecar(content: string, nowS: number): Extract<UsageRead, { kind: 'reading' | 'malformed' }> {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return { kind: 'malformed' }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'malformed' };
  const o = raw as Record<string, unknown>;
  const ts = num(o['ts']);
  if (ts === null) return { kind: 'malformed' };
  const model = str(o['model']);
  return { kind: 'reading', usage: {
    ts, model,
    class: model === null ? null : familyClassOf(model),
    effort: str(o['effort']),
    ctxPct: num(o['ctxPct']),
    cost: num(o['cost']),
    stale: nowS - ts > USAGE_FRESH_S,
  } };
}

/** Four answers, never three: absent and unreadable come from `readFileMeasured`
 *  and are not narrowed here (an adapter may not narrow a distinction it
 *  received); malformed is this reader's own. */
export async function readUsageMeasured(io: FleetIO, registryDir: string, id: string, nowS: number): Promise<UsageRead> {
  const r = await io.readFileMeasured(usageSidecarPath(registryDir, id));
  if (!r.ok) return r.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
  return parseUsageSidecar(r.content, nowS);
}

/** The convenience fold, and it IS a collapse: absent, unreadable and
 *  malformed all read `null` here, deliberately — the fleet wire carries one
 *  `usage` slot per session and every consumer of that slot renders the three
 *  the same way (no reading). A caller that must tell them apart uses
 *  `readUsageMeasured`. Same shape as `io.ts`'s `readFile` over
 *  `readFileMeasured`, named for the same reason. */
export async function readUsage(io: FleetIO, registryDir: string, id: string, nowS: number): Promise<SessionUsage | null> {
  const r = await readUsageMeasured(io, registryDir, id, nowS);
  return r.kind === 'reading' ? r.usage : null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/usage-sidecar.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/usage.ts shared/api.ts server/test/usage-sidecar.test.ts
git commit -m "feat(server): usage sidecar reader with four answers (routing slice 0, Task 3)"
```

---

### Task 4: `usage` on the fleet wire

**Files:**
- Modify: `shared/api.ts` — `FleetSession.usage`, `reviveUsage`, `reviveFleetSession`
- Modify: `server/src/fleet.ts` — `assembleFleet` parameter `usageReadings`, session literal `usage:`
- Modify: `server/src/watch.ts` — `private usage = new Map<string, SessionUsage>()`, `sweepUsage`, `currentUsage()`; the `assembleFleet` call at `watch.ts:906`
- Modify: `server/src/server.ts:1047`, `server/src/server.ts:1265`, `server/src/coord/routes.ts:2116`, `server/src/coord/routes.ts:2298` — the other four `assembleFleet` calls
- Test: `server/test/fleet.test.ts` (the wire), `server/test/fleetstate.test.ts` (revive), and every file the compiler names when `usage` becomes a required field: `server/test/bucket.test.ts`, `server/test/ccrc-install-graphify.test.ts`, `server/test/fleet-health.test.ts`, `server/test/hookstate.test.ts`, `server/test/session-hook.test.ts`

**Interfaces:**
- Consumes: Task 3's `readUsage`, `SessionUsage`.
- Produces: `FleetSession.usage: SessionUsage | null` on every frame and snapshot; `FleetWatcher.currentUsage(): Map<string, SessionUsage>`.

- [ ] **Step 1: Write the failing tests**

In `server/test/fleet.test.ts`, find the test that asserts `ctxPct` is carried from the statusline (grep `ctxPct` in the file) and add beside it:

```ts
  it('carries the usage sidecar reading onto the session, and null when none was read (routing slice 0)', async () => {
    // the same fixture as the ctxPct test above; `usageReadings` is the twelfth positional argument
    const reading = { ts: 1_800_000_000, model: 'claude-opus-5', class: 'opus' as const, effort: 'high', ctxPct: 12, cost: 1.25, stale: false };
    const withUsage = await assembleFleet(io, cfg, tmux, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      new Map([[ID, reading]]));
    expect(withUsage.find((s) => s.id === ID)?.usage).toEqual(reading);
    const without = await assembleFleet(io, cfg, tmux);
    expect(without.find((s) => s.id === ID)?.usage).toBeNull();
  });
```

Use that file's own names for `io`, `cfg`, `tmux` and the seeded session id (read the `ctxPct` test and copy its setup verbatim).

In `server/test/fleetstate.test.ts` — no test in the tree calls `reviveFleetSession` directly today — add `reviveFleetSession` to that file's import from `../../shared/api.js`, and use its own complete-session factory `session(id)` (line 13) as the base:

```ts
describe('reviveFleetSession carries usage (routing slice 0)', () => {
  it('revives usage when present, tolerates its absence from an older peer, refuses a malformed one', () => {
    const base = JSON.parse(JSON.stringify(session('demo-a'))) as Record<string, unknown>;
    delete base['usage'];
    expect(reviveFleetSession(base)?.usage).toBeNull();
    const usage = { ts: 1, model: 'claude-sonnet-5', class: 'sonnet', effort: 'medium', ctxPct: null, cost: 0, stale: true };
    expect(reviveFleetSession({ ...base, usage })?.usage).toEqual(usage);
    expect(reviveFleetSession({ ...base, usage: { ...usage, ts: 'x' } })).toBeNull();      // MalformedSnapshot: no clock
    expect(reviveFleetSession({ ...base, usage: { ...usage, class: 7 } })).toBeNull();     // MalformedSnapshot: not a string
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/fleet.test.ts test/fleetstate.test.ts`
Expected: FAIL (`usage` undefined; the compile step names every literal missing the field once Step 3 lands).

- [ ] **Step 3: Implement the wire field**

`shared/api.ts`, inside `FleetSession` after `readonly spawnState: SpawnVerdict | null;`:

```ts
  /** The usage sidecar reading (routing spec 2026-09-14 §6), or null when
   *  none was read this sweep — absent, unreadable and malformed all fold to
   *  null here, by `server/src/usage.ts`'s documented `readUsage` collapse. */
  readonly usage: SessionUsage | null;
```

In the private helper block directly above `reviveFleetSession` (`shared/api.ts:2482`, beside the other `revive*` helpers it calls) add:

```ts
/** Shape only: `class` is a string the SERVER derived (see `SessionUsage`);
 *  membership is not re-checked here because this file imports no class list. */
function reviveUsage(o: Record<string, unknown>, key: string): SessionUsage | null {
  const raw = o[key];
  if (raw === undefined || raw === null) return null;
  const u = asObj(raw, key);
  return {
    ts: reqNum(u, 'ts'), model: optStr(u, 'model'), class: optStr(u, 'class'),
    effort: optStr(u, 'effort'), ctxPct: optNum(u, 'ctxPct'), cost: optNum(u, 'cost'),
    stale: optBool(u, 'stale', false),
  };
}
```

In `reviveFleetSession`'s `revived` literal add `usage: reviveUsage(o, 'usage'),` after `spawnState: spawnRaw,`.

`server/src/fleet.ts`: add a twelfth parameter after `coord`:

```ts
  /** Fresh per-session usage readings (routing slice 0, the watcher's usage
   *  lane), same pattern as `hookStates`: absent on a cold start and in every
   *  older test, which is why the field defaults to null. */
  usageReadings?: Map<string, SessionUsage>,
```

and in the session literal, after `ctxPct: sl?.ctxPct ?? null,`:

```ts
      usage: usageReadings?.get(r.id) ?? null,
```

Import `SessionUsage` from `../../shared/api.js`.

`server/src/watch.ts`: beside `const TASK_SWEEP_MS = 10_000;` (line 66) add `const USAGE_SWEEP_MS = 60_000;`; beside `private hookStates = new Map<string, HookState>();` (line 445) add `private usage = new Map<string, SessionUsage>();` and `private lastUsageSweep = 0;`. Directly after `sweepHookStates` (line 1447 onward) add:

```ts
  /** The usage lane (routing slice 0). ON ITS OWN CLOCK — at most once per
   *  USAGE_SWEEP_MS, the `TASK_SWEEP_MS` shape — because the reader treats a
   *  sidecar as fresh for USAGE_FRESH_S and one agent round-trip per session
   *  per 2-second tick would buy nothing. Rebuilt from the current listing so
   *  a purged row ages out; a row whose read came back UNREADABLE this sweep
   *  keeps its previous reading (a transient read failure is not a change of
   *  fact — `readUsageMeasured` tells it from absent, which drops the row). */
  private async sweepUsage(records: SessionRecord[]): Promise<void> {
    const now = Date.now();
    if (this.lastUsageSweep !== 0 && now - this.lastUsageSweep < USAGE_SWEEP_MS) return;
    this.lastUsageSweep = now;
    const nowS = Math.floor(now / 1000);
    const next = new Map<string, SessionUsage>();
    await Promise.all(records.map(async (r) => {
      const read = await readUsageMeasured(this.deps.io, this.deps.cfg.registryDir, r.id, nowS);
      if (read.kind === 'reading') next.set(r.id, read.usage);
      else if (read.kind === 'unreadable') { const prev = this.usage.get(r.id); if (prev) next.set(r.id, prev); }
    }));
    this.usage = next;
  }

  currentUsage(): Map<string, SessionUsage> { return this.usage; }
```

Call `await this.sweepUsage(records);` at the one place `sweepHookStates(records)` is awaited in the tick (grep `sweepHookStates(` in `watch.ts`; there is one call site), immediately after it. Change the `assembleFleet` call at `watch.ts:906` to pass `this.usage` as the twelfth argument; the two `server.ts` call sites (1047, 1265) pass `watcher?.currentUsage()`; the two `coord/routes.ts` call sites (2116, 2298) pass `undefined` for it exactly as they pass `undefined` for hook state — their sessions carry `usage: null`. Import `readUsageMeasured` from `./usage.js` and `SessionUsage` from `../../shared/api.js`.

Add to `server/test/fleet-health.test.ts` or a new `server/test/usage-sweep-lane.test.ts` two watcher-level checks if the watcher is unit-testable there (grep `sweepHookStates` in `server/test` for the fixture that drives a tick): a second tick inside USAGE_SWEEP_MS performs no sidecar read (count `readFileMeasured` calls on a counting io double), and an unreadable read keeps the previous reading. If no tick fixture exists, record that gap in `## Deviations found` rather than inventing one.

- [ ] **Step 4: Typecheck, then fix every literal the compiler names**

Run: `cd server && npm run typecheck` (or `./node_modules/.bin/tsc -p . --noEmit` if there is no script; `server/test/typecheck-tests.test.ts` is the suite that pins it). Add `usage: null,` to every `FleetSession` literal the errors name — the seven test files listed under **Files** are the known holders; the compiler is the census.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/fleet.test.ts test/fleetstate.test.ts test/bucket.test.ts test/fleet-health.test.ts test/hookstate.test.ts test/session-hook.test.ts test/ccrc-install-graphify.test.ts test/typecheck-tests.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/src/fleet.ts server/src/watch.ts server/src/server.ts server/src/coord/routes.ts server/test
git commit -m "feat(wire): FleetSession.usage from the sidecar, additive (routing slice 0, Task 4)"
```

---

### Task 5: Run signals — `runSignals` and `GET /api/runs/:id/signals`

**Files:**
- Modify: `shared/api.ts` — `RunSignals` beside `RunSummary` (line 4700)
- Modify: `server/src/coord/store.ts` — `runSignals(runId)` beside `runEvents` (line 1899)
- Modify: `server/src/coord/routes.ts` — new `GET /api/runs/:id/signals` beside `GET /api/runs` (line 1841)
- Test: `server/test/run-signals.test.ts` (new), `server/test/run-routes.test.ts`, `server/test/auth-gate.test.ts`

**Interfaces:**
- Consumes: `run_events` (`schema.ts:99-108`: `at` ms on the server's clock, `fromState`, `toState`, `causedBy`, `detail`); `runs.sessionId` (the WORKER, null until dispatch; `claimedBy` is the coordinator); `mail_rejections` filtered by `DONE_AUTHORITY_CODES` (`shared/api.ts:4390`) — the rows `closeRun` already writes through `recordRejection` for every refused wave-done (`close.ts:260`), and which `store.ts:2127-2133` already counts per run; `lifecycle_events` (`schema.ts:324`: `at` ms on ccd's clock, `act`, `outcome`, `sessionId`). What ccd REALLY emits (measured): a swap is ONE row, `_lc_done swap "$id" ""` (`ccd/ccd:17166`, outcome `done`, empty `tx`, no `intent` pair — `_lc_intent` is called only for destroy/reap/forget); a hold is `_lc_done hold` (`ccd/ccd:6256`) and its release `_lc_done release` (`ccd/ccd:6349`).
- Produces:
  - `shared/api.ts`: `export interface RunSignals { readonly runId: number; readonly dispatchedAt: number | null; readonly closedAt: number | null; readonly finalState: 'done' | 'failed' | null; readonly wallMs: number | null; readonly holdMs: number; readonly swaps: number; readonly excludedUnmeasured: boolean; readonly activeMs: number | null; readonly closeRefusals: number; readonly firstSubmission: boolean | null }`
  - `CoordStore.runSignals(runId: number): RunSignals | null`
  - `GET /api/runs/:id/signals` → `200 { ok: true, signals }`, `404 { ok: false, error: 'unknown-run' }`, gated as `GET /api/runs` is (session cookie OR box token when auth is armed).

- [ ] **Step 1: Add the L0 type**

`shared/api.ts`, beside `RunSummary` (line 4700) — no new import:

```ts
/** Speed and quality per run (routing spec 2026-09-14 §6), READ-ONLY, from the
 *  run's own events, its refused wave-dones and the WORKER session's lifecycle
 *  rows. `wallMs` is dispatch → final state on the SERVER's clock. `holdMs` is
 *  the worker's paired hold→release time inside that window on CCD's clock
 *  (two NTP-disciplined boxes; the skew is bounded, not zero — a signal, not an
 *  invoice). `swaps` COUNTS the worker's account swaps in the window and
 *  nothing more: ccd journals a swap as one `done` row with no landing pair,
 *  so swap wall time is structurally unmeasurable from the journal today
 *  (pairing it needs a `swap intent` at `_swap_target` and a landing row — a
 *  slice-3 change, if the count proves it matters). `excludedUnmeasured` is
 *  true when a hold could not be paired OR when `swaps > 0`, so `activeMs`
 *  (`wallMs - holdMs`) is then a ceiling, never a total. `closeRefusals` is the
 *  count of `mail_rejections` rows with a `DONE_AUTHORITY_CODES` code for this
 *  run — the rows `closeRun` writes for a refused wave-done — and
 *  `firstSubmission` is `closeRefusals === 0` once the run is done, null
 *  before. */
export interface RunSignals {
  readonly runId: number;
  readonly dispatchedAt: number | null;
  readonly closedAt: number | null;
  readonly finalState: 'done' | 'failed' | null;
  readonly wallMs: number | null;
  readonly holdMs: number;
  readonly swaps: number;
  readonly excludedUnmeasured: boolean;
  readonly activeMs: number | null;
  readonly closeRefusals: number;
  readonly firstSubmission: boolean | null;
}
```

- [ ] **Step 2: Write the failing store test**

```ts
// server/test/run-signals.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { DONE_AUTHORITY_CODES } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const open = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-run-signals-'), 'coord.db')));

/** A run driven planned → dispatched through the store's own writers
 *  (`openRun` at `store.ts:598` — `{program, title, project, wave, waveOf,
 *  claimedBy}` → `{id, …} | {refused} | HoldReasonRefusal`; `markDispatched`
 *  at `store.ts:1738`, `(runId, sessionId, workspace, branch, resumed, at?)`;
 *  `advance(runId, to, causedBy)` at `store.ts:1318`). `sessionId` is the
 *  WORKER, `claimedBy` the coordinator — `runSignals` reads the former. */
function seedRun(coord: CoordStore): number {
  const opened = coord.openRun({ program: 'demo', title: 'demo', project: 'demo', wave: 1, waveOf: null, claimedBy: 'ccrc-pwa-coord' });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  coord.markDispatched(opened.id, 'demo-worker', 'worker', 'ws/worker', false);
  const adv = coord.advance(opened.id, 'dispatched', 'coordinator');
  if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  return opened.id;
}

const setEventAt = (coord: CoordStore, runId: number, toState: string, at: number): void => {
  coord.db.prepare('UPDATE run_events SET at = ? WHERE runId = ? AND toState = ? AND fromState != toState').run(at, runId, toState);
};

/** Rows in the shape ccd's `_lc_emit` really writes (measured): a swap is ONE
 *  `done` row with no tx; a hold is `hold done`, its release `release done`. */
const lifecycle = (coord: CoordStore, row: { sessionId: string; act: 'swap' | 'hold' | 'release'; at: number }): void => {
  coord.db.prepare(
    'INSERT INTO lifecycle_events (gen, ingestedAt, act, outcome, sessionId, tx, at, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('0000000000000000001', 1, row.act, 'done', row.sessionId, null, row.at, JSON.stringify(row));
};

const REFUSAL = DONE_AUTHORITY_CODES[0]!;   // the vocabulary's own first member, never a hand-spelled code

describe('CoordStore.runSignals', () => {
  it('unknown run → null', () => { expect(open().runSignals(999)).toBeNull(); });

  it('an open run has no wall time yet and firstSubmission is null', () => {
    const coord = open(); const id = seedRun(coord);
    const s = coord.runSignals(id)!;
    expect(s.dispatchedAt).toEqual(expect.any(Number));
    expect(s).toMatchObject({ closedAt: null, finalState: null, wallMs: null, activeMs: null, closeRefusals: 0, firstSubmission: null, holdMs: 0, swaps: 0, excludedUnmeasured: false });
  });

  it('a done run: wall time from dispatch to done; the WORKER\'s paired holds subtracted; swaps counted, not timed', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'working', 'demo-worker'); coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    setEventAt(coord, id, 'dispatched', 1_000_000); setEventAt(coord, id, 'done', 1_600_000);
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_200_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'release', at: 1_230_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'swap', at: 1_300_000 });
    lifecycle(coord, { sessionId: 'ccrc-pwa-coord', act: 'swap', at: 1_350_000 });     // the COORDINATOR's swap is not the worker's
    lifecycle(coord, { sessionId: 'demo-worker', act: 'swap', at: 1_700_000 });        // outside the window
    expect(coord.runSignals(id)).toEqual({
      runId: id, dispatchedAt: 1_000_000, closedAt: 1_600_000, finalState: 'done',
      wallMs: 600_000, holdMs: 30_000, swaps: 1, excludedUnmeasured: true, activeMs: 570_000,
      closeRefusals: 0, firstSubmission: true,
    });
  });

  it('no swap and paired holds only: excludedUnmeasured is false', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    setEventAt(coord, id, 'dispatched', 1_000_000); setEventAt(coord, id, 'done', 1_600_000);
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_100_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'release', at: 1_150_000 });
    expect(coord.runSignals(id)).toMatchObject({ holdMs: 50_000, swaps: 0, excludedUnmeasured: false, activeMs: 550_000 });
  });

  it('an unpaired hold (no release inside the window) makes the subtraction a floor: excludedUnmeasured=true', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    setEventAt(coord, id, 'dispatched', 1_000_000); setEventAt(coord, id, 'done', 1_600_000);
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_100_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'release', at: 1_150_000 });
    lifecycle(coord, { sessionId: 'demo-worker', act: 'hold', at: 1_500_000 });      // never released in-window
    expect(coord.runSignals(id)).toMatchObject({ holdMs: 50_000, excludedUnmeasured: true });
  });

  it('a refused wave-done — the row closeRun writes through recordRejection — is counted; firstSubmission false once done', () => {
    const coord = open(); const id = seedRun(coord);
    coord.recordRejection({ code: REFUSAL, runId: id, toId: 'demo-worker', detail: 'the tip moved' });
    expect(coord.runSignals(id)).toMatchObject({ closeRefusals: 1, firstSubmission: null });
    coord.advance(id, 'closing', 'coordinator'); coord.advance(id, 'done', 'coordinator');
    expect(coord.runSignals(id)).toMatchObject({ closeRefusals: 1, firstSubmission: false, finalState: 'done' });
  });

  it('a failed run has finalState failed and firstSubmission null', () => {
    const coord = open(); const id = seedRun(coord);
    coord.advance(id, 'failed', 'operator');
    expect(coord.runSignals(id)).toMatchObject({ finalState: 'failed', firstSubmission: null, wallMs: expect.any(Number) });
  });
});
```

`recordRejection`'s input is `{ code: MailRejectCode; fromId?; fromUuid?; toId?; runId?; kind?; subject?; detail? }` (`store.ts:3130`); if `DONE_AUTHORITY_CODES[0]` is not assignable to `MailRejectCode`, cast it exactly as `close.ts:260` passes `verdict.code`.

- [ ] **Step 3: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/run-signals.test.ts`
Expected: FAIL — `runSignals is not a function`.

- [ ] **Step 4: Implement `runSignals`**

In `server/src/coord/store.ts`, directly after `runEvents` (line 1899):

```ts
  /** Routing spec 2026-09-14 §6 — speed and quality per run, read-only. The
   *  worker is `runs.sessionId` (never `claimedBy`, the coordinator). Holds
   *  pair `hold done` with the next `release done`; a swap is ONE `done` row
   *  in ccd's journal (no intent, no landing pair — `ccd/ccd:17166`), so it is
   *  COUNTED and flagged, never timed. Refused wave-dones are the
   *  `mail_rejections` rows `closeRun` records with a DONE_AUTHORITY code —
   *  the same rows `runsRejectionSummary`-style queries above already count. */
  runSignals(runId: number): RunSignals | null {
    const run = this.db.prepare('SELECT sessionId FROM runs WHERE id = ?').get(runId) as
      { sessionId: string | null } | undefined;
    if (!run) return null;
    const events = this.runEvents(runId);
    const transition = (to: (s: string) => boolean) => events.find((e) => e.fromState !== e.toState && to(e.toState));
    const dispatchedAt = transition((s) => s === 'dispatched')?.at ?? null;
    const final = transition((s) => s === 'done' || s === 'failed');
    const closedAt = final?.at ?? null;
    const finalState = final ? (final.toState as 'done' | 'failed') : null;
    const codes = placeholders(DONE_AUTHORITY_CODES.length);
    const closeRefusals = (this.db.prepare(
      `SELECT COUNT(*) AS n FROM mail_rejections WHERE runId = ? AND code IN (${codes})`,
    ).get(runId, ...DONE_AUTHORITY_CODES) as { n: number }).n;
    const wallMs = dispatchedAt !== null && closedAt !== null ? closedAt - dispatchedAt : null;
    let holdMs = 0;
    let swaps = 0;
    let excludedUnmeasured = false;
    if (run.sessionId !== null && dispatchedAt !== null && closedAt !== null) {
      const rows = this.db.prepare(
        'SELECT at, act FROM lifecycle_events ' +
        "WHERE sessionId = ? AND outcome = 'done' AND at IS NOT NULL AND at >= ? AND at <= ? AND act IN ('swap','hold','release') " +
        'ORDER BY at, id',
      ).all(run.sessionId, dispatchedAt, closedAt) as { at: number; act: string }[];
      let holdOpenAt: number | null = null;
      for (const r of rows) {
        if (r.act === 'swap') swaps += 1;
        else if (r.act === 'hold') { if (holdOpenAt === null) holdOpenAt = r.at; }
        else if (r.act === 'release') {
          if (holdOpenAt === null) excludedUnmeasured = true;
          else { holdMs += r.at - holdOpenAt; holdOpenAt = null; }
        }
      }
      if (holdOpenAt !== null) excludedUnmeasured = true;
    }
    if (swaps > 0) excludedUnmeasured = true;
    return {
      runId, dispatchedAt, closedAt, finalState, wallMs, holdMs, swaps, excludedUnmeasured,
      activeMs: wallMs === null ? null : Math.max(0, wallMs - holdMs),
      closeRefusals,
      firstSubmission: finalState === 'done' ? closeRefusals === 0 : null,
    };
  }
```

`placeholders` and `DONE_AUTHORITY_CODES` are already imported into `store.ts` (used at 2127-2133); import `type RunSignals` from `../../shared/api.js`.

- [ ] **Step 5: Run the store test**

Run: `cd server && ./node_modules/.bin/vitest run test/run-signals.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing route tests**

In `server/test/run-routes.test.ts`, inside the describe that exercises `POST /api/runs/:id/close` with a stale tip (grep `stale-tip` in that file; it drives a run to the 409 through `openApp`/`postOpen`/`postDispatch`), add one test that repeats that describe's own setup up to the 409 and then:

```ts
    const r = await app.inject({ method: 'GET', url: `/api/runs/${id}/signals`, headers: tokenHeaders(TOKEN) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, signals: { runId: id, closeRefusals: 1, firstSubmission: null } });
    const missing = await app.inject({ method: 'GET', url: '/api/runs/999999/signals', headers: tokenHeaders(TOKEN) });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ ok: false, error: 'unknown-run' });
    const bad = await app.inject({ method: 'GET', url: '/api/runs/x/signals', headers: tokenHeaders(TOKEN) });
    expect(bad.statusCode).toBe(400);
```

The gate lives in `server/test/auth-gate.test.ts`, not here (run-routes' fixture leaves auth off): that file censuses every route by name (the lists at its lines 64, 242 and 422, which name `'GET /api/runs'` and `'GET /api/runs/:id/items'`). Add `'GET /api/runs/:id/signals'` beside `'GET /api/runs/:id/items'` in every list where the latter appears, and let the suite's own probe drive it (unauthenticated → 401; box token or session → past the gate, where an unknown run answers 404 — assert 404, not 200, so the authenticated arm proves the gate and not a run).

- [ ] **Step 7: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts test/auth-gate.test.ts`
Expected: the new run-routes test FAILS (fastify 404 for the unknown route); `auth-gate` reds on the census once the name is listed and the route is absent.

- [ ] **Step 8: Implement the route**

`server/src/coord/routes.ts`, directly after the `app.get('/api/runs', …)` handler:

```ts
  /** Routing spec 2026-09-14 §6 — the run's speed and quality signals. READ,
   *  gated exactly as `GET /api/runs` above: a session cookie OR the box token
   *  when auth is armed, because the coordinator skill reads it cookieless
   *  from the fleet host. Nothing is written here: the refused-close count it
   *  reports is `closeRun`'s own `recordRejection` row. */
  app.get('/api/runs/:id/signals', async (req, reply) => {
    if (deps.cfg.authEnabled) {
      const session = sessionAuth(req);
      if (session.reason !== 'session') {
        const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
        if (token !== 'ok') {
          return reply.code(401).send({
            ok: false, error: 'unauthenticated', verdict: session.verdict,
            detail: 'GET /api/runs/:id/signals takes a session cookie OR the box token ' +
              `(${MAIL_TOKEN_HEADER}); the coordinator skill reads it cookieless from the fleet host`,
          });
        }
      }
    }
    if (!deps.coord) return notConfigured(reply);
    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const signals = deps.coord.runSignals(id);
    if (signals === null) return reply.code(404).send({ ok: false, error: 'unknown-run' });
    return { ok: true, signals };
  });
```

If `auth/gate.ts`'s `EXEMPT` census or `box-token-census.test.ts` reds on the new route, add it to the same set `GET /api/runs` sits in (the failure names the set).

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts test/run-signals.test.ts test/auth-gate.test.ts test/box-token-census.test.ts test/coord-pause-route.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add shared/api.ts server/src/coord/store.ts server/src/coord/routes.ts server/test/run-signals.test.ts server/test/run-routes.test.ts server/test/auth-gate.test.ts
git commit -m "feat(coord): run signals — runSignals over run events, holds, swaps and refused closes; GET /api/runs/:id/signals (routing slice 0, Task 5)"
```

---

### Task 6: The transcript accounting scanner

**Files:**
- Create: `ccd/ccd-usage-sweep.py`
- Modify: `shared/models.mjs:443` — `const FAMILY_TOKENS` becomes `export const FAMILY_TOKENS` (the one id-to-class table; `familyClassOf` keeps using it)
- Test: `server/test/usage-sweep.test.ts` (new)

**Interfaces:**
- Consumes: every `*.jsonl` under each config dir's `projects/` tree (subagent transcripts live under a `subagents/` path segment and carry `isSidechain`), lines with `"type":"assistant"` and `message.usage`; the top-level `effort` field on those lines (measured 2026-09-14 on this fleet: `"effort":"xhigh"`); `~/.cc-limits/<account>.json` (`seven`, `ts`); `$REG/<id>.uuid` for the uuid → ccd-id join; `$REG/usage/` for orphan reaping; the class tokens, PASSED IN — the scanner holds no table of its own.
- Produces: `python3 ccd/ccd-usage-sweep.py --dirs <json: {configDir: accountId}> --class-tokens <json: [[token, class], …]> --registry <dir> --limits <dir> --out <file> [--days 7] [--now <epoch>] [--reap-orphans]` writing one JSON object:

```
{ "schema": 1, "startedAt", "finishedAt", "windowDays", "now",
  "scan": { "files", "filesInWindow", "assistantLines", "parseErrors", "records", "duplicatesRemoved" },
  "attribution": "a message id seen in more than one config dir (a swap carries transcripts) is counted ONCE, for the config dir that sorts first; every such record is also counted in that account's carriedAcrossDirs",
  "rates": { "label": "… a PROXY …", "table": {...} },
  "perModel":   { "<model id>": { "n", "input", "output", "cacheRead", "cacheWrite", "apiUsd" } },
  "perClass":   { "fable|opus|sonnet|haiku|other": { same } },
  "perEffort":  { "<effort or 'none'>": { "n", "output" } },
  "perAccount": { "<account>": { "n", "apiUsd", "carriedAcrossDirs", "perClass": { … },
                  "fableShare": { "estimate": 0..1|null, "basis": "…", "sevenPct": n|null, "sevenTs": n|null, "carriedAcrossDirs": n } } },
  "perSession": { "<claude uuid>": { "ccdId": "<id>|null", "account", "project", "n", "output", "cacheRead", "cacheWrite", "apiUsd", "subagentN", "models": {}, "efforts": {} } },
  "orphansReaped": [ "<ccd id>", … ] }
```

- [ ] **Step 1: Export the token table**

`shared/models.mjs:443`: change `const FAMILY_TOKENS = [` to `export const FAMILY_TOKENS = [` and add above it: `/** The ONE model-id → class table (routing spec §6: never a second list). Exported so the usage sweep's runner can hand it to the python scanner as data. */`. Add `FAMILY_TOKENS,` to the re-export list in `shared/models.ts:165-176` beside `familyClassOf`. Run `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/modelenv.test.ts` — green (an export is not a second definition).

- [ ] **Step 2: Write the failing test**

```ts
// server/test/usage-sweep.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { FAMILY_TOKENS } from '../../shared/models.mjs';

afterEach(removeTmpFixtures);
const SCANNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ccd/ccd-usage-sweep.py');
/** The clock the scanner is told (`--now`). EVERY fixture transcript's mtime is
 *  stamped relative to it, because the scanner's first gate is mtime against
 *  `now - days`, and a file written with the real wall clock would sit outside a
 *  window anchored on a constant. */
const NOW = 1_800_000_000;
const iso = (s: number): string => new Date(s * 1000).toISOString();
const stamp = (f: string, at: number): void => { utimesSync(f, at, at); };

function line(over: Record<string, unknown>): string {
  const base = {
    type: 'assistant', timestamp: iso(NOW - 3600), sessionId: 'sess-1', effort: 'high',
    message: { id: 'msg-1', model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10_000 } },
  };
  const merged = { ...base, ...over, message: { ...base.message, ...((over['message'] as object) ?? {}) } };
  return JSON.stringify(merged) + '\n';
}

function fixture(): { home: string; dirs: Record<string, string> } {
  const home = mkTmp('ccrc-usage-sweep-');
  const a = path.join(home, '.claude'); const b = path.join(home, '.claude-two');
  const proj = (d: string, slug: string): string => { const p = path.join(d, 'projects', slug); mkdirSync(p, { recursive: true }); return p; };
  // dir A: a main transcript (with one truncated assistant line that carries the
  // prefilter token but is not JSON), a subagent transcript, one old file
  const main = path.join(proj(a, '-w-demo'), 'sess-1.jsonl');
  writeFileSync(main,
    line({ message: { id: 'msg-1' } })
    + line({ message: { id: 'msg-2', model: 'claude-fable-5-1', usage: { input_tokens: 0, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 100_000 } }, effort: 'xhigh' })
    + '{"type":"user","timestamp":"' + iso(NOW - 3600) + '"}\n'
    + '{"type":"assistant","message":{\n');
  stamp(main, NOW - 3600);
  const subDir = path.join(proj(a, '-w-demo'), 'sess-1', 'subagents'); mkdirSync(subDir, { recursive: true });
  const sub = path.join(subDir, 'agent-x.jsonl');
  writeFileSync(sub, line({ message: { id: 'msg-3', model: 'claude-sonnet-5' }, isSidechain: true, effort: 'medium' }));
  stamp(sub, NOW - 3600);
  const old = path.join(proj(a, '-w-demo'), 'old.jsonl');
  writeFileSync(old, line({ message: { id: 'msg-old' }, timestamp: iso(NOW - 30 * 86400) }));
  stamp(old, NOW - 30 * 86400);
  // dir B: the SAME msg-1 carried across by a swap (must dedupe), plus its own message
  const carried = path.join(proj(b, '-w-demo'), 'sess-2.jsonl');
  writeFileSync(carried,
    line({ message: { id: 'msg-1' }, sessionId: 'sess-2' })
    + line({ message: { id: 'msg-4', model: 'claude-haiku-4-5-20251001' }, sessionId: 'sess-2', effort: undefined }));
  stamp(carried, NOW - 3600);
  // limits + registry
  mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  writeFileSync(path.join(home, '.cc-limits', 'claude.json'), JSON.stringify({ five: 10, seven: 40, ts: NOW - 60, fiveResetAt: null, sevenResetAt: null }));
  mkdirSync(path.join(home, '.cc-sessions', 'usage', 'stale-id.agents'), { recursive: true });
  writeFileSync(path.join(home, '.cc-sessions', 'demo-live.uuid'), 'sess-1');
  writeFileSync(path.join(home, '.cc-sessions', 'usage', 'stale-id.json'), JSON.stringify({ ts: NOW - 2 * 86400 }));
  writeFileSync(path.join(home, '.cc-sessions', 'usage', 'fresh-orphan.json'), JSON.stringify({ ts: NOW - 60 }));
  writeFileSync(path.join(home, '.cc-sessions', 'usage', 'demo-live.json'), JSON.stringify({ ts: NOW - 60 }));
  return { home, dirs: { [a]: 'claude', [b]: 'two' } };
}

function runSweep(f: { home: string; dirs: Record<string, string> }, extra: string[] = []): Record<string, unknown> {
  const out = path.join(f.home, 'sweep.json');
  const r = spawnSync('python3', [SCANNER, '--dirs', JSON.stringify(f.dirs), '--class-tokens', JSON.stringify(FAMILY_TOKENS),
    '--registry', path.join(f.home, '.cc-sessions'), '--limits', path.join(f.home, '.cc-limits'), '--out', out,
    '--days', '7', '--now', String(NOW), ...extra], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
}

describe('ccd-usage-sweep.py', () => {
  it('dedupes by message id across config dirs, skips the old file by mtime, counts the truncated line as a parse error', () => {
    const f = fixture(); const s = runSweep(f);
    expect(s['scan']).toMatchObject({ records: 4, duplicatesRemoved: 1, parseErrors: 1, filesInWindow: 3, files: 4 });
    const perModel = s['perModel'] as Record<string, Record<string, number>>;
    expect(perModel['claude-opus-5']).toMatchObject({ n: 1, output: 100, cacheRead: 10_000, cacheWrite: 1000 });
    expect(perModel['claude-fable-5-1']).toMatchObject({ n: 1, output: 1000 });
    expect(perModel['claude-sonnet-5']).toMatchObject({ n: 1 });
    expect(perModel['claude-haiku-4-5-20251001']).toMatchObject({ n: 1 });
    expect(s['perClass']).toMatchObject({ opus: { n: 1 }, fable: { n: 1 }, sonnet: { n: 1 }, haiku: { n: 1 } });
    const perSession = s['perSession'] as Record<string, Record<string, unknown>>;
    expect(perSession['sess-1']).toMatchObject({ ccdId: 'demo-live', account: 'claude', n: 3, subagentN: 1, efforts: { high: 1, xhigh: 1, medium: 1 } });
    expect(perSession['sess-2']).toMatchObject({ ccdId: null, account: 'two', n: 1, efforts: { none: 1 } });
    expect(s['perEffort']).toMatchObject({ high: { n: 1 }, xhigh: { n: 1 }, medium: { n: 1 }, none: { n: 1 } });
  });

  it('attribution of a carried record does not depend on the order --dirs is written in, and is counted', () => {
    const f = fixture();
    const forward = runSweep(f);
    const reversed = runSweep({ home: f.home, dirs: Object.fromEntries(Object.entries(f.dirs).reverse()) });
    expect(reversed['perAccount']).toEqual(forward['perAccount']);
    const acct = (forward['perAccount'] as Record<string, Record<string, unknown>>);
    expect(acct['claude']).toMatchObject({ carriedAcrossDirs: 1 });   // msg-1 lives in both dirs; .claude sorts first
    expect(acct['two']).toMatchObject({ carriedAcrossDirs: 0 });
    expect(forward['attribution']).toContain('sorts first');
  });

  it('classifies with the tokens it was given and refuses to run without them', () => {
    const f = fixture();
    const out = path.join(f.home, 'x.json');
    const r = spawnSync('python3', [SCANNER, '--dirs', JSON.stringify(f.dirs), '--registry', path.join(f.home, '.cc-sessions'),
      '--limits', path.join(f.home, '.cc-limits'), '--out', out, '--now', String(NOW)], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--class-tokens');
    expect(existsSync(out)).toBe(false);
  });

  it('estimates the Fable share per account as fable apiUsd over all apiUsd, joined to the seven-day figure, labelled', () => {
    const f = fixture(); const s = runSweep(f);
    const acct = (s['perAccount'] as Record<string, Record<string, unknown>>)['claude']!;
    const share = acct['fableShare'] as Record<string, unknown>;
    expect(share['estimate']).toBeGreaterThan(0); expect(share['estimate']).toBeLessThan(1);
    expect(share).toMatchObject({ sevenPct: 40, sevenTs: NOW - 60, carriedAcrossDirs: 1, basis: expect.stringContaining('fable apiUsd') });
    const two = (s['perAccount'] as Record<string, Record<string, unknown>>)['two']!;
    expect((two['fableShare'] as Record<string, unknown>)['estimate']).toBe(0);
    expect((two['fableShare'] as Record<string, unknown>)['sevenPct']).toBeNull();
    expect((s['rates'] as Record<string, unknown>)['label']).toContain('PROXY');
  });

  it('--reap-orphans removes a sidecar with no registry row older than a day, and nothing else', () => {
    const f = fixture(); const s = runSweep(f, ['--reap-orphans']);
    expect(s['orphansReaped']).toEqual(['stale-id']);
    const u = (rel: string): boolean => existsSync(path.join(f.home, '.cc-sessions', 'usage', rel));
    expect(u('stale-id.json')).toBe(false); expect(u('stale-id.agents')).toBe(false);
    expect(u('fresh-orphan.json')).toBe(true); expect(u('demo-live.json')).toBe(true);
  });

  it('without --reap-orphans nothing is removed', () => {
    const f = fixture(); runSweep(f);
    expect(existsSync(path.join(f.home, '.cc-sessions', 'usage', 'stale-id.json'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/usage-sweep.test.ts`
Expected: FAIL — python3 cannot open the scanner.

- [ ] **Step 4: Write the scanner**

```python
#!/usr/bin/env python3
"""ccd-usage-sweep.py — the offline accounting sweep (routing spec 2026-09-14 §6).

READ-ONLY over the transcripts. One JSON object out. Runs on the fleet box under
`ccd-usage-sweep` (the bash runner, which supplies the roster map, the class
tokens and the lock).

Every Claude Code transcript line of `type: assistant` carries `message.usage`
and `message.id`; a swap carries whole transcripts across config dirs, and a
streamed reply is split across lines that repeat the same `message.id`, so the
ONLY correct total is a GLOBAL dedupe by message id across every dir scanned
(85% of raw assistant lines were duplicates in the 30-day survey). Dirs are
walked in SORTED order so a carried record is attributed the same way on every
run, and the carry is COUNTED per account. The `effort` field is top-level on
the line. Subagent transcripts live under a `subagents/` path segment and/or
carry `isSidechain`. The model-id → class table is NOT here: it is
`shared/models.mjs`'s `FAMILY_TOKENS`, passed in as `--class-tokens`.
"""
import argparse, json, os, sys, time

# A PROXY, labelled as such in the output: the subscription's per-class window
# weights are unpublished (research note 2026-09-13 §6). USD per MTok:
# (input, output, cache_read, cache_write). None = not published for that class.
PROXY_RATES_USD_PER_MTOK = {
    "fable":  (10.0, 50.0, 1.00, None),
    "opus":   (5.0,  25.0, 0.50, 6.25),
    "sonnet": (2.0,  10.0, 0.20, 2.50),
    "haiku":  (1.0,   5.0, 0.10, 1.25),
}
RATES_LABEL = ("API rate card, USD per MTok — a PROXY: the subscription's per-class window weights are unpublished; "
               "use for ranking within a window, never as an invoice")
ATTRIBUTION = ("a message id seen in more than one config dir (a swap carries transcripts) is counted ONCE, for the "
               "config dir that sorts first; every such record is also counted in that account's carriedAcrossDirs")
ORPHAN_AGE_S = 86400


def class_of(model, tokens):
    m = (model or "")
    for tok, cls in tokens:
        if tok in m:
            return cls
    return "other"


def api_usd(cls, inp, out, cread, cwrite):
    r = PROXY_RATES_USD_PER_MTOK.get(cls)
    if r is None:
        return 0.0
    total = inp / 1e6 * r[0] + out / 1e6 * r[1]
    if r[2] is not None:
        total += cread / 1e6 * r[2]
    if r[3] is not None:
        total += cwrite / 1e6 * r[3]
    return total


def bucket():
    return {"n": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "apiUsd": 0.0}


def add(b, rec):
    b["n"] += 1
    b["input"] += rec["input"]; b["output"] += rec["output"]
    b["cacheRead"] += rec["cacheRead"]; b["cacheWrite"] += rec["cacheWrite"]
    b["apiUsd"] += rec["apiUsd"]


def scan(dirs, tokens, now, days, stats, carried):
    """dirs: {configDir: accountId}. Returns {messageId: record}, deduped globally,
    dirs walked in sorted order; `carried[account]` counts records whose id was
    already seen from an earlier dir."""
    cutoff_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now - days * 86400))
    mtime_cutoff = now - days * 86400
    records = {}
    for cfg_dir in sorted(dirs):
        account = dirs[cfg_dir]
        carried.setdefault(account, 0)
        root = os.path.join(cfg_dir, "projects")
        if not os.path.isdir(root):
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                if not fn.endswith(".jsonl"):
                    continue
                fpath = os.path.join(dirpath, fn)
                stats["files"] += 1
                try:
                    st = os.stat(fpath)
                except OSError:
                    continue
                if st.st_mtime < mtime_cutoff:
                    continue
                stats["filesInWindow"] += 1
                in_subagent_path = (os.sep + "subagents" + os.sep) in fpath
                project = os.path.relpath(fpath, root).split(os.sep)[0]
                try:
                    with open(fpath, "rb") as f:
                        for raw in f:
                            if b'"type":"assistant"' not in raw:
                                continue
                            stats["assistantLines"] += 1
                            try:
                                d = json.loads(raw)
                            except Exception:
                                stats["parseErrors"] += 1
                                continue
                            ts = d.get("timestamp") or ""
                            if ts[:19] < cutoff_iso:
                                continue
                            msg = d.get("message") or {}
                            usage = msg.get("usage")
                            mid = msg.get("id")
                            if not usage or not mid:
                                continue
                            if mid in records:
                                stats["duplicatesRemoved"] += 1
                                if records[mid]["account"] != account:
                                    carried[records[mid]["account"]] += 1
                                continue
                            model = msg.get("model")
                            cls = class_of(model, tokens)
                            inp = int(usage.get("input_tokens") or 0)
                            out = int(usage.get("output_tokens") or 0)
                            cread = int(usage.get("cache_read_input_tokens") or 0)
                            cwrite = int(usage.get("cache_creation_input_tokens") or 0)
                            effort = d.get("effort")
                            records[mid] = {
                                "model": model, "class": cls, "input": inp, "output": out,
                                "cacheRead": cread, "cacheWrite": cwrite,
                                "apiUsd": api_usd(cls, inp, out, cread, cwrite),
                                "effort": effort if isinstance(effort, str) and effort else "none",
                                "sessionId": d.get("sessionId"),
                                "subagent": bool(in_subagent_path or d.get("isSidechain")),
                                "account": account, "project": project,
                            }
                except OSError:
                    continue
    stats["records"] = len(records)
    return records


def read_uuid_map(registry):
    """$REG/<id>.uuid -> {uuid: ccdId}; a dead uuid maps to nobody."""
    out = {}
    try:
        names = os.listdir(registry)
    except OSError:
        return out
    for n in names:
        if not n.endswith(".uuid") or n.startswith("."):
            continue
        try:
            with open(os.path.join(registry, n)) as f:
                u = f.read().strip()
        except OSError:
            continue
        if u:
            out[u] = n[:-len(".uuid")]
    return out


def read_seven(limits, account):
    try:
        with open(os.path.join(limits, account + ".json")) as f:
            row = json.load(f)
    except (OSError, ValueError):
        return None, None
    seven = row.get("seven"); ts = row.get("ts")
    return (seven if isinstance(seven, (int, float)) else None), (ts if isinstance(ts, (int, float)) else None)


def reap_orphans(registry, now):
    """Remove usage/<id>.json (+ <id>.agents/) when no $REG/<id>.uuid exists and the row is older than a day."""
    reaped = []
    usage_dir = os.path.join(registry, "usage")
    try:
        names = os.listdir(usage_dir)
    except OSError:
        return reaped
    for n in sorted(names):
        if not n.endswith(".json") or n.startswith("."):
            continue
        sid = n[:-len(".json")]
        if os.path.exists(os.path.join(registry, sid + ".uuid")):
            continue
        try:
            with open(os.path.join(usage_dir, n)) as f:
                ts = (json.load(f) or {}).get("ts")
        except (OSError, ValueError):
            ts = None
        if isinstance(ts, (int, float)) and now - ts <= ORPHAN_AGE_S:
            continue
        try:
            os.remove(os.path.join(usage_dir, n))
        except OSError:
            continue
        agents = os.path.join(usage_dir, sid + ".agents")
        if os.path.isdir(agents):
            for root, ds, fs in os.walk(agents, topdown=False):
                for x in fs:
                    try: os.remove(os.path.join(root, x))
                    except OSError: pass
                for x in ds:
                    try: os.rmdir(os.path.join(root, x))
                    except OSError: pass
            try: os.rmdir(agents)
            except OSError: pass
        reaped.append(sid)
    return reaped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dirs", required=True, help='JSON object {configDir: accountId}')
    ap.add_argument("--class-tokens", required=True, help='JSON array [[substring, class], ...] — shared/models.mjs FAMILY_TOKENS')
    ap.add_argument("--registry", required=True)
    ap.add_argument("--limits", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--now", type=int, default=None)
    ap.add_argument("--reap-orphans", action="store_true")
    a = ap.parse_args()
    now = a.now if a.now is not None else int(time.time())
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    dirs = json.loads(a.dirs)
    tokens = json.loads(a.class_tokens)
    if not isinstance(tokens, list) or not all(isinstance(t, list) and len(t) == 2 for t in tokens):
        print("usage-sweep: --class-tokens must be a JSON array of [substring, class] pairs", file=sys.stderr)
        return 2
    stats = {"files": 0, "filesInWindow": 0, "assistantLines": 0, "parseErrors": 0, "records": 0, "duplicatesRemoved": 0}
    carried = {}
    records = scan(dirs, tokens, now, a.days, stats, carried)
    uuid_map = read_uuid_map(a.registry)

    per_model, per_class, per_effort, per_account, per_session = {}, {}, {}, {}, {}
    for rec in records.values():
        add(per_model.setdefault(rec["model"] or "(none)", bucket()), rec)
        add(per_class.setdefault(rec["class"], bucket()), rec)
        pe = per_effort.setdefault(rec["effort"], {"n": 0, "output": 0})
        pe["n"] += 1; pe["output"] += rec["output"]
        acct = per_account.setdefault(rec["account"], {"n": 0, "apiUsd": 0.0, "perClass": {}})
        acct["n"] += 1; acct["apiUsd"] += rec["apiUsd"]
        add(acct["perClass"].setdefault(rec["class"], bucket()), rec)
        sid = rec["sessionId"] or "(none)"
        s = per_session.setdefault(sid, {"ccdId": uuid_map.get(sid), "account": rec["account"], "project": rec["project"],
                                         "n": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "apiUsd": 0.0,
                                         "subagentN": 0, "models": {}, "efforts": {}})
        s["n"] += 1; s["output"] += rec["output"]; s["cacheRead"] += rec["cacheRead"]; s["cacheWrite"] += rec["cacheWrite"]
        s["apiUsd"] += rec["apiUsd"]
        if rec["subagent"]:
            s["subagentN"] += 1
        s["models"][rec["model"] or "(none)"] = s["models"].get(rec["model"] or "(none)", 0) + 1
        s["efforts"][rec["effort"]] = s["efforts"].get(rec["effort"], 0) + 1

    for account in sorted(set(dirs.values())):
        acct = per_account.setdefault(account, {"n": 0, "apiUsd": 0.0, "perClass": {}})
        acct["carriedAcrossDirs"] = carried.get(account, 0)
        fable = acct["perClass"].get("fable", {}).get("apiUsd", 0.0)
        estimate = (fable / acct["apiUsd"]) if acct["apiUsd"] > 0 else None
        seven, seven_ts = read_seven(a.limits, account)
        acct["fableShare"] = {"estimate": estimate,
                              "basis": "fable apiUsd / all apiUsd in the window (a PROXY, see rates.label)",
                              "sevenPct": seven, "sevenTs": seven_ts,
                              "carriedAcrossDirs": carried.get(account, 0)}

    reaped = reap_orphans(a.registry, now) if a.reap_orphans else []

    out = {"schema": 1, "startedAt": started, "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "windowDays": a.days, "now": now, "scan": stats, "attribution": ATTRIBUTION,
           "rates": {"label": RATES_LABEL, "table": {k: list(v) for k, v in PROXY_RATES_USD_PER_MTOK.items()}},
           "perModel": per_model, "perClass": per_class, "perEffort": per_effort,
           "perAccount": per_account, "perSession": per_session, "orphansReaped": reaped}
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    os.replace(tmp, a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

`chmod 755 ccd/ccd-usage-sweep.py`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/usage-sweep.test.ts`
Expected: PASS. (`files: 4` counts every `.jsonl` seen; `filesInWindow: 3` excludes the aged one by mtime; `parseErrors: 1` is the truncated assistant line, which carries the prefilter token and fails `json.loads`.)

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd-usage-sweep.py shared/models.mjs shared/models.ts server/test/usage-sweep.test.ts
git commit -m "feat(sweep): transcript accounting scanner — global dedupe, ordered attribution, tokens passed in, Fable share estimate (routing slice 0, Task 6)"
```

---

### Task 7: The sweep runner, its timer, and the installer

**Files:**
- Create: `ccd/ccd-usage-sweep`, `deploy/systemd/ccd-usage-sweep.service`, `deploy/systemd/ccd-usage-sweep.timer`
- Modify: `ccd/ccrc` — `_inst_bins` (beside `ccd/ccrc:9505`), `_inst_units` (beside 9904-9905), `_inst_enable` (beside 9990), the uninstall unit loop (11363-11380), the orphan-scan `case` (11463), the uninstall `rm -f` of executables (11580-11584); `deploy/gen-wrappers.mjs` `TOOLCHAIN_EXECUTABLES` (line 173); `server/test/timer-first-run.test.ts`'s `timers` array
- Test: the pinned-list suites: `server/test/ccrc-install.test.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/gen-wrappers.test.ts`, `server/test/installTreeFixture.ts`, `server/test/macos-platform.test.ts`, `server/test/single-definition.test.ts`, `server/test/timer-first-run.test.ts`, `server/test/ccrc-doctor.test.ts`; plus `server/test/usage-sweep-runner.test.ts` (new)

**Interfaces:**
- Consumes: `~/.ccrc/accounts.sh` (`CCRC_ACCOUNTS`, `_ccrc_cfg_dir`), Task 6's scanner and `FAMILY_TOKENS` (read with `node` from the deployed tree, `${CCRC_TREE:-$HOME/ccrc}/shared/models.mjs` — `~/ccrc` is where `ccrc install` puts the tree; `_check_accounts` reaches `deploy/` the same way).
- Produces: `~/.cc-sessions/usage/sweep/latest.json` (the scanner's output, agent-readable under the `.cc-sessions/` root), `~/.ccrc/usage-sweep.json` (a census of the last 10 passes, the graph sweep's shape), a `--user` timer every 30 minutes.

- [ ] **Step 1: Write the failing runner test**

```ts
// server/test/usage-sweep-runner.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { parseRoster } from '../../shared/roster.js';

afterEach(removeTmpFixtures);
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const RUNNER = path.join(REPO, 'ccd', 'ccd-usage-sweep');
const SCANNER = path.join(REPO, 'ccd', 'ccd-usage-sweep.py');
const ROSTER = { version: 1, accounts: [
  { id: 'claude', label: 'team·max', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
  { id: 'gpt', label: 'gpt', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
] };

function home(): string {
  const h = mkTmp('ccrc-usage-runner-');
  mkdirSync(path.join(h, '.ccrc'), { recursive: true });
  writeFileSync(path.join(h, '.ccrc', 'accounts.sh'), generateAccountsSh(parseRoster(ROSTER)));
  mkdirSync(path.join(h, '.cc-sessions'), { recursive: true });
  mkdirSync(path.join(h, '.cc-limits'), { recursive: true });
  mkdirSync(path.join(h, '.local', 'bin'), { recursive: true });
  writeFileSync(path.join(h, '.local', 'bin', 'ccd-usage-sweep.py'), readFileSync(SCANNER));
  mkdirSync(path.join(h, '.claude', 'projects', '-w-demo'), { recursive: true });
  writeFileSync(path.join(h, '.claude', 'projects', '-w-demo', 's.jsonl'),
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), sessionId: 's', effort: 'high',
      message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 } } }) + '\n');
  return h;
}
/** `CCRC_TREE` points the runner's `node` read of FAMILY_TOKENS at THIS checkout,
 *  where `~/ccrc` would be on a deployed box. */
const run = (h: string, env: Record<string, string> = {}): { code: number; out: string; err: string } => {
  const r = spawnSync('bash', [RUNNER], { encoding: 'utf8', env: { ...process.env, HOME: h, CCRC_TREE: REPO,
    PATH: `${path.join(h, '.local', 'bin')}:${process.env['PATH'] ?? ''}`, ...env } });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
};

describe('ccd-usage-sweep (the runner)', () => {
  it('maps every roster account to its config dir, hands the scanner the class tokens, writes latest.json and a census pass', () => {
    const h = home(); const r = run(h);
    expect(r.code, r.err).toBe(0);
    const latest = JSON.parse(readFileSync(path.join(h, '.cc-sessions', 'usage', 'sweep', 'latest.json'), 'utf8')) as Record<string, unknown>;
    expect((latest['perAccount'] as Record<string, unknown>)['claude']).toBeDefined();
    expect((latest['perAccount'] as Record<string, unknown>)['gpt']).toBeDefined();   // every account, even an unmeasured one
    expect((latest['perClass'] as Record<string, unknown>)['opus']).toMatchObject({ n: 1 });   // classified — the tokens arrived
    const census = JSON.parse(readFileSync(path.join(h, '.ccrc', 'usage-sweep.json'), 'utf8')) as { passes: Record<string, unknown>[] };
    expect(census.passes).toHaveLength(1);
    expect(census.passes[0]).toMatchObject({ status: 'ok', records: 1 });
  });
  it('keeps the last ten passes only', () => {
    const h = home();
    for (let i = 0; i < 12; i += 1) expect(run(h).code).toBe(0);
    const census = JSON.parse(readFileSync(path.join(h, '.ccrc', 'usage-sweep.json'), 'utf8')) as { passes: unknown[] };
    expect(census.passes).toHaveLength(10);
  });
  it('a missing roster projection is a refusal (rc 1) with no latest.json', () => {
    const h = home(); writeFileSync(path.join(h, '.ccrc', 'accounts.sh'), '');
    const r = run(h);
    expect(r.code).toBe(1);
    expect(r.err).toContain('accounts.sh');
    expect(existsSync(path.join(h, '.cc-sessions', 'usage', 'sweep', 'latest.json'))).toBe(false);
  });
  it('a tree with no shared/models.mjs is a refusal (rc 1): the class table is read, never guessed', () => {
    const h = home();
    const r = run(h, { CCRC_TREE: path.join(h, 'no-such-tree') });
    expect(r.code).toBe(1);
    expect(r.err).toContain('models.mjs');
    expect(existsSync(path.join(h, '.cc-sessions', 'usage', 'sweep', 'latest.json'))).toBe(false);
  });
  it('a pause file skips the pass and says so', () => {
    const h = home(); writeFileSync(path.join(h, '.ccrc', 'usage-sweep-paused'), '');
    const r = run(h);
    expect(r.code).toBe(0); expect(r.out).toContain('paused');
    expect(existsSync(path.join(h, '.cc-sessions', 'usage', 'sweep', 'latest.json'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/usage-sweep-runner.test.ts`
Expected: FAIL — no such file `ccd/ccd-usage-sweep`.

- [ ] **Step 3: Write the runner**

```bash
#!/usr/bin/env bash
# ccd-usage-sweep — the offline accounting sweep's runner (routing spec
# 2026-09-14 §6). Serialized oneshot driven by ccd-usage-sweep.timer, owned the
# way ccd-graph-sweep is: one lock, one census of the last ten passes, one pause
# file. READ-ONLY over transcripts; the only writes are `latest.json`, the
# census, and (`--reap-orphans`) usage sidecars whose registry row is gone.
set -uo pipefail
REG="$HOME/.cc-sessions"
LIMITS="$HOME/.cc-limits"
OUT_DIR="$REG/usage/sweep"
CENSUS="$HOME/.ccrc/usage-sweep.json"
PAUSE="$HOME/.ccrc/usage-sweep-paused"
LOCK="$HOME/.ccrc/usage-sweep.lock"
ACCOUNTS_SH="$HOME/.ccrc/accounts.sh"
SCANNER="$HOME/.local/bin/ccd-usage-sweep.py"
# The deployed tree (`ccrc install` puts it at ~/ccrc; `_check_accounts` reaches
# deploy/ the same way). The class table is READ from shared/models.mjs, the one
# definition, and handed to the scanner as data — never copied into it.
: "${CCRC_TREE:=$HOME/ccrc}"
MODELS_MJS="$CCRC_TREE/shared/models.mjs"
: "${CCRC_USAGE_SWEEP_DAYS:=7}"
STARTED="$(date -u +%FT%TZ)"

_us_finish() {   # status records rc
  local status="$1" records="$2" rc="$3" tmp
  mkdir -p "$(dirname "$CENSUS")"
  tmp="$(mktemp "$CENSUS.XXXXXX")"
  jq -cn --arg started "$STARTED" --arg finished "$(date -u +%FT%TZ)" --arg status "$status" --argjson records "$records" \
    '{started:$started, finished:$finished, status:$status, records:$records}' > "$tmp" \
    || { rm -f "$tmp"; echo "usage-sweep: census assembly failed" >&2; exit 1; }
  jq -c --slurpfile p "$tmp" '.passes = ((.passes // []) + $p | .[-10:])' "$CENSUS" 2>/dev/null > "$tmp.2" \
    || jq -cn --slurpfile p "$tmp" '{passes: $p}' > "$tmp.2"
  mv "$tmp.2" "$CENSUS"; rm -f "$tmp"
  exit "$rc"
}

[ -e "$PAUSE" ] && { echo "usage-sweep: paused ($PAUSE exists)"; exit 0; }
for bin in jq python3 node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "usage-sweep: $bin is required" >&2; exit 1; }
done
[ -r "$SCANNER" ] || { echo "usage-sweep: scanner missing at $SCANNER" >&2; exit 1; }
[ -r "$MODELS_MJS" ] || { echo "usage-sweep: no shared/models.mjs at $MODELS_MJS (set CCRC_TREE to the ccrc checkout)" >&2; exit 1; }
# The roster projection, sourced for the same reason the statusline hook sources
# it: the account list is DATA. An empty or absent projection is a refusal, not a
# sweep of nothing — a census pass of zero accounts would read as "measured".
# shellcheck source=/dev/null
if ! [ -r "$ACCOUNTS_SH" ] || ! . "$ACCOUNTS_SH" 2>/dev/null || ! declare -F _ccrc_cfg_dir >/dev/null 2>&1 \
   || [ "${#CCRC_ACCOUNTS[@]}" -eq 0 ]; then
  echo "usage-sweep: no usable roster projection at $ACCOUNTS_SH (generate it: ccrc install)" >&2; exit 1
fi
tokens="$(node --input-type=module -e "import { FAMILY_TOKENS } from '$MODELS_MJS'; console.log(JSON.stringify(FAMILY_TOKENS));" 2>/dev/null)" \
  || { echo "usage-sweep: could not read FAMILY_TOKENS from $MODELS_MJS" >&2; exit 1; }
[ -n "$tokens" ] || { echo "usage-sweep: FAMILY_TOKENS read empty from $MODELS_MJS" >&2; exit 1; }
mkdir -p "$(dirname "$LOCK")" "$OUT_DIR"
exec 9>"$LOCK"
flock -n 9 || { echo "usage-sweep: another pass holds $LOCK"; exit 0; }

# {configDir: accountId} for every roster account — including unmeasured ones,
# so an account with no telemetry still gets its transcripts counted.
dirs="$(for a in "${CCRC_ACCOUNTS[@]}"; do d="$(_ccrc_cfg_dir "$a")"; [ -n "$d" ] && jq -cn --arg d "$d" --arg a "$a" '{($d): $a}'; done | jq -cs 'add // {}')"

records=0
if python3 "$SCANNER" --dirs "$dirs" --class-tokens "$tokens" --registry "$REG" --limits "$LIMITS" \
     --out "$OUT_DIR/latest.json" --days "$CCRC_USAGE_SWEEP_DAYS" --reap-orphans; then
  records="$(jq -r '.scan.records // 0' "$OUT_DIR/latest.json" 2>/dev/null || echo 0)"
  echo "usage-sweep: ok — $records records in the last $CCRC_USAGE_SWEEP_DAYS days -> $OUT_DIR/latest.json"
  _us_finish ok "$records" 0
else
  echo "usage-sweep: scanner failed" >&2
  _us_finish failed 0 1
fi
```

`chmod 755 ccd/ccd-usage-sweep`.

`deploy/systemd/ccd-usage-sweep.timer`:

```ini
[Unit]
Description=Run the usage accounting sweep every 30 minutes (routing spec 2026-09-14 §6)
[Timer]
# `OnActiveSec=`, for ccd-telemetry-keepalive.timer's reason: this unit is first
# armed by a deploy on a box that has been up for days, and the first pass should
# land after the supervisor sweep, not on top of it. It spends no tokens, so the
# stakes are lower than the keepalive's; the anchor is still the honest one for a
# unit in the per-user manager.
OnActiveSec=5min
OnUnitActiveSec=30min
AccuracySec=1min
[Install]
WantedBy=timers.target
```

`deploy/systemd/ccd-usage-sweep.service`:

```ini
[Unit]
Description=Usage accounting sweep — de-duplicated transcript totals (routing spec 2026-09-14 §6)
[Service]
Type=oneshot
ExecStart=%h/.local/bin/ccd-usage-sweep
# budget: a full 7-day scan of every lane's transcripts is well under a minute on
# the fleet box (the 30-day survey took ~4 minutes single-threaded); a pass past
# this is wedged, not slow.
TimeoutStartSec=900
# the scanner holds one dict of deduped records; the 30-day survey peaked well
# under 1G. A sweep must never be the thing that OOMs the fleet host.
MemoryMax=2G
```

- [ ] **Step 4: Wire the installer**

In `ccd/ccrc`:
- `_inst_bins`, directly after the `ccd-graph-sweep` `_inst_atomic` line (9505), on the same non-Darwin arm:
  ```bash
    # Routing slice 0: the usage accounting sweep and its scanner, on the sweep's
    # exact terms — every role, systemd only (its only runner is a timer).
    _inst_atomic "$tree/ccd/ccd-usage-sweep" "$bin/ccd-usage-sweep" 755
    _inst_atomic "$tree/ccd/ccd-usage-sweep.py" "$bin/ccd-usage-sweep.py" 755
  ```
  and extend the two `echo "install: bins: …"` sentences (9528, 9530) to name `ccd-usage-sweep` in the systemd list and in the "no …" list of the macOS sentence.
- `_inst_units`, after the two graph-sweep `_inst_atomic` lines (9904-9905), inside the same `[ "$INST_ROLE" != server ]` gate:
  ```bash
    _inst_atomic "$tree/deploy/systemd/ccd-usage-sweep.service" "$dir/ccd-usage-sweep.service" 644
    _inst_atomic "$tree/deploy/systemd/ccd-usage-sweep.timer" "$dir/ccd-usage-sweep.timer" 644
  ```
- `_inst_enable`, after the graph-sweep enable (9990-9991):
  ```bash
  [ "$INST_ROLE" = server ] || systemctl --user enable --now ccd-usage-sweep.timer \
    || echo "install: usage-sweep: could not enable ccd-usage-sweep.timer — run: systemctl --user enable --now ccd-usage-sweep.timer" >&2
  ```
- The uninstall unit loop (11363-11366): add `ccd-usage-sweep.timer ccd-usage-sweep.service` to the `for u in …` list; the `rm -f` of unit files (11374-11379): add `"$dir/ccd-usage-sweep.service" "$dir/ccd-usage-sweep.timer"`.
- The orphan-scan `case` (11463): add `ccd-usage-sweep` to the `continue` arm. NOT `ccd-usage-sweep.py`: that scan only reaches names matching `WRAPPER_ID_RE`, which a name with a dot never does, so the `.py` entry would be inert (the same property `ccd/ccrc:2993` documents as load-bearing for backup names).
- The executable `rm -f` (11580-11582): add `"$HOME/.local/bin/ccd-usage-sweep" "$HOME/.local/bin/ccd-usage-sweep.py"` (both — this is an explicit list, not the regex scan), and extend the `echo "uninstall: tree: …"` sentence that lists them.
- `deploy/gen-wrappers.mjs:173`: add `'ccd-usage-sweep'` to `TOOLCHAIN_EXECUTABLES` (the `.py` name is invisible to that scan for the same dot reason; do not list it).
- `server/test/timer-first-run.test.ts`: add `'ccd-usage-sweep.timer'` to its `timers` array with the anchor `OnActiveSec` — that suite censuses timers by a hand-kept list and will NOT red on its own for a new timer, so the edit is named here rather than left to a red that does not come.

- [ ] **Step 5: Run the pinned-list suites and extend each list the failures name**

Run: `cd server && ./node_modules/.bin/vitest run test/usage-sweep-runner.test.ts test/ccrc-install.test.ts test/ccrc-uninstall.test.ts test/gen-wrappers.test.ts test/macos-platform.test.ts test/single-definition.test.ts test/timer-first-run.test.ts test/ccrc-doctor.test.ts`
Expected: the runner test PASSES; each pinned-list suite that reds names the list (installed binaries, unit names, toolchain set) — add the two executables and the two units to that list and re-run until green. `installTreeFixture.ts` is the fixture those suites share; add the files there if a suite reports them missing from the fixture tree. Do not weaken an assertion to pass.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd-usage-sweep deploy/systemd/ccd-usage-sweep.service deploy/systemd/ccd-usage-sweep.timer ccd/ccrc deploy/gen-wrappers.mjs server/test
git commit -m "feat(sweep): ccd-usage-sweep runner, timer and installer arms (routing slice 0, Task 7)"
```

---

### Task 8: Ship agent-first and measure the gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` §6 (one row: the sidecar coverage measurement)
- No source changes.

**Interfaces:**
- Consumes: `deploy/deploy.sh agent` (coordinates in `~/.ccrc/deploy.env`; `deploy/reference-fleet.md` is gitignored), then `deploy/deploy.sh` (server).
- Produces: the slice's gate (spec §7 slice 0): seven days of sidecar data on every Anthropic lane.

- [ ] **Step 1: Run the full server suite in four chunks before shipping**

Run, from `server/`, foreground, `timeout 600000` each: `./node_modules/.bin/vitest run --maxWorkers=2 test/[a-c]*.test.ts`, then `test/[d-l]*.test.ts`, `test/[m-r]*.test.ts`, `test/[s-z]*.test.ts`. Re-run any of the known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) in isolation before calling a red real. Then `cd agent && npm run test` and `cd pwa && npm run test`.

- [ ] **Step 2: Open the PR and merge on review**

`gh pr create` against `main` from `ws/ccrc-token-optimization-strategy` with the slice's summary; the PR body ends with the attribution line the session reminder specifies. Merge only after the operator's approval (protected main).

- [ ] **Step 3: Deploy, agent lane first**

From the box that holds `~/.ccrc/deploy.env`: `bash deploy/deploy.sh agent` (the agent lane; installs `ccd`, the statusline hook, the sweep and its timer via `ccrc install`'s arms), then `bash deploy/deploy.sh` (server; its final gate is `/health` reporting the shipped sha).

- [ ] **Step 4: Measure, do not assert**

On the fleet host, read-only:

```bash
ls ~/.cc-sessions/usage/ | grep -c '\.json$'                       # sidecars
tmux list-sessions -F '#S' | grep -c '^cc-'                          # live sessions (READ ONLY)
systemctl --user list-timers ccd-usage-sweep.timer --no-pager
jq '.scan, (.perAccount | to_entries | map({k: .key, share: .value.fableShare.estimate}))' ~/.cc-sessions/usage/sweep/latest.json
```

Every live Anthropic-lane session should have a sidecar within one render; the gpt lane's sessions have one too (the hook writes it regardless of telemetry — the account field is what differs). Record the counts and the date in the research note §6 as a new row "Sidecar coverage on the live fleet". The gate is seven days of data; the next slice's plan may be written before the seven days elapse but its keystroke levers do not ship before slice 1's own measurements.

- [ ] **Step 5: Commit the research note row**

```bash
git add docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md
git commit -m "docs(research): sidecar coverage measured on the live fleet (routing slice 0, Task 8)"
```

---

## Deviations found

Numbers are ISSUED by `POST /api/ledger/deviations` (`ccrc-api ledger allocate`) and defined in the same act. A session that cannot reach the allocator writes `D-TBD-<slug>` here and reports it (worker clause 11). None yet.

## Self-review against the spec

- §6 sidecar: Task 1 (write, key, `ts`, agents subdir, `model.id`), Task 2 (reaper beside `_reg_purge`), Task 3–4 (server read through the `.cc-sessions/` root, joined by ccd id, additive wire).
- §6 per-class buckets: none reachable (plan-time probe); the sweep's estimate is Task 6's `fableShare`, labelled.
- §6 offline sweep: Tasks 6–7 (global dedupe by message id, per session/model/effort/agent, joined to ccd ids by uuid, scheduled like the graph sweep).
- §6 speed per closed unit and quality signals from run events: Task 5 (`runSignals` over run events, the worker's paired holds, a swap COUNT — swap time is unpairable in today's journal and is said so on the wire — and the refused-close rows `closeRun` already records, so first-submission is measurable without a new writer; suite-green and the held-out panel are slice 2's signals, not this slice's).
- §6 observers and read-back disagreement: require the routing fields (slice 1) — deliberately absent here.
- §7 slice 0 gate: Task 8.
- §8 mutation rows for this slice: Task 1 Step 5 (key/`ts`/agent render), Task 2 Step 5 (reaper).
