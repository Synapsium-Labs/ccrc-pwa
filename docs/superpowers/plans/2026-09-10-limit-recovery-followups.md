# Limit recovery follow-ups — stale Enter, a structural limit detector, an armed-nudge hold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the three follow-ups the post-swap re-drive left recorded — D-2233 (the stale
`press enter to continue` phase), D-2234 (the limit banner's structured fields unread) and
D-2235 (the mail nudge un-gated on an armed auto-continue) — plus D-2347 (a read-by-name in the
transcript reader), each with a test that reds when its guard is deleted.

**Spec:** `docs/superpowers/specs/2026-09-10-limit-recovery-followups-design.md` (rulings R6–R12).
**Parent:** `docs/superpowers/plans/2026-09-09-post-swap-redrive.md` (PR #73, `e227329e`).

**Architecture:** four seams, one per ruling group.
- `ccd/ccd` — `_transcript_limit_banner` (structural, `"error":"rate_limit"`),
  `_session_hard_blocked` (pane OR transcript, draft-guarded) wired into `_auto_swap_check` and
  `_tick_strand_undecidable`; `_pane_limit_stale` + `_auto_stale_check` on the supervise tick;
  both transcript readers test `-f && -r`.
- `shared/api.ts` — `SystemOrigin` gains `'limit'`, the system member gains `resetsAt?`,
  `RATE_LIMIT_ERROR` is the one TS copy of the literal.
- `server/src/transcript/parse.ts` — the banner row becomes a `system` event.
- `server/src/pane/dialog.ts`, `server/src/inject/send.ts`, `server/src/watch.ts` —
  `autoContinueArmed`, the opt-in `auto-continue-armed` refusal, the sweep's five-minute hold.
- `pwa/src/session/MessageBubble.tsx`, `chat.css`, `pwa/src/lib/clock.ts` — the limit divider.

**Tech stack:** bash 5 (`ccd`), TypeScript/vitest (server, pwa), React (pwa). Every ccd test runs
under `makeCcdHarness` — a FIXTURE HOME, never the live one. Single suite:
`cd server && ./node_modules/.bin/vitest run test/<file>.test.ts` (never bare `npx vitest`),
foreground, timeout ≥ 600000 ms.

**Discipline that shapes every task:**
- TDD, red first. Each guard's test is run RED (guard deleted or mutated, restored with the
  editor — never `git checkout --`, never `git stash`) and then GREEN, and the plan's mutation
  table is what the reviewer checks.
- Deviation numbers D-2360..D-2374 were ISSUED by the allocator on 2026-09-10 and are DEFINED in
  `## Deviations found` below. A deviation found during execution is reported to the
  orchestrator, who mints it; nobody looks a number up and nobody writes a placeholder token.
- `ccd/ccd` carries a provenance marker (`# ccrc:generated 1 sha256=…`, line 2). It is re-stamped
  ONCE, in Task 7, after the last ccd edit; `ownership.test.ts` is red between the first ccd
  edit and that re-stamp, and that red is expected — do not re-stamp per task.
- `ccd-pane-box-draft.test.ts` pins the number of `_pane_box_draft` call sites and that each
  passes a `-e` capture. Tasks 2 and 3 each add one site: the pin moves 3 -> 5 in Task 3.

## Design decisions (settled before Task 1 — implementers do not re-litigate these)

1. **The stale press is Enter, gated on the exact sentence** (`usage limit has reset` … `press
   enter to continue`, case-insensitive, `tail -8`), a visible `❯`, no `esc to interrupt`, an
   empty box, and a per-session cooldown. A changed sentence fails closed. (R6)
2. **The transcript detector is structural** — `"isApiErrorMessage":true` + `"error":"rate_limit"`
   on the newest real row — and never reads the banner's text. The pane regex is NOT widened
   (R8, D-2364).
3. **The union is pane-first and draft-guarded.** `_session_hard_blocked` returns the pane's
   verdict unchanged when the pane matches; the transcript arm runs only on a pane without a
   running turn and stands down on a non-empty input box. (R7)
4. **`resetsAt` rides the wire in epoch SECONDS**, exactly as Claude Code writes it; the PWA
   converts. (R9)
5. **The hold is opt-in at `sendPrompt`** (`holdIfAutoContinueArmed`); only `sweepMail` opts in.
   The hold is `MAIL_ARMED_HOLD_MS = 300_000`, counts no attempt, tells the sender once. (R10)
6. **Both transcript readers pair `-f` with `-r`.** (R11, D-2370)

---

## Task 1: ccd — `_transcript_limit_banner`, the paired read guard, and the shared literal (D-2362, D-2370)

**Files:** `ccd/ccd` (after `_transcript_stalled_pair`), `shared/api.ts`,
`server/test/ccd-limit-banner.test.ts` (new).

- [x] **Step 1 — the shared literal.** In `shared/api.ts`, directly after `SYNTHETIC_MODEL`:

```ts
/** The `error` Claude Code writes on the assistant row it appends for a 429
 *  (`isApiErrorMessage:true, apiErrorStatus:429, quotaLimits:{resetsAt,…}`;
 *  measured 2026-09-10). ccd's `_transcript_limit_banner` holds the same
 *  literal in bash — it cannot import this — and `ccd-limit-banner.test.ts`
 *  reads that line from source and fails on drift (D-2362). */
export const RATE_LIMIT_ERROR = 'rate_limit';
```

- [x] **Step 2 — the failing tests.** Create `server/test/ccd-limit-banner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { RATE_LIMIT_ERROR } from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-limit-banner-'); });
afterEach(() => { h.cleanup(); });

const ID = 'myid';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const seed = (): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} home claude
        _reg_set ${ID} project demo
        _reg_set ${ID} workdir "$HOME/projects/demo"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
};
/** Compact JSONL, the shape Claude Code writes. `banner` is the real row from
 *  expoAI-assistant-swift-meadow at 2026-09-10T10:12:21Z, field for field. */
const L = {
  banner: (over: Record<string, unknown> = {}) => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: 'b1', timestamp: '2026-09-10T10:12:21.199Z',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your weekly limit · resets Sep 15, 12am (UTC)" }] },
    isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
    quotaLimits: { status: 'rejected', resetsAt: 1789430400, rateLimitType: 'seven_day', overageStatus: 'rejected' },
    ...over,
  }),
  metaPrompt: () => JSON.stringify({ type: 'user', isMeta: true, uuid: 'm1', timestamp: 't', message: { role: 'user', content: [{ type: 'text', text: 'Continue from where you left off. Note: ccd restarted this session.' }] } }),
  assistant: (text = 'Working on it.') => JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: 't', message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text }] } }),
  human: (text = 'resume') => JSON.stringify({ type: 'user', uuid: 'u1', timestamp: 't', message: { role: 'user', content: text } }),
  caveat: () => JSON.stringify({ type: 'user', isMeta: true, uuid: 'c1', timestamp: 't', message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' } }),
  command: () => JSON.stringify({ type: 'user', uuid: 'c2', timestamp: 't', message: { role: 'user', content: '<command-name>/effort</command-name><command-args>ultracode</command-args>' } }),
  stdout: () => JSON.stringify({ type: 'user', uuid: 'c3', timestamp: 't', message: { role: 'user', content: '<local-command-stdout>Set effort level to ultracode</local-command-stdout>' } }),
  system: () => JSON.stringify({ type: 'system', uuid: 's1', timestamp: 't', content: 'Remote Control disconnected' }),
};
const writeTranscript = (lines: string[]): string => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};
/** rc and stdout of the detector, in one shell so `$?` is the function's own. */
const detect = (p: string): { rc: string; out: string } => {
  const raw = h.sh(`out=$(_transcript_limit_banner ${JSON.stringify(p)}); rc=$?; printf '%s|%s' "$rc" "$out"`);
  const i = raw.indexOf('|');
  return { rc: raw.slice(0, i), out: raw.slice(i + 1) };
};
/** The same function run under `timeout` in a child bash that inherits only
 *  the function's text — the only way to prove a read does NOT block. */
const detectTimed = (fn: string, p: string): string =>
  h.sh(`timeout 5 bash -c "$(declare -f ${fn}); REDRIVE_TAIL_LINES=$REDRIVE_TAIL_LINES; ${fn} \\"\\$1\\"" _ ${JSON.stringify(p)} >/dev/null 2>&1; echo "rc=$?"`);

describe('_transcript_limit_banner (D-2362)', () => {
  it('the newest real row is the banner: rc 0, prints resetsAt and rateLimitType', () => {
    seed(); const p = writeTranscript([L.human(), L.assistant(), L.banner()]);
    expect(detect(p)).toEqual({ rc: '0', out: '1789430400\tseven_day' });
  });
  it('local-command chatter after the banner is not a turn: still rc 0', () => {
    seed(); const p = writeTranscript([L.banner(), L.caveat(), L.command(), L.stdout(), L.system()]);
    expect(detect(p).rc).toBe('0');
  });
  it('a META resume prompt after the banner means the landing was re-driven: rc 1', () => {
    seed(); const p = writeTranscript([L.banner(), L.metaPrompt()]);
    expect(detect(p).rc).toBe('1');
  });
  it('a real assistant turn after the banner: rc 1', () => {
    seed(); const p = writeTranscript([L.banner(), L.assistant()]);
    expect(detect(p).rc).toBe('1');
  });
  it('a human message after the banner: rc 1', () => {
    seed(); const p = writeTranscript([L.banner(), L.human()]);
    expect(detect(p).rc).toBe('1');
  });
  it('an API error that is not a rate limit is not a limit: rc 1 — the field decides, not the shape', () => {
    seed(); const p = writeTranscript([L.banner({ error: 'overloaded', quotaLimits: undefined })]);
    expect(detect(p).rc).toBe('1');
  });
  it("the banner's TEXT on an ordinary assistant row is not a limit: rc 1 — text is never the detector", () => {
    seed(); const p = writeTranscript([L.assistant("You've hit your weekly limit · resets Sep 15, 12am (UTC)")]);
    expect(detect(p).rc).toBe('1');
  });
  it('a banner without quotaLimits still detects, printing empty fields', () => {
    seed(); const p = writeTranscript([L.banner({ quotaLimits: undefined })]);
    expect(detect(p)).toEqual({ rc: '0', out: '\t' });
  });
  it('no transcript: rc 2', () => {
    seed(); expect(detect(path.join(h.home, 'nope.jsonl')).rc).toBe('2');
  });
  it('a directory at the path: rc 2 — `-f` is what refuses it (D-2370)', () => {
    seed(); const d = path.join(h.home, 'dir.jsonl'); fs.mkdirSync(d);
    expect(detect(d).rc).toBe('2');
  });
  it('a FIFO at the path: rc 2 without blocking — `-r` alone would open it and wait for ever (D-2370)', () => {
    seed(); const f = path.join(h.home, 'fifo.jsonl'); execFileSync('mkfifo', [f]);
    expect(detectTimed('_transcript_limit_banner', f)).toBe('rc=2');
  });
  it("the detector's error literal is shared's RATE_LIMIT_ERROR — one bash copy, one TS copy, pinned", () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const line = src.split('\n').find((l) => l.includes(`*'"isApiErrorMessage":true'*`) && l.includes('found="$line"'));
    if (!line) throw new Error('_transcript_limit_banner detector line not found in ccd/ccd');
    const m = /\*'"error":"([a-z_]+)"'\*/.exec(line);
    if (!m) throw new Error('no "error":"…" glob literal on the detector line');
    expect(m[1]).toBe(RATE_LIMIT_ERROR);
  });
});

describe('_transcript_stalled_pair pairs -f with -r (D-2370, closing D-2347)', () => {
  it('a directory at the path: rc 2', () => {
    seed(); const d = path.join(h.home, 'dir.jsonl'); fs.mkdirSync(d);
    expect(h.sh(`_transcript_stalled_pair ${JSON.stringify(d)}; echo "rc=$?"`)).toBe('rc=2');
  });
  it('a FIFO at the path: rc 2 without blocking', () => {
    seed(); const f = path.join(h.home, 'fifo.jsonl'); execFileSync('mkfifo', [f]);
    expect(detectTimed('_transcript_stalled_pair', f)).toBe('rc=2');
  });
});
```

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-limit-banner.test.ts` — RED
(`_transcript_limit_banner: command not found`; the `_transcript_stalled_pair` directory case
answers rc 1 today, the FIFO case rc=124).

- [x] **Step 3 — the detector.** In `ccd/ccd`, directly after `_transcript_stalled_pair`'s
  closing brace:

```bash
_transcript_limit_banner() {   # transcript-path -> 0 the newest real row is a rate-limit banner (prints "<resetsAt>\t<rateLimitType>") | 1 not | 2 unreadable (D-2362)
  # STRUCTURAL, NOT TEXTUAL. The row Claude Code appends on a 429 carries
  # `"isApiErrorMessage":true` and `"error":"rate_limit"` (measured 2026-09-10:
  # `quotaLimits:{status:"rejected",resetsAt:<epoch s>,rateLimitType:"seven_day"}`).
  # Its TEXT — "You've hit your weekly limit · resets Sep 15, 12am (UTC)" — is the
  # part `_pane_hard_blocked` has twice failed to match (D-2364), so nothing here
  # reads it: `shared/api.ts`'s RATE_LIMIT_ERROR is the same literal, and
  # `ccd-limit-banner.test.ts` reads this line from source to keep them equal.
  # Same window and the same chatter rule as `_transcript_stalled_pair`:
  # local-command rows are not turns; any other user/assistant row after the
  # banner means the session moved on (a re-drive, a human message, a new turn).
  # `-f && -r`, never `-r` alone — D-2347's class: `-r` is true for a FIFO and an
  # unbounded character device, and `tail` on either blocks for ever (D-2370).
  local f="$1" line found="" reset type
  [[ -f "$f" && -r "$f" ]] || return 2
  while IFS= read -r line; do
    [[ "$line" == *'"type":"user"'* || "$line" == *'"type":"assistant"'* ]] || continue
    if [[ "$line" == *'"type":"assistant"'* && "$line" == *'"isApiErrorMessage":true'* && "$line" == *'"error":"rate_limit"'* ]]; then found="$line"; continue; fi
    case "$line" in *'<local-command-caveat>'*|*'<command-name>'*|*'<local-command-stdout>'*) continue ;; esac
    found=""
  done < <(tail -n "$REDRIVE_TAIL_LINES" "$f")
  [[ -n "$found" ]] || return 1
  reset=$(grep -oE '"resetsAt":[0-9]+' <<<"$found" | head -1 | cut -d: -f2)
  type=$(grep -oE '"rateLimitType":"[a-z_]+"' <<<"$found" | head -1 | cut -d'"' -f4)
  printf '%s\t%s\n' "$reset" "$type"
  return 0
}
```

  Keep the `if … then found="$line"; continue; fi` ON ONE LINE: the coupling test finds the
  detector line by `*'"isApiErrorMessage":true'*` and `found="$line"` together.

- [x] **Step 4 — the paired guard in `_transcript_stalled_pair`.** Replace
  `[[ -r "$f" ]] || return 2` with `[[ -f "$f" && -r "$f" ]] || return 2   # D-2370: -r alone admits a FIFO (D-2347)`.

