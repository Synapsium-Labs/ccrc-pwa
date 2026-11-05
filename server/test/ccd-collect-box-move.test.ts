// THE COLLECTOR AFTER A BOX MOVE (cleanup un-wedge, Task R4; spec §6.1, decision D12 as the operator ruled it). A
// witness records the device, inode and birth time of the temp root ccd made. A box move copies the root to the same
// path with a new identity, so the collector refused it `witness-mismatch` for good: no directory on the new box can
// ever match. `_ws_collect_moved_host` is the collector's twin of the rows rung's box-move release (#1799): the leaf
// is collectable BY PATH only when
//   M1  the witness carries a birth time and a real device (major not 0);
//   M2  no line of this host's mount table carries that device (`_ws_collect_mountinfo`, the rows rung's `D`
//       parser); an unreadable or empty table is unmeasured;
//   M3  the leaf is a real directory at `~/.cc-tmp/<id>`, owned by this user;
//   M4  the leaf is on the device of the physical `~/.cc-tmp`, so it is no mount;
//   M5  the leaf's birth time is readable and not earlier than the witnessed one;
//   M6  every later rung runs unchanged.
// Its token is `mode=collect-moved`, binding the witness AND the leaf's own identity (and the walk, as today's), so
// the verb's in-lock recomputation reaches the same release or refuses. The witness is never written; the quarantine
// record the verb already writes carries the leaf's identity (`leaf=`), and every physical proof reads it, while the
// witness's compare-and-drop still compares the witness's own fields. Darwin asks no table: `witness-mismatch` there.
//
// MOUNTS ARE FAKED, NEVER MADE: the table is a copy of this host's at `$HOME/mountinfo`, through the one seam. The
// box move is the WITNESS rewritten to name a device this host does not have. FIXTURE HOME ONLY: every ccd call runs
// sourced in the harness's HOME, never against the live one. Linux only, as the collector itself.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { holdCwd } from './wsExpireFixture.js';
import {
  COL_ID, MOUNTS_SEAM, collectAudit, collectVerb, crashAt, docOf, leafOf, makeOrphan, quarantineOf, records,
  recordsDir, realMounts, slots, witnessOf, type Orphan, type Run,
} from './wsCollectFixture.js';

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;

let h: PrHarness;
let stops: (() => void)[] = [];
beforeEach(() => { h = makePrHarness('ccrc-collect-box-move-'); stops = []; });
afterEach(() => {
  for (const s of stops.reverse()) { try { s(); } catch { /* gone */ } }
  h.cleanup();
});

/** Linux's `makedev`: the decimal `st_dev` a witness spells for `major:minor`. */
const makedev = (major: number, minor: number): bigint =>
  BigInt(minor & 0xff) | (BigInt(major & 0xfff) << 8n) | (BigInt(minor & ~0xff) << 12n) | (BigInt(major & ~0xfff) << 32n);
/** A real major no fixture table lists unless a case adds it: the box this root was copied from. */
const GONE_MAJ = 4093;
const GONE_MIN = 7;
const GONE_DEV = String(makedev(GONE_MAJ, GONE_MIN));
const tableOf = (): string => path.join(h.home, 'mountinfo');
/** A mount of `majmin` far from every fixture path. */
const lineOf = (majmin: string): string => `9997 1 ${majmin} / /box-move-nowhere rw,relatime - ext4 /dev/bm rw`;

/** Rewrites the witness as a copied box leaves it: the old host's device and inode, `bt` its birth time (default
 *  unchanged). The witness keeps its one writer in production; only the test edits it, by hand. */
const moveBox = (o: { dev?: string; ino?: string; btime?: (bt: bigint) => bigint } = {}): void => {
  const w = fs.readFileSync(witnessOf(h), 'utf8');
  let next = w.replace(/ dev=\d+ /, ` dev=${o.dev ?? GONE_DEV} `).replace(/ ino=\d+ /, ` ino=${o.ino ?? '424242'} `);
  if (o.btime) next = next.replace(/ btime=(\d+) /, (_m, b: string) => ` btime=${o.btime!(BigInt(b))} `);
  expect(next, 'the CONTROL: the witness was rewritten').not.toBe(w);
  fs.writeFileSync(witnessOf(h), next);
};
/** The orphan, its box moved, and the copied host table at the seam (which lists no `GONE_DEV`). */
const moved = (o: Parameters<typeof moveBox>[0] = {}): Orphan => {
  const orphan = makeOrphan(h);
  realMounts(h);
  expect(fs.readFileSync(tableOf(), 'utf8').split('\n').some((l) => l.split(' ')[2] === `${GONE_MAJ}:${GONE_MIN}`),
    'the CONTROL: this host mounts no device of the gone box').toBe(false);
  moveBox(o);
  return orphan;
};

