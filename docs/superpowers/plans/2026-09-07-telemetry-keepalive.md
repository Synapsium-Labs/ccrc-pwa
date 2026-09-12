# Telemetry keepalive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop an idle Anthropic account's `~/.cc-limits/<id>.json` from going stale for ever, by
taking one minimal turn on it per interval — because the only channel that writes that file is a
statusline render, and a statusline only renders while a session is running.

**Architecture:** A new sibling executable beside `ccd`, `ccd/ccd-telemetry-keepalive`, driven by a
`Type=oneshot` systemd `--user` timer in the shape of `ccd-graph-sweep`. It walks the roster's
`CCRC_MEASURED` set, skips every account that is already fresh, marked auth-dead, or carrying a live
session, takes one `-p` turn on each survivor through that account's own wrapper, and then
**re-measures the telemetry file** rather than trusting the turn's exit code. Every pass appends one
row per account to `~/.ccrc/keepalive.json`, carrying the 5h percentage before and after — so the
price of the refresh is a measurement in the census and not an estimate in a document.

**Tech Stack:** bash (linux-only, GNU `date`/`stat`, `flock(1)`, `jq`), systemd `--user` timer units,
vitest for the guards. No TypeScript source changes; no wire change.

**Spec:** `docs/superpowers/specs/2026-09-07-account-health-and-provenance-design.md` §C (with §A.7's
shipping template and §A.5's marker contract)

## Global Constraints

- Node floor `>=22.13.0`, identical across all three engines. Never lower engines to make a test green.
- Run suites in the FOREGROUND from inside the package, timeout ≥600000ms:
  `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts` (and `cd agent && …` for the
  agent package). **Never bare `npx vitest`** — it resolves a global copy with no jsdom and falsely
  reports "no tests".
- Wire discipline: additive only. This plan adds no wire field and does not touch `FLEET_PROTO`. The
  `authDead` field named in the shared contract belongs to §A's plan, not this one.
- Mutation-table discipline: every guard ships WITH a test measured RED when the guard is deleted or
  mutated — measured before/after, not asserted in a comment. TDD red-first.
- **AGENT-FIRST.** This plan touches `ccd/`, so it ships to the fleet host before the server:
  `bash deploy/deploy.sh agent <host>`. Unlike a change to `ccd/ccd` itself, the new executable and
  its timer are live the moment they land — no supervisor sweep is needed, because no long-lived
  process is executing the old inode. Say so in the PR rather than letting a reader assume the
  §10 deploy-window caveat applies here.
- No account name appears in any shipped source file. Eligibility is read at run time from
  `~/.ccrc/accounts.sh`'s `CCRC_MEASURED`.
- **NEVER print secret file contents.** The credential is sourced into a subshell and handed to the
  child by `exec`. It is never in argv and never in the census. The CLI's own diagnostic — up to 800
  bytes of the child's stdout+stderr, which `_ka_log` writes deliberately — *does* reach
  `~/.ccrc/keepalive.log`. This script never writes the credential there, but the log is the one
  place a credentialed child could echo one, so it is 0600 by construction (`umask 077`) and is
  never read back into the census.
- Known load flakes to re-run IN ISOLATION before calling a real break: `ccd-ws-gc`, `pr-sweep`,
  `session-hook`, `typecheck-tests`, `ccd-session-state`. CI on the quiet box is the arbiter.

---

## Background the implementer needs

### The coverage gap, and why only a turn can close it

`~/.cc-limits/<id>.json` has exactly one writer in this tree: the tail of
`ccd/statusline-command.sh`. Its writer block carries **two gates**, quoted verbatim from
`ccd/statusline-command.sh:238-244`:

```bash
measured=0
if [ -n "$acct_id" ]; then
  for m in ${CCRC_MEASURED[@]+"${CCRC_MEASURED[@]}"}; do
    [ "$m" = "$acct_id" ] && { measured=1; break; }
  done
fi
if [ "$measured" = 1 ] && [ -n "${five_int:-}" ]; then
```

The first gate is **roster membership** — the account must be in `CCRC_MEASURED`, which
`generateAccountsSh` in `shared/generate.mjs` derives through its `measuredIds` filter as
`telemetry === 'anthropic'` and emits as `CCRC_MEASURED`; the function's `CCRC_MEASURED`
contract comment states the same rule. The second is
**"a number actually arrived"**: `five_int` is derived at `ccd/statusline-command.sh:196-198` from
`.rate_limits.five_hour.used_percentage`, and is empty whenever the payload carries none.

The spec's evidence table settles what that means:

| Row | Measurement | Result |
|---|---|---|
| **E6** | statusline render at session start, before any API call | `rate_limits: null` — limits are **not** served from cache, and the `[ -n "${five_int:-}" ]` gate correctly skips the write |
| **E7** | statusline render after one trivial turn | populated with fresh values plus `resets_at`; `~/.cc-limits/<id>.json` refreshed |
| **E5** | real payload, all four Anthropic accounts | `rate_limits` carries only `five_hour` and `seven_day` |

**E6 is doing two jobs.** It is the reason a keepalive must make a real API call — a render that
makes none refreshes nothing — and it is simultaneously the reason a keepalive is *safe*: a pre-call
render is skipped by the second gate, so this mechanism can never stamp **stale** percentages with a
**fresh** `ts`. There is no window in which the file lies about its own age.

### Why an idle account never recovers on its own

`_limit_field` (`ccd/ccd:11728`) says so in its own comment:

> telemetry is only written when a session renders its statusline: an idle account stops reporting
> entirely, so its last sample can outlive its window by days. Observed 2026-07-27: `claude` read
> `seven=98` for 14h after its 7d window reset, which excluded it from every pool and stranded two
> sessions on gpt.

§B makes that honest — a rolled-over reading becomes unknown instead of a confident `0`. §B.2 states
the cost it leaves behind: *"For an active account the window is seconds (measured 1–113s to first
report). **For an idle account it is indefinite.** That is the argument for §C."* This plan is that
argument's implementation.

### The three things that must be skipped, and where each is measured

| Skip | Source of truth | Why |
|---|---|---|
| already fresh | `ts` in `~/.cc-limits/<id>.json`, against `SWAP_FRESH` (`ccd/ccd:830`, `=1800`, *"telemetry younger than this qualifies for pre-emptive swaps"*) | the keepalive is for the idle case only; an active account reports within seconds |
| auth-dead | `$REG/<account>-authdead`, content `"<epoch> <reason>"` | spending a turn to confirm a known-dead credential is waste; §A already covers liveness |
| a live session on that account | `$REG/<id>.wrapper` names the account | two `claude` processes under one `CLAUDE_CONFIG_DIR` is a hazard this plan will not take, and an account with a live session is not idle |

`SWAP_FRESH` has **zero readers today** (spec E10). This plan does not give it one — a sibling
executable cannot source `ccd/ccd` — it re-spells the number as `CCRC_KEEPALIVE_FRESH`'s default and
holds the two equal with a parity test, the mechanism `server/test/pool-name-parity.test.ts` already
uses for values that live in more than one file.

The marker reader copies `ccd`'s `swapblocked` idiom exactly (`ccd/ccd:11909-11910`):

```bash
blocked=$(_reg_get "$id" swapblocked); bts="${blocked%% *}"
[[ "$bts" =~ ^[0-9]+$ && $((now - bts)) -lt "$SWAPBLOCK_COOLDOWN" ]] && return 0
```

— *"The epoch is VALIDATED as digits rather than trusted"*. Same rule here: a marker whose first
field is not digits is not a marker, and must not decide a spend.

### How the turn gets the right identity

`ccd` executes an account as `$HOME/.local/bin/<id>` (`ccd/ccd:766`, `WRAPPER_DIR`). A **generated**
wrapper is three significant lines (`shared/wrapper.mjs:144-149`): `export CLAUDE_CONFIG_DIR=…`,
optionally `. "$HOME/<secretsFile>"`, then `exec "$HOME/.local/bin/<upstreamId>" "$@"` — so it
forwards argv and carries both halves of the identity.

The **upstream** account's wrapper is not one ccrc generates. `shared/roster.ts` permits
`secretsFile` only on `kind: 'generated'` (spec §A.2), so the roster structurally cannot say where
the primary account's credential lives — yet that hand-written launcher sources
`~/.cc-secrets/<id>-oauth.env` and exports the token all the same (spec §A.2; the shape is modelled
at `server/test/ccrc-wrappers.test.ts:485-495`, which reads the token file and then
`export CLAUDE_CODE_OAUTH_TOKEN` before its own `exec`). What §A.2 forbids is therefore a
**roster-driven** consumer, not running the wrapper. This keepalive runs the wrapper, so it needs no
roster field — but it applies §A.2's chosen resolution anyway, by convention: it sources
`$HOME/.cc-secrets/<id>-oauth.env` when readable, and exports `CLAUDE_CONFIG_DIR` from
`_ccrc_cfg_dir`, before exec'ing the wrapper. So an upstream launcher that is ever regenerated
without its own injection still gets a turn instead of a 401. For every wrapper on the box today
this is a harmless duplicate of what the wrapper does one process later.

**A sourced file only reaches the child if it EXPORTS.** Measured while writing this plan:
`( . file ; exec ./w )` where `file` carries a bare `CLAUDE_CODE_OAUTH_TOKEN=…` prints `tok=` in the
child, and prints `tok=set` only when the file says `export` (or when the caller wraps the source in
`set -a` / `set +a`). The real files carry the `export` — `shared/wrapper.mjs:143` emits only
`[ -r "$HOME/${secrets}" ] && . "$HOME/${secrets}"` and leaves the exporting to the file it sources.
The script below wraps its own source in `set -a` / `set +a` regardless, so a secrets file that
forgot the keyword still reaches the turn; the test fixture writes the `export` form, because a
fixture without it would assert nothing.

Setting `CLAUDE_CONFIG_DIR` explicitly is load-bearing, not decorative: the statusline resolves which
row to write with `_ccrc_dir_id "$cfg"` (`ccd/statusline-command.sh:99-110`), so a turn taken under
the wrong config dir refreshes the wrong account's file, or none.

### What the timer will NOT accidentally do

`ccd/session-hook.sh:389-390` is:

```bash
payload=$(cat 2>/dev/null) || exit 0
[[ -n "${TMUX_PANE:-}" ]] || exit 0
```

A `claude` started from a systemd timer has no `TMUX_PANE`, so every registered hook exits at line
390 — after draining its stdin payload, before it acts on it: **no session row, no hookstate file,
no graph nudge.** That is measured, not hoped. (The order matters only to the reader: the hook
consumes the payload first so its writer never blocks on a full pipe, and *then* refuses.)

### The one thing this plan cannot measure, stated first

**Whether `claude -p` renders a statusline at all is UNMEASURED, and it is this plan's central risk.**

What the tree does establish:

- A non-interactive invocation exists and is `-p --output-format json`. The graphify design cites
  graphify's own `llm.py:164` using exactly that pair through the local `claude` CLI, *"billed to the
  plan, not pay-as-you-go API credit"* (`docs/superpowers/specs/2026-08-27-graphify-fleet-integration-design.md:738-742`).
- Nothing in this repository has ever invoked it. Measured: zero occurrences of `claude -p`,
  `--print`, `--output-format` or `stream-json` anywhere in `ccd/`, `deploy/`, `server/src` or
  `agent/src`. Every session this tree creates is a TUI in tmux under `ccd supervise`.
- `statusLine` is a `settings.json` key seeded per config dir by `ccd/install-session-hooks.sh:27,93`.
  Nothing in the tree says whether print mode invokes it, and `claude` is not on this box's PATH, so
  the question could not be settled while writing this plan.

**The plan's approach is the one that makes a `no` answer LOUD instead of silent.** The keepalive
never treats the turn's exit code as evidence of a refresh: it reads the telemetry file's `ts` before
the turn and again after, and only an **advanced `ts`** earns the `refreshed` outcome. A turn that
exits 0 and moves nothing is recorded as `no-render`, per account, per pass, in a durable census.
This is the tree's own doctrine — the graph-sweep idle-gate hardening (merged as PR #52) puts it as
*"exit 0 is a claim; re-measure the artifact, not the rc"* — applied to the one assumption this plan
cannot verify in advance.

If the first live pass reports `no-render` on every account, the escalation, in order, is: (1) pass a
per-run `--settings` file that spells `statusLine` explicitly; (2) if that also renders nothing,
§C **cannot** be closed on the official channel and the design's §C claim must go back to the
operator. Do **not** respond by driving an interactive TUI from a timer — that is a different
mechanism with a different risk profile and it is not what this plan authorises.