- [x] **Step 5 — GREEN, then the mutation table.** Run the suite; all green. Then, one at a
  time, restore between each:

| mutation | red case |
|---|---|
| drop `&& "$line" == *'"error":"rate_limit"'*` | "not a rate limit … rc 1" |
| drop the `"isApiErrorMessage":true` clause | "the banner's TEXT … rc 1" stays green (text row has neither) — pair it with `banner({ isApiErrorMessage: undefined })` if a reviewer asks; the structural claim is the `overloaded` row |
| `found=""` -> `:` on the last line of the loop | "a META resume prompt … rc 1" |
| drop the `case … continue` chatter line | "local-command chatter … rc 0" |
| `-f && -r` -> `-r` (detector) | "a directory … rc 2" (rc 1) and "a FIFO … rc 2" (rc=124) |
| `-f && -r` -> `-r` (stalled pair) | both D-2370 cases |
| `RATE_LIMIT_ERROR = 'rate_limited'` | the coupling case |

- [x] **Step 6 — commit.** `git add ccd/ccd shared/api.ts server/test/ccd-limit-banner.test.ts`;
  `git commit -m "feat(ccd,shared): a rate-limit banner is measured on the transcript, structurally, and both readers pair -f with -r (D-2362, D-2370)"`.

---

## Task 2: ccd — `_session_hard_blocked`, wired into the rescue arm and the strand half (D-2363, D-2364)

**Files:** `ccd/ccd` (`_pane_hard_blocked`'s neighbourhood; `_auto_swap_check`;
`_tick_strand_undecidable`), `server/test/ccd-limit-banner.test.ts` (second describe).

