/**
 * The sidecar carry MERGES on a return visit (session continuity, spec §5.1).
 *
 * `_swap_carry_sidecars` used to log `(kept)` and skip the whole tree whenever
 * the destination `<uuid>/` directory existed, so everything a session wrote
 * since it last left an account — subagent transcripts, workflow journals —
 * stayed on the source (774 of 1,310 carries). The existing-destination branch
 * now walks the source file by file under a box-wide non-blocking slot and a
 * byte budget spent as a priority fill (records, then journals, then the rest;
 * what does not fit is deferred to the next visit, never half-placed). Every
 * rule of the spec's table has a case here that reds when the rule is
 * removed; the first carry's own path is pinned unchanged.
 *
 * The REAL function runs against a fixture HOME (`makeCcdHarness`): two config
 * dirs, `.claude` (source) and `.claude-d` (destination), planted by hand.
 * ccd runs under `set -uo pipefail` with no `-e`, so nothing here throws on a
 * fallback — the swap.log line is the verdict every case reads.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-carry-merge-'); });
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-3333-4bcc-b60b-0cfc0dc3d199';
const PDIR = '-w-quiet-mesa';
const T0 = 1_780_000_000;   // a fixed mtime, whole seconds

const side = (cfg: string, rel = ''): string => path.join(h.home, cfg, 'projects', PDIR, UUID, rel);
const SRC = (rel = ''): string => side('.claude', rel);
const DST = (rel = ''): string => side('.claude-d', rel);

/** A file under a sidecar, with a fixed mtime so the quick check is decided by the test. */
const put = (p: string, body: string, mtime = T0): string => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  fs.utimesSync(p, mtime, mtime);
  return p;
};
const read = (p: string): string => fs.readFileSync(p, 'utf8');
const ino = (p: string): number => fs.statSync(p).ino;

