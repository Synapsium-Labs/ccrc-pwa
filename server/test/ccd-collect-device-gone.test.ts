// A RECORDED DEVICE THAT IS GONE FROM THIS BOX (D-8948). The collector believes an ABSENCE
// only on the device its witness or its quarantine record carries (`_ws_collect_root_dev`): an unmounted volume's
// empty mount point must never read as "the leaf is gone". A box that was moved, or restored onto other storage, keeps
// records that name a device it will never have again, and that refusal (unmeasured `device`) then never healed.
//
// THE RELEASE: when the recorded device is PROVEN gone from this box, the collector starts over for that id.
// `_ws_collect_dev_gone` is the one owner of "gone", and it answers three ways:
//   0  gone: the mount table has no line for the device (the identity walk's `D` request, through the one seam
//      `_ws_collect_mountinfo`), the block-device listing (`_ws_collect_sysblock`) shows a device this box certainly has
//      (the CONTROL: the device the temp area stands on, or, that being of major 0, any block device), and it shows no
//      entry for the recorded device;
//   1  still here, or never provable: mounted, attached as a block device (mounted or not), of major 0, no number, or
//      a box that keeps no mount table (Darwin). The answer stays unmeasured `device`, with the reason appended;
//   2  unmeasured: the table or the listing could not be read. Never "gone": unmeasured `identity`, retried.
// What "gone" licenses is small. A witness whose leaf is PROVEN absent is compared and dropped (nothing is deleted). A
// quarantine record with an empty slot takes the phase `restart`: the empty slot and the record are cleared, the
// witness is KEPT, the verb answers `state-changed`, and the id is audited afresh. A directory that stands at the
// path is then taken only by the fresh rungs, every one of them, on its own identity (the box-move release,
// `ccd-collect-box-move.test.ts`). Nothing is removed on the strength of the old record.
// The token binds the release: `on=<the temp area's device now>` is added on the gone path only, so a same-device
// token is byte for byte what it was, and the verb's recomputation in the lock reaches the same release or refuses.
//
// NOTHING IS MOUNTED AND NO DEVICE IS MADE. The mount table is a copy of this host's at `$HOME/mountinfo`, the block
// listing is a directory of links at `$HOME/sysblock`, each through its seam, and the move is a witness or a record
// rewritten to name a device this host does not have. FIXTURE HOME ONLY (`makePrHarness`): every ccd call runs sourced
// in the harness's HOME, never against the live one. The end-to-end cases are Linux only, as the collector is; the
// evaluation's own cases (`_ws_collect_fork`, the owner answered by a stub) and the owner's (the mount table answered
// by a stub) run on every platform.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, readJournal } from './lifecycleHelpers.js';
import { holdCwd } from './wsExpireFixture.js';
import {
  COL_ID, PAUSE, type Identity, type RecordFields, identityOf, leafOf, makeOrphan, plantRecord, quarantineOf, recName,
  recordFor, recordLine, recordsDir, witnessOf,
} from './collectFixture.js';
import {
  IDLE_FLOOR_SEAM, MOUNTS_SEAM, SYSBLOCK_SEAM, blockListing, controlEntry, docOf, gapAt, majMin, makedev, realMounts,
  type Run,
} from './wsCollectFixture.js';

const LINUX = process.platform === 'linux';
const ROOT_USER = process.getuid?.() === 0;

let h: PrHarness;
let stops: (() => void)[] = [];
/** Modes a case set, restored before cleanup. */
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-collect-device-gone-'); stops = []; restore = []; });
afterEach(() => {
  for (const s of stops.reverse()) { try { s(); } catch { /* gone */ } }
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});

/** A real major and minor no fixture table or listing names unless a case adds it: the box these records came from. */
const GONE_MAJ = 4093;
const GONE_MIN = 7;
const GONE_MM = `${GONE_MAJ}:${GONE_MIN}`;
const GONE_DEV = String(makedev(GONE_MAJ, GONE_MIN));
const GONE_INO = '424242';
const tableOf = (): string => path.join(h.home, 'mountinfo');
const listingOf = (): string => path.join(h.home, 'sysblock');
/** A mount of `majmin` far from every fixture path. */
const lineOf = (majmin: string): string => `9997 1 ${majmin} / /device-gone-nowhere rw,relatime - ext4 /dev/dg rw`;
const areaOf = (): string => fs.realpathSync(path.join(h.home, '.cc-tmp'));
/** The device the temp area stands on now, as ccd reads it. */
const areaDev = (): string => String(fs.statSync(areaOf(), { bigint: true }).dev);
const q = (s: string): string => `'${s}'`;
/** `_ws_reclaim_fingerprint` over `kv`, the one encoding every token is. */
const fingerprint = (...kv: string[]): string => h.sh(`_ws_reclaim_fingerprint ${kv.map(q).join(' ')}`);
const witnessFields = (): Record<string, string> =>
  Object.fromEntries(fs.readFileSync(witnessOf(h), 'utf8').trim().split(' ').map((kv) => kv.split('=') as [string, string]));
/** The witness rewritten to name `dev` (and, for a copied box, another inode). The witness keeps its one writer in
 *  production; only the test edits it, by hand. Returns the new bytes. */
const rewriteWitness = (dev: string, ino?: string): string => {
  const w = fs.readFileSync(witnessOf(h), 'utf8');
  let next = w.replace(/ dev=\d+ /, ` dev=${dev} `);
  if (ino !== undefined) next = next.replace(/ ino=\d+ /, ` ino=${ino} `);
  expect(next, 'the CONTROL: the witness was rewritten').not.toBe(w);
  fs.writeFileSync(witnessOf(h), next);
  return next;
};
const slotOf = (): string => path.join(quarantineOf(h), `slot.${recName()}`);
/** The record's slot, standing EMPTY, as a copied box carries it: the restart's own condition (below). */
const plantSlot = (): void => {
  fs.mkdirSync(slotOf(), { recursive: true, mode: 0o700 });
  fs.chmodSync(quarantineOf(h), 0o700);
};
const recordPath = (): string => path.join(recordsDir(h), recName());
const records = (): string[] => (fs.existsSync(recordsDir(h)) ? fs.readdirSync(recordsDir(h)).sort() : []);
const plantOwn = (ident: Identity, over: Partial<RecordFields> = {}): string =>
  plantRecord(h, recName(), recordLine({ ...recordFor(ident), ...over }));