- [x] **Step 1 — the failing tests.** Append to `server/test/ccd-limit-banner.test.ts`:

```ts
describe('_session_hard_blocked wires the transcript into the rescue arm (D-2363)', () => {
  const PROMPT = '? for shortcuts\n❯ ';
  const BUSY = 'Reading files… (esc to interrupt)\n';
  const BANNER_PANE = 'API Error: 429 Too Many Requests\n❯ ';
  /** tmux answers ONE pane for every capture (plain and `-e` alike), `_pane_box_draft`
   *  answers `$BOX_DRAFT`, and the swap decision is stubbed so the test is about the
   *  verdict, never the fixture roster's telemetry. */
  const STUBS = (pane: string, target = 'claude2'): string => `
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "\${1:-}" in
      capture-pane) printf '%s\\n' ${JSON.stringify(pane)} ;; list-panes) echo 4242 ;; esac; return 0; };
    _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };
    _swap_target() { echo ${target}; }; _avail() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
  const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
  const swapLog = (): string => {
    const f = path.join(h.home, '.cc-sessions', 'swap.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  };
  const stranded = (): boolean => fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.stranded`));

  it('a banner newest in the transcript rescues a session whose pane shows only a prompt; the line says via=transcript', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude2`]);
    expect(swapLog()).toMatch(/auto-rescue myid: claude \(blocked\) -> claude2 \[home=claude\] via=transcript/);
  });
  it('a BLANK pane no longer blinds the rescue: the transcript decides', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS('')} _auto_swap_check ${ID}`);
    expect(dispatches()).toHaveLength(1);
  });
  it('a non-empty input box stands the transcript arm down — cmd_swap carries the transcript, never the box', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`, { BOX_DRAFT: 'half a sentence' });
    expect(dispatches()).toEqual([]);
  });
  it('a running turn is never read for a banner', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(BUSY)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
  });
  it('control: a transcript whose newest row is a real turn does not rescue a prompt pane', () => {
    seed(); writeTranscript([L.banner(), L.assistant()]);
    h.sh(`${STUBS(PROMPT)} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
  });
  it('control: the pane arm is unchanged — a visible banner line rescues, draft or not, with no via= suffix', () => {
    seed(); writeTranscript([L.assistant()]);
    h.sh(`${STUBS(BANNER_PANE)} _auto_swap_check ${ID}`, { BOX_DRAFT: 'typing' });
    expect(dispatches()).toHaveLength(1);
    expect(swapLog()).toMatch(/auto-rescue myid: claude \(blocked\) -> claude2 \[home=claude\]$/m);
  });
  it('no destination: a transcript banner marks the row stranded, like a pane banner does', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(PROMPT, '')} _auto_swap_check ${ID}`);
    expect(dispatches()).toEqual([]);
    expect(stranded()).toBe(true);
  });
  it('the strand half of an undecidable tick reads the same verdict', () => {
    seed(); writeTranscript([L.banner()]);
    h.sh(`${STUBS(PROMPT)} _tick_strand_undecidable ${ID} wrapper claude`);
    expect(stranded()).toBe(true);
    h.sh(`${STUBS(PROMPT)} _strand_clear ${ID}; _tick_strand_undecidable ${ID} wrapper claude`, { BOX_DRAFT: 'typing' });
    expect(stranded()).toBe(false);
  });
  it('both call sites go through _session_hard_blocked (source pin)', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain('_session_hard_blocked "$id" "$pane" && hard_blocked=1');
    expect(src).toContain('_session_hard_blocked "$1" "$pane" && blocked=1');
  });
});
```

Run — RED (`_session_hard_blocked: command not found`; the blank-pane case dispatches nothing).

- [x] **Step 2 — the union.** In `ccd/ccd`, directly after `_pane_auto_continue_armed`:

```bash
_session_hard_blocked() {   # id pane-text -> success iff the pane says stuck, OR the transcript's newest real row is a rate-limit banner and nobody is typing (D-2363)
  # THE PANE FIRST, UNCHANGED. `_pane_hard_blocked` is the detector every landing,
  # rescue and strand verdict has run on since Wave 3 and it stays primary — its
  # contract (a visible banner swaps, draft or not) is not touched here. The
  # transcript is the SECOND detector, for the two shapes the pane cannot see:
  #   - a BLANK capture (`compact-skip … pane-blank` is a measured condition on
  #     this fleet), which used to return before any verdict;
  #   - a banner whose TEXT the regex does not match and no "continuing
  #     automatically" line beside it — auto-resume off, its re-arm cap hit, a
  #     human's Esc. D-2364 records why the regex is NOT widened for that instead.
  # Two stand-downs of its own:
  #   - a running turn ("esc to interrupt") cannot be sitting on a banner, and the
  #     fleet's busy steady state should not pay a transcript read every 5 s;
  #   - a NON-EMPTY INPUT BOX. `cmd_swap` carries the transcript and never the box,
  #     so a human mid-sentence on a limited account would lose the sentence to
  #     the rescue. `-e` capture, like every other `_pane_box_draft` site.
  local id="$1" pane="$2" f cur
  _pane_hard_blocked "$pane" && return 0
  grep -q "esc to interrupt" <<<"$pane" && return 1
  f=$(_transcript_path "$id") || return 1
  _transcript_limit_banner "$f" >/dev/null || return 1
  cur=$(_pane_box_draft "$(tmux capture-pane -t "$(_tmux "$id")" -p -e 2>/dev/null)")
  [[ -z "$cur" ]]
}
```

- [x] **Step 3 — the rescue arm.** In `_auto_swap_check`, replace

```bash
  pane=$(tmux capture-pane -t "$(_tmux "$id")" -p 2>/dev/null | tail -8)
  [[ -n "$pane" ]] || return 0
  _pane_hard_blocked "$pane" && hard_blocked=1
```

  with

```bash
  pane=$(tmux capture-pane -t "$(_tmux "$id")" -p 2>/dev/null | tail -8)
  # THE VERDICT BEFORE THE BLANK-PANE RETURN (D-2363): a blank capture used to
  # return here, ahead of any classifier, and a limited session with a blank
  # pane was never rescued. `_session_hard_blocked` reads the transcript for
  # that case; a blank pane that is NOT blocked still stands still, as before.
  _session_hard_blocked "$id" "$pane" && hard_blocked=1
  [[ -n "$pane" || -n "$hard_blocked" ]] || return 0
```

  and, in the hard-blocked branch, change the log line to name the source when the pane alone
  would not have fired:

```bash
    echo "$(date '+%F %T') auto-rescue $id: $wrapper (blocked) -> $target [home=$home]$(_pane_hard_blocked "$pane" || printf ' via=transcript')" >> "$REG/swap.log"
```

  Keep the comment block that precedes the old `_pane_hard_blocked` line (the "Classify BEFORE
  picking a target" paragraph); it still describes `force`.

- [x] **Step 4 — the strand half.** In `_tick_strand_undecidable`, replace

```bash
  pane=$(tmux capture-pane -t "$(_tmux "$1")" -p 2>/dev/null | tail -8)
  [[ -n "$pane" ]] || return 0
  _pane_hard_blocked "$pane" || { _strand_clear "$1"; return 0; }
```

  with

```bash
  local blocked=""
  pane=$(tmux capture-pane -t "$(_tmux "$1")" -p 2>/dev/null | tail -8)
  _session_hard_blocked "$1" "$pane" && blocked=1
  [[ -n "$pane" || -n "$blocked" ]] || return 0
  [[ -n "$blocked" ]] || { _strand_clear "$1"; return 0; }