const swapLog = (): string => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? read(p) : '';
};
/** Every `sidecar <uuid> -> <dst> (…)` verdict for our destination, oldest first. */
const verdicts = (): string[] =>
  swapLog().split('\n').filter((l) => l.includes(` sidecar ${UUID} -> ${DST()} (`)).map((l) => l.replace(/^.* \(/, '('));
/** The one verdict for our destination. */
const verdict = (): string => {
  const rows = verdicts();
  expect(rows, swapLog()).toHaveLength(1);
  return rows[0]!;
};
/** Every regular file under a directory, relative, sorted. */
const tree = (dir: string): string[] =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();

/** The real function, with an optional prefix (a held slot, a budget). */
const carry = (prefix = ''): string =>
  h.sh(`${prefix} _swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} 2>&1; echo "[rc=$?]"`);

/** Hold the carry slot from the SAME snippet on a second open file
 *  description — flock(2) treats two open()s of one path as two holders, so
 *  the carry's own `flock -n` finds it contended. */
const HOLD_SLOT = 'exec 7>>"$REG/.carry.lock"; flock -n 7 || echo HOLD-FAILED;';

describe('a return visit merges instead of skipping', () => {
  it('carries the journals written since the session last left (+N)', () => {
    put(SRC('tool-results/old.txt'), 'OLD\n');
    put(DST('tool-results/old.txt'), 'OLD\n');
    put(SRC('subagents/workflows/wf_1/journal.jsonl'), '{"type":"launched"}\n');
    put(SRC('subagents/workflows/wf_1/agent-a1.jsonl'), '{"t":1}\n');
    expect(carry()).toContain('[rc=0]');
    expect(read(DST('subagents/workflows/wf_1/journal.jsonl'))).toBe('{"type":"launched"}\n');
    expect(read(DST('subagents/workflows/wf_1/agent-a1.jsonl'))).toBe('{"t":1}\n');
    expect(verdict()).toBe('(merged +2 ~0 !0)');
    expect(swapLog()).not.toContain('(kept');
  });

  it('an equal file is untouched and uncounted — even when its mtime differs and the bytes must be read', () => {
    put(SRC('tool-results/r.txt'), 'SAME\n', T0 + 50);
    const d = put(DST('tool-results/r.txt'), 'SAME\n', T0);
    const before = { ino: ino(d), mtime: fs.statSync(d).mtimeMs };
    carry();
    expect(ino(d)).toBe(before.ino);
    expect(fs.statSync(d).mtimeMs).toBe(before.mtime);
    expect(verdict()).toBe('(merged +0 ~0 !0)');
  });

  it('extends a journal the destination holds a strict prefix of (~R), by temp-and-rename', () => {
    put(SRC('subagents/workflows/wf_1/journal.jsonl'), 'A\nB\nC\n', T0 + 60);
    const d = put(DST('subagents/workflows/wf_1/journal.jsonl'), 'A\n');
    // A second NAME for the destination's inode: a write THROUGH the inode
    // would rewrite it too; temp-and-rename leaves it holding the old bytes.
    const sibling = path.join(h.home, 'sibling.jsonl');
    fs.linkSync(d, sibling);
    carry();
    expect(read(d)).toBe('A\nB\nC\n');
    expect(read(sibling), 'the replace wrote through the destination inode').toBe('A\n');
    expect(verdict()).toBe('(merged +0 ~1 !0)');
  });

  it('keeps a destination journal that is further along (source a prefix of it), uncounted', () => {
    put(SRC('subagents/agent-a1.jsonl'), 'A\n', T0 + 60);
    const d = put(DST('subagents/agent-a1.jsonl'), 'A\nB\nC\n');
    carry();
    expect(read(d)).toBe('A\nB\nC\n');
    expect(verdict()).toBe('(merged +0 ~0 !0)');
  });

  it('keeps a DIVERGED journal and counts it (!D), naming the longer copy — whichever side is longer', () => {
    // a1: the destination is SHORTER but not a prefix — the extend rule must
    // not fire. a2: the destination is LONGER but the source is not its prefix
    // — the "further along" rule must not swallow it uncounted.
    const s1 = put(SRC('subagents/agent-a1.jsonl'), 'A\nB\nC\n', T0 + 60);
    const d1 = put(DST('subagents/agent-a1.jsonl'), 'A\nX\n');
    put(SRC('subagents/agent-a2.jsonl'), 'A\nB\n', T0 + 60);
    const d2 = put(DST('subagents/agent-a2.jsonl'), 'A\nX\nY\nZ\n');
    carry();
    expect(read(d1)).toBe('A\nX\n');
    expect(read(d2)).toBe('A\nX\nY\nZ\n');
    expect(verdict()).toBe('(merged +0 ~0 !2)');
    expect(swapLog()).toContain(`sidecar ${UUID} diverged ${d1} longer ${s1}`);
    expect(swapLog()).toContain(`sidecar ${UUID} diverged ${d2} longer ${d2}`);
  });

  it('replaces a rewritten record when the source is newer (~R), and not when it is older', () => {
    put(SRC('workflows/wf_1.json'), '{"state":"completed","n":2}', T0 + 60);
    const d = put(DST('workflows/wf_1.json'), '{"state":"running"}');
    put(SRC('subagents/agent-a1.meta.json'), '{"v":1}', T0 - 60);
    const m = put(DST('subagents/agent-a1.meta.json'), '{"v":22}');
    carry();
    expect(read(d)).toBe('{"state":"completed","n":2}');
    expect(read(m), 'an OLDER source record replaced a newer destination').toBe('{"v":22}');
    expect(verdict()).toBe('(merged +0 ~1 !0)');
  });

  it('keeps a record the destination holds at the SAME size when the source is older — byte-identical, same inode', () => {
    // The only same-size record case elsewhere has a NEWER source. An older
    // source of the same size reaches the placement loop's own age test, which
    // nothing else drives: without it the older bytes replace the newer ones.
    put(SRC('workflows/wf_1.json'), '{"s":"old!"}', T0 - 60);
    const d = put(DST('workflows/wf_1.json'), '{"s":"new!"}', T0);
    const before = [read(d), ino(d), fs.statSync(d).mtimeMs];
    carry();
    expect([read(d), ino(d), fs.statSync(d).mtimeMs], 'an OLDER same-size record replaced the destination').toEqual(before);
    expect(verdict()).toBe('(merged +0 ~0 !0)');
  });

  it('keeps a record whose source has the destination\'s exact mtime_ns but another size — "strictly newer" is strict', () => {
    put(SRC('workflows/wf_1.json'), '{"state":"completed"}', T0);
    const d = put(DST('workflows/wf_1.json'), '{"s":"r"}', T0);
    carry();
    expect(read(d), 'an EQUAL-age source replaced the destination').toBe('{"s":"r"}');
    expect(verdict()).toBe('(merged +0 ~0 !0)');
  });

  it('decides equality on size AND mtime, never on size alone — an equal-size file with other bytes is read and counted', () => {
    // The quick check (equal size and equal mtime_ns -> equal) is the ONLY
    // shortcut. Widened to size alone, this diverged tool result would pass
    // as equal and go uncounted.
    put(SRC('tool-results/r.txt'), 'AAAA\n', T0 + 60);
    const d = put(DST('tool-results/r.txt'), 'BBBB\n');
    carry();
    expect(read(d)).toBe('BBBB\n');
    expect(verdict()).toBe('(merged +0 ~0 !1)');
  });

  it('deletes nothing — a destination-only file survives, and the source is byte-for-byte untouched', () => {
    put(DST('tool-results/only-here.txt'), 'MINE\n');
    const s1 = put(SRC('subagents/agent-a1.jsonl'), 'A\nB\n', T0 + 60);
    put(DST('subagents/agent-a1.jsonl'), 'A\n');
    const s2 = put(SRC('tool-results/new.txt'), 'NEW\n');
    const before = [s1, s2].map((p) => [read(p), fs.statSync(p).mtimeMs, ino(p)]);
    carry();
    expect(read(DST('tool-results/only-here.txt'))).toBe('MINE\n');
    expect([s1, s2].map((p) => [read(p), fs.statSync(p).mtimeMs, ino(p)])).toEqual(before);
  });

  it('never nests the tree inside an existing destination', () => {
    put(SRC('tool-results/r.txt'), 'R\n');
    fs.mkdirSync(DST(), { recursive: true });
    carry();
    expect(fs.existsSync(DST(UUID)), 'a <uuid>/<uuid> nest').toBe(false);
    expect(read(DST('tool-results/r.txt'))).toBe('R\n');
  });

  it('repairs a destination a failed first carry left partial — the skeleton `cp -al` leaves', () => {
    put(SRC('subagents/agent-a1.jsonl'), 'A\n');
    put(SRC('tool-results/r.txt'), 'R\n');
    fs.mkdirSync(DST('subagents'), { recursive: true });
    fs.mkdirSync(DST('tool-results'), { recursive: true });
    carry();
    expect(read(DST('subagents/agent-a1.jsonl'))).toBe('A\n');
    expect(read(DST('tool-results/r.txt'))).toBe('R\n');
    expect(verdict()).toBe('(merged +2 ~0 !0)');
  });

  it('never carries, counts or trips on a temp a killed walk left (`.ccd-carry-*`), on either side', () => {
    put(SRC('tool-results/.ccd-carry-abc123'), 'HALF A COPY');
    put(DST('tool-results/.ccd-carry-def456'), 'HALF A COPY');
    put(SRC('tool-results/new.txt'), 'NEW\n');
    carry();
    expect(fs.existsSync(DST('tool-results/.ccd-carry-abc123'))).toBe(false);
    expect(verdict()).toBe('(merged +1 ~0 !0)');
  });

  it('a destination SUBdirectory that is a symlink is not walked through: kept and counted (!D), nothing lands outside', () => {
    // The root `-L` check sees a link AT `<uuid>/`, not one below it: lstat and
    // isdir follow a link on every component but the last, so only the walk's own guard stops it.
    put(SRC('tool-results/r.txt'), 'R\n');
    fs.mkdirSync(DST(), { recursive: true });
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, DST('tool-results'));
    carry();
    expect(fs.readdirSync(outside), 'a file landed outside the account root').toEqual([]);
    expect(verdict()).toBe('(merged +0 ~0 !1)');
    expect(swapLog()).toContain(`sidecar ${UUID} diverged ${DST('tool-results/r.txt')} longer ${SRC('tool-results/r.txt')}`);
  });

  it('a non-regular source entry (a symlink, a fifo) is never followed and never copied', () => {
    // A symlink would be linked or copied THROUGH to its target (outside the
    // tree), and a fifo would block the copy: only a regular file is walked.
    put(SRC('tool-results/r.txt'), 'R\n');
    const secret = path.join(h.home, 'outside.txt');
    fs.writeFileSync(secret, 'SECRET\n');
    fs.symlinkSync(secret, SRC('tool-results/link.txt'));
    execFileSync('mkfifo', [SRC('tool-results/pipe')]);
    fs.mkdirSync(DST(), { recursive: true });
    carry();
    expect(verdict()).toBe('(merged +1 ~0 !0)');
    expect(read(DST('tool-results/r.txt'))).toBe('R\n');
    expect(fs.existsSync(DST('tool-results/pipe')), 'the fifo was carried').toBe(false);
    expect(fs.existsSync(DST('tool-results/link.txt')), 'the symlink was followed').toBe(false);
    expect(() => fs.lstatSync(DST('tool-results/link.txt')), 'the symlink itself was carried').toThrow();
  });

  it('a destination entry of another type where the source has a file is kept and counted (!D)', () => {
    // A `*.jsonl` whose destination is a DIRECTORY must reach the type guard,
    // not the log arm (which would open the directory and fail the walk).
    const s = put(SRC('subagents/agent-a1.jsonl'), 'A\n');
    put(DST('subagents/agent-a1.jsonl/inner.txt'), 'KEEP\n');
    carry();
    expect(verdict()).toBe('(merged +0 ~0 !1)');
    expect(fs.statSync(DST('subagents/agent-a1.jsonl')).isDirectory()).toBe(true);
    expect(read(DST('subagents/agent-a1.jsonl/inner.txt'))).toBe('KEEP\n');
    expect(swapLog()).toContain(`sidecar ${UUID} diverged ${DST('subagents/agent-a1.jsonl')} longer ${s}`);
  });

  // APFS refuses a non-UTF-8 name (EILSEQ), so the fixture cannot be planted on darwin.
  it.skipIf(process.platform === 'darwin')('a non-UTF-8 file name does not fail the report after the merge ran', () => {
    // Only a `diverged` row prints a path. Python's stdout is strict under a
    // UTF-8 locale and a name that is not UTF-8 would raise AFTER every file
    // was placed, so the carry would log `(kept: error)` for a walk that
    // merged. The strict handler is set here so the case does not depend on
    // the box's locale.
    const dir = (cfg: string): Buffer => Buffer.from(path.join(h.home, cfg, 'projects', PDIR, UUID, 'tool-results') + '/');
    const bad = Buffer.from([0x62, 0xff, 0x2e, 0x74, 0x78, 0x74]);   // b<0xFF>.txt
    fs.mkdirSync(dir('.claude'), { recursive: true });
    fs.mkdirSync(dir('.claude-d'), { recursive: true });
    fs.writeFileSync(Buffer.concat([dir('.claude'), bad]), 'SOURCE SIDE\n');
    fs.writeFileSync(Buffer.concat([dir('.claude-d'), bad]), 'ALREADY THERE\n');
    put(SRC('tool-results/new.txt'), 'NEW\n');
    h.sh(`_swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} 2>&1`, { PYTHONIOENCODING: 'utf-8:strict' });
    expect(verdict()).toBe('(merged +1 ~0 !1)');
    expect(read(DST('tool-results/new.txt'))).toBe('NEW\n');
    // os.walk hands the undecodable byte back as a lone surrogate (U+DCFF),
    // which backslashreplace spells out.
    expect(swapLog()).toContain('tool-results/b\\udcff.txt');
  });

  it('links an absent file when it can (same filesystem)', () => {
    const s = put(SRC('tool-results/r.txt'), 'R\n');
    fs.mkdirSync(DST(), { recursive: true });
    carry();
    expect(ino(DST('tool-results/r.txt'))).toBe(ino(s));
  });
});

