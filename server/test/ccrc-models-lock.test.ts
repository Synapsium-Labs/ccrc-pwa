// The lane-files lock (auto-advance spec D21): ONE per-lane flock that every write of a lane's model files takes —
// every writing `ccrc models <id>` verb, the hourly refresh's re-materialise and `ccrc codex`'s lane.json ensure
// (`ccrc doctor --fix`'s re-render is measured in ccrc-doctor.test.ts, where its harness lives). Measured through
// real bash and a REAL `flock` holder in another process, never a fake of the lock itself.
//
// CONTAINED. HOME is a `mkTmp` directory and `ccrc` runs from `<home>/ccrc/ccd/ccrc`, the shape a deployed box has.
// `ghContainedEnv` poisons gh and the service managers and curl is poisoned here; nothing in this file starts a tier
// or reaches tmux, `~/.cc-sessions` or a unit. The one other process a case starts is
// `flock <lock> sh -c 'echo held; read _'`, which exits by itself once its stdin closes: no case signals a process.
// The code under test does, twice, and only its own children: `_plat_timeout` ends the bound case's fake node (a
// `sleep` this file's home holds) at its deadline, and its no-coreutils arm ends its own watcher subshell.
// Fixture lanes are `lane-a` (external) and `lane-b` (codex-kind), and every model id is neutral.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { ADV_CATALOGUE, ADV_REGISTRY_BYTES } from './fixtures/advanceCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const HAVE_FLOCK = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'lane-u', label: 'lane-u', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true,
      hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-a', label: 'lane-a', configDirSuffix: '.claude-lane-a', exec: { kind: 'external' }, homeAble: false,
      hue: 'magenta', telemetry: 'none' },
    // Pure-parse ports: nothing in this file connects to either.
    { id: 'lane-b', label: 'lane-b', configDirSuffix: '.claude-lane-b',
      exec: { kind: 'codex', provider: 'openai', proxyPort: 45030, litellmPort: 45031, authDir: codexAuthDir('lane-b') },
      homeAble: false, telemetry: 'codex' },
  ],
};

interface Result { code: number; stdout: string; stderr: string }
const homes: string[] = [];
const holders: ChildProcess[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function release(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once('exit', () => resolve());
    child.stdin!.end();
  });
}

afterEach(async () => {
  for (const c of holders.splice(0)) await release(c);
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function env(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  // A runner's own knobs never steer a case.
  for (const k of ['CCRC_MODELS_LOCK_S', 'CCRC_MODELS_NOW', 'CCRC_CODEX_READY_S', 'CCRC_CODEX_PROBE_S', 'CCGPT_CONFIG']) {
    delete inherited[k];
  }
  const e = ghContainedEnv(h, { ...inherited, HOME: h }, { systemd: true });
  fs.writeFileSync(join(h, '.local', 'bin', 'curl'),
    '#!/bin/sh\necho "the lane-files lock suite must never reach curl" >&2\nexit 97\n', { mode: 0o755 });
  return { ...e, ...extra };
}

/** A box: the tree `ccrc` resolves against (`ccd` files linked one by one, `deploy` and `shared` whole). */
function box(): string {
  const h = mkTmp('ccrc-models-lock-');
  homes.push(h);
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape']) fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  fs.symlinkSync(join(REPO, 'deploy'), join(h, 'ccrc', 'deploy'));
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
  fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), `${JSON.stringify(ROSTER, null, 2)}\n`);
  env(h);
  return h;
}

const lockPath = (h: string, id: string): string => join(h, '.ccrc', 'locks', `models-${id}.lock`);
const regPath = (h: string, id: string): string => join(h, '.ccrc', 'models', `${id}.classes.json`);
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const heldOrFree = (p: string, label: string): string =>
  `if flock -n ${shq(p)} true; then echo "${label} free"; else echo "${label} held"; fi`;

/** Every file under `~/.ccrc/models`, name → bytes: what "nothing was written" is measured against. */
function modelsState(h: string): Record<string, string> {
  const d = join(h, '.ccrc', 'models');
  const out: Record<string, string> = {};
  if (!fs.existsSync(d)) return out;
  for (const n of fs.readdirSync(d).sort()) out[n] = fs.readFileSync(join(d, n), 'utf8');
  return out;
}

/** The neutral fixture lane: its registry and catalogue planted, then the op's own `materialise`. */
function plantLane(h: string, id = 'lane-a'): void {
  const d = join(h, '.ccrc', 'models');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(regPath(h, id), ADV_REGISTRY_BYTES, { mode: 0o600 });
  fs.writeFileSync(join(d, `${id}.json`), JSON.stringify(ADV_CATALOGUE));
  const m = spawnSync(process.execPath, [join(h, 'ccrc', 'deploy', 'models-op.mjs'), 'materialise',
    '--file', join(h, '.ccrc', 'accounts.json'), '--id', id], { env: env(h), encoding: 'utf8' });
  expect(m.status, `${m.stdout}${m.stderr}`).toBe(0);
}