```

  (`local pane` is already declared at the top of that function; add `blocked` to it or keep
  the separate `local` — either, but declared.)

- [x] **Step 5 — GREEN, then mutations.** Run `ccd-limit-banner`, `ccd-auto-swap-hold`,
  `ccd-auto-swap-pool`, `ccd-swap-refuse`, `ccd-crosspool`, `ccd-redrive` — all green (the
  pane arm's tests exercise `_session_hard_blocked` through its first line; a fixture that has
  no transcript makes the transcript arm answer rc 1 through `_transcript_path`'s fallback
  path, i.e. "not blocked", which is today's behaviour).

| mutation | red case |
|---|---|
| `_session_hard_blocked` -> `_pane_hard_blocked` at the rescue site | "a banner newest … via=transcript", "a BLANK pane", the source pin |
| drop `[[ -z "$cur" ]]` (return 0 unconditionally after the transcript arm) | "a non-empty input box stands … down" |
| drop the `esc to interrupt` line | "a running turn is never read" |
| `[[ -n "$pane" \|\| -n "$hard_blocked" ]]` -> `[[ -n "$pane" ]]` | "a BLANK pane" |
| drop `$(… printf ' via=transcript')` | the first case's log assertion |
| strand half left on `_pane_hard_blocked` | "the strand half …", the source pin |

- [x] **Step 6 — commit.** `git commit -am "feat(ccd): the rescue arm and the strand half read one verdict — pane first, then the transcript, never over a human's draft (D-2363, D-2364)"`.

---

## Task 3: ccd — the stale press: `_pane_limit_stale`, `_auto_stale_check`, the tick (D-2360, D-2361)

**Files:** `ccd/ccd` (constants after `REDRIVE_TAIL_LINES`; functions after
`_session_hard_blocked`; the supervise tick line), `server/test/ccd-limit-stale.test.ts` (new),
`server/test/ccd-pane-box-draft.test.ts` (the pin).

- [x] **Step 1 — the failing tests.** Create `server/test/ccd-limit-stale.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-limit-stale-'); });
afterEach(() => { h.cleanup(); });

const ID = 'myid';
const STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "\${1:-}" in capture-pane) printf '%s\\n' "\${PANE_TEXT:-}" ;; esac; return 0; };
  _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };`;
/** The bundle's own sentence for `phase:"stale"` (2.1.267, `mu(l)`): what the
 *  status line shows when Claude Code slept through its own reset. */
const STALE = 'Your usage limit has reset · press enter to continue\n❯ ';
const STALE_NO_PROMPT = 'Your usage limit has reset · press enter to continue\n';
const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ ';
const BUSY = 'Your usage limit has reset · press enter to continue\nWorking… (esc to interrupt)\n❯ ';
const READY = '? for shortcuts\n❯ ';
const seed = (): void => { h.sh(`_reg_set ${ID} wrapper claude`); };
const enters = (): string[] => h.calls().filter((l) => l === `tmux send-keys -t cc-${ID} Enter`);
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const stamp = (): string => h.sh(`_reg_get ${ID} stalepress`);
const check = (env: Record<string, string> = {}): void => { h.sh(`${STUBS} _auto_stale_check ${ID}`, { PANE_TEXT: STALE, ...env }); };

describe('_pane_limit_stale', () => {
  it.each([
    ['Your usage limit has reset · press enter to continue', true],
    ['your usage limit has reset · Press Enter to continue', true],
    ['Usage limit reached · continuing automatically at 11:50am · esc or type to cancel', false],
    ["You've hit your session limit · resets 11:50am (UTC)", false],
    ['press enter to continue', false],
    ['? for shortcuts', false],
  ])('%s -> %s', (pane, stale) => {
    expect(h.sh(`_pane_limit_stale ${JSON.stringify(pane)} && echo yes || echo no`)).toBe(stale ? 'yes' : 'no');
  });
});

describe('_auto_stale_check presses Enter for a stale auto-continue (D-2360)', () => {
  it('one Enter, a stale-resume line, and a stamp', () => {
    seed(); check();
    expect(enters()).toHaveLength(1);
    expect(swapLog()).toMatch(/stale-resume myid: usage limit has reset; pressing Enter .*\[wrapper=claude\]/);
    expect(stamp()).toMatch(/^[0-9]+$/);
  });
  it('not again within STALE_PRESS_COOLDOWN', () => {
    seed(); check(); check();
    expect(enters()).toHaveLength(1);
  });
  it('again once the cooldown has lapsed', () => {
    seed(); check(); h.sh(`_reg_set ${ID} stalepress 1`); check();
    expect(enters()).toHaveLength(2);
  });
  it('a non-empty input box: no keystroke, a stale-skip line, and the stamp so the line is not repeated every tick (D-2361)', () => {
    seed(); check({ BOX_DRAFT: 'half a sentence' });
    expect(enters()).toEqual([]);
    expect(swapLog()).toMatch(/stale-skip myid: usage limit has reset but the input box is not empty/);
    expect(stamp()).toMatch(/^[0-9]+$/);
  });
  it('no prompt visible: nothing', () => { seed(); check({ PANE_TEXT: STALE_NO_PROMPT }); expect(enters()).toEqual([]); });
  it('a running turn: nothing', () => { seed(); check({ PANE_TEXT: BUSY }); expect(enters()).toEqual([]); });
  it('an ARMED auto-continue is not stale: nothing (R3 — never cancel it)', () => { seed(); check({ PANE_TEXT: ARMED }); expect(enters()).toEqual([]); });
  it('a ready pane: nothing', () => { seed(); check({ PANE_TEXT: READY }); expect(enters()).toEqual([]); });
  it('a blank pane: nothing', () => { seed(); check({ PANE_TEXT: '' }); expect(enters()).toEqual([]); });
  it('the tick runs the stale check BEFORE the swap arm (source pin)', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain('_sync_uuid "$id"; _auto_stale_check "$id"; _auto_swap_check "$id"; _auto_compact_check "$id"');
  });
});
```

Run — RED.

- [x] **Step 2 — constant.** After `REDRIVE_TAIL_LINES=60 …` add:

```bash
STALE_PRESS_COOLDOWN=120        # D-2361 — seconds between Enter presses on Claude Code's "usage limit has reset · press enter to continue" line
```

- [x] **Step 3 — the functions.** After `_session_hard_blocked`:

```bash
_pane_limit_stale() {   # pane text -> success iff Claude Code slept through its own reset and is asking for Enter (D-2360).
  # THE BUNDLE'S OWN SENTENCE (2.1.267: `mu(l)` returns it for `phase:"stale"`,
  # reached when the auto-resume tick finds a gap past the reset larger than its
  # grace — a throttled or suspended process). Enter in that phase submits the
  # continuation Claude Code already holds (`tengu_quota_auto_resume_stale_resumed`).
  # Gated on the exact sentence so a changed one fails CLOSED — no keystroke —
  # which is the lesson of 2026-09-08's trust dialog (a bare Enter exited five
  # sessions). `ccd-limit-stale.test.ts` carries the sentence verbatim.
  grep -qiE "usage limit has reset.*press enter to continue" <<<"$1"
}

_auto_stale_check() {   # id — D-2360: press Enter for Claude Code when its own auto-continue went stale.
  # Runs on the supervise tick BEFORE `_auto_swap_check`: the account has reset,
  # the continuation is right there, and Enter is Claude Code's documented
  # affordance for this phase — a swap would cost a restart and a transcript copy
  # for nothing. Four stand-downs, each pinned: no prompt, a running turn, a
  # non-empty box (a human is at the keyboard; Enter would submit THEIR text),
  # and the cooldown, which also keeps the box-not-empty line from repeating
  # every five seconds (D-2361).
  local id="$1" t pane now last cur
  t=$(_tmux "$id")
  pane=$(tmux capture-pane -t "$t" -p 2>/dev/null | tail -8)
  [[ -n "$pane" ]] || return 0
  _pane_limit_stale "$pane" || return 0
  echo "$pane" | grep -q "esc to interrupt" && return 0
  echo "$pane" | grep -q "❯" || return 0
  now=$(date +%s); last=$(_reg_get "$id" stalepress)
  [[ "$last" =~ ^[0-9]+$ && $((now - last)) -lt "$STALE_PRESS_COOLDOWN" ]] && return 0
  _reg_set "$id" stalepress "$now"
  cur=$(_pane_box_draft "$(tmux capture-pane -t "$t" -p -e 2>/dev/null)")
  if [[ -n "$cur" ]]; then
    echo "$(date '+%F %T') stale-skip $id: usage limit has reset but the input box is not empty [wrapper=$(_reg_get "$id" wrapper)]" >> "$REG/swap.log"
    return 0
  fi
  echo "$(date '+%F %T') stale-resume $id: usage limit has reset; pressing Enter for Claude Code's own continuation [wrapper=$(_reg_get "$id" wrapper)]" >> "$REG/swap.log"
  tmux send-keys -t "$t" Enter
  return 0
}
```

- [x] **Step 4 — the tick.** Change the supervise tick line
  `_sync_uuid "$id"; _auto_swap_check "$id"; _auto_compact_check "$id"` to
  `_sync_uuid "$id"; _auto_stale_check "$id"; _auto_swap_check "$id"; _auto_compact_check "$id"`.

