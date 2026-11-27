/**
 * The session hook's prune deny (cleanup un-wedge, Task R3; spec 2026-11-04 §5, decisions D9 to D11): on EVERY session
 * (a dispatched child and a top-level session, each on the main thread and in a subagent) the PreToolUse arm denies a
 * repository-wide `git worktree prune`. That command deletes git's record of every gone worktree of the repository at
 * once, and ccd's cleanup reads those records, so one session's prune holds the cleanup of every lane on the box. A
 * dry run (`-n`, `--dry-run`) deletes nothing and passes, and so does every other `worktree` or `prune` command: the
 * two lists in `fixtures/prune-deny/` are iterated, never respelled here.
 *
 * It is an accident guard, not a wall: `bash -c` with an assembled string, a script file, an alias, `eval`, a `$VAR`
 * program and `git gc` (which prunes records past `gc.worktreePruneExpire`) all run past it.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME (`session-hook-account-deny.test.ts`'s harness). Never the
 * live HOME.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { scaled } from './timeScale.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const FIX = path.resolve(__dirname, 'fixtures/prune-deny');
const MUST_DENY: string[] = JSON.parse(fs.readFileSync(path.join(FIX, 'must-deny.json'), 'utf8'));
const MUST_ALLOW: string[] = JSON.parse(fs.readFileSync(path.join(FIX, 'must-allow.json'), 'utf8'));
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const TOP = 'project-a-calm-mesa';
const CHILD = 'project-a-quiet-basin';
/** A neutral `cwd`: one naming `prune` would pass the prefilter for every call and leave it untested. */
const CWD = '/srv/work/project-a';
const SUB = { agent_id: 'a0000000000000001', agent_type: 'general-purpose' };
const CALLERS: ReadonlyArray<[string, string, Record<string, unknown>]> = [
  ['a child, main thread', CHILD, {}], ['a child, subagent', CHILD, SUB],
  ['a top-level session, main thread', TOP, {}], ['a top-level session, subagent', TOP, SUB],
];

/** A fixture HOME with a top-level row and a dispatched child, and a `tmux` that answers the pane's session. */
const makeHome = (prefix: string): string => {
  const home = mkTmp(prefix);
  const reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  for (const id of [TOP, CHILD]) fs.writeFileSync(path.join(reg, `${id}.generation`), GENERATION);
  fs.writeFileSync(path.join(reg, `${CHILD}.child`), '7');
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nprintf "cc-%s\\n" "${TMUX_PANE#%}"\n', { mode: 0o755 });
  return home;
};
let home: string;
beforeAll(() => { home = makeHome('ccrc-prunedeny-hook-'); });
afterAll(() => { fs.rmSync(home, { recursive: true, force: true }); });

