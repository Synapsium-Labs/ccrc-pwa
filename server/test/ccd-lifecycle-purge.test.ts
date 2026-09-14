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
import { CCD, makeCcdHarness, ghContainedEnv, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, measOf, lcDir } from './lifecycleHelpers.js';

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
    const stmts = head.split('\n')
      .slice(1)                                   // the function's own `_reg_purge() {` line
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(stmts.length, `only the acquisition may stand here, found:\n${stmts.join('\n')}`).toBeGreaterThan(0);
    for (const st of stmts) {
      expect(st, `unexpected statement before the emit: ${st}`).toMatch(
        /^(local _pg_fd|_compact_lock_acquire|if \(\( _pg_rc == 2 \)\)|if \[ -e "\$REG\/\$1\.generation"|elif \(\( _pg_rc != 0 \)\)|else$|_pg_fd="\$COMPACT_LOCK_FD"|fi$|return [12];?$)/);
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

// ── D-2605: the four callers, each answering for what it actually did ─────
describe('the purge callers read its status (spec §3.4, "Locked purge and honest callers")', () => {
  const lockOf = (id: string): string => path.join(h.home, '.cc-sessions', `.${id}.compactions.lock`);

  /** Hold the row's mutex from a REAL process, resolving only once the child
   *  reports it HAS it — so the caller under test races a genuinely held lock
   *  rather than a hoped-for one. */
  const hold = async (id: string, secs: number): Promise<() => void> => {
    fs.mkdirSync(path.dirname(lockOf(id)), { recursive: true });
    fs.closeSync(fs.openSync(lockOf(id), 'a'));
    const child = spawn('bash', ['-c',
      `exec 9<>"$1" || exit 1; flock 9 || exit 1; echo held; exec sleep ${secs}`, '_', lockOf(id)]);
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('holder never took the lock')), 10_000);
      child.stdout.on('data', (d: Buffer) => { if (d.toString().includes('held')) { clearTimeout(t); res(); } });
      child.on('error', (e) => { clearTimeout(t); rej(e); });
    });
    return () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
  };

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
        expect(fn, `${verb} reads the purge's status`).toMatch(/if ! _reg_purge/);
        expect(fn, `${verb} reports it as a FAILURE, not a decline`).toContain(`_lc_fail ${act}`);
        expect(fn).toContain('purge-refused');
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
      expect(miss, 'and a miss dies retryably, naming the lock').toMatch(/\|\| die "could not take .*compactions\.lock/);
      expect(miss).toContain('nothing was');
      expect(miss).toContain('retry');
    }
  });

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
