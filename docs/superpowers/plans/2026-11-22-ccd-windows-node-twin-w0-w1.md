# ccd's Windows twin in Node — waves 0 and 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure what ccd costs on a Windows box (wave 0), then stand up the Node twin's whole mechanism and move
its first entry point, `ccd caps`, onto it (wave 1).

**Architecture:** The installed launcher (`ccd/ccd-entry.py`, rendered to `~/.local/bin/ccd`) gains two things:
- a timing log, behind a hand-touched marker;
- a hand-off: on Windows, a verb listed in `ccd/node/verbs.json` starts `node` on the digest-checked twin
  (`~/.local/libexec/ccrc/node/ccd.mjs`) instead of bash.

The twin's `caps` reads the installed bash body's own `cmd_caps` text, so the capability list keeps one source. Every
twin test runs the bash body and the twin side by side on the same fixture and compares them.

**Not in these waves:** sibling scripts (`ccd-scope-sweep`, `ccrc watchdog` and the rest). Their own installed entries
gain the same table lookup in the wave that moves the first of them (spec §3). The server tick's ccd calls need no
code of their own here: the server starts ccd through the launcher, so Task 1's log records them.

**Tech Stack:** Node >= 22.16 (ESM `.mjs`, standard library only), Python 3 standard library (launcher and installer),
bash (the body), vitest (server suite).

**Spec:** `docs/superpowers/specs/2026-11-22-ccd-windows-node-twin-design.md`

## Global Constraints

- Public repository: no host names, account names, absolute home paths or private project names in code, tests,
  fixtures, commit messages or this plan's results. Use `lane-a`, `project-a`, `the fleet box`.
- Tests run only against fixture HOMEs (`makeCcdHarness`, `mkTmp`); never against the live `$HOME`.
- Never run a destructive ccd verb against the live box. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or
  `claude-session@*` directly. The wave-0 marker is touched by the operator, by hand.
- Twin code is ESM `.mjs`, standard library only, and imports nothing outside `ccd/node/`. TypeScript from `shared/`
  cannot be imported at runtime: when a later wave needs shared vocabulary, it moves into a `shared/*.mjs` first
  (precedent: `shared/redact.mjs`).
- Linux behaviour does not change: on Linux the launcher always starts bash, and the twin runs there only inside tests.
- The off switch `ccd-node-off` and the timing marker `ccd-entry-timing` live in `$REG` (`~/.cc-sessions/`). Nothing in
  the tree writes either: they are touched by hand only, like `mail-disabled`.
- New guards ship with a test that goes red when the guard is deleted (mutation-table discipline), measured.
- Cite code by `file#symbol` or `file#@anchor`, never `file:line`.
- Deviation numbers are issued by `POST /api/ledger/deviations`. A session that cannot reach it writes
  `D-TBD-<slug>` under "Deviations found" and reports it.
- Run a single test file with `./node_modules/.bin/vitest run test/<file>` from `server/`, in the foreground, with a
  timeout of at least 600000 ms. Never bare `npx vitest`.
- Push once per round: commit as you go, push when the wave's code, tests and notes are complete.

## File map

| File | Status | Responsibility |
|---|---|---|
| `ccd/ccd-entry.py` | modify | timing log (wave 0); twin hand-off, twin digest check, Node environment scrub, off switch (wave 1) |
| `ccd/ccd-entry-install.py` | modify | publish `ccd/node/**` beside the body; render the twin's digests and verbs into the launcher |
| `ccd/node/ccd.mjs` | create | the twin's entry: argv → verb module, exit codes |
| `ccd/node/verbs.json` | create | the one table of twin entry points: module, owned bash functions, their digest, test files |
| `ccd/node/verbs/caps.mjs` | create | `ccd caps` from the body's own `cmd_caps` text |
| `ccd/node/lib/lock.mjs` | create | `withLock`: an exclusive lock taken through the box's `flock` binary |
| `win/bench/hook-time.mjs` | create | times `ccd/session-hook.sh` on one PreToolUse payload, N runs, in a fixture HOME |
| `win/bench/timing-report.mjs` | create | summarises the launcher's timing log and the Windows manager's unit journal |
| `shared/switches.ts` | modify | two hand-only rows: `ccd-node-off`, `ccd-entry-timing` |
| `ccd/ccrc` | modify | the updater's backup and restore carry `node/**` beside the redactor |
| `ccd/ccrc-doctor-checks` | modify | one check: the twin's installed files match the launcher's digests |
| `server/test/ccdTwin.ts` | create | harness: run the bash body or the twin on one fixture, the same way |
| `server/test/ccd-entry-timing.test.ts` | create | wave 0 timing log |
| `server/test/win-bench.test.ts` | create | the two bench scripts' pure functions |
| `server/test/ccd-twin-lock.test.ts` | create | bash and Node exclude each other on one lock |
| `server/test/ccd-twin-caps.test.ts` | create | parity of `ccd caps`, both pool-sync states, the usage refusal |
| `server/test/ccd-twin-entry.test.ts` | create | launcher hand-off: platform, table, off switch, digest refusal, env scrub |
| `server/test/ccd-twin-table.test.ts` | create | guards: table ↔ modules ↔ tests; owned-function digest |
| `server/test/install-census.test.ts` | modify | the installer's new source/destination lines |

---

## Wave 0 — measure

### Task 1: The launcher's timing log

**Files:**
- Modify: `ccd/ccd-entry.py` (`main`, plus a new `start` function)
- Test: `server/test/ccd-entry-timing.test.ts`

**Interfaces:**
- Produces: `~/.ccrc/ccd-entry-timing.log`, one line per timed run: `<epoch_ms>\t<verb>\t<duration_ms>\t<rc>\n`.
  `<verb>` is `argv[0]` when it matches `^[a-z][a-z0-9-]{0,40}$`, else `-`. `<rc>` is the exit status, or
  `128+<signal>` when the payload died of a signal.
- Produces: `start(path, argv, env, home, verb)` in the launcher, used again by Task 7.

Behaviour:
- The marker is `<home>/.cc-sessions/ccd-entry-timing`. `<home>` is derived from the body path the launcher already
  computes: `body[:-len(BODY_SUFFIX)]`. It is never `$HOME`.
- **No marker, or the verb is `supervise`:** `os.execve` exactly as today. `supervise` is the long-lived
  `claude-session@` payload, and a waiting parent must never stand between it and its manager.
- **Marker present:** `subprocess.Popen(path, argv, env)`. SIGTERM, SIGINT and SIGHUP are forwarded to the child. The
  launcher waits for the child, appends the line (`O_APPEND`, at most 16 MiB: past that, nothing is appended) and exits
  with the child's status.
- A write failure is ignored: timing never fails a ccd start.

- [ ] **Step 1: Write the failing test.** `server/test/ccd-entry-timing.test.ts` installs a fixture pair through
  `ccd/ccd-entry-install.py`, the way `ccd-entry-install.test.ts` does. Reuse that file's `install` helper; if it is
  not exported, export it from a new `server/test/entryFixture.ts` and import it in both files, with no change to its
  behaviour.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkTmp } from './tmpHelpers.js';
import { installEntryFixture } from './entryFixture.js';