### Sizing the spend, and why the census is the real answer

The measured $0.19 in the spec is an **upper bound distorted by Opus-5-at-xhigh with full project
context**. It is not the target and must not be quoted as one.

What this plan can state exactly is the **rate**, which is what the operator actually controls:

- The timer fires every 15 min. An account is eligible only when its telemetry is older than
  `CCRC_KEEPALIVE_FRESH` (default 1800 s), so a refreshed account is skipped on the next tick and
  runs on the one after: **one turn per idle account per ~30 min, i.e. 2/hour/account.**
- On this fleet that is 4 measured accounts × 2 = **8 turns/hour fleet-wide, 192/day**, and strictly
  fewer whenever any account is active, auth-dead or busy.
- The interval is env-overridable through `CCRC_KEEPALIVE_FRESH`: the timer sets the FLOOR, the knob
  sets the real spacing. `CCRC_KEEPALIVE_FRESH=7200` in a systemd drop-in quarters the spend without
  touching a unit file. The model is `CCRC_KEEPALIVE_MODEL` (default `haiku`, the cheapest alias
  Claude Code exposes), and the turn runs in an empty scratch directory so no project context is
  loaded.

**And it consumes the resource it measures.** There is no way around that: the only writer of the
telemetry is a render, and a render only carries numbers after an API call (E6). So rather than
argue the cost down, every census row carries `fiveBefore` and `fiveAfter` — the account's 5h
percentage on each side of its own keepalive turn. After one live pass the operator reads the price
in the units that matter, at the resolution the instrument has (whole percentage points; a delta of
`0` is the honest answer "below one point", not "free"). The absolute dollar figure is **UNMEASURED**
and the `costUsd` field carries `claude`'s own `total_cost_usd` when the JSON result provides one and
`null` when it does not — never `0`.

### The shipping template

Five coordinated edits, per spec §A.7, following `ccd-graph-sweep` byte for byte:

1. `install_atomic` of the executable — `deploy/deploy.sh:640` is the sweep's line.
2. the unit pair inside `AGENT_BUILD_CMD` — `deploy/deploy.sh:679`.
3. `systemctl --user enable --now` inside `AGENT_CMD`, after `daemon-reload` — `deploy/deploy.sh:763`.
4. `_inst_units` / `_inst_enable` in `ccd/ccrc` for the `ccrc install` path — `ccd/ccrc:4842-4843`
   and `ccd/ccrc:4909-4910`.
5. `_uninst_units` for removal — `ccd/ccrc:6232,6242`.

`agent/test/deploy-verify.test.ts:516-596` text-scans `deploy.sh` and reds if any of the first three
is missing or mis-ordered.

