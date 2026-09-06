// `$REG/pools/<project>` — the project pool tag, its reader and (Task 3) its
// writer verb.
//
// Everything runs against the isolated fixture HOME (`makeCcdHarness`), never
// the live one: `$REG` is `$HOME/.cc-sessions`, so a test that wrote a real tag
// would retag an actual project on the fleet.
//
// THE READER RUNS INSIDE `cmd_supervise`'s 5-second loop, so it may never
// `die`: a supervisor that exits on an unreadable tag stops supervising. That
// is pinned by interposing `die() { echo DIED; exit 99; }` AFTER sourcing ccd
// and asserting the word came back instead (the `ccd-die-containment.test.ts`
// technique).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-project-pool-'); });
afterEach(() => { h.cleanup(); });

const REG = (): string => path.join(h.home, '.cc-sessions');
const POOLS = (): string => path.join(REG(), 'pools');

/** Plants a tag file with EXACT bytes — no helper newline, because the byte
 *  assertions below are about exactly that. */
function plantTag(project: string, bytes: string): string {
  fs.mkdirSync(POOLS(), { recursive: true });
  const p = path.join(POOLS(), project);
  fs.writeFileSync(p, bytes);
  return p;
}

/** ccd's own answer, captured with stderr FOLDED IN, so "the reader printed a
 *  word" and "the reader printed a word and complained on stderr" are
 *  distinguishable. `h.sh` returns stdout only. */
const state = (project: string): string =>
  h.sh(`{ _project_pool_state ${JSON.stringify(project)}; } 2>&1`);

/** Like `state()`, but with the CHILD PROCESS ITSELF bounded — for the cases
 *  that, if Finding 6's hang-closing guard ever regressed, would otherwise
 *  hang this whole worker process rather than fail one test. Vitest's own
 *  per-test timeout cannot save us here: `h.sh`'s `execFileSync` is
 *  SYNCHRONOUS and blocks the very event loop the timeout timer needs to
 *  fire on, so the bound has to live on the child process itself. Node's
 *  `timeout` option on `execFileSync` SIGTERMs the child and throws an error
 *  with `.code === 'ETIMEDOUT'` (verified directly — `.killed` is NOT set on
 *  that error, despite what the name suggests) — that is the one thing this
 *  helper turns into a normal, readable test failure instead of a real hang. */
function boundedState(project: string, ms = 5000): string {
  try {
    return execFileSync(
      'bash', ['-c', `source "${CCD}"; { _project_pool_state ${JSON.stringify(project)}; } 2>&1`],
      { encoding: 'utf8', cwd: h.home, timeout: ms,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) },
    ).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      throw new Error(
        `_project_pool_state(${JSON.stringify(project)}) did not return within ${ms}ms — `
        + 'this is Finding 6\'s hang regressing, not a flake');
    }
    throw err;
  }
}

