# Hook-Reported Agent Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fleet-session attention state comes from Claude Code hook events written to per-session files on the fleet host; the server reads them over existing plumbing and the PWA renders structured asks — pane scraping survives only as the ranked fallback.

**Architecture:** A shared bash hook script (`ccd/session-hook.sh`) writes `~/.cc-sessions/<id>.hookstate.json` atomically on every hook event; an idempotent installer registers it in all four wrapper homes' `settings.json`; `server/src/hookstate.ts` reads+validates with a freshness/uuid gate; three additive `FleetSession` fields ride the fleet wire; the per-session stream carries the full ask envelope; the PWA prefers envelopes over scraped dialogs. Three PRs: A (fleet-host producers, inert until deployed), B (server+wire), C (PWA).

**Tech Stack:** bash + jq (both already fleet dependencies — notify.sh uses jq), TypeScript ESM (Fastify server, React PWA), vitest. Hook-script tests run ccd-style inside fixture HOMEs with a fake `tmux` shell function.

## Global Constraints (from the spec, verbatim where quoted)

- **Zero new agent whitelist grants; zero new argv surfaces; zero new network paths.** The hook writes locally as the user; the server reads via the existing agent `read` op.
- **The hook script must be harmless everywhere:** non-fleet sessions, missing tmux, unreadable registry, full disk — every failure path exits 0 and writes nothing partial (tmp+`mv` only); no network, no locks.
- **`status` semantics are frozen.** Hook data adds fields; it never changes busy/idle/dead derivation, `archiveSafety`, or the interrupt route's authority.
- **Additive wire evolution:** new `FleetSession` fields are optional-null, revived in the literal (`reviveFleetSession` — a missing field is a compile error), present in every fixture.
- **Installer provably non-destructive:** existing hook entries survive byte-identical; `jq empty` gates every write; backups to `~/ccrc-backups/<ts>/` precede writes; managed entries recognized by command-contains-`/session-hook.sh`.
- **Registered events are exactly the MEASURED set**: `UserPromptSubmit`, `PreToolUse` (matcher `*`), `PostToolUse`, `PermissionRequest`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`. No `StopFailure`/`PostToolUseFailure` (absent from fleet binaries 2.1.218–2.1.222).
- **Tests under fixture `$HOME` only**; new ccd-style test files import `CCD`/harness helpers from `./ccdWsHelpers.js` conventions where applicable; fixture-building `it`s end `}, 30000);`.
- File cap 64 KB; on oversize drop the `questions` envelope first, never truncate it (a truncated envelope is worse than none).

---

# PR A — `feat/session-hook` (fleet-host producers; inert until deployed)

## File structure

- Create: `ccd/session-hook.sh` — the hook (one responsibility: event → state file).
- Create: `ccd/install-session-hooks.sh` — the installer (one responsibility: settings.json convergence).
- Modify: `ccd/ccd` — `_reg_purge` roster (search anchor: the suffix loop containing `rm -f "$REG/$id.reaping"`).
- Modify: `deploy/deploy.sh` — agent branch ships both scripts + runs the installer.
- Modify: `server/test/ccd-workspaces.test.ts` — the registry FIELDS census.
- Test: `server/test/session-hook.test.ts` (new), `server/test/install-session-hooks.test.ts` (new).

### Task 1: `ccd/session-hook.sh`

**Interfaces — Produces:** `~/.cc-sessions/<id>.hookstate.json` in the spec's v1 shape: `{ "v":1, "state":"working|waiting|done", "event", "sessionId", "pid", "updatedAt", "interrupted"?: true, "ask": {...}|null, "subagents":[{"name","startedAt"}] }`. Tasks 4–8 rely on exactly this.

- [ ] **Step 1: Write the failing tests** — new file `server/test/session-hook.test.ts`. The harness: a fixture HOME, a fake `tmux` on PATH, the script run with a stdin payload. Full test-file skeleton plus the first cases:

```ts
// Runs ccd/session-hook.sh for real inside a fixture HOME, the way the ccd
// suites run ccd: a stub tmux on PATH answers the session name, stdin carries
// the hook payload, and the assertion reads the file the script wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

