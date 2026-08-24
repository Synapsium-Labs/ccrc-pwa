// server/test/ccd-lifecycle-gen.test.ts
//
// The generation is IN THE FILENAME, not in a header line: a `readdir` alone
// tells the mirror the whole generation set with no second read, a rotation is
// "a new name appeared" rather than "the same file got smaller", and a shrink on
// an immutably-named generation is unambiguously a truncation.
//
// Deviation from the task-14 brief, per the standing rule established across
// this plan's earlier tasks: every `it` block below that makes more than one
// INDEPENDENT claim uses `expect.soft` rather than a hard `expect`, so a first
// failure does not hide the rest. No assertion's subject, matcher, or expected
// value was changed by this — only `expect` -> `expect.soft`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { LC_GEN_PREFIX, LC_GEN_SUFFIX, LC_ROTATE_LOCK_NAME } from '../../shared/api.js';
import { makeCcdHarness, type CcdHarness, CCD, ghContainedEnv } from './ccdWsHelpers.js';
import { generationsOf, lcDir } from './lifecycleHelpers.js';

let h: CcdHarness;
let dir: string;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-gen-'); dir = lcDir(h.home); });
afterEach(() => { h.cleanup(); });

const gen = (ns: string): string => `${LC_GEN_PREFIX}${ns}${LC_GEN_SUFFIX}`;
const gens = (): string[] => generationsOf(h.home);

describe('_lc_live', () => {
  it('mints the directory and the first generation, and its name is 19 digits', () => {
    const p = h.sh('_lc_live');
    expect.soft(p).toMatch(/\.lifecycle\/journal-\d{19}\.ndjson$/);
    expect.soft(fs.existsSync(p)).toBe(true);
    expect.soft(gens()).toHaveLength(1);
  });

  it('is idempotent — a second call reuses the same generation, it does not mint', () => {
    const a = h.sh('_lc_live'); const b = h.sh('_lc_live');
    expect.soft(b).toBe(a);
    expect.soft(gens()).toHaveLength(1);
  });

  it('picks the GREATEST name, not the newest mtime', () => {
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1000000000000000000', '3000000000000000000', '2000000000000000000']) {
      fs.writeFileSync(path.join(dir, gen(n)), '');
    }
    fs.utimesSync(path.join(dir, gen('1000000000000000000')), new Date(), new Date());
    expect(h.sh('_lc_live')).toBe(path.join(dir, gen('3000000000000000000')));
  });

  it('answers the empty string rather than dying when the directory cannot be made', () => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.lifecycle'), 'not a directory');
    expect(h.sh('_lc_live; printf END')).toBe('END');
  });

  // FIX ROUND 1 (task 15, follow-up). DISTINCT from the test directly above:
  // that state is `mkdir -p` itself failing (no `.lifecycle` at all, blocked
  // by a plain file in its place), which returns EARLY, before this
  // function ever reaches its own mint attempt. This state is the one task
  // 15's own Critical fix was actually found under: `.lifecycle` already
  // EXISTS (so `mkdir -p` is a no-op and succeeds, and the glob loop over
  // its contents needs only read+execute, which chmod 555 still grants),
  // so `_lc_live` genuinely reaches `{ : >> "$newest"; } 2>/dev/null` and
  // THAT specific open is what fails. Confirmed this test can fail: with
  // the compound wrap at this site reverted to the bare
  // `: >> "$newest" 2>/dev/null` form, this test goes RED with
  // `ccd: line …: …/.lifecycle/journal-….ndjson: Permission denied` on
  // `r.stderr` (task-15-report.md FIX ROUND 1 quotes the exact output).
  // Raw `spawnSync`, not `h.sh` — `h.sh` only ever returns stdout, so a
  // successful (rc 0) run's stderr is discarded before this test could see
  // it either way, the same reason the sibling `_lc_rotate` leak test below
  // uses `spawnSync` rather than the harness's own `sh`.
  it('leaks nothing to stderr when the mint target cannot be created (unwritable .lifecycle, directory already present)', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    let r: ReturnType<typeof spawnSync>;
    try {
      const env = ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true });
      r = spawnSync('bash', ['-c', `source "${CCD}"; _lc_live`],
        { encoding: 'utf8', cwd: h.home, env });
    } finally {
      fs.chmodSync(dir, 0o755);   // restore so afterEach's own cleanup can remove the tree
    }
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(r.stdout, 'the documented empty-string answer, not a half-formed name').toBe('');
    expect.soft(r.stderr).toBe('');
  });

  // Not in the task-14 brief's literal test file — required by the dispatch:
  // "ORDERING IS BY FILENAME, AND IT IS LENGTH-FIRST — NOT lexicographic."
  // `shared/api.ts`'s `compareGenerations` picks the 20-digit name as greater
  // than ANY 19-digit name regardless of content
  // (`server/test/lifecycle-journal-constants.test.ts:114`,
  // `compareGenerations('9999999999999999999', '10000000000000000000')` is
  // negative — the 19-digit all-nines name is LESS than the 20-digit name
  // starting with '1'). A bare bash `[[ "$a" > "$b" ]]` or `sort` disagrees
  // here: lexicographically '9' > '1' at the first differing byte, so a naive
  // ordering picks the 19-digit name as "greatest" — exactly backwards.
  it('agrees with L0\'s length-first rule on a 19-digit vs 20-digit pair', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, gen('9999999999999999999')), '');
    fs.writeFileSync(path.join(dir, gen('10000000000000000000')), '');
    expect(h.sh('_lc_live')).toBe(path.join(dir, gen('10000000000000000000')));
  });
});