/** Every file under `dir` with its bytes, and every directory, sorted: what "byte for byte intact" compares. */
const treeOf = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { out.push(`${path.relative(dir, p)}/`); walk(p); }
      else out.push(`${path.relative(dir, p)}=${fs.readFileSync(p, 'utf8')}`);
    }
  };
  walk(dir);
  return out;
};

// ── the evaluation, asked directly (every platform) ─────────────────────────────────────────────────────────────
interface Fork { verdict: string; token: string; detail: string; phase: string; probe: string; gone: string }
/** `_ws_collect_fork`'s own answer, read off the globals it sets. The reap lock's FILE stands, as the registry's
 *  listing control needs; nothing here contends for it, so it is not flocked. */
const forkOf = (pre = ''): Fork => {
  const out = h.sh(`${pre} : >> "$REG/.reap-${COL_ID}.lock";`
    + ` _t() { _ws_collect_fork ${COL_ID} >/dev/null; printf '%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN"`
    + ' "$REAP_DETAIL" "$_WS_COLLECT_PHASE" "$_WS_COLLECT_PROBE" "${_WS_COLLECT_DEVGONE-}"; }; _ws_reclaim_contained _t');
  const [verdict = '', token = '', detail = '', phase = '', probe = '', gone = ''] = out.split('\x1f');
  return { verdict, token, detail, phase, probe, gone };
};
/** The document `ws-audit --collect` prints for the evaluation's answer: `_ws_collect_fork`, then the audit's own
 *  printer (`_ws_collect_audit_doc`), as the audit runs them under the lock. */
const forkDoc = (pre = ''): Record<string, unknown> => {
  const r = h.run(`${pre} : >> "$REG/.reap-${COL_ID}.lock"; _t() { _ws_collect_reset; _WS_HELD_BY_RC='';`
    + ` _ws_collect_fork ${COL_ID} >/dev/null; _ws_collect_audit_doc ${COL_ID}; }; _ws_reclaim_contained _t`);
  return JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as Record<string, unknown>;
};
/** The owner, answered by a stub: `rc`, with `why`, logging what it was asked to `$HOME/owner-asked`. */
const ownerSays = (rc: 0 | 1 | 2, why = 'a stub said so'): string =>
  `_ws_collect_dev_gone() { printf '%s %s\\n' "$1" "$2" >> "$HOME/owner-asked"; _WS_DEVGONE_WHY='${why}'; return ${rc}; };`;
const ownerAsked = (): string[] => {
  const p = path.join(h.home, 'owner-asked');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
/** Today's device sentence, whole, as both arms have always printed it. */
const deviceSentence = (dev: string, what: string): string =>
  `${areaOf()} is on device ${areaDev()}, not on device ${dev} that ${what} carries — a mount point on another device is`
  + " never read as the leaf's absence: nothing is dropped, and the next pass asks again";
const absentToken = (extra: string[] = []): string => {
  const w = witnessFields();
  return fingerprint('mode=collect-absent', `id=${COL_ID}`, `dev=${w['dev']}`, `ino=${w['ino']}`, `btime=${w['btime']}`,
    `run=${w['run']}`, `at=${w['at']}`, ...extra);
};
const resumeToken = (r: RecordFields, phase: string, extra: string[] = []): string =>
  fingerprint('mode=collect-resume', `id=${COL_ID}`, `record=${recName()}`, `phase=${phase}`, `slot=${slotOf()}`,
    `dev=${r.dev}`, `ino=${r.ino}`, `btime=${r.btime}`, `run=${r.run}`, `at=${r.at}`, `pre=${r.token}`,
    `checkouts=${r.checkouts}`, ...extra);

describe('CHARACTERIZATION: what the same device answers, pinned before the release and unchanged by it', () => {
  it('a witness whose leaf is gone, on the device it carries: collectable, and the token is exactly these seven inputs', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    const f = forkOf();
    expect(f.verdict, f.detail).toBe('collectable');
    expect(f.token).toBe(absentToken());
    expect(f.gone, 'no release was asked for').toBe('');
  }, 60_000);

  it('a record whose slot is empty and whose path is empty, on the device it carries: `removed`, and the token is exactly these inputs', () => {
    const { leaf } = makeOrphan(h);
    const ident = identityOf(leaf);
    plantOwn(ident);
    fs.rmSync(leaf, { recursive: true });
    const f = forkOf();
    expect([f.verdict, f.phase], f.detail).toEqual(['collectable', 'removed']);
    expect(f.token).toBe(resumeToken(recordFor(ident), 'removed'));
  }, 60_000);

  it('a record whose slot is empty and whose path holds ANOTHER directory, on the device it carries: `removed` still', () => {
    // The same-device behaviour this change leaves alone: the order resumes from the slot's rmdir, and what stands at
    // the path is not the record's to speak of.
    const { leaf } = makeOrphan(h);
    const ident = identityOf(leaf);
    plantOwn(ident);
    fs.renameSync(leaf, path.join(h.home, 'aside'));
    fs.mkdirSync(leaf, { mode: 0o700 });
    const f = forkOf();
    expect([f.verdict, f.phase], f.detail).toEqual(['collectable', 'removed']);
    expect(f.token).toBe(resumeToken(recordFor(ident), 'removed'));
  }, 60_000);

  it.each([
    ['the witness', (): string => { const { leaf } = makeOrphan(h); fs.rmSync(leaf, { recursive: true }); rewriteWitness('1'); return `the witness of ${COL_ID}`; }],
    ['the record', (): string => {
      const { leaf } = makeOrphan(h);
      plantOwn(identityOf(leaf), { dev: '1' });
      fs.rmSync(leaf, { recursive: true });
      return `the quarantine record ${recName()}`;
    }],
  ])('%s names a device of major 0 that the temp area is not on: unmeasured `device`, in today’s sentence, and no token', (_label, arrange) => {
    const what = arrange();
    const f = forkOf();
    expect([f.verdict, f.probe], f.detail).toEqual(['unmeasured', 'device']);
    expect(f.detail.startsWith(deviceSentence('1', what)), f.detail).toBe(true);
    expect(f.token).toBe('');
    expect(f.phase, 'no phase is answered over an absence not believed').toBe('');
  }, 60_000);
});