/** Run the hook with a payload; env overrides let each test break one leg. */
const run = (payload: object, env: Record<string, string> = {}): void => {
  execFileSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    env: {
      ...process.env, HOME: home,
      PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
      ...env,
    },
  });
};
const stateFile = (): string => path.join(home, '.cc-sessions', 'demo-quiet-basin.hookstate.json');
const readState = (): any => JSON.parse(fs.readFileSync(stateFile(), 'utf8'));

describe('event → state mapping', () => {
  it('UserPromptSubmit writes working with identity fields', () => {
    run({ hook_event_name: 'UserPromptSubmit', session_id: 'uuid-1' });
    const s = readState();
    expect(s).toMatchObject({ v: 1, state: 'working', event: 'UserPromptSubmit',
      sessionId: 'uuid-1', pid: 4242, ask: null });
    expect(s.updatedAt).toBeGreaterThan(0);
  });
  it('PreToolUse of an ordinary tool is working; of AskUserQuestion is waiting with the untruncated envelope', () => {
    run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(readState().state).toBe('working');
    const questions = [{ question: 'Which?', header: 'Pick', multiSelect: false,
      options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }];
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions } });
    const s = readState();
    expect(s.state).toBe('waiting');
    expect(s.ask).toEqual({ questions });
  });
  it('PermissionRequest is waiting with approval tool + clipped summary', () => {
    run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash',
      tool_input: { command: 'x'.repeat(500) } });
    const s = readState();
    expect(s.state).toBe('waiting');
    expect(s.ask.approval.tool).toBe('Bash');
    expect(s.ask.approval.summary).toHaveLength(200);
  });
  it('Stop is done and clears ask; interrupted survives when the payload says so', () => {
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
    run({ hook_event_name: 'Stop', is_interrupt: true });
    const s = readState();
    expect(s).toMatchObject({ state: 'done', ask: null, interrupted: true });
  });
  it('PostCompact: auto is working, manual is done', () => {
    run({ hook_event_name: 'PostCompact', trigger: 'auto' });
    expect(readState().state).toBe('working');
    run({ hook_event_name: 'PostCompact', trigger: 'manual' });
    expect(readState().state).toBe('done');
  });
  it('an unrecognized event writes nothing', () => {
    run({ hook_event_name: 'SessionEnd' });
    expect(fs.existsSync(stateFile())).toBe(false);
  });
});

describe('subagents', () => {
  it('Start adds, Stop removes, the set caps at 32, session state is untouched', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'SubagentStart', agent_name: 'reviewer' });
    let s = readState();
    expect(s.state).toBe('working');
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0].name).toBe('reviewer');
    run({ hook_event_name: 'SubagentStop', agent_name: 'reviewer' });
    expect(readState().subagents).toHaveLength(0);
    for (let i = 0; i < 40; i++) run({ hook_event_name: 'SubagentStart', agent_name: `a${i}` });
    expect(readState().subagents.length).toBeLessThanOrEqual(32);
  });
});

describe('the fleet gate and failure polarity', () => {
  it('no TMUX_PANE → writes nothing, exits 0', () => {
    run({ hook_event_name: 'Stop' }, { TMUX_PANE: '' });
    expect(fs.readdirSync(path.join(home, '.cc-sessions'))).toEqual([]);
  });
  it('a foreign tmux session name → writes nothing', () => {
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), '#!/bin/sh\necho "main"\n', { mode: 0o755 });
    run({ hook_event_name: 'Stop' });
    expect(fs.readdirSync(path.join(home, '.cc-sessions'))).toEqual([]);
  });
  it('a corrupt existing state file is overwritten, not crashed on', () => {
    fs.writeFileSync(stateFile(), '{nope');
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState().state).toBe('working');
  });
  it('an oversized questions envelope is dropped whole; the state survives', () => {
    const questions = [{ question: 'q'.repeat(80_000), header: 'big', multiSelect: false, options: [] }];
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions } });
    const s = readState();
    expect(s.state).toBe('waiting');
    expect(s.ask).toBeNull();
    expect(fs.statSync(stateFile()).size).toBeLessThan(65536);
  });
  it('p95 of 20 runs stays under the budget (150ms CI allowance; 50ms target)', () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
      times.push(Date.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95) - 1]).toBeLessThan(150);
  }, 30000);
});
```

- [ ] **Step 2: Run to verify red** — `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts` — every case fails (script absent).
- [ ] **Step 3: Implement `ccd/session-hook.sh`:**

```bash
#!/usr/bin/env bash
# session-hook.sh — Claude Code hook → ~/.cc-sessions/<id>.hookstate.json
#
# Runs on the HOT PATH of every tool call in every fleet session, so the
# contract is absolute: exit 0 on every path, write atomically or not at
# all, no network, no locks, no waiting. A hook that can slow or break a
# session is worse than no hook. Consumed read-only by the ccrc server via
# the agent (whitelist: .cc-sessions is readable; nothing here needs a
# grant). Non-fleet sessions (no tmux, foreign session name) exit silently.
set -uo pipefail
REG="$HOME/.cc-sessions"