// The copy fallback needs a destination on ANOTHER filesystem, which the fleet
// box has on every carry (each account root is its own bind mount, so link(2)
// answers EXDEV) and a fixture can only get from a tmpfs. Measured, not named.
const SHM = '/dev/shm';
const crossDevice = ((): boolean => {
  try { return fs.statSync(SHM).isDirectory() && fs.statSync(SHM).dev !== fs.statSync(os.tmpdir()).dev; }
  catch { return false; }
})();

describe('the copy fallback', () => {
  it.skipIf(!crossDevice)('copies an absent file when linking fails (EXDEV), and still lands it whole', () => {
    const vol = fs.mkdtempSync(path.join(SHM, 'ccrc-carry-merge-'));
    try {
      fs.mkdirSync(path.join(h.home, '.claude-d'), { recursive: true });
      fs.mkdirSync(path.join(vol, 'projects', PDIR, UUID), { recursive: true });
      fs.symlinkSync(path.join(vol, 'projects'), path.join(h.home, '.claude-d', 'projects'));
      const s = put(SRC('tool-results/r.txt'), 'R\n');
      carry();
      expect(read(DST('tool-results/r.txt'))).toBe('R\n');
      expect(ino(DST('tool-results/r.txt'))).not.toBe(ino(s));
      expect(fs.statSync(DST('tool-results/r.txt')).mtimeMs, 'copy2 keeps the mtime the quick check reads')
        .toBe(fs.statSync(s).mtimeMs);
      expect(verdict()).toBe('(merged +1 ~0 !0)');
    } finally {
      fs.rmSync(vol, { recursive: true, force: true });
    }
  });
});