describe('the decode: `_ws_collect_devmm` prints Linux’s major:minor of a decimal st_dev', () => {
  const TABLE: [number, number][] = [[8, 1], [259, 3], [GONE_MAJ, GONE_MIN], [8, 300], [253, 1_048_575], [5000, 70_000], [0, 77], [0, 0]];

  it.each(TABLE)('makedev(%i, %i) decodes to the same pair', (major, minor) => {
    expect(h.sh(`_ws_collect_devmm ${makedev(major, minor)}`)).toBe(`${major}:${minor}`);
    expect(majMin(makedev(major, minor)), 'the CONTROL: the fixture decodes as ccd does').toBe(`${major}:${minor}`);
  }, 60_000);

  it.runIf(LINUX)('it agrees with python’s os.major and os.minor on this host', () => {
    for (const [major, minor] of TABLE) {
      const dev = String(makedev(major, minor));
      const py = execFileSync('python3', ['-I', '-c', 'import os, sys\nd = int(sys.argv[1])\nprint("%d:%d" % (os.major(d), os.minor(d)))', dev],
        { encoding: 'utf8' }).trim();
      expect(h.sh(`_ws_collect_devmm ${dev}`), dev).toBe(py);
    }
  }, 60_000);

  it.each(['', 'x', '-1', '12 3', '1'.repeat(19)])('%j is no device number: rc 1, and nothing printed', (bad) => {
    expect(h.sh(`_ws_collect_devmm ${q(bad)}; echo "rc=$?"`)).toBe('rc=1');
  }, 60_000);
});

describe('the one owner of "gone", `_ws_collect_dev_gone`: three answers, never a fourth', () => {
  /** A device of major 8 for the temp area in these cases, so the control asks for one named entry. */
  const AREA = String(makedev(8, 1));
  /** The mount table's answer for the recorded device, given by a stub of the identity walk; `$HOME/table-asked`
   *  records that it was asked. */
  const tableSays = (ans: string, rc = 0): string =>
    `_ws_reclaim_idwalk() { cat > /dev/null; : > "$HOME/table-asked"; _WS_IDWALK_OUT='D 0 ${ans}'; _WS_IDWALK_WHY='a stub: the walk failed'; return ${rc}; };`;
  const SYS_ASKED = '_ws_collect_sysblock() { : > "$HOME/listing-asked"; printf \'%s\' "$HOME/sysblock"; };';
  /** The owner on a box that keeps a mount table (the platform is set, as `ccd-tmproot-drop-exact` sets it). */
  const owner = (want: string, have: string, pre: string): { rc: string; why: string } => {
    const out = h.sh(`CCD_OS=linux; ${MOUNTS_SEAM} ${SYSBLOCK_SEAM} ${pre} _ws_collect_dev_gone ${q(want)} ${q(have)};`
      + ' printf \'%s\\x1f%s\' "$?" "$_WS_DEVGONE_WHY"');
    const [rc = '', why = ''] = out.split('\x1f');
    return { rc, why };
  };
  const listing = (entries: string[]): void => {
    fs.mkdirSync(listingOf(), { recursive: true });
    for (const e of entries) fs.symlinkSync(`../../devices/fixture/${e}`, path.join(listingOf(), e));
  };

  it('gone: not in the mount table, the listing shows the temp area’s own device and no entry for the recorded one', () => {
    listing(['8:1', '8:0']);
    expect(owner(GONE_DEV, AREA, tableSays('absent'))).toEqual({ rc: '0', why: '' });
  }, 60_000);

  it.each([
    ['a link, as the kernel plants one, though it dangles here', (): void => { listing(['8:1', GONE_MM]); }],
    ['a directory', (): void => { listing(['8:1']); fs.mkdirSync(path.join(listingOf(), GONE_MM)); }],
  ])('THE UNMOUNTED-VOLUME RULE: an entry for the recorded device (%s) is "still here", though no mount names it', (_label, plant) => {
    plant();
    const r = owner(GONE_DEV, AREA, tableSays('absent'));
    expect(r.rc, r.why).toBe('1');
    expect(r.why).toContain(`still has device ${GONE_DEV} as a block device`);
    expect(r.why).toContain('mounted or not');
  }, 60_000);

  it.each([
    ['mounted', `this box mounts device ${GONE_DEV} (${GONE_MM})`],
    ['anon', 'of major 0'],
  ])('the mount table answering `%s` is "still here, or never provable": rc 1, and the listing is never asked', (ans, why) => {
    listing(['8:1']);
    const r = owner(GONE_DEV, AREA, `${tableSays(ans)} ${SYS_ASKED}`);
    expect(r.rc, r.why).toBe('1');
    expect(r.why).toContain(why);
    expect(fs.existsSync(path.join(h.home, 'table-asked')), 'the CONTROL: the table was asked').toBe(true);
    expect(fs.existsSync(path.join(h.home, 'listing-asked'))).toBe(false);
  }, 60_000);

  it.each([
    ['un unreadable', 0, '(unreadable)'],
    ['un empty', 0, '(empty)'],
    ['un malformed', 0, '(malformed)'],
    ['', 0, 'could not be read'],
    ['absent', 2, 'a stub: the walk failed'],
  ])('UNMEASURED IS NEVER GONE: the mount table answering %j (walk rc %i) is rc 2', (ans, walkRc, why) => {
    listing(['8:1']);
    const r = owner(GONE_DEV, AREA, tableSays(ans, walkRc));
    expect(r.rc, r.why).toBe('2');
    expect(r.why).toContain(why);
  }, 60_000);

  it('UNMEASURED IS NEVER GONE: a mount seam that names no table is rc 2, and no walk is run', () => {
    listing(['8:1']);
    const r = owner(GONE_DEV, AREA, `${tableSays('absent')} _ws_collect_mountinfo() { :; };`);
    expect(r.rc, r.why).toBe('2');
    expect(r.why).toContain('names no mount table');
    expect(fs.existsSync(path.join(h.home, 'table-asked'))).toBe(false);
  }, 60_000);

  // A LISTING THAT FAILS ITS CONTROL IS A FACT OF THE BOX (a /sys hidden or not this box's), not of load: rc 1, so the
  // answer keeps today's class, unmeasured `device`, listed at once, and is never retried as a load-sensitive
  // `identity` on every pass. Never gone either way: deleting the control turns these rc 0.
  it('THE CONTROL: a listing that does not show the temp area’s own device is rc 1, and with it rc 0', () => {
    listing(['8:0']);
    const without = owner(GONE_DEV, AREA, tableSays('absent'));
    expect(without.rc, without.why).toBe('1');
    expect(without.why).toContain("does not show the temp area's own device 8:1");
    listing(['8:1']);
    expect(owner(GONE_DEV, AREA, tableSays('absent')).rc, 'the CONTROL of the control').toBe('0');
  }, 60_000);

  it('THE CONTROL, for a temp area on a device of major 0 (no listing names one): any block device, and an empty listing is rc 1', () => {
    const anon = String(makedev(0, 41));
    fs.mkdirSync(listingOf());
    const empty = owner(GONE_DEV, anon, tableSays('absent'));
    expect(empty.rc, empty.why).toBe('1');
    expect(empty.why).toContain('does not show any block device');
    listing(['259:0']);
    expect(owner(GONE_DEV, anon, tableSays('absent')).rc).toBe('0');
  }, 60_000);

  it('THE CONTROL: no listing at all is rc 1, never gone, though the recorded entry is then "absent" too', () => {
    const r = owner(GONE_DEV, AREA, tableSays('absent'));
    expect(r.rc, r.why).toBe('1');
    expect(r.why).toContain('does not show');
  }, 60_000);

  it('THE CONTROL: a listing that is a file, or that names no path, is rc 1, never gone', () => {
    fs.writeFileSync(listingOf(), 'not a directory');
    expect(owner(GONE_DEV, AREA, tableSays('absent')).rc).toBe('1');
    expect(owner(GONE_DEV, AREA, `${tableSays('absent')} _ws_collect_sysblock() { :; };`).rc).toBe('1');
  }, 60_000);

  it.skipIf(ROOT_USER)('THE CONTROL: a listing this process cannot search is rc 1, never gone', () => {
    listing(['8:1']);
    restore.push([listingOf(), 0o755]);
    fs.chmodSync(listingOf(), 0o000);
    expect(owner(GONE_DEV, AREA, tableSays('absent')).rc).toBe('1');
  }, 60_000);

  it('THE CONTROL: a temp-area device that is no number has no control to show: rc 1, never gone', () => {
    listing(['8:1']);
    expect(owner(GONE_DEV, '', tableSays('absent')).rc).toBe('1');
  }, 60_000);

  it.each(['', 'x', '1'.repeat(19)])('a recorded device %j is no number of 1 to 18 digits: rc 1, and neither seam is asked', (bad) => {
    listing(['8:1']);
    const r = owner(bad, AREA, `${tableSays('absent')} ${SYS_ASKED}`);
    expect(r.rc, r.why).toBe('1');
    expect(fs.existsSync(path.join(h.home, 'table-asked'))).toBe(false);
    expect(fs.existsSync(path.join(h.home, 'listing-asked'))).toBe(false);
  }, 60_000);

  it('DARWIN keeps no mount table: rc 1, and neither seam is asked', () => {
    listing(['8:1']);
    const out = h.sh(`CCD_OS=darwin; _ws_collect_mountinfo() { : > "$HOME/table-asked"; printf '%s' "$HOME/mountinfo"; }; ${SYS_ASKED}`
      + ` ${tableSays('absent')} _ws_collect_dev_gone ${GONE_DEV} ${AREA}; printf '%s\\x1f%s' "$?" "$_WS_DEVGONE_WHY"`);
    expect(out.split('\x1f')[0]).toBe('1');
    expect(out.split('\x1f')[1]).toContain('keeps no mount table');
    expect(fs.existsSync(path.join(h.home, 'table-asked'))).toBe(false);
    expect(fs.existsSync(path.join(h.home, 'listing-asked'))).toBe(false);
  }, 60_000);
});