const hookEnv = (h: string, id: string): NodeJS.ProcessEnv => ({
  ...process.env, HOME: h, PATH: `${path.join(h, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: `%${id}`, CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
});
const payload = (command: string, extra: Record<string, unknown>): string =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: CWD, ...extra });

type Envelope = { hookSpecificOutput: { hookEventName?: string; permissionDecision?: string; permissionDecisionReason?: string } };
/** The deny reason in one run's stdout, or null when nothing was denied. */
const denyOf = (stdout: string): string | null => {
  const line = stdout.trim();
  if (line === '') return null;
  expect(line.split('\n'), 'one envelope').toHaveLength(1);
  const env = JSON.parse(line) as Envelope;
  expect(env.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  return env.hookSpecificOutput.permissionDecision === 'deny' ? String(env.hookSpecificOutput.permissionDecisionReason) : null;
};
/** One PreToolUse event through the real hook. */
const fire = (h: string, id: string, command: string, extra: Record<string, unknown> = {}): string | null => {
  const r = spawnSync('bash', [HOOK], { input: payload(command, extra), encoding: 'utf8', env: hookEnv(h, id) });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  return denyOf(r.stdout);
};
/** Many events at once, a few processes in flight: each one's deny reason or null, or the contract breach. */
const fireMany = async (id: string, extra: Record<string, unknown>, commands: readonly string[]): Promise<Array<string | null>> => {
  const out: Array<string | null> = new Array(commands.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < commands.length) {
      const i = next++;
      const [code, so, se] = await new Promise<[number | null, string, string]>((resolve, reject) => {
        const p = spawn('bash', [HOOK], { env: hookEnv(home, id) });
        let o = ''; let e = '';
        p.stdout.on('data', (d: Buffer) => { o += d.toString(); });
        p.stderr.on('data', (d: Buffer) => { e += d.toString(); });
        p.on('error', reject);
        p.on('close', (c) => resolve([c, o, e]));
        p.stdin.end(payload(commands[i]!, extra));
      });
      expect(code, `the hook contract: exit 0 on ${JSON.stringify(commands[i])}`).toBe(0);
      expect(se, `the hook contract: silent on stderr on ${JSON.stringify(commands[i])}`).toBe('');
      out[i] = denyOf(so);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
};

describe('the prune deny refuses a repo-wide git worktree prune on every session', () => {
  it('the fixture lists are the plan\'s, and neither is empty', () => {
    for (const c of ['git worktree prune', 'git worktree prune -v', 'git worktree prune --expire now', 'git -C project-a worktree prune',
      'git --git-dir=project-a/.git worktree prune', 'git -c core.x=y worktree prune', '/usr/bin/git worktree prune',
      'cd project-a && git worktree prune', 'git status; git worktree prune', "g''it worktree prune", 'git worktree prune\necho done']) {
      expect(MUST_DENY, c).toContain(c);
    }
    for (const c of ['git worktree prune -n', 'git worktree prune --dry-run', 'git worktree prune --dry-run -v', 'git worktree list',
      'git worktree list --porcelain', 'git worktree remove project-a/x', 'git worktree remove --force project-a/x',
      'git remote prune origin', 'git fetch --prune', 'npm prune', 'git worktree add ../x -b x']) {
      expect(MUST_ALLOW, c).toContain(c);
    }
  });

  for (const [caller, id, extra] of CALLERS) {
    const top = id === TOP;
    it(`every must-deny command is denied on ${top ? 'a top-level session' : 'a child'} (${caller}), with the prune reason`, async () => {
      const got = await fireMany(id, extra, MUST_DENY);
      const missed = MUST_DENY.filter((_c, i) => got[i] === null);
      expect(missed, 'allowed, but on the must-deny list').toEqual([]);
      for (const [i, reason] of got.entries()) {
        expect(reason, MUST_DENY[i]).toContain('`git worktree prune`');
        expect(reason, MUST_DENY[i]).toContain('git -C <main> worktree remove <path>');
        expect(reason, MUST_DENY[i]).toContain('(`-n`) is allowed');
        expect(reason, MUST_DENY[i]).toContain('`git commit -F <file>`');
        expect(reason, MUST_DENY[i]).toContain('`gh pr create --body-file <file>`');
      }
    }, 120_000);

    it(`every must-allow command passes on ${caller}`, async () => {
      const got = await fireMany(id, extra, MUST_ALLOW);
      const denied = MUST_ALLOW.flatMap((c, i) => (got[i] === null ? [] : [`${c}: ${got[i]}`]));
      expect(denied, 'denied, but on the must-allow list').toEqual([]);
    }, 120_000);
  }

  it('a deny already set is never replaced: an admin merge that also prunes keeps the merge reason', () => {
    for (const id of [CHILD, TOP]) {
      const reason = fire(home, id, 'gh pr merge 42 --admin && git worktree prune');
      // A child is refused any merge (landing-order R5), a top-level session the admin merge.
      expect(reason, id).toContain(id === CHILD ? 'never merges' : '`--admin` and `gh api` merges are refused');
      expect(reason, id).not.toContain('git -C <main> worktree remove <path>');
    }
  });
});

describe('the prune deny\'s budget: a payload naming no prune forks no jq for it', () => {
  let h: string;
  beforeAll(() => {
    h = makeHome('ccrc-prunedeny-jq-');
    const real = (process.env['PATH'] ?? '').split(':').map((d) => path.join(d, 'jq')).find((p) => fs.existsSync(p));
    if (real === undefined) throw new Error('no jq on PATH');
    // A `jq` first on PATH that logs the forbidden program's calls (the only jq the hook passes `--arg mode`), then runs
    // the real one.
    fs.writeFileSync(path.join(h, 'bin', 'jq'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = mode ] && echo forbidden >> "${path.join(h, 'jq.calls')}"; done\nexec ${real} "$@"\n`,
      { mode: 0o755 });
  });
  afterAll(() => { fs.rmSync(h, { recursive: true, force: true }); });
  const calls = (id: string, command: string): number => {
    fs.rmSync(path.join(h, 'jq.calls'), { force: true });
    fire(h, id, command);
    const f = path.join(h, 'jq.calls');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '').length : 0;
  };

  for (const [name, id] of [['a child', CHILD], ['a top-level session', TOP]] as const) {
    it(`${name}: \`git status\` runs no forbidden-program jq, and \`git worktree prune\` runs exactly one`, () => {
      expect(calls(id, 'git status'), 'git status').toBe(0);
      expect(calls(id, 'git worktree list'), 'git worktree list').toBe(0);
      expect(calls(id, 'git worktree prune'), 'the control: the prefilter lets prune through').toBe(1);
    });
  }
});

// Review 1479, F6: this PR's own body, in the two shapes a session sends it, is not refused by the prune row. The
// account arm refuses both on every session for another reason (the body names a backticked `env`, which reads as
// printing the whole environment), which is main's and outside this task, so the check is the prune row's alone.
describe('this PR\'s own body is not refused by the prune row', () => {
  const OWN: string[] = JSON.parse(fs.readFileSync(path.join(FIX, 'own-pr-body.json'), 'utf8'));
  for (const [caller, id, extra] of CALLERS) {
    it(`${caller}: no prune reason`, () => {
      for (const c of OWN) expect(fire(home, id, c, extra) ?? '', c.slice(0, 60)).not.toContain('git -C <main> worktree remove <path>');
    });
  }
});