describe('_project_pool_state — four words, always rc 0', () => {
  it('answers `untagged` when the pools directory does not exist at all', () => {
    expect(fs.existsSync(POOLS())).toBe(false);
    expect(state('demo')).toBe('untagged');
  });

  it('answers `untagged` for a project with no file, when other projects have one', () => {
    plantTag('quiet-basin', 'pool-a');
    expect(state('demo')).toBe('untagged');
  });

  it('answers `named <n>` for a well-formed tag, with and without a trailing newline', () => {
    // A shell `echo pool-a > pools/demo` is a LEGAL writer (ruling 2), so the
    // reader strips trailing whitespace. Both bytes must read the same.
    plantTag('demo', 'pool-a');
    expect(state('demo')).toBe('named pool-a');
    plantTag('demo', 'pool-a\n');
    expect(state('demo')).toBe('named pool-a');
    plantTag('demo', 'pool-a\n\n  \t\n');
    expect(state('demo')).toBe('named pool-a');
  });

  it('answers `malformed` for two tokens, for uppercase, for empty, and for LEADING whitespace', () => {
    // Each is a DIFFERENT bad shape and they share one word because they share
    // one remedy: rewrite the file as a single lowercase token. The trailing
    // strip (`v=${v%"${v##*[![:space:]]}"}`) removes only a TRAILING run, so
    // ' pool-a' and '\tpool-a' must still fail the anchored `^[a-z]…` grammar
    // — this row measures the comment's claim instead of leaving it asserted.
    for (const bytes of ['pool a', 'Pool-a', '', 'pool_a', '-pool-a', ' pool-a', '\tpool-a']) {
      plantTag('demo', bytes);
      expect(state('demo'), JSON.stringify(bytes)).toBe('malformed');
    }
  });

  it('answers `unreadable` for a directory at the tag path — any uid, root included', () => {
    fs.mkdirSync(path.join(POOLS(), 'demo'), { recursive: true });
    expect(state('demo')).toBe('unreadable');
  });

  it.skipIf(process.getuid?.() === 0)(
    'answers `unreadable` for a mode-000 file, and NEVER `untagged`', () => {
      // THE DEFECT THIS IS ABOUT: folding unreadable into untagged silently
      // LIFTS the constraint — the project becomes unconstrained because a
      // permission bit was wrong, and nothing anywhere says so.
      const p = plantTag('demo', 'pool-a');
      fs.chmodSync(p, 0o000);
      try {
        expect(state('demo')).toBe('unreadable');
      } finally {
        fs.chmodSync(p, 0o600);
      }
    });

  it('answers `unreadable` for a broken symlink at the tag path, never `untagged`', () => {
    // THE DEFECT THIS IS ABOUT: a bare `[[ -e "$f" ]]` reads false for a
    // broken symlink exactly as it does for genuine absence. Folding the two
    // together would silently lift the constraint on a project whose tag was
    // never removed — only its target was — which is not "nobody tagged
    // this" at all.
    fs.mkdirSync(POOLS(), { recursive: true });
    fs.symlinkSync(path.join(POOLS(), 'nowhere'), path.join(POOLS(), 'demo'));
    expect(state('demo')).toBe('unreadable');
  });

  it('answers `unreadable` for a symlink LOOP at the tag path, never `untagged`', () => {
    // A link whose own target is itself resolves nowhere (ELOOP), and `-e`
    // reads that exactly like absence too — same defect as the broken-symlink
    // case above, different cause.
    fs.mkdirSync(POOLS(), { recursive: true });
    const p = path.join(POOLS(), 'demo');
    fs.symlinkSync(p, p);
    expect(state('demo')).toBe('unreadable');
  });

  it.skipIf(process.getuid?.() === 0)(
    'answers `unreadable` for an unsearchable $POOLS_DIR, not `untagged` for every project on the box', () => {
      // THE DEFECT THIS IS ABOUT: once `$POOLS_DIR` itself cannot be
      // searched, nothing can be proven about any `$f` under it — reading
      // that as `untagged` would silently unconstrain EVERY project on the
      // box from one bad chmod, not just the one this test names.
      plantTag('demo', 'pool-a');
      fs.chmodSync(POOLS(), 0o000);
      try {
        expect(state('demo')).toBe('unreadable');
      } finally {
        fs.chmodSync(POOLS(), 0o700);
      }
    });

  it('answers `unreadable` for a regular FILE sitting at $POOLS_DIR, not `untagged` for every project on the box', () => {
    // THE DEFECT THIS IS ABOUT, one directory up from the broken-symlink case
    // above: spec §6 has the server answer `listed:false` (-> unreadable to
    // every project) for exactly this shape, and Task 8's doctor FAILS it as
    // `pools-unlistable`. `ccd` is the spec's stated AUTHORITY (§5.1) — it
    // must not be the one voice saying `untagged` while the other two agree
    // it is `unreadable`.
    fs.mkdirSync(REG(), { recursive: true });
    fs.writeFileSync(POOLS(), 'not a directory');
    expect(state('demo')).toBe('unreadable');
  });

  it('answers `unreadable` for a broken symlink AT $POOLS_DIR, never `untagged`', () => {
    fs.mkdirSync(REG(), { recursive: true });
    fs.symlinkSync(path.join(REG(), 'nowhere'), POOLS());
    expect(state('demo')).toBe('unreadable');
  });

  it('answers `unreadable` for a symlink LOOP AT $POOLS_DIR, never `untagged`', () => {
    fs.mkdirSync(REG(), { recursive: true });
    fs.symlinkSync(POOLS(), POOLS());
    expect(state('demo')).toBe('unreadable');
  });

  it.skipIf(process.getuid?.() === 0)(
    'answers `unreadable` when $REG itself is unsearchable, not `untagged` for every project on the box', () => {
      plantTag('demo', 'pool-a');
      fs.chmodSync(REG(), 0o000);
      try {
        expect(state('demo')).toBe('unreadable');
      } finally {
        fs.chmodSync(REG(), 0o700);
      }
    });

  it('answers `unreadable` when $REG itself is entirely absent, not `untagged` for every project on the box', () => {
    // `ccd` runs `mkdir -p "$REG"` at source time, so this state should be
    // UNREACHABLE through normal use — reached here only by removing $REG
    // AFTER sourcing (inside the same shell invocation `h.sh` builds), since
    // sourcing again would just recreate it. DECISION, recorded because the
    // coordinator asked for it explicitly: `unreadable`, not `untagged`.
    // Every other anomaly this reader can observe already answers
    // `unreadable`; a condition that should never happen at all is the wrong
    // place for this reader to default to "unconstrained" — that would make
    // the single state nobody expects to occur the one state where a chmod
    // gone wrong (or a botched migration, or a co-tenant's stray `rm -rf`)
    // silently lifts the constraint on every project on the box, which is
    // the exact failure mode this whole function exists to refuse.
    const out = h.sh('rm -rf "$HOME/.cc-sessions"; { _project_pool_state demo; } 2>&1');
    expect(out).toBe('unreadable');
  });

  it('answers `unreadable` for a FIFO at the tag path, PROMPTLY — never hangs', () => {
    // THE MOST SERIOUS DEFECT THIS FILE HAS HAD: `cat -- "$f"` opening a FIFO
    // with no writer blocks in `open(2)` FOREVER — measured independently at
    // 6s with no word on stdout at all. A hang inside `cmd_supervise`'s loop
    // is worse than a `die`: it stops the supervisor permanently, with no
    // exit code for anything to notice. `boundedState` turns a regression
    // here into a normal test failure instead of a real hang; the explicit
    // vitest timeout below is a second, independent bound in case that ever
    // stops being true — a hanging test is the same defect as the one this
    // fixes, so it may never be allowed to hang CI either.
    fs.mkdirSync(POOLS(), { recursive: true });
    execFileSync('mkfifo', [path.join(POOLS(), 'demo')]);
    expect(boundedState('demo')).toBe('unreadable');
  }, 10000);

  it('answers `unreadable` for a symlink TO a FIFO, PROMPTLY — never hangs', () => {
    fs.mkdirSync(POOLS(), { recursive: true });
    const real = path.join(POOLS(), 'realfifo');
    execFileSync('mkfifo', [real]);
    fs.symlinkSync(real, path.join(POOLS(), 'demo'));
    expect(boundedState('demo')).toBe('unreadable');
  }, 10000);

  it('answers `unreadable` for a symlink to an infinite character device (/dev/zero), PROMPTLY — never hangs, never reads unboundedly', () => {
    fs.mkdirSync(POOLS(), { recursive: true });
    fs.symlinkSync('/dev/zero', path.join(POOLS(), 'demo'));
    expect(boundedState('demo')).toBe('unreadable');
  }, 10000);

  it('answers `unreadable` for a symlink to a character device that does NOT block (/dev/null) — DECISION, see report', () => {
    // A type check (`-f`/`-c`) cannot tell a BOUNDED device (`/dev/null`,
    // EOFs immediately) from an UNBOUNDED one (`/dev/zero`, blocks forever)
    // without attempting the read this guard exists to avoid attempting —
    // so every character device gets the SAME answer, `unreadable`, on
    // purpose. It no longer reaches the `read`/validation step where the
    // pre-fix code would have landed it on `malformed` (empty content).
    fs.mkdirSync(POOLS(), { recursive: true });
    fs.symlinkSync('/dev/null', path.join(POOLS(), 'demo'));
    expect(boundedState('demo')).toBe('unreadable');
  }, 10000);

  it('answers `named <n>` through a symlink to an ORDINARY regular file — the indirection case is not broken by the FIFO/device fix', () => {
    fs.mkdirSync(POOLS(), { recursive: true });
    const real = path.join(POOLS(), 'realtag');
    fs.writeFileSync(real, 'pool-a\n');
    fs.symlinkSync(real, path.join(POOLS(), 'demo'));
    expect(state('demo')).toBe('named pool-a');
  });

  it('answers `malformed` for content containing an embedded NUL byte — no stderr leak, no silent splice', () => {
    // TWO findings pinned by ONE assertion. `state()` folds stderr into the
    // same captured string (`2>&1`), so an exact `toBe('malformed')` fails if
    // ANYTHING extra reaches stderr — which is exactly what closes Finding 7:
    // the old `v=$(cat -- "$f")` triggered bash's OWN
    // `warning: command substitution: ignored null byte in input` from the
    // PARENT shell doing the substitution (never covered by `2>/dev/null` ON
    // `cat`), and the `read -d ''` replacement has no command substitution to
    // trigger it — measured directly, not assumed. Finding 8 is closed the
    // same motion: bash cannot hold a NUL in a string at all, so
    // `pool-a\0junk\n` would otherwise splice into the single legal-looking
    // token `pool-ajunk` (appearing nowhere in the file) once the NUL is
    // dropped — `read -d ''`'s own exit status (0 iff it found the NUL
    // delimiter before EOF) catches this BEFORE the splice ever reaches
    // `_pool_name_valid`, at no extra fork/subshell cost.
    plantTag('demo', 'pool-a\0junk\n');
    expect(state('demo')).toBe('malformed');
  });

  it.skipIf(!fs.existsSync('/proc/self/mem'))(
    'PINS A KNOWN RESIDUAL: a symlink to /proc/self/mem (EIO on read) answers `malformed`, not a desired property', () => {
      // This test PINS the CURRENT behaviour so a future change to it is
      // visible rather than accidental — it does NOT assert the fold is
      // correct. `read -d ''` cannot tell a genuine read failure (EIO here)
      // from ordinary EOF-with-no-NUL, so this lands in the same branch as
      // any other unremarkable content and answers `malformed`. Parked, not
      // fixed, by coordinator ruling 2026-09-06 — see `_project_pool_state`'s
      // own "DISCLOSED, NOT CLOSED" comment for why. Do NOT "fix" this test
      // into expecting `unreadable`; that would require a fork this function
      // deliberately does not have, to improve a diagnostic message on a
      // condition `_pool_ok` (Task 2) does not even branch on differently.
      fs.mkdirSync(POOLS(), { recursive: true });
      fs.symlinkSync('/proc/self/mem', path.join(POOLS(), 'demo'));
      expect(state('demo')).toBe('malformed');
    });

  it('answers `untagged` for an EMPTY project argument, never resolving to the directory', () => {
    // A pre-2026 registry row with no `.project` field hands this function the
    // empty string. Without the `-n "$1"` guard the path is `$POOLS_DIR/`, the
    // `-f` check below refuses it, and every such session reads `unreadable` —
    // fail-shut on a row whose project is merely unknown (spec §10).
    fs.mkdirSync(POOLS(), { recursive: true });
    expect(h.sh('{ _project_pool_state ""; } 2>&1')).toBe('untagged');
    expect(h.sh('{ _project_pool_state; } 2>&1')).toBe('untagged');
  });

  it('never dies, on every one of the four inputs, and always exits 0', () => {
    fs.mkdirSync(path.join(POOLS(), 'acct-a-demo'), { recursive: true });   // unreadable
    plantTag('demo', 'pool-a');                                            // named
    plantTag('quiet-basin', 'Pool a');                                     // malformed
    const out = h.sh(
      'die() { echo DIED; exit 99; }; '
      + 'for p in demo quiet-basin acct-a-demo nothing-here ""; do '
      + '  { _project_pool_state "$p"; } 2>&1; echo "rc=$?"; '
      + 'done');
    expect(out).not.toContain('DIED');
    expect(out.split('\n').filter((l) => l.startsWith('rc='))).toEqual(
      ['rc=0', 'rc=0', 'rc=0', 'rc=0', 'rc=0']);
    expect(out.split('\n').filter((l) => !l.startsWith('rc='))).toEqual(
      ['named pool-a', 'malformed', 'unreadable', 'untagged', 'untagged']);
  });
});