describe('the evaluation, the owner answered by a stub: a witness whose leaf is PROVEN absent', () => {
  /** The orphan's leaf gone, its witness naming the device of the box it came from. */
  const arrange = (): void => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    rewriteWitness(GONE_DEV, GONE_INO);
  };

  it('gone: collectable, and the token binds the device the temp area stands on NOW (`on=`), beside today’s inputs', () => {
    arrange();
    const f = forkOf(ownerSays(0));
    expect(f.verdict, f.detail).toBe('collectable');
    expect(f.gone).toBe(areaDev());
    expect(f.token).toBe(absentToken([`on=${areaDev()}`]));
    expect(f.token, 'never the same-device token of the same witness').not.toBe(absentToken());
    expect(ownerAsked(), 'asked once, of the recorded device and the temp area’s').toEqual([`${GONE_DEV} ${areaDev()}`]);
  }, 60_000);

  it('THE DOCUMENT says so: `recordedDevice: gone`, between the rows rung’s holders and the verdict, and only on a release', () => {
    arrange();
    const gone = forkDoc(ownerSays(0));
    expect(Object.keys(gone)).toEqual(['session', 'mode', 'exists', 'collect', 'heldBy', 'recordedDevice', 'verdict', 'detail', 'token']);
    expect(gone).toMatchObject({ recordedDevice: 'gone', verdict: 'collectable' });
    for (const rc of [1, 2] as const) expect(forkDoc(ownerSays(rc))['recordedDevice'], `owner rc ${rc}`).toBeUndefined();
    rewriteWitness(areaDev());
    const same = forkDoc(ownerSays(0));
    expect(same['verdict'], 'the CONTROL: on its own device it is collectable').toBe('collectable');
    expect(same['recordedDevice'], 'no release, no key').toBeUndefined();
  }, 60_000);

  it('still here, or never provable: unmeasured `device`, today’s sentence whole, then the owner’s reason', () => {
    arrange();
    const f = forkOf(ownerSays(1, 'this box still has it'));
    expect([f.verdict, f.probe]).toEqual(['unmeasured', 'device']);
    expect(f.detail).toBe(`${deviceSentence(GONE_DEV, `the witness of ${COL_ID}`)} (this box still has it)`);
    expect([f.token, f.gone]).toEqual(['', '']);
  }, 60_000);

  it('unmeasured: unmeasured `identity`, never `device` and never a token', () => {
    arrange();
    const f = forkOf(ownerSays(2, 'the table could not be read'));
    expect([f.verdict, f.probe]).toEqual(['unmeasured', 'identity']);
    expect(f.detail).toBe(`whether device ${GONE_DEV} that the witness of ${COL_ID} carries is still on this box could not be`
      + ' measured (the table could not be read): nothing is dropped, and the next pass asks again');
    expect([f.token, f.gone]).toEqual(['', '']);
  }, 60_000);

  it('on the device the witness carries the owner is never asked', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    expect(forkOf(ownerSays(0)).verdict).toBe('collectable');
    expect(ownerAsked()).toEqual([]);
  }, 60_000);

  it('a temp area whose device cannot be read is unmeasured `device`, and the owner is never asked', () => {
    arrange();
    const seam = 'eval "_orig_devino() $(declare -f _plat_devino | tail -n +2)";'
      + ` _plat_devino() { if [[ "$1" == '${areaOf()}' ]]; then return 1; fi; _orig_devino "$@"; };`;
    const f = forkOf(`${ownerSays(0)} ${seam}`);
    expect([f.verdict, f.probe]).toEqual(['unmeasured', 'device']);
    expect(f.detail).toContain(`the device of ${areaOf()} could not be read`);
    expect(ownerAsked()).toEqual([]);
  }, 60_000);

  it('THE RECORDLESS SLOT IS STILL TERMINAL on the gone path: quarantine-kept, and the witness stays', () => {
    arrange();
    fs.mkdirSync(path.join(quarantineOf(h), `slot.${recName()}`), { recursive: true, mode: 0o700 });
    const f = forkOf(ownerSays(0));
    expect(f.verdict, f.detail).toBe('quarantine-kept');
    expect(f.detail).toContain('stands with no record naming it');
    expect(f.token).toBe('');
  }, 60_000);

  it('THE PAUSE still stops the gone path: paused, and no token', () => {
    arrange();
    const f = forkOf(`${ownerSays(0)} ${PAUSE}`);
    expect([f.verdict, f.token], f.detail).toEqual(['paused', '']);
  }, 60_000);
});

