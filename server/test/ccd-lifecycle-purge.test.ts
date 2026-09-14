// server/test/ccd-lifecycle-purge.test.ts
//
// D3, and it is the load-bearing guard of the whole design: the line is emitted
// INSIDE `_reg_purge`, BEFORE the unlink loop, while `meas` is still readable.
// Every destruction path on this box terminates there — ws-rm, ws-reap, ws-gc's
// dead-reg arm, forget — so a destructive verb added LATER that forgets to
// journal itself still leaves a record. A silent destruction has to defeat two
// independent emit sites.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts:1045`'s
// `/^ccd.*\.ts$/` containment scan. Every snippet runs through `h.sh`, whose
// harness contains gh, systemd and tmux; nothing here reaches a live service.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { CCD, makeCcdHarness, ghContainedEnv, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, measOf, lcDir, readJournal, compactLockPath, holdCompactLock } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-purge-'); });
afterEach(() => { h.cleanup(); });

const seed = (id = 'demo-still-river'): string => {
  h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199
    _reg_set ${id} project demo
    _reg_set ${id} workspace still-river
    _reg_set ${id} branch ws/still-river
    _reg_set ${id} wrapper claude-corp
    _reg_set ${id} workdir /data/worktrees/demo/still-river
    _reg_set ${id} archived 1787000000
    _reg_set ${id} archivedreason merged:#42`);
  return id;
};

describe('_reg_purge always journals, and journals BEFORE it unlinks', () => {
  it('records the whole meas family, read while the files still exist', () => {
    const id = seed();
    h.sh(`_reg_purge ${id}`);
    const purges = eventsOf(h.home, 'purge');
    // HARD guard before the `[0]!` dereference below — STANDING RULE #1's
    // documented exception, so a missing event is a clean assertion rather
    // than an uncaught TypeError on the next line.
    expect(purges, 'the backstop did not fire').toHaveLength(1);
    const m = measOf(purges[0]!);
    // Nine INDEPENDENT claims about nine different fields — STANDING RULE #1.
    expect.soft(purges[0]!['id']).toBe(id);
    expect.soft(m['project']).toBe('demo');
    expect.soft(m['workspace']).toBe('still-river');
    expect.soft(m['branch']).toBe('ws/still-river');
    expect.soft(m['wrapper']).toBe('claude-corp');
    expect.soft(m['uuid']).toBe('72be9ee2-0000-4bcc-b60b-0cfc0dc3d199');
    expect.soft(m['workdir']).toBe('/data/worktrees/demo/still-river');
    expect.soft(m['archivedAt']).toBe('1787000000');
    expect.soft(m['archivedReason']).toBe('merged:#42');
  });


  it('a removal failure AFTER the emit returns NONZERO, with the purge-done fact already on disk', () => {
    // §3.4: "the unlink loop runs strictly AFTER the emit, so by the time any
    // `rm -f` can fail the purge-done fact is already journaled; such a run
    // returns NONZERO with the fact on disk and registry/generation possibly
    // still standing, and its three post-action callers report `_lc_fail`."
    // The emit stays unconditional and unmoved; only the STATUS is new.
    //
    // `rm` is shadowed rather than the directory made read-only, and that is
    // forced: `_compact_lock_acquire` must LINK a fresh lock-open alias into
    // `$REG` before it can hold anything, so a read-only `$REG` refuses the
    // acquire and `_reg_purge` returns 1 before the emit — the wrong condition
    // entirely. The shadow fails only this row's DIRECT children of `$REG`, so
    // the lifecycle journal one directory down still records the fact.
    const id = seed();
    const RM = `rm() { local a; for a in "$@"; do case "$a" in`
      + ` "$REG"/*/*) continue ;; "$REG"/${id}.*|"$REG"/.${id}.*) return 1 ;;`
      + ` esac; done; command rm "$@"; };`;
    const out = h.sh(`${RM} _reg_purge ${id}; echo "rc=$?"`);
    expect(out, 'a purge that could not unlink is not a success').not.toContain('rc=0');
    expect(out).toMatch(/rc=[1-9]/);
    // THE FACT IS STILL THERE — the emit is not gated on the unlinks, and this
    // is the half that must NOT change: a silent destruction has to defeat two
    // independent emit sites, and a removal failure is not a licence to lose
    // the record of what was about to be destroyed.
    const purges = eventsOf(h.home, 'purge');
    expect(purges, 'exactly one purge-done, journaled before the loop').toHaveLength(1);
    expect(measOf(purges[0]!)['project']).toBe('demo');
    // …and the row is still standing, which is exactly why the status matters.
    expect(h.reg(id, 'uuid'), 'nothing was actually removed').not.toBeNull();
  });

  it('CONTROL: the same purge with a working `rm` returns ZERO and takes the row', () => {
    const id = seed();
    const out = h.sh(`_reg_purge ${id}; echo "rc=$?"`);
    expect(out, 'so the nonzero above is the failed unlink and not the purge').toContain('rc=0');
    expect(h.reg(id, 'uuid')).toBeNull();
    expect(eventsOf(h.home, 'purge')).toHaveLength(1);
  });
  it('THE MUTANT: an emit moved after the loop reads a stripped registry', () => {
    // Mutant: move the `_lc_done purge …` line from above `local id="$1"` to
    // below the loop's closing `done` -> this fails with
    // `expected undefined to be 'ws/still-river'`, because ccd:535 has already
    // unlinked every field but `archived`/`reaping`. That is the whole reason
    // the emit is where it is.
    const id = seed();
    h.sh(`_reg_purge ${id}`);
    const events = eventsOf(h.home, 'purge');
    // HARD guard before the `[0]!` dereference below — STANDING RULE #1's
    // documented exception.
    expect(events, 'the backstop did not fire').toHaveLength(1);
    const m = measOf(events[0]!);
    // Independent claims — STANDING RULE #1.
    expect.soft(m['branch']).toBe('ws/still-river');
    expect.soft(m['workdir']).toBe('/data/worktrees/demo/still-river');
    expect.soft(fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((n) => n.startsWith(`${id}.`)))
      .toEqual([]);
  });

  it('omits a field that was never measured rather than writing it as ""', () => {
    h.sh(`_reg_set bare-row uuid abc; _reg_purge bare-row`);
    const events = eventsOf(h.home, 'purge');
    // HARD guard before the `[0]!` dereference below — STANDING RULE #1's
    // documented exception.
    expect(events, 'the backstop did not fire').toHaveLength(1);
    const m = measOf(events[0]!);
    // Independent claims — STANDING RULE #1.
    expect.soft(m['uuid']).toBe('abc');
    expect.soft(m).not.toHaveProperty('branch');
    expect.soft(m).not.toHaveProperty('archivedReason');
  });

  it('journals a purge for a row that has NOTHING left — the id alone is a record', () => {
    h.sh('_reg_purge never-existed');
    const purges = eventsOf(h.home, 'purge');
    expect(purges).toHaveLength(1);
    expect(purges[0]!['id']).toBe('never-existed');
  });

  it('is unconditional: the emit is not guarded by any condition in the source', () => {
    // The emit must sit at the top of the function body with nothing between it
    // and the opening brace but the header comment. A future `if` around it is
    // exactly how a silent destruction gets back in.
    const src = readFileSync(CCD, 'utf8');
    const from = src.indexOf('_reg_purge() {');
    // HARD guard: everything below slices/indexes off `from`, so a miss here
    // must stop the test rather than silently operating on -1.
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf('_substrate_mark() {'));
    // Independent claims about the body's structure — STANDING RULE #1.
    expect.soft(body).toMatch(/_lc_done\s+purge\s+"\$1"/);
    const emitAt = body.indexOf('_lc_done purge');
    const loopAt = body.indexOf('for f in "$REG/$id".*');
    expect.soft(emitAt).toBeGreaterThan(-1);
    expect.soft(loopAt, 'the unlink loop moved — re-measure before trusting this').toBeGreaterThan(-1);
    expect.soft(emitAt, 'the backstop must precede the unlink loop').toBeLessThan(loopAt);

    // FIX ROUND 1 (d): the mutation-table gap the reviewer found. The reviewer
    // mutated the emit to `meas.held "$(_reg_get "$1" hold)" || return 1` —
    // simulating a future edit that GATES the purge on the journal — and every
    // test in this file stayed green, because `_lc_done` genuinely always
    // returns 0 TODAY, so the `|| return 1` never fires. That contract is
    // real, but nothing here would catch a regression that broke it AT THIS
    // CALL SITE — the position check above says nothing about a trailing
    // guard. So: assert the statement itself, start to end, carries no `||`
    // or `&&` anywhere in it. `heldLine` anchors the statement's last
    // continuation line (the one with no trailing `\`, where the bash
    // statement actually ends); the slice from `_lc_done purge` through the
    // end of that line is the WHOLE statement, and none of its `$(_reg_get …)`
    // substitutions contain `||`/`&&` themselves, so a plain substring/regex
    // scan of the slice is unambiguous.
    const heldLine = 'meas.held           "$(_reg_get "$1" hold)"';
    const heldAt = body.indexOf(heldLine);
    expect(heldAt, 'the last meas.* line moved — re-measure before trusting this').toBeGreaterThan(-1);
    // Slice to the END OF THE LINE, not to the end of `heldLine`'s own text —
    // `heldLine` is only an ANCHOR. A trailing ` || return 1` appended after
    // the closing quote is still a substring match on `heldLine` (it's a
    // prefix of the mutated line), so cutting the slice at
    // `heldAt + heldLine.length` would silently exclude exactly the guard
    // this assertion exists to catch. Measured: that was this test's own
    // first draft, and it passed against the mutated source below — a false
    // negative in the guard meant to catch a false negative.
    const lineEnd = body.indexOf('\n', heldAt);
    expect(lineEnd, 'no newline after the last meas.* line — re-measure before trusting this').toBeGreaterThan(-1);
    const stmt = body.slice(emitAt, lineEnd);
    expect(stmt, 'a trailing `||`/`&&` on this statement can gate the purge on the journal — D7 forbids it')
      .not.toMatch(/\|\||&&/);
  });
});

