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

  it('reclaims the TWO TRANSITION LEGACY GRAMMARS, which begin with a pid and match no target family', () => {
    // §3.4's transition allowance names `<pid>.<id>.compactset.tmp` and
    // `<pid>.compactcard-claim.tmp`. `_hook_family_sweepable` carried them and
    // `_ws_private_family` did not, and every arm there requires the FAMILY
    // word first — so a row upgraded across the deploy that carried legacy
    // residue and was then purged kept it FOR EVER: the purge's private loop
    // skipped it, and no PreCompact runs for a destroyed row.
    const id = seed('demo-quiet-basin');
    const REGD = path.join(h.home, '.cc-sessions');
    const legacy = [`.${id}.999.${id}.compactset.tmp`, `.${id}.999.compactcard-claim.tmp`];
    for (const n of legacy) fs.writeFileSync(path.join(REGD, n), '');
    // A NEIGHBOUR's legacy residue, so the reclamation is not a substring
    // sweep: the same two grammars under a DOTTED nested id share this id's
    // `.<id>.` prefix exactly and must survive.
    const neighbour = `.${id}.x-y.999.compactcard-claim.tmp`;
    fs.writeFileSync(path.join(REGD, neighbour), '');
    expect(h.sh(`_reg_purge ${id}; echo "rc=$?"`), 'the purge took everything it owns').toContain('rc=0');
    for (const n of legacy) expect(fs.existsSync(path.join(REGD, n)), `legacy reclaimed: ${n}`).toBe(false);
    expect(fs.existsSync(path.join(REGD, neighbour)), 'a nested id\'s legacy residue is not ours').toBe(true);
    // Only the permanent lock (and the stranger) is left standing.
    expect(fs.readdirSync(REGD).filter((n) => n.startsWith(`.${id}.`) && n !== neighbour))
      .toEqual([`.${id}.compactions.lock`]);
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

  // ── The arity source pin the plan named and nobody built (r3 B-M1) ─────
  // Plan Task 9's modify scope says verbatim: "every `_lc_refuse` call site
  // passes exactly four positionals, every `_lc_refuse_return` call site
  // exactly five, and the two name sets are disjoint". No test scanned either.
  // The gap is PROSPECTIVE rather than live — today's `_lc_refuse_return` call
  // sites are all driven by behaviour fixtures — and that is exactly what a
  // source pin is for: a second `_lc_refuse_return` added later with four
  // positionals shifts `detail` into `token` and journals a refusal with a
  // wrong token, at a site no fixture drives.
  //
  // THE TWO NAME SETS ARE DISJOINT is a real hazard and not a formality:
  // `_lc_refuse` is a PREFIX of `_lc_refuse_return`, so a scan that matched the
  // shorter name first would harvest every longer call as a short one and then
  // "prove" the arity it had just mis-parsed.
  const lcCalls = (name: string): Array<{ line: number; args: string[] }> => {
    const src = readFileSync(CCD, 'utf8').split('\n');
    const out: Array<{ line: number; args: string[] }> = [];
    for (let i = 0; i < src.length; i++) {
      const raw = src[i]!;
      if (raw.trimStart().startsWith('#')) continue;
      // The call must be a WORD: preceded by start/whitespace/`(`/`;`/`|`/`&`,
      // and followed by whitespace — which is what keeps `_lc_refuse` from
      // matching the head of `_lc_refuse_return`.
      const re = new RegExp(`(?:^|[\\s(;|&])${name}\\s`);
      const m = re.exec(raw);
      if (!m) continue;
      // JOIN CONTINUATIONS: these statements wrap, and half the arguments live
      // on the lines after the one carrying the name.
      let stmt = raw.slice(m.index + m[0].length - 1);
      let j = i;
      while (src[j]!.trimEnd().endsWith('\\')) {
        stmt = `${stmt.trimEnd().replace(/\\$/, '')} ${src[j + 1]!.trim()}`;
        j++;
      }
      out.push({ line: i + 1, args: splitArgs(stmt) });
    }
    return out;
  };
  /** Whitespace-separated arguments, respecting double quotes and `$( )`. */
  const splitArgs = (text: string): string[] => {
    const args: string[] = [];
    let cur = ''; let q = false; let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (c === '\\' && i + 1 < text.length) { cur += c + text[i + 1]!; i++; continue; }
      if (c === '"') { q = !q; cur += c; continue; }
      if (!q && c === '(') depth++;
      if (!q && c === ')') depth--;
      if (!q && depth === 0 && (c === ';' || c === '|' || c === '&')) break;
      if (!q && depth === 0 && /\s/.test(c)) { if (cur !== '') { args.push(cur); cur = ''; } continue; }
      cur += c;
    }
    if (cur !== '') args.push(cur);
    return args;
  };
  /** A `k v` KEY: a bare word, or a whole array expansion of them. */
  const isKey = (a: string): boolean =>
    /^[A-Za-z][A-Za-z0-9._-]*$/.test(a) || /^"\$\{[A-Za-z_][A-Za-z0-9_]*\[@\]\}"$/.test(a);
  /** A DETAIL: always a quoted string, never a bare key. */
  const isDetail = (a: string): boolean => a.startsWith('"') && !isKey(a);

  it('ARITY, AT THE SOURCE: every `_lc_refuse` passes four positionals and every `_lc_refuse_return` five', () => {
    const shorts = lcCalls('_lc_refuse');
    const longs = lcCalls('_lc_refuse_return');
    // NON-VACUITY, three clauses. An empty harvest satisfies every `for` below
    // silently, and a harvest that had swallowed the long calls into the short
    // set would too.
    expect(shorts.length, 'the short form is called').toBeGreaterThan(10);
    expect(longs.length, 'and so is the long one').toBeGreaterThan(0);
    const shortLines = new Set(shorts.map((c) => c.line));
    expect(longs.filter((c) => shortLines.has(c.line)),
      'the two name sets are DISJOINT — a prefix match would put every long call in both').toEqual([]);
    // AND THE SET REALLY CONTAINS THE CALLER THIS SUITE DRIVES: `_ws_gc_prune_row`'s
    // dead-reg arm, which is the only function in the tree that uses the long form.
    expect(longs.some((c) => c.args.includes('purge-refused')),
      'the dead-reg arm`s contention refusal is in the long set').toBe(true);

    for (const c of shorts) {
      expect(c.args.length, `ccd:${c.line}: _lc_refuse takes at least its four positionals`).toBeGreaterThanOrEqual(4);
      expect(isDetail(c.args[3]!), `ccd:${c.line}: the 4th positional must be the quoted DETAIL, got ${c.args[3]}`).toBe(true);
      if (c.args.length > 4) {
        expect(isKey(c.args[4]!), `ccd:${c.line}: the 5th argument must begin the k/v pairs, got ${c.args[4]}`).toBe(true);
      }
    }
    for (const c of longs) {
      expect(c.args.length, `ccd:${c.line}: _lc_refuse_return takes at least its five positionals`).toBeGreaterThanOrEqual(5);
      expect(isDetail(c.args[4]!), `ccd:${c.line}: the 5th positional must be the quoted DETAIL, got ${c.args[4]}`).toBe(true);
      if (c.args.length > 5) {
        expect(isKey(c.args[5]!), `ccd:${c.line}: the 6th argument must begin the k/v pairs, got ${c.args[5]}`).toBe(true);
      }
    }
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

// ── D-2605 §4/§5: A LATER CANONICAL DISAPPEARANCE REFUSES, AND MINTS NOTHING
// §4's row: "stable canonical lock absent | initializer may publish it only
// from the private init source using `link`; a later canonical
// disappearance/replacement refuses, never recreates it." §5's row:
// "canonical-disappearance/old-inode holder race refuses promptly, recreates no
// canonical, and never admits split critical sections." Both were UNBUILT: the
// acquire minted on absence unconditionally, so a stranger's unlink of the
// permanent lock let a second acquirer publish a SECOND inode at the same
// pathname while a live holder still owned the first — two processes each told
// by `flock` that it holds "the" lock, which is the exact hazard
// `ccd/session-hook.sh`'s own header says the link-based design removes.
// MEASURED on the tree before this guard, with two real processes: holder
// acquires canonical inode 167576, canonical is unlinked, the second acquirer
// answers `RC=0` and canonical is back at inode 167577.
describe('the stable lock refuses a LATER canonical disappearance (spec §4, §5)', () => {
  const id = 'demo-quiet-basin';
  const REG = (): string => path.join(h.home, '.cc-sessions');
  const lockOfId = (): string => lockOf(id);

  /** A REAL HOLDER, through the SHIPPED acquire: the child sources `ccd` and
   *  calls `_compact_lock_acquire`, so what it leaves behind is the acquire's
   *  own artifact and not a fixture's imitation of it — no alias on disk, and
   *  a descriptor on the unlinked alias inode. Resolves only once the child
   *  reports it HAS the lock. */
  const holdThroughAcquire = async (): Promise<() => void> => {
    // A LIVE ROW. The expensive half of the guard is gated on
    // `<id>.generation`, for the reason `_reg_purge`'s own fail-open is: with
    // it absent no hook on this row ever held this lock, so an absent canonical
    // is a first-ever mint and there is nothing to walk /proc for. A holder
    // that matters holds the lock of a row that exists, so the fixture builds
    // one — through ccd's own minting path, not by writing bytes.
    const mint = h.sh(`_compact_lock_acquire ${id} 5 || { echo LOCKFAIL; exit 0; }
      fd="$COMPACT_LOCK_FD"
      if _reg_generation_init ${id}; then echo OK; else echo REFUSED; fi
      _compact_lock_release "$fd"`);
    expect(mint, 'the row was minted the way creation mints it').toBe('OK');
    const child = spawn('bash', ['-c',
      `source "${CCD}"; _compact_lock_acquire ${id} 5 || { echo "ACQRC=$?"; exit 1; }; echo held; exec sleep 20`],
      { cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    let out = '';
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`the holder never acquired: ${out}`)), 10_000);
      child.stdout.on('data', (d: Buffer) => { out += d.toString(); if (out.includes('held')) { clearTimeout(t); res(); } });
      child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('error', (e) => { clearTimeout(t); rej(e); });
    });
    return () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
  };

  it('a live holder leaves NO name in $REG — which is why an alias scan alone cannot see one', async () => {
    // THE MEASUREMENT THAT SHAPES THE GUARD, asserted rather than remembered.
    // The acquire unlinks its alias the instant the FD is held, by design and
    // by its own comment, so "is an exact-family alias present" answers NO for
    // a holder that is past its acquire. A guard built on that question alone
    // would be green, correct-looking, and blind to §4's own scenario.
    const release = await holdThroughAcquire();
    try {
      expect(fs.readdirSync(REG()).filter((n) => n.includes('lock-open')),
        'the holder keeps a descriptor, not a name').toEqual([]);
      expect(fs.existsSync(lockOfId()), 'canonical itself is of course still there').toBe(true);
    } finally { release(); }
  }, 30_000);

  it('REFUSES rather than recreating canonical while a real holder owns the old inode', async () => {
    const release = await holdThroughAcquire();
    try {
      const ino = fs.statSync(lockOfId()).ino;
      // THE OUT-OF-CONTRACT ACT. Nothing in this tree unlinks the permanent
      // lock — `_reg_purge` skips it BY NAME and `_ws_private_family` excludes
      // it — so this is a stranger, which is exactly the condition §4 rules on.
      fs.unlinkSync(lockOfId());
      const out = h.sh(`_compact_lock_acquire ${id} 1; echo "RC=$? WHY=$COMPACT_LOCK_WHY"`);
      expect(out, 'a later disappearance is refused').toContain('RC=1');
      expect(out, 'and the refusal says WHICH refusal it is').toContain('WHY=canonical-vanished');
      // RECREATES NO CANONICAL — the half §4 states twice and §5 once. The
      // refusal happens BEFORE the mint, so there is nothing to clean up
      // either: no init source, no alias.
      expect(fs.existsSync(lockOfId()), 'canonical was NOT recreated').toBe(false);
      expect(fs.readdirSync(REG()).filter((n) => n.includes('lock-init')),
        'and the refusal left no private source').toEqual([]);
      expect(fs.readdirSync(REG()).filter((n) => n.includes('lock-open')),
        '…nor an open alias').toEqual([]);
      // THE INODE NEVER CHANGED UNDER THE LIVE HOLDER. There is no second
      // inode at this pathname because there is no file at this pathname —
      // which is the strongest form of "the holder's mutex was not displaced".
      expect(ino, 'the fixture measured a real inode to begin with').toBeGreaterThan(0);
    } finally { release(); }
  }, 30_000);

  it('CONTROL: with NO holder, an absent canonical is a first-ever mint and the acquire proceeds', () => {
    // Without this the refusal above could be an acquire that refuses on every
    // absent canonical, which would wedge every row ccd ever creates.
    expect(fs.existsSync(lockOfId()), 'no canonical yet').toBe(false);
    const out = h.sh(`_compact_lock_acquire ${id} 1; echo "RC=$? WHY=$COMPACT_LOCK_WHY"`);
    expect(out, 'the first-ever acquisition mints and acquires').toContain('RC=0');
    expect(out, 'and nothing is blamed').toContain('WHY=');
    expect(out).not.toContain('canonical-vanished');
    expect(fs.existsSync(lockOfId()), 'canonical was published').toBe(true);
  });

  it('an acquisition IN FLIGHT is refused too — its alias is on disk between the link and the unlink', () => {
    // The second arm, and the one a fixture can construct directly: between
    // its `link "$lock" "$al"` and the `rm -f "$al"` that follows its `exec`,
    // an acquirer HAS an exact-family name on disk. Planting that name beside
    // an absent canonical is that process's on-disk state, byte for byte.
    fs.mkdirSync(REG(), { recursive: true });
    fs.writeFileSync(path.join(REG(), `.${id}.compactions.lock-open.4242.1.2`), '');
    const out = h.sh(`_compact_lock_acquire ${id} 1; echo "RC=$? WHY=$COMPACT_LOCK_WHY"`);
    expect(out).toContain('RC=1');
    expect(out).toContain('WHY=canonical-vanished');
    expect(fs.existsSync(lockOfId()), 'canonical was NOT minted over an in-flight acquisition').toBe(false);
  });

  it('the family is EXACT — a NESTED id\'s alias does not refuse this id', () => {
    // Project DIRECTORY names may hold dots, so `demo-quiet-basin.x` is a legal
    // sibling id whose alias shares this id's prefix. A substring matcher would
    // read it as this row's and wedge a row that has no holder at all.
    fs.mkdirSync(REG(), { recursive: true });
    fs.writeFileSync(path.join(REG(), `.${id}.x-y.compactions.lock-open.4242.1.2`), '');
    const out = h.sh(`_compact_lock_acquire ${id} 1; echo "RC=$? WHY=$COMPACT_LOCK_WHY"`);
    expect(out, 'a NESTED id answers only for itself').toContain('RC=0');
    expect(fs.existsSync(lockOfId())).toBe(true);
  });
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
      // AND ITS SENTENCE, which is what makes this leg a CONTROL for the gc arm
      // of (d1c) below (r5 R4-M2). (d1b) cannot be that control: its loop
      // filters `ws-gc --prune` OUT, so until now NOTHING in the tree pinned
      // which status-1 sentence the gc caller emits — it asserted the token and
      // the surviving row and never the detail. MEASURED in a throwaway copy,
      // making the gc caller's canonical-vanished override in `ccd/ccd` fire
      // unconditionally left this whole file GREEN 50/50, while every ordinary
      // gc decline journaled "has been unlinked while a live holder still owns
      // its inode … restore … by hand" for a lock that is merely held: false in
      // both clauses. `hold` is `holdCompactLock`, which opens canonical
      // directly and holds it, so this is the ORDINARY contention condition and
      // COMPACT_LOCK_WHY is empty here.
      expect(String(terminal[0]!['detail']), 'the CONTENTION sentence: the lock was there and busy')
        .toContain('was unavailable');
      expect(String(terminal[0]!['detail']), 'and never the canonical-vanished remedy, which is false on a lock that exists')
        .not.toContain('canonical-vanished');

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

  // ── §5: "both primary/retry child envs carry EXACT generation" ─────────
  // The only pin this row had was a source COUNT of the interpolation
  // (`expect(matchAll(/exec env \$\{genenv\}COLORTERM=truecolor/g)).toHaveLength(2)`),
  // which is a statement about the tmux command's TEXT and says nothing about
  // what computes `genenv`. MEASURED GREEN under two mutants: replacing the
  // retry's whole acquire-and-revalidate block with a bare `genenv=""` (so a
  // session rescued by the retry has an inert compaction lifecycle for its
  // entire life), and dropping the retry's `_reg_generation_read` + equality
  // (so it re-exports the STALE primary value — the exact "authorize this pane
  // against a row it does not belong to" hazard the shipped comment names).
  // `CCRC_SESSION_GENERATION` appeared in exactly one other line of this file,
  // a fail-open warning string, so nothing else could catch either.
  //
  // WHAT THE FIXTURE HAS TO SEE is the resolved command, per invocation, so
  // `_tmux_new_session` — which already stands in for the daemon — records `$*`.
  const CAPTURE = `
      _tmux_new_session() {
        printf '%s\n' "$*" >> "$HOME/cmds"
        case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac
      };
      tmux() { case "\${1:-}" in has-session) [[ -e "$HOME/pane-up" ]] ;; *) : ;; esac; };`;

  /** A row with a MINTED generation, through ccd's own path — the retry's
   *  revalidation compares against what row creation wrote, so a fixture that
   *  typed the bytes itself would be testing its own literal. */
  const spawnRow = (id: string): string => {
    h.sh(`_reg_set ${id} wrapper claude
      _reg_set ${id} workdir "$HOME"
      _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
    const r = h.sh(`_compact_lock_acquire ${id} 5 || { echo LOCKFAIL; exit 0; }
      fd="$COMPACT_LOCK_FD"
      if _reg_generation_init ${id}; then echo OK; else echo REFUSED; fi
      _compact_lock_release "$fd"`);
    expect(r, 'the row was minted the way creation mints it').toBe('OK');
    return fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.generation`), 'utf8');
  };

  const capturedCommands = (): string[] =>
    fs.readFileSync(path.join(h.home, 'cmds'), 'utf8').trim().split('\n');

  it('BOTH spawn commands carry the generation BY VALUE — not merely the interpolation', () => {
    const id = 'demo-still-river';
    const gen = spawnRow(id);
    expect(gen, 'the fixture measured a real generation').toMatch(/^[0-9a-f-]{36}$/);
    h.sh(`${CAPTURE} sleep() { :; }; _spawn_start ${id} resume 2>/dev/null`);
    const cmds = capturedCommands();
    // BOTH forks — the `--resume` line and the `--session-id` retry that
    // replaces it. The retry is the copy that gets forgotten.
    expect(cmds, 'the primary spawned and the retry replaced it').toHaveLength(2);
    expect(cmds[0], 'the primary is the --resume line').toContain('--resume');
    expect(cmds[1], 'the retry is the --session-id line').toContain('--session-id');
    for (const [i, c] of cmds.entries()) {
      expect(c, `command ${i + 1} carries the row's OWN generation bytes`)
        .toContain(`CCRC_SESSION_GENERATION='${gen}' `);
    }
  }, 30_000);

  it('a row RE-MINTED between the two spawns leaves the retry with NO generation at all', () => {
    // The retry takes its own acquisition and REQUIRES the same value this
    // invocation already saw, because a row purged and re-created in the gap
    // has a different generation and exporting that one would authorize this
    // pane against a row it does not belong to. The gap is exactly the `sleep`,
    // so the stub that stands in for it is where the row is re-minted — a
    // fixture is the only thing that can produce this state deterministically.
    const id = 'demo-still-river';
    const gen = spawnRow(id);
    const OTHER = 'ffffffff-1111-4222-8333-444444444444';
    expect(OTHER, 'the re-mint must differ, or the leg proves nothing').not.toBe(gen);
    h.sh(`${CAPTURE}
      sleep() { printf '%s' '${OTHER}' > "$REG/${id}.generation"; };
      _spawn_start ${id} resume 2>/dev/null`);
    const cmds = capturedCommands();
    expect(cmds).toHaveLength(2);
    expect(cmds[0], 'the primary carried what it read before the gap')
      .toContain(`CCRC_SESSION_GENERATION='${gen}' `);
    // NOT the stale value, and NOT the new one either: the retry may only
    // export a generation it re-read AND matched, so a row it no longer
    // recognises leaves it with none.
    expect(cmds[1], 'the retry does not carry the stale value').not.toContain(gen);
    expect(cmds[1], '…nor the row\'s new one, which it was never handed').not.toContain(OTHER);
    expect(cmds[1], 'the retry carries no generation at all').not.toContain('CCRC_SESSION_GENERATION');
    expect(cmds[1], 'and it is still the retry line').toContain('--session-id');
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

  // ── §5's FIRST NAMED MUTANT, and the arm it names had no fixture at all ──
  // §5's row `emit two terminal facts for one CALLER act` names two mutants and
  // says "the guard reds" for both. The SECOND — dropping the `die` after
  // `cmd_ws_rm`'s purge-refused `_lc_fail` — reds two legs above. The FIRST —
  // flattening `_ws_gc_prune_row`'s ORPHAN `if`/`else` so a `done` and a
  // `failed` both fire under one `$lctx` — stayed GREEN, measured, across
  // ccd-lifecycle-purge, ccd-ws-gc, ccd-ws-reap and ccd-workspaces: `assertGuard`
  // was called from five legs and not one of them drove the orphan arm.
  //
  // A REAL ORPHAN, not a stub: a workspace built by `cmd_ws_add` whose `.uuid`
  // is then removed, which is the state `_ws_gc_scan` classifies `orphan`. The
  // arm's own rungs (dirty, detached HEAD, unmerged branch, nested checkouts)
  // all have to pass before it mints a transaction at all, so the fixture has
  // to be a genuinely reclaimable tree — a stub would leave the guard as
  // unexercised as it was.
  const orphanRow = (): { main: string; wt: string } => {
    const main = h.makeRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'));
    return { main, wt };
  };

  it('the ORPHAN arm closes its transaction once — reclaimed, and when git refuses', () => {
    const { wt } = orphanRow();
    h.sh(`_ws_gc_prune_row orphan demo quiet-mesa "${wt}" 0`);
    assertGuard('ws-gc orphan, reclaimed');
    expect(eventsOf(h.home, 'destroy').map((e) => e['outcome']),
      'the successful removal closes it with exactly one done').toEqual(['intent', 'done']);
    expect(fs.existsSync(wt), 'and the worktree really went').toBe(false);

    // THE OTHER SIDE OF THE SAME `if`. `git worktree lock` makes
    // `git worktree remove` refuse for real — no `--force` on this arm — so
    // the `else` branch runs against a genuine git refusal rather than a stub.
    h = makeCcdHarness('ccrc-lc-purge-');
    const second = orphanRow();
    h.git(second.main, 'worktree', 'lock', second.wt);
    h.sh(`_ws_gc_prune_row orphan demo quiet-mesa "${second.wt}" 0`);
    assertGuard('ws-gc orphan, git refused');
    const outs = eventsOf(h.home, 'destroy');
    expect(outs.map((e) => e['outcome']),
      'the failure closes it — not a second done, and not silence').toEqual(['intent', 'failed']);
    expect(outs[1]!['refusal']).toBe('worktree-remove-failed');
    expect(fs.existsSync(second.wt), 'and the locked worktree stands').toBe(true);
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
      // THE SHIM IS A PARAMETER (r3 A-I3). Mechanism absence and contention are
      // two different conditions with two different refusals, so the same leg
      // has to be runnable with the `command -v flock` shim and without it.
      run: (shim: string): void => { h.sh(`${shim} ${RM_STUB} ( cmd_ws_rm demo-still-river ) 2>/dev/null || true`); } },
    { verb: 'forget', act: 'forget', id: 'claude-corp-demo', slug: null,
      plant: (): void => { wrapperRow(); },
      run: (shim: string): void => { h.sh(`${shim} ${FORGET_STUB} ( cmd_forget claude-corp-demo ) 2>/dev/null || true`); } },
    { verb: 'ws-gc --prune', act: 'destroy', id: 'demo-quiet-basin', slug: ['demo', 'quiet-basin'] as const,
      plant: (): void => { deadRow(); },
      run: (shim: string): void => { h.sh(`${shim} _ws_gc_prune_row dead-reg demo quiet-basin /gone 0`); } },
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
      leg.run(NOFLOCK);
      expect(purges(), `${leg.verb}: exactly one purge-done, so the purge really ran`).toBe(1);
      expect(h.reg(leg.id, 'uuid'), `${leg.verb}: and the row is gone`).toBeNull();
      // (f) the slug answers consistently with that.
      if (leg.slug) {
        expect(h.sh(`_ws_slug_free ${leg.slug[0]} ${leg.slug[1]}; echo "free=$?"`)).toContain('free=0');
      }
    }
  }, 120_000);

  // ── (d1), SPLIT IN TWO (r3 A-I3) ───────────────────────────────────────
  // `_reg_purge` has answered 1 (contention) and 2 (mechanism absent) apart
  // since D-2782, and all four callers folded them into one `elif (( _x != 0 ))`
  // — so this leg, which drives the MECHANISM-ABSENT condition, used to assert
  // `purge-refused` and thereby PINNED the conflation as expected. MEASURED on
  // the shipped tree before the split: a NOFLOCK box with a live generation
  // journaled "…compactions.lock was unavailable … re-run once the compaction
  // settles", and both clauses are false there — `_compact_lock_acquire`
  // returns 2 from `command -v` (`ccd/ccd:1812-1814`) before it touches the
  // lock file, so that pathname need not exist, and no compaction runs or can.
  // The two conditions are now asserted side by side, because the property
  // that matters is not what either says but that they DIFFER.
  const purgeRefusal = (leg: typeof LEGS[number]): { token: string; detail: string } => {
    const fails = eventsOf(h.home, leg.act).filter((e) => e['outcome'] === 'failed');
    expect(fails, `${leg.verb}: exactly one failure`).toHaveLength(1);
    expect(purges(), `${leg.verb}: and NO purge-done`).toBe(0);
    expect(h.reg(leg.id, 'uuid'), `${leg.verb}: the row still stands`).not.toBeNull();
    // (f) and the slug says so.
    if (leg.slug) {
      expect(h.sh(`_ws_slug_free ${leg.slug[0]} ${leg.slug[1]}; echo "free=$?"`)).toContain('free=1');
    }
    return { token: String(fails[0]!['refusal'] ?? ''), detail: String(fails[0]!['detail'] ?? '') };
  };

  it('(d1) ws-rm and forget REFUSE on a generation-PRESENT row — and MECHANISM ABSENCE is a different refusal from CONTENTION', async () => {
    for (const leg of LEGS.filter((l) => l.verb !== 'ws-gc --prune')) {
      // (d1a) MECHANISM ABSENT. The shim makes `command -v flock` fail, which
      // is the condition `_reg_purge` answers 2 for.
      h = makeCcdHarness('ccrc-lc-purge-');
      leg.plant();
      plantGeneration(leg.id);
      leg.run(NOFLOCK);
      const absent = purgeRefusal(leg);
      expect(absent.token, `${leg.verb}: mechanism absence has its own token`).toBe('purge-mechanism-absent');
      // NEITHER OF STATUS 1's TWO FALSE CLAUSES. Asserted as absences because
      // that is exactly what the conflation put here, verbatim.
      expect(absent.detail, `${leg.verb}: it does not blame a lock file that was never consulted`)
        .not.toContain('was unavailable');
      expect(absent.detail, `${leg.verb}: and it does not prescribe waiting for a compaction that cannot run`)
        .not.toContain('once the compaction settles');
      // AND IT NAMES THE CAUSE AND THE PATH REMEDY, which is the whole point of
      // a distinct token: an operator who reads this knows what to change.
      expect(absent.detail, `${leg.verb}: names the mechanism`).toContain('MECHANISM is absent');
      expect(absent.detail, `${leg.verb}: names the remedy`).toContain('PATH');
      // AND THE THREE BINARIES ARE NAMED AS TEXT, in one contiguous phrase.
      // This is not decoration. Written with backticks inside the
      // double-quoted bash string, those names are COMMAND SUBSTITUTION —
      // MEASURED on the form that shipped for one commit: bash ran flock,
      // mktemp and link, leaked two usage messages to stderr, CREATED a real
      // temp file and spliced its pathname into the operator's journal detail
      // ("— , /tmp/tmp.nT9Ch9dTSd or  could not be resolved"). The
      // "MECHANISM is absent" and "PATH" clauses above both SURVIVE that, which
      // is exactly how it passed this leg. The phrase below does not: any
      // substitution mangles it. (The names carry no backticks at all now —
      // `macos-platform.test.ts`'s GNU scan cannot tell an escaped backtick
      // from a live one, and it is right not to try.)
      expect(absent.detail, `${leg.verb}: the three binaries are named as TEXT, in one unmangled phrase`)
        .toContain('flock, mktemp or link could not be resolved');

      // (d1b) CONTENTION, the condition status 1 is FOR: a real `flock` and a
      // real holder, same row shape, same generation.
      h = makeCcdHarness('ccrc-lc-purge-');
      leg.plant();
      plantGeneration(leg.id);
      const release = await hold(leg.id, 8);
      let held: { token: string; detail: string };
      try {
        leg.run('');
        held = purgeRefusal(leg);
      } finally { release(); }
      expect(held.token, `${leg.verb}: contention keeps the sentence it was written for`).toBe('purge-refused');
      expect(held.detail, `${leg.verb}: and that one DOES blame the lock`).toContain('was unavailable');
      expect(held.detail).toContain('once the compaction settles');

      // THE PROPERTY, stated as itself: two conditions, two records.
      expect(held.token, `${leg.verb}: two conditions may not share one token`).not.toBe(absent.token);
      expect(held.detail, `${leg.verb}: nor one sentence`).not.toBe(absent.detail);
    }
  }, 180_000);

  // ── (d1c) CANONICAL VANISHED — status 1's SECOND condition (r4 A-M3) ────
  // `_compact_lock_acquire` answers 1 for ordinary contention AND for a
  // permanent lock unlinked out of contract under a live holder, and tells
  // them apart only in COMPACT_LOCK_WHY. `_reg_purge` collapses both into
  // status 1, and every caller's detail asserted the contention story — which
  // in this state names a pathname that does not exist and prescribes a wait
  // that cannot end, because this file deliberately never mints a second inode
  // over a live holder and no compliant path recreates the file.
  //
  // THE CONTROLS, ONE PER LEG (r5 R4-M2). This block runs over all THREE legs,
  // and the header used to name a single control for all of them: "(d1b) above
  // … drives the same status with COMPACT_LOCK_WHY empty and asserts the
  // contention sentence survives". (d1b) lives inside `it('(d1) …')`, whose
  // loop is `LEGS.filter((l) => l.verb !== 'ws-gc --prune')`, so it is the
  // control for ws-rm and forget ONLY. The gc leg's control is the DEAD-REG
  // arm at the top of this file — same verb, same status, COMPACT_LOCK_WHY
  // empty — which since r5 R4-M2 asserts 'was unavailable' and the ABSENCE of
  // this token in its own durable detail. Before that it read the token and
  // the surviving row and nothing about the sentence, and the gap was
  // MEASURED: the gc caller's override fired unconditionally with this file
  // still GREEN 50/50.
  /** A holder through the SHIPPED acquire, which is what makes the /proc arm of
   *  `_compact_lock_vanished` answer: a holder past its acquire has unlinked
   *  its `lock-open` alias and keeps only a descriptor, so a fixture that opens
   *  canonical directly (as `holdCompactLock` does) leaves nothing for the walk
   *  to find and the next acquire MINTS instead of refusing. */
  /** The terminal fact this leg reads, for all THREE verbs: `ws-rm` and
   *  `forget` FAIL (the purge follows an irreversible act) while
   *  `ws-gc --prune` REFUSES (it reaches the purge before anything
   *  irreversible), so the shared `purgeRefusal` above — which requires a
   *  `failed` — covers only two of the three and the gc caller is the one
   *  r3 A-I3 found unpinned. */
  const purgeTerminal = (leg: typeof LEGS[number]): { token: string; detail: string } => {
    const terminal = eventsOf(h.home, leg.act)
      .filter((e) => e['outcome'] === 'failed' || e['outcome'] === 'refused');
    expect(terminal, `${leg.verb}: exactly one terminal fact`).toHaveLength(1);
    expect(purges(), `${leg.verb}: and NO purge-done`).toBe(0);
    expect(h.reg(leg.id, 'uuid'), `${leg.verb}: the row still stands`).not.toBeNull();
    return { token: String(terminal[0]!['refusal'] ?? ''), detail: String(terminal[0]!['detail'] ?? '') };
  };
  const holdViaAcquire = async (id: string): Promise<() => void> => {
    const child = spawn('bash', ['-c',
      `source "${CCD}"; _compact_lock_acquire ${id} 5 || { echo "ACQRC=$?"; exit 1; }; echo held; exec sleep 20`],
      { cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    let out = '';
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`the holder never acquired: ${out}`)), 10_000);
      child.stdout.on('data', (d: Buffer) => { out += d.toString(); if (out.includes('held')) { clearTimeout(t); res(); } });
      child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('error', (e) => { clearTimeout(t); rej(e); });
    });
    return () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
  };

  it('(d1c) all four purge callers tell CANONICAL-VANISHED from CONTENTION, and neither prescribes the other remedy', async () => {
    for (const leg of LEGS) {
      h = makeCcdHarness('ccrc-lc-purge-');
      leg.plant();
      plantGeneration(leg.id);
      // A REAL HOLDER FIRST, then the out-of-contract unlink. Nothing in this
      // tree unlinks the permanent lock — `_reg_purge` skips it BY NAME and
      // `_ws_private_family` excludes it — so this is a stranger, which is the
      // condition §4 rules on.
      const release = await holdViaAcquire(leg.id);
      let vanished: { token: string; detail: string };
      try {
        fs.unlinkSync(lockOf(leg.id));
        // THE PRECONDITION, MEASURED rather than assumed: the acquire really
        // does answer 1 with this WHY here, so the leg below is driving the
        // condition it names and not an ordinary contention.
        const probe = h.sh(`_compact_lock_acquire ${leg.id} 1; echo "RC=$? WHY=$COMPACT_LOCK_WHY"`);
        expect(probe, `${leg.verb}: the fixture is in the canonical-vanished state`).toContain('RC=1');
        expect(probe, `${leg.verb}: and the acquire says which refusal it is`).toContain('WHY=canonical-vanished');
        leg.run('');
        vanished = purgeTerminal(leg);
      } finally { release(); }
      // The TOKEN is unchanged — this is still status 1, and a fourth status
      // with four new caller arms is what `_hook_lock_still_canonical`'s own
      // note says this level does not have. What changes is the SENTENCE.
      expect(vanished.token, `${leg.verb}: still status 1`).toBe('purge-refused');
      expect(vanished.detail, `${leg.verb}: names the condition the acquire measured`).toContain('canonical-vanished');
      expect(vanished.detail, `${leg.verb}: and says why a re-run cannot help`)
        .toContain('has been unlinked while a live holder still owns its inode');
      expect(vanished.detail, `${leg.verb}: and names the remedy that can`).toContain('by hand');
      // THE FALSE CLAUSE IS GONE, asserted as an absence because that is
      // exactly what the conflation put here, verbatim.
      expect(vanished.detail, `${leg.verb}: it no longer prescribes a wait that cannot end`)
        .not.toContain('once the compaction settles');
    }
  }, 180_000);

  // ── (d1d) STATUS 1'S OTHER TOKENED CONDITIONS (r5 R4-M3) ────────────────
  // r4 A-M3 built the split on the premise that status 1 "is two conditions".
  // It is not: `_compact_lock_acquire` returns 1 from many distinct states, and
  // two more of them are states no wait ends — so the contention sentence was
  // as false there as it was for `canonical-vanished`, and nothing said so.
  // Both now carry their own COMPACT_LOCK_WHY and their own remedy, and these
  // two legs drive them through the real verbs. (d1b) stays the CONTROL for
  // ws-rm and forget and the DEAD-REG arm for ws-gc: both still get
  // "once the compaction settles", because ordinary contention still ends.
  it('(d1d) a lock pathname OCCUPIED by a directory is its own condition, with a remedy a re-run cannot be', () => {
    for (const leg of LEGS) {
      h = makeCcdHarness('ccrc-lc-purge-');
      leg.plant();
      plantGeneration(leg.id);
      // NO HOLDER AT ALL, which is the point: a directory at the lock pathname
      // is not contention. `_compact_lock_acquire`'s `[ -e ]` arm sees the name
      // occupied, its `[[ -f && ! -L ]]` test refuses, and nothing anywhere in
      // this tree will ever remove that directory — so "wait" is not a remedy
      // and "restore the file by hand" names the wrong act.
      fs.mkdirSync(lockOf(leg.id));
      // THE PRECONDITION, MEASURED rather than assumed, exactly as (d1c) does.
      const probe = h.sh(`_compact_lock_acquire ${leg.id} 1; echo "RC=$? WHY=$COMPACT_LOCK_WHY"`);
      expect(probe, `${leg.verb}: the fixture is in the occupied-pathname state`).toContain('RC=1');
      expect(probe, `${leg.verb}: and the acquire says which refusal it is`).toContain('WHY=lock-path-occupied');
      leg.run('');
      const r = purgeTerminal(leg);
      expect(r.token, `${leg.verb}: still status 1, so still the same token`).toBe('purge-refused');
      expect(r.detail, `${leg.verb}: names the condition the acquire measured`).toContain('lock-path-occupied');
      expect(r.detail, `${leg.verb}: and the pathname something else is holding`).toContain(`.${leg.id}.compactions.lock`);
      expect(r.detail, `${leg.verb}: and the act that actually clears it`).toContain('remove that object by hand');
      // THE TWO FALSE REMEDIES, asserted as absences because both were what
      // shipped here before this leg existed.
      expect(r.detail, `${leg.verb}: no wait ends this, so no wait is prescribed`)
        .not.toContain('once the compaction settles');
      expect(r.detail, `${leg.verb}: and the pathname is occupied, not unlinked`)
        .not.toContain('canonical-vanished');
    }
  }, 120_000);

  it('(d1d) a mktemp that fails AT RUNTIME is its own condition too — `command -v` had already said yes', () => {
    // THE SHIM IS A FUNCTION, NOT A PATH STUB, and that is what makes it this
    // condition rather than the neighbouring one. `_compact_lock_acquire`
    // answers 2 — mechanism absent — when `command -v mktemp` fails, so the
    // runtime failure at the mint is reachable ONLY where `mktemp` resolves. A
    // bash function resolves: `command -v mktemp` prints its name and answers
    // 0. It then refuses exactly the one call that mints the lock source and
    // leaves every other `mktemp` in the verb — `_plat_mktemp`'s scratch files,
    // `_reg_generation_init`'s own source — running for real, so the leg drives
    // one statement's failure and not a crippled box. The token assertion below
    // is what separates the two: `purge-mechanism-absent` would mean the shim
    // shadowed the wrong thing.
    const MKTEMP_FAIL = 'mktemp() { case "$*" in *compactions.lock-init*) return 1 ;; esac; command mktemp "$@"; };';
    for (const leg of LEGS) {
      h = makeCcdHarness('ccrc-lc-purge-');
      leg.plant();
      plantGeneration(leg.id);
      expect(fs.existsSync(lockOf(leg.id)),
        `${leg.verb}: the permanent lock has never been minted — that is the fixture`).toBe(false);
      const probe = h.sh(`${MKTEMP_FAIL} command -v mktemp >/dev/null && echo CV=ok; `
        + `_compact_lock_acquire ${leg.id} 1; echo "RC=$? WHY=$COMPACT_LOCK_WHY"`);
      expect(probe, `${leg.verb}: the shim still RESOLVES, so status 2 was never reachable`).toContain('CV=ok');
      expect(probe, `${leg.verb}: and the acquire refuses with status 1, not 2`).toContain('RC=1');
      expect(probe, `${leg.verb}: naming the runtime failure`).toContain('WHY=lock-source-refused');
      leg.run(MKTEMP_FAIL);
      const r = purgeTerminal(leg);
      expect(r.token, `${leg.verb}: status 1, which is NOT mechanism absence`).toBe('purge-refused');
      expect(r.detail, `${leg.verb}: names the condition the acquire measured`).toContain('lock-source-refused');
      expect(r.detail, `${leg.verb}: and blames the directory that refused the write`).toContain('refused the write');
      expect(r.detail, `${leg.verb}: no wait frees a full filesystem`)
        .not.toContain('once the compaction settles');
      expect(r.detail, `${leg.verb}: and nothing has been unlinked here`)
        .not.toContain('canonical-vanished');
    }
  }, 120_000);

  it('(d1e) EVERY token the acquire can set is keyed to its own remedy at all four durable callers', () => {
    // THE TOKEN SET IS DERIVED FROM THE ACQUIRE, never listed here. That is the
    // whole guard: a fourth condition given a token and no caller arm would
    // otherwise fall through to the contention sentence in silence, which is
    // the defect r5 R4-M3 found in the `[[ -z … ]] ||` form this replaced —
    // one sentence answering for every token there will ever be.
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('_compact_lock_acquire() {');
    expect(from, 'the acquire is in ccd').toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf('\n}\n', from));
    const tokens = [...body.matchAll(/COMPACT_LOCK_WHY=([a-z][a-z-]*)/g)].map((m) => m[1]!);
    // NON-VACUITY: a census that counted zero would satisfy every loop below by
    // running none of them, which is the one reading that is never right here.
    expect(tokens.length, 'the acquire names conditions at all').toBeGreaterThan(2);
    expect(new Set(tokens).size, 'and no token is minted at two sites').toBe(tokens.length);
    // AND THE ACQUIRE IS THE ONLY WRITER, so this census is the whole set: the
    // count is the tokens plus the one clear-on-entry.
    expect((src.match(/COMPACT_LOCK_WHY=/g) ?? []).length,
      'COMPACT_LOCK_WHY is written only inside the acquire').toBe(tokens.length + 1);
    for (const v of ['_rm_why', '_rt_why', '_pr_why', '_fg_why']) {
      const at = src.indexOf(`local ${v}=`);
      expect(at, `${v} is one of the four durable purge callers`).toBeGreaterThan(-1);
      const block = src.slice(at, src.indexOf('esac', at));
      for (const t of tokens) {
        expect(block, `${v} gives ${t} its own remedy rather than the contention sentence`)
          .toContain(`${t}) ${v}=`);
      }
      expect(block, `${v} refuses to read an UNRECOGNISED token as ordinary contention`)
        .toContain(`*) ${v}=`);
    }
    // AND THE HEADING FOLLOWS THE MECHANISM. The enumerating one was the
    // finding's first half: it invited the next maintainer to read the
    // else-branch as proven contention.
    expect(src, 'the enumerating heading is gone').not.toContain('STATUS 1 IS TWO CONDITIONS');
    expect((src.match(/STATUS 1 FOLDS SEVERAL CONDITIONS/g) ?? []).length,
      'and its replacement heads all four durable callers').toBe(4);
  });

  it('(d3) THE SWEEP REACHES THE NEXT ROW: a declining row does not truncate `ws-gc --prune`', () => {
    // The plan requires the arity pin to ship "with the behaviour control that
    // the `ws-gc --prune` forced-refusal fixture must still reach the NEXT
    // row", and §5's dead-reg row ends "and the sweep continues to the next
    // row". MEASURED at the round's base: every forced-refusal fixture in the
    // tree calls `_ws_gc_prune_row` DIRECTLY, on ONE row — so none of them can
    // see the loop at all, and a declining arm that started terminating the
    // sweep (a `die`, a `return` the loop honours, a `set -e`) would truncate
    // `ws-gc --prune` at the first contended row with every later reclaimable
    // row silently unprocessed, while every single-row leg stayed green.
    //
    // TWO ROWS, AND THE ORDER IS THE FIXTURE. `_ws_gc_scan` walks
    // `"$REG"/*.workspace`, an alphabetical glob, so `aaa` is reached before
    // `zzz` — and only the FIRST carries a generation, which is what makes it
    // the one that declines.
    const deadAt = (id: string, slug: string): void => {
      h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199
        _reg_set ${id} project demo; _reg_set ${id} workspace ${slug}
        _reg_set ${id} branch ws/${slug}; _reg_set ${id} workdir /gone`);
    };
    deadAt('demo-aaa-basin', 'aaa-basin');
    deadAt('demo-zzz-basin', 'zzz-basin');
    plantGeneration('demo-aaa-basin');
    // IN A SUBSHELL, the idiom this file already uses for the arms that `die`:
    // the mutant this leg exists to catch (`_lc_refuse_return` retyped as
    // `_lc_refuse`) ends the sweep with an `exit`, which in the SOURCING shell
    // would kill the snippet before any assertion could read the registry —
    // reporting a failed command instead of the property that failed. Contained
    // here, the sweep's death is survivable and the assertions below say what
    // it cost: the second row was never reached.
    const out = h.sh(`${NOFLOCK} ( cmd_ws_gc --prune ) 2>&1 || true`);

    // ROW ONE DECLINED, positively.
    expect(out, 'the first row is reported as declined').toContain('declined');
    expect(out).toContain('demo-aaa-basin');
    const destroys = eventsOf(h.home, 'destroy');
    const first = destroys.filter((e) => String(e['id']) === 'demo-aaa-basin');
    expect(first.map((e) => e['outcome']), 'one intent, one refusal').toEqual(['intent', 'refused']);
    expect(h.reg('demo-aaa-basin', 'uuid'), 'and its row still stands').not.toBeNull();

    // ROW TWO WAS STILL REACHED — the property this leg exists for.
    const purged = eventsOf(h.home, 'purge').map((e) => String(e['id']));
    expect(purged, 'the sweep carried on to the second row').toContain('demo-zzz-basin');
    expect(purged, 'and did not touch the row it refused').not.toContain('demo-aaa-basin');
    expect(h.reg('demo-zzz-basin', 'uuid'), 'the second row is gone').toBeNull();
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
    // AND IT IS THE MECHANISM-ABSENT REFUSAL, not contention's (r3 A-I3). The
    // DISPOSITION is unchanged — this caller still declines, because it still
    // reaches the purge before anything irreversible — so only the token and
    // the sentence can carry the difference, and without this assertion folding
    // the status-2 arm back into `!= 0` stayed GREEN here (measured).
    expect(terminal[0]!['refusal'], 'the NOFLOCK shim is mechanism absence, not a busy lock')
      .toBe('purge-mechanism-absent');
    const gcDetail = String(terminal[0]!['detail'] ?? '');
    expect(gcDetail, 'no lock file is blamed — none was consulted').not.toContain('was unavailable');
    expect(gcDetail, 'the cause is named').toContain('MECHANISM is absent');
    expect(purges(), 'no purge-done').toBe(0);
    expect(h.reg(id, 'uuid'), 'the row stands').not.toBeNull();
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.generation`)),
      'and so does its authorization').toBe(true);
    expect(h.sh(`_ws_slug_free demo quiet-basin; echo "free=$?"`)).toContain('free=1');
  }, 30_000);
});