A sixth and seventh edit follow by necessity and are **not** in the spec's list: `_inst_bins`
(`ccd/ccrc:4457` is the sweep's line) and `_uninst_tree_bins` (`ccd/ccrc:6421-6422`). Without the
first, `ccrc install` places a timer whose `ExecStart` names a binary that box never receives —
a unit that fails on every fire. Without the second, an uninstall that removed the units leaves the
executable stranded on PATH, the exact reasoning `_uninst_tree_bins`' own comment gives for
`ccd-graph-sweep`. Two more hand-kept censuses name the same set and must gain the name too:
`_uninst_wrappers`' `case` (`ccd/ccrc:6318`) and `TOOLCHAIN_EXECUTABLES`
(`deploy/gen-wrappers.mjs:160`).

**Measured, so the implementer does not have to guess:** the orphan scan at
`deploy/gen-wrappers.mjs:363-367` reports a file only when `verifyMarker(text) !== 'foreign'`, and
`install_atomic`/`_inst_atomic` add no marker — so `ccd-telemetry-keepalive` would not be reported
today even without the `TOOLCHAIN_EXECUTABLES` entry. The entry is defence-in-depth, exactly as that
constant's own header says of `ccd-cap-scopes` and `ccd-graph-sweep`, both of which are also
markerless.

---

## File Structure

| File | Responsibility |
|---|---|
| `ccd/ccd-telemetry-keepalive` (create) | The whole mechanism: eligibility, the three skips, one turn per survivor, the re-measurement, the census |
| `deploy/systemd/ccd-telemetry-keepalive.service` (create) | `Type=oneshot` unit naming the executable, its time budget and its memory ceiling |
| `deploy/systemd/ccd-telemetry-keepalive.timer` (create) | The 15-minute cadence and `WantedBy=timers.target` |
| `deploy/deploy.sh` (modify) | Three edits: install the executable, copy the unit pair, enable the timer |
| `ccd/ccrc` (modify) | Six edits: `_inst_bins`, `_inst_units`, `_inst_enable`, `_uninst_units`, `_uninst_wrappers`, `_uninst_tree_bins` |
| `deploy/gen-wrappers.mjs` (modify) | Add the fifth name to `TOOLCHAIN_EXECUTABLES` |
| `server/test/telemetry-keepalive.test.ts` (create) | The behaviour suite: eligibility, all three skips, refresh, `no-render`, refusal, pause |
| `server/test/keepalive-freshness-parity.test.ts` (create) | Holds `CCRC_KEEPALIVE_FRESH`'s default equal to `ccd/ccd`'s `SWAP_FRESH` |
| `agent/test/deploy-verify.test.ts` (modify) | Extend the deploy scan to the keepalive's three edits |
| `server/test/ccrc-install.test.ts` (modify) | The `ccrc install` lane's assertions: the executable lands, the two units land, both ordered systemctl lists carry the enable, the bin listing is exact, and `--role server` gets none of it |
| `server/test/ccrc-install-graphify.test.ts` (modify) | Add the executable to its copy of `TREE_FILES` (fixture input; asserts nothing) |
| `server/test/ccrc-uninstall.test.ts` (modify) | Fixture bin + fixture units + the two removal assertions |
| `server/test/gen-wrappers.test.ts` (modify) | Add the fifth name to the two toolchain arrays |

---

### Task 1: The keepalive executable

**Files:**
- Create: `ccd/ccd-telemetry-keepalive`
- Create: `server/test/telemetry-keepalive.test.ts`

**Interfaces:**
- Consumes: `~/.ccrc/accounts.sh` — `CCRC_MEASURED` (array of ids with `telemetry === 'anthropic'`)
  and `_ccrc_cfg_dir <id> -> <config dir>`, both emitted by `shared/generate.mjs`. `$HOME/.cc-limits/<id>.json`
  — `{five, seven, ts, fiveResetAt, sevenResetAt}`. `$HOME/.cc-sessions/<account>-authdead` —
  `"<epoch> <reason>"`. `$HOME/.cc-sessions/<id>.wrapper` — the account a registered session sits on.
  `$HOME/.local/bin/<id>` — the account's wrapper, argv-forwarding.
- Produces: the executable, and `$HOME/.ccrc/keepalive.json` with shape
  `{passes: [{started, finished, status, model, freshSecs, accounts: [{account, outcome, reason, fiveBefore, fiveAfter, costUsd, duration_ms}]}]}`,
  last 10 passes. `status` ∈ `ok | pass-locked | paused | no-roster | no-measured-set`.
  `outcome` ∈ `skipped | refreshed | no-render | failed`. `fiveBefore`/`fiveAfter`/`costUsd` are
  `number | null`, where `null` means never measured and is never written as `0`.

- [ ] **Step 1: Write the failing test**

Create `server/test/telemetry-keepalive.test.ts`:

```typescript
/**
 * `ccd-telemetry-keepalive` — the executable that keeps an IDLE measured
 * account's `~/.cc-limits` row from going stale.
 *
 * Harness idiom copied from `graph-sweep.test.ts`: a throwaway `mkTmp` HOME,
 * the real script run under it, and every collaborator planted as a fixture.
 * HOME is the isolation boundary the whole ccd suite relies on — nothing here
 * may ever run against a real $HOME, and nothing here runs `ccd`.
 *
 * Linux-only, the same carve-out `ccd-cap-scopes` and `ccd-graph-sweep` have:
 * the script leans on GNU `date +%s%3N`, `flock(1)` and `jq`, and its timer
 * never installs on the Darwin arm.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';

beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

const KEEPALIVE = path.resolve(__dirname, '../../ccd/ccd-telemetry-keepalive');
let home: string;
const j = (...p: string[]) => path.join(home, ...p);

beforeEach(() => {
  home = mkTmp('keepalive');
  fs.mkdirSync(j('.cc-sessions'), { recursive: true });
  fs.mkdirSync(j('.ccrc'), { recursive: true });
  seedAccountsSh(home);
});

function run(env: Record<string, string> = {}) {
  return spawnSync('bash', [KEEPALIVE], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CCRC_KEEPALIVE_TURN_TIMEOUT: '20', ...env },
  });
}

/** The last pass appended to the census. */
function lastPass(): any {
  const doc = JSON.parse(fs.readFileSync(j('.ccrc', 'keepalive.json'), 'utf8'));
  return doc.passes[doc.passes.length - 1];
}
function row(account: string): any {
  return lastPass().accounts.find((r: any) => r.account === account);
}
/** What the fake wrappers recorded, one line per invocation. */
function turns(): string[] {
  if (!fs.existsSync(j('turn-calls'))) return [];
  return fs.readFileSync(j('turn-calls'), 'utf8').trim().split('\n').filter(Boolean);
}

/** A fake account wrapper. It records the environment it was handed — never
 *  the token itself, only whether one arrived — and optionally does what a
 *  real render would do. */
function plantWrapper(id: string, body = ''): void {
  const bin = j('.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, id), `#!/usr/bin/env bash
echo "turn ${id} cfg=\${CLAUDE_CONFIG_DIR:-none} tok=\${CLAUDE_CODE_OAUTH_TOKEN:+set} argv=$*" >> "$HOME/turn-calls"
${body}
printf '{"type":"result","total_cost_usd":0.0021}'
exit 0
`, { mode: 0o755 });
}

/** The body that makes a fake wrapper behave like a real render: it writes the
 *  account's limits row with a fresh `ts`, exactly as
 *  `ccd/statusline-command.sh:249-251` does. */
const renders = (id: string, five = 7) => `
mkdir -p "$HOME/.cc-limits"
printf '{"five":${five},"seven":3,"ts":%s,"fiveResetAt":null,"sevenResetAt":null}' "$(date +%s)" \\
  > "$HOME/.cc-limits/${id}.json"
`;

function plantLimits(id: string, five: number, ageSecs: number): void {
  fs.mkdirSync(j('.cc-limits'), { recursive: true });
  const ts = Math.floor(Date.now() / 1000) - ageSecs;
  fs.writeFileSync(j('.cc-limits', `${id}.json`),
    JSON.stringify({ five, seven: 3, ts, fiveResetAt: null, sevenResetAt: null }));
}

describe('eligibility is roster-derived and nothing else', () => {
  it('walks CCRC_MEASURED and never the telemetry-less account', () => {
    for (const id of ['claude', 'claude-a', 'claude-b', 'claude-d', 'gpt']) plantWrapper(id);
    const r = run();
    expect(r.status, `stderr:\n${r.stderr}`).toBe(0);
    const seen = lastPass().accounts.map((a: any) => a.account).sort();
    expect(seen).toEqual(['claude', 'claude-a', 'claude-b', 'claude-d']);
    expect(turns().some((l) => l.startsWith('turn gpt ')),
      'a keepalive turn was taken on an account whose roster telemetry is "none"').toBe(false);
  });

  it('refuses rather than selecting nobody when the projection predates CCRC_MEASURED', () => {
    fs.writeFileSync(j('.ccrc', 'accounts.sh'),
      '#!/usr/bin/env bash\nCCRC_ACCOUNTS=(claude)\nCCRC_UPSTREAM=claude\n');
    const r = run();
    expect(r.status).toBe(1);
    expect(lastPass().status).toBe('no-measured-set');
    expect(turns()).toEqual([]);
  });
});

describe('the three skips — a keepalive is for the idle case only', () => {
  it('skips an account that reported inside CCRC_KEEPALIVE_FRESH', () => {
    plantWrapper('claude-a');
    plantLimits('claude-a', 41, 60);
    run();
    expect(row('claude-a').outcome).toBe('skipped');
    expect(row('claude-a').reason).toContain('CCRC_KEEPALIVE_FRESH');
    // …and the fresh number is still reported, so a skip is not a blind spot.
    expect(row('claude-a').fiveBefore).toBe(41);
    expect(turns().some((l) => l.startsWith('turn claude-a '))).toBe(false);
  });

  it('skips an account carrying the -authdead marker', () => {
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 41, 9999);
    fs.writeFileSync(j('.cc-sessions', 'claude-a-authdead'),
      `${Math.floor(Date.now() / 1000)} auth-401\n`);
    run();
    expect(row('claude-a').outcome).toBe('skipped');
    expect(row('claude-a').reason).toContain('authdead');
    expect(turns().some((l) => l.startsWith('turn claude-a '))).toBe(false);
  });

  it('does NOT skip on a marker whose first field is not digits', () => {
    // `ccd`'s swapblocked rule (ccd/ccd:11909): the epoch is VALIDATED, not
    // trusted. A hand-edited or half-written marker must not decide a spend.
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 41, 9999);
    fs.writeFileSync(j('.cc-sessions', 'claude-a-authdead'), 'garbage auth-401\n');
    run();
    expect(row('claude-a').outcome).toBe('refreshed');
  });

  it('skips an account a registered session is sitting on', () => {
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 41, 9999);
    fs.writeFileSync(j('.cc-sessions', 'claude-a-demo.wrapper'), 'claude-a\n');
    run();
    expect(row('claude-a').outcome).toBe('skipped');
    expect(row('claude-a').reason).toContain('claude-a-demo');
    expect(turns().some((l) => l.startsWith('turn claude-a '))).toBe(false);
  });

  it('skips an account with no wrapper on this box, and says which path', () => {
    run();
    expect(row('claude-a').outcome).toBe('skipped');
    expect(row('claude-a').reason).toContain('.local/bin/claude-a');
  });
});

describe('the turn, and the re-measurement that judges it', () => {
  it('refreshes a stale account and reports the price on both sides', () => {
    plantWrapper('claude-a', renders('claude-a', 12));
    plantLimits('claude-a', 9, 9999);
    run();
    const r = row('claude-a');
    expect(r.outcome).toBe('refreshed');
    expect(r.fiveBefore).toBe(9);
    expect(r.fiveAfter).toBe(12);
    expect(r.costUsd).toBe(0.0021);
  });

  it('records no-render when the turn exits 0 and the telemetry does not advance', () => {
    // THE CENTRAL GUARD. `claude -p` may not render a statusline at all; if it
    // does not, this row is how the fleet finds out — loudly, per account, per
    // pass — instead of a silent no-op that looks like success.
    plantWrapper('claude-a');           // exits 0, writes nothing
    plantLimits('claude-a', 9, 9999);
    run();
    expect(row('claude-a').outcome).toBe('no-render');
    expect(row('claude-a').fiveAfter, 'an unmeasured percentage must be null, never 0')
      .toBeNull();
  });

  it('records failed, not no-render, when the turn itself exits non-zero', () => {
    plantWrapper('claude-a', 'exit 3');
    plantLimits('claude-a', 9, 9999);
    run();
    expect(row('claude-a').outcome).toBe('failed');
    expect(row('claude-a').reason).toContain('exit 3');
  });

  it('hands the child its own config dir and its credential, and never logs the token', () => {
    fs.mkdirSync(j('.cc-secrets'), { recursive: true });
    // The shape the real files have. `ccrc-wrappers.test.ts:492-493` models the
    // live upstream launcher as `CLAUDE_CODE_OAUTH_TOKEN="$(cat …)"` followed by
    // `export CLAUDE_CODE_OAUTH_TOKEN`, and `shared/wrapper.mjs:143` emits only
    // the `.` line — the exporting is the sourced file's job. MEASURED: a bare
    // assignment does NOT survive the script's `exec`, so a fixture without
    // `export` would assert nothing at all.
    fs.writeFileSync(j('.cc-secrets', 'claude-a-oauth.env'),
      'export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-fixture\n', { mode: 0o600 });
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 9, 9999);
    run({ CCRC_KEEPALIVE_MODEL: 'haiku' });
    const line = turns().find((l) => l.startsWith('turn claude-a '))!;
    expect(line).toContain(`cfg=${j('.claude-a')}`);
    expect(line).toContain('tok=set');
    expect(line).toContain('--model haiku');
    const census = fs.readFileSync(j('.ccrc', 'keepalive.json'), 'utf8');
    expect(census, 'the credential reached the census').not.toContain('sk-ant-oat-fixture');
  });
});

describe('the pass-level switches', () => {
  it('does nothing at all while the pause file is present', () => {
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 9, 9999);
    fs.writeFileSync(j('.ccrc', 'keepalive-paused'), '');
    const r = run();
    expect(r.status).toBe(0);
    expect(lastPass().status).toBe('paused');
    expect(lastPass().accounts).toEqual([]);
    expect(turns()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/telemetry-keepalive.test.ts
```

Expected: every case FAILS. The script does not exist, so `spawnSync('bash', [KEEPALIVE])` exits
`127` with `bash: …/ccd/ccd-telemetry-keepalive: No such file or directory` on stderr; the first
assertion each case reaches is either `expect(r.status).toBe(0)` failing with
`expected 127 to be 0`, or `lastPass()` throwing `ENOENT … .ccrc/keepalive.json`. **Record the actual
output** — this is the measured red half of the mutation table.

- [ ] **Step 3: Write the executable**

Create `ccd/ccd-telemetry-keepalive`, mode 755:

```bash
#!/usr/bin/env bash
# ccd-telemetry-keepalive — keep an IDLE measured account's ~/.cc-limits row
# from going stale, by taking one minimal turn on it (spec 2026-09-07 §C).
#
# ── IT CONSUMES THE RESOURCE IT MEASURES ─────────────────────────────────
# Every refresh this script produces is paid for out of the same 5h/7d window
# it refreshes, and that is inherent rather than sloppy. The ONLY writer of
# ~/.cc-limits/<id>.json is ccd/statusline-command.sh, whose second gate
# (`[ -n "${five_int:-}" ]`, statusline-command.sh:244) requires a rendered
# payload carrying a real rate_limits number — and a session that has made no
# API call renders `rate_limits: null` (spec E6). So an idle account's usage
# cannot be learned without spending some of it. Rather than argue the price
# down, every row below carries fiveBefore/fiveAfter: the cost is a
# MEASUREMENT in the census, not an estimate in a document.
#
# That same E6 is what makes this safe: a pre-call render is SKIPPED by the
# writer, so this mechanism can never stamp stale percentages with a fresh ts.
#
# ── WHAT IT WILL NOT DO ──────────────────────────────────────────────────
#   • never a turn on an account carrying $REG/<account>-authdead — spending
#     to confirm a known-dead credential is waste, and the health probe
#     (spec §A) already covers liveness;
#   • never a turn on an account that reported inside CCRC_KEEPALIVE_FRESH —
#     this is for the IDLE case, and an active account reports in seconds;
#   • never a turn on an account a registered session is sitting on — two
#     `claude` processes under one CLAUDE_CONFIG_DIR is a hazard this script
#     will not take, and an account with a live session is not idle;
#   • never a claim about a refresh it did not measure. The turn's exit code
#     is a CLAIM; `ts` advancing in the telemetry file is the ARTIFACT.
#
# Serialized oneshot driven by ccd-telemetry-keepalive.timer. Every knob is
# env-overridable (the CCRC_GRAPH_* precedent); the roots are HOME-derived
# with no override, exactly as ccd/ccd:765 and ccd-graph-sweep do — HOME is
# the test harness's isolation boundary.
set -uo pipefail
umask 077   # the census and the log are written by a credentialed process

REG="$HOME/.cc-sessions"
LIMITS_DIR="$HOME/.cc-limits"
WRAPPER_DIR="$HOME/.local/bin"
SECRETS_DIR="$HOME/.cc-secrets"
ACCOUNTS_SH="$HOME/.ccrc/accounts.sh"
CENSUS="$HOME/.ccrc/keepalive.json"
LOG="$HOME/.ccrc/keepalive.log"
PAUSE="$HOME/.ccrc/keepalive-paused"
LOCK="$HOME/.ccrc/keepalive.lock"
WORKDIR="$HOME/.ccrc/keepalive-cwd"
# The freshness window is `ccd/ccd`'s SWAP_FRESH by value — "telemetry younger
# than this qualifies for pre-emptive swaps" — re-spelled because a sibling
# executable sources nothing from ccd. The two are held equal by
# server/test/keepalive-freshness-parity.test.ts rather than by hope.
#
# IT IS ALSO THE INTERVAL KNOB. The timer sets the FLOOR (15 min); this sets
# the real spacing, because a refreshed account is skipped until its row is
# this old. CCRC_KEEPALIVE_FRESH=7200 in a drop-in quarters the fleet's spend
# without touching a unit file.
: "${CCRC_KEEPALIVE_FRESH:=1800}"
: "${CCRC_KEEPALIVE_MODEL:=haiku}"
: "${CCRC_KEEPALIVE_PROMPT:=Reply with the single word: ok}"
: "${CCRC_KEEPALIVE_TURN_TIMEOUT:=120}"

STARTED="$(date -u +%FT%TZ)"
ROWS=()
mkdir -p "$HOME/.ccrc" "$WORKDIR" || { echo "keepalive: cannot create \$HOME/.ccrc" >&2; exit 1; }

if ! command -v jq >/dev/null 2>&1; then
  echo "keepalive: jq is not on PATH — the census cannot be written" >&2
  exit 1
fi

_ka_row() {   # account outcome reason five_before five_after cost_usd duration_ms
  # UNKNOWN IS null, NEVER 0. A percentage nobody measured and a measured zero
  # are the two things this whole design exists to keep apart; collapsing them
  # in the census would reintroduce the defect one layer up.
  ROWS+=("$(jq -cn --arg a "$1" --arg o "$2" --arg r "$3" \
    --arg fb "$4" --arg fa "$5" --arg c "$6" --argjson d "${7:-0}" \
    '{account:$a, outcome:$o, reason:$r,
      fiveBefore:(if $fb == "" then null else ($fb|tonumber) end),
      fiveAfter:(if $fa == "" then null else ($fa|tonumber) end),
      costUsd:(if $c == "" then null else ($c|tonumber) end),
      duration_ms:$d}')")
}

_ka_finish() {   # pass-status ; exit-code
  local status="$1" rc="$2" tmp
  tmp="$(mktemp "$CENSUS.XXXXXX")" || { echo "keepalive: no temp beside $CENSUS" >&2; exit 1; }
  # NB: printf of an EMPTY array must emit nothing — a lone newline breaks
  # `jq -cs` (slurp of empty input is [], of "\n" is a parse error).
  { [ "${#ROWS[@]}" -gt 0 ] && printf '%s\n' "${ROWS[@]}"; true; } | jq -cs \
    --arg started "$STARTED" --arg finished "$(date -u +%FT%TZ)" \
    --arg status "$status" --arg model "$CCRC_KEEPALIVE_MODEL" \
    --argjson fresh "$CCRC_KEEPALIVE_FRESH" \
    '{started:$started, finished:$finished, status:$status, model:$model,
      freshSecs:$fresh, accounts:.}' > "$tmp" \
    || { rm -f "$tmp"; echo "keepalive: census assembly failed" >&2; exit 1; }
  # append, keep last 10 passes, atomic
  jq -c --slurpfile p "$tmp" '.passes = ((.passes // []) + $p | .[-10:])' \
    "$CENSUS" 2>/dev/null > "$tmp.2" \
    || jq -cn --slurpfile p "$tmp" '{passes: $p}' > "$tmp.2"
  mv "$tmp.2" "$CENSUS"; rm -f "$tmp"
  exit "$rc"
}

_ka_num() {   # <file> <key> -> that integer field, or NOTHING
  local v
  v="$(jq -r --arg k "$2" '.[$k] // empty' "$1" 2>/dev/null)" || return 1
  [[ "$v" =~ ^-?[0-9]+$ ]] || return 1
  printf '%s' "$v"
}

# THE MARKER, read exactly as ccd reads `swapblocked` (ccd/ccd:11909-11910):
# the epoch is VALIDATED as digits rather than trusted. A hand-edited or
# half-written marker must not be able to stop a spend — or, worse, to be the
# reason an account is never measured again. Content is "<epoch> <reason>";
# only the epoch is read here, because the reason vocabulary is the health
# probe's to own and this script has no decision that varies with it.
#
# THE NAME IS THE SHARED CONTRACT'S, deliberately: `_authdead <wrapper>`, rc 0
# iff a valid marker is there. Printing the epoch is additive on top of that
# contract, and costs a caller that ignores stdout nothing. This is a second
# BODY of one contract — §A owns the copy inside `ccd/ccd`, a sibling
# executable can source nothing from it, and the two files never share a shell
# — so what is held equal is the marker's FORMAT, by the pair of cases in this
# plan's suite, not the text of the function.
_authdead() {   # <wrapper> -> rc 0 iff a valid marker is there; prints the epoch
  local f="$REG/$1-authdead" txt ts
  [ -f "$f" ] || return 1
  txt="$(cat "$f" 2>/dev/null)" || return 1
  ts="${txt%% *}"
  [[ "$ts" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$ts"
}

# `_gs_session_on`'s shape (ccd-graph-sweep), asked of `wrapper` instead of
# `workdir`: the registry is $REG/<id>.<field>, so this reads the account each
# registered session is currently sitting on. An unreadable row is SKIPPED,
# never matched — two unmeasurable values comparing equal is what would hand
# an account the wrong answer.
_ka_session_on() {   # <account> -> the first session id on it, or nothing
  local acct="$1" w txt b
  for w in "$REG"/*.wrapper; do
    [ -f "$w" ] || continue
    txt="$(cat "$w" 2>/dev/null)" || continue
    [ "$txt" = "$acct" ] || continue
    b="${w##*/}"; printf '%s' "${b%.wrapper}"
    return 0
  done
  return 1
}

# The turn. THE CREDENTIAL IS NEVER IN ARGV AND NEVER ECHOED: it is sourced
# into this subshell's environment from the 0600 secrets file and handed to
# the child by exec — the `ccrc-ddns` pattern (spec §A.7), one process further
# in.
#
# Sourced HERE as well as in the wrapper, deliberately. The roster cannot
# declare a secretsFile for the `upstream` account (spec §A.2, and
# shared/roster.ts permits the field only on kind 'generated'), whose wrapper
# is not one ccrc generates — but that hand-written launcher injects and
# EXPORTS the token itself, so running the wrapper is enough today. What §A.2
# forbids is a ROSTER-DRIVEN consumer, which this is not. This line is the
# belt: an upstream launcher regenerated without its own injection still gets a
# turn instead of a 401, and for a generated wrapper it is a harmless duplicate
# of what that wrapper does one process later.
#
# CLAUDE_CONFIG_DIR is exported for a second, independent reason: the
# statusline picks WHICH row to write with `_ccrc_dir_id "$cfg"`
# (statusline-command.sh:99-110), so a turn under the wrong config dir
# refreshes the wrong account's file, or none.
_ka_turn() {   # <account> <config-dir> -> the child's rc; output captured
  local acct="$1" cfg="$2"
  (
    cd "$WORKDIR" || exit 125
    # `set -a` because a sourced file only reaches the child if it EXPORTS, and
    # this script cannot see whether a given secrets file remembered to. The
    # real ones do (ccrc-wrappers.test.ts:492-493 models the live launcher's
    # `export CLAUDE_CODE_OAUTH_TOKEN`); one that does not would otherwise hand
    # the turn a 401 with nothing in the census naming the reason.
    # shellcheck source=/dev/null
    set -a
    [ -r "$SECRETS_DIR/$acct-oauth.env" ] && . "$SECRETS_DIR/$acct-oauth.env"
    set +a
    [ -n "$cfg" ] && export CLAUDE_CONFIG_DIR="$cfg"
    exec timeout "$CCRC_KEEPALIVE_TURN_TIMEOUT" \
      "$WRAPPER_DIR/$acct" -p "$CCRC_KEEPALIVE_PROMPT" \
      --model "$CCRC_KEEPALIVE_MODEL" --output-format json
  ) >"$TURN_OUT" 2>"$TURN_ERR"
}

# The CLI's own diagnostic goes to the LOG, never to the census: the census is
# machine-read and must stay a fixed vocabulary, and free text from a
# credentialed child belongs in one 0600 place an operator reads deliberately.
# Measured negative worth knowing (account-provisioning design §3.2): an
# invalid token exits 1 with its message on STDOUT and stderr COMPLETELY
# EMPTY, so a reader that scraped stderr alone would see nothing at all.
_ka_log() {   # <account> <rc>
  { printf 'keepalive: %s rc=%s at %s\n' "$1" "$2" "$(date -u +%FT%TZ)"
    head -c 400 "$TURN_ERR" 2>/dev/null
    head -c 400 "$TURN_OUT" 2>/dev/null
    printf '\n'
  } >> "$LOG"
}

# ── the pass ──────────────────────────────────────────────────────────────
exec 9>"$LOCK"
flock -n 9 || { ROWS=(); _ka_finish pass-locked 0; }
[ -e "$PAUSE" ] && _ka_finish paused 0

# shellcheck source=/dev/null
if [ ! -r "$ACCOUNTS_SH" ] || ! . "$ACCOUNTS_SH" 2>/dev/null; then
  echo "keepalive: no account roster at $ACCOUNTS_SH — run: ccrc install" >&2
  _ka_finish no-roster 1
fi
# REFUSES rather than selecting nobody. An accounts.sh from a ccrc older than
# CCRC_MEASURED parses fine and simply doesn't define it — and a keepalive that
# quietly walked an empty set would look identical to a healthy fleet with
# nothing to do. Those are different conditions and this says which.
if ! declare -p CCRC_MEASURED >/dev/null 2>&1; then
  echo "keepalive: $ACCOUNTS_SH defines no CCRC_MEASURED — regenerate it: ccrc install" >&2
  _ka_finish no-measured-set 1
fi

TURN_OUT="$(mktemp "${TMPDIR:-/tmp}/ka-stdout.XXXXXX")"
TURN_ERR="$(mktemp "${TMPDIR:-/tmp}/ka-stderr.XXXXXX")"
trap 'rm -f "$TURN_OUT" "$TURN_ERR"' EXIT

for acct in ${CCRC_MEASURED[@]+"${CCRC_MEASURED[@]}"}; do
  lim="$LIMITS_DIR/$acct.json"
  fb=""; [ -f "$lim" ] && { fb="$(_ka_num "$lim" five)" || fb=""; }

  if [ ! -x "$WRAPPER_DIR/$acct" ]; then
    _ka_row "$acct" skipped "no wrapper at \$HOME/.local/bin/$acct" "$fb" "" "" 0
    continue
  fi
  if dead="$(_authdead "$acct")"; then
    _ka_row "$acct" skipped "authdead since $dead" "$fb" "" "" 0
    continue
  fi
  if sid="$(_ka_session_on "$acct")"; then
    _ka_row "$acct" skipped "session $sid is live on this account" "$fb" "" "" 0
    continue
  fi
  ts=""; [ -f "$lim" ] && { ts="$(_ka_num "$lim" ts)" || ts=""; }
  now="$(date +%s)"
  if [ -n "$ts" ] && [ "$((now - ts))" -lt "$CCRC_KEEPALIVE_FRESH" ]; then
    _ka_row "$acct" skipped \
      "reported $((now - ts))s ago, under CCRC_KEEPALIVE_FRESH=$CCRC_KEEPALIVE_FRESH" \
      "$fb" "" "" 0
    continue
  fi

  cfg=""
  declare -F _ccrc_cfg_dir >/dev/null 2>&1 && cfg="$(_ccrc_cfg_dir "$acct")"
  t0="$(date +%s%3N)"
  _ka_turn "$acct" "$cfg"; rc=$?
  dur=$(( $(date +%s%3N) - t0 ))

  after=""; [ -f "$lim" ] && { after="$(_ka_num "$lim" ts)" || after=""; }
  cost="$(jq -r '.total_cost_usd // empty' "$TURN_OUT" 2>/dev/null)" || cost=""
  [[ "$cost" =~ ^[0-9]+(\.[0-9]+)?$ ]] || cost=""

  # THE EXIT CODE IS A CLAIM; THE TELEMETRY FILE IS THE ARTIFACT. Whether
  # `claude -p` renders a statusline at all is unmeasured (see the plan's
  # background). If it does not, `no-render` is how the fleet finds out —
  # per account, per pass, in a durable census — rather than a silent no-op
  # that reads as success on every tick for ever.
  #
  # fiveAfter IS READ ONLY ON THE REFRESHED BRANCH. On every other branch the
  # row on disk is the SAME row `fb` was read from, and reporting it as an
  # "after" would claim a measurement this turn did not make — the exact
  # unknown-becomes-a-number collapse `_ka_row`'s own header refuses.
  if [ -n "$after" ] && [ "$after" != "$ts" ]; then
    fa=""; [ -f "$lim" ] && { fa="$(_ka_num "$lim" five)" || fa=""; }
    _ka_row "$acct" refreshed "" "$fb" "$fa" "$cost" "$dur"
  elif [ "$rc" -eq 0 ]; then
    _ka_log "$acct" "$rc"
    _ka_row "$acct" no-render "the turn exited 0 and $lim did not advance" \
      "$fb" "" "$cost" "$dur"
  elif [ "$rc" -eq 124 ]; then
    _ka_log "$acct" "$rc"
    _ka_row "$acct" failed "timeout after ${CCRC_KEEPALIVE_TURN_TIMEOUT}s" \
      "$fb" "" "" "$dur"
  else
    _ka_log "$acct" "$rc"
    _ka_row "$acct" failed "exit $rc" "$fb" "" "" "$dur"
  fi
done

_ka_finish ok 0
```

Make it executable:

```bash
cd "$(git rev-parse --show-toplevel)" && chmod 755 ccd/ccd-telemetry-keepalive
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/telemetry-keepalive.test.ts
```

Expected: 12 passed. If any case reds, do **not** relax the assertion — re-derive. In particular, the
`does NOT skip on a marker whose first field is not digits` case and the `no-render` case are the two
guards the whole design leans on.

- [ ] **Step 5: Measure the mutation, three ways**

Each mutation, run, record the red set, then restore. A comment is a request; a red suite is a
mechanism.

1. Delete the `_authdead` skip block (the `if dead="$(_authdead "$acct")"; then … continue; fi`
   four lines). Expected red: `skips an account carrying the -authdead marker`.
2. Replace `[[ "$ts" =~ ^[0-9]+$ ]] || return 1` inside `_authdead` with `:` (trust the field).
   Expected red: `does NOT skip on a marker whose first field is not digits`.
3. Replace the classification's first branch with `if [ "$rc" -eq 0 ]; then _ka_row "$acct" refreshed …`
   — i.e. judge the turn by its exit code instead of by the artifact. Expected red: `records
   no-render when the turn exits 0 and the telemetry does not advance`.

Record before/after counts in the commit message.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd-telemetry-keepalive server/test/telemetry-keepalive.test.ts
git commit -m "feat(ccd): a telemetry keepalive for idle measured accounts (D-1940)

An idle account's ~/.cc-limits row goes stale for ever: the only writer is a
statusline render, and a render only carries numbers after an API call (E6/E7).
This takes one minimal turn per idle measured account per interval, through
that account's own wrapper, and judges the result by RE-MEASURING the telemetry
file rather than by the turn's exit code.

It consumes the resource it measures. Every census row carries fiveBefore and
fiveAfter so the price is a measurement, not an estimate.

Skips: fresh (CCRC_KEEPALIVE_FRESH), -authdead, and any account a registered
session is sitting on.

Mutation measured: 3 guards removed -> 3 assertions red."
```

---

### Task 2: Hold the freshness window equal to `SWAP_FRESH`

**Files:**
- Create: `server/test/keepalive-freshness-parity.test.ts`

**Interfaces:**
- Consumes: `ccd/ccd`'s `SWAP_FRESH=1800` (`ccd/ccd:830`) and
  `ccd/ccd-telemetry-keepalive`'s `: "${CCRC_KEEPALIVE_FRESH:=1800}"` default, both read from their
  real sources as text. Neither file can import the other.
- Produces: no source change — a guard only.

- [ ] **Step 1: Write the failing test**

Create `server/test/keepalive-freshness-parity.test.ts`:

```typescript
/**
 * "How fresh is fresh" is one number spelled in two files, and they cannot be
 * held equal structurally: `ccd/ccd` sources nothing from this repository, and
 * `ccd/ccd-telemetry-keepalive` is a sibling executable that sources nothing
 * from ccd. This is `pool-name-parity.test.ts`'s mechanism applied to the one
 * value the keepalive design puts in two places.
 *
 * WHY THEY MUST AGREE. `SWAP_FRESH`'s own comment calls it "telemetry younger
 * than this qualifies for pre-emptive swaps" — the tree's definition of a
 * usable reading. The keepalive asks the same question from the other side:
 * an account whose telemetry is still fresh by that definition does not need a
 * turn spent on it. Two spellings that drifted would mean the fleet spending
 * on accounts the swap lane already trusts, or trusting readings the keepalive
 * had given up on.
 *
 * The keepalive's is a DEFAULT, not a constant: `CCRC_KEEPALIVE_FRESH=7200` in
 * a systemd drop-in is the supported way to widen the interval on a box. What
 * is pinned is the shipped default, which is what an unconfigured box runs.
 *
 * EXACTLY ONE occurrence each, not "at least one": a second assignment in the
 * same file is the drift this exists to refuse, and a scan taking the first
 * match would not see it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const CCD = readFileSync(path.join(ROOT, 'ccd', 'ccd'), 'utf8');
const KEEPALIVE = readFileSync(path.join(ROOT, 'ccd', 'ccd-telemetry-keepalive'), 'utf8');

/** The single match, with the COUNT asserted first. */
function exactlyOne(src: string, re: RegExp, what: string): string {
  const all = [...src.matchAll(new RegExp(re.source, 'gm'))];
  expect(all.length, `${what}: expected exactly one occurrence, found ${all.length}`).toBe(1);
  return all[0]![1]!;
}

describe('the keepalive spends on the tree’s own definition of stale', () => {
  it('ccd still declares SWAP_FRESH as a bare integer', () => {
    expect(exactlyOne(CCD, /^SWAP_FRESH=([0-9]+)/, 'ccd/ccd SWAP_FRESH')).toMatch(/^[0-9]+$/);
  });

  it('the keepalive still declares CCRC_KEEPALIVE_FRESH as a bare default', () => {
    expect(exactlyOne(KEEPALIVE, /^: "\$\{CCRC_KEEPALIVE_FRESH:=([0-9]+)\}"/,
      'the keepalive CCRC_KEEPALIVE_FRESH default')).toMatch(/^[0-9]+$/);
  });

  it('and the two are the same number', () => {
    const swap = exactlyOne(CCD, /^SWAP_FRESH=([0-9]+)/, 'ccd/ccd SWAP_FRESH');
    const keep = exactlyOne(KEEPALIVE, /^: "\$\{CCRC_KEEPALIVE_FRESH:=([0-9]+)\}"/,
      'the keepalive CCRC_KEEPALIVE_FRESH default');
    expect(Number(keep),
      'the keepalive would now spend a turn on telemetry the swap lane still calls fresh, '
      + 'or refuse to spend on telemetry the swap lane has already given up on')
      .toBe(Number(swap));
  });
});
```

- [ ] **Step 2: Run the test and verify it passes on a correct tree**

```bash
cd server && ./node_modules/.bin/vitest run test/keepalive-freshness-parity.test.ts
```

Expected: 3 passed. This guard is written after the value it pins already agrees, so its red half is
Step 3 rather than Step 2 — record that in the commit message rather than claiming a red-first run
that did not happen.

- [ ] **Step 3: Measure the mutation**

Change `: "${CCRC_KEEPALIVE_FRESH:=1800}"` to `: "${CCRC_KEEPALIVE_FRESH:=900}"` in
`ccd/ccd-telemetry-keepalive`, re-run:

```bash
cd server && ./node_modules/.bin/vitest run test/keepalive-freshness-parity.test.ts
```

Expected: the third case reds with `expected 900 to be 1800` and the two-sentence message. Restore
`1800`, re-run, confirm 3 passed. Then add a SECOND `SWAP_FRESH=` line to `ccd/ccd`, confirm the
first case reds with `expected exactly one occurrence, found 2`, and remove it.

- [ ] **Step 4: Commit**

```bash
git add server/test/keepalive-freshness-parity.test.ts
git commit -m "test(ccd): pin the keepalive's freshness window to SWAP_FRESH (D-1941)

One number, two files, neither able to import the other. pool-name-parity's
mechanism applied to the value that decides both what the swap lane trusts and
what the keepalive spends on.

Mutation measured: 1800 -> 900 in the keepalive reds 1 assertion; a duplicate
SWAP_FRESH= in ccd reds another."
```

---

### Task 3: The units, and the three deploy edits

**Files:**
- Create: `deploy/systemd/ccd-telemetry-keepalive.service`
- Create: `deploy/systemd/ccd-telemetry-keepalive.timer`
- Modify: `deploy/deploy.sh` (three edits: after `:640`, at the end of `AGENT_BUILD_CMD` `:679`, and
  after `:763` inside `AGENT_CMD`)
- Modify: `agent/test/deploy-verify.test.ts` (the `the agent deploy installs every systemd artifact
  the fleet host actually runs` case)

**Interfaces:**
- Consumes: `ccd/ccd-telemetry-keepalive` from Task 1, installed at `%h/.local/bin/`.
- Produces: `ccd-telemetry-keepalive.service` + `.timer` on the fleet host, enabled after
  `daemon-reload`.

- [ ] **Step 1: Write the failing test**

In `agent/test/deploy-verify.test.ts`, inside the case titled
`the agent deploy installs every systemd artifact the fleet host actually runs`, make four additions.

(a) In the `for (const f of [ … ])` file list, after the `'systemd/ccd-graph-sweep.timer',` entry:

```typescript
      // spec 2026-09-07 §C: the telemetry keepalive pair, shipped the same way.
      'systemd/ccd-telemetry-keepalive.service',
      'systemd/ccd-telemetry-keepalive.timer',
```

(b) After the existing `expect(existsSync(… 'ccd-graph-sweep')…)` assertion:

```typescript
    expect(existsSync(path.join(deployDir, '..', 'ccd', 'ccd-telemetry-keepalive')),
      'the telemetry keepalive executable is not in the repo').toBe(true);
```

(c) In the `for (const needle of [ … ])` list inside the `AGENT_BUILD_CMD` block, after the
graph-sweep `cp` needle:

```typescript
      // spec 2026-09-07 §C: the keepalive pair, installed the same way.
      'cp ~/ccrc/deploy/systemd/ccd-telemetry-keepalive.service ~/ccrc/deploy/systemd/ccd-telemetry-keepalive.timer ~/.config/systemd/user/',
```

(d) After the existing `sweepTimerAt` assertion, and after the final `expect(deploySh).toContain(…)`
block respectively:

```typescript
    // spec 2026-09-07 §C: a third timer, needing the same daemon-reload to have
    // already picked up the unit AGENT_BUILD_CMD installed.
    const keepaliveTimerAt = restartLinks.findIndex((l) => l.includes('enable --now ccd-telemetry-keepalive.timer'));
    expect(keepaliveTimerAt, 'the keepalive timer is never enabled').toBeGreaterThan(reloadAt);
```

```typescript
    expect(deploySh).toContain('install_atomic ccd/ccd-telemetry-keepalive .local/bin/ccd-telemetry-keepalive 755');
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```

Expected: the one case reds, first on
`systemd/ccd-telemetry-keepalive.service is not in the repo — expected false to be true`. **Record
the actual output.**

- [ ] **Step 3: Write the units**

Create `deploy/systemd/ccd-telemetry-keepalive.service`:

```ini
[Unit]
Description=Telemetry keepalive — one minimal turn per idle measured account (spec 2026-09-07 §C)
[Service]
Type=oneshot
ExecStart=%h/.local/bin/ccd-telemetry-keepalive
# budget: one turn per measured account at CCRC_KEEPALIVE_TURN_TIMEOUT (120s)
# each, plus jq/census overhead. A pass past this is wedged, not slow.
TimeoutStartSec=900
# A keepalive must never be the thing that OOMs the fleet host (see
# ccd-cap-scopes' own 13-days-silently-broken header). A turn that needs more
# than this is not a minimal turn.
MemoryMax=2G
```

Create `deploy/systemd/ccd-telemetry-keepalive.timer`:

```ini
[Unit]
Description=Run the telemetry keepalive every 15 minutes (spec 2026-09-07 §C)
[Timer]
OnBootSec=10min
OnUnitActiveSec=15min
AccuracySec=1min
[Install]
WantedBy=timers.target
```

**The timer sets the floor, not the spacing.** An account refreshed on one tick is skipped on the
next (its row is 900 s old, under `CCRC_KEEPALIVE_FRESH=1800`) and runs on the one after — so the
real cadence is one turn per idle account per ~30 min, and widening it is
`CCRC_KEEPALIVE_FRESH=<secs>` in a drop-in rather than an edit here.

- [ ] **Step 4: Make the three deploy edits**

In `deploy/deploy.sh`, immediately after the line
`  install_atomic ccd/ccd-graph-sweep .local/bin/ccd-graph-sweep 755`:

```bash
  # spec 2026-09-07 §C: the telemetry keepalive, unconditional here exactly as
  # its two siblings above — the agent lane only ever ships to a fleet host, so
  # there is no server-role branch to gate it against the way `ccd/ccrc`'s own
  # `_inst_bins` has to.
  install_atomic ccd/ccd-telemetry-keepalive .local/bin/ccd-telemetry-keepalive 755
```

In the same file, change the last line of `AGENT_BUILD_CMD` from:

```bash
    && cp ~/ccrc/deploy/systemd/ccd-graph-sweep.service ~/ccrc/deploy/systemd/ccd-graph-sweep.timer ~/.config/systemd/user/'
```

to:

```bash
    && cp ~/ccrc/deploy/systemd/ccd-graph-sweep.service ~/ccrc/deploy/systemd/ccd-graph-sweep.timer ~/.config/systemd/user/ \
    && cp ~/ccrc/deploy/systemd/ccd-telemetry-keepalive.service ~/ccrc/deploy/systemd/ccd-telemetry-keepalive.timer ~/.config/systemd/user/'
```

And in `AGENT_CMD`, immediately after
`    && systemctl --user enable --now ccd-graph-sweep.timer \`:

```bash
    && systemctl --user enable --now ccd-telemetry-keepalive.timer \
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```

Expected: the whole file passes.

- [ ] **Step 6: Measure the mutation**

Delete the `&& systemctl --user enable --now ccd-telemetry-keepalive.timer \` line, re-run, confirm
the case reds with `the keepalive timer is never enabled`. Restore it. Then move that same line
ABOVE the `daemon-reload` link in `AGENT_CMD`, re-run, confirm it reds again on the same assertion
(the ordering half, not merely the presence half). Restore.

- [ ] **Step 7: Commit**

```bash
git add deploy/systemd/ccd-telemetry-keepalive.service deploy/systemd/ccd-telemetry-keepalive.timer deploy/deploy.sh agent/test/deploy-verify.test.ts
git commit -m "feat(deploy): ship and enable the telemetry keepalive timer (D-1940)

Three edits on the agent lane, the ccd-graph-sweep template exactly:
install_atomic the executable, cp the unit pair inside AGENT_BUILD_CMD, enable
the timer inside AGENT_CMD after daemon-reload.

Mutation measured: removing the enable line reds 1 assertion; moving it above
daemon-reload reds the same one on the ordering half."
```

---

### Task 4: The `ccrc install` / `ccrc uninstall` lane

**Files:**
- Modify: `ccd/ccrc` — `_inst_bins` (`:4457` area, incl. the two echo lines at `:4467` and `:4469`),
  `_inst_units` (`:4843` area), `_inst_enable` (`:4910` area), `_uninst_units` (`:6232` and `:6242`),
  `_uninst_wrappers` (`:6318`), `_uninst_tree_bins` (`:6421-6424`)
- Modify: `deploy/gen-wrappers.mjs` — `TOOLCHAIN_EXECUTABLES` (`:160`)
- Modify: `server/test/ccrc-install.test.ts` — `TREE_FILES` (fixture input), a new landing case
  beside the sweep's, `UNIT_FILES` + its case title, the two ordered systemctl lists, the exact bin
  listing, and the `--role server` skip
- Modify: `server/test/ccrc-install-graphify.test.ts` — its copy of `TREE_FILES` (fixture input)
- Modify: `server/test/ccrc-uninstall.test.ts` — the fixture bin, the fixture unit list, and the two
  removal assertions
- Modify: `server/test/gen-wrappers.test.ts` — the two toolchain arrays

**Interfaces:**
- Consumes: `ccd/ccd-telemetry-keepalive` (Task 1) and the two unit files (Task 3), reached out of
  the placed tree as `$BOX_TREE_DIR/ccd/…` and `$BOX_TREE_DIR/deploy/systemd/…`.
- Produces: `$HOME/.local/bin/ccd-telemetry-keepalive` and the enabled timer on any box that runs
  `ccrc install` with a role other than `server`; both removed by `ccrc uninstall`.

- [ ] **Step 1: Write the failing test**

Ten edits, all additive. **Read (a) before the rest:** `TREE_FILES` is a fixture INPUT
(`server/test/ccrc-install.test.ts:231` — `for (const rel of TREE_FILES) { const src = join(REPO,
rel); … }`), so adding a row there copies one more file into the fixture and asserts *nothing*. The
red half of this task lives in (b) through (g), which is where the assertions are.

(a) `server/test/ccrc-install.test.ts`, in `TREE_FILES`, after the `'ccd/ccd-graph-sweep',` entry:

```typescript
  // spec 2026-09-07 §C: the telemetry keepalive `_inst_bins` ships beside the
  // other two on the non-Darwin arm. Only its UNIT and its ENABLE are
  // role-gated, per `_inst_units`/`_inst_enable`. NB fixture INPUT only — the
  // assertions that make this land are the cases below.
  'ccd/ccd-telemetry-keepalive',
```

(b) `server/test/ccrc-install.test.ts`, a new landing case immediately after the
`ccd-graph-sweep lands beside it too` case (`:1768-1778`):

```typescript
  itLinux('ccd-telemetry-keepalive lands beside it too (spec 2026-09-07 §C) — every role, but not Darwin', () => {
    // Mirrors the `ccd-graph-sweep` case above, byte for byte: `_inst_bins`
    // ships this one on every role the same way, and rides the same darwin
    // carve-out (its systemd timer never installs there; the script needs GNU
    // date/stat, flock(1) and jq). Its UNIT and ENABLE are additionally
    // role-gated (server skips both) — see the `--role server` describe.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-telemetry-keepalive');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-telemetry-keepalive')));
    expect(mode(bin)).toBe(0o755);
  });
```

(c) `server/test/ccrc-install.test.ts`, in `UNIT_FILES` (`:2282-2296`), after the two sweep rows at
`:2292-2293`:

```typescript
  // spec 2026-09-07 §C: ROLE-GATED the same way — `_inst_units` skips both on
  // a `--role server` box. The default fixture install is role `both`.
  ['ccd-telemetry-keepalive.service', 'deploy/systemd/ccd-telemetry-keepalive.service'],
  ['ccd-telemetry-keepalive.timer', 'deploy/systemd/ccd-telemetry-keepalive.timer'],
```

…and the case title at `:2331` counts them, so it becomes:

```typescript
  it('installs eight unit files and two drop-ins, byte for byte, at 644', () => {
```

(d) `server/test/ccrc-install.test.ts:2408-2429` — the exact ORDERED mutation list. This is the
assertion that makes `_inst_enable` a mechanism rather than a comment; without this row the enable
could be deleted and nothing would notice:

```typescript
    expect(calls.map((c) => c.argv)).toEqual([
      '--user daemon-reload',
      '--user enable --now ccrc.service',
      '--user enable --now ccd-cap-scopes.timer',
      '--user enable --now ccd-graph-sweep.timer',
      // spec 2026-09-07 §C: a FOURTH enable, role-gated exactly as the sweep's
      // and degrading rather than dying for the same reason.
      '--user enable --now ccd-telemetry-keepalive.timer',
      '--user restart ccrc.service',
    ]);
```

(the existing comments between those entries stay; only the one new line and its own comment are
added, immediately before the `THE RESTART` block).

(e) `server/test/ccrc-install.test.ts:2827-2830` — the exact bin listing, which is a `.sort()`ed
`readdirSync` of `$HOME/.local/bin` and therefore reds the moment `_inst_bins` places a fifth name:

```typescript
      .toEqual(process.platform === 'darwin'
        // no cap-scopes (cgroup-bound); no graph-sweep and no keepalive (both systemd-timer-bound)
        ? ['ccd', 'ccrc', 'graphify']
        : ['ccd', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-telemetry-keepalive', 'ccrc', 'graphify']);
```

`'ccd-telemetry-keepalive'` sorts after `'ccd-graph-sweep'` (`g` < `t`) and before `'ccrc'`
(`d` < `r`). The prose above that assertion says "the four executables `_inst_bins` installs" —
make it **five**.

(f) `server/test/ccrc-install.test.ts:3519-3525` — the `--role both` twin of (d), which asserts the
same ordered list a second time:

```typescript
    expect(calls).toEqual([
      '--user daemon-reload',
      '--user enable --now ccrc.service',
      '--user enable --now ccd-cap-scopes.timer',
      '--user enable --now ccd-graph-sweep.timer',
      '--user enable --now ccd-telemetry-keepalive.timer',
      '--user restart ccrc.service',
    ]);
```

(g) `server/test/ccrc-install.test.ts:3540-3546` — the `--role server` case iterates `UNIT_FILES`
and asserts every row landed, skipping the sweep pair. Extending `UNIT_FILES` in (c) without
extending this skip would red it, so the two edits are one edit:

```typescript
    for (const [dest] of UNIT_FILES) {
      if (dest.startsWith('ccd-graph-sweep.')
        || dest.startsWith('ccd-telemetry-keepalive.')) continue;
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-telemetry-keepalive.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-telemetry-keepalive.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-graph-sweep');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-telemetry-keepalive');
```

(h) `server/test/ccrc-install-graphify.test.ts`, in its copy of `TREE_FILES` (`:47`, consumed at
`:104`), after `'ccd/ccd-graph-sweep',` — fixture input there too:

```typescript
  'ccd/ccd-telemetry-keepalive',
```

(i) `server/test/ccrc-uninstall.test.ts`, three additions. After the
`writeFileSync(join(bin, 'ccd-graph-sweep'), …)` fixture line:

```typescript
  // spec 2026-09-07 §C: the fifth `_inst_bins` executable.
  writeFileSync(join(bin, 'ccd-telemetry-keepalive'), '#!/bin/sh\n# keepalive\n', { mode: 0o755 });
```

In the fixture unit-name array (the `for (const u of [ … ])` at `:145-147`) and in the assertion
array at `:316-318`, add to each, after `'ccd-graph-sweep.timer'`:

```typescript
    'ccd-telemetry-keepalive.service', 'ccd-telemetry-keepalive.timer',
```

Beside the two existing disable assertions:

```typescript
    expect(calls).toContain('--user disable --now ccd-telemetry-keepalive.timer');
```

And in the `for (const b of ['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'graphify'])` loop
at `:477`, extend the array to
`['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-telemetry-keepalive', 'graphify']`.

(j) `server/test/gen-wrappers.test.ts`, in the case
`not an orphan: ccrc's OWN executables …`, extend BOTH
`['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep']` arrays (the fixture-writing loop at `:280`
and the assertion loop at `:286`) to
`['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-telemetry-keepalive']`. That case's own
comment says "the scan has to know these **four** are ccrc's own toolchain" (`:269`) — make it
**five**, or the prose stops describing the array under it.

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts test/ccrc-install-graphify.test.ts test/ccrc-uninstall.test.ts test/gen-wrappers.test.ts
```

Expected, file by file:

- **`ccrc-install`** reds on five things: the new landing case (b), with
  `ENOENT: no such file or directory, open '…/.local/bin/ccd-telemetry-keepalive'`; the byte-for-byte
  unit case (c), with `ccd-telemetry-keepalive.service never reached ~/.config/systemd/user —
  expected false to be true`; and the three exact-list assertions (d), (e) and (f), each with a
  `toEqual` diff naming the missing entry. Case (g) does **not** red — its skip is written for a
  `UNIT_FILES` that already carries the two new rows, and the two `existsSync(...).toBe(false)`
  assertions it adds are true on a tree that installs nothing.
- **`ccrc-install-graphify`** reds on **nothing**. Its `TREE_FILES` entry is fixture input only
  (`:104`), recorded rather than claimed — say exactly that in the commit message rather than
  implying a guard that is not there.
- **`ccrc-uninstall`** reds on the unit files and the binary surviving removal.
- **`gen-wrappers`** reds **before** the `TOOLCHAIN_EXECUTABLES` edit and passes after it. The
  fixture writes each name through `markGenerated(...)` (`:280-282`), and the orphan scan only skips
  a file whose `verifyMarker(text) === 'foreign'` (`deploy/gen-wrappers.mjs:366`) — so until the name
  is in the set the scan reports it. Expect
  `ccd-telemetry-keepalive was reported as an account wrapper nobody claims`.

**Record the actual output.**

- [ ] **Step 3: Make the six `ccd/ccrc` edits**

`_inst_bins` — after `    _inst_atomic "$tree/ccd/ccd-graph-sweep" "$bin/ccd-graph-sweep" 755`,
inside the same `if [ "$CCD_OS" != darwin ]` block:

```bash
    # spec 2026-09-07 §C: the telemetry keepalive, on this same non-Darwin arm
    # and for the same two reasons — its timer installs only on the systemd arm,
    # and the script leans on GNU date/stat, flock(1) and jq. It is placed on
    # EVERY role, exactly as the sweep is: only the UNIT and the ENABLE below
    # are role-gated. `deploy/gen-wrappers.mjs`'s `TOOLCHAIN_EXECUTABLES` knows
    # the name too, so the orphan scan in `_inst_wrappers` cannot report it.
    _inst_atomic "$tree/ccd/ccd-telemetry-keepalive" "$bin/ccd-telemetry-keepalive" 755
```

…and update the two transcript lines so the report is not a lie:

```bash
    echo "install: bins: ccd and the ccrc launcher in \$HOME/.local/bin (no ccd-cap-scopes — it caps cgroup scopes, and macOS has none; no ccd-graph-sweep and no ccd-telemetry-keepalive — their timers are systemd-only)"
```

```bash
    echo "install: bins: ccd, ccd-cap-scopes, ccd-graph-sweep, ccd-telemetry-keepalive and the ccrc launcher in \$HOME/.local/bin"
```

`_inst_units` — inside the existing `if [ "$INST_ROLE" != server ]; then` block, after the two
`ccd-graph-sweep` lines:

```bash
    _inst_atomic "$tree/deploy/systemd/ccd-telemetry-keepalive.service" "$dir/ccd-telemetry-keepalive.service" 644
    _inst_atomic "$tree/deploy/systemd/ccd-telemetry-keepalive.timer" "$dir/ccd-telemetry-keepalive.timer" 644
```

`_inst_enable` — after the `ccd-graph-sweep.timer` pair of lines:

```bash
  # spec 2026-09-07 §C: gated exactly as the sweep above — a server box takes no
  # keepalive, because it holds no account wrappers to take a turn on. And it
  # DEGRADES rather than dies for the same reason: the keepalive keeps placement
  # well-informed, it is not the guardrail `ccd-cap-scopes.timer` is.
  [ "$INST_ROLE" = server ] || systemctl --user enable --now ccd-telemetry-keepalive.timer \
    || echo "install: keepalive: could not enable ccd-telemetry-keepalive.timer — run: systemctl --user enable --now ccd-telemetry-keepalive.timer" >&2
```

`_uninst_units` — extend the disable loop's unit list:

```bash
    for u in "${BOX_UNIT_NAMES[@]}" ccd-cap-scopes.timer ccd-cap-scopes.service \
      ccd-graph-sweep.timer ccd-graph-sweep.service \
      ccd-telemetry-keepalive.timer ccd-telemetry-keepalive.service; do
```

…and the `rm -f` list:

```bash
  rm -f -- "$dir/${BOX_UNIT_NAMES[0]}" "$dir/${BOX_UNIT_NAMES[1]}" \
    "$dir/claude-session@.service" "$dir/ccd-cap-scopes.service" "$dir/ccd-cap-scopes.timer" \
    "$dir/ccd-graph-sweep.service" "$dir/ccd-graph-sweep.timer" \
    "$dir/ccd-telemetry-keepalive.service" "$dir/ccd-telemetry-keepalive.timer" \
    || _ccrc_die "removing the unit files under $dir failed"
```

`_uninst_wrappers` — extend the toolchain `case` so the wrapper arm cannot misclassify the binary
before the bin arm gets a say:

```bash
    case "$name" in ccd|ccrc|ccd-cap-scopes|ccd-graph-sweep|ccd-telemetry-keepalive) continue ;; esac
```

`_uninst_tree_bins` — extend the `rm -f` list and its transcript line:

```bash
  rm -f -- "$HOME/.local/bin/ccd" "$HOME/.local/bin/ccrc" "$HOME/.local/bin/ccd-cap-scopes" \
    "$HOME/.local/bin/ccd-graph-sweep" "$HOME/.local/bin/ccd-telemetry-keepalive" \
    || _ccrc_die "removing the executables from \$HOME/.local/bin failed"
  echo "uninstall: tree: ~/ccrc removed; ccd, ccd-cap-scopes, ccd-graph-sweep, ccd-telemetry-keepalive and the ccrc launcher removed from \$HOME/.local/bin"
```

- [ ] **Step 4: Make the `gen-wrappers.mjs` edit**

Change `deploy/gen-wrappers.mjs:160` from:

```javascript
const TOOLCHAIN_EXECUTABLES = new Set(['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep']);
```

to:

```javascript
const TOOLCHAIN_EXECUTABLES = new Set(['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep',
  'ccd-telemetry-keepalive']);
```

and append to that constant's JSDoc, after the `THAT DAY IS graphify Task 10` paragraph:

```javascript
 *  AND AGAIN, spec 2026-09-07 §C: `ccd-telemetry-keepalive` is `_inst_bins`'
 *  FIFTH executable, id-shaped and in the same `$HOME/.local/bin`. Measured:
 *  like the two before it, it carries no provenance marker, so the scan's
 *  `verifyMarker(text) === 'foreign'` clause already skips it today — this
 *  entry is the defence that survives the day one of them gains a marker,
 *  exactly as this header already promised for the other two.
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts test/ccrc-install-graphify.test.ts test/ccrc-uninstall.test.ts test/gen-wrappers.test.ts
```

Expected: all four files pass.

- [ ] **Step 6: Measure the mutation**

Three mutations, each run, each red set recorded, each restored.

1. Delete the `_inst_enable` two-line block, re-run `ccrc-install.test.ts`, confirm **two**
   assertions red — the ordered mutation list in `reloads and enables in that order` (`:2408`) and
   its `--role both` twin (`:3519`) — each with an
   `expected [ … ] to deeply equal [ … '--user enable --now ccd-telemetry-keepalive.timer' … ]`
   diff. Restore. (The `ccrc install` lane **is** covered here; the deploy lane is covered separately
   by Task 3's ordering assertion.)
2. Delete the `_inst_bins` `_inst_atomic` line, re-run, confirm the landing case (b) and the exact
   bin listing (e) both red. Restore.
3. Delete the `_uninst_tree_bins` `"$HOME/.local/bin/ccd-telemetry-keepalive"` path, re-run
   `ccrc-uninstall.test.ts`, confirm the bin-removal case reds. Restore.

- [ ] **Step 7: Run the neighbouring suites that read the same censuses**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts test/ccrc-doctor-graphify.test.ts test/single-definition.test.ts test/ccrc-api-ship.test.ts
```

Expected: all pass with **no edits needed**. Checked when the plan was written:
`single-definition.test.ts`'s `ROOTS` are `shared`, `server/src`, `pwa/src` and `agent/src`
(`:32-37`) — `ccd/` is not scanned, so a new bash executable there cannot trip it. Doctor's generic
`services` check reads a hardcoded three-name list (`ccd/ccrc-doctor-checks:808`,
`local -a known=(ccrc.service ccrc-agent.service ccd-cap-scopes.timer)`) that neither
`ccd-graph-sweep.timer` nor this timer is in, so neither suite has an opinion about it. If any of
these reds, something changed since the plan was written — stop and re-derive rather than editing the
assertion.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccrc deploy/gen-wrappers.mjs server/test/ccrc-install.test.ts server/test/ccrc-install-graphify.test.ts server/test/ccrc-uninstall.test.ts server/test/gen-wrappers.test.ts
git commit -m "feat(ccrc): install and uninstall the telemetry keepalive (D-1940)

Six edits in ccd/ccrc plus the orphan-scan set: _inst_bins places the fifth
executable on every non-Darwin role, _inst_units and _inst_enable role-gate the
timer off a server box exactly as they do the sweep's, and the three uninstall
censuses gain the name so nothing is stranded on PATH.

Mutation measured: dropping the _inst_enable block reds the two ordered
systemctl lists (the default install and --role both); dropping the _inst_bins
line reds the landing case and the exact bin listing; dropping the bin from
_uninst_tree_bins reds the removal assertion. The TREE_FILES rows are fixture
input and assert nothing — recorded, not claimed."
```

---

## Deviations found

**Minted 2026-09-08**, as part of one contiguous block of thirty (`D-1924`–`D-1953`, floor
1924 → 1954) covering all five plans on this branch, defined in the same act. The
"allocator unreachable" claim this paragraph used to carry was **wrong** — the fleet box reaches the
server over `CCRC_SERVER_URL`, and `ccrc-api ledger allocate` is a row in that client's closed table.
The measurement is in `2026-09-07-swap-verb-timeout.md`'s `## Deviations found`.

- **D-1940** — an idle measured account's `~/.cc-limits/<id>.json` had no path back to
  freshness at all. The file's only writer is `ccd/statusline-command.sh`, which runs on a statusline
  render, which happens only inside a live session; an account with no session therefore stops
  reporting for ever, and `_limit_field`'s own comment (`ccd/ccd:11728`) records the measured
  consequence — 14h of a stale `seven=98` stranding two sessions. §B makes that state honest
  (unknown, not a confident `0`), which is what makes the gap load-bearing rather than merely untidy.
  Closed by this plan.

- **D-1941** — "how fresh is fresh" is one number in two files with no
  mechanism holding them equal. `SWAP_FRESH` (`ccd/ccd:830`) had **zero readers** (spec E10) and this
  plan adds a second spelling in a file that cannot import it. Closed by Task 2's parity pin, in the
  `pool-name-parity.test.ts` shape.

- **D-1942** — **found, NOT fixed by this plan.**
  `ccd/statusline-command.sh:244` gates the write on `five_int` alone, and `:250` then writes
  `"${seven_int:-0}"`. A payload carrying `five_hour` but no `seven_day` therefore writes a
  **fabricated `seven: 0`** that is byte-indistinguishable from a measured zero — with no
  `rolledOver` flag to mark it, so §B's provenance fix cannot see it either. This is the same
  overloaded-null defect at the same seam the whole design is about, one field over. E5 measured both
  windows present on all four accounts today, so it is latent rather than live; this plan is
  nevertheless the thing that starts writing rows on accounts nobody is watching, which widens the
  exposure. It belongs to §B's plan or to its own, and must not be quietly folded into a keepalive
  commit.

- **D-1943** — **found, NOT fixed by this plan.** "Which files are ccrc's
  own executables" is answered by four hand-kept lists that no mechanism holds in step:
  `_inst_bins`'s install calls (`ccd/ccrc:4441-4457`), `_uninst_wrappers`' `case` (`:6318`),
  `_uninst_tree_bins`' `rm -f` list (`:6421-6422`) and `TOOLCHAIN_EXECUTABLES`
  (`deploy/gen-wrappers.mjs:160`) — plus two transcript sentences that name the set in prose. A
  merged deviation already records this class biting once ("the install grew a fifth name and this
  census did not, because it is hand-kept") — find it by that sentence, in graphify Task 10's own
  ledger entries. Task 4 adds the fifth name to all of them **by hand**, which is the
  second time; the class stays open and should be closed by a derivation, not by another careful
  edit.

- **D-1944** — **found, NOT fixed by this plan.** Doctor's generic
  `services` check asks about a hardcoded three-name list (`ccd/ccrc-doctor-checks:808`) that no
  timer added since has joined; `ccd-graph-sweep` answered that by shipping its own bespoke check
  (`ccrc-doctor-checks:3345,3360`). This plan ships **no** doctor check for the keepalive, so a box
  whose timer is dead, whose census is stale, or whose every account reads `no-render` says nothing
  in `ccrc doctor`. That is a deliberate scope line, recorded so its absence is a decision rather
  than an oversight — and it is the natural first follow-up once one live pass has told us what the
  healthy census actually looks like.

- **D-1945** — **found and fixed during final review, after every task in this plan was
  green.** Task 3 Step 2 appended the keepalive's `install_atomic` to `deploy/deploy.sh`'s agent
  lane; §A's probe had appended its own one plan earlier. Both landed BETWEEN
  `install_atomic ccd/ccd-graph-sweep` and `install_atomic ccd/graph-noise.default.list`, widening
  that pair to four executable lines and tripping D-1160/D-1161's own guard
  (`graph-noise-ship.test.ts`, which allows at most three lines of drift). Neither plan's task list
  could see it: each append was adjacency-neutral read alone, and the guard counts only the total —
  the second appender pays for the first. Fixed in `def7cb3e` by moving both later installs BELOW
  the sweep+list pair, changing no file that ships, and the reason now stands at the insertion point
  so the next appender reads it before appending. **This is the one number in the `D-1924`–`D-1953`
  block whose only reference lives in shipped source (`deploy/deploy.sh`) rather than in a plan** —
  which is also why the branch's own census of placeholders came up one short until it was measured
  instead of remembered.

- **D-1977** — **found and fixed in the review fix-wave (F7, 2026-09-08), after F1's own fix had
  landed.** `_ka_session_on` decided "a session is on this account" from the freshness of
  `$REG/<id>.supervised` ALONE, and `_session_state` — the tree's own definition of that question
  (`ccd/ccd:1807`) — asks tmux whether the PANE is alive FIRST, reading the heartbeat only to
  separate `running` from `unsupervised`. Both of those are a live `claude` process; the
  heartbeat-only reader saw `unsupervised` as ABSENT. That state is manufactured by the most
  ordinary event on this fleet: `KillMode=process` exists so a pane and its `claude` SURVIVE their
  supervisor unit, `deploy/deploy.sh`'s own sweep prints `claude-session@<id>.service is FAILED —
  try-restart skipped it`, and `ccd/ccd` records that "on deploy day every pane a pre-fix `ccd
  start` minted reads `unsupervised`". Nothing re-stamps the heartbeat after that, and the
  account's telemetry is stale too — because that session's statusline is the very thing that
  stopped writing — so every other gate waved the account through and the pass would `exec` a
  second `claude` under a `CLAUDE_CONFIG_DIR` a live one is already using: the ONE hazard the
  script's header refuses. **A deploy blocker**, since the next act on this branch is an agent-lane
  deploy to a box carrying ~20 live sessions.

  **The comment defending the gap was itself false**, which is the part worth remembering. It
  stated the residual ambiguity as only "a session whose pane just died inside the same 120s
  window" — the HARMLESS direction — and called it "the identical ambiguity `_session_state` itself
  accepts". `_session_state` accepts no such thing in the direction that costs money: it resolves a
  live pane with a dead supervisor by ASKING TMUX. A justification that names the safe half of an
  asymmetry and calls the whole thing symmetric reads, to the next maintainer, as a decision that
  was measured. This one had not been.

  Fixed by asking both halves — a session is on the account if its pane is alive OR its heartbeat
  is fresh (the fresh half still covers `restarting`, a dead pane whose supervisor is ticking) —
  through a locally re-implemented `_ka_pane_probe`, `_session_probe`'s classifier by value, since
  a sibling executable sources nothing. **Three more values are now copied and therefore pinned**
  (`keepalive-freshness-parity.test.ts`, extending its two-tier `exactlyOne`): `_tmux()`'s `cc-`
  prefix — the copy a typo DISARMS rather than breaks, because a name ccd never created answers
  `can't find session`, which reads as `gone`, which reads as "spend" — `SUBSTRATE_PROBE_DEADLINE_S`,
  and the one tmux sentence that means death.

  **The third answer is new and deliberate: the gate FAILS SHUT.** `_ka_session_on` returns three
  outcomes, not two — on it (rc 0), UNMEASURABLE (rc 2), clear (rc 1) — and only rc 1 spends. tmux
  absent, a socket this process cannot reach, a wedged server, an unrecognised wording: none of
  them are evidence a pane is dead, and ccd refuses the same mapping for the mirror-image reason
  (`gone` DESTROYS there, so an absent substrate must never mean it). The stated cost is the one
  risk row 4 of this plan's own self-review already carries, one condition wider: an account whose
  only session's pane can never be measured is never refreshed, and under §B an unmeasured account
  ranks last rather than winning placement — reduced preference, not a magnet. Both refusals write
  a `skipped` row with their OWN reason, the split the backoff and throttle gates already use.

- **D-1981** — **found and fixed in the review fix-wave (lane C, F8, 2026-09-08), before this
  branch's agent deploy.** Both new timers were spelled `OnBootSec=` (`ccd-account-health.timer` at
  7min, `ccd-telemetry-keepalive.timer` at 10min), and `OnBootSec=` anchors to MACHINE BOOT
  (`man 5 systemd.timer`, Table 1) — not to when the timer unit is armed. The ONLY moment either
  timer is ever first armed on the fleet host is a deploy: `deploy/deploy.sh`'s AGENT_CMD, or
  `ccrc install`'s enable, both `systemctl --user enable --now <timer>`. A box taking a deploy has
  been up for days, so the boot-relative elapse point is already in the past and systemd starts the
  oneshot AT ONCE, bounded only by `AccuracySec=1min`. **On the one path that installs them, the
  offsets bought nothing** — and `ccd-account-health.timer`'s own comment claimed the opposite in as
  many words ("two oneshots that both fire at boot and both want the network are a herd of two"),
  which is the worse half: a justification that is false at the only moment it is tested.

  **Fixed per timer, because the two cost different things.** The keepalive moves to
  `OnActiveSec=10min` — anchored to the moment the timer unit itself is activated, so identical to
  the old behaviour at boot and a real ten minutes at a deploy. It is the one that spends a
  `timeout 120 claude -p` turn per idle measured account, out of the very windows it exists to
  measure; on a first install `~/.ccrc/keepalive-state` is EMPTY, so its `lastAttempt` throttle skips
  nobody and the pass is the largest it will ever take — landing, under `OnBootSec=`, on top of
  `deploy.sh`'s supervisor sweep while that is `try-restart`ing every `claude-session@*` unit on a box
  carrying ~20 live sessions. Ten minutes is also long enough for every restarted supervisor's
  statusline to re-stamp `~/.cc-limits`, which makes those accounts read FRESH and be skipped rather
  than spent on. `OnActiveSec=` is additionally the honest anchor for a unit in the PER-USER manager,
  which does not necessarily start at boot at all.

  **The probe deliberately KEEPS `OnBootSec=7min`, and its file now says so at the key.** A pass costs
  one `curl --max-time 20` per account and no tokens, and what it writes is `$REG/<account>-authdead`
  — a MEASUREMENT which `ccd`'s `_authdead` header insists can be wrong, never joins `_account_ok`,
  and therefore only ever costs PREFERENCE and never ELIGIBILITY. A deploy is exactly when a standing
  marker is most likely to be one the shipped probe has just been fixed to clear, so re-measuring
  immediately is the cheapest right answer. The asymmetry is the decision; both units argue their own
  half where the key is, because the next reader's instinct is to make them match.

  `Persistent=` is not the knob for any of this and neither unit reaches for it: it only has an effect
  on timers configured with `OnCalendar=`. Guard: `server/test/timer-first-run.test.ts` (four cases —
  the keepalive's anchor, the probe's deliberate one plus the two phrases that carry the argument, the
  absent `Persistent=`, and a census holding every timer in `deploy/systemd` to exactly one first-run
  anchor so a fifth cannot arrive with none or with both). Three mutations measured, texts recorded in
  that file's header.

- **D-1982** — **found and fixed in the same wave (lane C, F9).** The systemd unit files were the one
  part of the agent deploy that was NOT installed atomically. Every executable on that lane goes
  through `install_atomic` — whose own header argues why a plain overwrite of a live file is a
  correctness bug — while `AGENT_BUILD_CMD` placed thirteen units and drop-ins, `claude-session@.service`
  among them, with plain `cp` into `~/.config/systemd/user/`; `REMOTE_BUILD_CMD` did the same with
  `ccrc.service`. `cp` opens its destination `O_TRUNC` and then writes, so a copy that dies mid-write
  — ENOSPC (the condition `ccd` carries `CCD_DISK_FLOOR_GB` for) or a dropped ssh — leaves a
  TRUNCATED unit at its live name.

  **"The deploy aborts before daemon-reload" is not containment**, which is where the original
  reasoning stopped. `set -euo pipefail` does abort the chain, but `ccd`'s own `_svc_enable` /
  `_svc_disable_now` reload on the next session start or stop, and on a box with ~20 live sessions
  that is minutes away. **And the dangerous truncation is the one that still PARSES.**
  `ccd/claude-session@.service` carries `KillMode=process` as the LAST key of its `[Service]` section,
  six lines below `ExecStart=`; a file cut anywhere in that gap is a valid unit that starts fine and
  kills by `control-group` — so the next `try-restart` takes the tmux pane and every in-flight turn
  with it. That is the outcome this repo's safety rules exist to prevent, reached without anyone
  touching tmux. `ccrc update`'s sweep preflight would refuse (it reads `KillMode` first); nothing
  else on the box does. Two of the thirteen files had a timestamped backup (added by an earlier
  review's finding I2); the other eleven had none.

  **Fixed with `_inst_atomic`'s shape rather than `install_atomic`'s**, deliberately: these are local
  copies ON THE BOX out of the tree `rsync` already landed there, so the right idiom is the box-side
  one `ccrc install` has always used for these same unit files (`ccd/ccrc`'s `_inst_atomic`: temp,
  chmod, `mv -f` = rename(2)). `_unit_atomic` is that, defined once per remote command string —
  nothing of ours exists on the box to source — and held byte-equal across the two lanes by the guard.
  One ssh, no extra round trips, and the two lanes stop disagreeing about the same files. The mode is
  now STATED (644) rather than inherited, since `cp` over an existing file keeps whatever mode the box
  had. A stray `<unit>.incoming.<pid>` from a dead run is inert to systemd (it ends in neither a unit
  suffix nor `.conf`) and the next successful copy of that file sweeps it.

  Guard: `agent/test/deploy-verify.test.ts`, "the unit files install ATOMICALLY". It bans a plain `cp`
  into `~/.config/systemd/user` in either lane (the way this bug comes back is a fourteenth unit
  appended in the old shape), holds the two `_unit_atomic` spellings byte-equal, asserts its three
  mechanisms one by one — and then EXECUTES the extracted chain against a fixture HOME, twice. The
  first run proves the quoting, which was the real risk of the change (`~` in an argument, `$1`/`$2`/`$$`
  that must survive to the box unexpanded, and the slice drop-in's `\x2d` escape in remote double
  quotes) and which no text scan can reach. The second re-runs it under `ulimit -f 0` — the one
  deterministic way to reproduce ENOSPC-shaped death in a unit test, since the write raises SIGXFSZ
  after the destination has already been opened `O_TRUNC` — and asserts no live unit was clobbered.
  Measured: the mutation that writes the live name first leaves `ccrc-agent.service` at 0 bytes and
  reds that assertion by name.

**One number this plan deliberately does NOT mint:** the roster's structural inability to declare a
`secretsFile` for the `upstream` account (spec §A.2). This plan *depends* on the convention that
resolves it (`.cc-secrets/<id>-oauth.env`) and would fail on the primary account without it, but §A's
plan owns both the defect and the loud doctor check that makes absence visible. Two plans defining
one number is the collision `deviation-refs.test.ts` exists to catch — leave it to §A.

**Before merge, from the repo root:**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

This compares this branch's entries against `origin/main`'s without merging, and reds on any
allocator-era number defined in two plans.

---

## Self-review

**Spec coverage.** §C states **four** design constraints plus one finding — "E6 removes the hazard
that worried this design" is an argument for safety, not a requirement to implement, and it is
carried in the Background and in the script's own header rather than in a task. The two further rows
below are §A.1's eligibility rule and §A.7's shipping template, applied here because §C says the
keepalive ships on the same template as the probe.

| §C requirement | Where |
|---|---|
| one minimal turn per eligible account per interval, cheapest model, empty context | Task 1's `_ka_turn` — `-p` + `--model "$CCRC_KEEPALIVE_MODEL"` (default `haiku`) + `cd "$WORKDIR"` (an empty scratch dir) |
| it consumes the resource it measures; state it, size it, make it env-overridable | Named in the plan's Background, in the script's own header, and instrumented per row via `fiveBefore`/`fiveAfter`; `CCRC_KEEPALIVE_FRESH` and `CCRC_KEEPALIVE_MODEL` are the two knobs, and the rate is derived exactly (8 turns/hour fleet-wide) while the dollar figure is marked UNMEASURED |
| skip an account that reported recently, reusing the existing window constants | Task 1's freshness gate; Task 2 pins its default to `SWAP_FRESH` (`ccd/ccd:830`) |
| never run against an account carrying `-authdead` | Task 1's `_authdead` gate, with the digits validation `ccd`'s `swapblocked` reader uses |
| eligibility is roster-derived `telemetry === 'anthropic'`, no account names | Task 1 walks `CCRC_MEASURED` from `~/.ccrc/accounts.sh`; the first test case asserts the telemetry-less account is never turned |
| units and the five deploy edits, same template as the probe **minus its own doctor check** | Tasks 3 and 4 (plus the two edits the spec's list omits, argued in Background). The omission is deliberate and recorded as `D-1944`: §A.7's template names "its own doctor check" as one of its elements, and this plan ships none |

The spec's §12 open question *"whether a purpose-built keepalive turn actually costs a small fraction
of the measured $0.19 — sized at plan time"* is answered as far as it honestly can be: the **rate** is
derived exactly and the **absolute** figure is turned into a per-row measurement rather than a guess.

**Placeholder scan.** No `TBD` — the `D-TBD-<slug>` names this plan carried were replaced by their
minted numbers on 2026-09-08. No "add error handling", no "similar to Task N", no reference to a function no
task defines. Every code step carries its literal content; every `expect` message is written out.

**Type consistency.** The script defines seven helpers — `_ka_row`, `_ka_finish`, `_ka_num`,
`_authdead`, `_ka_session_on`, `_ka_turn`, `_ka_log` — and every call site uses those exact names
with the arities their comments declare (`_ka_row` takes seven arguments at all eight call sites).
`fiveBefore`, `fiveAfter` and `costUsd` are `number | null` in the census and are produced by one jq
expression each, so "unknown" cannot become `0` on any path. The test helpers — `run`, `lastPass`,
`row`, `turns`, `plantWrapper`, `renders`, `plantLimits` — are each defined once and used under those
names. `exactlyOne` in Task 2 returns `string` and every use converts with `Number(...)` after the
count assertion has established a match.

**Risks handed to the implementer.**

1. **The central one: `claude -p` may render no statusline.** Unmeasured from this tree and
   unmeasurable from this box (`claude` is not on PATH here). The design's answer is the
   re-measurement gate — a turn that moves nothing is `no-render`, per account, per pass, in a
   durable census — so a wrong assumption is loud rather than silent. **Read the first live pass's
   census before believing this shipped**, and if every row says `no-render`, follow the two-step
   escalation in Background rather than reaching for a TUI.
2. **The keepalive spends.** The first live pass is the sizing measurement. If `fiveAfter - fiveBefore`
   is larger than one point per turn, widen `CCRC_KEEPALIVE_FRESH` before anything else — and note
   that `touch ~/.ccrc/keepalive-paused` stops the whole mechanism with no unit edit.
3. **`CCRC_KEEPALIVE_MODEL`'s default is an alias, not a pinned model id.** `haiku` is the cheapest
   alias Claude Code exposes; nothing in this tree pins it, and a CLI that rejects it produces a
   `failed` row with the exit code, which is the intended outcome rather than a crash.
4. **The live-session skip has a stated cost.** An account whose only session is wedged and never
   renders is skipped by `_ka_session_on` and therefore stays unmeasured. That is deliberate — two
   `claude` processes under one `CLAUDE_CONFIG_DIR` is a hazard this plan will not take — and under
   §B an unmeasured account ranks last rather than winning placement, so the failure mode is reduced
   preference, not a magnet.
5. **Task 4 collides with §A's plan by construction.** The health probe ships its own executable
   through the same six `ccd/ccrc` sites, the same `deploy.sh` lines and the same
   `TOOLCHAIN_EXECUTABLES`. Land §A first (it is sequenced third in spec §10, this plan fourth), then
   rebase; every conflict is additive and resolves by keeping both names.
6. **`_authdead` will exist in TWO files, and this plan keeps the shared contract's name for both.**
   §A owns the copy inside `ccd/ccd`; this one is a sibling executable that can source nothing from
   it, so a second body is unavoidable. The name and the contract are the shared one verbatim —
   `_authdead <wrapper>`, rc 0 when the marker exists and its first field is digits — with one
   additive extra: this copy also prints the epoch, which a caller that ignores stdout never sees.
   No body-parity pin is proposed, because the two are in different languages of context (one has
   `$REG` from `ccd`, one derives it from `HOME`). What is pinned instead is the marker's *format*,
   from both sides: this plan's suite plants `"<epoch> auth-401"` and asserts the skip, and asserts a
   non-digit first field does **not** skip. If §A changes the marker's shape, that pair goes red
   here, which is the intended coupling. If §A's plan lands a `ccd caps`-style reader the keepalive
   could call instead, delete this copy in that wave rather than letting two bodies drift.