/** The registry files still standing for `id`, so a purge failure shows up as a
 *  non-empty list rather than a thrown assertion on a specific field. */
const regFilesOf = (id: string): string[] =>
  fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((n) => n.startsWith(`${id}.`));

/** Runs one snippet with raw `spawnSync`, not `h.sh` — `h.sh` only ever
 *  returns stdout, so a leaked diagnostic on stderr (bash's own, not
 *  `_lc_*`'s) would pass silently. Mirrors `ccd-lifecycle-gen.test.ts`'s own
 *  "leaks nothing to stderr" idiom. */
const runContained = (snippet: string): ReturnType<typeof spawnSync> => {
  const env = ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true });
  return spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], { encoding: 'utf8', cwd: h.home, env });
};

describe('_reg_purge purges even when the journal cannot record it — D7, never gate the act', () => {
  // The journal is best-effort and never gates the act (D7) — nowhere does that
  // matter more than here, because the alternative is a workspace that cannot
  // be deleted because its own destruction could not be written down.
  it('completes and unlinks the registry when $_LC_DIR is unwritable', () => {
    const id = seed();
    const dir = lcDir(h.home);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    let r: ReturnType<typeof spawnSync>;
    try {
      r = runContained(`_reg_purge ${id}`);
    } finally {
      fs.chmodSync(dir, 0o755);   // restore so afterEach's own cleanup can remove the tree
    }
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(r.stderr).toBe('');
    expect.soft(regFilesOf(id)).toEqual([]);
  });

  it('completes and unlinks the registry when python3 is absent', () => {
    const id = seed();
    const r = runContained(`python3() { return 127; }; _reg_purge ${id}`);
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(r.stderr).toBe('');
    expect.soft(regFilesOf(id)).toEqual([]);
  });

  it('completes and unlinks the registry when the journal directory is a regular file', () => {
    const id = seed();
    const dir = lcDir(h.home);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, 'not a directory\n');
    const r = runContained(`_reg_purge ${id}`);
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(r.stderr).toBe('');
    expect.soft(regFilesOf(id)).toEqual([]);
  });
});

describe('the observability probe stays memoised across one destruction run', () => {
  // FIX ROUND 1 (b): a coverage hole this task itself created. `_reg_purge`'s
  // emit is `_lc_done`'s first REAL call site anywhere in `ccd/ccd` — Tasks
  // 12-16 built the writer and its four wrapper shapes but wired none of
  // them — so this is also the first time `_lc_obs`'s pane probe
  // (`tmux list-panes -a -F '#{session_name} #{pane_pid}'`, memoised once per
  // process) fires on a live destructive path. `ccd-forget.test.ts` and
  // `ccd-ws-reap.test.ts` both assert `calls()` with `toContain(...)`, a
  // SUBSET match that would not notice a second probe appearing — that is why
  // they stayed green without any change when this task landed, and why the
  // exact-sequence guard belongs HERE rather than duplicated into either of
  // them (a comment at each site points back to this describe).
  //
  // `h.tmuxCalls()` reads the harness's CONTAINED tmux PATH stub
  // (`ghContainedEnv(…, { tmux: true })`), never the shell-function `tmux()`
  // stub some other files define — none of THIS file's snippets shadow
  // `tmux`, so `_lc_obs`'s probe resolves through PATH into the poison and is
  // recorded there, exactly like `ccd-lifecycle-emit.test.ts`'s own
  // "harness default" precedent.
  it('one whole `_reg_purge` run shells exactly one tmux probe', () => {
    const id = seed();
    h.sh(`_reg_purge ${id}`);
    expect(h.tmuxCalls()).toEqual(['list-panes -a -F #{session_name} #{pane_pid}']);
  });
});

