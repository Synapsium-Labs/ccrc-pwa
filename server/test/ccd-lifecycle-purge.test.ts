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
    expect(purges, 'the backstop did not fire').toHaveLength(1);
    const m = measOf(purges[0]!);
    expect(purges[0]!['id']).toBe(id);
    expect(m['project']).toBe('demo');
    expect(m['workspace']).toBe('still-river');
    expect(m['branch']).toBe('ws/still-river');
    expect(m['wrapper']).toBe('claude-corp');
    expect(m['uuid']).toBe('72be9ee2-0000-4bcc-b60b-0cfc0dc3d199');
    expect(m['workdir']).toBe('/data/worktrees/demo/still-river');
    expect(m['archivedAt']).toBe('1787000000');
    expect(m['archivedReason']).toBe('merged:#42');
  });

  it('THE MUTANT: an emit moved after the loop reads a stripped registry', () => {
    // Mutant: move the `_lc_done purge …` line from above `local id="$1"` to
    // below the loop's closing `done` -> this fails with
    // `expected undefined to be 'ws/still-river'`, because ccd:535 has already
    // unlinked every field but `archived`/`reaping`. That is the whole reason
    // the emit is where it is.
    const id = seed();
    h.sh(`_reg_purge ${id}`);
    const m = measOf(eventsOf(h.home, 'purge')[0]!);
    expect(m['branch']).toBe('ws/still-river');
    expect(m['workdir']).toBe('/data/worktrees/demo/still-river');
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((n) => n.startsWith(`${id}.`)))
      .toEqual([]);
  });

  it('omits a field that was never measured rather than writing it as ""', () => {
    h.sh(`_reg_set bare-row uuid abc; _reg_purge bare-row`);
    const m = measOf(eventsOf(h.home, 'purge')[0]!);
    expect(m['uuid']).toBe('abc');
    expect(m).not.toHaveProperty('branch');
    expect(m).not.toHaveProperty('archivedReason');
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
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf('_substrate_mark() {'));
    expect(body).toMatch(/_lc_done\s+purge\s+"\$1"/);
    const emitAt = body.indexOf('_lc_done purge');
    const loopAt = body.indexOf('for f in "$REG/$id".*');
    expect(emitAt).toBeGreaterThan(-1);
    expect(loopAt, 'the unlink loop moved — re-measure before trusting this').toBeGreaterThan(-1);
    expect(emitAt, 'the backstop must precede the unlink loop').toBeLessThan(loopAt);
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
