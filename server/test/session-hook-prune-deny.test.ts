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
/** The two program texts a row compares, by the cell each fills. */
type Programs = Readonly<Record<Program, string>>;
/** One size of round `i` (D-9118): runs the two programs' texts back to back, the first as `linearityOrder(i)` says, and
 * puts each sample in its own program's cell, [original, current], whichever ran first. `run` measures one text once.
 * Pure but for `run`, so a case pins the order, the texts and the cells with no CPU measured (review 4016 F1). */
const pairCells = (i: number, programs: Programs, run: (text: string) => number): [number, number] => {
  const first = linearityOrder(i);
  const a = run(programs[first]);
  const b = run(programs[first === 'original' ? 'current' : 'original']);
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
// pin cost against the hook's program at the gate; no row bounds cost against the original any more. The CI follow-up
// uses 32/64 KB only for quotes/deny, whose inherited normalization otherwise outlives its case.
//
// What holds each row's wiring (review 4024 M1). `ROW_BASELINE` says which row reads which program. Between its row's
// programs and its assertion a measuring case does one thing: it calls `costReading` or `linearityReading`, pure but
// for the programs and the timing function it is handed, and `timed` is `timedBy` on the real child runner. HELD BY A
// CASE that burns no CPU: the table; `rowPrograms`; the reader (it returns the bytes it hashed and refuses a wrong
// hash); `timedBy` (it runs the program, mode and payload it is given); and, for all eight rows through stand-ins,
// which program each reading came from, the cell it landed in, the order and the count of calls, and the cost bound.
// HELD BY THE SCAN, which reads text: that each measuring case's body is that one call on the real `programsOf` and
// `timed`, that the three lines composing them hand in the real reader, the hook's program and the real runner, and
// that no name a measuring case reaches is bound twice. HELD BY READING only: what the note lists in §9, among it
// `childCpu`'s own choice of what to run.
//
// What each row can see. The rules are here; the figures are in the task note,
// docs/superpowers/programs/desktop-polish/hook-cost-row.md, by section, so that each figure has one source.
// - The 64 KB cost rows take the faster of two interleaved measurements (D-8334), the baseline first in both pairs.
//   A deny row's bound is 1.5x its baseline, today's program (D-9141), with FD8's 25 ms floor: it catches a cost of
//   ANY shape on the deny path once that path costs about 1.5x the baseline. On a loaded box a quadratic deny step is
//   sure red near +90% of the gated cost and is decided by the baseline sample's own spread between about +28% and
//   +50%; hosted, where the two samples agree to under 1%, the edge is near +50% (note §8).
// - A class row's bound is its baseline plus the 100 ms class floor (`COST_FLOOR_MS`), the owner's: a class cost row
//   misses a class step dearer by less than the floor (note §8 and §9 hold the readings and the +80 ms / +120 ms
//   mutants).
// - The linearity rows catch only growth FASTER than the programs' own. On the quote-dense deny shape both programs are
//   almost pure n^2, so their 64/32 ratio sits near 3.9 and a quadratic step, of any weight, leaves it there; the
//   smallest growth the quotes/deny linearity row catches reliably is a cubic step of about 30% of the current
//   program's cost at 32 KB (note §4 and §6).
// - The quotes/class linearity row sees no quadratic step of any weight either, because the original's class path is
//   itself quadratic on the quotes input (its bound is above n^2's 4.0). The dqsub/class linearity row does see one,
//   and reds it below the floor. So on the quotes shape a quadratic class step shows only in the quotes/class cost
//   row, once it is dearer than the floor (note §8).
// - What no row sees: on the deny path, a quadratic step adding less than about half of its cost at 64 KB; on the
//   class path, a fixed or linear step dearer by less than the floor, and on the quotes shape a quadratic one too.
// - D-9141 tightened the quotes/deny and quotes/class bounds and WIDENED the dqsub/class and dqsub/deny ones (note §8).
//
// D-9118 (amending D-8334 for the linearity rows only): a linearity row measures LINEARITY_ROUNDS rounds, reverses which
// program runs first on alternate rounds, and reads the current program's ratio as the original's plus the MEDIAN of the
// per-round differences (`linearityVerdict`). The faster of two let one change of CPU contention inside a round decide
// the row: CPU time is not contention-proof on a shared core, and the current program's large sample was always the
// last of a round, so contention rising just before it read as worse scaling (note §3, §5 and §6). THE LIMIT, measured,
// not removed: a load that switches on and off with a period near one 64 KB sample still reds the row before and
// after; no estimator over four rounds survives it, and nothing here retries a red. By design the median hides a
// one-round spike and sees a two-round one only above about 1.25x; the alternation halves a slowdown that comes with
// running second. On a box at load 20 to 40 the row reads red on a few runs in 100 with nothing wrong, a rate for
// independent rounds and a lower bound where one contention episode spans rounds; hosted it is predicted far lower,
// which a hosted run can bound but not prove (note §7, with a worked red). A red is re-run alone on a quiet box before
// it is believed.
// TIME: four rounds double the linearity rows' time. Under load a run on a box at load 20 or more may pass two thirds
// of a row's timeout; the row nearest its timeout is quotes/class linearity, hosted too, where it reads near a third
// (note §10). The timeouts are unchanged.
describe('the forbidden program\'s cost on quote-dense payloads naming worktree and prune', () => {
  const extract = (src: string): string => (/^APPROVAL_FORBIDDEN_JQ='([^']*)'$/m.exec(src) ?? [])[1] ?? '';
  const prog = extract(fs.readFileSync(HOOK, 'utf8'));
  /** The sha256 of the vendored baseline's bytes. */
  const BASELINE_SHA256 = 'aa24afe9ff29c1f912cf5c1c8045f541ad45d6070c358c571d40c4d8d715262f';
  // D-9141 (the hook owner's rulings, its calls 1562 and 1643): the 64 KB cost rows read a baseline of their own, the hook's
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
  /** Each vendored program's fixture, its hash and the message a wrong hash refuses with, as `BASELINES` holds them. */
  type Baselines = Readonly<Record<Baseline, { readonly fixture: string; readonly sha256: string; readonly edited: string }>>;
  /** A reader of the vendored programs: `read` gives a fixture's bytes, and the reader returns those same bytes as text
   * once their sha256 is the one `table` pins; a missing, unreadable or edited fixture throws here, inside the case that
   * reads it. Pure but for `read`, so a case feeds it stand-in bytes and pins both halves (review 4024 M1). */
  const vendoredReader = (read: (file: string) => Buffer, table: Baselines) => (b: Baseline): string => {
    const bytes = read(path.join(FIX, table[b].fixture));
    expect(createHash('sha256').update(bytes).digest('hex'), table[b].edited).toBe(table[b].sha256);
    return bytes.toString('utf8');
  };
  const readVendored = vendoredReader((file) => fs.readFileSync(file), BASELINES);
  type Shape = 'quotes' | 'dqsub';
  type Mode = 'deny' | 'class';
  type Row = `${Shape}/${Mode} ${'cost' | 'linearity'}`;
  /** Which baseline each of the eight rows reads. A case that measures nothing pins it, so an edit of this table that
   * moves a row to the other program reds there (review 4009 F2); the stand-in cases of `costReading` and
   * `linearityReading` read it through `rowPrograms` too, so each row's wiring is pinned against it. */
  const ROW_BASELINE: Record<Row, Baseline> = {
    'quotes/deny cost': 'gate', 'quotes/class cost': 'gate', 'dqsub/deny cost': 'gate', 'dqsub/class cost': 'gate',
    'quotes/deny linearity': 'original', 'quotes/class linearity': 'original',
    'dqsub/deny linearity': 'original', 'dqsub/class linearity': 'original',
  };
  /** A row's two programs: its baseline from the table, read by `read`, in the original's cell, and `current` in the
   * current one. Pure but for `read`, so a case pins the mapping with stand-in texts; today the gate's program and the
   * hook's are byte-identical, so the real texts could not tell the two cells apart. */
  const rowPrograms = (read: (b: Baseline) => string, current: string) => (row: Row): Programs =>
    ({ original: read(ROW_BASELINE[row]), current });
  const programsOf = rowPrograms(readVendored, prog);
  /** The allowance a 64 KB cost row grants over the baseline beside its factor of 1.5: the bound is
   * max(1.5 x baseline, baseline + floor). The deny path keeps FD8's 25 ms. The class path costs about one jq start-up
   * (about 35 to 70 ms on the gated program), where 25 ms is start-up jitter (hosted, dqsub/class read up to 0.95 of
   * its bound on the original). The owner's ruling (D-9141, its call 1643 amending call 1562) gives it a floor of its
   * own, 100 ms, for one reason: to keep run-to-run noise off the bound. A class path dearer by less than the floor is
   * green (the header above). The owner's rule for the value: on hosted runs each class row's reading less its own
   * baseline stays at or under 50 ms, half the floor; were one over, the floor would be 150 ms. */
  const COST_FLOOR_MS = { deny: 25, class: 100 } as const;
  /** The two payload shapes: a unit repeated to the size, and whether the command quotes it. */
  const SHAPES: Readonly<Record<Shape, { unit: string; quoted: boolean }>> = {
    quotes: { unit: 'a "b c" \'d\' \\e ', quoted: false },
    dqsub: { unit: '$(x) `y` ', quoted: true },
  };
  /** Where one sample is taken: the payload's shape and size, and the program's mode. */
  type At = { shape: Shape; mode: Mode; kb: number };
  /** Times one program text once at `at`, and answers its CPU ms. */
  type Time = (text: string, at: At) => number;
  /** A child runner of `childCpu`'s shape, so a case can hand `timedBy` a recording one. */
  type Runner = (argv: readonly string[], input: string) => CpuRun;
  /** One sample's input: a Bash call naming worktree and prune, the shape's unit repeated to `kb` KB. */
  const payloadOf = ({ shape, kb }: At): string => {
    const { unit, quoted } = SHAPES[shape];
    const dense = unit.repeat(Math.floor((kb * 1024) / unit.length));
    const command = `git worktree list --porcelain; echo prune ${quoted ? `"${dense}"` : dense}`;
    return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  };
  /** The timing function on `run`: the program text it is given, in `at`'s mode, on `at`'s payload, once; a run that
   * fails or prints refuses. Pure but for `run`, so a case with a recording runner proves it runs what it is given
   * (review 4024 M1, its O3). */
  const timedBy = (run: Runner): Time => (text, at) => {
    const r = run(['jq', '-r', '--arg', 'q', "'", '--arg', 'mode', at.mode, text], payloadOf(at));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('');
    return r.cpuMs;
  };
  const timed = timedBy(childCpu);
  /** A linearity row's two sizes: 32 and 64 KB on the quote-dense deny shape, 64 and 128 KB on the others. */
  const linearityKb = (shape: Shape, mode: Mode): [number, number] => {
    const small = shape === 'quotes' && mode === 'deny' ? 32 : 64;
    return [small, small * 2];
  };
  /** A 64 KB cost row, from its row's programs to the figures its assertion reads (review 4024 M1): the baseline from
   * the table and the hook's program, each timed once at 64 KB in the row's shape and mode, the baseline first, in two
   * pairs; each cell the faster of its two samples (D-8334); the bound max(1.5 x baseline, baseline + the mode's
   * floor). Pure but for `programs` and `time`, so a case runs every cost row on stand-ins and pins which text each
   * reading came from, its cell, the order and the count, with no CPU measured. */
  const costReading = (shape: Shape, mode: Mode, programs: (row: Row) => Programs, time: Time):
  { referenceMs: number; currentMs: number; bound: number; measured: string } => {
    const { original: reference, current } = programs(`${shape}/${mode} cost`);
    expect(reference).not.toBe('');
    expect(current).not.toBe('');
    const at: At = { shape, mode, kb: 64 };
    const pairs = [0, 1].map(() => [time(reference, at), time(current, at)]);
    const referenceMs = Math.min(...pairs.map((p) => p[0] as number));
    const currentMs = Math.min(...pairs.map((p) => p[1] as number));
    const bound = Math.max(1.5 * referenceMs, referenceMs + COST_FLOOR_MS[mode]);
    const measured = `${shape}/${mode} 64 KB: current ${currentMs} cpu ms, baseline ${referenceMs} cpu ms, bound ${bound} cpu ms`;
    return { referenceMs, currentMs, bound, measured };
  };
  /** A linearity row, from its row's programs to the verdict its assertion reads (review 4024 M1): LINEARITY_ROUNDS
   * rounds, each a pair at the small size then a pair at the large one, each pair through `pairCells` (D-9118), so each
   * sample lands in its own program's cell; then `linearityVerdict`. Pure but for `programs` and `time`, so a case runs
   * every linearity row on stand-ins and pins which text each sample came from, its size, its cell, the order and the
   * count, with no CPU measured. */
  const linearityReading = (shape: Shape, mode: Mode, programs: (row: Row) => Programs, time: Time):
  { rounds: Round[]; verdict: ReturnType<typeof linearityVerdict>; measured: string } => {
    const both = programs(`${shape}/${mode} linearity`);
    expect(both.original).not.toBe('');
    expect(both.current).not.toBe('');
    const [smallKb, largeKb] = linearityKb(shape, mode);
    // D-9118: each pair of samples back to back, the first program alternating by round (`pairCells`).
    const pair = (i: number, kb: number): [number, number] => pairCells(i, both, (text) => time(text, { shape, mode, kb }));
    const rounds = Array.from({ length: LINEARITY_ROUNDS }, (_, i): Round => [...pair(i, smallKb), ...pair(i, largeKb)]);
    const minima = [0, 1, 2, 3].map((i) => Math.min(...rounds.map((r) => r[i])));
    // The coordinator's follow-up rules inherited super-linearity separately: retain 2.5x if the original is
    // below it; otherwise allow the original ratio plus the explicitly accepted 0.5 measurement margin.
    const verdict = linearityVerdict(rounds);
    const measured = `${shape}/${mode}: original ${verdict.referenceRatio}x, current ${verdict.currentRatio}x, bound ${verdict.bound}x; cpu ms ${minima.join(', ')}; `
      + `per-round differences ${verdict.differences.map((d) => d.toFixed(3)).join(', ')}`;
    return { rounds, verdict, measured };
  };
  const SHAPE_NAMES = ['quotes', 'dqsub'] as const;
  const MODES = ['deny', 'class'] as const;
  /** Stand-in program texts: each row's baseline by name, and the hook's program. */
  const standInPrograms = rowPrograms((b) => `the vendored ${b} program`, 'the hook\'s program');
  const STAND_IN = { original: 'the vendored original program', gate: 'the vendored gate program', hook: 'the hook\'s program' } as const;
  /** A recording timing function. Its answer is derived from the text it is given (1, 2 or 3 million for the original,
   * the gate's program and the hook's; 9 million for any other), plus the size times 1000, plus 100 less the call's
   * place: a later sample of the same program reads faster, so a reading that keeps an earlier sample over the faster
   * one reds. */
  const recordingTime = (calls: Array<[string, At]>): Time => (text, at) => {
    calls.push([text, { ...at }]);
    const code = text === STAND_IN.original ? 1 : text === STAND_IN.gate ? 2 : text === STAND_IN.hook ? 3 : 9;
    return code * 1_000_000 + at.kb * 1000 + 100 - calls.length;
  };
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
    const of = rowPrograms((b) => `the vendored ${b} program`, 'the hook\'s program');
    for (const row of Object.keys(ROW_BASELINE) as Row[]) {
      expect(of(row), row).toEqual({ original: `the vendored ${ROW_BASELINE[row]} program`, current: 'the hook\'s program' });
    }
  });
  it('the reader returns the very bytes it hashed, read from the fixture the table names, and refuses a wrong hash (vendoredReader)', () => {
    const asked: string[] = [];
    const read = (file: string): Buffer => { asked.push(file); return Buffer.from(`the bytes of ${path.basename(file)}`); };
    const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
    const table: Baselines = {
      original: { fixture: 'o.jq', sha256: sha('the bytes of o.jq'), edited: 'original edited' },
      gate: { fixture: 'g.jq', sha256: sha('the bytes of g.jq'), edited: 'gate edited' },
    };
    const reader = vendoredReader(read, table);
    expect(reader('original')).toBe('the bytes of o.jq');
    expect(reader('gate')).toBe('the bytes of g.jq');
    expect(asked).toEqual([path.join(FIX, 'o.jq'), path.join(FIX, 'g.jq')]);
    const wrong = vendoredReader(read, { ...table, gate: { ...table.gate, sha256: sha('other bytes') } });
    expect(() => wrong('gate'), 'a wrong hash refuses').toThrow('gate edited');
    expect(wrong('original'), 'the other fixture still reads').toBe('the bytes of o.jq');
  });
  it('the timing function runs the program text it is given, in the mode it is given, on the payload of the shape and size it is given, once (timedBy)', () => {
    const want: Record<Shape, (kb: number) => string> = {
      quotes: (kb) => 'a "b c" \'d\' \\e '.repeat(Math.floor((kb * 1024) / 15)),
      dqsub: (kb) => `"${'$(x) `y` '.repeat(Math.floor((kb * 1024) / 9))}"`,
    };
    for (const shape of SHAPE_NAMES) for (const mode of MODES) for (const kb of [32, 64, 128]) {
      const runs: Array<[readonly string[], string]> = [];
      const time = timedBy((argv, input) => { runs.push([argv, input]); return { status: 0, stdout: '\n', stderr: '', cpuMs: (argv.at(-1) ?? '').length }; });
      const text = `a program for ${shape} ${mode} at ${kb} KB`;
      expect(time(text, { shape, mode, kb }), 'it answers the run\'s CPU ms').toBe(text.length);
      expect(runs.map(([argv]) => argv), `${shape}/${mode} ${kb} KB: the argv`)
        .toEqual([['jq', '-r', '--arg', 'q', "'", '--arg', 'mode', mode, text]]);
      const command = (JSON.parse(runs[0]![1]) as { tool_input: { command: string } }).tool_input.command;
      expect(command, `${shape}/${mode} ${kb} KB: the payload`).toBe(`git worktree list --porcelain; echo prune ${want[shape](kb)}`);
    }
    const failing = timedBy(() => ({ status: 3, stdout: '', stderr: 'jq: error', cpuMs: 1 }));
    expect(() => failing('p', { shape: 'quotes', mode: 'deny', kb: 32 }), 'a failed run refuses').toThrow('jq: error');
    const printing = timedBy(() => ({ status: 0, stdout: 'deny reason\n', stderr: '', cpuMs: 1 }));
    expect(() => printing('p', { shape: 'quotes', mode: 'deny', kb: 32 }), 'a run that prints refuses').toThrow();
  });
  it('each cost row times its baseline from the table and the hook\'s program once each at 64 KB in its shape and mode, the baseline first, in two pairs, each in its own cell (costReading)', () => {
    for (const shape of SHAPE_NAMES) for (const mode of MODES) {
      const row = `${shape}/${mode} cost`;
      const calls: Array<[string, At]> = [];
      const r = costReading(shape, mode, standInPrograms, recordingTime(calls));
      const at: At = { shape, mode, kb: 64 };
      expect(calls, `${row}: what it ran, where, in which order, how often`)
        .toEqual([[STAND_IN.gate, at], [STAND_IN.hook, at], [STAND_IN.gate, at], [STAND_IN.hook, at]]);
      expect({ referenceMs: r.referenceMs, currentMs: r.currentMs }, `${row}: each cell the faster of its own program's two`)
        .toEqual({ referenceMs: 2_064_097, currentMs: 3_064_096 });
    }
  });
  it('a cost row\'s bound is 1.5x its baseline, or its baseline plus its mode\'s floor where that is more: 25 ms deny, 100 ms class (costReading)', () => {
    const fixed = (referenceMs: number, currentMs: number): Time => (text) => (text === STAND_IN.hook ? currentMs : referenceMs);
    const cases: Array<[Mode, number, number]> = [
      ['deny', 40, 65], ['deny', 1000, 1500], ['class', 40, 140], ['class', 300, 450], ['class', 1000, 1500],
    ];
    for (const [mode, referenceMs, bound] of cases) {
      const r = costReading('quotes', mode, standInPrograms, fixed(referenceMs, 7));
      expect(r.bound, `${mode}, baseline ${referenceMs}`).toBe(bound);
    }
    expect(costReading('dqsub', 'class', standInPrograms, fixed(52, 63)).measured)
      .toBe('dqsub/class 64 KB: current 63 cpu ms, baseline 52 cpu ms, bound 152 cpu ms');
  });
  it('each linearity row runs four rounds, each a pair at its small size then its large one, the first program alternating, each sample in its own program\'s cell (linearityReading)', () => {
    const sizes: Record<string, [number, number]> = {
      'quotes/deny': [32, 64], 'quotes/class': [64, 128], 'dqsub/deny': [64, 128], 'dqsub/class': [64, 128],
    };
    const first = ['original', 'current', 'original', 'current'] as const;
    expect(LINEARITY_ROUNDS, 'one expected order per round').toBe(first.length);
    const text = { original: STAND_IN.original, current: STAND_IN.hook } as const;
    for (const shape of SHAPE_NAMES) for (const mode of MODES) {
      const row = `${shape}/${mode} linearity`;
      const calls: Array<[string, At]> = [];
      const r = linearityReading(shape, mode, standInPrograms, recordingTime(calls));
      const wantCalls: Array<[string, At]> = [];
      const wantRounds: number[][] = [];
      for (let i = 0; i < LINEARITY_ROUNDS; i++) {
        const round: number[] = [];
        for (const kb of sizes[`${shape}/${mode}`]!) {
          const order = first[i] === 'original' ? (['original', 'current'] as const) : (['current', 'original'] as const);
          const cell: Record<'original' | 'current', number> = { original: 0, current: 0 };
          for (const p of order) {
            wantCalls.push([text[p], { shape, mode, kb }]);
            cell[p] = (p === 'original' ? 1 : 3) * 1_000_000 + kb * 1000 + 100 - wantCalls.length;
          }
          round.push(cell.original, cell.current);
        }
        wantRounds.push(round);
      }
      expect(calls, `${row}: what it ran, where, in which order, how often`).toEqual(wantCalls);
      expect(r.rounds, `${row}: each round [original small, current small, original large, current large]`).toEqual(wantRounds);
      const v = linearityVerdict(wantRounds as unknown as Round[]);
      expect(r.verdict, `${row}: the verdict is linearityVerdict's on those rounds`).toEqual(v);
      const fastest = [0, 1, 2, 3].map((c) => Math.min(...wantRounds.map((w) => w[c]!)));
      expect(r.measured, `${row}: the printed line, each cell the fastest of its four`).toBe(`${shape}/${mode}: original ${v.referenceRatio}x, `
        + `current ${v.currentRatio}x, bound ${v.bound}x; cpu ms ${fastest.join(', ')}; per-round differences ${v.differences.map((d) => d.toFixed(3)).join(', ')}`);
    }
  });
  // review 4016 F1, narrowed by review 4024 M1: a scan of this file's own code, for what a case that runs the wiring
  // cannot see, whether the measuring cases use it. It holds three things. Each measuring case's body, whitespace aside,
  // is its one call of `costReading` or `linearityReading` on the real `programsOf` and `timed`, and its assertion. The
  // three lines that compose those hand in the real reader, the hook's program and the real runner. And each name a
  // measuring case reaches is written a fixed number of times in the file, so a second binding (a shadow in the loop)
  // or a new use reds. It reads text: a crossing spelt so that every line and count stays the same is not seen, and
  // the note's §9 names the ones known. Comments are taken out only where they start a line (`//` or `/*` after
  // indentation): a string or template line that starts with a comment opener would be misread, and a comment after
  // code is read as code (it reds a count, loudly); today the file holds neither. Its needles carry a `~`, which
  // `unsplit` takes out, so this case's own text never matches them.
  it('a measuring case reaches its programs through the table and nothing else: its body is one call on the real reader and runner, and no name it reaches is bound twice (a scan of this file)', () => {
    const code = fs.readFileSync(__filename, 'utf8').replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');
    const unsplit = (s: string): string => s.split('~').join('');
    const count = (text: string, needle: string): number => text.split(needle).length - 1;
    const flat = (s: string): string => s.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
    const body = (title: string, end: string): string => {
      const at = code.indexOf(title);
      expect(at, `the case titled …${title}`).toBeGreaterThan(-1);
      expect(count(code, title), `one case titled …${title}`).toBe(1);
      const stop = code.indexOf(end, at);
      expect(stop, `the end of the case titled …${title}`).toBeGreaterThan(at);
      return code.slice(at + title.length, stop);
    };
    const cost = body(unsplit('stays within the startup-adjusted 06aed21ff bound at 64 KB~`'), unsplit('}, scaled(~300_000)'));
    const linearity = body(unsplit('KB stays within the inherited-cost bound~`'), unsplit('}, scaled(~smallKb'));
    expect(flat(cost), 'the cost case\'s body').toBe(flat(unsplit(`, () => {
      const r = cost~Reading(name, mode, programs~Of, tim~ed);
      console.info(r.measured);
      expect(r.currentMs, r.measured).toBeLessThanOrEqual(r.bound);`)));
    expect(flat(linearity), 'the linearity case\'s body').toBe(flat(unsplit(`, () => {
      const r = linearity~Reading(name, mode, programs~Of, tim~ed);
      console.info(r.measured);
      expect(r.verdict.currentRatio, r.measured).toBeLessThanOrEqual(r.verdict.bound);`)));
    for (const line of ['const read~Vendored = vendored~Reader((file) => fs.readFileSync(file), BASELINES);',
      'const programs~Of = row~Programs(read~Vendored, pr~og);', 'const tim~ed = ti~medBy(child~Cpu);']) {
      expect(count(code, unsplit(line)), `composed once, on the real one: ${unsplit(line)}`).toBe(1);
    }
    const uses: Record<string, number> = {
      'programs~Of': 4, 'tim~ed': 3, 'cost~Reading': 7, 'linearity~Reading': 4, 'row~Programs': 4, 'read~Vendored': 4,
      'vendored~Reader': 5, 'ti~medBy': 6, 'child~Cpu': 6, 'pair~Cells': 4, 'linearity~Verdict': 10, 'pr~og': 2,
    };
    for (const [split, n] of Object.entries(uses)) {
      const name = unsplit(split);
      expect(code.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0,
        `${name} is written this many times, test titles included: one more is a second binding (a shadow), a new use or a retitled case; a new use that goes through the table, or a retitle, updates this count`)
        .toBe(n);
    }
  });
  for (const name of SHAPE_NAMES) {
    for (const mode of MODES) {
      it(`${name}: ${mode} stays within the startup-adjusted 06aed21ff bound at 64 KB`, () => {
        const r = costReading(name, mode, programsOf, timed);
        console.info(r.measured);
        expect(r.currentMs, r.measured).toBeLessThanOrEqual(r.bound);
      }, scaled(300_000));
      const [smallKb, largeKb] = linearityKb(name, mode);
      it(`${name}: ${mode} linearity from ${smallKb} to ${largeKb} KB stays within the inherited-cost bound`, () => {
        const r = linearityReading(name, mode, programsOf, timed);
        console.info(r.measured);
        expect(r.verdict.currentRatio, r.measured).toBeLessThanOrEqual(r.verdict.bound);
      }, scaled(smallKb === 32 ? 600_000 : 300_000));
    }
  }
});