- [x] **Step 5 — the `_pane_box_draft` pin.** In `server/test/ccd-pane-box-draft.test.ts`,
  the site count becomes 5 and the message names the two new sites:
  `expect(calls, 'the two injector call sites, the redrive stand-down, _session_hard_blocked (D-2363) and _auto_stale_check (D-2360)').toHaveLength(5);`
  Update the comment above it the same way.

- [x] **Step 6 — GREEN, then mutations.** Run `ccd-limit-stale`, `ccd-pane-box-draft`,
  `ccd-redrive`, `ccd-auto-compact`.

| mutation | red case |
|---|---|
| `_pane_limit_stale` regex -> `"press enter to continue"` | the `press enter to continue` -> false row |
| drop the `❯` line | "no prompt visible" |
| drop the `esc to interrupt` line | "a running turn" |
| drop the cooldown line | "not again within STALE_PRESS_COOLDOWN" |
| drop the `_reg_set … stalepress` before the draft check | "a non-empty input box … the stamp" |
| draft check removed | "a non-empty input box: no keystroke" |
| tick line without `_auto_stale_check` | the source pin |

- [x] **Step 7 — commit.** `git commit -am "feat(ccd): press Enter for Claude Code when its own auto-continue went stale (D-2360, D-2361)"`.

---

## Task 4: shared + server — the banner is a system event with `resetsAt` (D-2365)

**Files:** `shared/api.ts`, `server/src/transcript/parse.ts`, `server/test/transcript-parse.test.ts`.

- [x] **Step 1 — the failing tests.** Append to `server/test/transcript-parse.test.ts`:

```ts
describe('the limit banner is a system event, not the model speaking (D-2365)', () => {
  const banner = (over: Record<string, unknown> = {}) => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: 'b1', timestamp: '2026-09-10T10:12:21.199Z',
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your weekly limit · resets Sep 15, 12am (UTC)" }] },
    isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
    quotaLimits: { status: 'rejected', resetsAt: 1789430400, rateLimitType: 'seven_day' },
    ...over,
  });
  it('origin limit, the sentence as text, resetsAt in epoch seconds exactly as written', () => {
    expect(parseTranscriptLine(banner())).toEqual([
      { kind: 'system', uuid: 'b1', ts: '2026-09-10T10:12:21.199Z', text: "You've hit your weekly limit · resets Sep 15, 12am (UTC)", origin: 'limit', resetsAt: 1789430400 },
    ]);
  });
  it('no quotaLimits: origin limit with no resetsAt key at all (absence-permits)', () => {
    const [e] = parseTranscriptLine(banner({ quotaLimits: undefined }));
    expect(e).toMatchObject({ kind: 'system', origin: 'limit' });
    expect(e).not.toHaveProperty('resetsAt');
  });
  it('a resetsAt that is not a number is dropped, not coerced', () => {
    const [e] = parseTranscriptLine(banner({ quotaLimits: { resetsAt: '1789430400' } }));
    expect(e).not.toHaveProperty('resetsAt');
  });
  it('an API error that is not a rate limit stays an assistant event', () => {
    expect(parseTranscriptLine(banner({ error: 'overloaded' })).map((e) => e.kind)).toEqual(['assistant']);
  });
  it('the sentence on an ordinary assistant row stays an assistant event — the field decides', () => {
    expect(parseTranscriptLine(banner({ isApiErrorMessage: undefined, error: undefined })).map((e) => e.kind)).toEqual(['assistant']);
  });
});
```

- [x] **Step 2 — the wire.** In `shared/api.ts`: `export type SystemOrigin = 'resume-prompt' | 'no-response' | 'limit';`
  and the system member becomes

```ts
  | { kind: 'system'; uuid: string; ts: string; text: string; origin?: SystemOrigin;
      /** With `origin: 'limit'` only: Claude Code's `quotaLimits.resetsAt`, epoch
       *  SECONDS, copied — never converted — from the banner row (D-2365).
       *  Absent when the row carried none; absence-permits. */
      resetsAt?: number };
```

  Extend the `SystemOrigin` JSDoc with one line: `'limit'` — the assistant row Claude Code
  appends on a 429 (`isApiErrorMessage:true, error:"rate_limit"`).

- [x] **Step 3 — the parser.** In `server/src/transcript/parse.ts`: import `RATE_LIMIT_ERROR`;
  widen the envelope type with `isApiErrorMessage?: unknown; error?: unknown; quotaLimits?: unknown;`;
  and directly BEFORE the `SYNTHETIC_MODEL` check insert:

```ts
  // D-2365: the row Claude Code appends on a 429 is a harness event, not the
  // model. The FIELDS decide (`error`, not the sentence); `resetsAt` is copied
  // in the unit Claude Code wrote it (epoch seconds) and dropped when it is not
  // a number — an adapter may not coerce a distinction it received.
  if (env.isApiErrorMessage === true && env.error === RATE_LIMIT_ERROR) {
    const q = env.quotaLimits;
    const resetsAt = q !== null && typeof q === 'object' && typeof (q as { resetsAt?: unknown }).resetsAt === 'number'
      ? (q as { resetsAt: number }).resetsAt : undefined;
    const text = flattenContent(content).trim() || 'usage limit reached';
    return [{ kind: 'system', uuid, ts, text, origin: 'limit', ...(resetsAt !== undefined ? { resetsAt } : {}) }];
  }
```

- [x] **Step 4 — GREEN, then mutations.** `transcript-parse`, `single-definition`, `typecheck-tests`.

| mutation | red case |
|---|---|
| `env.error === RATE_LIMIT_ERROR` -> `env.isApiErrorMessage === true` alone | "not a rate limit stays an assistant event" |
| `typeof … === 'number'` -> truthiness | "not a number is dropped" |
| the spread -> `resetsAt` unconditionally | "no quotaLimits … no resetsAt key" |

- [x] **Step 5 — commit.** `git commit -am "feat(server,shared): the limit banner is a system event carrying resetsAt (D-2365)"`.

---

## Task 5: PWA — the limit divider (D-2366)

**Files:** `pwa/src/lib/clock.ts` (new), `pwa/src/session/MessageBubble.tsx`,
`pwa/src/session/chat.css`, `pwa/test/clock.test.ts` (new), `pwa/test/chat.test.tsx`.

- [x] **Step 1 — the failing tests.** `pwa/test/clock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resetClock } from '../src/lib/clock';

describe('resetClock (D-2366)', () => {
  // `now` is derived from the SAME instant so the expectation holds in any TZ.
  const at = 1789430400; // 2026-09-15T00:00:00Z
  it('same day: HH:MM in the local clock, nothing else', () => {
    const now = new Date(at * 1000 + 3_600_000);
    const d = new Date(at * 1000);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(resetClock(at, now)).toBe(hm);
  });
  it('another day: HH:MM · D Mon', () => {
    const now = new Date(at * 1000 - 3 * 86_400_000);
    expect(resetClock(at, now)).toMatch(/^\d\d:\d\d · \d{1,2} [A-Z][a-z]{2}$/);
  });
});
```

  And in `pwa/test/chat.test.tsx`, a new describe beside the D-2228 one:

```ts
describe('a usage limit reads as a harness line, not a reply (D-2366)', () => {
  const SENTENCE = "You've hit your weekly limit · resets Sep 15, 12am (UTC)";
  const limit = (resetsAt?: number): ChatEvent =>
    ({ kind: 'system', uuid: 'b1', ts: '2026-09-10T10:12:21.199Z', text: SENTENCE, origin: 'limit', ...(resetsAt !== undefined ? { resetsAt } : {}) });
  it('with resetsAt: "usage limit · resets HH:MM…", the sentence as the tooltip, no assistant bubble', () => {
    const { container } = render(<ChatListInner id="s" events={[limit(1789430400)]} pending={[]} />);
    const line = container.querySelector('.sys-divider--limit');
    expect(line).not.toBeNull();
    expect(line!.textContent).toMatch(/^usage limit · resets \d\d:\d\d/);
    expect(line!.getAttribute('title')).toBe(SENTENCE);
    expect(container.querySelector('.msg-assist')).toBeNull();
  });
  it('without resetsAt: the sentence itself, still a limit line', () => {
    const { container } = render(<ChatListInner id="s" events={[limit()]} pending={[]} />);
    expect(container.querySelector('.sys-divider--limit')!.textContent).toBe(`usage limit · ${SENTENCE}`);
  });
});
```