payload=$(cat 2>/dev/null) || exit 0
[[ -n "${TMUX_PANE:-}" ]] || exit 0
tname=$(tmux display-message -p '#S' 2>/dev/null) || exit 0
[[ "$tname" == cc-?* ]] || exit 0
id="${tname#cc-}"
[[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || exit 0
[[ -d "$REG" ]] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

event=$(jq -r '.hook_event_name // empty' <<<"$payload" 2>/dev/null) || exit 0
[[ -n "$event" ]] || exit 0

state="" ask_json="null" interrupted="false"
case "$event" in
  UserPromptSubmit|PostToolUse) state="working" ;;
  PreCompact) state="working" ;;
  PostCompact)
    trig=$(jq -r '.trigger // "auto"' <<<"$payload" 2>/dev/null) || exit 0
    [[ "$trig" == manual ]] && state="done" || state="working" ;;
  PreToolUse)
    tool=$(jq -r '.tool_name // empty' <<<"$payload" 2>/dev/null) || exit 0
    if [[ "$tool" == AskUserQuestion ]]; then
      state="waiting"
      ask_json=$(jq -c '{questions: (.tool_input.questions // [])}' <<<"$payload" 2>/dev/null) || ask_json="null"
    else
      state="working"
    fi ;;
  PermissionRequest)
    state="waiting"
    ask_json=$(jq -c '{approval: {tool: (.tool_name // "unknown"),
      summary: ((.tool_input.command // .tool_input.file_path // .tool_input.path
                 // .tool_input.url // .tool_input.pattern // "") | tostring | .[0:200])}}' \
      <<<"$payload" 2>/dev/null) || ask_json="null" ;;
  Stop)
    state="done"
    [[ $(jq -r '.is_interrupt // false' <<<"$payload" 2>/dev/null) == true ]] && interrupted="true" ;;
  SubagentStart|SubagentStop) state="" ;;   # subagent-set update only
  *) exit 0 ;;
esac

f="$REG/$id.hookstate.json"
# Prior subagent set survives state transitions; a corrupt file reads as [].
subs=$(jq -c '.subagents // []' "$f" 2>/dev/null) || subs="[]"
prev_state=$(jq -r '.state // empty' "$f" 2>/dev/null) || prev_state=""

if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then
  name=$(jq -r '.agent_name // .subagent_name // .agent_type // "subagent"' <<<"$payload" 2>/dev/null) || name="subagent"
  now=$(date +%s%3N)
  if [[ "$event" == SubagentStart ]]; then
    subs=$(jq -c --arg n "$name" --argjson t "$now" \
      '(. + [{name:$n, startedAt:$t}]) | .[0:32]' <<<"$subs" 2>/dev/null) || subs="[]"
  else
    subs=$(jq -c --arg n "$name" 'del(.[ (map(.name) | index($n)) // empty ])' <<<"$subs" 2>/dev/null) || subs="[]"
  fi
  # Session state untouched: keep the previous state (or skip entirely when
  # no state was ever written — a subagent event before any turn is inert).
  [[ -n "$prev_state" ]] || exit 0
  state="$prev_state"
  ask_json=$(jq -c '.ask // null' "$f" 2>/dev/null) || ask_json="null"
  interrupted=$(jq -r 'if .interrupted == true then "true" else "false" end' "$f" 2>/dev/null) || interrupted="false"
fi

# Transitions to working/done clear the ask: an answered question must not
# stay sticky on the sheet.
[[ "$state" == working || "$state" == done ]] && { [[ "$event" == SubagentStart || "$event" == SubagentStop ]] || ask_json="null"; }