type Doc = Record<string, unknown>;
const auditDoc = (r: Run): Doc => JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as Doc;
const verdict = (r: Run): string => String(auditDoc(r)['verdict']);
const detail = (r: Run): string => String(auditDoc(r)['detail']);
const collectOf = (r: Run): Doc => (auditDoc(r)['collect'] ?? {}) as Doc;
const audit = (pre = ''): Run => collectAudit(h, { pre: `${MOUNTS_SEAM} ${pre}` });
const expectMismatch = (r: Run): void => {
  expect(verdict(r), `${r.stdout}${r.stderr}`).toBe('witness-mismatch');
  expect(auditDoc(r)['witness']).toBeUndefined();
  expect(auditDoc(r)['token']).toBeUndefined();
};
const expectUnmeasured = (r: Run, probe: string, why: string): void => {
  expect(r.code, r.stderr).toBe(1);
  expect(verdict(r), r.stdout).toBe('unmeasured');
  expect(collectOf(r)['unmeasured']).toBe(probe);
  expect(detail(r)).toContain(why);
  expect(auditDoc(r)['token']).toBeUndefined();
};
/** The walk's answer, fixed, so a case changes the leaf's identity and nothing the walk reads. */
const FIXED_WALK = `_ws_collect_idle() { _WS_IDLE_NEWEST_NS=${(BigInt(Math.floor(Date.now() / 1000)) - 172_800n) * 1_000_000_000n};`
  + ' _WS_IDLE_COUNT=3; _WS_IDLE_WHY=\'\'; _WS_IDLE_DETAIL=\'\'; _WS_IDLE_LEAF="$1"; return 0; };';

describe.runIf(LINUX)('the release: a witness whose device this host does not mount, over a real directory at the id', () => {
  it('the CONTROL: the same leaf with its own witness is collectable as today, with no `witness` key', () => {
    makeOrphan(h);
    realMounts(h);
    const r = audit();
    expect(verdict(r), r.stdout).toBe('collectable');
    expect(auditDoc(r)['witness']).toBeUndefined();
  }, 60_000);

  it('a witness whose device this host does not mount, over a real directory at the id, is collectable', () => {
    moved();
    const r = audit();
    expect(r.code, r.stderr).toBe(0);
    expect(verdict(r), r.stdout).toBe('collectable');
    expect(auditDoc(r)['witness']).toBe('moved-host');
    expect(String(auditDoc(r)['token'])).toMatch(/^[0-9a-f]{64}$/);
    expect(eventsOf(h.home, 'collect'), 'collectable journals nothing').toEqual([]);
  }, 60_000);

  it('the token names collect-moved, and the verb’s in-lock recomputation reaches the same token', () => {
    const o = moved();
    const r = audit();
    const doc = auditDoc(r);
    const c = collectOf(r);
    const w = c['witness'] as Record<string, string>;
    const st = fs.lstatSync(o.leaf, { bigint: true });
    const want = h.sh(`_ws_reclaim_fingerprint mode=collect-moved id=${COL_ID} dev=${w['dev']} ino=${w['ino']}`
      + ` btime=${w['btime']} run=${w['run']} at=${w['at']} leafdev=${st.dev} leafino=${st.ino}`
      + ` leafbtime=${st.birthtimeNs / 1_000_000_000n} newestCtimeNs=${String(c['newestCtimeNs'])} entries=${String(c['entries'])}`);
    expect(doc['token']).toBe(want);
    const v = collectVerb(h, String(doc['token']), { pre: MOUNTS_SEAM });
    expect(v.code, `${v.stdout}${v.stderr}`).toBe(0);
    const out = docOf(v.stdout);
    expect(out['collected']).toBe(COL_ID);
    expect(out['witness'], 'the compare-and-drop compared the WITNESS’s own fields').toBe('dropped');
    expect(fs.existsSync(leafOf(h))).toBe(false);
    expect(fs.existsSync(witnessOf(h))).toBe(false);
    expect(records(h)).toEqual([]);
    expect(slots(h)).toEqual([]);
    const done = eventsOf(h.home, 'collect').filter((e) => e['outcome'] === 'done');
    expect(done).toHaveLength(1);
    expect((done[0]!['meas'] as Record<string, unknown>)['witness']).toBe('moved-host');
  }, 90_000);

  it('a leaf changed between the audit and the verb refuses with the new identity: nothing moved', () => {
    const o = moved();
    const token = String(auditDoc(audit(FIXED_WALK))['token']);
    // Another directory at the id, born after the witness, on the same device: the release holds for it too, so only
    // the leaf's identity in the token tells the two apart (the walk is fixed).
    fs.renameSync(o.leaf, path.join(h.home, 'aside'));
    fs.mkdirSync(o.leaf, { mode: 0o700 });
    const ino = String(fs.lstatSync(o.leaf, { bigint: true }).ino);
    expect(verdict(audit(FIXED_WALK)), 'the CONTROL: the new directory is released too').toBe('collectable');
    const v = collectVerb(h, token, { pre: `${MOUNTS_SEAM} ${FIXED_WALK}` });
    expect(docOf(v.stdout)['refused'], `${v.stdout}${v.stderr}`).toBe('state-changed');
    expect(String(fs.lstatSync(o.leaf, { bigint: true }).ino)).toBe(ino);
    expect(fs.existsSync(path.join(h.home, 'aside', 'scratch.txt'))).toBe(true);
    expect(records(h)).toEqual([]);
    expect(fs.existsSync(witnessOf(h))).toBe(true);
  }, 90_000);
});