- [x] **Step 2 — the clock.** `pwa/src/lib/clock.ts`:

```ts
/** Local HH:MM for an epoch-SECONDS instant (the unit Claude Code writes
 *  `quotaLimits.resetsAt` in — D-2365), with the date when it is not today.
 *  `now` is a parameter so the same instant tests identically in every TZ. */
export function resetClock(epochSeconds: number, now: Date = new Date()): string {
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? hm : `${hm} · ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}
```

- [x] **Step 3 — the bubble.** In `MessageBubble.tsx`, import `resetClock` and, in the system
  branch after the `no-response` case:

```tsx
    if (event.origin === 'limit') {
      // D-2366: the row Claude Code appends on a 429 is a harness event. The
      // viewer's clock, not the box's; Claude Code's own sentence ("… resets
      // Sep 15, 12am (UTC)") stays as the tooltip so nothing is lost.
      const when = event.resetsAt !== undefined ? resetClock(event.resetsAt) : null;
      return (
        <p className="sys-divider sys-divider--limit" title={event.text}>
          {when === null ? `usage limit · ${event.text}` : `usage limit · resets ${when}`}
        </p>
      );
    }
```

  `chat.css`, under the D-2228 modifiers:
  `.sys-divider--limit { color: var(--status-attention-text); border-color: var(--status-attention-text); }`
  with a one-line comment (D-2366: a limit is "waiting on the world", the same attention ink as
  the stall — the tree defines no third tone for it).

- [x] **Step 4 — GREEN.** `cd pwa && ./node_modules/.bin/vitest run test/clock.test.ts test/chat.test.tsx`
  and `npx tsc --noEmit` (from `pwa/`). Mutation: drop the `origin === 'limit'` branch — both
  chat cases red; `sameDay ? hm : …` -> always `hm` — "another day" red.

- [x] **Step 5 — commit.** `git commit -am "feat(pwa): a usage limit is a harness line with the reset in the viewer's clock (D-2366)"`.

---

## Task 6: server — the mail nudge holds while an auto-continue is armed (D-2367, D-2368, D-2369)

**Files:** `server/src/pane/dialog.ts`, `server/src/inject/send.ts`, `server/src/watch.ts`,
`pwa/src/lib/api.ts`, `server/test/auto-continue-armed.test.ts` (new), `server/test/send.test.ts`,
`server/test/mail-sweep.test.ts`.

- [x] **Step 1 — the failing tests.** `server/test/auto-continue-armed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';
import { AUTO_CONTINUE_RE, autoContinueArmed } from '../src/pane/dialog.js';

/** ccd's `_pane_auto_continue_armed` is `grep -qiE "<literal>"`; this reads the
 *  literal off that line. Bash cannot import TS, so there are two copies by
 *  construction and this test is the mechanism that keeps them one. */
const ccdLiteral = (): string => {
  const lines = readFileSync(CCD, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('_pane_auto_continue_armed()'));
  if (i < 0) throw new Error('_pane_auto_continue_armed not found in ccd/ccd');
  const m = /grep -qiE "([^"]+)"/.exec(lines.slice(i, i + 8).join('\n'));
  if (!m) throw new Error('no grep -qiE literal inside _pane_auto_continue_armed');
  return m[1]!;
};

describe('autoContinueArmed is ccd\'s _pane_auto_continue_armed, verbatim (D-2367)', () => {
  it("the server's regex source is ccd's literal, case-insensitive on both sides", () => {
    expect(AUTO_CONTINUE_RE.source).toBe(ccdLiteral());
    expect(AUTO_CONTINUE_RE.flags).toContain('i');
  });
  it.each([
    ['Usage limit reached · continuing automatically at 11:50am · esc or type to cancel', true],
    ['Usage limit reached · continuing shortly · esc to cancel', true],
    ['Usage limit reached · Continuing automatically at 11:50am', true],
    ["You've hit your session limit · resets 11:50am (UTC)", false],
    ['Your usage limit has reset · press enter to continue', false],
    ['? for shortcuts\n❯ ', false],
  ])('%s -> %s', (pane, armed) => { expect(autoContinueArmed(pane)).toBe(armed); });
});
```

  In `server/test/send.test.ts`, a new describe:

```ts
describe('holdIfAutoContinueArmed (D-2368)', () => {
  const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ \n';
  it('refuses auto-continue-armed before any keystroke when the caller opts in', async () => {
    const { tmux, calls } = fakeTmux([ARMED]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { holdIfAutoContinueArmed: true });
    expect(res).toMatchObject({ ok: false, error: 'auto-continue-armed' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });
  it('the hold is decided before the menu check — an armed screen with a menu is still reported as the limit', async () => {
    const { tmux, calls } = fakeTmux([`${ARMED}❯ 1. Yes\n  2. No\n  Enter to select\n`]);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi', { holdIfAutoContinueArmed: true });
    expect(res).toMatchObject({ ok: false, error: 'auto-continue-armed' });
    expect(sendKeysCalls(calls)).toEqual([]);
  });
  it('control: without the option the same pane is typed into — a human typing is Claude Code\'s documented cancel', async () => {
    // Frames: the armed prompt, the echo of our text, the empty box after Enter —
    // copy the frame sequence an existing ok-path case in this file uses.
    const { tmux, calls } = fakeTmux([ARMED, '❯ hi\n', '❯ \n']);
    const res = await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: noSleep }, 'x', 'hi');
    expect(res).toEqual({ ok: true });
    expect(sendKeysCalls(calls).length).toBeGreaterThan(0);
  });
});
```

  In `server/test/mail-sweep.test.ts` (hoist the `pushSpy` helper at the file's ~line 1868 to
  module scope if it is not already), a new describe:

```ts
describe('an armed auto-continue holds the nudge (D-2369)', () => {
  const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ \n';
  const seedAll = (h: Harness): void => {
    seedRegistry(h.home, ID); seedHookState(h.home, ID); seedLiveState(h.home);
    seedRegistry(h.home, FROM_ID, FROM_UUID);
  };
  it('no keystroke; held five minutes; no attempt counted; the sender told once', async () => {
    const h = harness({ panes: [ARMED] });
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const { w } = await primedWatcher(h, coord, { push });
    seedAll(h);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
    expect(keyPresses(h.calls)).toEqual([]);
    const row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.lastError).toBe('auto-continue-armed');
    expect(row.attempts).toBe(0);
    expect(row.nextAttemptAt).toBe(Date.now() + 300_000);
    expect(sent.filter((p) => p.tag === `mail-blocked-${id}`)).toHaveLength(1);
    advance(PAST_SWEEP_MS); await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
    expect(sent.filter((p) => p.tag === `mail-blocked-${id}`)).toHaveLength(1);
  });
  it('a delivery one attempt short of the ceiling is NOT parked by a hold', async () => {
    const h = harness({ panes: [ARMED] });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedAll(h);
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);
    coord.db.prepare('UPDATE mail_deliveries SET attempts = ? WHERE id = ?').run(MAIL_MAX_ATTEMPTS - 1, id);
    await w.sweepMail();
    const row = deliveryRow(coord, id);
    expect(row.state).toBe('queued');
    expect(row.attempts).toBe(MAIL_MAX_ATTEMPTS - 1);
    expect(row.rejectCode).toBeNull();
  });
});
```

  Adapt `queueTestDelivery`'s sender to whatever the file's existing `tellSender` cases use so
  the push resolves to a session (`mailOrigin(...).fromId` must not be a role id); if the
  file has no such case, seed the mail row with `fromId: FROM_ID` the way `queueTestDelivery`
  builds it. `NOW`/`Date.now()` — match the file's clock idiom (`vi.setSystemTime`).

- [x] **Step 2 — `dialog.ts`.** After `BUSY_RE`:

```ts
/** Claude Code's own limit recovery is ARMED: the status line reads "Usage limit
 *  reached · continuing automatically at HH:MM · esc or type to cancel" (or
 *  "continuing shortly"). ANY keystroke cancels it — bundle 2.1.267,
 *  `tengu_quota_auto_resume_cancelled` reason `manual_submit` — and the
 *  continuation is discarded. The literal is ccd's `_pane_auto_continue_armed`
 *  verbatim; `auto-continue-armed.test.ts` reads that line and fails on drift
 *  (D-2367). */
