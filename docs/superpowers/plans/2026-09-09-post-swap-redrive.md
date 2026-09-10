# Post-swap re-drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session that ccd restarts after a usage limit (rescue swap, affinity swap, supervisor revival) continues its interrupted turn by itself; ccd never cancels Claude Code's own limit recovery; the PWA shows a stalled restart as a stall.

**Architecture:** Four independent fixes on two sides. ccd (bash) switches on Claude Code's env-gated interrupted-turn resume on every spawn, adds a transcript-measured fallback that types the prompt when the flag did not drive the turn, and gates its three keystroke sites on the "continuing automatically" pane line. The server's transcript parser maps the META resume prompt and the synthetic `No response requested.` padding to `system` events with an additive `origin` field, and the PWA bubble words the padding as a stall.

**Tech Stack:** bash (`ccd/ccd`), vitest harness (`server/test/ccdWsHelpers.ts` `makeCcdHarness`), TypeScript (server parser, `shared/api.ts` L0, PWA React/jsdom).

**Spec:** `docs/superpowers/specs/2026-09-09-post-swap-redrive-design.md`

## Global Constraints

- Work on the workspace branch `ws/brisk-meadow`; never a separate feature branch (CLAUDE.md).
- Every guard ships WITH a test that reds when the guard is deleted (mutation-table discipline). Each task states its mutation.
- ccd tests run ONLY against fixture HOMEs via `makeCcdHarness`; never the live `$HOME`.
- Run suites as `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts` (never bare `npx vitest`), foreground, timeout ≥ 600000 ms.
- `shared/api.ts` is L0: it imports nothing. New wire field is optional (additive-only, absence-permits); do NOT bump `FLEET_PROTO`.
- `single-definition.test.ts` text-scans four roots: define each new constant once. The resume sentence is spelled in ccd (bash, as part of `RESUME_PROMPT`) and in `shared/api.ts` (`RESUME_PROMPT_PREFIX`) by necessity (D-2226-ix below); the test scans for specific enumerations, not this sentence — verify it stays green.
- `RESUME_PROMPT` must contain no single quote: it is single-quoted inside the tmux command string. Pinned by Task 1's test.
- Changes to `ccd/` are AGENT-FIRST at deploy time. **Deploy is NOT part of this plan** — it is the operator's step after merge (`bash deploy/deploy.sh agent <host>` then the server lane).
- Deviation numbers D-2226..D-2237 are ISSUED (allocator, 2026-09-09, floor 2238) and DEFINED in `## Deviations found` at the end of this plan. Source comments cite them; do not invent new numbers — a further finding is `D-TBD-<slug>` reported to the operator.

---

### Task 1: The resume flag on every spawn (F1)

**Files:**
- Modify: `ccd/ccd` — constants near `SPAWN_EFFORT` (~line 949); `_spawn_start` (~line 13340, both `_tmux_new_session` lines)
- Test: `server/test/ccd-resume-flag.test.ts` (new)

**Interfaces:**
- Produces: `RESUME_INTERRUPTED_TURN` (string `1`), `RESUME_PROMPT` (string, begins `Continue from where you left off.`), `RESUME_REDRIVE_MAX_AGE_MS` (string, default empty), `_resume_env` (stdout: one line of `KEY=value` assignments for `env`). Task 3 reads `RESUME_PROMPT`.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-resume-flag.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

// D-2227 — Claude Code's interrupted-turn resume is env-gated
// (CLAUDE_CODE_RESUME_INTERRUPTED_TURN); ccd never set it, so every `--resume`
// after a swap wrote the synthetic "Continue from where you left off." pair and
// sat idle. These pin that every spawn line carries the flag and the prompt.

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-resume-flag-'); });
afterEach(() => { h.cleanup(); });

/** The `ccd-rc-flag.test.ts` spawn substrate: `new-session` raises a pane marker. */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' "\${PANE_TEXT:-? for shortcuts}" ;;
    esac
  };`;
/** A tmux whose `--resume` new-session leaves no pane, forcing the
 *  `--session-id` fallback line — the second spawn line must carry the flag too. */
const RESUME_DIES = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      list-sessions) return 0 ;;
    esac
  };`;
const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const seed = (): void => {
  h.sh(`_reg_set myid wrapper claude
        _reg_set myid workdir '${h.home}'
        _reg_set myid uuid deadbeef-0000-4000-8000-000000000000`);
};

