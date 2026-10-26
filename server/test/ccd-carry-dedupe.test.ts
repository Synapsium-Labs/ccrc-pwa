/**
 * `ccd carry-dedupe` (#317 items 3-4): the stale transcript copies a swap carry
 * leaves on every account a session passed through are collected, one uuid at
 * a time, only where a keeper is certain and the copy is proved redundant.
 *
 * THE DEFECT. `_swap_carry_jsonl` copies the transcript (it is appended to, so
 * it is never a hardlink) and never removes the source, so every account a
 * session visited keeps a full stale copy. This verb is the after-the-fact
 * collector; dropping the source right after a carry is wave 2.
 *
 * WHAT THIS FILE PINS (red on a tree without the verb): the dry run changes
 * nothing and prices the reclaim; `--apply` unlinks only a non-keeper copy whose
 * bytes are a prefix of the keeper's or whose message uuids the keeper holds;
 * a tie, a divergence, a recent carry and a held carry slot each refuse by
 * name, and a refusal is all or nothing for its uuid (a proved copy beside a
 * diverged or recent one is not unlinked, no sidecar is linked);
 * `--identical-only` leaves a proved copy that is not byte-identical, counted; and so does a carry that lands while the run is going (a swap.log line
 * past the start, or a `cp -p` copy: old mtime, new ctime); identical sidecar files become one inode through the #338 link route,
 * and with no route they are left and counted; the live session's transcript
 * is never touched. The refusal words are a closed vocabulary, spelled once.
 *
 * Fixture HOMEs only (`makeCcdHarness`); the mount geometry is the shared fake
 * kernel's (`fixtures/fakeMountKernel.ts`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, CCD } from './ccdWsHelpers.js';
import { bindFixture, plantFakeKernel } from './fixtures/fakeMountKernel.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-carry-dedupe-'); });
afterEach(() => { h.cleanup(); });

const UUID = 'c3a10e57-5555-4bcc-b60b-0cfc0dc3d199';
const PDIR = '-w-quiet-mesa';
/** Three days ago: outside the default 24-hour window. */
const OLD = Math.floor(Date.now() / 1000) - 3 * 86400;

/** Every refusal word a case here saw, checked against the vocabulary at the foot. */
const produced = new Set<string>();

const transcript = (cfg: string): string => path.join(h.home, cfg, 'projects', PDIR, `${UUID}.jsonl`);
const sidecar = (cfg: string, rel: string): string => path.join(h.home, cfg, 'projects', PDIR, UUID, rel);
const put = (p: string, body: string, mtime = OLD): string => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  fs.utimesSync(p, mtime, mtime);
  return p;
};
/** `n` transcript lines, each carrying a message uuid, `pad` bytes of text apiece. */
const lines = (ids: string[], pad = 40): string =>
  ids.map((id) => `${JSON.stringify({ type: 'user', uuid: id, text: 'x'.repeat(pad) })}\n`).join('');
const ids = (n: number, from = 0): string[] => Array.from({ length: n }, (_, i) => `m-${from + i}`);
/** A registry row for the uuid on `wrapper`. */
const row = (id: string, wrapper: string): void => {
  const reg = path.join(h.home, '.cc-sessions');
  fs.writeFileSync(path.join(reg, `${id}.uuid`), UUID);
  fs.writeFileSync(path.join(reg, `${id}.wrapper`), wrapper);
};
const ino = (p: string): number => fs.statSync(p).ino;
const swapLog = (): string => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const dedupeLines = (): string[] => swapLog().split('\n').filter((l) => / carry-dedupe /.test(l));

/** The verb, with `live` the one registry id `_alive` answers true for. Returns stdout and the exit code. */
const run = (args: string, o: { live?: string; env?: Record<string, string>; pre?: string } = {}): { out: string; rc: number } => {
  const alive = o.live ? `_alive() { [[ "$1" == '${o.live}' ]]; };` : '_alive() { return 1; };';
  const out = h.sh(`${alive} ${o.pre ?? ''} cmd_carry_dedupe ${args}; echo "rc=$?"`, o.env ?? {});
  const m = /\nrc=(\d+)$/.exec(`\n${out}`);
  return { out, rc: Number(m![1]) };
};
/** The refusal column of the uuid's table row. */
const refusal = (out: string): string => {
  const r = out.split('\n').find((l) => l.startsWith(UUID));
  expect(r, out).toBeDefined();
  const w = r!.trim().split(/\s+/).at(-1)!;
  if (w !== '-') produced.add(w);
  return w;
};