describe.runIf(LINUX)('the release holds: each condition kept, or unmeasured, never released', () => {
  it('a witness device this host mounts keeps witness-mismatch (a copy within one file system)', () => {
    moved();
    fs.appendFileSync(tableOf(), `${lineOf(`${GONE_MAJ}:${GONE_MIN}`)}\n`);
    expectMismatch(audit());
  }, 60_000);

  it('a witness device of major 0 keeps witness-mismatch', () => {
    moved({ dev: String(makedev(0, 77)) });
    expectMismatch(audit());
  }, 60_000);

  it.each([
    ['empty', (): void => { fs.writeFileSync(tableOf(), ''); }, 'empty'],
    ['absent', (): void => { fs.rmSync(tableOf()); }, 'unreadable'],
    ['malformed', (): void => { fs.appendFileSync(tableOf(), 'not a mount line\n'); }, 'malformed'],
  ])('an %s mount table is unmeasured, never released', (_label, spoil, word) => {
    moved();
    spoil();
    const r = audit();
    expectUnmeasured(r, 'identity', `(${word})`);
    expect(eventsOf(h.home, 'collect')).toEqual([]);
  }, 60_000);

  it('a mount table the seam names as empty is unmeasured', () => {
    moved();
    expectUnmeasured(audit('_ws_collect_mountinfo() { :; };'), 'identity', 'names no mount table');
  }, 60_000);

  it('a leaf on another device than the physical temp root keeps witness-mismatch', () => {
    // The leaf's device as `_plat_devino` reads it, and only the leaf's: a mount at the leaf. The physical
    // `~/.cc-tmp` is read unchanged, so M4 compares the two.
    moved();
    const seam = 'eval "_orig_devino() $(declare -f _plat_devino | tail -n +2)";'
      + ` _plat_devino() { if [[ "$1" == */${COL_ID} ]]; then local v; v=$(_orig_devino "$1") || return 1;`
      + ' echo "99999:${v#*:}"; else _orig_devino "$@"; fi; };';
    const r = audit(seam);
    expectMismatch(r);
    expect(detail(r)).toContain('not on the device of');
  }, 60_000);

  it('a leaf born before the witnessed birth keeps witness-mismatch', () => {
    moved({ btime: (bt) => bt + 1000n });
    const r = audit();
    expectMismatch(r);
    expect(detail(r)).toContain('born before');
  }, 60_000);

  it('a leaf whose birth time cannot be read is unmeasured', () => {
    moved();
    const seam = 'eval "_orig_btime() $(declare -f _plat_btime | tail -n +2)";'
      + ` _plat_btime() { if [[ "$1" == */${COL_ID} ]]; then return 1; fi; _orig_btime "$@"; };`;
    expectUnmeasured(audit(seam), 'identity', 'could not be read');
  }, 60_000);

  it('a link at the id keeps witness-mismatch', () => {
    const o = moved();
    const real = path.join(h.home, 'real');
    fs.renameSync(o.leaf, real);
    fs.symlinkSync(real, o.leaf);
    expectMismatch(audit());
    expect(fs.existsSync(path.join(real, 'scratch.txt'))).toBe(true);
  }, 60_000);

  it('a file at the id keeps witness-mismatch', () => {
    const o = moved();
    fs.rmSync(o.leaf, { recursive: true });
    fs.writeFileSync(o.leaf, 'a file');
    expectMismatch(audit());
  }, 60_000);

  it.runIf(ROOT)('another user’s directory at the id keeps witness-mismatch', () => {
    const o = moved();
    fs.chownSync(o.leaf, 65534, 65534);
    expectMismatch(audit());
  }, 60_000);

  it('on Darwin the release is never asked: the table is never read, and the answer is rc 1', () => {
    moved();
    const r = h.run(`${MOUNTS_SEAM} _ws_collect_mountinfo() { : > "$HOME/table-asked"; printf '%s' "$HOME/mountinfo"; };`
      + ` _ws_tmproot_witness_read ${COL_ID} >/dev/null; CCD_OS=darwin; _ws_collect_moved_host ${COL_ID} '${leafOf(h)}';`
      + ' echo "rc=$?"');
    expect(r.stdout.trim()).toBe('rc=1');
    expect(fs.existsSync(path.join(h.home, 'table-asked'))).toBe(false);
    const linux = h.run(`${MOUNTS_SEAM} _ws_tmproot_witness_read ${COL_ID} >/dev/null;`
      + ` _ws_collect_moved_host ${COL_ID} '${leafOf(h)}'; echo "rc=$?"`);
    expect(linux.stdout.trim(), 'the CONTROL: on Linux the same leaf is released').toBe('rc=0');
  }, 60_000);
});