out=$(jq -cn \
  --argjson v 1 --arg state "$state" --arg event "$event" \
  --arg sessionId "${CLAUDE_CODE_SESSION_ID:-}" --argjson pid "${CLAUDE_PID:-0}" \
  --argjson updatedAt "$(date +%s%3N)" --argjson interrupted "$interrupted" \
  --argjson ask "$ask_json" --argjson subagents "$subs" \
  '{v:$v, state:$state, event:$event, sessionId:$sessionId, pid:$pid,
    updatedAt:$updatedAt, ask:$ask, subagents:$subagents}
   + (if $interrupted then {interrupted:true} else {} end)') || exit 0

# 64KB cap: drop the questions envelope before anything else — a truncated
# envelope is worse than none.
if (( ${#out} > 65536 )); then
  out=$(jq -c '.ask = null' <<<"$out" 2>/dev/null) || exit 0
  (( ${#out} <= 65536 )) || exit 0
fi

tmp="$REG/.$id.hookstate.tmp"
printf '%s\n' "$out" > "$tmp" 2>/dev/null || { rm -f "$tmp"; exit 0; }
mv -f "$tmp" "$f" 2>/dev/null || rm -f "$tmp"
exit 0
```

- [ ] **Step 4: Run to green**, then `bash -n ccd/session-hook.sh`.
- [ ] **Step 5: Commit** — `feat(ccd): the session hook — Claude Code events become fleet state files`

### Task 2: `ccd/install-session-hooks.sh`

**Interfaces — Produces:** an idempotent installer: `install-session-hooks.sh [--homes <dir>...]` (default: the four wrapper homes), exit 0 on convergence, non-zero if any home's settings.json was broken JSON before the run (file untouched).

- [ ] **Step 1: Failing tests** — `server/test/install-session-hooks.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');

// The MEASURED real-world shape (2026-08-05): SessionStart with a compact
// matcher + a matcher-less entry, SessionEnd; one home carries an extra
// cloneme SessionEnd entry. The installer must preserve every byte of these.
const EXISTING = {
  hooks: {
    SessionStart: [
      { matcher: 'compact', hooks: [{ type: 'command', command: '/home/u/.cc-handoff/restore.sh' }] },
      { hooks: [{ type: 'command', command: "'/home/u/.claude/skills/code-usage/scripts/cron-upload.sh' --hook" }] },
    ],
    SessionEnd: [
      { hooks: [{ type: 'command', command: "'/home/u/.claude/skills/code-usage/scripts/cron-upload.sh' --hook" }] },
      { hooks: [{ type: 'command', command: '/home/u/.cloneme/cloneme-session-end.sh' }] },
    ],
  },
  statusLine: { type: 'command', command: 'bash "$HOME/.claude/statusline-command.sh"' },
};

let home: string;
const cfg = (d: string): string => path.join(home, d, 'settings.json');
beforeEach(() => {
  home = mkTmp('ccrc-hookinstall-');
  for (const d of ['.claude', '.claude-personal']) {
    fs.mkdirSync(path.join(home, d), { recursive: true });
    fs.writeFileSync(cfg(d), JSON.stringify(EXISTING, null, 2));
  }
  fs.mkdirSync(path.join(home, 'ccrc-backups'), { recursive: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (...args: string[]): void => {
  execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude'), path.join(home, '.claude-personal'), ...args],
    { env: { ...process.env, HOME: home } });
};

describe('install-session-hooks', () => {
  it('registers the nine measured events and preserves existing entries byte-identically', () => {
    run();
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    for (const ev of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest',
      'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact']) {
      const entries = s.hooks[ev] as any[];
      expect(entries.some((e) => e.hooks?.some((h: any) => String(h.command).includes('/session-hook.sh'))),
        ev).toBe(true);
    }
    // PreToolUse carries matcher '*'; the managed entries and nothing else.
    const pre = (s.hooks.PreToolUse as any[]).find((e) => e.hooks?.[0]?.command?.includes('/session-hook.sh'));
    expect(pre.matcher).toBe('*');
    // Every pre-existing entry survives exactly.
    expect(s.hooks.SessionStart).toEqual(EXISTING.hooks.SessionStart);
    expect(s.hooks.SessionEnd).toEqual(EXISTING.hooks.SessionEnd);
    expect(s.statusLine).toEqual(EXISTING.statusLine);
  });
  it('re-running converges (second run is a byte no-op)', () => {
    run();
    const first = fs.readFileSync(cfg('.claude'), 'utf8');
    run();
    expect(fs.readFileSync(cfg('.claude'), 'utf8')).toBe(first);
  });
  it('sweeps a stale managed entry with an old path (filename match, not exact command)', () => {
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    s.hooks.Stop = [{ hooks: [{ type: 'command', command: 'bash /old/place/session-hook.sh' }] }];
    fs.writeFileSync(cfg('.claude'), JSON.stringify(s));
    run();
    const after = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    const stops = (after.hooks.Stop as any[]).filter((e) =>
      e.hooks?.some((h: any) => String(h.command).includes('session-hook.sh')));
    expect(stops).toHaveLength(1);
    expect(stops[0].hooks[0].command).not.toContain('/old/place/');
  });
  it('refuses a home whose settings.json is broken JSON, touching nothing', () => {
    fs.writeFileSync(cfg('.claude-personal'), '{broken');
    expect(() => run()).toThrow();
    expect(fs.readFileSync(cfg('.claude-personal'), 'utf8')).toBe('{broken');
  });
  it('a home with NO settings.json gets one with only the managed hooks', () => {
    fs.rmSync(cfg('.claude-personal'));
    run();
    const s = JSON.parse(fs.readFileSync(cfg('.claude-personal'), 'utf8'));
    expect(Object.keys(s)).toEqual(['hooks']);
  });
  it('backs up every settings.json it rewrites', () => {
    run();
    const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
    expect(backups.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** — `ccd/install-session-hooks.sh`:

```bash
#!/usr/bin/env bash
# install-session-hooks.sh — register session-hook.sh in each wrapper home's
# settings.json. Idempotent and provably non-destructive: existing entries
# survive byte-identical, managed entries are recognized by their command
# containing /session-hook.sh (so re-runs sweep stale paths and converge),
# jq validates before every swap, and each rewritten file is backed up first.
# A settings.json this script broke would break every future session of that
# home — hence the paranoia.
set -euo pipefail

HOOK_CMD="bash \"\$HOME/.cc-sessions/session-hook.sh\""
EVENTS_PLAIN=(UserPromptSubmit PostToolUse PermissionRequest Stop SubagentStart SubagentStop PreCompact PostCompact)
TS=$(date +%Y%m%d-%H%M%S)
BACKUPS="$HOME/ccrc-backups/$TS"

homes=()
if [[ "${1:-}" == --homes ]]; then shift; homes=("$@")
else homes=("$HOME/.claude" "$HOME/.claude-personal" "$HOME/.claude-corp" "$HOME/.claude-gpt"); fi

rc=0
for dir in "${homes[@]}"; do
  [[ -d "$dir" ]] || continue
  f="$dir/settings.json"
  if [[ -f "$f" ]]; then
    jq empty "$f" 2>/dev/null || { echo "install-session-hooks: $f is not valid JSON — refusing" >&2; rc=1; continue; }
    cur=$(cat "$f")
  else
    cur='{}'
  fi

  # Sweep every managed entry (filename match), then insert the current set.
  next=$(jq --arg cmd "$HOOK_CMD" '
    def unmanaged: map(select((.hooks // []) | any(.command | tostring | contains("/session-hook.sh")) | not));
    .hooks = ((.hooks // {})
      | with_entries(.value |= unmanaged)
      | .PreToolUse       = ((.PreToolUse // [])       + [{matcher:"*", hooks:[{type:"command", command:$cmd}]}])
      '"$(for ev in "${EVENTS_PLAIN[@]}"; do
            printf ' | .%s = ((.%s // []) + [{hooks:[{type:"command", command:$cmd}]}])' "$ev" "$ev"
          done)"'
      | with_entries(select(.value != [])))
  ' <<<"$cur") || { echo "install-session-hooks: merge failed for $f" >&2; rc=1; continue; }

  # Converged already? Do not touch the file (idempotence is byte-level).
  if [[ -f "$f" ]] && [[ "$(jq -S . <<<"$next")" == "$(jq -S . "$f")" ]]; then continue; fi

  jq empty <<<"$next" || { rc=1; continue; }
  if [[ -f "$f" ]]; then mkdir -p "$BACKUPS"; cp -a "$f" "$BACKUPS/$(basename "$dir").settings.json"; fi
  tmp="$f.tmp.$$"
  jq . <<<"$next" > "$tmp" && mv -f "$tmp" "$f" || { rm -f "$tmp"; rc=1; }
done
exit "$rc"
```

  Note for the implementer: the byte-no-op convergence test compares the
  full serialized file — make sure the final write uses the same `jq .`
  pretty-printing on both runs so run 2 short-circuits at the compare.
- [ ] **Step 4: Run green** + `bash -n`.
- [ ] **Step 5: Commit** — `feat(ccd): idempotent, non-destructive session-hook installer`

### Task 3: registry lifecycle + deploy shipping

- [ ] **Step 1: Failing tests** — extend `server/test/ccd-workspaces.test.ts`'s FIELDS census with `'hookstate.json'` (read the pinned list first — it is alphabetical) and add to the reap suite (`server/test/ccd-ws-reap.test.ts`, the `refusals are answers`-adjacent region) one test: write a `demo-quiet-basin.hookstate.json` into the fixture registry, run a successful full reap (the `ready()` + `tokenOf()` + `reap()` idiom), assert the hookstate file is gone afterwards. `}, 30000);`.
- [ ] **Step 2: Run red** (purge leaves the file today).
- [ ] **Step 3: Implement** — in `ccd/ccd` `_reg_purge` (anchor: the function whose roster loops suffixes and ends `rm -f "$REG/$id.reaping"`), add `hookstate.json` to the suffix roster in the same style as its neighbours. In `deploy/deploy.sh`'s agent branch, extend the ship block that already carries `notify.sh` (anchor: `"${SCP[@]}" deploy/notify.sh "$BOX":.cc-sessions/notify.sh`):

```bash
  "${SCP[@]}" ccd/session-hook.sh "$BOX":.cc-sessions/session-hook.sh
  "${SCP[@]}" ccd/install-session-hooks.sh "$BOX":.cc-sessions/install-session-hooks.sh
  "${SSH[@]}" "$BOX" 'chmod +x ~/.cc-sessions/session-hook.sh ~/.cc-sessions/install-session-hooks.sh && bash ~/.cc-sessions/install-session-hooks.sh'
```

  (after the existing chmod line; the installer backs up settings itself). Update the README Deploy section's agent bullet to name the hook shipping.
- [ ] **Step 4: Run green** — the two touched suites + `bash -n` both scripts + `bash -n ccd/ccd`.
- [ ] **Step 5: Commit** — `feat(ccd): hookstate joins the registry lifecycle; deploy ships and installs the hooks`, push, **open PR A**, merge on green.

---

# PR B — `feat/hookstate-wire` (server + wire)

## File structure

- Create: `server/src/hookstate.ts` — reader/validator (livestate.ts's sibling).
- Modify: `shared/api.ts` — `HookAsk` types, three `FleetSession` fields, revive literal, `SessionStreamMsg` ask variants.
- Modify: `server/src/fleet.ts` — assembleFleet reads hookstate; `dialogPending` OR-rule.
- Modify: `server/src/watch.ts` — pass registry uuids/hookstates through the tick (follow assembleFleet's existing parameter pattern).
- Modify: `server/src/sessionws.ts` — ask envelope frames.
- Test: `server/test/hookstate.test.ts` (new), `server/test/fleetstate.test.ts` + `server/test/fleet-health.test.ts` (revive fixtures), `server/test/fleetws.test.ts`, `server/test/sessionws.test.ts` (or the file that owns the stream tests — locate by `nextDialogFrame`).

### Task 4: `server/src/hookstate.ts`

**Interfaces — Produces:** `readHookState(io: FleetIO, registryDir: string, id: string, currentUuid: string | null, now: number): Promise<HookState | null>`; `interface HookState { state: 'working'|'waiting'|'done'; updatedAt: number; ask: HookAsk | null; subagents: { name: string; startedAt: number }[]; interrupted: boolean }`; `HOOKSTATE_FRESH_MS = 30 * 60 * 1000`. Null on: missing file, malformed JSON, `v !== 1`, unknown state, `sessionId !== currentUuid`, `now - updatedAt > HOOKSTATE_FRESH_MS`, file > 64 KB.

- [ ] **Step 1: Failing tests** — `server/test/hookstate.test.ts`, pure-TS with a stub FleetIO (follow `lifecycle.test.ts`'s in-memory io idiom): fresh-and-matching round-trips all fields; each null condition gets its own `it` (stale by 31 min; uuid mismatch; v:2; state:'blocked'; truncated JSON; oversize payload); `ask` variants both parse; subagents default `[]` when absent.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** — mirror `livestate.ts`'s shape (single read, explicit field validation, no spread-casts — every field checked and rebuilt literally; the WsAudit revive discipline applies). The uuid gate carries a comment: "a restarted session must not inherit the old file's state — the registry's uuid advances via _sync_uuid the moment the new process publishes, and that advance is what invalidates this file (the restoredUnconfirmed idea with existing plumbing)."
- [ ] **Step 4: Run green + tsc.**
- [ ] **Step 5: Commit** — `feat(server): the hookstate reader — fresh, identity-gated, fail-null`

### Task 5: wire fields + resolver into assembleFleet

**Interfaces — Produces:** `FleetSession` gains `hookState: 'working'|'waiting'|'done'|null`, `askSummary: string|null`, `subagents: {name:string;startedAt:number}[]|null`; `shared/api.ts` exports `type HookAsk = { questions: HookAskQuestion[] } | { approval: { tool: string; summary: string } }` and `interface HookAskQuestion { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] }`.

- [ ] **Step 1: Failing tests** — extend the fleet assembly suite (locate by `assembleFleet(` in server/test — fleet.test.ts or fleetstate.test.ts): a session with a fresh hookstate carries the three fields; a hookless session carries nulls; `dialogPending` is true when EITHER the pane detector said so OR `hookState === 'waiting'` (both directions pinned); `status` (busy/idle) is IDENTICAL with and without hookstate present (the frozen-semantics pin — build one fixture, assert twice). Revive: `reviveFleetSession` round-trips populated and null; the fleetstate/fleet-health older-cache tests gain the three fields as nulls.
- [ ] **Step 2: Run red** (compile errors first — the revive literal is the tripwire).
- [ ] **Step 3: Implement** — types + revive additions (use `optStr`-style helpers; `subagents` via a small `optSubagents` validating each entry literally); `assembleFleet` gains a `hookStates?: Map<string, HookState>` parameter (same pattern as `pendingDialogs`); the watcher tick builds the map by calling `readHookState` per record (uuid from the registry record it already holds), alongside its existing per-record reads. `askSummary` derivation: for questions — the first question's `header ?? question` clipped to 80; for approval — `` `${tool}: ${summary}` `` clipped to 80.
- [ ] **Step 4: Run green** — fleet suites + full server + three tsc (shared changed: pwa/agent must still compile).
- [ ] **Step 5: Commit** — `feat(server): hook state rides the fleet wire — additive, status frozen`

### Task 6: the ask envelope on the per-session stream

**Interfaces — Produces:** `SessionStreamMsg` union gains `{ type: 'ask'; ask: HookAsk }` and `{ type: 'ask_cleared' }`. Emitted by the session stream when a fresh hookstate's ask appears/changes (JSON-compare) and when it goes null/stale. The scraped-dialog frames are untouched.

- [ ] **Step 1: Failing tests** — in the suite that owns the session stream (locate by `nextDialogFrame` or `dialog_cleared` in server/test): with a hookstate file present whose ask is populated, the stream delivers `ask` after connect; changing the file's ask delivers a new `ask` frame; nulling it delivers `ask_cleared`; a scraped dialog for the same session still delivers its own `dialog` frame (no suppression either way — the CLIENT prefers, the server reports both truthfully).
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** in `server/src/sessionws.ts`: alongside the existing per-tick dialog re-detection, read hookstate (same reader, uuid via the record), track `lastAskJson`, emit on change. Do not touch the `nextDialogFrame` gate. Comment anchor: the stream's header comment about detecting dialogs itself — extend it to name the second, hook-sourced channel and why both flow ("the client prefers the envelope; the server never guesses which one is right").
- [ ] **Step 4: Run green + full server suite.**
- [ ] **Step 5: Commit** — `feat(server): the ask envelope streams beside the scraped dialog`, push, **open PR B**, merge on green.

---

# PR C — `feat/hook-ux` (PWA)

## File structure

- Modify: `pwa/src/fleet/SessionLine.tsx` (waiting dot precedence), `pwa/src/session/SessionHeader.tsx` (attention badge OR-rule — verify it keys off `dialogPending`, which Task 5 already OR-ed server-side; if so, no change — pin with a test instead).
- Modify: `pwa/src/session/DialogSheet.tsx` — envelope preference.
- Modify: `pwa/src/stores/session.ts` — hold latest ask envelope from the stream.
- Modify: `pwa/src/fleet/SessionLine.tsx` or the card component — subagent chip.
- Test: `pwa/test/dialog-sheet.test.tsx` (or the sheet's existing suite), `pwa/test/fleet-screen.test.tsx`, session store tests.

### Task 7: fleet surfaces — waiting + subagent chip

- [ ] **Step 1: Failing tests** — fleet-screen/session-line suites: a session with `hookState: 'waiting'` renders the attention treatment even when `dialogPending` is false client-side (it will be true from the server OR-rule — pin BOTH: the server-provided flag path and a defensive client OR); `subagents: [{name:'reviewer',startedAt:1}]` renders a chip with count 1 (`⑂ 1`, `aria-label="1 subagent"`); null/empty renders nothing (and the existing card layout snapshot-ish assertions stay green).
- [ ] **Step 2: Run red** (the untyped fixtures in fleet-screen tests need the new fields — add them deliberately; the typed factories fail compile first).
- [ ] **Step 3: Implement** — minimal JSX: chip beside the existing status dot; the waiting treatment reuses the exact `dialogPending` visual (same class), no new visual system.
- [ ] **Step 4: Run green + tsc.**
- [ ] **Step 5: Commit** — `feat(pwa): waiting state and subagent chip on the fleet line`

### Task 8: DialogSheet prefers the envelope

- [ ] **Step 1: Failing tests** — the sheet's suite: when the session store holds an ask envelope with questions, the sheet renders its options as tappable rows (labels + descriptions), tapping option N sends the digit `String(n+1)` through the existing send path, and the envelope view carries `data-source="hook"`; an approval envelope renders the tool + summary with Allow/Deny buttons sending `y` / `ESC`; with NO envelope, a scraped dialog renders exactly as today (regression pin — reuse an existing scraped-dialog test's fixture and assert unchanged output); `ask_cleared` empties the envelope and falls back to scrape if one is pending.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** — store: keep `ask: HookAsk | null` per session updated from the stream frames; sheet: `ask ? <EnvelopeView/> : <ScrapedView/>` where EnvelopeView maps `HookAskQuestion.options` to the same button components the scraped path uses (identical send mechanics — find the scraped option's onSelect and reuse it verbatim).
- [ ] **Step 4: Run green + full pwa suite + tsc.**
- [ ] **Step 5: Commit** — `feat(pwa): the dialog sheet prefers the hook envelope over the scrape`, push, **open PR C**, merge on green.

---

# Final gate

- [ ] Three suites + three typechecks green on main at their new counts; manifest exit 0.
- [ ] Deploy (operator-gated, standing five proofs) **plus the sixth proof**: after one session cycles (swap/compact), its `hookstate.json` exists in `~/.cc-sessions/` and `GET /api/fleet` carries `hookState` non-null for it.
- [ ] Rollout order per the spec: PR A's deploy is inert (files appear, nothing reads them) → PR B server reads nulls until files appear → PR C renders when data arrives. Any deploy order is safe; ship agent first anyway.

## Self-review record (writing-plans checklist, run 2026-08-05)

- **Spec coverage:** H1→Task 1, H2→Task 2, H3→Task 3, H4→Tasks 4–6, H5→Tasks 7–8; rollout→final gate; every cut respected (no push changes, no buckets, no blocked state, no Notification hook). The spec's plan-time event re-verification lands in Task 2's implementer context (the installer registers the fixed MEASURED list; deviation requires touching the EVENTS array deliberately).
- **Placeholder scan:** Task 4 step 3 and Tasks 7–8 step 3 describe implementations by explicit contract + anchor rather than full code — deliberate: they mirror named existing modules (`livestate.ts`, the scraped-option send path) that the implementer must read anyway; all contracts, names, and types are stated exactly. No TBDs.
- **Type consistency:** `HookState`/`HookAsk`/`HookAskQuestion` names and shapes match across Tasks 4, 5, 6, 8; the three wire fields are named identically in Tasks 5 and 7; `HOOKSTATE_FRESH_MS` defined once (Task 4) and referenced nowhere else by value.