describe('ccd carry-dedupe: the keeper and the transcript proof', () => {
  it('(a) a 10 KB copy on A, its 12 KB superset on B, live on B: dry run prices A and deletes nothing; --apply unlinks A, keeps B', () => {
    const body = lines(ids(400), 20);
    expect(body.length).toBeGreaterThan(10_000);
    const small = body.slice(0, 10_000);
    put(transcript('.claude'), small);
    put(transcript('.claude-d'), `${small}${'y'.repeat(2_000)}`);
    row('sess-b', 'claude-d');

    const dry = run('', { live: 'sess-b' });
    expect(dry.rc).toBe(0);
    expect(refusal(dry.out)).toBe('-');
    expect(dry.out).toMatch(/dry run/);
    expect(dry.out).toMatch(/^total: 1 uuid\(s\), 2 copies, 10000 bytes reclaimable, 0 refused$/m);
    expect(fs.existsSync(transcript('.claude')), 'the dry run deleted nothing').toBe(true);
    expect(dedupeLines(), 'the dry run logs nothing').toEqual([]);

    const done = run('--apply', { live: 'sess-b' });
    expect(done.rc).toBe(0);
    expect(fs.existsSync(transcript('.claude'))).toBe(false);
    expect(fs.statSync(transcript('.claude-d')).size).toBe(12_000);
    expect(done.out).toMatch(/10000 bytes reclaimed/);
    const log = dedupeLines();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(new RegExp(`^\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d carry-dedupe ${UUID} kept=claude-d unlinked=1 bytes=10000 refused=- linked=0$`));
  });

  it('(a2) a copy that is no byte prefix but whose every message uuid the keeper holds is proved by uuid', () => {
    put(transcript('.claude'), lines(ids(5), 10));
    put(transcript('.claude-d'), lines(ids(8), 12));
    row('sess-b', 'claude-d');
    const done = run('--apply');
    expect(refusal(done.out)).toBe('-');
    expect(fs.existsSync(transcript('.claude'))).toBe(false);
  });

  it('(b) same-size copies, no live owner and no registry row: refused tie, nothing unlinked', () => {
    put(transcript('.claude'), lines(ids(5)));
    put(transcript('.claude-d'), lines(ids(5)));
    const done = run('--apply');
    expect(done.rc).toBe(0);
    expect(refusal(done.out)).toBe('tie');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
    expect(fs.existsSync(transcript('.claude-d'))).toBe(true);
    expect(dedupeLines()[0]).toMatch(/ kept=- unlinked=0 bytes=0 refused=tie /);
  });

  it('(b2) no owner: the strictly largest AND strictly newest copy keeps, the prefix copy goes', () => {
    const body = lines(ids(6));
    put(transcript('.claude'), body.slice(0, 100), OLD - 60);
    put(transcript('.claude-d'), body, OLD);
    const done = run('--apply');
    expect(refusal(done.out)).toBe('-');
    expect(fs.existsSync(transcript('.claude'))).toBe(false);
    expect(fs.existsSync(transcript('.claude-d'))).toBe(true);
  });

  it('(b3) no owner: the largest copy is not the newest: refused tie', () => {
    const body = lines(ids(6));
    put(transcript('.claude'), body.slice(0, 100), OLD);
    put(transcript('.claude-d'), body, OLD - 60);
    expect(refusal(run('--apply').out)).toBe('tie');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
  });

  it('(b4) two registry rows on two accounts, neither live: refused tie', () => {
    put(transcript('.claude'), lines(ids(3)));
    put(transcript('.claude-d'), lines(ids(5)));
    row('sess-a', 'claude');
    row('sess-b', 'claude-d');
    expect(refusal(run('--apply').out)).toBe('tie');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
  });

  it('(b5) the registry names an account that holds no transcript: refused keeperless, nothing unlinked', () => {
    put(transcript('.claude'), lines(ids(3)));
    put(transcript('.claude-d'), lines(ids(5)));
    row('sess-x', 'claude-a');
    expect(refusal(run('--apply').out)).toBe('keeperless');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
    expect(fs.existsSync(transcript('.claude-d'))).toBe(true);
  });

  it('(c) A holds a message uuid that B lacks: refused diverged, A kept', () => {
    put(transcript('.claude'), lines([...ids(3), 'only-on-a']));
    put(transcript('.claude-d'), lines(ids(6)));
    row('sess-b', 'claude-d');
    const done = run('--apply');
    expect(done.rc).toBe(0);
    expect(refusal(done.out)).toBe('diverged');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
    expect(dedupeLines()[0]).toMatch(/ kept=claude-d unlinked=0 bytes=0 refused=diverged /);
  });

  it('(c2) all or nothing per uuid: one copy diverged, another proved: nothing of the uuid is unlinked or linked', () => {
    const R = 'tool-results/r.json';
    const body = lines(ids(10));
    put(transcript('.claude'), body.slice(0, 300));               // proved: a byte prefix of the keeper's
    put(transcript('.claude-a'), lines([...ids(3), 'only-on-a']));  // diverged: a message uuid the keeper lacks
    put(transcript('.claude-d'), body);
    put(sidecar('.claude', R), 'RESULT-BODY\n');
    put(sidecar('.claude-d', R), 'RESULT-BODY\n');
    row('sess-b', 'claude-d');
    const dry = run('');
    expect(refusal(dry.out)).toBe('diverged');
    expect(dry.out.split('\n').find((l) => l.startsWith(UUID)), 'the dry run prices nothing for a refused uuid').toMatch(/ claude-d +0 +0 +0 diverged$/);
    const done = run('--apply');
    expect(done.rc, done.out).toBe(0);
    expect(refusal(done.out)).toBe('diverged');
    expect(done.out.split('\n').find((l) => l.startsWith(UUID))).toMatch(/ claude-d +0 +0 +0 diverged$/);
    expect(fs.existsSync(transcript('.claude')), 'the proved copy stays: its uuid was refused').toBe(true);
    expect(fs.existsSync(transcript('.claude-a'))).toBe(true);
    expect(ino(sidecar('.claude', R)), 'no sidecar is linked for a refused uuid').not.toBe(ino(sidecar('.claude-d', R)));
    expect(dedupeLines()[0]).toMatch(/ kept=claude-d unlinked=0 bytes=0 refused=diverged linked=0$/);
  });

  it('(c3) all or nothing per uuid: a recent copy beside a proved one leaves both', () => {
    const body = lines(ids(10));
    put(transcript('.claude'), body.slice(0, 300));
    put(transcript('.claude-a'), body.slice(0, 200), Math.floor(Date.now() / 1000) - 60);
    put(transcript('.claude-d'), body);
    row('sess-b', 'claude-d');
    const done = run('--apply');
    expect(refusal(done.out)).toBe('recent');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
    expect(fs.existsSync(transcript('.claude-a'))).toBe(true);
    expect(dedupeLines()[0]).toMatch(/ unlinked=0 bytes=0 refused=recent /);
  });

  it('(c4) --identical-only: a strict-prefix copy is left and counted, a byte-identical one goes', () => {
    const body = lines(ids(10));
    put(transcript('.claude'), body.slice(0, 300));   // proved by prefix, not identical
    put(transcript('.claude-a'), body);               // identical to the keeper's (same size, same sha256)
    put(transcript('.claude-d'), body);
    row('sess-b', 'claude-d');
    const dry = run('--identical-only');
    expect(dry.out).toMatch(/identical copies only/);
    expect(dry.out).toMatch(/ NONIDENT REFUSED$/m);
    expect(dry.out.split('\n').find((l) => l.startsWith(UUID))).toMatch(new RegExp(` claude-d +1 +0 +${body.length} +1 -$`));
    const done = run('--apply --identical-only');
    expect(done.rc, done.out).toBe(0);
    expect(refusal(done.out)).toBe('-');
    expect(fs.existsSync(transcript('.claude')), 'the strict-prefix copy is not a candidate').toBe(true);
    expect(fs.existsSync(transcript('.claude-a')), 'the identical copy is reclaimed').toBe(false);
    expect(dedupeLines()[0]).toMatch(new RegExp(` unlinked=1 bytes=${body.length} refused=- linked=0 nonidentical=1$`));
    // Without the flag the default proof is unchanged: the prefix copy goes.
    expect(refusal(run('--apply').out)).toBe('-');
    expect(fs.existsSync(transcript('.claude'))).toBe(false);
  });

  it('(d) carried an hour ago (the real carry\'s swap.log line): skipped recent', () => {
    put(transcript('.claude'), lines(ids(3)));
    h.sh(`_swap_carry_jsonl "$HOME/.claude" "$HOME/.claude-d" ${UUID} "" 0`);
    expect(swapLog()).toContain(`carry ${UUID}:`);
    fs.appendFileSync(transcript('.claude-d'), lines(ids(2, 3)));
    row('sess-b', 'claude-d');
    const done = run('--apply');
    expect(refusal(done.out)).toBe('recent');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
    // A window of zero hours lets the same pair through.
    expect(refusal(run('--apply --min-age-hours 0').out)).toBe('-');
    expect(fs.existsSync(transcript('.claude'))).toBe(false);
  });

  it('(d2) a non-keeper copy written inside the window is left: refused recent', () => {
    put(transcript('.claude'), lines(ids(3)), Math.floor(Date.now() / 1000) - 60);
    put(transcript('.claude-d'), lines(ids(6)));
    row('sess-b', 'claude-d');
    expect(refusal(run('--apply').out)).toBe('recent');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
  });

  it('(e) another process holds .carry.lock: skipped locked', () => {
    put(transcript('.claude'), lines(ids(3)));
    put(transcript('.claude-d'), lines(ids(6)));
    row('sess-b', 'claude-d');
    // flock(2) belongs to the open file description: bash keeps fd 7 open after python takes the lock and exits.
    const pre = 'exec 7>>"$REG/.carry.lock"; python3 -c "import fcntl; fcntl.flock(7, fcntl.LOCK_EX)";';
    const done = run('--apply', { pre });
    expect(done.rc).toBe(0);
    expect(refusal(done.out)).toBe('locked');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.carry.lock')), 'the slot is never unlinked').toBe(true);
  });

  it('(g) the live session\'s own transcript is never touched, whatever its size', () => {
    const big = lines(ids(20));
    const small = big.slice(0, 200);
    put(transcript('.claude'), small);
    put(transcript('.claude-d'), big);
    put(transcript('.claude-a'), big);
    row('sess-a', 'claude');
    const before = fs.readFileSync(transcript('.claude'));
    const done = run('--apply', { live: 'sess-a' });
    expect(refusal(done.out)).toBe('diverged');
    expect(fs.readFileSync(transcript('.claude'))).toEqual(before);
    expect(fs.existsSync(transcript('.claude-d'))).toBe(true);
    expect(fs.existsSync(transcript('.claude-a'))).toBe(true);
    expect(dedupeLines()[0]).toMatch(/ kept=claude unlinked=0 /);
  });

  it('(g2) a non-keeper name hardlinked to the keeper\'s inode is never unlinked', () => {
    put(transcript('.claude-d'), lines(ids(6)));
    fs.mkdirSync(path.dirname(transcript('.claude')), { recursive: true });
    fs.linkSync(transcript('.claude-d'), transcript('.claude'));
    row('sess-b', 'claude-d');
    const done = run('--apply');
    expect(refusal(done.out)).toBe('-');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
    expect(dedupeLines()[0]).toMatch(/ unlinked=0 bytes=0 /);
  });

  /**
   * A swap DURING the run. The program reads swap.log and the registry rows once,
   * at its start, and a transcript carry takes no lock, so a carry that lands
   * after that snapshot but before the uuid's turn is invisible to it. The hook
   * is a test-only `sitecustomize.py` that runs a bash snippet the first time the
   * program takes `.carry.lock` — the moment it starts on the uuid, after every
   * snapshot it took at start.
   */
  const midRun = (snippet: string): Record<string, string> => {
    const dir = path.join(h.home, 'py-hook');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sitecustomize.py'), [
      '# TEST-ONLY (ccd-carry-dedupe.test.ts): run DEDUPE_ON_LOCK once, when the program first takes a lock.',
      'import fcntl, os, subprocess',
      '_flock = fcntl.flock',
      'def flock(fd, op):',
      '    r = _flock(fd, op)',
      "    if os.environ.pop('DEDUPE_ON_LOCK_ARMED', None):",
      "        subprocess.run(['bash', '-c', os.environ['DEDUPE_ON_LOCK']], check=True)",
      '    return r',
      'fcntl.flock = flock',
      '',
    ].join('\n'));
    return { PYTHONPATH: dir, DEDUPE_ON_LOCK: snippet, DEDUPE_ON_LOCK_ARMED: '1' };
  };

  it('(h) swapped B -> A mid-run: A\'s fresh `cp -p` copy keeps B\'s old mtime but is not unlinked (refused recent)', () => {
    put(transcript('.claude-d'), lines(ids(6)));
    put(transcript('.claude'), lines(ids(4)));
    row('sess-b', 'claude-d');   // the snapshot: live on B
    // The real carry's order: the copy (a new inode, the source's old mtime), then the registry, then the log line —
    // which this hook stops short of, the window between the copy and its line.
    const env = midRun(`sleep 0.1; rm -f '${transcript('.claude')}'; cp -p '${transcript('.claude-d')}' '${transcript('.claude')}'; `
      + `printf claude > "$HOME/.cc-sessions/sess-b.wrapper"`);
    const done = run('--apply', { live: 'sess-b', env });
    expect(done.rc, done.out).toBe(0);
    expect(fs.statSync(transcript('.claude')).mtimeMs, 'cp -p kept the old mtime').toBeLessThan((OLD + 1) * 1000);
    expect(refusal(done.out)).toBe('recent');
    expect(fs.existsSync(transcript('.claude')), 'the session\'s new home keeps its transcript').toBe(true);
    expect(fs.existsSync(transcript('.claude-d'))).toBe(true);
  });

  it('(h2) a swap.log line naming the uuid written after the program started: refused recent, nothing unlinked', () => {
    put(transcript('.claude'), lines(ids(3)));
    put(transcript('.claude-d'), lines(ids(6)));
    row('sess-b', 'claude-d');
    const env = midRun(`echo "$(date '+%F %T') swap sess-b: claude-d -> claude (uuid ${UUID})" >> "$HOME/.cc-sessions/swap.log"`);
    const done = run('--apply', { env });
    expect(done.rc, done.out).toBe(0);
    expect(refusal(done.out)).toBe('recent');
    expect(fs.existsSync(transcript('.claude'))).toBe(true);
  });

  it('(h3) a sidecar file `cp -p`-carried onto A mid-run is left as it is, not linked to the keeper\'s', () => {
    const R = 'tool-results/r.json';
    put(transcript('.claude'), lines(ids(2)));
    put(transcript('.claude-d'), lines(ids(4)));
    put(sidecar('.claude', R), 'RESULT-BODY\n');
    put(sidecar('.claude-d', R), 'RESULT-BODY\n');
    row('sess-b', 'claude-d');
    const env = midRun(`sleep 0.1; rm -f '${sidecar('.claude', R)}'; cp -p '${sidecar('.claude-d', R)}' '${sidecar('.claude', R)}'`);
    const done = run('--apply', { env });
    expect(done.rc, done.out).toBe(0);
    expect(ino(sidecar('.claude', R))).not.toBe(ino(sidecar('.claude-d', R)));
    expect(dedupeLines()[0]).toMatch(/ linked=0$/);
  });

  it('--uuid limits the run to one uuid, and a malformed one is refused before anything is read', () => {
    put(transcript('.claude'), lines(ids(3)));
    put(transcript('.claude-d'), lines(ids(6)));
    row('sess-b', 'claude-d');
    expect(run('--uuid 00000000-0000-4000-8000-000000000000').out).toMatch(/^total: 0 uuid\(s\)/m);
    expect(() => h.sh('cmd_carry_dedupe --uuid not-a-uuid')).toThrow(/usage: ccd carry-dedupe/);
    expect(() => h.sh('cmd_carry_dedupe --min-age-hours -1')).toThrow(/usage: ccd carry-dedupe/);
    expect(refusal(run(`--uuid ${UUID}`).out)).toBe('-');
  });
});

