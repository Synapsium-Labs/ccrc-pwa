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
import { spawnSync } from 'node:child_process';
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
