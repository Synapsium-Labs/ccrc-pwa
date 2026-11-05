// Delegation broker wave 5, PR6, the coordinator's ruling 1 (review 1475 F11): a carrier mark takes the orphan act's own lock.
// A carrier written between `ccd ws-orphan`'s in-lock ladder read and its `git worktree remove` would escape both. So a mark whose
// state is not `released` takes `$REG/.orphan-<s16>.lock` with `flock -n`, after the lease lock and before its tree checks, over each
// distinct spelling of the tree the orphan act may lock (the path `ws-audit --orphans` prints, which is git's recorded spelling, and the
// physical one), and holds it through the carrier's rename. On contention it answers `busy` and writes nothing. Both locks are `-n`, so
// there is no wait cycle with `ws-orphan`. Every case runs on a FIXTURE HOME (`makeCcdHarness`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import * as F from './leaseFixture.js';
import { LEASE, type Out } from './leaseFixture.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lease-orphan-lock-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

const s16 = (p: string): string => crypto.createHash('sha256').update(p).digest('hex').slice(0, 16);
const orphanLock = (p: string): string => path.join(F.reg(h), `.orphan-${s16(p)}.lock`);
/** The paths `git worktree list --porcelain` prints for the linked trees: the spelling the orphan census hands `ws-orphan`. */
const listed = (): string[] => h.git(F.main(h), 'worktree', 'list', '--porcelain').split('\n')
  .filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length)).slice(1);
const byTree = (): string[] => {
  const d = path.join(F.leasesDir(h), 'by-tree');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => !f.startsWith('.')) : [];
};

/** Runs `body` while a `flock` holder (its own process group) holds `lock`; waits until a probe cannot take it. */
async function holding<T>(lock: string, body: () => T): Promise<T> {
  const holder = spawn('flock', [lock, 'sleep', '30'], { stdio: 'ignore', detached: true });
  const held = (): boolean => spawnSync('flock', ['-n', lock, 'true']).status === 1;
  try {
    for (let i = 0; i < 400 && !held(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(held(), 'the holder holds the lock').toBe(true);
    return body();
  } finally { try { process.kill(-holder.pid!, 'SIGKILL'); } catch { /* already gone */ } }
}
const busyAndNothing = (r: Out): void => {
  expect(r.doc, JSON.stringify(r.doc)).toMatchObject({ ok: false, refusal: 'busy' });
  expect(r.code).toBe(1);
  expect(r.lines).toHaveLength(1);
  expect(fs.existsSync(F.carrierPath(h)), 'no carrier').toBe(false);
  expect(byTree(), 'no by-tree entry').toEqual([]);
};

describe('ruling 1: a carrier mark takes the orphan act\'s lock, and never waits on it', () => {
  it('a mark while the orphan lock of its tree is held answers busy and writes nothing; once free it is written, and the lock file stays', async () => {
    const t = F.agentTree(h);
    expect(listed(), 'the census spelling is the physical path here').toEqual([t]);
    await holding(orphanLock(t), () => busyAndNothing(F.mark(h)));
    expect(F.mark(h).doc).toMatchObject({ ok: true, answer: 'written', generation: 1 });
    expect(fs.existsSync(orphanLock(t)), 'like ws-orphan\'s, the lock file is never removed').toBe(true);
  }, 60_000);

  it('a released mark is not blocked by the orphan lock', async () => {
    const t = F.agentTree(h);
    expect(F.mark(h).doc).toMatchObject({ ok: true, answer: 'written' });
    const rel = { generation: '2', state: 'released', 'release-reason': 'foreign', 'journal-seq': '8' };
    const r = await holding(orphanLock(t), () => F.mark(h, rel));
    expect(r.doc).toMatchObject({ ok: true, answer: 'written', state: 'released' });
  }, 60_000);

  it('when git records the tree through a link, each spelling\'s orphan lock is taken: either one held answers busy', async () => {
    // The projects root reached through a link: git records the tree under the link's spelling (as an older git does, or a tree added
    // through it), the census prints that spelling, and the physical path is a second one. Both are locked, in one order, each with -n.
    const real = F.agentTree(h);
    const link = path.join(h.home, 'projects-link');
    fs.symlinkSync(path.join(h.home, 'projects'), link);
    const recorded = path.join(link, 'demo', '.claude', 'worktrees', 'agent-a');
    fs.writeFileSync(path.join(F.main(h), '.git', 'worktrees', 'agent-a', 'gitdir'), `${recorded}/.git\n`);
    expect(listed(), 'the census prints the recorded spelling').toEqual([recorded]);
    expect(recorded).not.toBe(real);
    const pre = `PROJECTS_ROOT=${link};`;
    for (const spelling of [recorded, real]) {
      await holding(orphanLock(spelling), () => busyAndNothing(F.mark(h, {}, pre)));
    }
    // Free, the same mark passes both locks; a tree git records through a link is then refused by the gitdir's own check (rule 11's
    // `_ws_reclaim_gitdir_own`), never `busy`, and writes nothing either.
    const free = F.mark(h, {}, pre);
    expect(free.doc, JSON.stringify(free.doc)).toMatchObject({ ok: false, refusal: 'unmeasured' });
    expect(String(free.doc.detail)).toContain('which git records as');
    expect(fs.existsSync(F.carrierPath(h))).toBe(false);
  }, 60_000);
});
