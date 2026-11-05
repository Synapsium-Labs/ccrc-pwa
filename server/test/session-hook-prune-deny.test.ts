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
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

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

// Review 1493, FD8/R3/R4: compare the actual original program, not a synthetic reference or the presence of pmatch.
// CI's server checkout carries full history (as the tree-reading guard suites require). No hook is executed here:
// both embedded jq programs receive JSON text. Each mode, shape and size is a single invocation (startup included),
// using the faster of two interleaved measurements. The coordinator's FD8 ruling accepts fixed jq startup cost but
// pins both historical cost and 64-to-128 KB scaling; it does not permit an amortized stream comparison.
describe('the forbidden program\'s cost on quote-dense payloads naming worktree and prune', () => {
  const extract = (src: string): string => (/^APPROVAL_FORBIDDEN_JQ='([^']*)'$/m.exec(src) ?? [])[1] ?? '';
  const prog = extract(fs.readFileSync(HOOK, 'utf8'));
  const old = spawnSync('git', ['show', '33e521e07e7cc8585edade3f5162fc3ee0781457:ccd/session-hook.sh'],
    { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', maxBuffer: 1 << 24 });
  const reference = extract(old.stdout);
  for (const [name, unit, quoted] of [['quotes', 'a "b c" \'d\' \\e ', false], ['dqsub', '$(x) `y` ', true]] as const) {
    const timed = (p: string, mode: string, kb: number): number => {
      const dense = unit.repeat(Math.floor((kb * 1024) / unit.length));
      const command = `git worktree list --porcelain; echo prune ${quoted ? `"${dense}"` : dense}`;
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
      const t0 = process.hrtime.bigint();
      const r = spawnSync('jq', ['-r', '--arg', 'q', "'", '--arg', 'mode', mode, p],
        { input, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 120_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('');
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    for (const mode of ['deny', 'class']) {
      it(`${name}: ${mode} stays within the startup-adjusted 33e521e07 bound at 64 KB`, () => {
        expect(old.status, old.stderr).toBe(0);
        expect(reference).not.toBe('');
        expect(prog).not.toBe('');
        const pairs = [0, 1].map(() => [timed(reference, mode, 64), timed(prog, mode, 64)]);
        const referenceMs = Math.min(...pairs.map((p) => p[0] as number));
        const currentMs = Math.min(...pairs.map((p) => p[1] as number));
        expect(currentMs, `${name}/${mode}: current ${currentMs} ms, original ${referenceMs} ms`)
          .toBeLessThanOrEqual(Math.max(1.5 * referenceMs, referenceMs + 25));
      }, 300_000);
      it(`${name}: ${mode} linearity from 64 to 128 KB stays within the inherited-cost bound`, () => {
        expect(old.status, old.stderr).toBe(0);
        expect(reference).not.toBe('');
        expect(prog).not.toBe('');
        const pairs = [0, 1].map(() => [timed(reference, mode, 64), timed(prog, mode, 64),
          timed(reference, mode, 128), timed(prog, mode, 128)]);
        const minima = [0, 1, 2, 3].map((i) => Math.min(...pairs.map((p) => p[i] as number)));
        const [referenceSmall, smallMs, referenceLarge, largeMs] = minima as [number, number, number, number];
        const referenceRatio = referenceLarge / referenceSmall;
        // The coordinator's follow-up rules inherited super-linearity separately: retain 2.5x if the original is
        // below it; otherwise allow the original ratio plus the explicitly accepted 0.5 measurement margin.
        const bound = referenceRatio > 2.5 ? referenceRatio + 0.5 : 2.5;
        const currentRatio = largeMs / smallMs;
        const measured = `${name}/${mode}: original ${referenceRatio}x, current ${currentRatio}x, bound ${bound}x; ms ${minima.join(', ')}`;
        console.info(measured);
        expect(currentRatio, measured).toBeLessThanOrEqual(bound);
      }, 300_000);
    }
  }
});