/** stdout captured BESIDE stderr and the code, `ccd-coord-pause.test.ts`'s
 *  helper: on this verb the defect that matters is a refusal that still
 *  printed `tagged`, and a code-and-stderr-only helper cannot see it. */
const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** The DISPATCHER, not the function. The agent invokes this verb as
 *  `ccd project-pool --project demo --pool pool-a`, so the `case` arm is
 *  load-bearing production surface: a shipped `cmd_project_pool` with no arm
 *  answers the usage line at exit 1 for every tap the phone makes. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

const swapLog = (): string => {
  const p = path.join(REG(), 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

/** Everything under $HOME, so "nothing was touched" is a measurement rather
 *  than a spot check on one path. */
const treeUnderHome = (): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(path.relative(h.home, p));
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
    }
  };
  walk(h.home);
  return out.sort();
};

describe('ccd project-pool — the writer verb', () => {
  it('tags a project through the DISPATCHER, and says so', () => {
    h.makeRepo('demo');
    const r = runCcd('project-pool', '--project', 'demo', '--pool', 'pool-a');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('tagged demo pool-a');
    expect(state('demo')).toBe('named pool-a');
  });

  it('names itself in the usage line every mistyped verb prints', () => {
    const r = runCcd();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('project-pool');
  });

  it('writes the value with NO trailing newline', () => {
    // `_reg_set`'s convention (`printf '%s'`). The mutant is `echo "$pool"`,
    // which is invisible to every word-level assertion above.
    h.makeRepo('demo');
    h.sh('cmd_project_pool --project demo --pool pool-a');
    expect(fs.readFileSync(path.join(POOLS(), 'demo'), 'utf8')).toBe('pool-a');
  });

  it('leaves no tmp file behind, and the tag is a regular file', () => {
    h.makeRepo('demo');
    h.sh('cmd_project_pool --project demo --pool pool-a');
    expect(fs.readdirSync(POOLS())).toEqual(['demo']);
    expect(fs.statSync(path.join(POOLS(), 'demo')).isFile()).toBe(true);
  });

  it('pins the write-arm tmp file as DOT-LEADING (Fix round 1, Finding 3)', () => {
    // The comment above the write arm calls the leading dot load-bearing —
    // "every reader skips dot-leading entries, which is exact because no
    // project may lead with a dot" — but nothing pinned the shape: the
    // post-success directory listing above is identical whether the tmp file
    // was dot-leading or not, because it is gone either way by the time
    // anyone reads the directory. Interposing `_plat_mv_notdir` to record ITS
    // OWN first argument, and forcing it to fail so cleanup runs afterward
    // rather than before, is the only way to see the name at all.
    h.makeRepo('demo');
    h.sh(
      '_plat_mv_notdir() { basename -- "$1" > "$HOME/tmpname-seen"; return 1; }; '
      + '( cmd_project_pool --project demo --pool pool-a >/dev/null 2>&1 ); true');
    const seen = fs.readFileSync(path.join(h.home, 'tmpname-seen'), 'utf8').trim();
    expect(seen.startsWith('.')).toBe(true);
    expect(seen).toMatch(/^\.demo\.\d+\.tmp$/);
  });

  it('creates $REG/pools lazily on the first --pool', () => {
    h.makeRepo('demo');
    expect(fs.existsSync(POOLS())).toBe(false);
    h.sh('cmd_project_pool --project demo --pool pool-a');
    expect(fs.statSync(POOLS()).isDirectory()).toBe(true);
  });

  it('retags in place, and logs one pool-tag line per call with the old and new names', () => {
    h.makeRepo('demo');
    h.sh('cmd_project_pool --project demo --pool pool-a');
    h.sh('cmd_project_pool --project demo --pool pool-b');
    expect(h.sh('cmd_project_pool --project demo --clear')).toBe('untagged demo');
    const lines = swapLog().trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/ pool-tag demo: - -> pool-a$/);
    expect(lines[1]).toMatch(/ pool-tag demo: pool-a -> pool-b$/);
    expect(lines[2]).toMatch(/ pool-tag demo: pool-b -> -$/);
  });

  it('clears idempotently and without any existence check on the project', () => {
    // The doctor's `pools-stale` remedy IS `--clear` on a project whose
    // directory and registry rows are both gone. If that refused, the remedy
    // for the finding could never be applied.
    plantTag('acct-a-demo', 'pool-a');
    expect(h.sh('cmd_project_pool --project acct-a-demo --clear')).toBe('untagged acct-a-demo');
    expect(fs.existsSync(path.join(POOLS(), 'acct-a-demo'))).toBe(false);
    expect(h.sh('cmd_project_pool --project acct-a-demo --clear')).toBe('untagged acct-a-demo');
    expect(h.sh('cmd_project_pool --project never-existed --clear')).toBe('untagged never-existed');
  });

  it('a dangling symlink at the tag path is REMOVED by --clear, not silently skipped (Fix round 1, Finding 1)', () => {
    // `-e` follows the link to a target that is not there and reads FALSE for
    // a dangling symlink — exactly as it reads false for genuine absence. A
    // bare `[[ -e "$POOLS_DIR/$project" ]]` guard on the removal therefore
    // SKIPS the whole block: the link survives, and the operator is told
    // `untagged` while `_project_pool_state` still answers `unreadable` and
    // `_pool_ok` still answers 2 (undecidable) — the constraint still binds
    // every placement, exactly the polarity the plan calls worst. `fs.existsSync`
    // ALSO follows symlinks, so it cannot prove the fix either way; `lstatSync`
    // throwing is what proves the link itself is gone, not merely its target.
    fs.mkdirSync(POOLS(), { recursive: true });
    fs.symlinkSync('/nonexistent/target', path.join(POOLS(), 'demo'));
    expect(h.sh('cmd_project_pool --project demo --clear')).toBe('untagged demo');
    expect(() => fs.lstatSync(path.join(POOLS(), 'demo'))).toThrow();
    expect(state('demo')).toBe('untagged');
  });

  it('a symlink LOOP at the tag path is likewise removed by --clear, not silently skipped', () => {
    // Same defect, different cause: a self-referencing symlink also reads
    // `-e` FALSE (ELOOP), and `rm -f` removes it by `unlink(2)` on its OWN
    // directory entry either way — it never follows the link and never cares
    // whether the target exists or loops.
    fs.mkdirSync(POOLS(), { recursive: true });
    const p = path.join(POOLS(), 'demo');
    fs.symlinkSync(p, p);
    expect(h.sh('cmd_project_pool --project demo --clear')).toBe('untagged demo');
    expect(() => fs.lstatSync(p)).toThrow();
    expect(state('demo')).toBe('untagged');
  });

  it.skipIf(process.getuid?.() === 0)(
    'refuses --clear when $POOLS_DIR is unsearchable — pairing `-e` with `-L` does not close this shape (Fix round 2, Finding 4)', () => {
      // Fix round 1 paired `-e` with `-L` on the removal guard, which closes
      // the dangling-symlink/loop shape but NOT the whole class: under an
      // UNSEARCHABLE $POOLS_DIR (mode 000), neither `-e` NOR `-L` can stat OR
      // lstat through a directory they cannot search — BOTH read false,
      // exactly like genuine absence, so that guard skips the removal AGAIN.
      // `_project_pool_state` already proves this exact case `unreadable`
      // (its own `-x "$POOLS_DIR"` check) — root searches anything, so this
      // is skipped for root.
      plantTag('demo', 'pool-a');
      fs.chmodSync(POOLS(), 0o000);
      try {
        const r = shFail('cmd_project_pool --project demo --clear');
        expect(r.code).not.toBe(0);
        expect(r.stdout).not.toContain('untagged');
      } finally {
        fs.chmodSync(POOLS(), 0o700);
      }
    });

  it('refuses --clear when $POOLS_DIR ITSELF is a regular FILE — `rm -f` swallows ENOTDIR silently (Fix round 3, Finding 6)', () => {
    // A THIRD shape of the same false success, one level further out.
    // `oldstate` is `unreadable` here (correctly), so round 2's guard
    // decides to remove — but `$POOLS_DIR/$project` is not a resolvable path
    // when $POOLS_DIR is a plain file (ENOTDIR), and `rm -f` SWALLOWS that
    // exactly like it swallows genuine "already gone": `rm -f` returns 0
    // either way, so trusting rm's exit code alone reports `untagged` while
    // `_project_pool_state` still answers `unreadable`. The fix re-measures
    // with the same reader after a successful `rm` and refuses to report
    // success unless it agrees.
    fs.mkdirSync(REG(), { recursive: true });
    fs.writeFileSync(POOLS(), 'not a directory\n');
    const r = shFail('cmd_project_pool --project demo --clear');
    expect(r.code).not.toBe(0);
    expect(r.stdout).not.toContain('untagged');
  });

  it('refuses --clear when $POOLS_DIR ITSELF is a dangling symlink — `rm -f` swallows ENOENT silently (Fix round 3, Finding 6)', () => {
    // Same shape, different cause: $POOLS_DIR resolving nowhere makes
    // `$POOLS_DIR/$project` unreachable (ENOENT through the missing
    // directory component), which `rm -f` also swallows.
    fs.mkdirSync(REG(), { recursive: true });
    fs.symlinkSync(path.join(REG(), 'nowhere'), POOLS());
    const r = shFail('cmd_project_pool --project demo --clear');
    expect(r.code).not.toBe(0);
    expect(r.stdout).not.toContain('untagged');
  });

  it('the swap.log write cannot resurrect a tag behind the final re-measure’s back — rm branch (Fix round 4, Finding 10)', () => {
    // Reproduced: `ln -s "$REG/pools/demo" "$REG/swap.log"` makes the
    // verb's OWN audit-log append the SAME FILE as the tag it just removed.
    // Where that append runs AFTER the last measurement, it RE-CREATES the
    // tag (unparseable, date-stamped content — reads back `malformed`)
    // and the verb still reports the answer it already had, which is now
    // false. The fix moves the append before the final re-measurement, so
    // the append's own effect on the tag is what gets measured, not
    // skipped past.
    plantTag('demo', 'pool-a');
    fs.symlinkSync(path.join(POOLS(), 'demo'), path.join(REG(), 'swap.log'));
    const r = shFail('cmd_project_pool --project demo --clear');
    // Either honest outcome is acceptable in principle (round 1's "no lying"
    // bar) — but as actually implemented, the audit line's own content does
    // not parse as a pool name, so the re-measure reads `malformed` and the
    // verb REFUSES rather than reporting a now-false `untagged`.
    if (r.code === 0) {
      expect(r.stdout).toBe('untagged demo');
      expect(state('demo')).toBe('untagged');
    } else {
      expect(r.stdout).not.toContain('untagged');
    }
  });

  it('the swap.log write cannot resurrect a tag behind the final re-measure’s back — no-rm branch, project already untagged (Fix round 4, Finding 10)', () => {
    // The path a reader would assume is safe: nothing is tagged, so `--clear`
    // never calls `rm` at all. The audit line still writes — even a no-op
    // clear logs `pool-tag $project: - -> -` — and through the same alias it
    // still creates a file at the tag path. Before this fix there was no
    // re-measurement anywhere on this path at all.
    fs.mkdirSync(POOLS(), { recursive: true });
    fs.symlinkSync(path.join(POOLS(), 'demo'), path.join(REG(), 'swap.log'));
    const r = shFail('cmd_project_pool --project demo --clear');
    if (r.code === 0) {
      expect(r.stdout).toBe('untagged demo');
      expect(state('demo')).toBe('untagged');
    } else {
      expect(r.stdout).not.toContain('untagged');
    }
  });

  it('retags cleanly over a dangling symlink and over a symlink loop — the --pool arm has no analogous `-e` gate', () => {
    // Checked per the coordinator's ask: the write arm never tests `-e` on
    // the tag path at all. It goes straight from `mkdir -p` to an atomic
    // `_plat_mv_notdir` (`mv -fT` / `rename(2)`), which replaces WHATEVER
    // directory entry is at the destination — dangling symlink, loop, or
    // ordinary file — without needing to resolve it. Only a real DIRECTORY at
    // the destination is refused (covered by the existing "rename cannot
    // land" case above); a dangling link or a loop is not that shape.
    h.makeRepo('demo');
    fs.mkdirSync(POOLS(), { recursive: true });
    fs.symlinkSync('/nonexistent/target', path.join(POOLS(), 'demo'));
    expect(h.sh('cmd_project_pool --project demo --pool pool-a')).toBe('tagged demo pool-a');
    expect(state('demo')).toBe('named pool-a');

    fs.rmSync(path.join(POOLS(), 'demo'));
    const p = path.join(POOLS(), 'demo');
    fs.symlinkSync(p, p);
    expect(h.sh('cmd_project_pool --project demo --pool pool-b')).toBe('tagged demo pool-b');
    expect(state('demo')).toBe('named pool-b');
  });

  it('accepts a registry-only project on --pool — a custom workdir has no directory', () => {
    // Four production projects are not git repositories and dispatched
    // workspaces can carry a workdir outside $PROJECTS_ROOT, so "a project" is
    // EITHER a directory under $PROJECTS_ROOT OR a registry row naming it.
    fs.writeFileSync(path.join(REG(), 'claude-quiet-basin.project'), 'quiet-basin');
    expect(fs.existsSync(path.join(h.home, 'projects', 'quiet-basin'))).toBe(false);
    expect(h.sh('cmd_project_pool --project quiet-basin --pool pool-a')).toBe('tagged quiet-basin pool-a');
  });

  it('refuses --pool for a project that is neither a directory nor a registry row', () => {
    const r = shFail('cmd_project_pool --project never-existed --pool pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no such project');
    expect(r.stdout).not.toContain('tagged');
    expect(fs.existsSync(POOLS())).toBe(false);
  });

  it('refuses a missing, an extra and a misspelt flag — each by the usage sentence', () => {
    for (const argv of ['', '--project', '--project demo', '--project demo --pool',
      '--project demo --pool pool-a extra', '--proj demo --pool pool-a',
      '--project demo --poool pool-a']) {
      const r = shFail(`cmd_project_pool ${argv}`);
      expect(r.code, `argv: ${argv}`).not.toBe(0);
      expect(r.stderr, `argv: ${argv}`)
        .toContain('usage: ccd project-pool --project <p> --pool <name>|--clear');
    }
  });

  it('validates the project BEFORE touching the filesystem, and touches nothing', () => {
    const before = treeUnderHome();
    for (const p of ['../x', '.hidden', 'a b', '', 'a/b']) {
      const r = shFail(`cmd_project_pool --project ${JSON.stringify(p)} --pool pool-a`);
      expect(r.code, JSON.stringify(p)).not.toBe(0);
      expect(r.stderr, JSON.stringify(p)).toContain('invalid project');
    }
    expect(treeUnderHome()).toEqual(before);
  });

  it('refuses an off-grammar pool name by its OWN sentence, not the usage one', () => {
    // A caller who got the shape right and the vocabulary wrong is a different
    // condition from a malformed argv, and folding them answers "usage" to
    // someone whose usage was fine (`cmd_coord_pause`'s own split).
    h.makeRepo('demo');
    for (const bad of ['Pool-a', 'pool a', '', '-pool', 'pool_a', 'a'.repeat(33)]) {
      const r = shFail(`cmd_project_pool --project demo --pool ${JSON.stringify(bad)}`);
      expect(r.code, JSON.stringify(bad)).not.toBe(0);
      expect(r.stderr, JSON.stringify(bad)).toContain('invalid pool name');
      expect(r.stderr, JSON.stringify(bad)).not.toContain('usage: ccd project-pool');
    }
    expect(fs.existsSync(POOLS())).toBe(false);
  });

  it('warns on stderr — and still tags — when no rostered account carries the name', () => {
    // A WARNING, not a refusal: this pool may be about to gain an account, and
    // the FLEET's roster copy is the authority (the server's can lag it).
    h.makeRepo('demo');
    const opts = {
      encoding: 'utf8' as const, cwd: h.home,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
    };
    const out = execFileSync('bash',
      ['-c', `source ${JSON.stringify(CCD)}; cmd_project_pool --project demo --pool pool-b 2>&1`], opts);
    expect(out).toContain('warn: no rostered account is in pool pool-b');
    expect(out).toContain('tagged demo pool-b');
    expect(state('demo')).toBe('named pool-b');
  });

  it('refuses when $REG is not a directory — the tag has nowhere to live', () => {
    // Deleting $REG does NOT produce this state: ccd runs `mkdir -p "$REG"` at
    // source time. A FILE at the path is the state the guard answers, and it
    // discriminates for any uid, root included.
    fs.rmSync(REG(), { recursive: true, force: true });
    fs.writeFileSync(REG(), 'not a directory\n');
    const r = shFail('cmd_project_pool --project demo --pool pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no registry');
    expect(r.stdout).not.toContain('tagged');
  });
});