// ── D-2605: row generation, the locked purge, and the honest callers ─────
describe('the row generation, and the purge that runs under the row mutex (spec §3.4)', () => {
  const REG = (): string => path.join(h.home, '.cc-sessions');
  const gen = (id: string): string => path.join(REG(), `${id}.generation`);
  const lock = (id: string): string => path.join(REG(), `.${id}.compactions.lock`);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  /** `_reg_generation_init` under a real acquisition, the way row creation
   *  calls it — the only minting site there is. */
  const init = (id: string): string =>
    h.sh(`_compact_lock_acquire ${id} 5 || { echo LOCKFAIL; exit 0; }
          fd="$COMPACT_LOCK_FD"
          if _reg_generation_init ${id}; then echo OK; else echo REFUSED; fi
          _compact_lock_release "$fd"`);

  it('mints EXACTLY 36 bytes with no terminal LF — asserted by wc -c, not by a pattern alone', () => {
    expect(init('demo-quiet-basin')).toBe('OK');
    const raw = fs.readFileSync(gen('demo-quiet-basin'));
    // THE BYTE COUNT IS THE CONTRACT, and a regex alone cannot carry it: a
    // naive `_plat_uuid > file` writes 37 bytes (measured — both branches of
    // `_plat_uuid` end in a newline, and `cat /proc/sys/kernel/random/uuid` is
    // 37 bytes on disk). Such a row is WEDGED FOR EVER: the value fails the
    // grammar on every later read, nothing may mint over an invalid present
    // generation, and no compliant cleanup unlinks one either.
    expect(raw.length, 'exactly 36 bytes').toBe(36);
    expect(raw.includes(0x0a), 'no terminal LF').toBe(false);
    expect(raw.toString('utf8')).toMatch(UUID);
  });

  it('is IDEMPOTENT on a valid row and NEVER repairs, replaces or removes an invalid one', () => {
    expect(init('demo-quiet-basin')).toBe('OK');
    const first = fs.readFileSync(gen('demo-quiet-basin'), 'utf8');
    expect(init('demo-quiet-basin')).toBe('OK');
    expect(fs.readFileSync(gen('demo-quiet-basin'), 'utf8'), 'a valid generation is immutable').toBe(first);

    // EVERY PRESENT-INVALID SHAPE REFUSES, and the bytes are left exactly as
    // found — that is what makes "absence is the only mint condition" a
    // mechanism rather than a hope.
    for (const [name, bytes] of [
      ['uppercase', '0189ABCD-1234-5678-9ABC-0123456789AB'],
      ['trailing LF', '0189abcd-1234-5678-9abc-0123456789ab\n'],
      ['empty', ''],
      ['multiline', '0189abcd-1234-5678-9abc-0123456789ab\nmore\n'],
      ['malformed', 'not-a-uuid'],
      ['short', '0189abcd-1234-5678-9abc-0123456789a'],
    ] as const) {
      const id = 'demo-quiet-mesa';
      fs.writeFileSync(gen(id), bytes);
      expect(init(id), `${name} is refused`).toBe('REFUSED');
      expect(fs.readFileSync(gen(id), 'utf8'), `${name} is left exactly as found`).toBe(bytes);
    }
  });

  it('a FIFO, a directory and a symlink at the pathname all refuse, and none is replaced', () => {
    const id = 'demo-quiet-mesa';
    spawnSync('mkfifo', [gen(id)]);
    expect(init(id), 'FIFO').toBe('REFUSED');
    expect(fs.lstatSync(gen(id)).isFIFO(), 'the FIFO is still there').toBe(true);
    fs.unlinkSync(gen(id));

    fs.mkdirSync(gen(id));
    expect(init(id), 'directory').toBe('REFUSED');
    expect(fs.lstatSync(gen(id)).isDirectory()).toBe(true);
    fs.rmdirSync(gen(id));

    // A DANGLING symlink is PRESENT AND INVALID, never absent — `-e` is false
    // for it, which is exactly why `-L` is asked beside `-e`. Folding it into
    // absence would let a mint clobber a name somebody else owns.
    fs.symlinkSync(path.join(REG(), 'nowhere'), gen(id));
    expect(init(id), 'dangling symlink').toBe('REFUSED');
    expect(fs.lstatSync(gen(id)).isSymbolicLink()).toBe(true);
  });

  it('CONCURRENT minting publishes exactly ONE value: no-clobber `link`, and EEXIST reclassifies', () => {
    const id = 'demo-quiet-basin';
    // Eight real processes against one absent generation. `link` is no-clobber
    // (measured: rc 1 `File exists`, nothing changed), so the loser reads the
    // incumbent back rather than repairing or replacing it.
    const out = h.sh(`for i in 1 2 3 4 5 6 7 8; do
        ( _compact_lock_acquire ${id} 5 && { _reg_generation_init ${id}; _compact_lock_release "$COMPACT_LOCK_FD"; } ) &
      done; wait
      cat "$HOME/.cc-sessions/${id}.generation"`);
    expect(out).toMatch(UUID);
    const names = fs.readdirSync(REG()).filter((n) => n.includes('generation'));
    expect(names, 'one canonical generation and no leaked source or read alias')
      .toEqual([`${id}.generation`]);
  });

  it('a completed mint leaves NO private residue — no init source, no read alias, one permanent lock', () => {
    expect(init('demo-quiet-basin')).toBe('OK');
    const names = fs.readdirSync(REG());
    expect(names.filter((n) => n.includes('generation-init'))).toEqual([]);
    expect(names.filter((n) => n.includes('generation-read'))).toEqual([]);
    expect(names.filter((n) => n.includes('lock-init'))).toEqual([]);
    expect(names.filter((n) => n.includes('lock-open'))).toEqual([]);
    expect(names.filter((n) => n.includes('compactions.lock'))).toEqual(['.demo-quiet-basin.compactions.lock']);
  });

  it('GENERATION LAST is a MECHANISM: the purge loop SKIPS it and one explicit unlink takes it after the tail', () => {
    const src = readFileSync(CCD, 'utf8');
    const from = src.indexOf('_reg_purge() {');
    const body = src.slice(from, src.indexOf('_substrate_mark() {'));
    // `.generation` is a dot-free suffix like any other field, so WITHOUT the
    // skip the loop unlinks it in ordinary glob order and "generation last" is
    // a no-op comment. The skip and the explicit unlink are one mechanism and
    // are asserted together.
    expect(body).toContain('"$suffix" == archived || "$suffix" == reaping || "$suffix" == generation');
    const skipAt = body.indexOf('|| "$suffix" == generation');
    const tailAt = body.indexOf('[[ -e "$REG/$id.reaping" ]] || rm -f "$REG/$id.archived"');
    const genAt = body.indexOf('rm -f "$REG/$id.generation"');
    expect(skipAt).toBeGreaterThan(-1);
    expect(tailAt).toBeGreaterThan(-1);
    expect(genAt, 'the explicit generation unlink exists').toBeGreaterThan(-1);
    expect(genAt, 'and it comes AFTER the archived/reaping tail').toBeGreaterThan(tailAt);
  });

  it('the purge takes the row mutex, and the acquisition is the ONE statement before the unconditional emit', () => {
    const src = readFileSync(CCD, 'utf8');
    const from = src.indexOf('_reg_purge() {');
    const body = src.slice(from, src.indexOf('_substrate_mark() {'));
    const emitAt = body.indexOf('_lc_done purge');
    const head = body.slice(0, emitAt);
    // STRENGTHENING the landed "is unconditional" pin, which checks only
    // emit-before-loop and no trailing `||`/`&&` — both of which stay GREEN
    // under a silently inserted conditional guard. Nothing but the header
    // comment and THIS acquisition may stand here, so a third statement reds.
    //
    // THE ONE ADDITION (D-2605): `REG_PURGE_UNREMOVED=""`, the unconditional
    // clearing of the status-3 out-parameter. The property this scan defends is
    // that NOTHING HERE MAY GATE THE PURGE, and a bare assignment to a global
    // with no test, no `||`, no `&&` and no control flow cannot: whatever it is
    // set to, the next line still runs. It is admitted by its exact literal
    // text rather than by a widened shape — `REG_PURGE_UNREMOVED=$(…)` or a
    // conditional form still reds here — so this is one named statement, not a
    // hole. It must stay INSIDE the function: `ccd` is sourced by these suites
    // and a shell may purge twice, and a file-scope initialiser would let the
    // first run's pathname be read as the second's.
    const stmts = head.split('\n')
      .slice(1)                                   // the function's own `_reg_purge() {` line
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(stmts.length, `only the acquisition may stand here, found:\n${stmts.join('\n')}`).toBeGreaterThan(0);
    for (const st of stmts) {
      expect(st, `unexpected statement before the emit: ${st}`).toMatch(
        /^(local _pg_fd|REG_PURGE_UNREMOVED=""$|_compact_lock_acquire|if \(\( _pg_rc == 2 \)\)|if \[ -e "\$REG\/\$1\.generation"|elif \(\( _pg_rc != 0 \)\)|else$|_pg_fd="\$COMPACT_LOCK_FD"|fi$|return [12];?$)/);
    }
  });

  it('a HELD lock refuses the purge: nothing is journaled, nothing is deleted, and the row stands', async () => {
    const id = seed('demo-quiet-basin');
    // mint the row's generation and its permanent lock the way creation does
    expect(init(id)).toBe('OK');
    const before = fs.readdirSync(REG()).sort();
    const holder = spawn('bash', ['-c',
      `exec 9<>"$1" || exit 1; flock 9 || exit 1; echo held; exec sleep 8`, '_', lock(id)]);
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('holder never took the lock')), 10_000);
      holder.stdout.on('data', (d: Buffer) => { if (d.toString().includes('held')) { clearTimeout(t); res(); } });
      holder.on('error', (e) => { clearTimeout(t); rej(e); });
    });
    try {
      expect(h.sh(`_reg_purge ${id} && echo PURGED || echo REFUSED`)).toBe('REFUSED');
      expect(eventsOf(h.home, 'purge'), 'a lock miss journals NO purge-done fact').toHaveLength(0);
      expect(fs.readdirSync(REG()).sort(), 'and deletes nothing').toEqual(before);
    } finally { holder.kill('SIGKILL'); }
  }, 30_000);
});