describe.runIf(LINUX)('every later rung still runs on a released leaf', () => {
  it('a fresh ctime answers changed-recently', () => {
    moved();
    const r = collectAudit(h, { pre: MOUNTS_SEAM, floor: false });
    expect(verdict(r), r.stdout).toBe('changed-recently');
  }, 60_000);

  it('a user of the leaf answers in-use', () => {
    const o = moved();
    const p = holdCwd(o.leaf);
    stops.push(p.stop);
    const r = audit();
    expect(verdict(r), r.stdout).toBe('in-use');
  }, 60_000);

  it('a checkout inside it answers containment-unproven', () => {
    const o = moved();
    fs.mkdirSync(path.join(o.leaf, 'wt'));
    fs.writeFileSync(path.join(o.leaf, 'wt', '.git'), `gitdir: ${path.join(h.home, 'gone', '.git', 'worktrees', 'wt')}\n`);
    const r = audit();
    expect(verdict(r), r.stdout).toBe('containment-unproven');
  }, 60_000);
});

describe.runIf(LINUX)('a crash inside a released collection: the record names the leaf, and the resume completes or keeps', () => {
  /** The record a released collection writes: today's line, and the leaf's own identity after it. */
  const recordBody = (): string => fs.readFileSync(path.join(recordsDir(h), records(h)[0]!), 'utf8');

  it.each(['recorded', 'slotted', 'moved'])('a crash at `%s`: the record carries leaf=, and the next audit and verb finish it', (point) => {
    const o = moved();
    const st = fs.lstatSync(o.leaf, { bigint: true });
    const token = String(auditDoc(audit())['token']);
    const c = collectVerb(h, token, { pre: `${MOUNTS_SEAM} ${crashAt(point)}` });
    expect(c.code, `${c.stdout}${c.stderr}`).toBe(137);
    expect(recordBody()).toMatch(new RegExp(` leaf=${st.dev}:${st.ino}:${st.birthtimeNs / 1_000_000_000n}\\n$`));
    const r = audit();
    expect(verdict(r), r.stdout).toBe('collectable');
    expect(auditDoc(r)['witness'], 'the resume reads the record’s leaf=').toBe('moved-host');
    let v = collectVerb(h, String(auditDoc(r)['token']), { pre: MOUNTS_SEAM });
    if (point !== 'moved') {
      // Before the move the leaf never left: the resume clears the slot and the record, keeps the witness, and the
      // leaf is audited afresh, where the release is asked again.
      expect(docOf(v.stdout)['refused'], `${v.stdout}${v.stderr}`).toBe('state-changed');
      expect(records(h)).toEqual([]);
      const again = audit();
      expect(verdict(again), again.stdout).toBe('collectable');
      v = collectVerb(h, String(auditDoc(again)['token']), { pre: MOUNTS_SEAM });
    }
    expect(v.code, `${v.stdout}${v.stderr}`).toBe(0);
    expect(docOf(v.stdout)['collected']).toBe(COL_ID);
    expect(docOf(v.stdout)['witness']).toBe('dropped');
    expect(fs.existsSync(o.leaf)).toBe(false);
    expect(records(h)).toEqual([]);
    expect(slots(h)).toEqual([]);
  }, 120_000);

  it('a crash after the move, then another directory in the slot: kept for the operator, never removed', () => {
    moved();
    const token = String(auditDoc(audit())['token']);
    expect(collectVerb(h, token, { pre: `${MOUNTS_SEAM} ${crashAt('moved')}` }).code).toBe(137);
    const slot = path.join(quarantineOf(h), slots(h)[0]!);
    fs.renameSync(path.join(slot, 'leaf'), path.join(h.home, 'the-moved-leaf'));
    fs.mkdirSync(path.join(slot, 'leaf'));
    fs.writeFileSync(path.join(slot, 'leaf', 'decoy.txt'), 'not the collected tree');
    const r = audit();
    expect(verdict(r), r.stdout).toBe('quarantine-kept');
    expect(fs.existsSync(path.join(slot, 'leaf', 'decoy.txt'))).toBe(true);
    expect(fs.existsSync(path.join(h.home, 'the-moved-leaf', 'scratch.txt'))).toBe(true);
  }, 120_000);
});