export const AUTO_CONTINUE_RE = /continuing automatically|continuing shortly/i;
export function autoContinueArmed(pane: string): boolean { return AUTO_CONTINUE_RE.test(pane); }
```

- [x] **Step 3 — `send.ts`.** Import `autoContinueArmed`; add `'auto-continue-armed'` to the
  `SendResult` error union with a doc line (the pane's status line says Claude Code will
  continue on its own; nothing was pressed; the caller asked for this refusal); add
  `holdIfAutoContinueArmed?: boolean` to `opts` (doc: ONLY the mail lane sets it — a human's
  send from the PWA is Claude Code's documented cancel, `dispatch.ts`'s `/clear` ends the
  conversation on purpose — D-2368); and in the pre-flight replace

```ts
    if (hasMenu(pane.replace(SGR, ''))) return { ok: false, error: 'dialog-open' };
```

  with

```ts
    const plain = pane.replace(SGR, '');
    // D-2368: before the menu check — on an armed screen the limit is the reason
    // nothing may be typed, whatever else is drawn.
    if (opts.holdIfAutoContinueArmed && autoContinueArmed(plain)) return { ok: false, error: 'auto-continue-armed', pane: plain.slice(-PANE_TAIL) };
    if (hasMenu(plain)) return { ok: false, error: 'dialog-open' };
```

- [x] **Step 4 — `watch.ts`.** Beside `MAIL_BACKOFF_MAX_MS`:

```ts
/** D-2369: how long a nudge is held when the recipient's own auto-continue is
 *  armed. Not a backoff step: the recipient is not failing, it is waiting, so
 *  the hold counts no attempt and `MAIL_MAX_ATTEMPTS` cannot park it. Five
 *  minutes against a reset that may be hours away: cheap re-reads, and the
 *  first sweep after the session resumes delivers. */