let home: string;
beforeEach(() => { home = mkTmp('ccrc-entry-timing-'); installEntryFixture(home); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const ccd = (...argv: string[]) => spawnSync(path.join(home, '.local', 'bin', 'ccd'), argv,
  { encoding: 'utf8', env: { ...process.env, HOME: home } });
const log = () => path.join(home, '.ccrc', 'ccd-entry-timing.log');
const marker = () => path.join(home, '.cc-sessions', 'ccd-entry-timing');

describe('the launcher timing log (wave 0)', () => {
  it('writes nothing without the marker', () => {
    expect(ccd('caps').status).toBe(0);
    expect(fs.existsSync(log())).toBe(false);
  });
  it('with the marker, appends verb, duration and status, and keeps the output', () => {
    fs.writeFileSync(marker(), '');
    const r = ccd('caps');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('account-pane\n');
    const [line] = fs.readFileSync(log(), 'utf8').trim().split('\n');
    expect(line).toMatch(/^\d{13}\tcaps\t\d+\t0$/);
  });
  it('records a failing verb with its status', () => {
    fs.writeFileSync(marker(), '');
    expect(ccd('caps', '--json').status).toBe(1);
    expect(fs.readFileSync(log(), 'utf8')).toMatch(/\tcaps\t\d+\t1\n$/);
  });
  it('never records an argument: a verb-shaped token only, else a dash', () => {
    fs.writeFileSync(marker(), '');
    ccd('/some/path');
    expect(fs.readFileSync(log(), 'utf8')).toMatch(/^\d{13}\t-\t\d+\t\d+\n$/);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** Run: `./node_modules/.bin/vitest run test/ccd-entry-timing.test.ts`.
  Expected: the three marker cases FAIL, with no log file.

- [ ] **Step 3: Implement it in `ccd/ccd-entry.py`.** Add near the other constants:

```python
TIMING_MARKER = '/.cc-sessions/ccd-entry-timing'
TIMING_LOG = '/.ccrc/ccd-entry-timing.log'
TIMING_LOG_MAX = 16 << 20
TIMING_NEVER = ('supervise',)   # the long-lived claude-session@ payload: always exec'd, never waited on
VERB_WORD = re.compile(r'^[a-z][a-z0-9-]{0,40}$')
```

`import re` and `import signal` join the stdlib imports. Add:

```python
def start(path, argv, env, home, verb):
    # Wave 0 of the Node twin (spec 2026-11-22 §5): with the hand-touched marker, wait for the payload and log one
    # line; without it, exec exactly as before.
    if verb in TIMING_NEVER or not os.path.exists(home + TIMING_MARKER):
        os.execve(path, argv, env)
    t0 = time.monotonic()
    child = subprocess.Popen(argv, executable=path, env=env, close_fds=True)
    for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(s, lambda n, _f: child.send_signal(n))
    rc = child.wait()
    rc = 128 - rc if rc < 0 else rc
    ms = int((time.monotonic() - t0) * 1000)
    word = verb if verb is not None and VERB_WORD.match(verb) else '-'
    try:
        p = home + TIMING_LOG
        if not os.path.exists(p) or os.path.getsize(p) < TIMING_LOG_MAX:
            fd = os.open(p, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            try:
                os.write(fd, ('%d\t%s\t%d\t%d\n' % (int(time.time() * 1000), word, ms, rc)).encode('ascii'))
            finally:
                os.close(fd)
    except OSError:
        pass
    os._exit(rc)
```

In `main`, replace the final `os.execve(...)` with:

```python
    home = body[:-len(BODY_SUFFIX)]
    start(bash, [bash] + (['-p'] if protected else []) + ['--', body] + argv, env, home, argv[0] if argv else None)
```

- [ ] **Step 4: Run it and see it pass.** Run the same file again. Expected: PASS, 4 tests. Then run
  `./node_modules/.bin/vitest run test/ccd-entry-install.test.ts test/ccd-forbidden-verbs-entry.test.ts
  test/ccd-child-reclaim-entry.test.ts`. Expected: PASS, since nothing changes without the marker.

- [ ] **Step 5: Add the two switchboard rows in `shared/switches.ts`.** Add the constants beside the other marker
  constants:

```ts
/** Wave 0 of ccd's Windows twin (spec 2026-11-22 §5): the launcher logs each run's verb and duration while it stands. */
export const CCD_ENTRY_TIMING_MARKER = 'ccd-entry-timing';
/** ccd's Windows twin off switch (spec 2026-11-22 §4): empty, every verb starts bash; lines, those verbs do. */
export const CCD_NODE_OFF_MARKER = 'ccd-node-off';
```

Add the rows to `SWITCHES`:

```ts
  [CCD_ENTRY_TIMING_MARKER]: {
    storage: { marker: CCD_ENTRY_TIMING_MARKER }, default: 'absent: nothing is timed', owner: 'C2',
    meaning: 'The ccd launcher logs each run\'s verb, duration and status to ~/.ccrc/ccd-entry-timing.log.',
    writer: 'hand-only',
  },
  [CCD_NODE_OFF_MARKER]: {
    storage: { marker: CCD_NODE_OFF_MARKER }, default: 'absent: listed verbs start the Node twin on Windows',
    owner: 'C2', meaning: 'Empty: every verb starts bash. One verb per line: those verbs start bash.', writer: 'hand-only',
  },
```

Run `./node_modules/.bin/vitest run test/switches.test.ts test/single-definition/`. Expected: PASS. If a census names
a hand-kept list these rows must join (for example a characterization list of marker values), add them there in the
same form as the `D-8382` row, and run again.

- [ ] **Step 6: Commit.**

```bash
git add ccd/ccd-entry.py shared/switches.ts server/test/ccd-entry-timing.test.ts server/test/entryFixture.ts server/test/ccd-entry-install.test.ts
git commit -m "feat(ccd): the launcher's timing log, behind a hand-touched marker (Node twin wave 0)"
```

### Task 2: The two bench scripts

**Files:**
- Create: `win/bench/hook-time.mjs`
- Create: `win/bench/timing-report.mjs`
- Test: `server/test/win-bench.test.ts`

**Interfaces:**
- Produces: `summarise(durationsMs: number[]) → { n, median, p90, total }` from `timing-report.mjs`.
- Produces: `parseEntryLog(text) → Map<verb, number[]>` from `timing-report.mjs`.
- Produces: `parseUnitJournal(text, sinceMs) → Map<unit, number[]>` from `timing-report.mjs`. The journal is the
  Windows manager's `~/.ccrc/supervisor/supervisor.log`; a run is a `start <unit>.service` line followed by an `exit
  <unit>.service` line.
- `hook-time.mjs` is a command, not a module: `node win/bench/hook-time.mjs [runs=20]` prints one line,
  `hook PreToolUse: n=<n> median=<ms> p90=<ms>`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { summarise, parseEntryLog, parseUnitJournal } from '../../win/bench/timing-report.mjs';

describe('win bench: timing-report', () => {
  it('summarises durations', () => {
    expect(summarise([5, 1, 3, 2, 4])).toEqual({ n: 5, median: 3, p90: 5, total: 15 });
  });
  it('reads the launcher log by verb, ignoring a torn last line', () => {
    const m = parseEntryLog('1700000000000\tcaps\t120\t0\n1700000000100\tcaps\t80\t0\n1700000000200\tlist\t9\t0\n17000');
    expect(m.get('caps')).toEqual([120, 80]);
    expect(m.get('list')).toEqual([9]);
    expect(m.size).toBe(2);
  });
  it('pairs start and exit lines of the manager journal, from a given time on', () => {
    const j = [
      '2026-01-01T00:00:00.000Z start ccd-scope-sweep.service #1 pid=10',
      '2026-01-01T00:00:13.000Z exit ccd-scope-sweep.service code=0 signal=null wanted=true',
      '2026-01-02T00:00:00.000Z start ccd-scope-sweep.service #1 pid=11',
      '2026-01-02T00:00:02.500Z exit ccd-scope-sweep.service code=0 signal=null wanted=true',
    ].join('\n');
    expect(parseUnitJournal(j, Date.parse('2026-01-02T00:00:00Z')).get('ccd-scope-sweep')).toEqual([2500]);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** Run: `./node_modules/.bin/vitest run test/win-bench.test.ts`. Expected:
  FAIL, cannot resolve `timing-report.mjs`.

- [ ] **Step 3: Write `win/bench/timing-report.mjs`.**

```js
// Summarise ccd's cost on a box: the launcher's timing log (wave 0 of the Node twin, spec 2026-11-22 §5) and, on a
// Windows box, the manager's unit journal. Usage: node win/bench/timing-report.mjs [sinceIso]
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarise(ms) {
  const a = [...ms].sort((x, y) => x - y);
  const at = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { n: a.length, median: at(0.5), p90: at(0.9), total: a.reduce((s, x) => s + x, 0) };
}

export function parseEntryLog(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const f = line.split('\t');
    if (f.length !== 4 || !/^\d+$/.test(f[2])) continue;
    (out.get(f[1]) ?? out.set(f[1], []).get(f[1])).push(Number(f[2]));
  }
  return out;
}

export function parseUnitJournal(text, sinceMs) {
  const open = new Map();
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+Z) (start|exit) (\S+?)\.service\b/);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (t < sinceMs) continue;
    if (m[2] === 'start') open.set(m[3], t);
    else if (open.has(m[3])) {
      (out.get(m[3]) ?? out.set(m[3], []).get(m[3])).push(t - open.get(m[3]));
      open.delete(m[3]);
    }
  }
  return out;
}

function table(title, map) {
  const rows = [...map].map(([k, v]) => ({ k, ...summarise(v) })).sort((a, b) => b.total - a.total);
  console.log(`\n${title}\n| what | runs | median | p90 | total |\n|---|---|---|---|---|`);
  for (const r of rows) {
    console.log(`| ${r.k} | ${r.n} | ${(r.median / 1000).toFixed(1)} s | ${(r.p90 / 1000).toFixed(1)} s | ${(r.total / 60000).toFixed(0)} min |`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const since = Date.parse(process.argv[2] ?? '1970-01-01T00:00:00Z');
  const log = path.join(os.homedir(), '.ccrc', 'ccd-entry-timing.log');
  if (existsSync(log)) table('ccd launcher', parseEntryLog(readFileSync(log, 'utf8')));
  const journal = path.join(os.homedir(), '.ccrc', 'supervisor', 'supervisor.log');
  if (existsSync(journal)) table('Windows manager units', parseUnitJournal(readFileSync(journal, 'utf8'), since));
}
```

- [ ] **Step 4: Write `win/bench/hook-time.mjs`.** Its fixture follows `session-hook.test.ts`'s `beforeEach` and
  `hookEnv`: a generation file, a `tmux` stub on PATH, and the same environment variables.

```js
// Time ccd/session-hook.sh on one PreToolUse payload, in a throwaway fixture HOME (never the live one).
// Usage: node win/bench/hook-time.mjs [runs=20]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarise } from './timing-report.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ccd', 'session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const runs = Number(process.argv[2] ?? 20);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-hook-time-'));
try {
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.generation'), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
  const env = { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, TMUX_PANE: '%1',
    CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, CLAUDE_JOB_DIR: '' };
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  const bash = process.env.CCRC_BASH ?? 'bash';
  const ms = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    execFileSync(bash, [HOOK], { input, env, stdio: ['pipe', 'ignore', 'ignore'] });
    ms.push(Number((process.hrtime.bigint() - t0) / 1_000_000n));
  }
  const s = summarise(ms);
  console.log(`hook PreToolUse: n=${s.n} median=${s.median}ms p90=${s.p90}ms`);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
```

- [ ] **Step 5: Run the test and the hook bench.** Run `./node_modules/.bin/vitest run test/win-bench.test.ts`.
  Expected: PASS, 3 tests. Then run `node ../win/bench/hook-time.mjs 5`. Expected: one `hook PreToolUse:` line.

- [ ] **Step 6: Commit.**

```bash
git add win/bench/hook-time.mjs win/bench/timing-report.mjs server/test/win-bench.test.ts
git commit -m "feat(win): bench scripts for ccd's cost on a box: the hook and the timing report (Node twin wave 0)"
```

### Task 3: One measured day (operator)

No code. The operator does this on the Windows box, by hand.

- [ ] **Step 1:** Deploy the build carrying Tasks 1 and 2 (`ccrc update`).
- [ ] **Step 2:** Bring the box to the measuring conditions and record them beside the figures:
  - no orphaned test processes;
  - memory commit well under its limit.
- [ ] **Step 3:** Touch `~/.cc-sessions/ccd-entry-timing`. Leave it for 24 hours of ordinary use, then remove it.
- [ ] **Step 4:** Run:
  - `node win/bench/timing-report.mjs <start-iso>`;
  - `node win/bench/hook-time.mjs 30`.
- [ ] **Step 5:** Paste both tables into **Results of wave 0**, at the end of this plan.
- [ ] **Step 6:** Order the entry points for waves 2 and on by total cost, and write that order into the same
  section. Wave 1 is `caps` whatever the measurement says: it is the pilot, and it is on the server's boot path. On
  the reference box on 2026-11-22 it took about 27 s, against the server's 10 s deadline.

---

## Wave 1 — the twin's mechanism, with `ccd caps`

### Task 4: An exclusive lock both implementations honour

**Files:**
- Create: `ccd/node/lib/lock.mjs`
- Test: `server/test/ccd-twin-lock.test.ts`

**Interfaces:**
- Produces: `withLock(file: string, fn: () => Promise<T> | T, opts?: { flock?: string }) → Promise<T>`. It holds an
  exclusive `flock` on `file` for the length of `fn`. The lock is taken by the box's own `flock` binary, which runs
  `cat` as its command: the lock is held once `cat` echoes the byte written to it, and released when stdin closes.
  Under MSYS2 this is the same Cygwin lock domain bash's `flock` uses, which a Windows Node process cannot reach
  directly.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { mkTmp } from './tmpHelpers.js';
import { HARNESS_BASH } from './ccdWsHelpers.js';
// @ts-expect-error -- plain ESM module, no types
import { withLock } from '../../ccd/node/lib/lock.mjs';

let dir: string;
beforeEach(() => { dir = mkTmp('ccrc-twin-lock-'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('withLock and bash flock exclude each other', () => {
  it('Node waits while bash holds the lock', async () => {
    const f = path.join(dir, 'reg.lock');
    const holder = spawn(HARNESS_BASH, ['-c', `exec 9>"$1"; flock -x 9; echo held; sleep 2`, 'x', f]);
    await new Promise<void>((r) => holder.stdout.once('data', () => r()));
    const t0 = Date.now();
    await withLock(f, () => undefined);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
    await new Promise((r) => holder.once('close', r));
  });
  it('bash cannot take the lock while Node holds it, and can once Node lets go', async () => {
    const f = path.join(dir, 'reg.lock');
    const tryBash = () => spawnSync(HARNESS_BASH, ['-c', `exec 9>"$1"; flock -n -x 9`, 'x', f]).status;
    await withLock(f, () => { expect(tryBash()).toBe(1); });
    expect(tryBash()).toBe(0);
  });
  it('fn throwing still releases the lock', async () => {
    const f = path.join(dir, 'reg.lock');
    await expect(withLock(f, () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(spawnSync(HARNESS_BASH, ['-c', `exec 9>"$1"; flock -n -x 9`, 'x', f]).status).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** Run: `./node_modules/.bin/vitest run test/ccd-twin-lock.test.ts`.
  Expected: FAIL, cannot resolve `lock.mjs`.

- [ ] **Step 3: Write `ccd/node/lib/lock.mjs`.**

```js
// An exclusive lock that ccd's bash and the Node twin both honour (spec 2026-11-22 §4). Under MSYS2, flock is
// Cygwin's emulation, which a Windows Node process cannot reach directly, so the lock is taken by the same flock
// binary bash uses, holding `cat` as its command: one process start per lock, not one per step.
import { spawn } from 'node:child_process';

export async function withLock(file, fn, { flock = 'flock' } = {}) {
  const child = spawn(flock, ['-x', file, 'cat'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const closed = new Promise((r) => child.once('close', r));
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`flock exited ${code} before the lock was held`)));
    child.stdout.once('data', resolve);
    child.stdin.write('L\n');
  });
  try {
    return await fn();
  } finally {
    child.stdin.end();
    await closed;
  }
}
```

- [ ] **Step 4: Run it and see it pass**, on Linux and on the Windows bench (`CCRC_BASH` set, from MSYS2). Expected:
  PASS, 3 tests, on both.
- [ ] **Step 5: Commit.**

```bash
git add ccd/node/lib/lock.mjs server/test/ccd-twin-lock.test.ts
git commit -m "feat(ccd): the Node twin's lock, held through the box's flock so bash and Node exclude each other"
```

### Task 5: The twin's entry, its table and `caps`

**Files:**
- Create: `ccd/node/ccd.mjs`, `ccd/node/verbs.json`, `ccd/node/verbs/caps.mjs`
- Create: `server/test/ccdTwin.ts`
- Test: `server/test/ccd-twin-caps.test.ts`

**Interfaces:**
- Produces: `ccd/node/ccd.mjs <verb> [args…]`.
  - Unknown verb: stderr `ccd: the node twin has no verb <verb>`, exit 125.
  - Known verb: the module's `run(argv, ctx)` result is the exit status.
  - `ctx = { home, bodyPath, platform, stdout, stderr, twinVerbs }`:
    - `bodyPath` is `<dir of ccd.mjs>/../ccd`, which is `ccd/ccd` in the repository and
      `~/.local/libexec/ccrc/ccd` when installed;
    - `twinVerbs` is the key list of `verbs.json`.
- Produces: `verbs.json`, shaped as `{ "entries": { "<verb>": { "module": "verbs/<verb>.mjs", "owns": [bash function
  names], "ownsSha256": "<hex>", "tests": [repo paths] } } }`.
- Produces: `capsLines(bodyText: string, poolSyncInstalled: boolean) → string[]` from `verbs/caps.mjs`.
- Produces, in `server/test/ccdTwin.ts`:
  - `TWIN`: the absolute path of `ccd/node/ccd.mjs`;
  - `runImpl(h: CcdHarness, impl: 'bash' | 'node', argv: string[], extra?: NodeJS.ProcessEnv) → { status, stdout,
    stderr }`. `bash` runs `HARNESS_BASH CCD …argv` and `node` runs `process.execPath TWIN …argv`, both with
    `cwd: h.home` and `env: h.env(extra)`.

- [ ] **Step 1: Write the harness, `server/test/ccdTwin.ts`.**

```ts
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CCD, HARNESS_BASH, type CcdHarness } from './ccdWsHelpers.js';