describe('the budget is a priority fill: the most valuable actions first, the rest deferred to the next visit', () => {
  it('a budget smaller than the whole walk places the records and journals and defers the tool results (deferred K)', () => {
    // Priced by the dry pass: the record replace 21, the journal extend
    // 2·2 + 6 = 10, the absent agent log 8 — 39 of a 50-byte budget — and
    // then a 100-byte tool result that would overrun it. The tool results are
    // the NEWEST files here: newest-first alone would have placed them first.
    const rec = put(SRC('workflows/wf_1.json'), '{"state":"completed"}', T0 + 60);
    put(DST('workflows/wf_1.json'), '{"state":"running"}');
    put(SRC('subagents/workflows/wf_1/journal.jsonl'), 'A\nB\nC\n', T0 + 60);
    put(DST('subagents/workflows/wf_1/journal.jsonl'), 'A\n');
    put(SRC('subagents/workflows/wf_1/agent-a1.jsonl'), '{"t":1}\n', T0 + 60);
    put(SRC('tool-results/big-1.txt'), 'x'.repeat(100), T0 + 100);
    put(SRC('tool-results/big-2.txt'), 'y'.repeat(100), T0 + 90);
    carry('CARRY_MERGE_BUDGET=50;');
    expect(verdict()).toBe('(merged +1 ~2 !0, deferred 2)');
    expect(read(DST('workflows/wf_1.json'))).toBe(read(rec));
    expect(read(DST('subagents/workflows/wf_1/journal.jsonl'))).toBe('A\nB\nC\n');
    expect(read(DST('subagents/workflows/wf_1/agent-a1.jsonl'))).toBe('{"t":1}\n');
    expect(fs.existsSync(DST('tool-results')), 'a deferred action creates nothing, not even its directory').toBe(false);
  });

  it('places in resume order: records, then journal.jsonl newest first, then the other logs newest first, then the rest newest first', () => {
    // Every action costs the same 10 bytes (all absent), so a budget of 10·k
    // places exactly the first k: the order is read off which files landed.
    // The mtimes run AGAINST the tiers — the records are the oldest files, a
    // tool result the newest — so newest-first across tiers reds here.
    const ORDER: Array<[string, number]> = [
      ['subagents/agent-a1.meta.json', T0 - 400],
      ['workflows/scripts/s.js', T0 - 450],
      ['workflows/wf_1.json', T0 - 500],
      ['subagents/workflows/wf_2/journal.jsonl', T0 - 100],
      ['subagents/workflows/wf_1/journal.jsonl', T0 - 200],
      ['subagents/agent-a2.jsonl', T0 - 10],
      ['subagents/agent-a1.jsonl', T0 - 50],
      ['tool-results/new.txt', T0 + 100],
      ['tool-results/old.txt', T0 - 300],
    ];
    for (const [rel, t] of ORDER) put(SRC(rel), '0123456789', t);
    for (let k = 1; k <= ORDER.length; k++) {
      fs.rmSync(DST(), { recursive: true, force: true });
      fs.mkdirSync(DST(), { recursive: true });
      fs.rmSync(path.join(h.home, '.cc-sessions', 'swap.log'), { force: true });
      carry(`CARRY_MERGE_BUDGET=${10 * k};`);
      const missing = ORDER.slice(0, k).map(([rel]) => rel).filter((rel) => !fs.existsSync(DST(rel)));
      expect(missing.join(' '), `budget ${10 * k}: not placed`).toBe('');
      expect(tree(DST()), `budget ${10 * k}: placed beyond the first ${k}`).toHaveLength(k);
      const left = ORDER.length - k;
      expect(verdict(), `budget ${10 * k}`).toBe(left ? `(merged +${k} ~0 !0, deferred ${left})` : `(merged +${k} ~0 !0)`);
    }
  });

  it('an action priced over the budget on its own gives (kept: budget) and touches nothing — the fill never skips past it', () => {
    put(SRC('workflows/wf_1.json'), 'x'.repeat(100));   // first in resume order, 100 bytes
    put(SRC('tool-results/small.txt'), 'y');             // would fit on its own
    fs.mkdirSync(DST(), { recursive: true });
    carry('CARRY_MERGE_BUDGET=50;');
    expect(verdict()).toBe('(kept: budget)');
    expect(fs.readdirSync(DST())).toEqual([]);
  });

  it('a second visit with the same budget places what the first deferred — repeat visits converge', () => {
    // Five absent files of 10 bytes, a 20-byte budget: 2, then 2, then 1 —
    // each visit finds the ones already placed equal and prices only the rest.
    const rels = ['tool-results/r1.txt', 'tool-results/r2.txt', 'tool-results/r3.txt', 'tool-results/r4.txt', 'tool-results/r5.txt'];
    rels.forEach((rel, i) => put(SRC(rel), '0123456789', T0 + i));
    fs.mkdirSync(DST(), { recursive: true });
    const VISITS = ['(merged +2 ~0 !0, deferred 3)', '(merged +2 ~0 !0, deferred 1)', '(merged +1 ~0 !0)', '(merged +0 ~0 !0)'];
    VISITS.forEach((want, v) => {
      carry('CARRY_MERGE_BUDGET=20;');
      expect(verdicts()[v], `visit ${v + 1}`).toBe(want);
    });
    expect(tree(DST())).toEqual(rels);
  });

  it('deletes nothing under a budget, and a deferred action leaves no partial file', () => {
    // The record (12) fits a 12-byte budget; the journal extend (2·2 + 6 = 10)
    // and the new tool result (4) are deferred. The deferred journal keeps its
    // old bytes and inode, the deferred file is absent, no temp is left.
    put(SRC('workflows/wf_1.json'), '{"s":"done"}', T0 + 60);
    const sj = put(SRC('subagents/workflows/wf_1/journal.jsonl'), 'A\nB\nC\n', T0 + 60);
    const dj = put(DST('subagents/workflows/wf_1/journal.jsonl'), 'A\n');
    const st = put(SRC('tool-results/new.txt'), 'NEW\n');
    put(DST('tool-results/only-here.txt'), 'MINE\n');
    const snap = (p: string): unknown[] => [read(p), fs.statSync(p).mtimeMs, ino(p)];
    const before = { src: [sj, st].map(snap), dj: snap(dj) };
    carry('CARRY_MERGE_BUDGET=12;');
    expect(snap(dj), 'the deferred journal was touched').toEqual(before.dj);
    expect(fs.existsSync(DST('tool-results/new.txt')), 'the deferred file was placed').toBe(false);
    expect(read(DST('tool-results/only-here.txt'))).toBe('MINE\n');
    expect([sj, st].map(snap)).toEqual(before.src);
    expect(tree(DST()).filter((f) => f.split('/').pop()!.startsWith('.ccd-carry-')), 'a temp left behind').toEqual([]);
    expect(fs.existsSync(DST('workflows/wf_1.json')), 'the record that fit was not placed').toBe(true);
    expect(tree(DST())).toEqual(['subagents/workflows/wf_1/journal.jsonl', 'tool-results/only-here.txt', 'workflows/wf_1.json']);
    expect(verdict()).toBe('(merged +1 ~0 !0, deferred 2)');
  });

  it('prices a journal extend at its compare PLUS the copy of the whole source, to the byte', () => {
    // Compare the shorter side twice (2 x 2), then copy the 6-byte source: 10.
    // The copy term unpriced, 9 bytes would fit it and 10 are the true cost.
    put(SRC('subagents/workflows/wf_1/journal.jsonl'), 'A\nB\nC\n', T0 + 60);
    const d = put(DST('subagents/workflows/wf_1/journal.jsonl'), 'A\n');
    carry('CARRY_MERGE_BUDGET=9;');
    expect(read(d), 'an extend priced under its true cost was placed').toBe('A\n');
    carry('CARRY_MERGE_BUDGET=10;');
    expect(read(d)).toBe('A\nB\nC\n');
    expect(verdicts()).toEqual(['(kept: budget)', '(merged +0 ~1 !0)']);
  });

  it('prices a different-size record replace at the bytes it copies, to the byte', () => {
    // No compare is read (the sizes already differ), so the whole price is the
    // 21-byte copy; unpriced, a 20-byte budget would take it.
    put(SRC('workflows/wf_1.json'), '{"state":"completed"}', T0 + 60);
    const d = put(DST('workflows/wf_1.json'), '{"s":"r"}');
    carry('CARRY_MERGE_BUDGET=20;');
    expect(read(d), 'a record replace priced under its true cost was placed').toBe('{"s":"r"}');
    carry('CARRY_MERGE_BUDGET=21;');
    expect(read(d)).toBe('{"state":"completed"}');
    expect(verdicts()).toEqual(['(kept: budget)', '(merged +0 ~1 !0)']);
  });

  it('prices the copy a same-size record replace makes, not only its compare', () => {
    // 12 bytes each side: the compare reads 24, the newer record is then
    // copied — 12 more. Priced at 36 on its own, it cannot fit a budget of 24.
    put(SRC('workflows/wf_1.json'), '{"s":"done"}', T0 + 60);
    const d = put(DST('workflows/wf_1.json'), '{"s":"runn"}');
    carry('CARRY_MERGE_BUDGET=24;');
    expect(verdict()).toBe('(kept: budget)');
    expect(read(d)).toBe('{"s":"runn"}');
  });
});