// D-8334: the cost cases below measure work, never wall time. On a loaded merge-queue shard the wall time of one jq
// run swung by seconds (a small run relatively quick, a large one relatively slow) and a doubling ratio read 4.18x
// against a 4.04x bound while the current program was faster than the original at both sizes. A process queued for a
// CPU accrues no CPU time, so the CPU the run itself spent (user plus system, as bash's `times` reports it for the
// children it waited on) is one invocation's cost with the queueing taken out. It is still one invocation, jq's
// startup included, so the FD8 ruling's shape and its bounds are unchanged: only what is read off the clock is.
//
// D-8354: the input reaches the run from a FILE, never through `spawnSync`'s `input`. On macOS a detached `spawnSync`
// (which `spawnSyncGroup` is) that writes a 128 KB `input` into the child's stdin socket now and then delivers every
// byte and never the end of input: in 8 of 6000 such runs of `cat` on a hosted macOS runner the child had read all
// 131 161 bytes and sat in `read(2)` on its stdin while node waited in `kevent`, until the timeout (none in 6000
// attached runs). The daily run's red, one jq run past the 120 s timeout with nothing on its stderr beside a normal
// 64 KB case, is inferred to be that hang from its matching symptoms. A regular file ends where it ends, so the run's
// CPU, the thing measured, is unchanged.
type CpuRun = { status: number | null; stdout: string; stderr: string; cpuMs: number };
/** `argv` run once under bash, `input` on its stdin (from a file): its status, its own output, and the CPU time it spent. */
const childCpu = (argv: readonly string[], input: string, timeoutMs = scaled(120_000)): CpuRun => {
  const dir = mkTmp('ccrc-prunedeny-cpu-');
  const file = path.join(dir, 'stdin');
  fs.writeFileSync(file, input);
  const fd = fs.openSync(file, 'r');
  // `times`' second line is the waited children's user and system time; it goes to stderr, after the run's own.
  // In a process group of its own (#896), so a timeout takes the jq it waits on with it.
  let r: ReturnType<typeof spawnSyncGroup>;
  try {
    r = spawnSyncGroup('bash', ['-c', '"$@"; s=$?; times >&2; exit $s', 'bash', ...argv],
      { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 26, timeout: timeoutMs, env: { ...process.env, LC_ALL: 'C' } });
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const lines = (r.stderr ?? '').replace(/\n$/, '').split('\n');
  const m = /^(\d+)m(\d+(?:\.\d+)?)s (\d+)m(\d+(?:\.\d+)?)s$/.exec(lines.at(-1) ?? '');
  expect(m, `bash's times line, after ${JSON.stringify(r.stderr)}${r.error === undefined ? '' : `: ${String(r.error)}`}`).not.toBeNull();
  const [, um, us, sm, ss] = m as RegExpExecArray;
  const cpuMs = Math.round((Number(um) * 60 + Number(us) + Number(sm) * 60 + Number(ss)) * 1000);
  const own = lines.slice(0, -2).join('\n');
  return { status: r.status, stdout: r.stdout ?? '', stderr: own === '' ? '' : `${own}\n`, cpuMs };
};

describe('the cost measure is the work a run did, not the time it waited (D-8334)', () => {
  it('a run that waits half a second reads near zero, while its wall time holds the wait', () => {
    const t0 = process.hrtime.bigint();
    const r = childCpu(['sleep', '0.5'], '');
    const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(r.status, r.stderr).toBe(0);
    expect(wallMs).toBeGreaterThanOrEqual(500);
    expect(r.cpuMs, `cpu ${r.cpuMs} ms against wall ${wallMs} ms`).toBeLessThan(100);
  });

  it('a run that computes reads its compute, and passes its output and status through untouched', () => {
    const r = childCpu(['jq', '-n', 'reduce range(3000000) as $i (0; .+1)'], '');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('3000000');
    expect(r.stderr).toBe('');
    expect(r.cpuMs).toBeGreaterThan(20);
    const bad = childCpu(['jq', '-n', 'error("x")'], '');
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('x');
  });

  it('a run reads its input from a regular file, whole, never from a socket node writes (D-8354)', () => {
    const big = 'x'.repeat(200 * 1024);
    const r = childCpu(['sh', '-c', 'test -f /dev/stdin || { echo "stdin is not a regular file" >&2; exit 3; }; wc -c'], big);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(String(big.length));
  });
});

/** One round of a linearity row: the CPU ms of the original at the small size, the current program at the small
 * size, the original at the large size and the current program at the large size. */
type Round = readonly [number, number, number, number];
/** How many rounds a linearity row measures (D-9118). */
const LINEARITY_ROUNDS = 4;
/** Which program a sample is of. */
type Program = 'original' | 'current';
/** Which program runs first at each size in round `i`: the original on even rounds, the current one on odd rounds, so
 * neither program's large sample is always the last of a round (D-9118). */
const linearityOrder = (i: number): Program => (i % 2 === 0 ? 'original' : 'current');
/** One size of round `i` (D-9118): runs the two programs back to back, the first as `linearityOrder(i)` says, and puts
 * each sample in its own program's cell, [original, current], whichever ran first. `run` measures one program once.
 * Pure but for `run`, so a case pins the order and the cells with no CPU measured. */
const pairCells = (i: number, run: (p: Program) => number): [number, number] => {
  const first = linearityOrder(i);
  const a = run(first);
  const b = run(first === 'original' ? 'current' : 'original');
  return first === 'original' ? [a, b] : [b, a];
};
/** D-9118's verdict. The original's ratio is read off the faster of all rounds, cell by cell, as before; the bound is
 * FD8's (that ratio plus 0.5, or 2.5 where the original is below it). The current program's ratio is the original's
 * plus the MEDIAN of the per-round differences (current large / current small less original large / original small),
 * each difference taken from samples measured back to back, so a change of load between rounds moves one difference,
 * not the verdict. */
const linearityVerdict = (rounds: readonly Round[]): {
  referenceRatio: number; bound: number; differences: number[]; currentRatio: number; red: boolean;
} => {
  const fastest = (i: number): number => Math.min(...rounds.map((r) => r[i]));
  const referenceRatio = fastest(2) / fastest(0);
  const bound = referenceRatio > 2.5 ? referenceRatio + 0.5 : 2.5;
  const differences = rounds.map(([rs, cs, rl, cl]) => cl / cs - rl / rs);
  const sorted = [...differences].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const currentRatio = referenceRatio + median;
  return { referenceRatio, bound, differences, currentRatio, red: currentRatio > bound };
};

// D-9118: the linearity rows' estimator, pinned on recorded samples with no CPU measured. `linearity-windows.json` holds
// two windows of four rounds each, CPU ms as [original small, current small, original large, current large], measured
// with jq 1.7.1 on the fleet box on 2026-11-26 at ambient load: `ambient` is main's program, whose first two rounds
// read red under the faster-of-two that D-8334 used and are green under the median; `cubic` is main's program plus a
// cubic step (about 18% of its cost at 32 KB), red under both. Numbers only. The two windows keep their verdicts under a
// mean or a minimum of the per-round differences too, so they tell the median from the faster of two only: the synthetic
// case ("…the median of an even count as the mean of the middle two") is the one that pins the median against a mean or
// a minimum. `pairCells`' case pins the order and the cells the measuring rows run through (review 4009 F2).
describe('the linearity verdict is the median of the per-round differences (D-9118)', () => {
  const WINDOWS: Record<'ambient' | 'cubic', Round[]> = JSON.parse(fs.readFileSync(path.join(FIX, 'linearity-windows.json'), 'utf8'));
  /** D-8334's reading: the faster of the first two rounds, cell by cell, and the same bound. */
  const fasterOfTwo = (rounds: readonly Round[]): { currentRatio: number; bound: number } => {
    const [rs, cs, rl, cl] = [0, 1, 2, 3].map((i) => Math.min(...rounds.slice(0, 2).map((r) => r[i]))) as [number, number, number, number];
    const referenceRatio = rl / rs;
    return { currentRatio: cl / cs, bound: referenceRatio > 2.5 ? referenceRatio + 0.5 : 2.5 };
  };

  it('both windows hold four rounds of four positive numbers', () => {
    for (const w of Object.values(WINDOWS)) {
      expect(w).toHaveLength(LINEARITY_ROUNDS);
      for (const r of w) { expect(r).toHaveLength(4); for (const ms of r) expect(ms).toBeGreaterThan(0); }
    }
  });

  it('an ambient window the faster of two reads red is green under the median', () => {
    const old = fasterOfTwo(WINDOWS.ambient);
    expect(old.currentRatio, 'the recorded window is red under the faster of two').toBeGreaterThan(old.bound);
    const v = linearityVerdict(WINDOWS.ambient);
    expect(v.red).toBe(false);
    expect(v.currentRatio).toBeLessThanOrEqual(v.bound);
  });

  it('a cubic step is red under both', () => {
    const old = fasterOfTwo(WINDOWS.cubic);
    expect(old.currentRatio).toBeGreaterThan(old.bound);
    const v = linearityVerdict(WINDOWS.cubic);
    expect(v.red).toBe(true);
    expect(v.currentRatio).toBeGreaterThan(v.bound);
  });

  it('reads the original ratio off the faster of all rounds, the bound as FD8 set it, and the median of an even count as the mean of the middle two', () => {
    const rounds: Round[] = [[100, 100, 400, 410], [90, 100, 380, 600], [100, 90, 400, 360], [120, 100, 500, 420]];
    const v = linearityVerdict(rounds);
    expect(v.referenceRatio).toBeCloseTo(380 / 90, 12);
    expect(v.bound).toBeCloseTo(380 / 90 + 0.5, 12);
    expect(v.differences.map((d) => +d.toFixed(6))).toEqual([0.1, 1.777778, 0, 0.033333]);
    expect(v.currentRatio).toBeCloseTo(v.referenceRatio + (1 / 30 + 0.1) / 2, 12);
    const low = linearityVerdict([[100, 100, 200, 240], [100, 100, 200, 240], [100, 100, 200, 240], [100, 100, 200, 240]]);
    expect(low.bound, 'an original below 2.5x keeps the 2.5x bound').toBe(2.5);
    expect(low.red).toBe(false);
    expect(linearityVerdict([[100, 100, 200, 260], [100, 100, 200, 260], [100, 100, 200, 260], [100, 100, 200, 260]]).red).toBe(true);
  });

  it('alternates which program runs first, so across the rounds each is last at a size as often as the other', () => {
    const order = Array.from({ length: LINEARITY_ROUNDS }, (_, i) => linearityOrder(i));
    expect(order).toEqual(['original', 'current', 'original', 'current']);
    const lastCurrent = order.filter((first) => first === 'original').length;
    expect(lastCurrent).toBe(LINEARITY_ROUNDS - lastCurrent);
  });

  it('runs each round\'s pair in that round\'s order and puts each sample in its own program\'s cell, in both orders (pairCells)', () => {
    const programs = { original: 'the original program text', current: 'the current program text' } as const;
    for (let i = 0; i < LINEARITY_ROUNDS; i++) {
      const calls: string[] = [];
      // A sample reads its program (original 10s, current 20s) plus its place in the round's run order (1 or 2).
      const cells = pairCells(i, programs, (text) => { calls.push(text); return (text === programs.original ? 10 : 20) + calls.length; });
      const first = linearityOrder(i);
      expect(calls, `round ${i} runs ${first} first`)
        .toEqual(first === 'original' ? [programs.original, programs.current] : [programs.current, programs.original]);
      expect(cells, `round ${i}'s cells are [original, current]`).toEqual(first === 'original' ? [11, 22] : [12, 21]);
    }
  });
});

// Review 1493, FD8/R3/R4: compare the actual original program, not a synthetic reference or the presence of pmatch.
// The original is VENDORED, byte for byte, in `fixtures/prune-deny/forbidden-jq-33e521e07.jq`: it is the
// APPROVAL_FORBIDDEN_JQ of the hook as it stood before this deny, extracted with `extract` below. It was first read by
// `git show` of a commit that lived on a workspace branch only; a squash merge leaves branch commits off main and the
// branch is deleted on merge, so no clone could reach it and eight cases went red on main (D-8001's repair). Never cite
// a branch-only sha from a test: vendor the baseline with a pinned hash. The sha256 is pinned in one constant, so an
// edit of the fixture reds, and a missing or unreadable fixture reds as a failing case, never a skip.
// No hook is executed here: both embedded jq programs receive JSON text. Each mode, shape and size is a single
// invocation (startup included). The coordinator's FD8 ruling accepts fixed jq startup cost and pinned both historical
// cost and doubling-size scaling against the original; it does not permit an amortized stream comparison. What is
// pinned now (D-9141): the four linearity rows pin doubling-size scaling against the original; the four 64 KB cost rows
// pin cost against the hook's program at the gate; no row bounds cost against the original any more. `ROW_BASELINE`
// says which row reads which, and a case pins it. The CI follow-up uses 32/64 KB only for quotes/deny, whose inherited
// normalization otherwise outlives its case.
//
// What each row can see (measured 2026-11-26 with jq 1.7.1 on main c435573bc4, after the quiz row's gate 06aed21ff7,
// and by review 4009 with jq 1.8.1; task note docs/superpowers/programs/desktop-polish/hook-cost-row.md). The 64 KB
// cost rows take the faster of two interleaved measurements (D-8334), the baseline first in both pairs, and catch a
// cost of ANY shape once the path costs about 1.5x its baseline, today's program (D-9141). On the deny path the
// measured bracket reads red from about +68% of the gated program's cost on a loaded box (one program's own 64 KB CPU
// spread about 30% there), with an edge near +50% hosted: a quadratic step adding about 80% of the gated program's cost
// at 64 KB reads 15.5 s against a 13.4 s bound, red. (Against the original, which the gated program costs 0.75x of,
// the same row let the cost about double: that step read green, and one adding about 105% sat at the bound.) A class
// cost row's bound is its baseline (about 35 to 70 ms, one jq start-up) plus the 100 ms class floor, about 166 ms
// hosted (about 2.5x): a class path dearer by less than the floor is green (+80 ms green, +120 ms red here, through
// this file). The linearity rows catch only growth FASTER than the programs' own: on the
// quote-dense deny shape both programs are almost pure n^2 (a fixed ~0.2 s plus c n^2, the n^2 term about 98% of the
// fitted cost at 32 and 64 KB and 95% of the original's measured 3.9 s at 32 KB), so their 64/32 ratio sits near 3.9
// and a quadratic step, of any weight, leaves it there. The smallest growth the linearity row catches reliably is a
// cubic step adding about 30% of the current program's cost at 32 KB (red in 24 of 24 windows; 20%: 15 of 24; a third:
// red, 5.12 against 4.31). The quotes/class linearity row sees no quadratic step of any weight either, because the
// original's class path is itself quadratic on the quotes input (its bound, 4.40x, is above n^2's 4.0): a class path 6x
// dearer read green there (review 4009); only the dqsub/class linearity row sees one (3.86x against 2.5x). On the
// quotes shape a quadratic class step shows only in the quotes/class cost row, once it is dearer than the floor. What
// the suite does not see: a quadratic step on the deny path adding less than about half of its cost at 64 KB, and on
// the class path a step dearer by less than the 100 ms floor. D-9141 tightened two bounds (hosted: quotes/deny about
// 27 s to 20.7 s; quotes/class about 6.7 s, which it read 0.01 of, to about 166 ms) and WIDENED two (dqsub/class 81 to
// about 168 ms; dqsub/deny 310.5 to 352.5 ms, because the gated program costs more than the original on the dqsub shape).
//
// D-9118 (amending D-8334 for the linearity rows only): a linearity row measures LINEARITY_ROUNDS rounds, reverses which
// program runs first on alternate rounds, and reads the current program's ratio as the original's plus the MEDIAN of the
// per-round differences (`linearityVerdict`). The faster of two let one change of CPU contention inside a round decide
// the row: CPU time is not contention-proof on a shared core, and the current program's large sample was always the
// last of a round, so contention rising just before it read as worse scaling (hosted reds of 1-2% over the bound, the
// difference's mean -0.03 over 104 hosted runs; at ambient load on the fleet box 2 reds in 26 windows before, 0 in 24
// after). THE LIMIT, measured, not removed: a load that switches on and off with a period near one 64 KB sample (12
// spinners, 13 s on and 12 s off) still reds the row before and after (5 of 18 windows before, 6 of 16 after); no
// estimator over four rounds survives it, and nothing here retries a red. By design the median hides a one-round
// spike, and it sees one that lands in two of the four rounds only above about 1.25x; the alternation halves a slowdown
// that comes with running second. On a box at load 20 to 40 the row reads red on about 1 to 3 runs in 100 with nothing
// wrong (one round's difference has an sd of about 0.4 there; one such red, at jq 1.8.1, read 1.148, 0.189, 0.845,
// 0.563): that rate is for independent rounds, and a lower bound where one contention episode spans rounds, as it did
// there. On hosted runners it is predicted far lower, which a hosted run can bound but not prove. A red is re-run alone
// on a quiet box before it is believed.
// TIME: four rounds double the linearity rows' time. The row nearest its timeout is quotes/class linearity: at most
// 227 s of its 300 s on the fleet box under load after the gate (median 116 s), about 90 s hosted (0.30). quotes/deny
// linearity took at most 440 s of its 600 s there (median 211 s; before the gate 266 s and 416 s over 50 runs at load 13
// to 49), 168 s hosted. A run on a box at load 20 or more may pass two thirds of its timeout; the timeouts are unchanged.
describe('the forbidden program\'s cost on quote-dense payloads naming worktree and prune', () => {
  const extract = (src: string): string => (/^APPROVAL_FORBIDDEN_JQ='([^']*)'$/m.exec(src) ?? [])[1] ?? '';
  const prog = extract(fs.readFileSync(HOOK, 'utf8'));
  /** The sha256 of the vendored baseline's bytes. */
  const BASELINE_SHA256 = 'aa24afe9ff29c1f912cf5c1c8045f541ad45d6070c358c571d40c4d8d715262f';
  // D-9141 (the hook owner's ruling, its call 1562): the 64 KB cost rows read a baseline of their own, the hook's
  // forbidden program as main had it at the gate's merge, 06aed21ff7 (the quiz row asked one linear anchor first); the
  // linearity rows keep the original above. The two files answer two rulings: inherited scaling against the program the
  // deny was added to (FD8), and today's accepted cost; each is frozen by its own hash and named by its commit, and a
  // test cannot read a commit through git (D-8001). Replace this file only on the owner's next ruling on accepted cost,
  // with the program at the commit that ruling names, never to turn a row green.
  /** The sha256 of `APPROVAL_FORBIDDEN_JQ` extracted with `extract` from `ccd/session-hook.sh` at 06aed21ff7. */
  const COST_BASELINE_SHA256 = '9a8a7a7a89536aeac1e7e056b4c75b7ec734493031d505eae529f53cc68aa595';
  /** The two vendored programs a row may read: FD8's original and D-9141's program at the gate, each held by its hash. */
  const BASELINES = {
    original: { fixture: 'forbidden-jq-33e521e07.jq', sha256: BASELINE_SHA256, edited: 'the vendored baseline was edited' },
    gate: { fixture: 'forbidden-jq-06aed21ff.jq', sha256: COST_BASELINE_SHA256, edited: 'the vendored cost baseline was edited' },
  } as const;
  type Baseline = keyof typeof BASELINES;
  /** A vendored program: a missing, unreadable or edited fixture throws here, inside the case that reads it. */
  const readVendored = (b: Baseline): string => {
    const bytes = fs.readFileSync(path.join(FIX, BASELINES[b].fixture));
    expect(createHash('sha256').update(bytes).digest('hex'), BASELINES[b].edited).toBe(BASELINES[b].sha256);
    return bytes.toString('utf8');
  };
  type Row = `${'quotes' | 'dqsub'}/${'deny' | 'class'} ${'cost' | 'linearity'}`;
  /** Which baseline each of the eight rows reads. The measuring cases read theirs only through this table (`baselineOf`),
   * and a case that measures nothing pins it, so a row moved to the other program reds there (review 4009 F2). */
  const ROW_BASELINE: Record<Row, Baseline> = {
    'quotes/deny cost': 'gate', 'quotes/class cost': 'gate', 'dqsub/deny cost': 'gate', 'dqsub/class cost': 'gate',
    'quotes/deny linearity': 'original', 'quotes/class linearity': 'original',
    'dqsub/deny linearity': 'original', 'dqsub/class linearity': 'original',
  };
  const baselineOf = (row: Row): string => readVendored(ROW_BASELINE[row]);
  /** The allowance a 64 KB cost row grants over the baseline beside its factor of 1.5: the bound is
   * max(1.5 x baseline, baseline + floor). The deny path keeps FD8's 25 ms. The class path costs about one jq start-up
   * (about 35 to 70 ms on the gated program), where 25 ms is start-up jitter (hosted, dqsub/class read up to 0.95 of
   * its bound on the original). The owner's ruling (D-9141, its call 1643 amending call 1562) gives it a floor of its
   * own, 100 ms, for one reason: to keep run-to-run noise off the bound. A class path dearer by less than the floor is
   * green (the header above). The owner's rule for the value: on hosted runs each class row's reading less its own
   * baseline stays at or under 50 ms, half the floor; were one over, the floor would be 150 ms. */
  const COST_FLOOR_MS = { deny: 25, class: 100 } as const;
  it('the cost baseline is the hook\'s forbidden program at 06aed21ff7, held by its hash, and is not the original (D-9141)', () => {
    const cost = readVendored('gate');
    expect(cost).not.toBe('');
    expect(cost, 'the two baselines answer two rulings').not.toBe(readVendored('original'));
    expect(cost.startsWith('def WS:'), 'a forbidden program, as `extract` returns it').toBe(true);
  });
  it('each row reads the baseline its ruling names: the four cost rows the program at the gate (D-9141), the four linearity rows the original (FD8)', () => {
    expect(BASELINES.original.fixture).toBe('forbidden-jq-33e521e07.jq');
    expect(BASELINES.gate.fixture).toBe('forbidden-jq-06aed21ff.jq');
    const rows = (['quotes', 'dqsub'] as const).flatMap((name) => (['deny', 'class'] as const)
      .flatMap((mode) => (['cost', 'linearity'] as const).map((kind): Row => `${name}/${mode} ${kind}`)));
    expect(Object.keys(ROW_BASELINE).sort(), 'one entry for each of the eight rows').toEqual([...rows].sort());
    for (const row of rows) expect(ROW_BASELINE[row], row).toBe(row.endsWith(' cost') ? 'gate' : 'original');
  });
  it('each row\'s two programs are its baseline from the table in the original\'s cell and the hook\'s program in the current one (programsOf)', () => {
    for (const row of Object.keys(ROW_BASELINE) as Row[]) {
      const p = programsOf(row);
      expect(p.original, `${row}: the original's cell holds the row's baseline`).toBe(readVendored(ROW_BASELINE[row]));
      expect(p.current, `${row}: the current cell holds the hook's program`).toBe(prog);
      expect(p.original, `${row}: two different programs`).not.toBe(p.current);
    }
  });
  // review 4016 F1: a scan of this file's own code (comments taken out), for what the pins above cannot see, the places
  // that use the table and the cells. It reads text, not behaviour: it cannot see a fixture read some other way than the
  // one accessor (an alias, a helper of another name, a path built at run time), a measuring case outside the two
  // bodies it finds by their titles, or code that means the same but is spelt otherwise; what `programsOf`, `pairCells`
  // and `timed` do is pinned by their own cases and the rows' figures, not here. Its needles are split so that this
  // case's own text never matches them.
  it('the measuring cases take their programs only through programsOf, each by its own row, and the linearity rows pair through pairCells (a scan of this file)', () => {
    const code = fs.readFileSync(path.join(__dirname, 'session-hook-prune-deny.test.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const count = (text: string, needle: string): number => text.split(needle).length - 1;
    const body = (title: string, end: string): string => {
      const at = code.indexOf(title);
      expect(at, `the case titled …${title}`).toBeGreaterThan(-1);
      expect(count(code, title), `one case titled …${title}`).toBe(1);
      const stop = code.indexOf(end, at);
      expect(stop, `the end of the case titled …${title}`).toBeGreaterThan(at);
      return code.slice(at, stop);
    };
    const cost = body('stays within the startup-adjusted 06aed21ff bound at 64 KB' + '`', '}, scaled(' + '300_000)');
    const linearity = body('KB stays within the inherited-cost bound' + '`', '}, scaled(' + 'smallKb');
    const vendored = 'readVendored' + '(';
    const programsFor = (kind: 'cost' | 'linearity'): string => 'programsOf' + '(`${name}/${mode} ' + kind + '`)';
    expect(count(code, vendored), 'a vendored program is read in programsOf, the hash case and the programsOf case only').toBe(4);
    for (const [kind, b] of [['cost', cost], ['linearity', linearity]] as const) {
      expect(count(b, vendored), `the ${kind} case reads no vendored program itself`).toBe(0);
      expect(count(b, 'programsOf' + '('), `the ${kind} case asks programsOf once`).toBe(1);
      expect(count(b, programsFor(kind)), `the ${kind} case asks for its own row`).toBe(1);
    }
    expect(count(cost, 'timed' + '('), 'the cost case times its two programs, nothing else').toBe(2);
    expect(count(cost, 'timed' + '(reference, mode, 64)') + count(cost, 'timed' + '(current, mode, 64)')).toBe(2);
    expect(count(linearity, 'pairCells' + '(i, programs, (text) => timed(text, mode, kb))'),
      'the linearity case pairs through pairCells, its callback running the text it is given').toBe(1);
    expect(count(linearity, 'timed' + '('), 'the linearity case times nothing outside pairCells').toBe(1);
  });
  for (const [name, unit, quoted] of [['quotes', 'a "b c" \'d\' \\e ', false], ['dqsub', '$(x) `y` ', true]] as const) {
    const timed = (p: string, mode: string, kb: number): number => {
      const dense = unit.repeat(Math.floor((kb * 1024) / unit.length));
      const command = `git worktree list --porcelain; echo prune ${quoted ? `"${dense}"` : dense}`;
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
      const r = childCpu(['jq', '-r', '--arg', 'q', "'", '--arg', 'mode', mode, p], input);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('');
      return r.cpuMs;
    };
    for (const mode of ['deny', 'class'] as const) {
      it(`${name}: ${mode} stays within the startup-adjusted 06aed21ff bound at 64 KB`, () => {
        const reference = baselineOf(`${name}/${mode} cost`);
        expect(reference).not.toBe('');
        expect(prog).not.toBe('');
        const pairs = [0, 1].map(() => [timed(reference, mode, 64), timed(prog, mode, 64)]);
        const referenceMs = Math.min(...pairs.map((p) => p[0] as number));
        const currentMs = Math.min(...pairs.map((p) => p[1] as number));
        const bound = Math.max(1.5 * referenceMs, referenceMs + COST_FLOOR_MS[mode]);
        const measured = `${name}/${mode} 64 KB: current ${currentMs} cpu ms, baseline ${referenceMs} cpu ms, bound ${bound} cpu ms`;
        console.info(measured);
        expect(currentMs, measured).toBeLessThanOrEqual(bound);
      }, scaled(300_000));
      const smallKb = name === 'quotes' && mode === 'deny' ? 32 : 64;
      const largeKb = smallKb * 2;
      it(`${name}: ${mode} linearity from ${smallKb} to ${largeKb} KB stays within the inherited-cost bound`, () => {
        const reference = baselineOf(`${name}/${mode} linearity`);
        expect(reference).not.toBe('');
        expect(prog).not.toBe('');
        // D-9118: each pair of samples back to back, the first program alternating by round (`pairCells`).
        const pair = (i: number, kb: number): [number, number] =>
          pairCells(i, (p) => timed(p === 'original' ? reference : prog, mode, kb));
        const rounds = Array.from({ length: LINEARITY_ROUNDS }, (_, i): Round => [...pair(i, smallKb), ...pair(i, largeKb)]);
        const minima = [0, 1, 2, 3].map((i) => Math.min(...rounds.map((r) => r[i])));
        // The coordinator's follow-up rules inherited super-linearity separately: retain 2.5x if the original is
        // below it; otherwise allow the original ratio plus the explicitly accepted 0.5 measurement margin.
        const v = linearityVerdict(rounds);
        const measured = `${name}/${mode}: original ${v.referenceRatio}x, current ${v.currentRatio}x, bound ${v.bound}x; cpu ms ${minima.join(', ')}; `
          + `per-round differences ${v.differences.map((d) => d.toFixed(3)).join(', ')}`;
        console.info(measured);
        expect(v.currentRatio, measured).toBeLessThanOrEqual(v.bound);
      }, scaled(smallKb === 32 ? 600_000 : 300_000));
    }
  }
});