/** The row mutex and the real process that holds it live in
 *  `lifecycleHelpers.ts`: two test files now drive a caller against a genuinely
 *  held lock (this one, and `ccd-ws-reap.test.ts`'s reap-tail leg), and a
 *  second copy of a fixture whose whole job is to make a race deterministic is
 *  exactly the drift this repo's single-definition doctrine refuses. */
const lockOf = (id: string): string => compactLockPath(h.home, id);
const hold = (id: string, secs: number): Promise<() => void> => holdCompactLock(h.home, id, secs);

/** A real worktree on a real branch, so `git worktree remove` and
 *  `git branch -d` both answer for real rather than through a stub. Module
 *  scope: the one-terminal-fact guard and the mechanism-absence matrix both
 *  need a workspace row a destructive verb will actually accept. */
const wsRow = (id = 'demo-still-river'): { main: string; wt: string } => {
  const main = h.makeRepo('demo');
  h.git(main, 'commit', '--allow-empty', '-m', 'base');
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
  h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo
    _reg_set ${id} workspace still-river; _reg_set ${id} branch ws/still-river
    _reg_set ${id} workdir ${wt}`);
  return { main, wt };
};
/** A dead WRAPPER session - uuid, project, workdir, wrapper and NO
 *  `.workspace`. `cmd_forget` refuses a workspace outright (`is-a-workspace`),
 *  so this is the only row shape that verb will act on. */
const wrapperRow = (id = 'claude-corp-demo'): string => {
  h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo
    _reg_set ${id} workdir /data/projects/demo; _reg_set ${id} wrapper claude-corp`);
  return id;
};
const RM_STUB = '_ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; };';
const FORGET_STUB = '_ws_unsupervise() { :; }; tmux() { return 1; }; _session_verdict() { echo gone; };';