describe('the resume flag (D-2227)', () => {
  it('a resume spawn carries CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1 and the prompt, before the wrapper', () => {
    seed();
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid resume`);
    const line = newSessions()[0]!;
    expect(line).toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1');
    expect(line).toContain("CLAUDE_CODE_RESUME_PROMPT='Continue from where you left off.");
    expect(line.indexOf('CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1')).toBeLessThan(line.indexOf('/.local/bin/claude'));
    expect(line).not.toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS');
  });

  it('a new spawn carries it too — one spawn shape, the transcript decides', () => {
    seed();
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    expect(newSessions()[0]).toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1');
  });

  it('the --session-id fallback line carries it as well', () => {
    seed();
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null`);
    const news = newSessions();
    expect(news).toHaveLength(2);
    expect(news[1]).toContain('--session-id');
    expect(news[1]).toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1');
  });

  it('RESUME_REDRIVE_MAX_AGE_MS, when set, rides as CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS (D-2230)', () => {
    seed();
    h.sh(`${TMUX} RESUME_REDRIVE_MAX_AGE_MS=3600000; rm -f "$HOME/pane-up"; _spawn_start myid resume`);
    expect(newSessions()[0]).toContain('CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS=3600000');
  });

  it('the prompt has no single quote (it is single-quoted into the tmux command) and starts with the sentence Claude Code matches', () => {
    const p = h.sh(`printf '%s' "$RESUME_PROMPT"`);
    expect(p).not.toContain("'");
    expect(p.startsWith('Continue from where you left off.')).toBe(true);
    expect(p).toContain('ccd restarted this session');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-resume-flag.test.ts`
Expected: FAIL — `expected '...' to contain 'CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1'` (4 tests) and the prompt test fails with an empty string.

- [ ] **Step 3: Add the constants and thread them into both spawn lines**

In `ccd/ccd`, directly after the `SPAWN_EFFORT="ultracode"` line (~949), add:

```bash
# D-2227 — CLAUDE CODE'S OWN INTERRUPTED-TURN RESUME, SWITCHED ON FOR EVERY SPAWN.
# On `--resume`, Claude Code classifies a tail whose last turn died in an API
# error (a limit banner) as an interrupted turn, writes a META user prompt
# ("Continue from where you left off.") and a synthetic "No response requested."
# — and submits that prompt ONLY when CLAUDE_CODE_RESUME_INTERRUPTED_TURN is set.
# Measured 2026-09-09: four rescued sessions, four idle landings, four manual
# "resume" messages (spec §2). The value is the string "1", which is what Claude
# Code's own runner sets for a respawned worker. It is a third-party flag, so it
# ships with a measurement and a fallback: `_redrive_after_spawn` (D-2231).
RESUME_INTERRUPTED_TURN=1
# The prompt Claude Code submits. It starts with the sentence Claude Code's own
# default uses (the PWA parser matches that prefix, shared/api.ts
# RESUME_PROMPT_PREFIX) and then says what only ccd knows: the previous process
# is gone, and with it every background task it owned. NO SINGLE QUOTE: the
# string is single-quoted into the tmux command line (ccd-resume-flag.test.ts).
RESUME_PROMPT="Continue from where you left off. Note: ccd restarted this session (an account swap or a supervisor revival) after its previous process was stopped mid-turn, and the operator has not sent a new message since. Any background task, Workflow or subagent of the previous process is gone: re-check their journals and outputs, and re-verify anything time-sensitive (branch state, running processes, prior partial work) before continuing."
# D-2230 — empty = no age cap on the re-drive (ruling R5). Set to a number of
# milliseconds to make Claude Code suppress the re-drive of a turn older than that.
RESUME_REDRIVE_MAX_AGE_MS=""
```

Directly before `SPAWN_FROMSWAP=0` / `_spawn_start()` add:

```bash
_resume_env() {   # -> one line of KEY=value assignments for `env`, switching on Claude Code's interrupted-turn resume (D-2227)
  local out="CLAUDE_CODE_RESUME_INTERRUPTED_TURN=$RESUME_INTERRUPTED_TURN CLAUDE_CODE_RESUME_PROMPT='$RESUME_PROMPT'"
  [[ -n "$RESUME_REDRIVE_MAX_AGE_MS" ]] && out="$out CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS=$RESUME_REDRIVE_MAX_AGE_MS"
  printf '%s' "$out"
}
```

In `_spawn_start`, add `resenv` to the `local` list and set it after `rcflag`:

```bash
  local resenv
  resenv=$(_resume_env)
```

and change BOTH `_tmux_new_session` command strings from
`"cd '$workdir' && exec env COLORTERM=truecolor '$WRAPPER_DIR/$wrapper' ...`
to
`"cd '$workdir' && exec env COLORTERM=truecolor $resenv '$WRAPPER_DIR/$wrapper' ...`
(the `$resenv` is deliberately unquoted: it expands to several assignments, and the prompt inside it carries its own single quotes).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-resume-flag.test.ts test/ccd-rc-flag.test.ts test/ccd-spawn-split.test.ts`
Expected: PASS (the two existing spawn suites must stay green — they assert other parts of the same lines).

- [ ] **Step 5: Mutation check, then commit**

Temporarily delete `$resenv ` from the first spawn line, run the new suite: the first test must FAIL. Restore it.

```bash
git add ccd/ccd server/test/ccd-resume-flag.test.ts
git commit -m "feat(ccd): switch on Claude Code's interrupted-turn resume for every spawn (D-2227, D-2230)"
```

---

### Task 2: Stand down when Claude Code's auto-continue is armed (F3)

**Files:**
- Modify: `ccd/ccd` — new `_pane_auto_continue_armed` next to `_pane_hard_blocked` (~line 12548); gate in `_auto_compact_check` (~line 12853, after the `pane-blank` note); gate in `_inject_spawn_effort` (~line 13557)
- Test: `server/test/ccd-auto-compact.test.ts` (add one describe), `server/test/ccd-redrive.test.ts` (new; the effort half)

**Interfaces:**
- Produces: `_pane_auto_continue_armed <pane-text>` → exit 0 iff the pane shows `continuing automatically` or `continuing shortly`. Task 3 calls it.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-auto-compact.test.ts` (inside the file, after the existing describes; reuse its `seed`, `sessionJson`, `tick`, `sendKeys`, `reason` helpers):

```ts
describe('an armed auto-continue is never cancelled by /compact (D-2229)', () => {
  const ARMED = [
    '  ▓ ctx ████████░░ 61%',
    'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel',
    '❯ ',
  ].join('\n');
  it('a pane waiting out a limit gets no keystroke, and the note says why', () => {
    seed(); sessionJson('idle', 120);
    tick(ARMED);
    expect(sendKeys()).toEqual([]);
    expect(reason()).toBe('auto-continue');
    expect(skipLines().at(-1)).toContain('compact-skip demo-quiet-mesa: auto-continue');
  });
  it('the "continuing shortly" variant is the same wait', () => {
    seed(); sessionJson('idle', 120);
    tick(ARMED.replace('continuing automatically at 11:50am', 'continuing shortly'));
    expect(sendKeys()).toEqual([]);
    expect(reason()).toBe('auto-continue');
  });
  it('control: the same pane without the wait line compacts', () => {
    seed(); sessionJson('idle', 120);
    tick(ARMED.split('\n').filter((l) => !l.includes('Usage limit')).join('\n'));
    expect(sendKeys().some((k) => k.includes('/compact'))).toBe(true);
  });
});
```

Create `server/test/ccd-redrive.test.ts` with the effort half (Task 3 adds the rest to this same file):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-redrive-'); });
afterEach(() => { h.cleanup(); });

/** tmux, RECORDING: `capture-pane` answers `$PANE_TEXT`, everything else is logged. */
const STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "\${1:-}" in capture-pane) printf '%s\\n' "\${PANE_TEXT:-}" ;; esac; return 0; };
  _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };`;
const sendKeys = (): string[] => h.calls().filter((l) => l.includes('send-keys'));
const READY = '? for shortcuts\n❯ ';
const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ ';

describe('_inject_spawn_effort stands down on an armed auto-continue (D-2229)', () => {
  it('types nothing into a session waiting out a limit', () => {
    h.sh(`${STUBS} _inject_spawn_effort cc-test`, { PANE_TEXT: ARMED });
    expect(sendKeys()).toEqual([]);
  });
  it('control: a ready pane gets /effort', () => {
    h.sh(`${STUBS} _inject_spawn_effort cc-test`, { PANE_TEXT: READY });
    expect(sendKeys().some((k) => k.includes('-l /effort'))).toBe(true);
  });
});

describe('_pane_auto_continue_armed', () => {
  it.each([
    ['continuing automatically at 11:50am', true],
    ['Usage limit reached · continuing shortly · esc to cancel', true],
    ['Usage limit reached · continuing automatically when it resets · esc to cancel', true],
    ["You've hit your session limit · resets 11:50am (UTC)", false],
    ['? for shortcuts', false],
  ])('%s -> %s', (pane, armed) => {
    const out = h.sh(`_pane_auto_continue_armed ${JSON.stringify(pane)} && echo yes || echo no`);
    expect(out).toBe(armed ? 'yes' : 'no');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-compact.test.ts test/ccd-redrive.test.ts`