describe('the evaluation, the owner answered by a stub: a quarantine record whose slot is empty', () => {
  // A STANDING SLOT IS LISTED WITH GNU find's `-printf`, which this platform's find may not have: off Linux (where the
  // collector never runs) a shell function answers that one listing, `-P <slot> -mindepth 1 -maxdepth 1 -printf %f/`,
  // and hands every other call to the real find. On Linux the real find answers.
  const FIND_SHIM = LINUX ? '' : 'find() { if [[ "$1 $3 $4 $5 $6 $7 $8" == "-P -mindepth 1 -maxdepth 1 -printf %f/" ]]; then'
    + ' local e; for e in "$2"/* "$2"/.[!.]* "$2"/..?*; do [[ -e "$e" || -L "$e" ]] && printf \'%s/\' "${e##*/}"; done; return 0;'
    + ' fi; command find "$@"; };';
  const forkR = (pre = ''): Fork => forkOf(`${FIND_SHIM} ${pre}`);
  const forkDocR = (pre = ''): Record<string, unknown> => forkDoc(`${FIND_SHIM} ${pre}`);
  /** A record of the box this root came from, its slot standing EMPTY (or, `slot: false`, not standing), the path
   *  empty or holding the copied root. */
  const arrange = (at: 'nothing' | 'a directory', slot = true): RecordFields => {
    const { leaf } = makeOrphan(h);
    const fields: RecordFields = { ...recordFor(identityOf(leaf)), dev: GONE_DEV, ino: GONE_INO };
    plantRecord(h, recName(), recordLine(fields));
    rewriteWitness(GONE_DEV, GONE_INO);
    if (slot) plantSlot();
    if (at === 'nothing') fs.rmSync(leaf, { recursive: true });
    return fields;
  };

  // A SLOT THAT DOES NOT STAND IS NO PROOF OF A COPIED BOX. A volume that is attached but not active (a closed
  // encrypted volume, an inactive logical volume, a removed device-mapper map) has no block entry, so its number
  // reads gone, and with the temp area standing on its bare mount point the slot and the path read absent too. A
  // restart there would drop the record of a collection whose leaf waits in the slot on that volume, and when it came
  // back the slot would stand with no record naming it: the terminal `quarantine-kept`. So only a slot standing empty,
  // which only that record's own run made, licenses the restart; anything else stays today's `device`.
  it.each(['nothing', 'a directory'] as const)('gone, %s at the path, but the slot does not stand: unmeasured `device`, no phase, no token, no release', (at) => {
    arrange(at, false);
    const f = forkR(ownerSays(0));
    expect([f.verdict, f.probe, f.phase, f.token, f.gone], f.detail).toEqual(['unmeasured', 'device', '', '', '']);
    expect(f.detail.startsWith(deviceSentence(GONE_DEV, `the quarantine record ${recName()}`)), f.detail).toBe(true);
    expect(f.detail).toContain(`the slot ${slotOf()} does not stand`);
    expect(forkDocR(ownerSays(0))['recordedDevice'], 'no release, no key').toBeUndefined();
    expect(forkDocR(ownerSays(0))['resume']).toBeUndefined();
  }, 60_000);

  it.each(['nothing', 'a directory'] as const)('gone, %s at the path: the phase is `restart`, never `removed`, and the token binds it and `on=`', (at) => {
    const fields = arrange(at);
    const f = forkR(ownerSays(0));
    expect([f.verdict, f.phase], f.detail).toEqual(['collectable', 'restart']);
    expect(f.gone).toBe(areaDev());
    expect(f.token).toBe(resumeToken(fields, 'restart', [`on=${areaDev()}`]));
    expect(f.token).not.toBe(resumeToken(fields, 'restart'));
    expect(f.token).not.toBe(resumeToken(fields, 'removed'));
    expect(ownerAsked()).toEqual([`${GONE_DEV} ${areaDev()}`]);
  }, 60_000);

  it('THE DOCUMENT says `resume: restart` and `recordedDevice: gone`', () => {
    arrange('a directory');
    const doc = forkDocR(ownerSays(0));
    expect(Object.keys(doc)).toEqual(['session', 'mode', 'exists', 'collect', 'heldBy', 'resume', 'recordedDevice', 'verdict', 'detail', 'token']);
    expect(doc).toMatchObject({ resume: 'restart', recordedDevice: 'gone', verdict: 'collectable', exists: true });
  }, 60_000);

  it('still here, or never provable: unmeasured `device`, today’s sentence whole, then the owner’s reason; no phase', () => {
    arrange('a directory');
    const f = forkR(ownerSays(1, 'this box mounts it'));
    expect([f.verdict, f.probe, f.phase]).toEqual(['unmeasured', 'device', '']);
    expect(f.detail).toBe(`${deviceSentence(GONE_DEV, `the quarantine record ${recName()}`)} (this box mounts it)`);
    expect(f.token).toBe('');
  }, 60_000);

  it('unmeasured: unmeasured `identity`, no phase and no token', () => {
    arrange('nothing');
    const f = forkR(ownerSays(2, 'the listing could not be read'));
    expect([f.verdict, f.probe, f.phase, f.token]).toEqual(['unmeasured', 'identity', '', '']);
    expect(f.detail).toContain(`whether device ${GONE_DEV} that the quarantine record ${recName()} carries is still on this box`);
    expect(f.detail).toContain('(the listing could not be read)');
  }, 60_000);

  it('THE PAUSE still stops a restart: paused, and no token', () => {
    arrange('a directory');
    const f = forkR(`${ownerSays(0)} ${PAUSE}`);
    expect([f.verdict, f.token], f.detail).toEqual(['paused', '']);
  }, 60_000);
});