// ── D-2605: the four callers, each answering for what it actually did ─────
describe('the purge callers read its status (spec §3.4, "Locked purge and honest callers")', () => {
  it('the DEAD-REG arm DECLINES: one refused fact for its own tx, no done, no reclaimed, and the row STANDS', async () => {
    const id = seed('demo-quiet-basin');
    const release = await hold(id, 8);
    try {
      // The arm's own sequence is `_lc_tx`, `_lc_intent destroy`, then the
      // purge — so this is the ONE caller whose refusal precedes anything
      // irreversible, and the only one that may decline rather than fail.
      const out = h.sh(`_ws_gc_prune_row dead-reg demo quiet-basin /nowhere 0; echo "DECLINED=$GC_DECLINED RECLAIMED=$GC_RECLAIMED"`);
      expect(out, 'a declined row naming the id').toContain('declined');
      expect(out).toContain('demo-quiet-basin');
      expect(out, 'and NOT a reclaimed row').toContain('DECLINED=1 RECLAIMED=0');

      const intents = eventsOf(h.home, 'destroy').filter((e) => e['outcome'] === 'intent');
      expect(intents, 'the arm minted its intent before it learned').toHaveLength(1);
      const tx = intents[0]!['tx'] as string;
      expect(tx, 'a MINTED, non-empty tx').not.toBe('');
      const terminal = eventsOf(h.home, 'destroy').filter((e) => e['tx'] === tx && e['outcome'] !== 'intent');
      // EXACTLY ONE TERMINAL FACT for that minted tx, and it is the refusal.
      // Reported only through `_gc_declined` — a printf report row, not a
      // lifecycle emit — the intent above would be left with ZERO terminal
      // facts, permanently, on every sweep.
      expect(terminal.map((e) => e['outcome'])).toEqual(['refused']);
      expect(terminal[0]!['refusal']).toBe('purge-refused');

      expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.uuid`)), 'the row still stands').toBe(true);
    } finally { release(); }
  }, 30_000);

  // ── D-2605: THE THIRD STATUS, AND IT IS THE OPPOSITE OF THE FIRST TWO ────
  // `flock` PRESENT, the lock UNCONTENDED, and one registry field `rm -f` will
  // not take. Before the split this produced the most confidently false record
  // in the file: `outcome:"refused"`, `refusal:"purge-refused"`, detail "the
  // compaction lock was unavailable; the registry row is untouched" — emitted
  // after the row had been irreversibly destroyed, with the lock held and the
  // purge-done fact already on disk. Every clause was wrong, and no assertion
  // in the suite could see it because no fixture drove a partial removal
  // through a real caller.
  const WEDGE = 'wedge';   // a dot-free suffix, so the purge's own loop takes it
  it('the DEAD-REG arm FAILS, not declines, when the purge RAN and left residue', () => {
    const id = seed('demo-quiet-basin');
    // A DIRECTORY at a dot-free registry suffix: `rm -f` refuses it (measured,
    // `rm: cannot remove …: Is a directory`, exit 1) while every sibling field
    // goes. No lock is held and none is shimmed away — this is the condition
    // the two "nothing happened" statuses are NOT.
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${id}.${WEDGE}`));
    const out = h.sh(`_ws_gc_prune_row dead-reg demo quiet-basin /nowhere 0; echo "DECLINED=$GC_DECLINED RECLAIMED=$GC_RECLAIMED"`);
    // Not `reclaimed` — a wedge is not a success — and not the word `declined`
    // on its own row either, because the row IS gone.
    expect(out, 'the row says what happened').toContain('incomplete');
    expect(out).toContain(`${id}.${WEDGE}`);
    expect(out, 'and it counts where the operator will notice it').toContain('DECLINED=1 RECLAIMED=0');

    const intents = eventsOf(h.home, 'destroy').filter((e) => e['outcome'] === 'intent');
    expect(intents, 'the arm minted its intent before it learned').toHaveLength(1);
    const tx = intents[0]!['tx'] as string;
    const terminal = eventsOf(h.home, 'destroy').filter((e) => e['tx'] === tx && e['outcome'] !== 'intent');
    // EXACTLY ONE terminal fact, and it is `failed` — `refused` is defined in
    // this file as "before anything irreversible", which this is not.
    expect(terminal.map((e) => e['outcome'])).toEqual(['failed']);
    expect(terminal[0]!['refusal']).toBe('purge-incomplete');
    // THE THREE FALSE CLAUSES, each asserted away.
    const detail = String(terminal[0]!['detail'] ?? '');
    expect(detail, 'the lock was HELD — blaming it is a fabricated cause').not.toContain('compactions.lock');
    expect(detail, 'the row was destroyed — "untouched" is the reverse of the truth').not.toContain('untouched');
    expect(detail, 'and it names what a hand has to remove').toContain(`${id}.${WEDGE}`);
    // The purge-done fact IS on disk — the emit is unconditional and precedes
    // every unlink — and the row really did go.
    expect(eventsOf(h.home, 'purge'), 'the purge fact was journaled').toHaveLength(1);
    expect(h.reg(id, 'uuid'), 'the row was destroyed, which is why this is not a refusal').toBeNull();
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.${WEDGE}`)), 'and the wedge stands').toBe(true);
  }, 30_000);

  it('ws-rm FAILS with the incomplete token too, and its message does not prescribe a retry', () => {
    // The same condition through a POST-ACTION caller, where the two statuses
    // were previously indistinguishable in the operator-facing sentence.
    wsRow('demo-still-river');
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `demo-still-river.${WEDGE}`));
    h.sh(`${RM_STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    const outs = eventsOf(h.home, 'destroy');
    expect(outs.map((e) => e['outcome']), 'intent, then exactly one terminal').toEqual(['intent', 'failed']);
    expect(outs[1]!['refusal']).toBe('purge-incomplete');
    const detail = String(outs[1]!['detail'] ?? '');
    expect(detail).toContain(`demo-still-river.${WEDGE}`);
    expect(detail, 'there is no compaction to wait for').not.toContain('once the compaction settles');
    expect(detail, 'the purge is not the thing that failed').not.toContain('could not be purged');
    expect(detail, 'it says so positively, so the reader is not left to infer it').toContain('WAS purged');
    expect(h.reg('demo-still-river', 'uuid')).toBeNull();
  }, 30_000);

  it('ws-rm and forget FAIL rather than decline — the act is already done, and the message says what stands', async () => {
    for (const [verb, act] of [['cmd_ws_rm', 'destroy'], ['cmd_forget', 'forget']] as const) {
      const id = seed('demo-quiet-basin');
      const release = await hold(id, 8);
      try {
        // Driven at `_reg_purge` plus the caller's own reporting shape, because
        // the whole of `cmd_ws_rm` needs a real worktree; what is under test is
        // the BRANCH, which measured did not exist before this task — all four
        // callers fell straight through to an unconditional success echo.
        const src = readFileSync(CCD, 'utf8');
        const body = src.slice(src.indexOf(`${verb}() {`));
        const end = body.indexOf('\n}\n');
        const fn = body.slice(0, end);
        // THE VALUE, NOT THE BOOLEAN (D-2605). `if ! _reg_purge` is exactly the
        // shape that collapsed a pre-emit lock refusal and a post-emit removal
        // failure into one message, so the pin is now its ABSENCE plus the
        // capture that replaced it.
        expect(fn, `${verb} reads the purge's status`).toMatch(/_reg_purge "\$id" \|\| _\w+_prc=\$\?/);
        expect(fn, `${verb} must not collapse the three conditions back to a boolean`)
          .not.toMatch(/if ! _reg_purge/);
        expect(fn, `${verb} reports it as a FAILURE, not a decline`).toContain(`_lc_fail ${act}`);
        expect(fn).toContain('purge-refused');
        expect(fn, 'and the post-emit condition has its own token').toContain('purge-incomplete');
        expect(fn, 'which is branched on by VALUE').toMatch(/\(\( _\w+_prc == 3 \)\); then/);
        expect(fn, 'and names what still stands').toContain('still stand');
        expect(fn, 'a refusal is never reported as success').toMatch(/return 1/);
      } finally { release(); }
    }
  }, 30_000);

  it('row creation acquires BEFORE any row field, and a miss leaves NOTHING', () => {
    const src = readFileSync(CCD, 'utf8');
    for (const verb of ['cmd_ws_add', 'cmd_start'] as const) {
      const whole = src.slice(src.indexOf(`${verb}() {`));
      // BOUNDED to the function, and CODE ONLY. Unbounded, `_reg_set "$id" `
      // is found in a LATER function; with comments in, it is found in this
      // one's own prose at `# \`_reg_set "$id" branch …\``, 15 KiB before the
      // acquire — both of which read as a real ordering failure rather than as
      // a broken scan.
      const body = whole.slice(0, whole.indexOf('\n}\n'))
        .split('\n').map((l) => (/^\s*#/.test(l) ? '' : l)).join('\n');
      const acquire = body.indexOf('_compact_lock_acquire "$id" "$COMPACT_LOCK_WAIT"');
      const firstSet = body.indexOf('_reg_set "$id" ');
      expect(acquire, `${verb} acquires`).toBeGreaterThan(-1);
      expect(firstSet, `${verb} writes row fields`).toBeGreaterThan(-1);
      // BEFORE THE FIRST FIELD, so a miss leaves no `.uuid`, no `.generation`,
      // no partial row — nothing irreversible has happened and re-running is
      // the whole remedy. That is the OPPOSITE disposition from
      // `_spawn_start`'s contended miss, and deliberately so.
      expect(acquire, `${verb}: the acquire precedes every _reg_set`).toBeLessThan(firstSet);
      const miss = body.slice(acquire, firstSet);
      expect(miss, 'and a miss dies retryably, naming the lock').toMatch(/die "could not take .*compactions\.lock/);
      expect(miss).toContain('nothing was');
      expect(miss).toContain('retry');
      // WHICH MISS, though, is not the same question for the two verbs, and
      // §3.4's platform outcome requires them to differ. `ws-add` MINTS the
      // generation, so it dies on the acquire itself (and on a flock-less box
      // its own `command -v flock` gate has already died, earlier). Row
      // creation is NOT gated on the mechanism at any value: rc 2 skips
      // generation initialization and CONTINUES, so `cmd_start`'s retryable
      // message — which names a 5 s timeout and prescribes a retry — is on the
      // rc-1 arm ALONE. A bare `||` here caught both, and told an operator on a
      // userland with no `flock` to keep re-running a verb that can never
      // succeed. The behaviour is leg (a2) of the mechanism-absence matrix;
      // this is the source half that says the two arms are distinguishable.
      if (verb === 'cmd_start') {
        expect(miss, 'cmd_start captures the status').toContain('_compact_lock_acquire "$id" "$COMPACT_LOCK_WAIT"; _cs_rc=$?');
        expect(miss, 'and the retryable die is the rc-1 arm alone')
          .toMatch(/\(\( _cs_rc == 1 \)\); then\n\s*die "could not take/);
        expect(miss, 'so no bare `|| die` catches mechanism absence with it')
          .not.toMatch(/\|\| die "could not take/);
      } else {
        expect(miss, 'ws-add dies on the acquire itself, both conditions alike')
          .toMatch(/\|\| die "could not take/);
      }
    }
  });


  it('_spawn_start CLOSES the lock before either fork — BY EFFECT, not by source order', () => {
    // §5 carries TWO rows for this property and says the second is "an EFFECT
    // pin, not the shape pin above". PreCompact's half is a real effect fixture
    // (`session-hook.test.ts`'s CLOSE-BEFORE-FORK test, where the CHILD tries
    // the mutex); `_spawn_start` had only the source-offset pin above it.
    // MEASURED: replacing `_compact_lock_release "$genfd"` with
    // `if false; then _compact_lock_release "$genfd"; fi` — which keeps every
    // string that pin searches for, in the same order — left the shape pin and
    // the whole suite green while the tmux server daemon inherited the row's
    // mutex, for the daemon's lifetime.
    const id = 'demo-still-river';
    h.sh(`_reg_set ${id} wrapper claude
      _reg_set ${id} workdir "$HOME"
      _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
    // `_tmux_new_session` stands in for the SERVER DAEMON: it outlives the
    // critical section and inherits whatever descriptors are open across the
    // fork. Each invocation opens the row's lock on its OWN descriptor and
    // reports whether it could take it — a held `flock` conflicts between open
    // file descriptions even inside one process, so an inherited hold answers
    // `blocked` here. That is the question no source-order pin can ask.
    const PROBE = `
      _tmux_new_session() {
        SPAWN_N=$(( \${SPAWN_N:-0} + 1 ))
        ( exec 9<>"$REG/.${id}.compactions.lock" || { echo "open$SPAWN_N" >> "$HOME/acq"; exit 0; }
          if flock -w 1 9; then echo "got$SPAWN_N" >> "$HOME/acq"; else echo "blocked$SPAWN_N" >> "$HOME/acq"; fi )
        case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac
      };
      sleep() { :; };
      tmux() { case "\${1:-}" in has-session) [[ -e "$HOME/pane-up" ]] ;; *) : ;; esac; };`;
    h.sh(`${PROBE} _spawn_start ${id} resume 2>/dev/null`);
    const acq = fs.readFileSync(path.join(h.home, 'acq'), 'utf8').trim().split('\n');
    // BOTH forks, and the second is the one that gets forgotten: the `--resume`
    // line dies, and the `--session-id` retry takes its OWN acquisition
    // immediately before its own fork.
    expect(acq, 'both spawn lines forked, and each child found the row mutex free')
      .toEqual(['got1', 'got2']);
  }, 30_000);

  it('CONTROL: a second, never-closed reference to the same lock leaves both children BLOCKED', () => {
    // What makes the leg above a measurement rather than a fixture that cannot
    // fail: the same probe, with the row's mutex genuinely held across the
    // forks by a descriptor nothing closes.
    const id = 'demo-still-river';
    h.sh(`_reg_set ${id} wrapper claude
      _reg_set ${id} workdir "$HOME"
      _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
    const PROBE = `
      _tmux_new_session() {
        SPAWN_N=$(( \${SPAWN_N:-0} + 1 ))
        ( exec 9<>"$REG/.${id}.compactions.lock" || { echo "open$SPAWN_N" >> "$HOME/acq"; exit 0; }
          if flock -w 1 9; then echo "got$SPAWN_N" >> "$HOME/acq"; else echo "blocked$SPAWN_N" >> "$HOME/acq"; fi )
        case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac
      };
      sleep() { :; };
      tmux() { case "\${1:-}" in has-session) [[ -e "$HOME/pane-up" ]] ;; *) : ;; esac; };`;
    h.sh(`${PROBE} _compact_lock_acquire ${id} 5; _spawn_start ${id} resume 2>/dev/null`);
    const acq = fs.readFileSync(path.join(h.home, 'acq'), 'utf8').trim().split('\n');
    expect(acq, 'a leaked hold is visible to both children').toEqual(['blocked1', 'blocked2']);
  }, 30_000);
  it('_spawn_start CLOSES the lock before either tmux command, and a contended miss spawns without the generation', () => {
    const src = readFileSync(CCD, 'utf8');
    const body = src.slice(src.indexOf('_spawn_start() {'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    const acquire = fn.indexOf('_compact_lock_acquire "$id" "$COMPACT_LOCK_WAIT"');
    const release = fn.indexOf('_compact_lock_release "$genfd"');
    const tmux1 = fn.indexOf('_tmux_new_session -d -s "$tname"');
    expect(acquire).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(-1);
    expect(tmux1).toBeGreaterThan(-1);
    // The tmux server daemon can outlive this critical section and a held
    // `{fd}<>` descriptor is inherited across fork/exec, so no compliant path
    // may rely on tmux calling `closefrom()`.
    expect(release, 'the release precedes the first tmux creation').toBeLessThan(tmux1);
    expect(acquire, 'and the acquire precedes the release').toBeLessThan(release);
    // BOTH commands carry it — the retry is the copy that gets forgotten.
    expect([...fn.matchAll(/exec env \$\{genenv\}COLORTERM=truecolor/g)],
      'both _tmux_new_session commands carry the generation env').toHaveLength(2);
    // It READS AND VALIDATES; it never MINTS.
    expect(fn).toContain('_reg_generation_read "$id"');
    expect(fn, '_spawn_start is not a second minter').not.toContain('_reg_generation_init');
    expect(fn, '...nor a direct one').not.toContain('_reg_generation_mint');
    // A CONTENDED miss fails OPEN, and says so where a human can see it.
    expect(fn).toMatch(/elif \(\( genrc == 1 \)\); then/);
    expect(fn).toContain('spawning without CCRC_SESSION_GENERATION');
    expect(fn).toContain('inert until its next respawn');
  });
});

// ── D-2605: ONE TERMINAL FACT PER MINTED TRANSACTION (spec §3.4, §5) ──────
// The guard the four-caller work needs and did not have. Each caller mints a
// `$lctx`, emits its `intent`, and must close it EXACTLY ONCE — with its own
// `_lc_done <act>`, `_lc_fail <act>` or `_lc_refuse_return <act>`. Two terminal
// facts for one act is a record that says the act both completed and did not;
// zero is an intent that stands open for ever on every sweep. Neither is
// visible to any assertion that counts one outcome at a time, which is how the
// status-blind arms shipped: `_ws_gc_prune_row`'s dead-reg arm emitted
// `_lc_done destroy` beside a refusal, and nothing named the pair.
//
// THE KEY IS THE MINTED, NON-EMPTY tx (`_lc_tx`'s `printf '%s.%s.%s'`, never
// empty), and that is what keeps the three literal-empty-tx emitters outside
// the guard rather than an exemption list: `_lc_refuse` (which never returns),
// `_lc_done purge` (empty by design — it is not half of a pair) and
// `cmd_ws_restore`'s `done`/`fail` pair, which is the GREEN CONTROL below. A
// guard that admitted `""` would red on the correct shipped tree.
describe('one terminal fact per minted transaction (spec §3.4)', () => {
  const TERMINAL = new Set(['done', 'failed', 'refused']);

  /** Every (act, id, tx) group the journal carries for a MINTED tx, with the
   *  terminal outcomes in it. Grouping on the intent as well as the outcome is
   *  what lets the guard see ZERO terminals — an orphaned intent forms a group
   *  of its own, where a scan over terminal rows alone would find nothing to
   *  complain about. */
  const txGroups = (home: string, admitEmptyTx = false): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const e of readJournal(home)) {
      const tx = String(e['tx'] ?? '');
      if (tx === '' && !admitEmptyTx) continue;
      const k = `${String(e['act'])} ${String(e['id'])} ${tx}`;
      const cur = m.get(k) ?? [];
      if (TERMINAL.has(String(e['outcome']))) cur.push(String(e['outcome']));
      m.set(k, cur);
    }
    return m;
  };

  /** THE GUARD. Returns the groups that break it, spelled so the failure names
   *  the act, the id and what it found. */
  const breaches = (home: string, admitEmptyTx = false): string[] =>
    [...txGroups(home, admitEmptyTx)]
      .filter(([, outs]) => outs.length !== 1)
      .map(([k, outs]) => `${k} -> [${outs.join(', ')}]`);

  /** NON-VACUITY, applied at every call site: a fixture that minted no
   *  transaction proves nothing, and an empty journal passes the guard
   *  trivially. */
  const assertGuard = (label: string): void => {
    expect([...txGroups(h.home).keys()].length, `${label}: the fixture minted a transaction`).toBeGreaterThan(0);
    expect(breaches(h.home), `${label}: one terminal fact per minted tx`).toEqual([]);
  };

  it('ws-rm closes its transaction once — on the completed path AND on the purge-refused one', async () => {
    wsRow();
    h.sh(`${RM_STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    assertGuard('ws-rm, completed');
    expect(eventsOf(h.home, 'destroy').map((e) => e['outcome'])).toEqual(['intent', 'done']);

    h = makeCcdHarness('ccrc-lc-purge-');
    wsRow();
    const release = await hold('demo-still-river', 8);
    try {
      h.sh(`${RM_STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
      assertGuard('ws-rm, purge refused');
      // The FAILURE closes it — not a second `done`, and not silence. `return 1`
      // after the `_lc_fail` is what keeps the success line below unreachable,
      // and dropping it is one of this guard's two named mutants.
      expect(eventsOf(h.home, 'destroy').map((e) => e['outcome'])).toEqual(['intent', 'failed']);
    } finally { release(); }
  }, 60_000);

  it('ws-rm closes it once when GIT refuses the worktree record — the `die` is what stops a second fact', () => {
    // A LOCKED worktree: `git worktree remove` refuses it, and this arm takes
    // no `--force`, so the failure is real rather than injected. The `_lc_fail`
    // is followed by a `die`, and dropping that `die` lets the same
    // transaction reach `_lc_done destroy` at the end of the verb.
    const { main, wt } = wsRow();
    h.git(main, 'worktree', 'lock', wt);
    // IN A SUBSHELL: the refusal here is `die`, i.e. `exit 1`, which in the
    // sourcing shell ends the snippet before `|| true` can run — the same
    // idiom, for the same reason, as `ccd-ws-reap.test.ts`'s flock-absence leg.
    h.sh(`${RM_STUB} ( cmd_ws_rm demo-still-river ) 2>/dev/null || true`);
    assertGuard('ws-rm, worktree-remove-failed');
    const outs = eventsOf(h.home, 'destroy');
    expect(outs.map((e) => e['outcome'])).toEqual(['intent', 'failed']);
    expect(outs[1]!['refusal'], 'git refused the record, and the record says so').toBe('worktree-remove-failed');
  });

  it('forget closes its transaction once — completed, and purge-refused', async () => {
    h.sh(`_reg_set claude-corp-demo uuid u; _reg_set claude-corp-demo project demo
      _reg_set claude-corp-demo workdir /data/projects/demo; _reg_set claude-corp-demo wrapper claude-corp`);
    h.sh(`${FORGET_STUB} cmd_forget claude-corp-demo 2>/dev/null || true`);
    assertGuard('forget, completed');
    expect(eventsOf(h.home, 'forget').map((e) => e['outcome'])).toEqual(['intent', 'done']);

    h = makeCcdHarness('ccrc-lc-purge-');
    h.sh(`_reg_set claude-corp-demo uuid u; _reg_set claude-corp-demo project demo
      _reg_set claude-corp-demo workdir /data/projects/demo; _reg_set claude-corp-demo wrapper claude-corp`);
    const release = await hold('claude-corp-demo', 8);
    try {
      h.sh(`${FORGET_STUB} cmd_forget claude-corp-demo 2>/dev/null || true`);
      assertGuard('forget, purge refused');
      expect(eventsOf(h.home, 'forget').map((e) => e['outcome'])).toEqual(['intent', 'failed']);
    } finally { release(); }
  }, 60_000);

  it('the dead-reg arm closes its transaction once — reclaimed, and declined', async () => {
    seed('demo-quiet-basin');
    h.sh('_ws_gc_prune_row dead-reg demo quiet-basin /nowhere 0');
    assertGuard('ws-gc dead-reg, reclaimed');
    expect(eventsOf(h.home, 'destroy').map((e) => e['outcome'])).toEqual(['intent', 'done']);

    h = makeCcdHarness('ccrc-lc-purge-');
    seed('demo-quiet-basin');
    const release = await hold('demo-quiet-basin', 8);
    try {
      h.sh('_ws_gc_prune_row dead-reg demo quiet-basin /nowhere 0');
      assertGuard('ws-gc dead-reg, declined');
      // `_lc_refuse_return` is the third terminal form, and the whole reason it
      // exists: `_lc_refuse` dies, and a sweep may not die on its first
      // declining row. Flattening this arm's `if`/`else` so both facts fire
      // under one `$lctx` is this guard's other named mutant.
      expect(eventsOf(h.home, 'destroy').map((e) => e['outcome'])).toEqual(['intent', 'refused']);
    } finally { release(); }
  }, 60_000);

  it('GREEN CONTROL: ws-restore\'s empty-tx done/fail pair passes — and a guard admitting "" reds it', () => {
    // A LANDED UNDO PLUS A FAILED SPAWN: `_lc_done restore` fires when the
    // archive stamps come off, and `_lc_fail restore` when the session does not
    // come back — both with a LITERAL empty tx, so they are two terminal facts
    // about one id that the guard must NOT red on.
    wsRow('demo-still-river');
    // The ARCHIVED state is planted rather than produced by `cmd_ws_archive`:
    // that verb reads a wrapper status file this row has no session for and
    // dies `status-unknown` (measured), and what this control needs is the
    // RESTORE's two emits, not the archive's ladder.
    h.sh('_reg_set demo-still-river archived 1787000000; _reg_set demo-still-river archivedreason merged:#42');
    const RESTORE_STUB = '_ws_supervise() { :; }; _reg_claim() { :; };'
      + ' _spawn_start() { SPAWN_FROMSWAP=0; return 3; }; _spawn_settle() { :; };'
      + ' tmux() { return 1; }; _session_verdict() { echo gone; };';
    h.sh(`${RESTORE_STUB} ( cmd_ws_restore --session demo-still-river ) 2>/dev/null || true`);
    const restores = eventsOf(h.home, 'restore');
    expect(restores.map((e) => e['outcome']), 'the undo landed and the spawn did not').toEqual(['done', 'failed']);
    expect(restores.map((e) => String(e['tx'] ?? '')), 'both carry a LITERAL empty tx').toEqual(['', '']);
    // NO `assertGuard` HERE, and the difference is the control itself: this
    // fixture mints NOTHING, so the guard's own non-vacuity clause (which every
    // other leg asserts) would red on it for the right reason. What this leg
    // says instead is that the two facts are invisible to the guard BY THE
    // RULE — there is no group for them to break.
    expect([...txGroups(h.home).keys()], 'the empty-tx pair forms no minted group').toEqual([]);
    expect(breaches(h.home), 'and the guard passes').toEqual([]);
    // WIDENING THE GUARD REDS THIS SAME CONTROL, which is what makes the
    // empty-tx rule a mechanism rather than a convenient omission.
    const widened = breaches(h.home, true);
    expect(widened.some((b) => b.startsWith('restore demo-still-river ')),
      'a ""-admitting guard reds on the correct shipped tree').toBe(true);
  }, 60_000);
});

// ── D-2605: the lock MECHANISM being absent is its own condition (§4, §5) ──
// `flock(1)` is util-linux. A box without it has no serialisation at all — not
// weaker serialisation — so the three regimes answer differently and the matrix
// below is the whole ruling in executable form:
//   (a) `ws-add` REFUSES: row creation is what MINTS the generation, and a row
//       minted unserialised is the race the lock exists to exclude.
//   (b) `ws-reap` REFUSES (pinned in `ccd-ws-reap.test.ts`, which also asserts
//       the purge fact is absent).
//   (c) `ws-rm`, `forget` and `ws-gc --prune` COMPLETE on a generation-ABSENT
//       row: absence proves no hook on that row ever received one, so no hook
//       arm ever ran the lifecycle and there is nothing to race.
//   (d1) `ws-rm` and `forget` REFUSE on a generation-PRESENT row, each with
//       exactly one named `_lc_fail` and no `_lc_done purge`.
//   (d2) `ws-gc --prune` on the SAME row DECLINES — asserted POSITIVELY and
//       the false success NEGATIVELY, or the shipped status-blind arm passes.
//   (f) `_ws_slug_free` answers consistently with whichever of those happened.
//
// ABSENCE IS SHIMMED AT THE QUESTION, NEVER BY EMPTYING PATH: ccd asks it with
// `command -v flock`, and every stub in these suites spells its own passthrough
// `command git`/`command find`, so an emptied PATH would break them for a
// different reason. The idiom is `ccd-ws-reap.test.ts`'s own.
describe('the lock mechanism is absent (spec §4, §5)', () => {
  const NOFLOCK = 'command() { [[ "${1-}" == -v && "${2-}" == flock ]] && return 1;'
    + ' builtin command "$@"; };';
  /** A dead-registry row shaped exactly as `ws-gc`'s scan finds one. */
  const deadRow = (id = 'demo-quiet-basin'): string => {
    h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199
      _reg_set ${id} project demo; _reg_set ${id} workspace quiet-basin
      _reg_set ${id} branch ws/quiet-basin; _reg_set ${id} workdir /gone`);
    return id;
  };
  const plantGeneration = (id: string): void =>
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.generation`),
      '0189abcd-1234-5678-9abc-0123456789ab');
  const purges = (): number => eventsOf(h.home, 'purge').length;

  it('CONTROL: the shim makes the QUESTION fail while a real `flock -w 1` still answers 0', () => {
    // THE WHOLE MECHANISM-ABSENCE RULING RESTS ON WHICH PROBE ANSWERED, and
    // this is what proves the two probes are different here. `command -v`
    // absence and a contended `flock -w` both spell their failure `1`, so a
    // guard that established absence by ATTEMPTING AN ACQUIRE would conclude
    // "mechanism present" inside this very fixture — and decide the opposite
    // way on a generation-present row. (A genuinely missing binary invoked as
    // a command answers 127, a third value neither condition names.)
    const id = deadRow();
    const out = h.sh(`${NOFLOCK} `
      + `command -v flock >/dev/null 2>&1; echo "askrc=$?"; `
      + `: > "$REG/.${id}.probe.lock"; `
      + `exec 9<>"$REG/.${id}.probe.lock"; flock -w 1 9; echo "acqrc=$?"`);
    expect(out).toContain('askrc=1');
    expect(out, 'the real flock is still on PATH and uncontended').toContain('acqrc=0');
  });

  it('(a) ws-add REFUSES, and creates no registry field', () => {
    h.makeRepo('demo');
    let code = 0; let stderr = '';
    try { h.sh(`${NOFLOCK} ( CCD_WS_SLUG=quiet-basin cmd_ws_add demo )`); }
    catch (e) { const x = e as { status?: number; stderr?: Buffer }; code = x.status ?? 1; stderr = String(x.stderr ?? ''); }
    expect(code, 'a refusal is not a success').not.toBe(0);
    expect(stderr).toContain('refusing to create a workspace unserialised');
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((n) => n.startsWith('demo-')),
      'and nothing was written for the row it refused to create').toEqual([]);
  });


  /** (a2) ROW CREATION CONTINUES. §3.4's platform-outcome paragraph rules row
   *  creation and `_spawn_start` NOT gated on the mechanism — they skip
   *  generation initialization and carry on — because "gating pre-existing
   *  registry work on a mechanism it never required would be this design
   *  importing a new failure mode into unrelated code". `cmd_start` carries no
   *  `command -v flock` probe of its own (the five shipped probes guard
   *  `_lc_rotate`, `cmd_ws_add`, `cmd_ws_restore`, `cmd_ws_reap` and
   *  `_tmux_new_session`), so its bare `|| die` caught rc 2 as well as rc 1 and
   *  `ccd start` became impossible on the second declared userland — with a
   *  message naming a 5 s timeout and prescribing a retry that can never work
   *  for a permanently absent binary. `ws-add` is the deliberate opposite, and
   *  leg (a) above is why: it MINTS the generation, and a row minted
   *  unserialised is the race the lock exists to exclude. */
  it('(a2) cmd_start COMPLETES and writes its row WITHOUT a generation — and mints one when flock is there', () => {
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const START = `${WS_ADD} _alive() { return 1; }; _have_systemctl() { return 1; };`;
    const gen = (id: string): string => path.join(h.home, '.cc-sessions', `${id}.generation`);

    const r = spawnSync('bash', ['-c', `source "${CCD}"; ${NOFLOCK} ${START} cmd_start claude demo`], {
      encoding: 'utf8', cwd: h.home, timeout: 30_000,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
    });
    expect(r.status, `a flock-less box must still start a session\n${r.stderr}`).toBe(0);
    expect(r.stderr, 'and it must not name the lock at all').not.toContain('compactions.lock');
    // THE ROW IS WHOLE. `die` fired BEFORE the first `_reg_set`, so the old
    // behaviour left no `.uuid` either — an empty registry, not a partial row.
    expect(h.reg('claude-demo', 'uuid'), 'the row was written').not.toBeNull();
    expect(h.reg('claude-demo', 'wrapper')).toBe('claude');
    expect(fs.existsSync(gen('claude-demo')),
      'and carries NO generation: nothing minted it, and nothing pretends one exists').toBe(false);

    // THE CONTROL, in its own harness: with the mechanism present the same call
    // DOES mint one — so the absence above is the shim and not the fixture.
    h.cleanup();
    h = makeCcdHarness('ccrc-lc-purge-');
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const r2 = spawnSync('bash', ['-c', `source "${CCD}"; ${START} cmd_start claude demo`], {
      encoding: 'utf8', cwd: h.home, timeout: 30_000,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
    });
    expect(r2.status, `${r2.stderr}`).toBe(0);
    expect(fs.existsSync(gen('claude-demo')), 'flock present ⇒ the generation is minted').toBe(true);
  }, 90_000);
  /** EACH VERB GETS THE ROW SHAPE IT WILL ACT ON, which is not one shape:
   *  `cmd_forget` refuses a row carrying `.workspace` outright, and `cmd_ws_rm`
   *  needs a real worktree. A single fixture for all three would pass leg (c)
   *  for the wrong reason — the verb refusing early, before `_reg_purge` is
   *  ever reached — which is the failure mode §5's own ws-add leg records. */
  const LEGS = [
    { verb: 'ws-rm', act: 'destroy', id: 'demo-still-river', slug: ['demo', 'still-river'] as const,
      plant: (): void => { wsRow(); },
      run: (): void => { h.sh(`${NOFLOCK} ${RM_STUB} ( cmd_ws_rm demo-still-river ) 2>/dev/null || true`); } },
    { verb: 'forget', act: 'forget', id: 'claude-corp-demo', slug: null,
      plant: (): void => { wrapperRow(); },
      run: (): void => { h.sh(`${NOFLOCK} ${FORGET_STUB} ( cmd_forget claude-corp-demo ) 2>/dev/null || true`); } },
    { verb: 'ws-gc --prune', act: 'destroy', id: 'demo-quiet-basin', slug: ['demo', 'quiet-basin'] as const,
      plant: (): void => { deadRow(); },
      run: (): void => { h.sh(`${NOFLOCK} _ws_gc_prune_row dead-reg demo quiet-basin /gone 0`); } },
  ] as const;

  it('(c) ws-rm, forget and ws-gc --prune COMPLETE on a generation-ABSENT row', () => {
    // Each in its own harness: three independent verbs answering the same
    // question, and sharing one registry would let the first one's purge decide
    // the next one's answer.
    for (const leg of LEGS) {
      h = makeCcdHarness('ccrc-lc-purge-');
      leg.plant();
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${leg.id}.generation`)),
        `${leg.verb}: the row carries NO generation — that is the fixture`).toBe(false);
      leg.run();
      expect(purges(), `${leg.verb}: exactly one purge-done, so the purge really ran`).toBe(1);
      expect(h.reg(leg.id, 'uuid'), `${leg.verb}: and the row is gone`).toBeNull();
      // (f) the slug answers consistently with that.
      if (leg.slug) {
        expect(h.sh(`_ws_slug_free ${leg.slug[0]} ${leg.slug[1]}; echo "free=$?"`)).toContain('free=0');
      }
    }
  }, 120_000);

  it('(d1) ws-rm and forget REFUSE on a generation-PRESENT row, with ONE named _lc_fail and no purge-done', () => {
    for (const leg of LEGS.filter((l) => l.verb !== 'ws-gc --prune')) {
      h = makeCcdHarness('ccrc-lc-purge-');
      leg.plant();
      plantGeneration(leg.id);
      leg.run();
      const fails = eventsOf(h.home, leg.act).filter((e) => e['outcome'] === 'failed');
      expect(fails, `${leg.verb}: exactly one failure`).toHaveLength(1);
      expect(fails[0]!['refusal']).toBe('purge-refused');
      expect(purges(), `${leg.verb}: and NO purge-done`).toBe(0);
      expect(h.reg(leg.id, 'uuid'), `${leg.verb}: the row still stands`).not.toBeNull();
      // (f) and the slug says so.
      if (leg.slug) {
        expect(h.sh(`_ws_slug_free ${leg.slug[0]} ${leg.slug[1]}; echo "free=$?"`)).toContain('free=1');
      }
    }
  }, 120_000);

  it('(d2) ws-gc --prune on the SAME row DECLINES — positively, and the false success negatively', () => {
    // THE SHIPPED STATUS-BLIND ARM PASSES A BARE "emits neither `_lc_fail` nor
    // `_lc_done purge`", which is exactly the false-success implementation this
    // leg exists to forbid — so the decline is asserted POSITIVELY (a
    // `declined` row, one `refused` fact for the minted tx) and the success
    // NEGATIVELY (no `_lc_done destroy`, no `reclaimed`, the row still there).
    const id = deadRow();
    plantGeneration(id);
    const out = h.sh(`${NOFLOCK} _ws_gc_prune_row dead-reg demo quiet-basin /gone 0; `
      + 'echo "DECLINED=$GC_DECLINED RECLAIMED=$GC_RECLAIMED"');
    expect(out).toContain('declined');
    expect(out).toContain(id);
    expect(out, 'a decline, never a reclaim').toContain('DECLINED=1 RECLAIMED=0');

    const destroys = eventsOf(h.home, 'destroy');
    const intent = destroys.find((e) => e['outcome'] === 'intent');
    expect(intent, 'the arm minted its intent before it learned').toBeTruthy();
    const tx = String(intent!['tx']);
    expect(tx).not.toBe('');
    const terminal = destroys.filter((e) => e['tx'] === tx && e['outcome'] !== 'intent');
    expect(terminal.map((e) => e['outcome']), 'exactly one, and it is the refusal').toEqual(['refused']);
    expect(purges(), 'no purge-done').toBe(0);
    expect(h.reg(id, 'uuid'), 'the row stands').not.toBeNull();
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.generation`)),
      'and so does its authorization').toBe(true);
    expect(h.sh(`_ws_slug_free demo quiet-basin; echo "free=$?"`)).toContain('free=1');
  }, 30_000);
});