Expected: FAIL — the armed compact tests see `/compact` typed and `reason()` ≠ `auto-continue`; `_pane_auto_continue_armed` is `command not found`; the effort test sees `/effort` typed.

- [ ] **Step 3: Implement the predicate and the two gates**

In `ccd/ccd`, directly after `_pane_hard_blocked` add:

```bash
_pane_auto_continue_armed() {   # pane text -> success iff Claude Code is waiting out a limit on its own (D-2229).
  # "Usage limit reached · continuing automatically at HH:MM · esc or type to cancel" (and its
  # "shortly"/"when it resets" variants) is Claude Code's OWN recovery, an in-memory timer that
  # ANY keystroke cancels. The rescue arm deliberately ignores it (a swap that re-drives beats
  # waiting, ruling R1); the three sites that TYPE into a pane — the compactor, the /effort
  # injection, and the fallback re-drive — must not.
  grep -qE "continuing automatically|continuing shortly" <<<"$1"
}
```

In `_auto_compact_check`, directly after the `pane-blank` line add:

```bash
  _pane_auto_continue_armed "$pane" && { _compact_note "$id" auto-continue "Claude Code is waiting out a limit on its own; a keystroke would cancel it (D-2229)"; return 0; }
```

In `_inject_spawn_effort`, directly after `local t="$1" cur` add:

```bash
  if _pane_auto_continue_armed "$(tmux capture-pane -t "$t" -p 2>/dev/null)"; then
    echo "ccd: auto-continue armed, skipped /effort $SPAWN_EFFORT (D-2229)" >&2; return 0
  fi
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-compact.test.ts test/ccd-redrive.test.ts test/ccd-login-screen.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check, then commit**

Delete the gate line in `_auto_compact_check`: the two armed compact tests FAIL. Restore. Delete the gate in `_inject_spawn_effort`: the effort test FAILS. Restore.

```bash
git add ccd/ccd server/test/ccd-auto-compact.test.ts server/test/ccd-redrive.test.ts
git commit -m "fix(ccd): no keystroke into a session that is waiting out a limit on its own (D-2229)"
```

---

### Task 3: The fallback re-drive, measured on the transcript (F2)

**Files:**
- Modify: `ccd/ccd` — constants near `SPAWN_EFFORT`; new `_transcript_stalled_pair` and `_redrive_after_spawn` directly after `_inject_spawn_effort`; one call in `_spawn_settle`
- Test: `server/test/ccd-redrive.test.ts` (extend)

**Interfaces:**
- Consumes: `RESUME_PROMPT` (Task 1), `_pane_auto_continue_armed` (Task 2), existing `_transcript_path id`, `_pane_box_draft`, `_pane_hard_blocked`.
- Produces: `_transcript_stalled_pair <path>` → 0 stalled / 1 not / 2 unreadable; `_redrive_after_spawn <id> <tmuxname>` → always 0; swap.log verbs `redrive` and `redrive-skip`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-redrive.test.ts`:

```ts
// — the fallback re-drive (D-2231, D-2237) —
const ID = 'myid';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const seed = (): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} workdir "$HOME/projects/demo"
        _reg_set ${ID} uuid ${UUID}`);
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
};
/** Compact JSONL, the shape Claude Code writes (no spaces after colons). */
const L = {
  metaPrompt: (text = 'Continue from where you left off.') => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] }, isMeta: true, uuid: 'm1', timestamp: '2026-09-09T11:25:31.906Z',
  }),
  synthetic: () => JSON.stringify({
    parentUuid: 'm1', isSidechain: false, type: 'assistant', uuid: 'a1', timestamp: '2026-09-09T11:25:31.906Z',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] },
  }),
  realAssistant: () => JSON.stringify({
    parentUuid: 'm1', isSidechain: false, type: 'assistant', uuid: 'a2', timestamp: '2026-09-09T11:25:40.000Z',
    message: { model: 'claude-fable-5-1', role: 'assistant', content: [{ type: 'text', text: 'Resuming the workflow.' }] },
  }),
  humanPrompt: () => JSON.stringify({
    parentUuid: 'a1', isSidechain: false, type: 'user', uuid: 'u9', timestamp: '2026-09-09T11:52:45.000Z',
    message: { role: 'user', content: 'resume' },
  }),
  caveat: () => JSON.stringify({ type: 'user', isMeta: true, uuid: 'c1', timestamp: 't', message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' } }),
  command: () => JSON.stringify({ type: 'user', uuid: 'c2', timestamp: 't', message: { role: 'user', content: '<command-name>/effort</command-name><command-args>ultracode</command-args>' } }),
  stdout: () => JSON.stringify({ type: 'user', uuid: 'c3', timestamp: 't', message: { role: 'user', content: '<local-command-stdout>Set effort level to ultracode</local-command-stdout>' } }),
  system: () => JSON.stringify({ type: 'system', uuid: 's1', timestamp: 't', content: 'Remote Control disconnected' }),
  attachment: () => JSON.stringify({ type: 'attachment', uuid: 'at1', timestamp: 't', attachment: { type: 'x' } }),
  banner: () => JSON.stringify({ type: 'assistant', uuid: 'b1', isApiErrorMessage: true, error: 'rate_limit', timestamp: 't', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 11:50am (UTC)" }] } }),
};
const writeTranscript = (lines: string[]): string => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const redrive = (env: Record<string, string> = {}): string[] => {
  h.sh(`${STUBS} _redrive_after_spawn ${ID} cc-test`, { PANE_TEXT: READY, ...env });
  return sendKeys();
};
const typedPrompt = (keys: string[]): boolean =>
  keys.some((k) => k.startsWith('tmux send-keys -t cc-test -l Continue from where you left off.'))
  && keys.some((k) => k === 'tmux send-keys -t cc-test Enter');

describe('_transcript_stalled_pair', () => {
  const rc = (lines: string[]): number => {
    const p = writeTranscript(lines);
    return Number(h.sh(`_transcript_stalled_pair '${p}'; echo "rc=$?"`).match(/rc=(\d)/)![1]);
  };
  beforeEach(seed);
  it('the pair at the tail is a stall', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.synthetic()])).toBe(0);
  });
  it('local-command chatter, system lines and attachments after the pair do not un-stall it', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.synthetic(), L.attachment(), L.caveat(), L.command(), L.stdout(), L.system()])).toBe(0);
  });
  it('a real assistant entry after the pair means the flag drove it', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.synthetic(), L.realAssistant()])).toBe(1);
  });
  it('a submitted prompt (META, then a real reply) is not a stall', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.realAssistant()])).toBe(1);
  });
  it('a human prompt after the pair means a person handled it', () => {
    expect(rc([L.banner(), L.metaPrompt(), L.synthetic(), L.humanPrompt()])).toBe(1);
  });
  it('a prompt that is not META is a human, not the harness', () => {
    const notMeta = L.metaPrompt().replace('"isMeta":true', '"isMeta":false');
    expect(rc([L.banner(), notMeta, L.synthetic()])).toBe(1);
  });
  it('an unreadable path is 2, not 1', () => {
    expect(Number(h.sh(`_transcript_stalled_pair "$HOME/nope.jsonl"; echo "rc=$?"`).match(/rc=(\d)/)![1])).toBe(2);
  });
});