// ── end to end: the audit, the verb, the real walk over a copied mount table, a planted block listing (Linux) ────
type Doc = Record<string, unknown>;
const SEAMS = `${MOUNTS_SEAM} ${SYSBLOCK_SEAM}`;
/** `ccd ws-audit --session <id> --collect`, sourced, both seams in place. */
const audit = (pre = '', floor = true): Run =>
  h.run(`${floor ? IDLE_FLOOR_SEAM : ''} ${SEAMS} ${pre} cmd_ws_audit --session ${COL_ID} --collect`);
/** `ccd ws-collect --expect <token> --session <id>`, sourced, both seams in place. */
const verb = (token: string, pre = ''): Run =>
  h.run(`${IDLE_FLOOR_SEAM} ${SEAMS} ${pre} cmd_ws_collect --expect ${token} --session ${COL_ID}`);
const auditDoc = (r: Run): Doc => JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as Doc;
const collectOf = (r: Run): Doc => (auditDoc(r)['collect'] ?? {}) as Doc;
const expectUnmeasured = (r: Run, probe: string, why: string, quiet = true): void => {
  expect(r.code, r.stdout + r.stderr).toBe(1);
  expect(auditDoc(r)['verdict'], r.stdout).toBe('unmeasured');
  expect(collectOf(r)['unmeasured'], String(auditDoc(r)['detail'])).toBe(probe);
  expect(String(auditDoc(r)['detail'])).toContain(why);
  expect(auditDoc(r)['token']).toBeUndefined();
  if (quiet) expect(readJournal(h.home), 'an unmeasured answer journals nothing').toEqual([]);
};
/** The host's own table (which lists no device of the gone box) and a sound block listing, at the seams. */
const thisBox = (): void => {
  realMounts(h);
  expect(fs.readFileSync(tableOf(), 'utf8').split('\n').some((l) => l.split(' ')[2] === GONE_MM),
    'the CONTROL: this host mounts no device of the gone box').toBe(false);
  blockListing(h);
};
/** Links for `entries` in the listing, and nothing else added (no control entry). */
const blockListingOnly = (entries: string[]): void => {
  for (const e of entries) {
    if (fs.lstatSync(path.join(listingOf(), e), { throwIfNoEntry: false }) === undefined) fs.symlinkSync('../nowhere', path.join(listingOf(), e));
  }
};
type Arm = 'witness' | 'record';
/** `arm`'s absence on a device gone from this box: a witness whose leaf is gone, or a record whose slot stands empty
 *  and whose path is empty; `dev` is the device they name. Returns the bytes that must be kept. */
const arrangeGone = (arm: Arm, dev: string = GONE_DEV): { witness: string; record: string } => {
  const { leaf } = makeOrphan(h);
  const ident = identityOf(leaf);
  let record = '';
  if (arm === 'record') {
    record = recordLine({ ...recordFor(ident), dev, ino: GONE_INO });
    plantRecord(h, recName(), record);
    plantSlot();
  }
  fs.rmSync(leaf, { recursive: true });
  thisBox();
  return { witness: rewriteWitness(dev, GONE_INO), record };
};
const expectKept = (kept: { witness: string; record: string }): void => {
  expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness, as it was').toBe(kept.witness);
  if (kept.record !== '') expect(fs.readFileSync(recordPath(), 'utf8'), 'the record, as it was').toBe(kept.record);
};
const ARMS: Arm[] = ['witness', 'record'];

describe.runIf(LINUX)('THE SAFETY RULE SURVIVES: a recorded device still on this box stays unmeasured `device`', () => {
  it.each(ARMS)('%s: the device attached as a block device, mounted nowhere (an unmounted volume)', (arm) => {
    const kept = arrangeGone(arm);
    blockListing(h, [GONE_MM]);
    const r = audit();
    expectUnmeasured(r, 'device', `still has device ${GONE_DEV} as a block device`);
    expect(String(auditDoc(r)['detail'])).toContain("a mount point on another device is never read as the leaf's absence");
    expect(auditDoc(r)['recordedDevice']).toBeUndefined();
    expect(auditDoc(r)['resume']).toBeUndefined();
    expectKept(kept);
  }, 60_000);

  it.each(ARMS)('%s: the device mounted somewhere else on this box', (arm) => {
    const kept = arrangeGone(arm);
    fs.appendFileSync(tableOf(), `${lineOf(GONE_MM)}\n`);
    expectUnmeasured(audit(), 'device', `this box mounts device ${GONE_DEV}`);
    expectKept(kept);
  }, 60_000);

  it('record: a gone number whose slot does not stand (a volume attached but not active, the temp area on its bare mount point) is never restarted', () => {
    const kept = arrangeGone('record');
    fs.rmdirSync(slotOf());
    const r = audit();
    expectUnmeasured(r, 'device', `the slot ${slotOf()} does not stand`);
    expect(auditDoc(r)['resume']).toBeUndefined();
    expect(auditDoc(r)['recordedDevice']).toBeUndefined();
    expectKept(kept);
  }, 60_000);

  it.each(ARMS.flatMap((arm) => [[arm, '1'], [arm, String(makedev(0, 77))]] as [Arm, string][]))(
    '%s: a device of major 0 (%s), which no table and no listing has to show, is never proven gone', (arm, dev) => {
      const kept = arrangeGone(arm, dev);
      expectUnmeasured(audit(), 'device', 'of major 0');
      expectKept(kept);
    }, 60_000);
});