describe('ccd carry-dedupe: sidecars link through the #338 route', () => {
  const R = 'tool-results/r.json';
  const BODY = 'RESULT-BODY\n';
  /** Transcripts with B the keeper (registry row), identical sidecar files on A and B. */
  const plant = (): void => {
    put(transcript('.claude'), lines(ids(2)));
    put(transcript('.claude-d'), lines(ids(4)));
    put(sidecar('.claude', R), BODY);
    put(sidecar('.claude-d', R), BODY);
    row('sess-b', 'claude-d');
  };
  const rig = (common: 'rw' | 'none'): Record<string, string> =>
    ({ ...bindFixture(h.home, { common }), ...plantFakeKernel(h.home).env });

  it('(f) identical sidecar trees with a common mount: after --apply the files share one inode', () => {
    plant();
    expect(ino(sidecar('.claude', R))).not.toBe(ino(sidecar('.claude-d', R)));
    const env = rig('rw');
    const done = run('--apply', { env });
    expect(done.rc, done.out).toBe(0);
    expect(ino(sidecar('.claude', R))).toBe(ino(sidecar('.claude-d', R)));
    expect(fs.readFileSync(sidecar('.claude', R), 'utf8')).toBe(BODY);
    expect(dedupeLines()[0]).toMatch(/ unlinked=1 bytes=\d+ refused=- linked=1$/);
    const leftovers = fs.readdirSync(path.dirname(sidecar('.claude', R))).filter((f) => f.startsWith('.ccd-carry-'));
    expect(leftovers, 'no temp name left behind').toEqual([]);
  });

  it('(f2) no common mount: counted copy: exdev-…, the files untouched', () => {
    plant();
    const before = ino(sidecar('.claude', R));
    const env = rig('none');
    const done = run('--apply', { env });
    expect(done.rc, done.out).toBe(0);
    expect(ino(sidecar('.claude', R))).toBe(before);
    expect(ino(sidecar('.claude', R))).not.toBe(ino(sidecar('.claude-d', R)));
    expect(fs.readFileSync(sidecar('.claude', R), 'utf8')).toBe(BODY);
    expect(dedupeLines()[0]).toMatch(new RegExp(` linked=0, copy: exdev-no-root 1 files ${BODY.length} bytes$`));
  });

  it('(f3) the dry run counts the linkable sidecar file and touches neither tree', () => {
    plant();
    const before = ino(sidecar('.claude', R));
    const done = run('', { env: rig('rw') });
    expect(ino(sidecar('.claude', R))).toBe(before);
    expect(done.out.split('\n').find((l) => l.startsWith(UUID))).toMatch(/ 1 +1 +\d+ -$/);
  });
});