function run(h: string, args: string[], extra: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [join(h, 'ccrc', 'ccd', 'ccrc'), ...args],
    { env: env(h, extra), encoding: 'utf8', input: '', timeout: 120_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function collect(child: ChildProcess): Promise<Result> {
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (d) => { stdout += d; });
  child.stderr!.on('data', (d) => { stderr += d; });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function runAsync(h: string, args: string[], extra: NodeJS.ProcessEnv = {}): { done: () => boolean; result: Promise<Result> } {
  const child = spawn(BASH, [join(h, 'ccrc', 'ccd', 'ccrc'), ...args], { env: env(h, extra), stdio: ['ignore', 'pipe', 'pipe'] });
  let finished = false;
  const result = collect(child).then((r) => { finished = true; return r; });
  return { done: () => finished, result };
}

/** `ccd/ccrc` sourced (its `BASH_SOURCE` guard is for this), then `script`, in one bash. `umask 022` first, so a
 *  mode this file asserts is the code's and not the runner's. `timeout` bounds the whole bash: a case whose mutation
 *  would hang (a FIFO opened for writing) passes a short one, so its red is a prompt empty stdout. */
function lib(h: string, script: string, extra: NodeJS.ProcessEnv = {}, timeout = 120_000): Result {
  const r = spawnSync(BASH, ['-c', `umask 022\n. "${join(h, 'ccrc', 'ccd', 'ccrc')}"\n${script}`],
    { env: env(h, extra), encoding: 'utf8', input: '', timeout });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function libAsync(h: string, script: string, extra: NodeJS.ProcessEnv = {}): Promise<Result> {
  return collect(spawn(BASH, ['-c', `umask 022\n. "${join(h, 'ccrc', 'ccd', 'ccrc')}"\n${script}`],
    { env: env(h, extra), stdio: ['ignore', 'pipe', 'pipe'] }));
}

/** The contract: stdout is EXACTLY one JSON object and nothing else. */
function oneObject(r: Result): Record<string, unknown> {
  const lines = r.stdout.split('\n');
  expect(lines[lines.length - 1], `stdout is not newline-terminated: ${JSON.stringify(r.stdout)}`).toBe('');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one`).toBe(2);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

/** Another writer, outside this suite's bash: a real `flock` on the lane's lock, held until `release`. */
async function holdLock(h: string, id: string): Promise<ChildProcess> {
  fs.mkdirSync(join(h, '.ccrc', 'locks'), { recursive: true, mode: 0o700 });
  const child = spawn('flock', [lockPath(h, id), 'sh', '-c', 'echo held; read _'], { stdio: ['pipe', 'pipe', 'ignore'] });
  holders.push(child);
  await new Promise<void>((resolve, reject) => {
    child.stdout!.once('data', () => resolve());
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`the lock holder exited (${code}) before it held the lock`)));
  });
  return child;
}

/** `env(h)`'s PATH with each of `tools` nowhere on it and nothing else missing (`ccrc-codex.test.ts`'s
 *  `pathWithout`, taking several names). */
function pathWithout(h: string, ...tools: string[]): string {
  const head = join(h, '.local', 'bin');
  const d = join(h, `no-${tools.join('-')}-bin`);
  fs.mkdirSync(d, { recursive: true });
  const seen = new Set<string>(tools);
  for (const dir of (env(h)['PATH'] ?? '').split(':')) {
    if (dir === '' || path.resolve(dir) === head || !fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (seen.has(name)) continue;
      const p = join(dir, name);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        if (!fs.statSync(p).isFile()) continue;
      } catch { continue; }
      seen.add(name);
      fs.symlinkSync(p, join(d, name));
    }
  }
  return `${head}:${d}`;
}

/** Every writing arm of `ccrc models <id>` this build has (Task 6 adds hold, release and revert). Lock-busy is
 *  answered before node, so each argv only has to pass the arm's own usage checks. */
const WRITING_ARMS: [string, string[]][] = [
  ['init', ['init', 'codex']],
  ['set-class', ['set-class', 'fable', 'model-6-delta']],
  ['set-subagent', ['set-subagent', 'haiku']],
  ['set-effort', ['set-effort', 'opus', 'high']],
  ['discovery catalogue', ['discovery', 'catalogue']],
  ['discovery add', ['discovery', 'add', 'model-6-delta']],
  ['discovery rm', ['discovery', 'rm', 'model-6-delta']],
  ['rm', ['rm']],
  ['set-window', ['set-window', 'model-6.1-alpha', '400000']],
  ['clear-window', ['clear-window', 'model-6.1-alpha']],
];

describe.skipIf(!HAVE_FLOCK)('the lane-files lock itself: _codex_lock\'s contract (D21)', () => {
  it('held until _models_unlock, re-entrant for its own lane in the shell and a subshell, released for another lane', () => {
    const h = box();
    const r = lib(h, [
      '_models_lock lane-a; echo "a rc=$? fd=${MODELS_LOCK_FD:+set} id=$MODELS_LOCK_ID"',
      heldOrFree(lockPath(h, 'lane-a'), 'lane-a'),
      'f1="$MODELS_LOCK_FD"; t0=$SECONDS',
      '_models_lock lane-a; echo "again rc=$? same=$([ "$MODELS_LOCK_FD" = "$f1" ] && echo y)"',
      '( _models_lock lane-a; echo "sub rc=$? id=$MODELS_LOCK_ID" )',
      'echo "at-once=$(( SECONDS - t0 < 5 ))"',
      '_models_lock lane-b; echo "b rc=$? id=$MODELS_LOCK_ID"',
      heldOrFree(lockPath(h, 'lane-a'), 'lane-a'),
      heldOrFree(lockPath(h, 'lane-b'), 'lane-b'),
      '_models_unlock; echo "unlock rc=$? fd=[$MODELS_LOCK_FD] id=[$MODELS_LOCK_ID]"',
      heldOrFree(lockPath(h, 'lane-b'), 'lane-b'),
      '_models_unlock; echo "noop rc=$?"',
    ].join('\n'), { CCRC_MODELS_LOCK_S: '1' });
    expect(r.stdout, r.stderr).toBe([
      'a rc=0 fd=set id=lane-a', 'lane-a held', 'again rc=0 same=y', 'sub rc=0 id=lane-a', 'at-once=1',
      'b rc=0 id=lane-b', 'lane-a free', 'lane-b held', 'unlock rc=0 fd=[] id=[]', 'lane-b free', 'noop rc=0', '',
    ].join('\n'));
    expect(r.stderr).toBe('');
  });

  it('lives outside ~/.ccrc/models: ~/.ccrc/locks is 0700 and the lock file 0600, under umask 022 (D-5187)', () => {
    const h = box();
    const r = lib(h, '_models_lock lane-a; echo "rc=$?"; _models_unlock');
    expect(r.stdout, r.stderr).toBe('rc=0\n');
    expect(fs.statSync(join(h, '.ccrc', 'locks')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(lockPath(h, 'lane-a')).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(join(h, '.ccrc', 'models')), 'the lock made the models directory').toBe(false);
  });

  it('a malformed id is refused rc 2, bad-account-id, before any path is built', () => {
    const h = box();
    const r = lib(h, '_models_lock ../x; echo "rc=$? err=$MODELS_LOCK_ERR fd=[${MODELS_LOCK_FD:-}]"');
    expect(r.stdout, r.stderr).toBe('rc=2 err=bad-account-id fd=[]\n');
    expect(fs.existsSync(join(h, '.ccrc', 'locks'))).toBe(false);
  });

  it('_models_node_locked answers a malformed id rc 2 with one bad-account-id object, and never reaches node', () => {
    const h = box();
    // A node that leaves a mark, at the head of PATH: the refusal must come before it.
    fs.writeFileSync(join(h, '.local', 'bin', 'node'), '#!/bin/sh\necho ran >> "$HOME/node-ran"\nexit 0\n', { mode: 0o755 });
    const r = lib(h, '_models_node_locked ../x materialise --file "$(_models_roster_path)" --id ../x; echo "rc=$?"');
    const [body, rc, end] = r.stdout.split('\n');
    expect(rc, r.stdout + r.stderr).toBe('rc=2');
    expect(end).toBe('');
    expect(JSON.parse(body!)).toMatchObject({ ok: false, error: 'bad-account-id' });
    expect(fs.existsSync(join(h, 'node-ran')), 'node ran for a malformed id').toBe(false);
    expect(fs.existsSync(join(h, '.ccrc', 'locks'))).toBe(false);
  });

  it('a missing wrapper-shape contract is install-incomplete, never bad-account-id (D-5204)', () => {
    const h = box();
    fs.rmSync(join(h, 'ccrc', 'ccd', 'ccrc-wrapper-shape'));
    const r = lib(h, 'unset WRAPPER_ID_RE WRAPPER_SUFFIX_SAFE_RE; _models_lock lane-a; echo "rc=$? err=$MODELS_LOCK_ERR"');
    expect(r.stdout, r.stderr).toBe('rc=1 err=install-incomplete\n');
    expect(fs.existsSync(join(h, '.ccrc', 'locks'))).toBe(false);
  });

  it('a directory at the lock path is lock-unwritable, never lock-busy, and is left as it is (D-5204)', () => {
    const h = box();
    fs.mkdirSync(join(h, '.ccrc', 'locks'), { recursive: true });
    fs.mkdirSync(lockPath(h, 'lane-a'));   // a directory where the lock file goes
    const r = lib(h, '_models_lock lane-a; echo "rc=$? err=$MODELS_LOCK_ERR"');
    expect(r.stdout, r.stderr).toBe('rc=1 err=lock-unwritable\n');
    expect(fs.statSync(lockPath(h, 'lane-a')).isDirectory()).toBe(true);
  });

  it('a FIFO at the lock path is lock-unwritable at once and is never opened: opening one for writing would hang the lock (Review Focus: races and locks)', () => {
    const h = box();
    fs.mkdirSync(join(h, '.ccrc', 'locks'), { recursive: true, mode: 0o700 });
    execFileSync('mkfifo', [lockPath(h, 'lane-a')]);
    const t0 = Date.now();
    const r = lib(h, '_models_lock lane-a; echo "rc=$? err=$MODELS_LOCK_ERR fd=[${MODELS_LOCK_FD:-}]"', {}, 10_000);
    expect(r.stdout, r.stderr).toBe('rc=1 err=lock-unwritable fd=[]\n');
    expect(Date.now() - t0, 'the lock waited on the FIFO').toBeLessThan(8_000);
    expect(fs.lstatSync(lockPath(h, 'lane-a')).isFIFO()).toBe(true);
  }, 30_000);

  it('a symlink at the lock path is lock-unwritable, live or dangling: nothing is opened, made or locked through it (D-5204)', () => {
    const h = box();
    fs.mkdirSync(join(h, '.ccrc', 'locks'), { recursive: true, mode: 0o700 });
    const gone = join(h, 'gone-target');
    fs.symlinkSync(gone, lockPath(h, 'lane-a'));
    const live = join(h, 'live-target');
    fs.writeFileSync(live, 'kept\n');
    fs.symlinkSync(live, lockPath(h, 'lane-b'));
    const r = lib(h, [
      '_models_lock lane-a; echo "dangling rc=$? err=$MODELS_LOCK_ERR"',
      '_models_lock lane-b; echo "live rc=$? err=$MODELS_LOCK_ERR"',
      heldOrFree(live, 'target'),
    ].join('\n'));
    expect(r.stdout, r.stderr).toBe('dangling rc=1 err=lock-unwritable\nlive rc=1 err=lock-unwritable\ntarget free\n');
    expect(fs.existsSync(gone), 'the open followed the dangling link and made its target').toBe(false);
    expect(fs.readFileSync(live, 'utf8')).toBe('kept\n');
  });

  it.skipIf(process.getuid?.() === 0)('a lock file this account cannot open is lock-unwritable, never lock-busy (D-5204)', () => {
    const h = box();
    fs.mkdirSync(join(h, '.ccrc', 'locks'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(lockPath(h, 'lane-a'), '', { mode: 0o400 });
    const r = lib(h, '_models_lock lane-a; echo "rc=$? err=$MODELS_LOCK_ERR"');
    expect(r.stdout, r.stderr).toBe('rc=1 err=lock-unwritable\n');
  });

  it('an existing ~/.ccrc/locks is made 0700 at every lock, whatever mode it was left with', () => {
    const h = box();
    const locks = join(h, '.ccrc', 'locks');
    fs.mkdirSync(locks, { recursive: true });
    fs.chmodSync(locks, 0o755);
    const r = lib(h, '_models_lock lane-a; echo "rc=$?"; _models_unlock');
    expect(r.stdout, r.stderr).toBe('rc=0\n');
    expect(fs.statSync(locks).mode & 0o777).toBe(0o700);
  });

  it('an existing ~/.ccrc/locks that cannot be made 0700 is lock-unwritable, and no lock file is made in it: a chmod that fails, as one on a directory another account owns does', () => {
    const h = box();
    const locks = join(h, '.ccrc', 'locks');
    fs.mkdirSync(locks, { recursive: true });
    fs.chmodSync(locks, 0o755);
    // `box()` made ~/.local/bin, the head of every PATH here: this chmod answers as one refused EPERM would.
    fs.writeFileSync(join(h, '.local', 'bin', 'chmod'), '#!/bin/sh\necho "chmod: Operation not permitted" >&2\nexit 1\n',
      { mode: 0o755 });
    const r = lib(h, '_models_lock lane-a; echo "rc=$? err=$MODELS_LOCK_ERR"');
    expect(r.stdout, r.stderr).toBe('rc=1 err=lock-unwritable\n');
    expect(fs.readdirSync(locks)).toEqual([]);
  });

  it('a symlinked ~/.ccrc/locks is lock-unwritable: its target keeps its mode, and no lock file is made through it', () => {
    const h = box();
    const elsewhere = join(h, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.chmodSync(elsewhere, 0o755);
    fs.symlinkSync(elsewhere, join(h, '.ccrc', 'locks'));
    const r = lib(h, '_models_lock lane-a; echo "rc=$? err=$MODELS_LOCK_ERR"');
    expect(r.stdout, r.stderr).toBe('rc=1 err=lock-unwritable\n');
    expect(fs.statSync(elsewhere).mode & 0o777).toBe(0o755);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('a wait outside 1 to 300 s falls back to 20 s, never to a non-blocking try', async () => {
    const h = box();
    const holder = await holdLock(h, 'lane-a');
    const pending = libAsync(h, 't0=$SECONDS; _models_lock lane-a; echo "rc=$? waited=$(( SECONDS - t0 >= 2 ))"',
      { CCRC_MODELS_LOCK_S: '0' });
    await sleep(3000);
    await release(holder);
    const r = await pending;
    expect(r.stdout, r.stderr).toBe('rc=0 waited=1\n');
  }, 60_000);

  it('the one sanctioned nesting: the tier lock held, then the lane lock on the same lane, both held, neither waiting', () => {
    const h = box();
    const tier = join(h, '.ccrc', 'codex', 'lane-b', '.lock');
    const r = lib(h, [
      't0=$SECONDS',
      '_codex_lock lane-b; echo "tier rc=$?"',
      '_models_lock lane-b; echo "files rc=$? id=$MODELS_LOCK_ID"',
      heldOrFree(tier, 'tier'), heldOrFree(lockPath(h, 'lane-b'), 'files'),
      '_models_unlock', heldOrFree(lockPath(h, 'lane-b'), 'files'), heldOrFree(tier, 'tier'),
      '_codex_unlock', heldOrFree(tier, 'tier'),
      'echo "at-once=$(( SECONDS - t0 < 5 ))"',
    ].join('\n'), { CCRC_MODELS_LOCK_S: '1', CCRC_CODEX_READY_S: '1' });
    expect(r.stdout, r.stderr).toBe(['tier rc=0', 'files rc=0 id=lane-b', 'tier held', 'files held', 'files free',
      'tier held', 'tier free', 'at-once=1', ''].join('\n'));
  });
});

// The wait's value, measured: "falls back to 20 s" above proves only a wait of at least 2 s.
describe('the wait: CCRC_MODELS_LOCK_S whole seconds from 1 to 300, else 20 (D21)', () => {
  it('flock is asked to wait the value when it is 1 to 300 whole seconds, and 20 s otherwise', () => {
    const h = box();
    // A recording flock at the head of PATH: it notes the -w it was given and answers as if it took the lock, so
    // each value is measured at once, with no holder and no wait.
    fs.writeFileSync(join(h, '.local', 'bin', 'flock'),
      '#!/bin/sh\n[ "$1" = -w ] && printf \'%s\\n\' "$2" >> "$HOME/flock-w"\nexit 0\n', { mode: 0o755 });
    const r = lib(h, [
      'for v in unset 0 08 300 301 1000 abc; do',
      '  if [ "$v" = unset ]; then unset CCRC_MODELS_LOCK_S; else CCRC_MODELS_LOCK_S="$v"; fi',
      '  : > "$HOME/flock-w"',
      '  _models_lock lane-a; rc=$?',
      '  echo "$v rc=$rc w=$(cat "$HOME/flock-w")"',
      '  _models_unlock',
      'done',
    ].join('\n'));
    expect(r.stdout, r.stderr).toBe(['unset rc=0 w=20', '0 rc=0 w=20', '08 rc=0 w=8', '300 rc=0 w=300',
      '301 rc=0 w=20', '1000 rc=0 w=20', 'abc rc=0 w=20', ''].join('\n'));
    expect(r.stderr).toBe('');
  });

  it("a capture site's bound plus its kill grace ends inside the default wait, so a waiter outlasts a holder whose node hung", () => {
    const src = fs.readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const bound = /^MODELS_NODE_BOUND_S=(\d+)$/m.exec(src);
    const grace = /^ {2}\[ "\$grace" -gt (\d+) \] && grace=\1$/m.exec(src);   // _plat_timeout's kill-grace ceiling
    const wait = /^ {2}bound="\$\{CCRC_MODELS_LOCK_S:-(\d+)\}"$/m.exec(src);   // _models_lock's default wait
    expect(bound, 'ccd/ccrc has no file-scope MODELS_NODE_BOUND_S').not.toBeNull();
    expect(grace, "_plat_timeout has no kill-grace ceiling").not.toBeNull();
    expect(wait, "_models_lock has no default wait").not.toBeNull();
    expect(Number(bound![1]) + Number(grace![1]), `${bound![1]} s + ${grace![1]} s against ${wait![1]} s`)
      .toBeLessThan(Number(wait![1]));
  });
});

describe('with no flock on PATH (D-5201)', () => {
  it('a hand verb answers as today, unserialised, and makes no lock directory', () => {
    const h = box();
    plantLane(h);
    const r = run(h, ['models', 'lane-a', 'set-subagent', 'haiku'], { PATH: pathWithout(h, 'flock') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    expect(JSON.parse(fs.readFileSync(regPath(h, 'lane-a'), 'utf8')).subagent).toBe('haiku');
    expect(fs.existsSync(join(h, '.ccrc', 'locks'))).toBe(false);
  });
});

// `ccrc doctor --fix` re-renders lane.json on the box doctor most needs to work on, one whose PATH has lost
// coreutils (`ccd/ccrc`'s CCRC_HERE note), and ccrc-doctor.test.ts's fixture PATH carries no `mkdir`. The lock's
// first use on a box makes `~/.ccrc/locks`, so there, and only there, it degrades as it does with no flock.
describe.skipIf(!HAVE_FLOCK)('with no mkdir on PATH (D-5205)', () => {
  it('and no ~/.ccrc/locks yet: a hand verb answers as today, unserialised, and makes no lock directory', () => {
    const h = box();
    plantLane(h);
    const r = run(h, ['models', 'lane-a', 'set-subagent', 'haiku'], { PATH: pathWithout(h, 'mkdir') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    expect(JSON.parse(fs.readFileSync(regPath(h, 'lane-a'), 'utf8')).subagent).toBe('haiku');
    expect(fs.existsSync(join(h, '.ccrc', 'locks'))).toBe(false);
  });

  it('but with ~/.ccrc/locks already made, the same PATH takes the lock: lock-busy under a held one, nothing written', async () => {
    const h = box();
    plantLane(h);
    const before = modelsState(h);
    const holder = await holdLock(h, 'lane-a');   // it makes ~/.ccrc/locks, as an earlier writer's first lock would
    const r = run(h, ['models', 'lane-a', 'set-subagent', 'haiku'],
      { PATH: pathWithout(h, 'mkdir'), CCRC_MODELS_LOCK_S: '1' });
    await release(holder);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(oneObject(r)['error']).toBe('lock-busy');
    expect(modelsState(h)).toEqual(before);
  }, 60_000);
});

describe.skipIf(!HAVE_FLOCK)('every writing verb takes the lane lock (D21)', () => {
  it('a writing verb refuses lock-busy at the bound: every arm exits 1 naming the lock, and every model file is as it was', async () => {
    const h = box();
    plantLane(h);
    const before = modelsState(h);
    const holder = await holdLock(h, 'lane-a');
    for (const [name, args] of WRITING_ARMS) {
      const r = run(h, ['models', 'lane-a', ...args], { CCRC_MODELS_LOCK_S: '1' });
      expect(r.code, `${name}: ${r.stdout}${r.stderr}`).toBe(1);
      const b = oneObject(r);
      expect(b['error'], name).toBe('lock-busy');
      expect(String(b['detail']), name).toContain(lockPath(h, 'lane-a'));
      expect(modelsState(h), `${name} wrote under a held lock`).toEqual(before);
    }
    await release(holder);
  }, 120_000);

  it('a writing verb that finds the lane lock held waits for the holder, and lands only after it lets go (Review Focus: races)', async () => {
    const h = box();
    plantLane(h);
    const before = fs.readFileSync(regPath(h, 'lane-a'), 'utf8');
    const holder = await holdLock(h, 'lane-a');
    const verb = runAsync(h, ['models', 'lane-a', 'set-subagent', 'haiku'], { CCRC_MODELS_LOCK_S: '30' });
    await sleep(2000);
    expect(verb.done(), 'the verb answered while another writer held the lane lock').toBe(false);
    expect(fs.readFileSync(regPath(h, 'lane-a'), 'utf8')).toBe(before);
    await release(holder);
    const r = await verb.result;
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(regPath(h, 'lane-a'), 'utf8')).subagent).toBe('haiku');
  }, 60_000);

  it('_models_answer_locked holds the lock while node writes, and releases it before it returns', () => {
    const h = box();
    plantLane(h);
    const r = lib(h, [
      `_models_node() { ${heldOrFree(lockPath(h, 'lane-a'), 'during')} >> "$HOME/lock-probe"; node "$CCRC_HERE/../deploy/models-op.mjs" "$@"; }`,
      '_models_answer_locked lane-a set-subagent --file "$(_models_roster_path)" --id lane-a --class haiku >/dev/null; echo "rc=$?"',
      heldOrFree(lockPath(h, 'lane-a'), 'after'),
    ].join('\n'));
    expect(r.stdout, r.stderr).toBe('rc=0\nafter free\n');
    expect(fs.readFileSync(join(h, 'lock-probe'), 'utf8')).toBe('during held\n');
  });

  it('a wrapper called by a shell that already holds the lane lock releases only what it took, so the holder keeps it (Review Focus: races and locks)', () => {
    const h = box();
    plantLane(h);
    const r = lib(h, [
      '_models_lock lane-a; echo "outer rc=$?"',
      '_models_answer_locked lane-a set-subagent --file "$(_models_roster_path)" --id lane-a --class haiku >/dev/null; echo "answer rc=$?"',
      heldOrFree(lockPath(h, 'lane-a'), 'after answer'),
      '_models_node_locked lane-a materialise --file "$(_models_roster_path)" --id lane-a >/dev/null; echo "node rc=$?"',
      heldOrFree(lockPath(h, 'lane-a'), 'after node'),
      'echo "id=$MODELS_LOCK_ID"',
      '_models_unlock',
      heldOrFree(lockPath(h, 'lane-a'), 'after unlock'),
    ].join('\n'));
    expect(r.stdout, r.stderr).toBe(['outer rc=0', 'answer rc=0', 'after answer held', 'node rc=0', 'after node held',
      'id=lane-a', 'after unlock free', ''].join('\n'));
  });

  it('rm reaps the lane\'s model files and never its lock file', () => {
    const h = box();
    plantLane(h);
    expect(run(h, ['models', 'lane-a', 'set-subagent', 'haiku']).code).toBe(0);
    expect(fs.existsSync(lockPath(h, 'lane-a'))).toBe(true);
    const r = run(h, ['models', 'lane-a', 'rm']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((oneObject(r)['removed'] as string[]).filter((p) => p.endsWith('.lock'))).toEqual([]);
    expect(fs.existsSync(lockPath(h, 'lane-a'))).toBe(true);
  });
});

describe.skipIf(!HAVE_FLOCK)('the capture sites take it too (D21)', () => {
  it("the hourly refresh's re-materialise: held, that lane's row is ok:false naming the lock, and its files stay as they were", async () => {
    const h = box();
    plantLane(h);
    const before = modelsState(h);
    // The probe and the LiteLLM step are not this case's subject: faked, so only the re-materialise runs.
    const call = [
      '_models_refresh_one() { return 0; }',
      '_models_litellm() { echo \'{"ok":true,"op":"litellm","changed":false}\'; }',
      'cmd_models refresh lane-a',
    ].join('\n');
    const holder = await holdLock(h, 'lane-a');
    const busy = lib(h, call, { CCRC_MODELS_LOCK_S: '1' });
    await release(holder);
    expect(busy.code, busy.stdout + busy.stderr).toBe(1);
    const row = (oneObject(busy)['refreshed'] as Record<string, unknown>[])[0]!;
    expect(row['ok']).toBe(false);
    expect(String(row['reason'])).toContain(lockPath(h, 'lane-a'));
    expect(modelsState(h)).toEqual(before);
    // CONTROL: the same refresh with the lock free re-materialises and answers ok.
    const free = lib(h, call);
    expect(free.code, free.stdout + free.stderr).toBe(0);
    expect((oneObject(free)['refreshed'] as Record<string, unknown>[])[0]!['ok']).toBe(true);
  }, 60_000);

  it('_codex_lane_json_ensure: held, it is lane-unwritable naming lock-busy and writes no lane.json', async () => {
    const h = box();
    plantLane(h, 'lane-b');
    const laneJson = join(h, '.ccrc', 'codex', 'lane-b', 'lane.json');
    fs.rmSync(laneJson);
    const holder = await holdLock(h, 'lane-b');
    const busy = lib(h, '_codex_lane_json_ensure lane-b; echo "rc=$?"', { CCRC_MODELS_LOCK_S: '1' });
    await release(holder);
    expect(busy.stdout, busy.stderr).toBe('rc=1\n');
    expect(busy.stderr).toMatch(/^ccrc codex: lane-unwritable: .*lock-busy/m);
    expect(fs.existsSync(laneJson)).toBe(false);
    // CONTROL: free, it renders lane.json.
    const free = lib(h, '_codex_lane_json_ensure lane-b; echo "rc=$?"');
    expect(free.stdout, free.stderr).toBe('rc=0\n');
    expect(fs.existsSync(laneJson)).toBe(true);
  }, 60_000);
});

// The capture sites run unattended (the hourly refresh, `ccrc codex start`, `ccrc doctor --fix`), so their node is
// bounded: a hung one must not hold the lane's lock, and the run, until the unit's own end.
describe.skipIf(!HAVE_FLOCK)("the capture sites' node is bounded, and never carries the lock (D21)", () => {
  it('a node that does not answer is ended at MODELS_NODE_BOUND_S, rc 124, and the lane lock is free once the call returns', () => {
    const h = box();
    // A node that never answers: a `sleep` in this home's ~/.local/bin, the head of every PATH here.
    fs.writeFileSync(join(h, '.local', 'bin', 'node'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
    const t0 = Date.now();
    const r = lib(h, [
      'echo "bound=$MODELS_NODE_BOUND_S"',
      '_models_node_locked lane-a materialise --file "$(_models_roster_path)" --id lane-a; echo "rc=$?"',
      heldOrFree(lockPath(h, 'lane-a'), 'after'),
    ].join('\n'), {}, 50_000);
    const took = Date.now() - t0;
    expect(r.stdout, r.stderr).toBe('bound=10\nrc=124\nafter free\n');
    expect(took, 'the bound fired early').toBeGreaterThanOrEqual(9_000);
    expect(took, 'the node ran past its bound').toBeLessThan(25_000);
  }, 60_000);

  it("with no coreutils timeout, the bound's own watcher never inherits the lock: the lane is free the moment the call returns", () => {
    const h = box();
    plantLane(h);
    // `_plat_timeout`'s pure-bash arm: a watcher subshell sleeps out the bound, and is ended once node answers. Its
    // orphaned `sleep` would hold an inherited lock fd for the whole bound.
    const r = lib(h, [
      '_models_node_locked lane-a materialise --file "$(_models_roster_path)" --id lane-a >/dev/null; echo "rc=$?"',
      heldOrFree(lockPath(h, 'lane-a'), 'after'),
    ].join('\n'), { PATH: pathWithout(h, 'timeout', 'gtimeout') });
    expect(r.stdout, r.stderr).toBe('rc=0\nafter free\n');
  });
});

describe('no writing models-op call runs outside the lane lock (D21)', () => {
  const code = (f: string): string[] =>
    fs.readFileSync(join(REPO, 'ccd', f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#'));
  /** `ccd/ccrc`'s file-scope MODELS_WRITE_OPS, read when a case runs and never while vitest collects this file: a
   *  throw at collection would fail the whole file and hide every other case's own red. */
  const writeOps = (): string[] => {
    const m = /^MODELS_WRITE_OPS="([^"]*)"$/m.exec(fs.readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
    expect(m, 'ccd/ccrc has no file-scope MODELS_WRITE_OPS').not.toBeNull();
    return m![1]!.split(' ').filter(Boolean);
  };

  it('no bare _models_answer or _models_node call names a writing op, or picks its op at run time (materialise --check true excepted)', () => {
    const WRITE_OPS = writeOps();
    expect(WRITE_OPS.length, 'MODELS_WRITE_OPS is empty').toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of ['ccrc', 'ccrc-doctor-checks']) {
      for (const l of code(f)) {
        for (const m of l.matchAll(/\b_models_(?:answer|node)\s+([a-z][a-z-]*)\b/g)) {
          if (!WRITE_OPS.includes(m[1]!)) continue;
          if (m[1] === 'materialise' && /--check true\b/.test(l)) continue;
          offenders.push(`${f}: ${l.trim()}`);
        }
        // An op held in a variable cannot be proved read-only, so it is locked too, however it is spelled ("$op",
        // "${op}", $op). `"$@"` is the two wrappers' own pass-through, which is what holds the lock. A call whose op
        // is continued onto the next line cannot be read here, so it is flagged too.
        if (/\b_models_(?:answer|node)\s+(?!"\$@")"?\$\{?[A-Za-z_]/.test(l)) offenders.push(`${f}: ${l.trim()}`);
        if (/\b_models_(?:answer|node)\s*\\\s*$/.test(l)) offenders.push(`${f}: ${l.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no line runs deploy/models-op.mjs itself but the two the wrappers are built on', () => {
    const DEFS = [
      '_models_node() { node "$CCRC_HERE/../deploy/models-op.mjs" "$@"; }',
      '_plat_timeout "$MODELS_NODE_BOUND_S" node "$CCRC_HERE/../deploy/models-op.mjs" "$@"',
    ];
    // An invocation: `node` with the program as its next word, or the program followed by an argument (a variable,
    // an op word and its first flag, or a line continuation). A sentence that names the file is neither.
    const RUNS = /\bnode\s+["']?[^"'\s]*models-op\.mjs|models-op\.mjs["']?\s+(?:["']?\$|[a-z][a-z-]*\s+--|\\\s*$)/;
    const seen: string[] = [];
    const offenders: string[] = [];
    for (const f of ['ccrc', 'ccrc-doctor-checks']) {
      for (const l of code(f)) {
        if (!RUNS.test(l)) continue;
        if (f === 'ccrc' && DEFS.includes(l.trim())) { seen.push(l.trim()); continue; }
        offenders.push(`${f}: ${l.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(seen.sort(), 'the scan no longer sees the two definitions').toEqual([...DEFS].sort());
  });

  it('and it is looking at something: the locked sites are there, each locking the lane it names in --id', () => {
    const seen = new Set<string>();
    const mismatched: string[] = [];
    for (const f of ['ccrc', 'ccrc-doctor-checks']) {
      for (const l of code(f)) {
        const m = /\b_models_(?:answer|node)_locked "\$([A-Za-z_]+)" ("\$[A-Za-z_]+"|[a-z][a-z-]*)(.*)$/.exec(l);
        if (m === null) continue;
        seen.add(m[2]!);
        const id = /--id "\$([A-Za-z_]+)"/.exec(m[3]!);
        if (id === null || id[1] !== m[1]) mismatched.push(`${f}: ${l.trim()}`);
      }
    }
    expect(mismatched).toEqual([]);
    for (const op of ['init', 'set-class', 'set-subagent', 'set-effort', 'discovery', 'rm', 'set-window',
      'clear-window', 'materialise']) expect([...seen], op).toContain(op);
  });

  it('the lock order never reverses: no lane-files lock function takes the tier lock (_codex_lock)', () => {
    const src = fs.readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    for (const fn of ['_models_lock', '_models_unlock', '_models_answer_locked', '_models_node_locked']) {
      const at = src.indexOf(`\n${fn}() {`);
      expect(at, `${fn} is not defined at file scope in ccd/ccrc`).toBeGreaterThan(0);
      const body = src.slice(at + 1, src.indexOf('\n}\n', at) + 2);
      expect(body, `${fn} takes the tier lock`).not.toMatch(/\b_codex_lock\b/);
    }
  });
});