describe('_lc_rotate', () => {
  const big = (name: string): string => {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x'.repeat(4 * 1024 * 1024 + 1));
    return p;
  };

  it('does nothing at all below the cap', () => {
    const p = h.sh('_lc_live');
    fs.appendFileSync(p, 'small\n');
    h.sh(`_lc_rotate "${p}"`);
    expect.soft(gens()).toHaveLength(1);
    expect.soft(fs.readFileSync(p, 'utf8')).toBe('small\n');
  });

  it('MINTS A GREATER NAME and leaves the full one byte-identical — it never truncates', () => {
    // Mutant: replace the mint with `: > "$live"` -> this fails with
    // `the full generation must survive byte-for-byte: expected 0 to be 4194305`,
    // and `agent/src/tail.ts:53-58` hands its reader a reset it must model.
    const p = big(gen('1000000000000000000'));
    const before = fs.statSync(p).size;
    h.sh(`_lc_rotate "${p}"`);
    expect.soft(gens()).toHaveLength(2);
    expect.soft(fs.statSync(p).size, 'the full generation must survive byte-for-byte').toBe(before);
  });

  it('drops the OLDEST beyond four generations', () => {
    // Deviation from the task-14 brief: the brief's literal fixture named the
    // four "old" generations `1000000000000000000`..`4000000000000000000` —
    // 19-digit round numbers that straddle a REAL `_lc_now_ns()` reading
    // (measured: epoch ns is ~1.787e18 today, i.e. numerically between the
    // "1" and "2" fixtures). `_lc_rotate`'s own mint therefore lands inside
    // this test's "four oldest" range and — correctly, per the guard proven
    // below — survives retention, leaving 5 generations rather than the 4
    // the brief's literal assertions expect. That is not this test's mutant
    // to catch (the "NEVER prunes the generation it just minted" test below
    // owns it, and does, unmodified). Ten digits, not nineteen: by L0's
    // LENGTH-FIRST rule the same `compareGenerations` this whole task exists
    // to honour, a 10-digit name is unconditionally the smallest regardless
    // of a real 19-digit mint's numeric value, so this fixture no longer
    // depends on today's clock reading to keep the two tests independent.
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1', '2', '3', '4']) {
      fs.writeFileSync(path.join(dir, gen(`${n}000000000`)), 'x');
    }
    const p = big(gen('5000000000000000000'));
    h.sh(`_lc_rotate "${p}"`);
    const left = gens();
    expect.soft(left).toHaveLength(4);
    expect.soft(left).toContain(gen('5000000000000000000'));
    expect.soft(left).not.toContain(gen('1000000000'));
  });

  it('NEVER prunes the generation it just minted, even beside a future-dated name', () => {
    // Mutant: delete the `!= "$live_now"` conjunct -> this fails with
    // `the freshly minted generation was pruned: expected [...] to contain ...`.
    // Production names are monotonic, so this cannot bite today; nothing stated
    // or enforced that, and a rotation that eats its own mint never converges —
    // `_lc_live` picks the full generation again on the very next event.
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1', '2', '3', '4']) {
      fs.writeFileSync(path.join(dir, gen(`${n}000000000000000000`)), 'x');
    }
    const p = big(gen('9000000000000000000'));   // greater than any clock read
    h.sh(`_lc_rotate "${p}"`);
    const minted = gens().filter((f) => f !== gen('9000000000000000000')
      && !['1', '2', '3', '4'].some((n) => f === gen(`${n}000000000000000000`)));
    expect.soft(minted, 'nothing was minted — the fixture is wrong, not the guard').toHaveLength(1);
    expect.soft(gens(), 'the freshly minted generation was pruned').toContain(minted[0]!);
  });

  it('SKIPS rotation rather than dying when flock is unavailable', () => {
    // Every other flock site in ccd (1760, 3070, 5910) `die`s here. This one
    // must not: D7 forbids the journal from gating anything, so the generation
    // is allowed to grow past its cap instead.
    const p = big(gen('1000000000000000000'));
    const out = h.sh(`command() { if [[ "$2" == flock ]]; then return 1; fi; builtin command "$@"; }
      _lc_rotate "${p}"; printf END`);
    expect.soft(out).toBe('END');
    expect.soft(gens()).toHaveLength(1);
  });

  it('never unlinks the rotate lock', () => {
    const p = big(gen('1000000000000000000'));
    h.sh(`_lc_rotate "${p}"`);
    expect(fs.existsSync(path.join(dir, LC_ROTATE_LOCK_NAME)),
      'unlinking a held lock is how two processes come to hold it on two inodes (ccd:1094-1095)').toBe(true);
  });

  // FIX ROUND 1 (a) — CRITICAL. `exec {lfd}>>"$lock" 2>/dev/null` does NOT
  // suppress bash's own diagnostic for a failed BARE-`exec` redirection: the
  // message is emitted while the shell sets the redirection up, before the
  // redirect it names is installed, so it reaches the real stderr rather than
  // the one being redirected. `_lc_rotate`'s contract is silent on both
  // streams; raw `spawnSync`, not `h.sh`, because `h.sh` only ever returns
  // stdout — a successful (rc 0) run's stderr is discarded before this test
  // could see it either way.
  it('leaks nothing to stderr when the lock file cannot be opened (unwritable .lifecycle)', () => {
    const p = big(gen('1000000000000000000'));
    fs.chmodSync(dir, 0o555);
    let r: ReturnType<typeof spawnSync>;
    try {
      const env = ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true });
      r = spawnSync('bash', ['-c', `source "${CCD}"; _lc_rotate "${p}"`],
        { encoding: 'utf8', cwd: h.home, env });
    } finally {
      fs.chmodSync(dir, 0o755);   // restore so afterEach's own cleanup can remove the tree
    }
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(r.stdout).toBe('');
    expect.soft(r.stderr).toBe('');
  });

  // FIX ROUND 1 (task 15, follow-up) — DISTINCT reachable state from the
  // test directly above. That test's state (`.lifecycle` unwritable AND
  // `.rotate.lock` absent) never reaches the mint line at all: the `exec
  // {lfd}>>"$lock"` open fails FIRST, on the lock file itself, and returns
  // before this function ever measures whether to mint. This state
  // pre-creates `.rotate.lock` (write-permitted) BEFORE stripping the
  // directory's write bit, so opening that EXISTING file for append needs
  // only EXECUTE (search) permission on the directory — which chmod 555
  // still grants — not WRITE, and the flock step succeeds. Execution then
  // reaches the mint attempt, where the NEW `journal-*.ndjson` name DOES
  // need directory write to be CREATED, and fails. Verified independently
  // with a bare bash probe before writing this test (quoted in
  // task-15-report.md's FIX ROUND 1 section): opening an existing writable
  // file inside a chmod-555 directory succeeds; creating a new file in that
  // same directory fails with `Permission denied`. Confirmed this test can
  // fail: with the compound wrap at this site reverted to the bare
  // `: >> "$minted" 2>/dev/null` form, this test goes RED with
  // `ccd: line …: …/.lifecycle/journal-….ndjson: Permission denied` on
  // `r.stderr` (also quoted there).
  it('leaks nothing to stderr when the mint target cannot be created (rotate lock already present, .lifecycle unwritable)', () => {
    const p = big(gen('1000000000000000000'));
    fs.writeFileSync(path.join(dir, LC_ROTATE_LOCK_NAME), '', { mode: 0o644 });
    fs.chmodSync(dir, 0o555);
    let r: ReturnType<typeof spawnSync>;
    try {
      const env = ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true });
      r = spawnSync('bash', ['-c', `source "${CCD}"; _lc_rotate "${p}"`],
        { encoding: 'utf8', cwd: h.home, env });
    } finally {
      fs.chmodSync(dir, 0o755);   // restore so afterEach's own cleanup can remove the tree
    }
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(r.stdout).toBe('');
    expect.soft(r.stderr).toBe('');
  });

  // FIX ROUND 2 (task 15). Neither `sort` nor `head` in the prune
  // generator pipe carried its OWN redirect, so a PATH genuinely missing
  // `head` leaked `command not found` straight to real stderr — found by
  // this task's own sweep of the whole LC block, not by the original
  // review. Five generations (four old, one over-cap) so pruning genuinely
  // triggers (`n=5 > _LC_GEN_KEEP=4`). The curated PATH follows
  // `ccd-version.test.ts`'s `pathWithoutPython3` shape: symlinks to every
  // OTHER binary this call chain needs, `head` deliberately omitted, so the
  // absence is genuine rather than a function stub `command -v` would still
  // see.
  it('leaks nothing to stderr when head is genuinely absent from PATH during pruning', () => {
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1', '2', '3', '4']) {
      fs.writeFileSync(path.join(dir, gen(`${n}000000000000000000`)), 'x');
    }
    const p = big(gen('9000000000000000000'));
    const noHead = path.join(h.home, 'no-head-bin');
    fs.mkdirSync(noHead, { recursive: true });
    for (const name of ['bash', 'mkdir', 'sed', 'cat', 'mv', 'rm', 'stat', 'flock', 'python3', 'date', 'sort']) {
      const real = execFileSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
      fs.symlinkSync(real, path.join(noHead, name));
    }
    const baseEnv = ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true });
    const env = { ...baseEnv, PATH: noHead };
    const r = spawnSync('bash', ['-c', `source "${CCD}"; _lc_rotate "${p}"`],
      { encoding: 'utf8', cwd: h.home, env });
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(r.stdout).toBe('');
    expect.soft(r.stderr).toBe('');
  });

  // FIX ROUND 2 (task 15), found in the same sweep. `rm -f -- "$f"` inside
  // the prune loop carried NO redirect at all — `-f` silences only "no such
  // file", not a genuine permission error, and `rm` prints its OWN message
  // for that. Pre-creates `.rotate.lock` (write-permitted) BEFORE stripping
  // the directory write bit, the same shape as the mint-site test above:
  // opening an EXISTING file needs only directory EXECUTE, so flock still
  // succeeds and the loop genuinely reaches an `rm -f` that then hits a
  // real EACCES removing a directory ENTRY (which needs directory WRITE,
  // regardless of the file's own mode).
  it('leaks nothing to stderr when rm -f hits a genuine permission error during pruning', () => {
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['1', '2', '3', '4']) {
      fs.writeFileSync(path.join(dir, gen(`${n}000000000000000000`)), 'x');
    }
    const p = big(gen('9000000000000000000'));
    fs.writeFileSync(path.join(dir, LC_ROTATE_LOCK_NAME), '', { mode: 0o644 });
    fs.chmodSync(dir, 0o555);
    let r: ReturnType<typeof spawnSync>;
    try {
      const env = ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true });
      r = spawnSync('bash', ['-c', `source "${CCD}"; _lc_rotate "${p}"`],
        { encoding: 'utf8', cwd: h.home, env });
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(r.stdout).toBe('');
    expect.soft(r.stderr).toBe('');
  });

  // FIX ROUND 1 (b) — IMPORTANT. Two real concurrent processes racing
  // `_lc_rotate` against the SAME over-cap live file. `flock` serialises the
  // critical SECTION, but that alone does not stop a double mint: the loser
  // of the race, once it eventually gets the lock (after the winner has
  // already minted and released), re-measures `$live`'s own size — still
  // over cap forever, since rotation never truncates it — and mints AGAIN,
  // because nothing tells it a generation greater than `$live` now exists.
  // `spawn` (async, non-blocking), not `spawnSync`: both children are
  // launched before either is awaited, so both start against the SAME
  // over-cap `$live` — a real OS-level race, not a simulated one. A bare
  // back-to-back launch (no stagger) mostly lands the two `flock -n` calls
  // CONTENDED — the loser sees the lock held and skips cleanly, which is not
  // the bug. Measured across staggers of 0/2/5/10/20/40ms: a 15ms gap between
  // launching the two children reproduced the double mint in 8 of 10 runs —
  // long enough that the winner has usually finished its ENTIRE critical
  // section (re-check, mint, prune, release) before the loser even attempts
  // `flock`, so the loser's attempt is UNCONTESTED and it re-runs the same
  // stale check. This is the reviewer's own reproduction shape ("5 of 8").
  //
  // FIX ROUND 2 (b): THIS TEST IS FLAKY BY NATURE, and that is a fact about
  // the race, not a defect in the test. A single race is a coin that is only
  // WEIGHTED toward catching the regression, not certain to. Measured: with
  // the real fix reverted (the old `$live`-size re-measure restored) and
  // this SAME single-race form run 10 times, the regression went red only
  // 9 times out of 10 — a ~10% per-run miss rate, on the one function in
  // this whole program that DELETES. If you see this test fail
  // intermittently, that is the race firing and the guard holding or not —
  // real signal, not flake to be silenced. Racing 3 TIMES inside one test,
  // each iteration against its OWN fresh harness (so `_LC_GEN_KEEP`
  // retention from one iteration can never confuse another iteration's
  // count), takes the per-run miss rate from ~10% to ~0.1% (0.1^3). DO NOT
  // lower this iteration count without re-measuring: the whole point of
  // repeating it is the number this comment states, and a lower count
  // trades detection power for a few milliseconds of test time.
  it('two racing rotators mint exactly ONE new generation, never two', async () => {
    for (let i = 0; i < 3; i++) {
      const hh = makeCcdHarness(`ccrc-lc-gen-race${i}-`);
      try {
        const ddir = lcDir(hh.home);
        fs.mkdirSync(ddir, { recursive: true });
        const p = path.join(ddir, gen('1000000000000000000'));
        fs.writeFileSync(p, 'x'.repeat(4 * 1024 * 1024 + 1));
        const env = ghContainedEnv(hh.home, { ...process.env, HOME: hh.home }, { systemd: true, tmux: true });
        const runOnce = (): Promise<number | null> => new Promise((resolve, reject) => {
          const child = spawn('bash', ['-c', `source "${CCD}"; _lc_rotate "${p}"`], { cwd: hh.home, env });
          child.on('error', reject);
          child.on('close', (code) => resolve(code));
        });
        const p1 = runOnce();
        await new Promise((resolve) => { setTimeout(resolve, 15); });
        const p2 = runOnce();
        const [c1, c2] = await Promise.all([p1, p2]);
        expect.soft(c1, `iteration ${i}: each racer stays rc 0 regardless of who wins the lock`).toBe(0);
        expect.soft(c2, `iteration ${i}: each racer stays rc 0 regardless of who wins the lock`).toBe(0);
        const minted = generationsOf(hh.home).filter((f) => f !== gen('1000000000000000000'));
        expect.soft(minted, `iteration ${i}: exactly one new generation must appear — one per racer is the bug`)
          .toHaveLength(1);
      } finally {
        hh.cleanup();
      }
    }
  });
});