const MAIL_ARMED_HOLD_MS = 300_000;
```

  Pass `holdIfAutoContinueArmed: true` in the `sendPrompt(...)` call that injects
  `renderMailNudge(d.toId)`. Then, after `const tellSender = …;` and BEFORE
  `if (d.deliveredAt === null) {`:

```ts
        if (res.error === 'auto-continue-armed') {
          // D-2369. Before the attempts ceiling on purpose: a held delivery is
          // not a failed one. Told once per hold, like draft-present.
          if (d.lastError !== 'auto-continue-armed') {
            tellSender('the recipient is waiting out a usage limit on its own; the nudge is held until it resumes',
              `mail-blocked-${d.id}`);
          }
          store.backOff(d.id, res.error, now + MAIL_ARMED_HOLD_MS, false);
          continue;
        }
```

- [x] **Step 5 — the PWA's slug text.** In `pwa/src/lib/api.ts`'s `SEND_ERROR_TEXT` add
  `'auto-continue-armed': 'Claude is waiting out a usage limit and will continue by itself — sending now would cancel that.'`.
  (`pwa/test/api.test.ts` ~line 767 iterates known codes; if it pins the key set, add the
  code there.)

- [x] **Step 6 — GREEN, then mutations.** `auto-continue-armed`, `send`, `mail-sweep`,
  `dialog`, `typecheck-tests`; `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts`.

| mutation | red case |
|---|---|
| `AUTO_CONTINUE_RE` -> `/continuing automatically/i` | the coupling case ("continuing shortly" row too) |
| drop the `i` flag | "Continuing automatically" row and the flags assertion |
| the hold line moved AFTER `hasMenu` | "decided before the menu check" |
| `opts.holdIfAutoContinueArmed &&` dropped | "control: without the option" |
| `false` -> default in `backOff` | "no attempt counted" (`attempts` 1) |
| the branch moved after the attempts ceiling | "one attempt short of the ceiling" |
| `d.lastError !==` guard dropped | "the sender told once" (2 pushes) |

- [x] **Step 7 — commit.** `git commit -am "feat(server): the mail nudge holds while the recipient's own auto-continue is armed (D-2367, D-2368, D-2369)"`.

---

## Task 7: docs, the provenance re-stamp, the whole-tree gates

**Files:** `README.md`, `ccd/ccd` (marker line only), this plan.

- [x] **Step 1 — README.** After the subsection `### A restart re-drives the turn it
  interrupted (D-2226)` add:

```markdown
### A limit is measured on the transcript, and Claude Code's own recovery is left alone (D-2360–D-2370)

The follow-ups to the restart re-drive, measured on 2026-09-10 after 53 landings
(`docs/superpowers/specs/2026-09-10-limit-recovery-followups-design.md`):

- **A stale auto-continue gets its Enter.** When Claude Code slept through its own reset
  (`Your usage limit has reset · press enter to continue`), `_auto_stale_check` presses Enter
  once per `STALE_PRESS_COOLDOWN` — never with a running turn, never over a non-empty box —
  and logs `stale-resume` / `stale-skip` in `swap.log`. An armed auto-continue is never
  touched (D-2229).
- **The transcript is a second limit detector.** `_transcript_limit_banner` reads the row
  Claude Code appends on a 429 (`isApiErrorMessage:true`, `error:"rate_limit"`, `resetsAt`);
  `_session_hard_blocked` is the pane's verdict OR that row, only when no turn is running and
  the box is empty. The rescue arm and the strand verdict both use it; a blank pane no longer
  blinds the rescue, and the `auto-rescue` line says ` via=transcript` when the pane alone
  would not have fired. The pane regex is deliberately not widened (D-2364).
- **The banner is a system line in the PWA** — `usage limit · resets HH:MM` in your clock,
  Claude Code's sentence as the tooltip (`origin: 'limit'`, `resetsAt` in epoch seconds).
- **The mail nudge holds while an auto-continue is armed.** `sendPrompt` refuses
  `auto-continue-armed` for the mail lane only; the sweep holds the delivery five minutes
  without counting an attempt and tells the sender once. Your own send from the PWA is not
  held: typing is Claude Code's documented cancel and the pane is on your screen.
- Both transcript readers pair `-f` with `-r` (D-2370, closing D-2347).
```

- [x] **Step 2 — re-stamp `ccd/ccd`** (once, after every ccd edit above is committed):

```
node --input-type=module -e "import fs from 'node:fs'; import { markGenerated } from './shared/mark.mjs'; fs.writeFileSync('ccd/ccd', markGenerated(fs.readFileSync('ccd/ccd', 'utf8')));"
git diff --stat ccd/ccd   # exactly one line
```

- [x] **Step 3 — the whole-tree gates**, each one package at a time, in the foreground:
  `ownership`, `single-definition`, `dtbd`, `deviation-refs` (after `git fetch origin main`),
  `ccd-reg-get-census` (a prose census pinned to a count — if it moves, update the sentence it
  names, never the count), `typecheck-tests`; then the full `server`, `pwa`, `agent` suites.

- [x] **Step 4 — commit.** `git add README.md ccd/ccd && git commit -m "docs(ccd): the limit follow-ups, and ccd/ccd's provenance re-stamp (D-2360–D-2374)"`.

---

## Deviations found

Numbers D-2360..D-2374 ISSUED 2026-09-10 by `POST /api/ledger/deviations` (allocator floor now
2375). Each is DEFINED here, in the same act.

- **D-2360** — *ccd presses Enter for a stale auto-continue.* Claude Code's `stale` phase
  (`Your usage limit has reset · press enter to continue`) is reached when its auto-resume tick
  slept past the reset by more than its grace; Enter submits the continuation it still holds.
  `_pane_limit_stale` + `_auto_stale_check`, on the supervise tick before the swap arm. Closes
  D-2233.
- **D-2361** — *The stale press's stand-downs, cooldown and log verbs.* No prompt, a running
  turn, a non-empty input box (the keystroke would submit a human's text), and
  `STALE_PRESS_COOLDOWN=120` stamped in `$REG/<id>.stalepress` before the box check, so the
  `stale-skip … input box not empty` line does not repeat every five seconds. Verbs:
  `stale-resume`, `stale-skip`.
- **D-2362** — *A rate-limit banner is measured on the transcript, structurally.*
  `_transcript_limit_banner` answers on `"isApiErrorMessage":true` + `"error":"rate_limit"` as
  the newest real row (local-command rows ignored) and prints `resetsAt` and `rateLimitType`;
  it never reads the banner's text. `shared/api.ts`'s `RATE_LIMIT_ERROR` is the TS copy and a
  source-reading test keeps the two equal. Part of D-2234.
- **D-2363** — *One verdict for the rescue arm and the strand half.* `_session_hard_blocked`
  is the pane's verdict OR the transcript's, the transcript arm only on a pane with no running
  turn and standing down on a non-empty box (a swap carries the transcript, never the box). A
  blank capture no longer returns ahead of the verdict; the `auto-rescue` line carries
  ` via=transcript` when the pane alone would not have fired. Part of D-2234.
- **D-2364** — *Ruling: `_pane_hard_blocked`'s text is NOT widened.* Neither measured banner
  ("hit your session limit", "hit your weekly limit") matches it; adding `hit your .*limit`
  would also match wherever Claude Code re-renders the previous assistant message on a
  `--resume` landing — unmeasured — and `_spawn_settle` turns that regex into rc 5 on every
  landing. The structural detector needs no text. Recorded, not done.
- **D-2365** — *The banner is a system event on the wire.* `parse.ts` maps
  `isApiErrorMessage:true` + `error:"rate_limit"` to `{kind:'system', origin:'limit', text,
  resetsAt?}`; `SystemOrigin` gains `'limit'`, the system member gains `resetsAt?` in epoch
  SECONDS as written, dropped (not coerced) when not a number. Additive, no `FLEET_PROTO` bump.
  Other API-error rows stay assistant bubbles — recorded. Part of D-2234.
- **D-2366** — *The PWA's limit divider.* `usage limit · resets HH:MM` in the viewer's clock
  (`resetClock`, date appended when not today), Claude Code's sentence as the tooltip, the
  stall's attention ink. Part of D-2234.
- **D-2367** — *`autoContinueArmed` in `server/src/pane/dialog.ts`, coupled to ccd's literal.*
  Two copies by construction (bash cannot import TS); `auto-continue-armed.test.ts` reads
  ccd's `grep -qiE` literal and pins `AUTO_CONTINUE_RE.source` and its `i` flag to it. Part of
  D-2235.
- **D-2368** — *`sendPrompt` refuses `auto-continue-armed` on opt-in only.*
  `holdIfAutoContinueArmed`, decided after `not-alive` and before `dialog-open`, before any
  keystroke. Only `sweepMail` sets it: the PWA prompt route (a human typing is Claude Code's
  documented cancel; the pane is on their screen) and `dispatch.ts`'s `/clear` (ends the
  conversation on purpose) are deliberately not gated. Part of D-2235.
- **D-2369** — *The sweep holds without counting an attempt.* `MAIL_ARMED_HOLD_MS=300_000`,
  `store.backOff(…, false)`, decided BEFORE the `MAIL_MAX_ATTEMPTS` ceiling so a limit cannot
  park a delivery; the sender is told once per hold (`mail-blocked-<id>`, as `draft-present`
  does). Closes D-2235.
- **D-2370** — *Both transcript readers pair `-f` with `-r`.* `_transcript_stalled_pair`
  tested `-r` alone (D-2347: true for a FIFO and an unbounded character device, and `tail`
  blocks in `open(2)`/`read(2)` for ever, on `_spawn_settle`'s path). Fixed here, in the
  agent-first `ccd` PR D-2347 asked for, and the new detector is born with the pair. Pinned by
  a directory case (rc 2, not 1) and a FIFO case under `timeout` (rc 2, not 124). Closes
  D-2347.
- **D-2371** — *Measured: the fallback re-drive has never typed.* 53 swap landings between the
  agent deploy (2026-09-09 22:04:52Z) and 2026-09-10 10:15 UTC, 53 `redrive-skip … not-stalled`
  lines, zero `redrive`, zero `armed`. The positive path is measured on clear-meadow (09:29:56
  META prompt, 09:30:07 the assistant) and swift-meadow (10:13:16 / 10:13:27), the negative on
  quiet-summit (an idle auto-home wrote no pair). `REDRIVE_WAIT_S` stays 20.
- **D-2372** — *Observed, not fixed: a delayed dispatch does not re-check its subject.*
  quiet-summit 10:14:20 `auto-home claude-expoai -> claude-dev0 (in 43s)`; 10:14:35 a swap
  `claude-expoai -> gpt` landed from elsewhere; 10:15:05 the dispatch fired anyway,
  `gpt -> claude-dev0`. Two restarts in thirty seconds. D-2232's neighbour; its own
  investigation.
- **D-2373** — *Observed, not fixed: a gpt-lane landing at ctx 100% ran no turn.* bright-meadow
  landed on `gpt` at 10:13:39 with the META prompt written and nothing after it in twelve
  minutes; the compactor read `not-idle (status=busy ctx 100%)`. The gpt lane's context wall,
  owned by `ws/gpt-lane-prompt-compaction-timeout-2`.
- **D-2374** — *Ruling: the non-home-able cc-limits stamp keeps its 5-hour expiry.* The rescue
  arm's `{"five":100,"seven":0,"ts":now}` for a non-home-able wrapper could carry the banner's
  `resetsAt`; the gpt lane's 429 carries no Anthropic-shaped `quotaLimits` to read, and the
  home-able lanes report for themselves through `statusline-command.sh`. Recorded, not done.

Numbers below were ISSUED after the block above, by the final-review fix wave that closed the
whole-branch review's findings — same allocator, same act-of-definition discipline.

- **D-2443** — *`STALE_RESUME_GRACE` — the transcript arm stands down while a stale-press Enter
  is still in flight (Task 3 fix round 1, closing the round's own finding 1).* Nothing stopped
  the rescue arm from swapping the session on the SAME supervise tick `_auto_stale_check` pressed
  Enter for a stale auto-continue: `_session_hard_blocked`'s transcript arm could still read the
  old rate-limit banner as the transcript's newest real row microseconds later, in the same tick,
  before Claude Code had appended the resumed turn's row — and fire a rescue swap that discarded
  the continuation the Enter press just submitted. `STALE_RESUME_GRACE=30` (beside
  `STALE_PRESS_COOLDOWN`, ccd/ccd) stands the transcript arm down for 30s after a FRESH
  `$REG/<id>.stalepress` stamp — several supervise ticks beyond the same-tick race, short
  relative to the 120s press cooldown so a genuinely failed resume is still caught within one
  cycle. The pane arm (`_pane_hard_blocked`) is untouched — it still decides on what is on screen
  NOW, stale press or not. Implemented and tested (`ccd-limit-banner.test.ts`, three mutations:
  the stand-down dropped entirely, the grace zeroed, the bound removed) under the original
  finding's own citation ("fix-round 1 finding 1") because the plan's own "nobody writes a
  placeholder token" discipline forbids `D-TBD-<slug>` even provisionally; the whole-branch
  review that followed flagged the missing number and this entry, plus the ccd comments and test
  titles it names, is the correction.
- **D-2444** — *Cache each session's transcript verdict for 30 seconds.* Final review measured
  `_session_hard_blocked`'s transcript arm at roughly 36 ms per idle row on every five-second
  supervise tick, about 14 times the pane classifier and mostly spent resolving the transcript
  path. `$REG/<id>.tscan` stores `"<epoch> <0|1>"`; `TRANSCRIPT_ARM_INTERVAL=30` reuses both a
  positive and a negative verdict, including the negative written for an absent or unreadable
  transcript. The pane verdict, running-turn guard and D-2443 stale-press grace all remain ahead
  of this cache. A cached positive keeps the strand verdict stable, but the input-box draft guard
  remains outside the cache and is re-measured every time, so cached evidence can never carry a
  human's new draft through a swap. The worst added detection delay is 30 seconds, within the
  rescue arm's existing 120-second jitter.
- **D-2456** — *The ccd limit detector parses the JSONL envelope before classifying it.* The final
  release gate found that `_transcript_limit_banner` searched each raw line for field-shaped
  substrings, so the same keys inside a nested tool input could make an ordinary assistant row
  look like a top-level API-error envelope and force-swap a healthy session. The reader now asks
  a JSON parser for top-level `type`, `isApiErrorMessage` and `error`; malformed rows and nested
  lookalikes fail closed. The newest-real-row and local-command chatter rules stay unchanged.
- **D-2457** — *Every ccd synthesized-action guard measures the whole input box.* The same release
  gate found that `_pane_box_draft` deliberately reads only the marker row, while a human can
  press Alt+Enter first and put real text on continuation rows beneath an empty marker. A shared
  `_pane_box_has_content` adds the server's existing marker-to-closing-rule presence question;
  all five ccd guards use it before swapping, stale Enter, redrive, `/compact`, or `/effort`.
  Chrome after the closing rule is excluded and dim ghost suggestions remain empty.