describe('ccd project-pool — the write is CHECKED in both directions', () => {
  it('refuses LOUDLY when the tag cannot be written — it is NOT tagged (any uid)', () => {
    // A regular FILE where $REG/pools belongs makes `mkdir -p` fail for root
    // too. ccd runs `set -uo pipefail` with NO `-e`: unguarded, the failure
    // falls straight through to the echo and a route keyed on the exit code is
    // told the project is constrained while ccd places work anywhere it likes.
    h.makeRepo('demo');
    fs.writeFileSync(POOLS(), 'not a directory\n');
    const r = shFail('cmd_project_pool --project demo --pool pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('NOT tagged');
    expect(r.stdout).not.toContain('tagged demo');
  });

  it('refuses LOUDLY when the rename cannot land — it is NOT tagged (any uid)', () => {
    // A DIRECTORY at the tag path: `_plat_mv_notdir` refuses to overwrite a
    // directory with a non-directory on both userlands, for any uid.
    h.makeRepo('demo');
    fs.mkdirSync(path.join(POOLS(), 'demo'), { recursive: true });
    const r = shFail('cmd_project_pool --project demo --pool pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('NOT tagged');
    expect(r.stdout).not.toContain('tagged demo');
    // …and the tmp file it could not rename is gone.
    expect(fs.readdirSync(POOLS())).toEqual(['demo']);
  });

  it.skipIf(process.getuid?.() === 0)(
    'refuses LOUDLY when the tmp write is denied — it is NOT tagged', () => {
      h.makeRepo('demo');
      fs.mkdirSync(POOLS(), { recursive: true });
      fs.chmodSync(POOLS(), 0o500);
      try {
        const r = shFail('cmd_project_pool --project demo --pool pool-a');
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('NOT tagged');
        expect(r.stdout).not.toContain('tagged demo');
      } finally {
        fs.chmodSync(POOLS(), 0o700);
      }
    });

  it('refuses LOUDLY when the tag cannot be removed — placement may still be constrained (any uid)', () => {
    // `rm -f` suppresses ENOENT only; EISDIR still exits non-zero, for root as
    // well. The polarity that matters: a caller told the project was untagged
    // while the constraint still binds every placement.
    //
    // Message updated in Fix round 2 (Finding 4): the removal decision now
    // comes from `$oldstate`, not a fresh `-e`/`-L` test, so the failure
    // message had to stop claiming a NAMED tag ("STILL tagged") since a
    // DIRECTORY here reads `oldstate=unreadable`, not `named <pool>` — "may
    // still be constrained" is honest for every non-`untagged` state.
    fs.mkdirSync(path.join(POOLS(), 'demo'), { recursive: true });
    const r = shFail('cmd_project_pool --project demo --clear');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('may still be constrained');
    expect(r.stdout).not.toContain('untagged demo');
  });
});

describe('the marker namespace cannot collide with a session id', () => {
  it('a tag for project acct-a-demo is not the registry `pool` field of session acct-a-demo', () => {
    // The registry `pool` field is a SPACE-SEPARATED CANDIDATE LIST with no
    // writer in the tree, not a pool name — two meanings of one word in one
    // file (D-1666). `$REG/<project>.pool` would have made them one
    // file: ids are `<wrapper>-<project>`, so a project named `acct-a-demo`
    // collides with the session `acct-a-demo`.
    fs.writeFileSync(path.join(REG(), 'acct-a-demo.project'), 'acct-a-demo');
    h.sh('cmd_project_pool --project acct-a-demo --pool pool-a');
    expect(h.reg('acct-a-demo', 'pool')).toBeNull();
    expect(h.sh('_pool_for acct-a-demo')).toBe(h.sh('_default_pool acct-a-demo'));
  });

  it('_reg_purge takes the row and leaves the tag byte-identical', () => {
    // `_reg_purge` is what `forget`, `ws-reap` and the dead-reg arm all use.
    // A project's tag outlives every one of its workspaces BY DESIGN.
    fs.writeFileSync(path.join(REG(), 'acct-a-demo.project'), 'acct-a-demo');
    fs.writeFileSync(path.join(REG(), 'acct-a-demo.uuid'), '1'.repeat(36));
    h.sh('cmd_project_pool --project acct-a-demo --pool pool-a');
    const before = fs.readFileSync(path.join(POOLS(), 'acct-a-demo'));
    h.sh('_reg_purge acct-a-demo');
    expect(fs.existsSync(path.join(REG(), 'acct-a-demo.uuid'))).toBe(false);
    expect(fs.readFileSync(path.join(POOLS(), 'acct-a-demo'))).toEqual(before);
  });

  it('a project literally named `pools` does not wedge the slug namespace', () => {
    fs.writeFileSync(path.join(REG(), 'pools-quiet-basin.uuid'), '2'.repeat(36));
    h.makeRepo('pools');
    h.sh('cmd_project_pool --project pools --pool pool-a');
    // The DIRECTORY $REG/pools is invisible to the suffix-shaped glob
    // `$REG/<id>.*` that `_ws_slug_free` walks; only the real registry row
    // holds a slug.
    expect(h.sh('_ws_slug_free pools quiet-basin && echo free || echo taken')).toBe('taken');
    expect(h.sh('_ws_slug_free pools quiet-mesa && echo free || echo taken')).toBe('free');
    expect(state('pools')).toBe('named pool-a');
  });
});

describe('pools-v1 is safe to advertise before wave 2b implements --cross-pool (Fix round 2, Finding 5)', () => {
  // MEASUREMENT, not a fix — no code changes ride with this describe. The
  // `echo pools-v1` comment argues that a wave-3 server meeting a 2a-only
  // fleet box gets a LOUD failure rather than a silent `200 {ok:true}`,
  // because `--cross-pool` is specified LEADING, before the positionals: on
  // a `ccd` that does not know the flag it lands in a POSITIONAL slot some
  // existing validation refuses (which check fires depends on the verb and
  // is measured per case below — see Finding 8's correction on `swap`), and
  // the verb DIES. Wave 3 will pin that its own builders EMIT a leading
  // flag — a different claim from THIS one, that today's `ccd` REFUSES a
  // leading one, and only this second claim makes advertising the token
  // early actually safe. Nothing here asserts what the flag DOES (there is
  // no `--cross-pool` behaviour yet); each case only asserts a nonzero exit,
  // which is the entire safety property this early token depends on.
  it('a leading --cross-pool on `swap` dies loudly — but not because `_is_valid_wrapper` sees the flag itself', () => {
    // Corrected in fix round 3 (Finding 8): the flag lands in the `id` slot
    // (the `*)` arm collects it as the first positional) and `id` is never
    // passed to `_is_valid_wrapper` at all — only checked against
    // `$REG/$id.uuid`'s existence, further down. What actually refuses HERE
    // is the SECOND positional, shifted one slot right by the flag's
    // presence: `target` becomes the string meant to be the session id
    // ("demo"), and THAT fails `_is_valid_wrapper` (a session id string is
    // not a wrapper name).
    const r = shFail('cmd_swap --cross-pool demo pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown wrapper 'demo'");
  });

  it('a leading --cross-pool on `swap` still dies when the shifted target happens to be a real wrapper — a different lock catches it', () => {
    // The realistic skew, added per fix round 3 (Finding 8): a session id
    // that COLLIDES with a roster wrapper id (`claude-a`/`claude-b`, both
    // real fixture wrappers). Here `_is_valid_wrapper "$target"` PASSES
    // ("claude-a" is a genuine wrapper) — the refusal instead comes from
    // the FIRST lock further down: `[[ -f "$REG/$id.uuid" ]] || die "no
    // registry for '$id'"`, where `$id` is still the literal flag
    // `--cross-pool`. Still nonzero, but by a DIFFERENT lock than the case
    // above — the pin covers both paths, not only the one where the target
    // happens to be invalid.
    const r = shFail('cmd_swap --cross-pool claude-a claude-b');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("no registry for '--cross-pool'");
  });

  it('a leading --cross-pool on `start` dies loudly — `$# -ge 2` makes `wrapper` the flag itself, `_is_valid_wrapper` refuses it', () => {
    const r = shFail('cmd_start --cross-pool demo pool-a');
    expect(r.code).not.toBe(0);
  });

  it('a leading --cross-pool on `enable` dies loudly too, but only AFTER one lifecycle line is written for the bogus id it computes first', () => {
    // Nuance that must not be lost: `cmd_enable` runs `_lc_done enable "$id" ""`
    // BEFORE delegating to `cmd_start`, so a skewed `enable --cross-pool …`
    // writes a lifecycle entry for a bogus id (`_id "--cross-pool" demo` =
    // `--cross-pool-demo`) and only THEN fails — it does not die before doing
    // anything. Harmless (the id is bogus and nothing downstream trusts it),
    // but this test's own name must say what actually happens, not "dies
    // before doing anything".
    const r = shFail('cmd_enable --cross-pool demo pool-a');
    expect(r.code).not.toBe(0);
    const lcDir = path.join(REG(), '.lifecycle');
    expect(fs.existsSync(lcDir)).toBe(true);
    const journal = fs.readdirSync(lcDir)
      .map((f) => fs.readFileSync(path.join(lcDir, f), 'utf8')).join('\n');
    expect(journal).toContain('"id":"--cross-pool-demo"');
  });
});