export const TWIN = path.resolve(__dirname, '../../ccd/node/ccd.mjs').split(path.sep).join('/');
export type Impl = 'bash' | 'node';
export const IMPLS: readonly Impl[] = ['bash', 'node'];

/** Run ccd's bash body or the Node twin, the same way, on one fixture: what a parity test compares. */
export function runImpl(h: CcdHarness, impl: Impl, argv: string[], extra: NodeJS.ProcessEnv = {}) {
  const [cmd, pre] = impl === 'bash' ? [HARNESS_BASH, [CCD]] : [process.execPath, [TWIN]];
  const r = spawnSync(cmd, [...pre, ...argv], { cwd: h.home, env: h.env(extra), encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
```

- [ ] **Step 2: Write the failing parity test, `server/test/ccd-twin-caps.test.ts`.**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { runImpl } from './ccdTwin.js';
// @ts-expect-error -- plain ESM module, no types
import { capsLines, run } from '../../ccd/node/verbs/caps.mjs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-twin-caps-'); });
afterEach(() => h.cleanup());

const timer = () => path.join(h.home, '.config', 'systemd', 'user', 'ccd-pool-sync.timer');

describe.skipIf(process.platform === 'darwin')('ccd caps: the Node twin answers as the bash body does', () => {
  it('pool-sync absent: byte-identical stdout, status 0', () => {
    const b = runImpl(h, 'bash', ['caps']);
    const n = runImpl(h, 'node', ['caps']);
    expect(b.status).toBe(0);
    expect(n).toEqual(b);
    expect(n.stdout).toContain('\npool-sync-absent\n');
  });
  it('pool-sync installed: byte-identical stdout, status 0', () => {
    fs.mkdirSync(path.dirname(timer()), { recursive: true });
    fs.writeFileSync(timer(), '');
    const b = runImpl(h, 'bash', ['caps']);
    expect(runImpl(h, 'node', ['caps'])).toEqual(b);
    expect(b.stdout).toContain('\npool-sync-installed\n');
  });
  it('an argument is refused the same way', () => {
    const b = runImpl(h, 'bash', ['caps', '--json']);
    expect(b.status).toBe(1);
    expect(runImpl(h, 'node', ['caps', '--json'])).toEqual(b);
  });
});

describe('caps on Windows adds one node:<verb> line per twin verb', () => {
  it('appends after the body\'s list, in table order', async () => {
    let out = '';
    const rc = await run([], {
      home: h.home, bodyPath: path.resolve(__dirname, '../../ccd/ccd'), platform: 'win32',
      stdout: { write: (s: string) => { out += s; } }, stderr: { write: () => undefined }, twinVerbs: ['caps'],
    });
    expect(rc).toBe(0);
    expect(out.endsWith('\nnode:caps\n')).toBe(true);
  });
});

describe('capsLines refuses a cmd_caps it cannot read', () => {
  it('names the line', () => {
    const body = 'cmd_caps() {\n  [[ $# -eq 0 ]] || die "usage: ccd caps"\n  for v in a b; do echo $v; done\n}\n';
    expect(() => capsLines(`x\n${body}`, false)).toThrow(/cannot read: for v in a b/);
  });
});
```

- [ ] **Step 3: Run it and see it fail.** Run: `./node_modules/.bin/vitest run test/ccd-twin-caps.test.ts`.
  Expected: FAIL, cannot resolve `verbs/caps.mjs`.

- [ ] **Step 4: Write `ccd/node/verbs/caps.mjs`.**

```js
// `ccd caps` for the Node twin (spec 2026-11-22, wave 1). The list's one source is the body's own cmd_caps: this
// reads that function's text from the installed body and prints what bash would print. It knows the heredoc, the
// one-word `echo` lines, comments, the usage guard and the single `if _pool_sync_installed` branch. Any other line
// throws, so a new shape in cmd_caps turns the parity test red instead of drifting.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const USAGE_GUARD = '[[ $# -eq 0 ]] || die "usage: ccd caps"';
const ECHOES = /^echo [a-z0-9:._-]+(\s*;\s*echo [a-z0-9:._-]+)*$/;

export function capsLines(text, poolSyncInstalled) {
  const at = text.indexOf('\ncmd_caps() {');
  if (at < 0) throw new Error('cmd_caps not found in the ccd body');
  const end = text.indexOf('\n}\n', at + 1);
  const lines = text.slice(at + 1, end).split('\n').slice(1);
  const out = [];
  let heredoc = false;
  let branch = null;   // null outside the if; 'take' or 'skip' inside it
  for (const raw of lines) {
    if (heredoc) {
      if (raw === 'EOF') heredoc = false; else out.push(raw);
      continue;
    }
    const t = raw.replace(/\s+#.*$/, '').trim();
    if (t === '' || t.startsWith('#') || t === USAGE_GUARD) continue;
    if (t === "cat <<'EOF'") { heredoc = true; continue; }
    if (t === 'if _pool_sync_installed; then') { branch = poolSyncInstalled ? 'take' : 'skip'; continue; }
    if (t === 'else' && branch) { branch = branch === 'take' ? 'skip' : 'take'; continue; }
    if (t === 'fi' && branch) { branch = null; continue; }
    if (ECHOES.test(t)) {
      if (branch !== 'skip') out.push(...t.split(/\s*;\s*/).map((w) => w.slice(5)));
      continue;
    }
    throw new Error(`cmd_caps holds a line the twin cannot read: ${t}`);
  }
  return out;
}

// bash's _pool_sync_installed on a systemd box (the Windows manager emulates that layout); the twin never runs on macOS.
const poolSyncInstalled = (home) => existsSync(path.join(home, '.config', 'systemd', 'user', 'ccd-pool-sync.timer'));

export async function run(argv, ctx) {
  if (argv.length !== 0) {
    ctx.stderr.write('ccd: usage: ccd caps\n');
    return 1;
  }
  const lines = capsLines(readFileSync(ctx.bodyPath, 'utf8'), poolSyncInstalled(ctx.home));
  if (ctx.platform === 'win32') lines.push(...ctx.twinVerbs.map((v) => `node:${v}`));
  ctx.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
```

- [ ] **Step 5: Write `ccd/node/ccd.mjs`.**

```js
// ccd's Windows twin in Node (spec docs/superpowers/specs/2026-11-22-ccd-windows-node-twin-design.md). The launcher
// starts it on Windows for the verbs in verbs.json; tests start it on any platform. Every module it may run is
// imported here, statically, so the launcher's digest check covers every file that loads.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as caps from './verbs/caps.mjs';

const MODULES = { caps };
const here = path.dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(readFileSync(path.join(here, 'verbs.json'), 'utf8'));
const [verb, ...rest] = process.argv.slice(2);
const mod = Object.hasOwn(MODULES, verb ?? '') ? MODULES[verb] : undefined;
if (!mod) {
  process.stderr.write(`ccd: the node twin has no verb ${verb ?? '(none)'}\n`);
  process.exit(125);
}
process.exitCode = await mod.run(rest, {
  home: process.env.HOME ?? os.homedir(), bodyPath: path.join(here, '..', 'ccd'), platform: process.platform,
  stdout: process.stdout, stderr: process.stderr, twinVerbs: Object.keys(table.entries),
});
```

- [ ] **Step 6: Write `ccd/node/verbs.json`.** Leave `ownsSha256` as 64 zeros for now; Task 8's guard computes the
  real value and its failure message prints it.

```json
{
  "entries": {
    "caps": {
      "module": "verbs/caps.mjs",
      "owns": ["cmd_caps", "_pool_sync_installed"],
      "ownsSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "tests": ["server/test/ccd-twin-caps.test.ts"]
    }
  }
}
```

- [ ] **Step 7: Run it and see it pass.** Run: `./node_modules/.bin/vitest run test/ccd-twin-caps.test.ts`. Expected:
  PASS, 5 tests. If parity fails on a caps word with a character outside `[a-z0-9:._-]`, widen `ECHOES` to that
  character and run again; do not special-case the word.
- [ ] **Step 8: Commit.**

```bash
git add ccd/node server/test/ccdTwin.ts server/test/ccd-twin-caps.test.ts
git commit -m "feat(ccd): the Node twin's entry, its table and caps, read from the body's own cmd_caps"
```

### Task 6: The launcher hands a listed verb to the twin on Windows

**Files:**
- Modify: `ccd/ccd-entry.py`
- Test: `server/test/ccd-twin-entry.test.ts`

**Interfaces:**
- Consumes: `start(path, argv, env, home, verb)` (Task 1) and `ccd/node/ccd.mjs` (Task 5).
- Produces: the launcher placeholder `@CCRC_TWIN_JSON@`, rendered by Task 7 to a JSON object
  `{"verbs": ["caps"], "files": {"ccd.mjs": "<sha256>", "verbs.json": "<sha256>", …}}`. Every regular file under
  `ccd/node/` is listed, with its path relative to that directory, `/`-separated.
- Produces: refusal classes `entry-twin-digest`, `entry-twin-unreadable`, `entry-no-node`, exit 125, as
  `ccd: refused (entry-<class>): …`.
- Produces: the test seam `CCRC_ENTRY_TWIN_PLATFORM=1`, honoured only when the launcher's directory holds a file named
  `.ccrc-test-fixture`, which the installer never writes. It lets Linux CI exercise the Windows branch.

Rules, in this order, after `check_body` and before the bash path:

1. **On the twin** when all of these hold:
   - the platform is Windows (`sys.platform in ('msys', 'cygwin')`) or the test seam;
   - `argv[0]` is in the rendered `verbs`;
   - `<home>/.cc-sessions/ccd-node-off` is absent, or it is non-empty and does not list `argv[0]` on a line of its own;
   - `argv[0]` is not protected (`is_protected` false).
2. On the twin, every file in `files` under `<home>/.local/libexec/ccrc/node/` must match its digest
   (`check_body`'s read, per file). Any mismatch refuses with `entry-twin-digest`; nothing starts.
3. `node` is the first PATH entry that is a regular executable file named `node`. None refuses with `entry-no-node`.
4. The environment is `os.environb` without `NODE_OPTIONS`, `NODE_PATH`, `NODE_REPL_EXTERNAL_MODULE` or any
   `NODE_*_IMPORT` variable. `start(node, [node, '--', root + '/ccd.mjs'] + argv, env, home, argv[0])`.
5. Otherwise, the bash path exactly as today.

An unrendered `@CCRC_TWIN_JSON@` refuses as `entry-unrendered`, the way the body digest does.

- [ ] **Step 1: Write the failing test.** Install a fixture as in Task 1, write `.ccrc-test-fixture` beside the
  launcher, and set `CCRC_ENTRY_TWIN_PLATFORM=1`. Stub `node` with a script on PATH that prints its argv and
  `NODE_OPTIONS`.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkTmp } from './tmpHelpers.js';
import { installEntryFixture } from './entryFixture.js';

let home: string;
const entry = () => path.join(home, '.local', 'bin', 'ccd');
const twinDir = () => path.join(home, '.local', 'libexec', 'ccrc', 'node');
const off = () => path.join(home, '.cc-sessions', 'ccd-node-off');
beforeEach(() => {
  home = mkTmp('ccrc-twin-entry-');
  installEntryFixture(home);
  fs.writeFileSync(path.join(home, '.local', 'bin', '.ccrc-test-fixture'), '');
  const bin = path.join(home, 'stub-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\necho "node-stub $* opts=${NODE_OPTIONS-unset}"\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const ccd = (argv: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(entry(), argv, { encoding: 'utf8',
  env: { ...process.env, HOME: home, PATH: `${path.join(home, 'stub-bin')}:${process.env.PATH}`,
    CCRC_ENTRY_TWIN_PLATFORM: '1', NODE_OPTIONS: '--require /x.js', ...env } });

describe('the launcher hands a listed verb to the Node twin on Windows', () => {
  it('caps starts node on the installed twin, with NODE_OPTIONS removed', () => {
    const r = ccd(['caps']);
    expect(r.stdout.trim()).toBe(`node-stub -- ${twinDir()}/ccd.mjs caps opts=unset`);
  });
  it('a verb outside the table starts bash', () => {
    expect(ccd(['list']).stdout).not.toContain('node-stub');
  });
  it('without the Windows platform, caps starts bash', () => {
    expect(ccd(['caps'], { CCRC_ENTRY_TWIN_PLATFORM: '' }).stdout).toContain('account-pane\n');
  });
  it('the seam is inert without the fixture file', () => {
    fs.rmSync(path.join(home, '.local', 'bin', '.ccrc-test-fixture'));
    expect(ccd(['caps']).stdout).toContain('account-pane\n');
  });
  it('an empty ccd-node-off sends every verb to bash', () => {
    fs.writeFileSync(off(), '');
    expect(ccd(['caps']).stdout).toContain('account-pane\n');
  });
  it('a ccd-node-off naming caps sends caps to bash', () => {
    fs.writeFileSync(off(), 'list\ncaps\n');
    expect(ccd(['caps']).stdout).toContain('account-pane\n');
  });
  it('a twin file that does not match its digest refuses, and nothing starts', () => {
    fs.appendFileSync(path.join(twinDir(), 'ccd.mjs'), '\n// changed\n');
    const r = ccd(['caps']);
    expect(r.status).toBe(125);
    expect(r.stderr).toMatch(/^ccd: refused \(entry-twin-digest\): /);
    expect(r.stdout).toBe('');
  });
  it('no node on PATH refuses with entry-no-node', () => {
    const r = ccd(['caps'], { PATH: '/usr/bin:/bin' });
    expect(r.status).toBe(125);
    expect(r.stderr).toMatch(/entry-no-node/);
  });
});
```

The test depends on Task 7 having installed `node/` into the fixture. If you implement this task first, mark the file
`describe.skip` until Task 7 lands, then un-skip it in Task 7's commit.

- [ ] **Step 2: Run it and see it fail.** Run: `./node_modules/.bin/vitest run test/ccd-twin-entry.test.ts`.
  Expected: FAIL; `caps` prints bash's list.

- [ ] **Step 3: Implement it in `ccd/ccd-entry.py`.** Add the constants:

```python
TWIN_JSON = '@CCRC_TWIN_JSON@'
TWIN_SUFFIX = '/.local/libexec/ccrc/node'
TWIN_OFF = '/.cc-sessions/ccd-node-off'
NODE_CODE_VARS = (b'NODE_OPTIONS', b'NODE_PATH', b'NODE_REPL_EXTERNAL_MODULE')
FIXTURE_FILE = '.ccrc-test-fixture'
```

`import json` joins the imports. Add the functions:

```python
def twin_table():
    try:
        t = json.loads(TWIN_JSON)
        return tuple(t['verbs']), dict(t['files'])
    except (ValueError, KeyError, TypeError):
        refuse('unrendered', 'this launcher carries no rendered twin table — it is the template, not an install')


def twin_platform():
    if sys.platform in ('msys', 'cygwin'):
        return True
    # Test seam: lets Linux CI exercise the Windows branch, inert unless the launcher's own directory holds the
    # fixture file, which no installer writes.
    here = os.path.dirname(os.path.abspath(sys.argv[0]))
    return os.environ.get('CCRC_ENTRY_TWIN_PLATFORM') == '1' and os.path.exists(os.path.join(here, FIXTURE_FILE))


def twin_off(home, verb):
    try:
        with open(home + TWIN_OFF, 'rb') as f:
            lines = [l.strip() for l in f.read().decode('utf-8', 'replace').splitlines() if l.strip()]
    except FileNotFoundError:
        return False
    except OSError:
        return True   # unreadable: the safe answer is bash
    return not lines or verb in lines


def check_twin(root, files):
    for rel, want in sorted(files.items()):
        p = root + '/' + rel
        try:
            fd = os.open(p, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0))
            try:
                if not stat.S_ISREG(os.fstat(fd).st_mode):
                    refuse('twin-digest', '%s is not a regular file' % p)
                d = hashlib.sha256()
                while True:
                    chunk = os.read(fd, 1 << 16)
                    if not chunk:
                        break
                    d.update(chunk)
            finally:
                os.close(fd)
        except OSError as e:
            refuse('twin-unreadable', 'the twin file %s could not be read: %s' % (p, e.strerror))
        if not hmac.compare_digest(d.hexdigest(), want):
            refuse('twin-digest', 'the twin file %s is not the one this launcher was rendered for — re-run ccrc update' % p)


def select_node():
    for comp in os.environ.get('PATH', '').split(os.pathsep):
        if comp and os.path.isabs(comp):
            cand = os.path.join(comp, 'node')
            for c in (cand, cand + '.exe'):
                if os.path.isfile(c) and os.access(c, os.X_OK):
                    return c
    return None
```

In `main`, right after `protected = is_protected(argv)`:

```python
    home = body[:-len(BODY_SUFFIX)]
    verbs, files = twin_table()
    if argv and argv[0] in verbs and not protected and twin_platform() and not twin_off(home, argv[0]):
        root = home + TWIN_SUFFIX
        check_twin(root, files)
        node = select_node()
        if node is None:
            refuse('no-node', 'no node on PATH — the Node twin was not started (touch ~/.cc-sessions/ccd-node-off to use bash)')
        env = {k: v for k, v in os.environb.items()
               if k not in NODE_CODE_VARS and not (k.startswith(b'NODE_') and k.endswith(b'_IMPORT'))}
        start(node, [node, '--', root + '/ccd.mjs'] + argv, env, home, argv[0])
```

Task 1's `home = …` line moves up to here, so it is computed once.

- [ ] **Step 4:** Run it once Task 7 is done. Expected: PASS, 8 tests. Then rerun `test/ccd-entry-install.test.ts`,
  `test/ccd-forbidden-verbs-entry.test.ts`, `test/ccd-child-reclaim-entry.test.ts` and
  `test/ccd-entry-timing.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**, together with Task 7, since the launcher cannot be rendered without the installer.

### Task 7: The installer publishes the twin and renders its table

**Files:**
- Modify: `ccd/ccd-entry-install.py` (constants, `render`, `install`)
- Modify: `server/test/install-census.test.ts` (the new source and destination lines)
- Modify: `ccd/ccrc` (the updater's backup and restore lists, beside `redact-cli.mjs`)
- Modify: `ccd/ccrc-doctor-checks` (one check)
- Test: `server/test/ccd-entry-install.test.ts` (new cases)

**Interfaces:**
- Consumes: `ccd/node/**` (Task 5) and `@CCRC_TWIN_JSON@` (Task 6).
- Produces: `~/.local/libexec/ccrc/node/<rel>` for every regular file under `ccd/node/`, mode 0644.

Rules:
- The twin is published as part of the library half: staged in `node/` beside the body, renamed before the body and
  the launcher, under the same refusal and report rules as the redactor's two files.
- Refuse, before anything moves, any of:
  - a symbolic link under `ccd/node/`;
  - a file larger than 1 MiB;
  - a `verbs.json` entry whose verb `is_protected` would protect;
  - a `verbs.json` entry whose module file does not exist.
- `render(template, python, digest, twin_json)` replaces `@CCRC_TWIN_JSON@` once, with the JSON serialised with
  `sort_keys=True` and `separators=(',', ':')`, then escaped for a Python single-quoted string. A template with no
  placeholder, or more than one, refuses.
- A twin file that stands in `node/` but is no longer under `ccd/node/` is removed after the launcher lands. The
  launcher only checks listed files, but a stale file must not stay behind on the box.

- [ ] **Step 1: Write the failing install cases** in `ccd-entry-install.test.ts`, using that file's own helpers:

```ts
describe('the Node twin is published with the pair', () => {
  it('every file under ccd/node lands under libexec/ccrc/node with its digest in the launcher', () => {
    install();
    const launcher = fs.readFileSync(entry(), 'utf8');
    const m = launcher.match(/^TWIN_JSON = '(.*)'$/m);
    expect(m).not.toBeNull();
    const t = JSON.parse(m![1]);
    expect(t.verbs).toEqual(['caps']);
    for (const [rel, digest] of Object.entries(t.files as Record<string, string>)) {
      expect(sha(path.join(home, '.local', 'libexec', 'ccrc', 'node', ...rel.split('/')))).toBe(digest);
    }
    expect(Object.keys(t.files)).toEqual(expect.arrayContaining(['ccd.mjs', 'verbs.json', 'verbs/caps.mjs', 'lib/lock.mjs']));
  });
  it('a protected verb in verbs.json refuses the install before anything moves', () => {
    // Copy the tree, add "ws-reclaim" to its verbs.json, and run the installer on the copy, using this file's tree helper.
    const r = installFrom(withTreeEdit('ccd/node/verbs.json', (s) => s.replace('"entries": {', '"entries": {"ws-reclaim": {"module": "verbs/caps.mjs", "owns": [], "ownsSha256": "", "tests": []},')));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/protected/);
    expect(fs.existsSync(entry())).toBe(false);
  });
});
```

`installFrom` and `withTreeEdit` are the file's existing tree-copy helpers. If they carry other names, use those; if
the file has none, add these two around its existing `tree()` copy, beside `install`.

- [ ] **Step 2: Run it and see it fail.** Run: `./node_modules/.bin/vitest run test/ccd-entry-install.test.ts`.
  Expected: the new cases FAIL.
- [ ] **Step 3: Implement it in the installer.** Add the constants:

```python
TWIN_SOURCE = 'ccd/node'
TWIN_DEST = '.local/libexec/ccrc/node'
PLACEHOLDER_TWIN = '@CCRC_' + 'TWIN_JSON@'
TWIN_FILE_MAX = 1 << 20
```

Add `read_twin(tree)`. It walks `TWIN_SOURCE` with `os.walk(followlinks=False)` and refuses a link or an oversized
file. It returns a sorted list of `(rel, bytes)`, loads `verbs.json` and refuses a protected or missing-module entry.
To test for protection it loads the template's `is_protected` by `exec` of the template text into a fresh dict; that
is the same text the launcher will run, so the two cannot disagree. `twin_json` is
`json.dumps({'verbs': sorted(entries), 'files': {rel: sha256(bytes)}}, sort_keys=True, separators=(',', ':'))`.

In `render`, add the twin placeholder to the loop and the `.replace`, escaping it as `twin_json.replace('\\',
'\\\\').replace("'", "\\'")`.

In `install`:
- call `read_twin(tree)` beside the other reads;
- extend the `destination_kind` loop and the `makedirs` list with the twin's directories;
- stage each file as the redactor's are, with its own slot `'.t<i>'`;
- rename them right after the redactor's two files;
- after the launcher lands, unlink the stale files under `node/` (files there that are not in the set).

Widen `STAGE_RE` to accept the `.t<i>` slots: `r'^\.ccd\.ccrc-stage\.[0-9]+(?:\.(?:[1234]|t[0-9]+))?$'`.

- [ ] **Step 4: Census and the updater.**
  - Add `TWIN_SOURCE`/`TWIN_DEST` to `install-census.test.ts`'s derived list, as it reads the other path lines.
  - In `ccd/ccrc`, at every site that names `shared/redact-cli.mjs` (find them with `git grep -n "redact-cli.mjs" --
    ccd/ccrc`), add the twin directory the same way: the backup copies `node/` as a whole directory under the name
    `ccd-node`, and the restore puts it back before the body.
- [ ] **Step 5: The doctor check.** In `ccd/ccrc-doctor-checks`, add `_check_ccd-node-twin`, modelled on the nearest
  `_check_` function that compares installed files to the tree. It runs `python3 -IS ~/.local/bin/ccd
  --ccrc-entry-self-test` (the self-test already checks the body), then compares every file under
  `~/.local/libexec/ccrc/node/` to `ccd/node/` in the installed tree:
  - **PASS:** they match;
  - **FAIL:** a file differs or is missing, with the note "re-run ccrc update";
  - **SKIP:** on a server-role box.

  Add a case to the doctor suite that tests its neighbour checks.
- [ ] **Step 6: Run it.** Run `./node_modules/.bin/vitest run test/ccd-entry-install.test.ts test/install-census.test.ts
  test/ccd-twin-entry.test.ts test/ccd-entry-timing.test.ts`, plus the doctor suite you touched. Expected: PASS.
  Un-skip `ccd-twin-entry.test.ts` if Task 6 skipped it.
- [ ] **Step 7: Commit Tasks 6 and 7 together.**

```bash
git add ccd/ccd-entry.py ccd/ccd-entry-install.py ccd/ccrc ccd/ccrc-doctor-checks server/test/ccd-twin-entry.test.ts server/test/ccd-entry-install.test.ts server/test/install-census.test.ts
git commit -m "feat(ccd): the launcher starts the Node twin for its listed verbs on Windows; the installer publishes it"
```

### Task 8: The table's guards

**Files:**
- Test: `server/test/ccd-twin-table.test.ts`

**Interfaces:**
- Consumes: `verbs.json`, `ccd/node/ccd.mjs`, `ccd/ccd`.

Each of the following is a guard, and each gets its mutation check in Step 3:
1. The keys of `verbs.json`'s `entries` equal the keys of `MODULES` in `ccd.mjs` (read as text: `const MODULES = {
   … }`), and each `module` file exists.
2. Every entry names at least one test file. Each file exists, imports `runImpl` from `./ccdTwin.js`, and calls it
   with `'node'` and with `'bash'`.
3. `ownsSha256` equals the SHA-256 of the owned bash functions' text, taken from `ccd/ccd` and `ccd/lib/*.sh` in
   `owns` order and joined with `\n`. A function's text runs from its `^name() {` line to the first following `^}`
   line. A mismatch prints the new digest and says: "the bash this twin entry stands in for changed: change
   `ccd/node/<module>` to match, or, if the behaviour did not change, record that by setting ownsSha256 to the value
   above".
4. Nothing under `ccd/node/` imports outside `ccd/node/`: no `from '../../` and no `node_modules` package; only
   `node:` built-ins and relative paths that resolve inside.

- [ ] **Step 1: Write the test.**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const REPO = path.resolve(__dirname, '..', '..');
const NODE_DIR = path.join(REPO, 'ccd', 'node');
const table = JSON.parse(fs.readFileSync(path.join(NODE_DIR, 'verbs.json'), 'utf8')) as
  { entries: Record<string, { module: string; owns: string[]; ownsSha256: string; tests: string[] }> };
const bashSources = [path.join(REPO, 'ccd', 'ccd'),
  ...fs.readdirSync(path.join(REPO, 'ccd', 'lib')).filter((f) => f.endsWith('.sh')).map((f) => path.join(REPO, 'ccd', 'lib', f))]
  .map((p) => fs.readFileSync(p, 'utf8'));

export function functionText(name: string): string {
  for (const src of bashSources) {
    const at = src.search(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(\\) \\{`, 'm'));
    if (at >= 0) return src.slice(at, src.indexOf('\n}\n', at) + 2);
  }
  throw new Error(`bash function ${name} not found in ccd/ccd or ccd/lib`);
}

describe('ccd/node/verbs.json: the twin table', () => {
  it('its verbs are exactly the modules ccd.mjs imports, and each module exists', () => {
    const src = fs.readFileSync(path.join(NODE_DIR, 'ccd.mjs'), 'utf8');
    const m = src.match(/const MODULES = \{([^}]*)\}/);
    expect(m).not.toBeNull();
    const mods = m![1].split(',').map((s) => s.trim()).filter(Boolean).sort();
    expect(mods).toEqual(Object.keys(table.entries).sort());
    for (const e of Object.values(table.entries)) expect(fs.existsSync(path.join(NODE_DIR, e.module))).toBe(true);
  });
  it.each(Object.entries(table.entries))('%s names parity tests that run both implementations', (_v, e) => {
    expect(e.tests.length).toBeGreaterThan(0);
    for (const t of e.tests) {
      const s = fs.readFileSync(path.join(REPO, t), 'utf8');
      expect(s).toMatch(/from '\.\/ccdTwin\.js'/);
      expect(s).toMatch(/runImpl\([^)]*'node'/);
      expect(s).toMatch(/runImpl\([^)]*'bash'/);
    }
  });
  it.each(Object.entries(table.entries))('%s: the bash it stands in for has not changed unseen', (v, e) => {
    const digest = createHash('sha256').update(e.owns.map(functionText).join('\n')).digest('hex');
    if (digest !== e.ownsSha256) {
      throw new Error(`the bash this twin entry (${v}) stands in for changed: change ccd/node/${e.module} to match, or, `
        + `if the behaviour did not change, record that by setting ownsSha256 to ${digest}`);
    }
  });
  it('the twin imports nothing outside ccd/node', () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
      .flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]));
    for (const f of walk(NODE_DIR).filter((f) => f.endsWith('.mjs'))) {
      for (const [, spec] of fs.readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
        if (spec.startsWith('node:')) continue;
        expect(spec.startsWith('.'), `${f} imports ${spec}`).toBe(true);
        expect(path.resolve(path.dirname(f), spec).startsWith(NODE_DIR), `${f} imports ${spec}`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run it.** Expected: guard 3 FAILS and prints the real digest. Put that digest into `verbs.json`'s
  `ownsSha256` and run again. Expected: PASS.
- [ ] **Step 3: Measure each guard red.** For each guard, apply its mutation, run, see red, and revert:
  1. add `x: 1,` inside `MODULES`;
  2. change `'node'` to `'nodex'` in `ccd-twin-caps.test.ts`;
  3. add a comment line inside `cmd_caps` in `ccd/ccd`;
  4. add `import '../../shared/redact.mjs';` to `caps.mjs`.

  Record the four red results under **Deviations found** only if one did not go red. That means the guard is broken:
  fix it before going on.
- [ ] **Step 4: Put the twin under the copy scans.** Add `path.join(ccrcRoot, 'ccd', 'node')` to `ROOTS` in
  `server/test/single-definition/helpers.ts`, so a copy of `shared/` vocabulary in the twin is caught like one in
  `server/src`. Run `./node_modules/.bin/vitest run test/single-definition/`. Expected: PASS.
  - If `sources()` skips `.mjs` files, widen its filter to include them. Run the suite again.
  - If that run turns some unrelated scan red, revert both changes and record a `D-TBD-twin-roots` deviation instead.
    Name the scan.

- [ ] **Step 5: Commit.**

```bash
git add server/test/ccd-twin-table.test.ts ccd/node/verbs.json server/test/single-definition/helpers.ts
git commit -m "test(ccd): the Node twin table's guards: modules, parity tests, the owned bash, imports"
```

### Task 9: CI selection and the Windows check

**Files:**
- Modify, only if the check in Step 1 shows it is needed: `.github/ci/select-tests.mjs`.

- [ ] **Step 1: Check the fast pull-request selection.** Push the branch and open a pull request. In its `plan fast
  server tests` summary, check that a change under `ccd/node/` selects these four test files:
  `ccd-twin-caps.test.ts`, `ccd-twin-table.test.ts`, `ccd-twin-entry.test.ts` and `ccd-twin-lock.test.ts`. The tests
  spawn the twin rather than import it, except `caps.mjs` and `lock.mjs`, which two of them import, so the import
  graph may miss `ccd.mjs`.
  - If any of the four is missing, add `ccd/node/**` to `select-tests.mjs`'s untraced map. Follow the existing
    entries for `ccd/` scripts and point it at those four files.
  - Push again, and confirm the selection in the new summary.
- [ ] **Step 2: Windows bench.** On the Windows box, from MSYS2 with `CCRC_BASH` set, run all four twin test files and
  the entry suites. Expected: PASS.
  - If the twin entry test fails because a `/c/…` path reaches native `node` unconverted, the launcher must pass the
    script path in Windows form. Convert it with `cygpath -w` only when `sys.platform in ('msys', 'cygwin')`, add a
    test for it through the platform seam, and record it under **Deviations found**.
- [ ] **Step 3: Live box.** Deploy (`ccrc update`) and leave every caps reader unchanged. Then:
  - run `ccd caps` from the manager's PATH three times and record the time of each run, next to wave 0's figure for
    caps;
  - confirm that `ccd caps` ends with `node:caps`;
  - confirm that the server's boot no longer misses caps: Accounts must not say the fleet host needs an update after a
    restart.

  Target: under 2 s, on a box in the measuring conditions of Task 3.
- [ ] **Step 4:** Touch `~/.cc-sessions/ccd-node-off` and confirm that `ccd caps` now prints the bash list with no
  `node:caps` line. Remove the file.
- [ ] **Step 5:** Write the figures into **Results of wave 1**, below. Push once, with the code, the tests and this
  plan's notes.

---

## Deviations found

(none yet)

## Results of wave 0

(filled by Task 3)

## Results of wave 1

(filled by Task 9)