describe('ccd carry-dedupe: measure-continuity reads what the verb logged', () => {
  const TOOL = path.resolve(import.meta.dirname, '..', '..', 'deploy', 'measure-continuity.py');
  const carry = (): Record<string, any> =>
    JSON.parse(execFileSync('python3', [TOOL, '--stage', '1', '--home', h.home, '--json'], { encoding: 'utf8' })).stage1.carry;

  it('dedupe_reclaimed_bytes sums the bytes= of every carry-dedupe line; a log with none reads 0', () => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), '');
    expect([carry().dedupe_lines, carry().dedupe_reclaimed_bytes]).toEqual([0, 0]);
    const body = lines(ids(10));
    put(transcript('.claude'), body.slice(0, 300));
    put(transcript('.claude-d'), body);
    row('sess-b', 'claude-d');
    run('--apply');
    run('--apply');   // the uuid is on one account now: not looked at, no second line
    const c = carry();
    expect([c.dedupe_lines, c.dedupe_reclaimed_bytes]).toEqual([1, 300]);
    expect(c.carries, 'a carry-dedupe line is not a carry').toBe(0);
  });
});

describe('ccd carry-dedupe: the vocabulary, and the program ships', () => {
  const REPO = path.resolve(import.meta.dirname, '..', '..');
  const LIB = path.join(REPO, 'ccd', 'lib', 'carry-dedupe.py');
  const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
  const vocabulary = (): string[] => {
    const m = /^DEDUPE_REFUSALS = \(([^)]*)\)$/m.exec(fs.readFileSync(LIB, 'utf8'));
    return m ? [...m[1]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]!) : [];
  };

  it('DEDUPE_REFUSALS is spelled once, and every word the cases above saw is in it', () => {
    expect(fs.readFileSync(LIB, 'utf8').match(/^DEDUPE_REFUSALS = /gm)).toHaveLength(1);
    expect(fs.readFileSync(CCD, 'utf8')).not.toMatch(/^DEDUPE_REFUSALS = /m);
    const v = vocabulary();
    expect(v).toEqual(['tie', 'diverged', 'recent', 'locked', 'keeperless', 'error']);
    expect(produced.size, 'the cases above ran first, in this file').toBeGreaterThanOrEqual(5);
    for (const w of produced) expect(v, w).toContain(w);
  });

  it('the program names a refusal only through the tuple, and its copy causes are CARRY_CAUSES words', () => {
    const src = fs.readFileSync(LIB, 'utf8');
    const rest = src.split('\n').filter((l) => !l.startsWith('DEDUPE_REFUSALS = (')).join('\n');
    for (const w of vocabulary()) expect(rest.includes(`'${w}'`), w).toBe(false);
    const m = /^CARRY_CAUSES = \(([^)]*)\)$/m.exec(fs.readFileSync(CCD, 'utf8'));
    const causes = [...m![1]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]!);
    const own = /^LINK_FAILED, ROOT_FAILED, ROUTE_ERROR = (.*)$/m.exec(src);
    expect(own, 'the program spells its three cause words on one line').not.toBeNull();
    const words = [...own![1]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]!);
    expect(words).toEqual(['link-failed', 'root-failed', 'route-error']);
    for (const w of words) expect(causes, w).toContain(w);
  });

  it('ships where ccd looks for it: deploy.sh and ccrc install it, back it up and remove it, beside transcript.jq', () => {
    const DEST = '.cc-sessions/lib/carry-dedupe.py';
    expect(read('deploy/deploy.sh')).toContain(`install_atomic ccd/lib/carry-dedupe.py ${DEST} 644`);
    expect(read('deploy/deploy.sh')).toContain('~/.cc-sessions/lib/carry-dedupe.py ~/ccrc-backups/$TS/carry-dedupe.py');
    const ccrc = read('ccd/ccrc');
    expect(ccrc).toContain(`_inst_atomic "$tree/ccd/lib/carry-dedupe.py" "$HOME/${DEST}" 644`);
    expect(ccrc).toContain(`_upd_backup_copy "$HOME/${DEST}" carry-dedupe.py`);
    expect(ccrc).toContain('"$reg/lib/carry-dedupe.py"');
    expect(fs.readFileSync(CCD, 'utf8')).toContain('lib="$HOME/.cc-sessions/lib/carry-dedupe.py"');
  });

  it('an installed ccd with no tree beside it finds the program under ~/.cc-sessions/lib', () => {
    const body = path.join(h.home, 'libexec', 'ccd');
    fs.mkdirSync(path.dirname(body), { recursive: true });
    fs.copyFileSync(CCD, body);
    fs.mkdirSync(path.join(h.home, '.cc-sessions', 'lib'), { recursive: true });
    const p = path.join(h.home, '.cc-sessions', 'lib', 'carry-dedupe.py');
    expect(() => h.sh(`source "${body}"; cmd_carry_dedupe`)).toThrow(/its program is not installed/);
    fs.copyFileSync(LIB, p);
    expect(h.sh(`source "${body}"; cmd_carry_dedupe`)).toMatch(/^total: 0 uuid\(s\)/m);
  });
});