describe.runIf(LINUX)('UNMEASURED IS NEVER GONE: what cannot be read answers unmeasured `identity`, and nothing is released', () => {
  const SPOILS: [string, () => string, string][] = [
    ['the mount table gone', (): string => { fs.rmSync(tableOf()); return ''; }, '(unreadable)'],
    ['the mount table empty', (): string => { fs.writeFileSync(tableOf(), ''); return ''; }, '(empty)'],
    ['a line that is no mount in the table', (): string => { fs.appendFileSync(tableOf(), 'not a mount line\n'); return ''; }, '(malformed)'],
    ['a mount seam that names no table', (): string => '_ws_collect_mountinfo() { :; };', 'names no mount table'],
  ];
  // A block listing that fails its control is a fact of the box, not of load: it keeps today's answer, unmeasured
  // `device` with the reason appended, which the lane lists at once, and is never gone.
  const LISTING_SPOILS: [string, () => string][] = [
    ['no block listing', (): string => { fs.rmSync(listingOf(), { recursive: true }); return ''; }],
    ['a block listing that is a file', (): string => {
      fs.rmSync(listingOf(), { recursive: true });
      fs.writeFileSync(listingOf(), 'not a directory');
      return '';
    }],
    ['a block listing without the control entry', (): string => { fs.rmSync(path.join(listingOf(), controlEntry(h))); return ''; }],
  ];
  for (const arm of ARMS) {
    it.each(SPOILS)(`${arm}: %s`, (_label, spoil, why) => {
      const kept = arrangeGone(arm);
      expect(auditDoc(audit())['verdict'], 'the CONTROL: unspoiled, it is released').toBe('collectable');
      const r = audit(spoil());
      expectUnmeasured(r, 'identity', why);
      expect(auditDoc(r)['recordedDevice']).toBeUndefined();
      expect(auditDoc(r)['resume']).toBeUndefined();
      expectKept(kept);
    }, 60_000);

    it.each(LISTING_SPOILS)(`${arm}: %s is unmeasured \`device\`, never gone and never \`identity\``, (_label, spoil) => {
      const kept = arrangeGone(arm);
      expect(auditDoc(audit())['verdict'], 'the CONTROL: unspoiled, it is released').toBe('collectable');
      const r = audit(spoil());
      expectUnmeasured(r, 'device', 'does not show');
      expect(String(auditDoc(r)['detail'])).toContain("a mount point on another device is never read as the leaf's absence");
      expect(auditDoc(r)['recordedDevice']).toBeUndefined();
      expectKept(kept);
    }, 60_000);

    it.skipIf(ROOT_USER)(`${arm}: a block listing this process cannot search is unmeasured \`device\``, () => {
      const kept = arrangeGone(arm);
      restore.push([listingOf(), 0o755]);
      fs.chmodSync(listingOf(), 0o000);
      expectUnmeasured(audit(), 'device', 'does not show');
      expectKept(kept);
    }, 60_000);
  }

  it('THE CONTROL, end to end: a listing that holds other devices but not the temp area’s own is not this box’s', (ctx) => {
    const kept = arrangeGone('witness');
    // A temp area on a device of major 0 (an overlay, a tmpfs) has no entry any listing could show; there the control
    // is "any block device", which the owner's own cases hold, and this case has nothing to remove.
    if (majMin(BigInt(areaDev())).startsWith('0:')) { ctx.skip(); return; }
    fs.rmSync(path.join(listingOf(), controlEntry(h)));
    blockListingOnly(['259:0', '8:16']);
    expectUnmeasured(audit(), 'device', "does not show the temp area's own device");
    expectKept(kept);
  }, 60_000);
});

describe.runIf(LINUX)('THE HEAL: a recorded device proven gone, and the id starts over', () => {
  it('case A: a witness whose leaf is proven absent is collectable, and the verb drops the witness and nothing else', () => {
    arrangeGone('witness');
    const r = audit();
    expect(r.code, r.stderr).toBe(0);
    const doc = auditDoc(r);
    expect(Object.keys(doc)).toEqual(['session', 'mode', 'exists', 'collect', 'heldBy', 'recordedDevice', 'verdict', 'detail', 'token']);
    expect(doc).toMatchObject({ verdict: 'collectable', recordedDevice: 'gone', exists: false });
    expect(doc['token']).toBe(absentToken([`on=${areaDev()}`]));
    expect(eventsOf(h.home, 'collect'), 'collectable journals nothing').toEqual([]);
    const v = verb(String(doc['token']));
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(docOf(v.stdout)).toEqual({ collected: COL_ID, record: null, resumed: false, witness: 'dropped' });
    expect(fs.existsSync(witnessOf(h)), 'the witness, dropped').toBe(false);
    expect(fs.existsSync(quarantineOf(h)), 'no quarantine was made').toBe(false);
    expect(records()).toEqual([]);
    const intent = eventsOf(h.home, 'collect').find((e) => e['outcome'] === 'intent');
    expect(String(intent?.['detail']), 'the journal names the device that is gone').toContain(`device ${GONE_DEV}`);
  }, 60_000);

  it('case B: a record with an empty slot and an empty path restarts: the slot and the record cleared, the witness kept, then case A', () => {
    const kept = arrangeGone('record');
    const r = audit();
    expect(r.code, r.stderr).toBe(0);
    const doc = auditDoc(r);
    expect(Object.keys(doc)).toEqual(['session', 'mode', 'exists', 'collect', 'heldBy', 'resume', 'recordedDevice', 'verdict', 'detail', 'token']);
    expect(doc).toMatchObject({ verdict: 'collectable', resume: 'restart', recordedDevice: 'gone' });
    const v = verb(String(doc['token']));
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(docOf(v.stdout)['refused'], v.stdout).toBe('state-changed');
    expect(String(docOf(v.stdout)['detail'])).toContain(`device ${GONE_DEV}`);
    expect(String(docOf(v.stdout)['detail'])).toContain('gone from this box');
    expect(records(), 'the record, dropped').toEqual([]);
    expect(fs.existsSync(slotOf()), 'the empty slot, removed').toBe(false);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness, KEPT as it was').toBe(kept.witness);
    const next = auditDoc(audit());
    expect(next, 'the next audit takes the fresh arm').toMatchObject({ verdict: 'collectable', recordedDevice: 'gone' });
    expect(next['resume']).toBeUndefined();
    const done = verb(String(next['token']));
    expect(docOf(done.stdout), done.stdout + done.stderr).toEqual({ collected: COL_ID, record: null, resumed: false, witness: 'dropped' });
    expect(fs.existsSync(witnessOf(h))).toBe(false);
  }, 90_000);

  /** Case C's arrangement: the copied root stands at the path, and a record and a witness of the box it came from
   *  name it; the audit answers `restart` and the verb clears the record. Returns the directory and what it held. */
  const restarted = (): { leaf: string; before: string[]; ino: string; witness: string } => {
    const { leaf } = makeOrphan(h);
    fs.writeFileSync(path.join(leaf, 'scratch.txt'), 'the copied root’s own\n');
    plantRecord(h, recName(), recordLine({ ...recordFor(identityOf(leaf)), dev: GONE_DEV, ino: GONE_INO }));
    plantSlot();
    const witness = rewriteWitness(GONE_DEV, GONE_INO);
    thisBox();
    const before = treeOf(leaf);
    const ino = String(fs.lstatSync(leaf, { bigint: true }).ino);
    const doc = auditDoc(audit());
    expect(doc, JSON.stringify(doc)).toMatchObject({ verdict: 'collectable', resume: 'restart', recordedDevice: 'gone', exists: true });
    const v = verb(String(doc['token']));
    expect(docOf(v.stdout)['refused'], v.stdout + v.stderr).toBe('state-changed');
    return { leaf, before, ino, witness };
  };

  it('case C: NOTHING IS DELETED ON THE OLD RECORD. A directory at the path survives the restart whole, and is then taken by path, on its own identity', () => {
    const r = restarted();
    expect(treeOf(r.leaf), 'the directory, byte for byte').toEqual(r.before);
    expect(String(fs.lstatSync(r.leaf, { bigint: true }).ino), 'the same directory').toBe(r.ino);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness, kept').toBe(r.witness);
    expect(records(), 'the record, dropped').toEqual([]);
    const events = eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'] ?? null]);
    expect(events, 'one intent and one refusal: nothing was removed').toEqual([['intent', null], ['refused', 'state-changed']]);
    // The next audit takes the fresh arm: the box-move release, on the directory's own identity, never the old record.
    const fresh = auditDoc(audit());
    expect(fresh, JSON.stringify(fresh)).toMatchObject({ verdict: 'collectable', witness: 'moved-host', exists: true });
    expect(fresh['resume']).toBeUndefined();
    expect(fresh['recordedDevice'], 'the leaf is present: no absence was believed').toBeUndefined();
    expect(treeOf(r.leaf), 'an audit removes nothing').toEqual(r.before);
  }, 120_000);

  it('case C: after the restart a change younger than the floor still answers changed-recently', () => {
    const r = restarted();
    expect(auditDoc(audit('', false))['verdict']).toBe('changed-recently');
    expect(treeOf(r.leaf)).toEqual(r.before);
  }, 120_000);

  it('case C: after the restart a process standing in the directory still answers in-use', () => {
    const r = restarted();
    const user = holdCwd(r.leaf);
    stops.push(user.stop);
    expect(auditDoc(audit())['verdict']).toBe('in-use');
    expect(treeOf(r.leaf)).toEqual(r.before);
  }, 120_000);

  it('case C: after the restart a checkout git no longer records still answers containment-unproven', () => {
    const r = restarted();
    fs.mkdirSync(path.join(r.leaf, 'wt'));
    fs.writeFileSync(path.join(r.leaf, 'wt', '.git'), `gitdir: ${path.join(h.home, 'gone', '.git', 'worktrees', 'wt')}\n`);
    expect(auditDoc(audit())['verdict']).toBe('containment-unproven');
    expect(fs.existsSync(path.join(r.leaf, 'scratch.txt'))).toBe(true);
  }, 120_000);
});