describe('bounded: a busy slot falls back to (kept), and nothing waits', () => {
  it('a busy slot falls back to (kept: busy) at once, touches nothing, and never waits', () => {
    // A carry that WAITED on the slot would deadlock against the lock this
    // same snippet holds, and `h.sh` has no timeout, so the suite would hang
    // instead of failing. The bound is local to this case: the carry runs in
    // a background subshell, is polled for ~10 s, and is killed if it is still
    // there, which turns the hang into the `HUNG` assertion below. It does not
    // inherit fd 7 (`7>&-`): it is "another carry", and a killed carry that
    // held the slot's descriptor would leave a `flock` waiting on itself.
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    const out = h.sh(`${HOLD_SLOT}
      ( _swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} >/dev/null 2>&1 ) 7>&- & pid=$!
      for ((i = 0; i < 100; i++)); do kill -0 $pid 2>/dev/null || break; sleep 0.1; done
      if kill -0 $pid 2>/dev/null; then echo HUNG; kill -9 $pid 2>/dev/null; fi
      wait $pid 2>/dev/null; echo "[rc=$?]"`);
    expect(out).not.toContain('HOLD-FAILED');
    expect(out, 'the carry WAITED on a contended slot').not.toContain('HUNG');
    expect(verdict()).toBe('(kept: busy)');
    expect(fs.existsSync(DST('tool-results/new.txt'))).toBe(false);
  });

  it('a first carry takes no slot — today\'s path, unchanged, even while the slot is held', () => {
    put(SRC('tool-results/r.txt'), 'R\n');
    carry(HOLD_SLOT);
    expect(verdict()).toMatch(/^\((link|copy)\)$/);
    expect(read(DST('tool-results/r.txt'))).toBe('R\n');
  });

  it('releases the slot on the way out, and never unlinks the lock file', () => {
    put(SRC('tool-results/r.txt'), 'R\n');
    fs.mkdirSync(DST(), { recursive: true });
    const out = h.sh(`_swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} 2>/dev/null
      exec 7>>"$REG/.carry.lock"; flock -n 7 && echo SLOT-FREE || echo SLOT-HELD`);
    expect(out).toContain('SLOT-FREE');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.carry.lock'))).toBe(true);
  });

  it('takes the slot once for a carry with two existing destinations — the second sidecar neither contends with the first nor logs (kept: busy)', () => {
    // `_sidecar_matches` answers one sidecar per project dir. A second
    // `flock -n` on a NEW open file description conflicts with the lock this
    // same shell already holds (flock(2) treats two open()s as two holders),
    // so a carry that re-took the slot per sidecar would contend with itself.
    const OTHER = '-w-other-project';
    const at = (cfg: string, rel: string): string => path.join(h.home, cfg, 'projects', OTHER, UUID, rel);
    put(SRC('tool-results/a.txt'), 'A\n');
    fs.mkdirSync(DST(), { recursive: true });
    put(at('.claude', 'tool-results/b.txt'), 'B\n');
    fs.mkdirSync(at('.claude-d', ''), { recursive: true });
    carry();
    const rows = swapLog().split('\n').filter((l) => l.includes(` sidecar ${UUID} -> `)).map((l) => l.replace(/^.* sidecar \S+ -> /, ''));
    expect(rows, swapLog()).toEqual([`${at('.claude-d', '').replace(/\/$/, '')} (merged +1 ~0 !0)`, `${DST()} (merged +1 ~0 !0)`]);
    expect(swapLog()).not.toContain('(kept');
    expect(read(at('.claude-d', 'tool-results/b.txt'))).toBe('B\n');
    expect(read(DST('tool-results/a.txt'))).toBe('A\n');
  });

  it('a destination that is a symlink is not walked into: (kept: error)', () => {
    put(SRC('tool-results/r.txt'), 'R\n');
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.dirname(DST()), { recursive: true });
    fs.symlinkSync(elsewhere, DST());
    carry();
    expect(verdict()).toBe('(kept: error)');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('a slot whose lock file cannot be opened is (kept: error), never (kept: busy)', () => {
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.carry.lock'), { recursive: true });
    carry();
    expect(verdict()).toBe('(kept: error)');
    expect(fs.existsSync(DST('tool-results/new.txt'))).toBe(false);
  });

  it('a lock flock refuses for any reason but contention is (kept: error), never (kept: busy)', () => {
    // util-linux flock exits 1 only on a conflict; ENOLCK, EBADF and their
    // kin exit a sysexits code (71, 65). Shadowed by a function in the
    // snippet's own shell, so no binary on the box is touched.
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    carry('flock() { echo "flock: No locks available" >&2; return 71; };');
    expect(verdict()).toBe('(kept: error)');
    expect(fs.existsSync(DST('tool-results/new.txt'))).toBe(false);
  });
});

describe('a walk that cannot finish is (kept: error), and the carry still answers rc 0', () => {
  // Spec §5.1 names five causes. The symlinked destination, the unopenable
  // lock and a non-conflict flock exit are pinned above; these are the other
  // two. The walker is replaced by a function in the snippet's own shell (the
  // flock case's idiom), so the bash arm is what is measured.
  it('a walker that exits with a failure code is (kept: error), though it printed a summary row', () => {
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    const out = carry('_swap_carry_merge_walk() { echo "merged 1 0 0 0"; return 1; };');
    expect(out).toContain('[rc=0]');
    expect(verdict()).toBe('(kept: error)');
  });

  // `mapfile -t rows <<< "$wout"` is the one place the carry reads the walker's
  // rows back. bash spills a here-string of 64 KiB or more to a temp file, and
  // when that cannot be created `mapfile` never runs and `rows` is left as it
  // was. These two cases stand in for that with a `mapfile` that leaves `rows`
  // alone. Named cost: the temp's own failure is not exercised — bash falls
  // back from an unusable TMPDIR to /tmp, /var/tmp, /usr/tmp, so only a
  // failure AFTER its writability check (a full disk, a quota, no free
  // descriptor) reaches it, and none of those can be made in a fixture without
  // starving the carry's own pipes and slot descriptor.
  const MAPFILE_ROWS_FAILS = (after: number): string =>
    `_mf=0; mapfile() { if [[ "$2" == rows ]] && (( ++_mf > ${after} )); then return 1; fi; builtin mapfile "$@"; };`;

  it('rows that were never read back (an empty array) are (kept: error), and the carry still answers rc 0', () => {
    // Under ccd's `set -u` the old last-row read of an empty array killed the
    // shell after the unit was stopped and before it was restarted.
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    const out = carry(MAPFILE_ROWS_FAILS(0));
    expect(out, 'the carry did not answer').toContain('[rc=0]');
    expect(verdict()).toBe('(kept: error)');
  });

  it('the budget arm reads its row behind the same guard: rc 3 with no rows read back is (kept: budget), and the carry answers rc 0', () => {
    // The `wrc == 3` arm quotes the walker's first row in its message; an
    // unguarded `rows[0]` of an empty array died under `set -u` too.
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    const out = carry(`${MAPFILE_ROWS_FAILS(0)} _swap_carry_merge_walk() { echo "budget 99"; return 3; };`);
    expect(out, 'the carry did not answer').toContain('[rc=0]');
    expect(verdict()).toBe('(kept: budget)');
  });

  it('rows left over from the previous sidecar are not read as this one\'s verdict', () => {
    // The second sidecar's read-back fails; the first one's `merged` row must
    // not be logged for it.
    const OTHER = '-w-other-project';
    put(SRC('tool-results/a.txt'), 'A\n');
    fs.mkdirSync(DST(), { recursive: true });
    const b = path.join(h.home, '.claude', 'projects', OTHER, UUID, 'tool-results', 'b.txt');
    put(b, 'B\n');
    fs.mkdirSync(path.join(h.home, '.claude-d', 'projects', OTHER, UUID), { recursive: true });
    const out = carry(MAPFILE_ROWS_FAILS(1));
    expect(out).toContain('[rc=0]');
    const rows = swapLog().split('\n').filter((l) => l.includes(` sidecar ${UUID} -> `)).map((l) => l.replace(/^.* \(/, '('));
    expect(rows, swapLog()).toEqual(['(merged +1 ~0 !0)', '(kept: error)']);
  });

  it('a walker that exits 0 but prints no readable summary row is (kept: error)', () => {
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    for (const body of ['echo "merged oops"', 'echo "diverged a longer b"', ':']) {
      carry(`_swap_carry_merge_walk() { ${body}; return 0; };`);
    }
    expect(verdicts()).toEqual(['(kept: error)', '(kept: error)', '(kept: error)']);
  });

  it.skipIf(process.getuid?.() === 0)('a real walk that dies part way leaves every file it placed whole and is (kept: error)', () => {
    // `a.txt` is the newer action and is placed first; `b.txt`'s compare then
    // cannot open the unreadable source, and the walk ends in a traceback.
    put(SRC('tool-results/a.txt'), 'A\n', T0 + 100);
    const b = put(SRC('tool-results/b.txt'), 'SRC\n', T0 + 50);
    put(DST('tool-results/b.txt'), 'DST\n', T0);
    fs.chmodSync(b, 0o000);
    try {
      carry();
    } finally {
      fs.chmodSync(b, 0o644);
    }
    expect(verdict()).toBe('(kept: error)');
    expect(read(DST('tool-results/a.txt'))).toBe('A\n');
    expect(read(DST('tool-results/b.txt'))).toBe('DST\n');
  });

  it('no python3 is (kept: error), and nothing is placed', () => {
    // `command -v python3` is shadowed by a function in the snippet's shell, so
    // the clause is read as ccd reads it without touching PATH. Named cost: a
    // real absence of the binary is not exercised, only the clause's reading.
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    carry('command() { if [[ "$1" == -v && "$2" == python3 ]]; then return 1; fi; builtin command "$@"; };');
    expect(verdict()).toBe('(kept: error)');
    expect(fs.existsSync(DST('tool-results/new.txt'))).toBe(false);
  });
});