describe('_redrive_after_spawn', () => {
  beforeEach(seed);
  it('types the prompt when the tail is the unsubmitted pair, and logs redrive', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    expect(typedPrompt(redrive())).toBe(true);
    expect(swapLog()).toMatch(/ redrive myid: /);
  });
  it('types nothing when the flag drove the turn', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.realAssistant()]);
    expect(redrive()).toEqual([]);
    expect(swapLog()).toBe('');
  });
  it('types nothing while a turn is running (the pane says esc to interrupt)', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    expect(redrive({ PANE_TEXT: 'thinking… esc to interrupt' })).toEqual([]);
  });
  it('types nothing into an armed auto-continue, and says so', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    expect(redrive({ PANE_TEXT: ARMED })).toEqual([]);
    expect(swapLog()).toMatch(/ redrive-skip myid: auto-continue armed/);
  });
  it('types nothing over a draft in the box, and says so', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    expect(redrive({ BOX_DRAFT: 'half-typed' })).toEqual([]);
    expect(swapLog()).toMatch(/ redrive-skip myid: input box not empty/);
  });
  it('types nothing when there is no transcript', () => {
    expect(redrive()).toEqual([]);
    expect(swapLog()).toBe('');
  });
});

describe('_spawn_settle calls the re-drive after the effort injection (the wiring)', () => {
  beforeEach(seed);
  const SETTLE = `${STUBS}
    _accept_first_run_prompts() { return \${ACCEPT_RC:-0}; };
    _inject_spawn_effort() { echo "effort $1" >> "$HOME/ccd-calls"; };
    _lc_done() { :; };`;
  it('on a clean landing the re-drive runs, after /effort', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    h.sh(`${SETTLE} _spawn_settle ${ID} 1`, { PANE_TEXT: READY });
    const calls = h.calls();
    // The target here is `_tmux myid`, not `cc-test` — match on the typed text alone.
    expect(calls.findIndex((c) => c.startsWith('effort '))).toBeLessThan(calls.findIndex((c) => c.includes('-l Continue from where')));
    expect(sendKeys().some((k) => k.includes('-l Continue from where you left off.'))).toBe(true);
    expect(sendKeys().some((k) => k.endsWith(' Enter'))).toBe(true);
  });
  it('a landing that is not clean (rc 5, hard-blocked) is not re-driven', () => {
    writeTranscript([L.banner(), L.metaPrompt(), L.synthetic()]);
    h.sh(`${SETTLE} _spawn_settle ${ID} 1; :`, { PANE_TEXT: READY, ACCEPT_RC: '5' });
    expect(sendKeys()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-redrive.test.ts`
Expected: FAIL — `_transcript_stalled_pair: command not found`, `_redrive_after_spawn: command not found`, wiring test sees no keys.

- [ ] **Step 3: Implement the detector, the re-drive, and the wiring**

In `ccd/ccd`, after the `RESUME_REDRIVE_MAX_AGE_MS=""` line (Task 1) add:

```bash
REDRIVE_WAIT_S=20               # D-2231 — seconds _redrive_after_spawn gives Claude Code's own re-drive before typing one
REDRIVE_TAIL_LINES=60           # transcript lines the stall detector reads; attachments and system rows between the pair and the tail are skipped, not counted
```

Directly after `_inject_spawn_effort` add:

```bash
_transcript_stalled_pair() {   # transcript-path -> 0 the newest real turn is the unsubmitted resume pair | 1 not | 2 unreadable (D-2231)
  # THE MEASUREMENT BEHIND THE FLAG. Claude Code's `--resume` writes a META user
  # "Continue from where you left off." and a synthetic "No response requested."
  # and, without CLAUDE_CODE_RESUME_INTERRUPTED_TURN, stops there. A tail whose
  # newest user/assistant rows are exactly that pair — local-command chatter,
  # system rows and attachments after it do not count — is a stall. Anything
  # else after the pair (a real reply, a human prompt) means someone drove it.
  # Only `"type":"user"`/`"type":"assistant"` rows are read; a false hit on that
  # substring inside quoted content can only break the pair, i.e. read "not
  # stalled" — the status quo, never a spurious keystroke.
  local f="$1" line state=0
  [[ -r "$f" ]] || return 2
  while IFS= read -r line; do
    [[ "$line" == *'"type":"user"'* || "$line" == *'"type":"assistant"'* ]] || continue
    if [[ "$line" == *'"isMeta":true'* && "$line" == *'Continue from where you left off.'* ]]; then state=1; continue; fi
    if [[ "$state" -eq 1 && "$line" == *'"model":"<synthetic>"'* && "$line" == *'No response requested.'* ]]; then state=2; continue; fi
    if [[ "$state" -eq 2 ]]; then
      case "$line" in *'<local-command-caveat>'*|*'<command-name>'*|*'<local-command-stdout>'*) continue ;; esac
    fi
    state=0
  done < <(tail -n "$REDRIVE_TAIL_LINES" "$f")
  [[ "$state" -eq 2 ]]
}

_redrive_after_spawn() {   # id tmuxname — D-2231: type the resume prompt when the flag wrote the pair and drove nothing.
  # Measured on the TRANSCRIPT, not on hookstate (D-2237): `working` proves tool
  # calls, not that the re-drive took. Gives Claude Code REDRIVE_WAIT_S seconds
  # first — a running turn ("esc to interrupt") or a real row after the pair ends
  # the wait — then stands down on an armed auto-continue, a hard-blocked pane
  # or a draft in the box, each with its own swap.log line.
  local id="$1" t="$2" f i rc pane cur
  f=$(_transcript_path "$id") || return 0
  for ((i = 0; i < REDRIVE_WAIT_S; i++)); do
    _transcript_stalled_pair "$f"; rc=$?
    [[ "$rc" -eq 0 ]] || return 0
    pane=$(tmux capture-pane -t "$t" -p 2>/dev/null)
    echo "$pane" | grep -q "esc to interrupt" && return 0
    sleep 1
  done
  pane=$(tmux capture-pane -t "$t" -p 2>/dev/null)
  _pane_auto_continue_armed "$pane" && { echo "$(date '+%F %T') redrive-skip $id: auto-continue armed" >> "$REG/swap.log"; return 0; }
  _pane_hard_blocked "$pane" && { echo "$(date '+%F %T') redrive-skip $id: hard-blocked pane" >> "$REG/swap.log"; return 0; }
  cur=$(_pane_box_draft "$(tmux capture-pane -t "$t" -p -e 2>/dev/null)")
  [[ -n "$cur" ]] && { echo "$(date '+%F %T') redrive-skip $id: input box not empty" >> "$REG/swap.log"; return 0; }
  echo "$(date '+%F %T') redrive $id: the transcript's newest turn is the unsubmitted resume pair after ${REDRIVE_WAIT_S}s; typing the prompt [wrapper=$(_reg_get "$id" wrapper)]" >> "$REG/swap.log"
  tmux send-keys -t "$t" -l "$RESUME_PROMPT"; sleep 1; tmux send-keys -t "$t" Enter
  return 0
}
```

In `_spawn_settle`, between the `_inject_spawn_effort` line and `return "$prompt_rc"` add:

```bash
  # D-2231 — after the effort injection, so its local-command chatter is already
  # in the tail the detector skips. Only on a clean landing: rc 5 is hard-blocked
  # (a keystroke there is the swap's job), rc 2 is a login screen.
  [[ "$prompt_rc" == 0 ]] && _redrive_after_spawn "$id" "$tname"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-redrive.test.ts test/ccd-login-screen.test.ts test/ccd-authdead.test.ts test/ccd-spawn-verdict.test.ts test/ccd-lifecycle-sites.test.ts`
Expected: PASS. If `ccd-lifecycle-sites.test.ts` reds on a new `_lc_done` site: this task adds NONE — investigate, do not add a meas key.

- [ ] **Step 5: Mutation check, then commit**

Delete the `_redrive_after_spawn` call in `_spawn_settle`: the wiring test FAILS. Restore. Change the detector's `state=2` line to never fire: every `_redrive_after_spawn` positive test FAILS. Restore.

```bash
git add ccd/ccd server/test/ccd-redrive.test.ts
git commit -m "feat(ccd): re-drive the interrupted turn a restart landed on, measured on the transcript (D-2231, D-2237)"
```

---

### Task 4: The parser tells the synthetic pair apart (F4, server)

**Files:**
- Modify: `shared/api.ts` — `ChatEvent`'s `system` member (~the `export type ChatEvent` block) plus three constants beside it
- Modify: `server/src/transcript/parse.ts`
- Test: `server/test/transcript-parse.test.ts` (add one describe)

**Interfaces:**
- Produces (L0, `shared/api.ts`): `export type SystemOrigin = 'resume-prompt' | 'no-response'`; `export const RESUME_PROMPT_PREFIX = 'Continue from where you left off.'`; `export const NO_RESPONSE_TEXT = 'No response requested.'`; `export const SYNTHETIC_MODEL = '<synthetic>'`; `system` member gains `origin?: SystemOrigin`. Task 5 reads `origin`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/transcript-parse.test.ts`:

```ts
describe('the harness resume pair is system, not a conversation (D-2228)', () => {
  const metaPrompt = JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'Continue from where you left off. Note: ccd restarted this session.' }] },
    isMeta: true, uuid: 'm1', timestamp: '2026-09-09T11:25:31.906Z',
  });
  const synthetic = JSON.stringify({
    parentUuid: 'm1', isSidechain: false, type: 'assistant', uuid: 'a1', timestamp: '2026-09-09T11:25:31.906Z',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] },
  });
  it('the META resume prompt is a system event with origin resume-prompt, text the prefix only', () => {
    expect(parseTranscriptLine(metaPrompt)).toEqual([
      { kind: 'system', uuid: 'm1', ts: '2026-09-09T11:25:31.906Z', text: 'Continue from where you left off.', origin: 'resume-prompt' },
    ]);
  });
  it('the synthetic No response requested. is a system event with origin no-response', () => {
    expect(parseTranscriptLine(synthetic)).toEqual([
      { kind: 'system', uuid: 'a1', ts: '2026-09-09T11:25:31.906Z', text: 'No response requested.', origin: 'no-response' },
    ]);
  });
  it('a META user message with other content is still a user event (unchanged)', () => {
    const other = metaPrompt.replace('Continue from where you left off. Note: ccd restarted this session.', '# Workflow authoring reference');
    expect(parseTranscriptLine(other).map((e) => e.kind)).toEqual(['user']);
  });
  it('a real model saying the same words is still an assistant event (unchanged)', () => {
    const real = synthetic.replace('"model":"<synthetic>"', '"model":"claude-fable-5-1"');
    expect(parseTranscriptLine(real).map((e) => e.kind)).toEqual(['assistant']);
  });
  it('a human typing the sentence is a user event — isMeta decides, not the words', () => {
    const human = metaPrompt.replace('"isMeta":true', '"isMeta":false');
    expect(parseTranscriptLine(human).map((e) => e.kind)).toEqual(['user']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/transcript-parse.test.ts`
Expected: FAIL — the first two tests get `kind: 'user'` / `kind: 'assistant'` and no `origin`.

- [ ] **Step 3: Add the L0 vocabulary and the two mappings**

In `shared/api.ts`, directly above `export type ChatEvent =`:

```ts
/** D-2228 — WHO WROTE A `system` ROW. Claude Code's `--resume` writes a META
 *  user "Continue from where you left off." and pads it with a synthetic
 *  assistant "No response requested." (`message.model === '<synthetic>'`);
 *  without CLAUDE_CODE_RESUME_INTERRUPTED_TURN it submits nothing. Rendered as
 *  a user bubble and a reply, that stall read as "someone sent resume and it
 *  was ignored" (the 2026-09-09 clip). Additive, optional: an older reader
 *  ignores it, an older writer omits it. */
export type SystemOrigin = 'resume-prompt' | 'no-response';
/** The sentence Claude Code's default resume prompt is, and every variant —
 *  including ccd's RESUME_PROMPT — begins with. The parser matches the prefix. */
export const RESUME_PROMPT_PREFIX = 'Continue from where you left off.';
export const NO_RESPONSE_TEXT = 'No response requested.';
export const SYNTHETIC_MODEL = '<synthetic>';
```

and change the `system` member to:

```ts
  | { kind: 'system'; uuid: string; ts: string; text: string; origin?: SystemOrigin };
```

In `server/src/transcript/parse.ts`, change the import to:

```ts
import { NO_RESPONSE_TEXT, RESUME_PROMPT_PREFIX, SYNTHETIC_MODEL, type ChatEvent } from '../../../shared/api.js';
```

extend the `env` shape with `isMeta?: unknown;` and `message?: { content?: unknown; model?: unknown } | null;`, and add, as the FIRST thing inside `if (env.type === 'user') {`:

```ts
    // D-2228: the harness's own resume prompt — META, never a human. The prefix
    // is the sentence Claude Code's default is; ccd's longer prompt starts with it.
    if (env.isMeta === true && flattenContent(content).trim().startsWith(RESUME_PROMPT_PREFIX)) {
      return [{ kind: 'system', uuid, ts, text: RESUME_PROMPT_PREFIX, origin: 'resume-prompt' }];
    }
```

and, directly after the `if (env.type === 'user') { ... return out; }` block (i.e. before the assistant `if (Array.isArray(content))`):

```ts
  // D-2228: the padding Claude Code writes after an unsubmitted resume prompt.
  // The MODEL decides — a real model saying these words is a reply.
  if (env.message?.model === SYNTHETIC_MODEL && flattenContent(content).trim() === NO_RESPONSE_TEXT) {
    return [{ kind: 'system', uuid, ts, text: NO_RESPONSE_TEXT, origin: 'no-response' }];
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/transcript-parse.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts`
Expected: PASS (`single-definition` must stay green: none of its scans name these strings — if one reds, the new constant collided with an enumeration it pins; report a placeholder deviation for the operator to mint (single-definition collision), do not weaken the scan).

- [ ] **Step 5: Mutation check, then commit**

Delete the `env.isMeta === true` branch: test 1 FAILS. Delete the `SYNTHETIC_MODEL` branch: test 2 FAILS. Restore both.

```bash
git add shared/api.ts server/src/transcript/parse.ts server/test/transcript-parse.test.ts
git commit -m "feat(server): the resume pair is system, not conversation — origin on the wire (D-2228)"
```

---

### Task 5: The bubble words the stall (F4, PWA)

**Files:**
- Modify: `pwa/src/session/MessageBubble.tsx` — the `event.kind === 'system'` branch (~line 298)
- Modify: `pwa/src/session/chat.css` — two modifier classes after `.sys-divider` (~line 807)
- Test: `pwa/test/chat.test.tsx` (add one describe)

**Interfaces:**
- Consumes: `ChatEvent`'s `system.origin` (Task 4).

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/chat.test.tsx`, inside the file (it already imports `render`, `screen`, `cleanup`, `ChatListInner`, `ChatEvent`; use the file's `afterEach(cleanup)`):

```ts
describe('a restart that landed idle reads as a stall, not a conversation (D-2228)', () => {
  const sys = (uuid: string, text: string, origin?: 'resume-prompt' | 'no-response'): ChatEvent =>
    ({ kind: 'system', uuid, ts: '2026-09-09T11:25:31.906Z', text, ...(origin ? { origin } : {}) });
  it('the pair renders as two system lines, the second naming the stall — and no user bubble', () => {
    const { container } = render(
      <ChatListInner
        id="s"
        events={[sys('m1', 'Continue from where you left off.', 'resume-prompt'), sys('a1', 'No response requested.', 'no-response')]}
        pending={[]}
      />,
    );
    expect(screen.getByText(/restart · resume prompt/)).toBeTruthy();
    expect(screen.getByText(/interrupted turn not re-driven/)).toBeTruthy();
    expect(container.querySelector('.msg-user')).toBeNull();
    expect(container.querySelector('.msg-assist')).toBeNull();
    expect(container.querySelector('.sys-divider--stalled')).not.toBeNull();
  });
  it('a plain system line (no origin) still renders its own text', () => {
    render(<ChatListInner id="s" events={[sys('u3', '/clear')]} pending={[]} />);
    expect(screen.getByText('/clear')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pwa && ./node_modules/.bin/vitest run test/chat.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /restart · resume prompt/`.

- [ ] **Step 3: Word the two origins**

In `pwa/src/session/MessageBubble.tsx`, replace the `system` branch with:

```tsx
  if (event.kind === 'system') {
    // D-2228: the harness's resume pair. The prompt line is neutral (whether it
    // was submitted is what the NEXT row says); the padding line IS the stall —
    // it exists only when Claude Code wrote the prompt and drove nothing.
    if (event.origin === 'resume-prompt') {
      return <p className="sys-divider sys-divider--restart">restart · resume prompt</p>;
    }
    if (event.origin === 'no-response') {
      return (
        <p className="sys-divider sys-divider--stalled">
          restart · interrupted turn not re-driven — send a message to resume
        </p>
      );
    }
    return <p className="sys-divider">{event.text}</p>;
  }
```

In `pwa/src/session/chat.css`, directly after the `.sys-divider { ... }` block:

```css
/* D-2228 — the harness's resume pair: the prompt line is neutral, the padding
   line is a stall and wears the warning ink so an idle landing is visible. */
.sys-divider--restart { color: var(--ink-secondary); }
.sys-divider--stalled { color: var(--ink-warning, var(--ink-primary)); border-color: var(--edge-warning, var(--edge-subtle)); }
```

(If `--ink-warning`/`--edge-warning` do not exist in `pwa/src/tokens.css` or the theme file, the fallbacks keep it legible; check `grep -rn "ink-warning\|edge-warning" pwa/src/*.css` and use the tree's actual warning tokens if they are named differently.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pwa && ./node_modules/.bin/vitest run test/chat.test.tsx && npx tsc --noEmit -p .`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Mutation check, then commit**

Remove the `origin === 'no-response'` branch: test 1 FAILS on the stall text. Restore.

```bash
git add pwa/src/session/MessageBubble.tsx pwa/src/session/chat.css pwa/test/chat.test.tsx
git commit -m "feat(pwa): an idle landing after a restart reads as a stall (D-2228)"
```

---

### Task 6: README section and the plan's deviation anchors

**Files:**
- Modify: `README.md` — new subsection after "### Login screens get no keystrokes, and lost auth joins the rescue lane" (~line 889)
- Modify: this plan — tick the checkboxes; the `## Deviations found` section below is already complete.

- [x] **Step 1: Add the README subsection**

Insert after the login-screens subsection:

```markdown
### A restart re-drives the turn it interrupted (D-2226)

A usage-limit rescue is a `ccd swap`: the unit stops, the transcript is carried, the destination
runs `<wrapper> --resume '<uuid>'`. Claude Code's own recovery for a limit — "Usage limit reached ·
continuing automatically at HH:MM" — is an in-memory timer and dies with the old process. On the
resume, Claude Code writes a META "Continue from where you left off." and a synthetic "No response
requested." and submits the prompt **only** when `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` is set.
Before 2026-09-09 ccd never set it, so every rescue landed idle until a human typed (spec
`docs/superpowers/specs/2026-09-09-post-swap-redrive-design.md`, four of four sessions measured).

Now, on every spawn, `_spawn_start` exports that flag plus a ccd-authored `CLAUDE_CODE_RESUME_PROMPT`
(`RESUME_PROMPT`, telling the model its previous process and every background task it owned are
gone). Because the flag is a third-party default, `_spawn_settle` **measures** the landing:
`_transcript_stalled_pair` reads the transcript tail, and if the newest real turn is still that
unsubmitted pair after `REDRIVE_WAIT_S`, `_redrive_after_spawn` types the prompt itself and writes
`redrive <id>: …` to `swap.log` (`redrive-skip` when the box holds a draft, the pane is
hard-blocked, or an auto-continue is armed). Hookstate is not the measurement: `working` proves tool
calls, not that the re-drive took.

The one thing ccd must never do is cancel Claude Code's armed auto-continue with a keystroke.
`_pane_auto_continue_armed` ("continuing automatically" / "continuing shortly") gates the compactor
(`compact-skip <id>: auto-continue`), the `/effort` injection, and the fallback re-drive. The rescue
arm is deliberately **not** gated: a swap that re-drives beats waiting out the window. On the PWA the
pair renders as two system lines, the second reading "interrupted turn not re-driven — send a
message to resume"; the server parser keys on the structural markers — `isMeta` for the prompt
line, `message.model === '<synthetic>'` for the padding — each narrowed by the exact sentence
(`RESUME_PROMPT_PREFIX` / `NO_RESPONSE_TEXT`, `shared/api.ts`); ccd's `RESUME_PROMPT` must keep
starting with that prefix, and nothing scans for it.
```

- [x] **Step 2: Commit**

```bash
git add README.md docs/superpowers/plans/2026-09-09-post-swap-redrive.md
git commit -m "docs: a restart re-drives the turn it interrupted (D-2226)"
```

---

### Task 7: Whole-branch verification and the PR

- [ ] **Step 1: Run the three suites in the foreground**

```bash
cd server && npm run test 2>&1 | tail -30
cd ../pwa && npm run test 2>&1 | tail -15
cd ../agent && npm run test 2>&1 | tail -15
```

Expected: all green. Known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) are re-run IN ISOLATION before being called a break.

- [ ] **Step 2: The deviation collision test against origin/main**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: PASS — D-2226..D-2237 are allocator-issued and defined in exactly this plan.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin ws/brisk-meadow
gh pr create --base main --title "feat(ccd,server,pwa): a restart re-drives the turn it interrupted (D-2226–D-2237)" --body-file - <<'EOF'
...(summary of the spec's §1–§3, the four fixes, and the D-range; deploy note: AGENT-FIRST, operator's step)...
EOF
```

**Deploy is the operator's step after merge**, agent lane first: `bash deploy/deploy.sh agent <host>` then `bash deploy/deploy.sh`.

---

## Deviations found

Numbers ISSUED by `POST /api/ledger/deviations` on 2026-09-09 (block 2226–2237, floor now 2238), defined here.

- **D-2226** — *The swap's contract was "conversation intact", never "turn re-driven".* Every ccd restart of a session whose turn died in a limit (rescue swap, affinity swap, supervisor revival) lands idle at a prompt. Measured 2026-09-09: four rescues, four stalls, three typed "resume" messages and one incidental mail nudge. Fixed by D-2227 + D-2231.
- **D-2227** — *Claude Code's interrupted-turn resume is env-gated and ccd never set it.* `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` (value `"1"`) makes `--resume` submit the synthetic "Continue from where you left off."; the origin predicate `dy` accepts a message with no origin, so a plain ccd `--resume` qualifies. `_spawn_start` now exports it, with a ccd-authored `CLAUDE_CODE_RESUME_PROMPT`, on both spawn lines (Task 1).
- **D-2228** — *The PWA rendered the stall as a conversation.* `parse.ts` read neither `isMeta` nor `message.model`, so the META prompt was a user bubble and the synthetic padding an assistant reply — the clip that opened this work. Now `system` events with an additive `origin` (`resume-prompt` | `no-response`), worded by the bubble (Tasks 4–5). Wire: additive, absence-permits, no `FLEET_PROTO` bump.
- **D-2229** — *ccd's own keystrokes cancel Claude Code's armed auto-continue.* "Usage limit reached · continuing automatically at HH:MM · esc or type to cancel" is an in-memory timer; `/effort` at spawn and `/compact` from the compactor both count as "type". `_pane_auto_continue_armed` now gates `_auto_compact_check` (`compact-skip … auto-continue`), `_inject_spawn_effort`, and `_redrive_after_spawn` (Task 2).
- **D-2230** — *Ruling: no age cap on the re-drive.* `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` stays unset (`RESUME_REDRIVE_MAX_AGE_MS=""`); a revival after a box outage is exactly the case that should continue on its own, and the prompt tells the model to re-verify time-sensitive state. A `ws-restore` of an old interrupted session re-drives too; restore is human-only and Esc stops it.
- **D-2231** — *A third-party flag ships with a measurement and a fallback.* `_transcript_stalled_pair` reads the transcript tail; if the newest real turn is still the unsubmitted pair after `REDRIVE_WAIT_S`, `_redrive_after_spawn` types `RESUME_PROMPT` and logs `redrive`; it stands down (logged `redrive-skip`) on a running turn, an armed auto-continue, a hard-blocked pane or a draft in the box (Task 3).
- **D-2232** — *The affinity arm bounced the stalled session home at the reset instant.* `_limit_field` returns `""` at `fiveResetAt`, `_avail home` succeeds, and a session idle because it stalled passes the idle gate: two restarts, two transcript copies, zero turns on the rescue account. No code change: a re-driven session is mid-turn and the mid-turn gate defers it. Recorded.
- **D-2233** — *"Your usage limit has reset · press enter to continue" is a second manual-only state.* Claude Code's `stale` phase after a cancelled auto-continue. D-2229 stops ccd from causing it; nothing here answers it. Follow-up.
- **D-2234** — *The limit banner's structured fields are read by nobody.* The assistant row carries `isApiErrorMessage:true, error:"rate_limit", apiErrorStatus:429, quotaLimits.resetsAt`; ccd's detector is still a pane grep and the server parser still renders the banner as an assistant bubble. Follow-up: transcript-based limit detection and a "limit · resets HH:MM" system line.
- **D-2235** — *The server's mail nudge is the one un-gated keystroke site left.* `watch.ts`'s `sendPrompt(renderMailNudge)` types into a pane without reading it and can cancel an armed auto-continue on a stranded session. Not fixed here (it needs an agent frame for the pane); follow-up.
- **D-2236** — *Ruling: the rescue arm is not gated on the armed line.* Rescue-plus-re-drive continues within about two minutes on an account with headroom; waiting costs up to five hours. `_auto_swap_check`'s hard-blocked branch is untouched.
- **D-2237** — *The landing is measured on the transcript, not on hookstate.* `working` in hookstate proves tool calls, not that the re-drive took; `_redrive_after_spawn` reads the transcript tail and the pane, never `hookstate.json`.

Also recorded without a number of their own (covered by D-2227/D-2228): the resume sentence is spelled once in `shared/api.ts` (`RESUME_PROMPT_PREFIX`, the reader's definition) and once inside ccd's `RESUME_PROMPT` (bash cannot import TS; the sentence is Claude Code's own default text, not a ccrc enumeration), and `single-definition.test.ts` does not scan for it. The whole-branch review found that coupling held as FOUR independent literals with the pinning test hardcoding a fifth; the fix wave makes `ccd-resume-flag.test.ts` import `RESUME_PROMPT_PREFIX` and read the detector's literal from ccd source, so editing any one copy reds the suite.

### Found during execution (issued 2026-09-09, block 2262–2265, floor now 2266)

- **D-2262** — *`ccd-spawn-split.test.ts`'s byte-exact `expectedCommand` did not carry `$resenv`.* Task 1's Step 4 promised that suite stays green; four of its tests assert the composed spawn command byte-for-byte and reddened the moment the env prefix landed. Fixed in `fd62f20b` (commit subject carried a provisional placeholder slug, since replaced by this number): the reference string is composed by asking the real ccd for `_resume_env`, one definition read twice, never a second copy of the 430-character prompt.
- **D-2263** — *The re-drive could type into a turn that started during its own wait.* `_redrive_after_spawn`'s loop measured the stall and the pane, then slept; a turn Claude Code started in that last second would have received the prompt. Fixed in `48c434fa` (commit subject carried a provisional placeholder slug, since replaced by this number): after the wait, the stall and the pane are re-measured once more before any keystroke, with a test whose fake pane flips to `esc to interrupt` only on the 21st capture.
- **D-2264** — *The two new pane-reading sites read a full ~50-row capture where every established site narrows to `tail -8`.* A `--resume` landing replays the interrupted turn's own API-error row into the scrollback, which matches `_pane_hard_blocked`, so the fallback would stand down as `hard-blocked pane` on exactly the sessions it exists for. Fix wave (commit subject carried a provisional placeholder slug, since replaced by this number): the three predicate reads take `| tail -8`, only `_pane_box_draft` keeps the full `-e` capture, and a fixture with a stale banner 12 rows above the prompt pins it.
- **D-2265** — *The fallback's own stand-down was silent.* Both non-zero paths of the wait loop (rc 1 not-stalled, rc 2 unreadable transcript) returned without a swap.log line, so the one lane built to catch the flag failing had no evidence when it itself measured too early. Fix wave (commit subject carried a provisional placeholder slug, since replaced by this number): `_spawn_settle` threads `fromswap` into `_redrive_after_spawn`, and on a swap landing the stand-down is logged as `redrive-skip <id>: not-stalled` or `redrive-skip <id>: no transcript at <path>`; an ordinary new spawn (no pair ever written) stays silent.