describe.runIf(LINUX)('THE TOKEN AND THE RE-PROOF IN THE LOCK', () => {
  it.each(ARMS)('%s: a block device that appears between the audit and the verb fails probe-unmeasured, everything kept', (arm) => {
    const kept = arrangeGone(arm);
    const token = String(auditDoc(audit())['token']);
    const v = verb(token, gapAt('locked', `ln -s ../nowhere "$HOME/sysblock/${GONE_MM}"`));
    expect(v.code, v.stdout + v.stderr).toBe(1);
    expect(docOf(v.stdout)['failed']).toBe('probe-unmeasured');
    // The verb's line is cut at 300 bytes, so it carries the device sentence; the audit's document carries the reason.
    expect(String(docOf(v.stdout)['detail'])).toContain(`not on device ${GONE_DEV} that`);
    expectKept(kept);
    if (arm === 'record') expect(fs.existsSync(slotOf()), 'the slot, standing').toBe(true);
    expectUnmeasured(audit(), 'device', `still has device ${GONE_DEV} as a block device`, false);
  }, 60_000);

  it.each(ARMS)('%s: a mount of the device that appears between the audit and the verb fails probe-unmeasured, everything kept', (arm) => {
    const kept = arrangeGone(arm);
    const token = String(auditDoc(audit())['token']);
    const v = verb(token, gapAt('locked', `printf '%s\\n' '${lineOf(GONE_MM)}' >> "$HOME/mountinfo"`));
    expect(v.code, v.stdout + v.stderr).toBe(1);
    expect(docOf(v.stdout)['failed']).toBe('probe-unmeasured');
    expect(String(docOf(v.stdout)['detail'])).toContain(`not on device ${GONE_DEV} that`);
    expectKept(kept);
    expectUnmeasured(audit(), 'device', `this box mounts device ${GONE_DEV}`, false);
  }, 60_000);

  it('a token that does not bind the release is never accepted on the gone path, and the release’s token never on the same device', () => {
    const kept = arrangeGone('witness');
    const without = verb(absentToken());
    expect(docOf(without.stdout)['refused'], without.stdout + without.stderr).toBe('state-changed');
    expectKept(kept);
    // The same absence on the device the witness carries: today's token, and the release's is refused.
    const own = rewriteWitness(areaDev());
    expect(auditDoc(audit())['token'], 'the CONTROL: the same-device token').toBe(absentToken());
    const withOn = verb(absentToken([`on=${areaDev()}`]));
    expect(docOf(withOn.stdout)['refused'], withOn.stdout + withOn.stderr).toBe('state-changed');
    expect(fs.readFileSync(witnessOf(h), 'utf8')).toBe(own);
  }, 60_000);

  it('a restart’s token binds the release too: the same record’s token without `on=` is refused, and nothing is cleared', () => {
    const kept = arrangeGone('record');
    const fields: RecordFields = { ...recordFor({ dev: GONE_DEV, ino: GONE_INO, btime: /\bbtime=(\d+)\b/.exec(kept.record)![1]! }) };
    expect(auditDoc(audit())['token'], 'the CONTROL: the record’s fields are these').toBe(resumeToken(fields, 'restart', [`on=${areaDev()}`]));
    const v = verb(resumeToken(fields, 'restart'));
    expect(docOf(v.stdout)['refused'], v.stdout + v.stderr).toBe('state-changed');
    expectKept(kept);
    expect(fs.existsSync(slotOf())).toBe(true);
  }, 60_000);
});
