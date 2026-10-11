// `ws-audit --collect`'s FRESH rungs, one by one and in order (the temp-root collector, spec §5.10): registered,
// quarantine-kept (a slot of the id that no record names), witness-mismatch, changed-recently, in-use,
// containment-unproven, paused. The first that does not pass ends the evaluation, and a probe that cannot answer ends
// it as unmeasured, naming itself. A witness whose leaf is proven gone is its own answer. FIXTURE HOME ONLY
// (`collectFixture.ts`). Linux only: the collector measures nothing elsewhere, and the in-use cases run real processes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { readJournal, refusalsOf } from './lifecycleHelpers.js';
import { holdCwd } from './wsExpireFixture.js';
import {
  AGED, COL_ID, NO_WALK, PAUSE, type Answer, collectAudit, collectOf, holdTmpdir, leafOf, makeOrphan, quarantineOf,
  regDir, replaceLeaf, secondsAgoNs, verdictOf, walkAt, walked, witnessOf,
} from './collectFixture.js';

let h: PrHarness;
/** Modes a case set, restored before cleanup: a leaf without owner write cannot have its entries removed. */
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-collect-rungs-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const chmodFor = (p: string, mode: number): void => {
  restore.push([p, fs.statSync(p).mode & 0o7777]);
  fs.chmodSync(p, mode);
};

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;

/** A worktree moved into the leaf: its `.git` file names an admin directory that is gone. */
const plantForeignCheckout = (leaf: string): void => {
  fs.mkdirSync(path.join(leaf, 'wt'));
  fs.writeFileSync(path.join(leaf, 'wt', '.git'), `gitdir: ${path.join(h.home, 'gone', '.git', 'worktrees', 'wt')}\n`);
};

describe.skipIf(!LINUX)('registered: a row of the id, by direct lookup, and by a listing the audit can trust', () => {
  it.each(['child', 'uuid', 'hold', 'reaping'])('a standing `%s` field: registered, exit 0, no token, nothing journaled', (field) => {
    makeOrphan(h);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.${field}`), 'x');
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('registered');
    expect(String(a.doc!['detail'])).toContain(`${COL_ID}.${field}`);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it.skipIf(ROOT)('a registry that can be searched but not listed: a `.child` is still seen; any other row makes the slug UNMEASURED, never free', () => {
    makeOrphan(h);
    const reg = regDir(h);
    fs.writeFileSync(path.join(reg, `${COL_ID}.hold`), 'x');
    expect(verdictOf(collectAudit(h, { pre: AGED })), 'the CONTROL: listable, the row is seen').toBe('registered');
    fs.chmodSync(reg, 0o300);
    try {
      const a = collectAudit(h, { pre: AGED });
      expect(a.code, a.stderr).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('registry');
      fs.writeFileSync(path.join(reg, `${COL_ID}.child`), '8');
      expect(verdictOf(collectAudit(h, { pre: AGED })), 'a direct lookup needs no listing').toBe('registered');
    } finally { fs.chmodSync(reg, 0o755); }
  }, 90_000);

  it('a direct lookup whose absence cannot be measured is UNMEASURED `registry`, never free', () => {
    // `[[ -e ]]` reads EACCES as absence; the direct lookups ask `_ws_reclaim_absent`, whose unmeasured answer is
    // stubbed here for the `.child` name alone (a `$REG` that cannot be searched answers unmeasured before the lock,
    // at the population, so this rung is reached only through the seam).
    makeOrphan(h);
    const seam = 'eval "_orig_absent() $(declare -f _ws_reclaim_absent | tail -n +2)";'
      + ' _ws_reclaim_absent() { if [[ "$1" == *.child ]]; then _WS_ABSENT_WHY="stub: $1 could not be looked at"; return 2; fi;'
      + ' _orig_absent "$@"; };';
    const a = collectAudit(h, { pre: `${AGED} ${seam}` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('registry');
    expect(String(a.doc!['detail'])).toContain(`${COL_ID}.child could not be looked at`);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('registered outranks every later rung', () => {
    makeOrphan(h);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.child`), '9');
    replaceLeaf(h);
    expect(verdictOf(collectAudit(h, { pre: PAUSE }))).toBe('registered');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('witness-mismatch: TERMINAL, journaled, offered to the operator, never taken', () => {
  const expectMismatch = (a: Answer, detail: string): void => {
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('witness-mismatch');
    expect(String(a.doc!['detail'])).toContain(detail);
    expect(a.doc!['token']).toBeUndefined();
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'witness-mismatch' }]);
  };

  it('a witness ccd cannot read as it writes it', () => {
    makeOrphan(h);
    fs.writeFileSync(witnessOf(h), 'v=2 junk\n');
    expectMismatch(collectAudit(h, { pre: AGED }), 'cannot be read as ccd writes it');
  }, 60_000);

  it('a witness with no birth time is never taken on device and inode alone', () => {
    makeOrphan(h);
    fs.writeFileSync(witnessOf(h), fs.readFileSync(witnessOf(h), 'utf8').replace(/ btime=\d+ /, ' btime=- '));
    // The file system is made to keep no birth time either, so dev and ino WOULD match: only the rule refuses it.
    expectMismatch(collectAudit(h, { pre: `${AGED} _plat_btime() { echo 0; };` }), 'records no birth time');
  }, 60_000);

  it('a directory of another inode at the id', () => {
    makeOrphan(h);
    replaceLeaf(h);
    expectMismatch(collectAudit(h, { pre: AGED }), 'its witness names');
  }, 60_000);

  it('a link at the id, to the very directory its witness names: never followed, and nothing behind it is touched', () => {
    const { leaf } = makeOrphan(h);
    const moved = path.join(h.home, 'moved');
    fs.renameSync(leaf, moved);
    fs.symlinkSync(moved, leaf);
    expectMismatch(collectAudit(h, { pre: AGED }), 'is a link or not a directory');
    expect(fs.existsSync(path.join(moved, 'cdk.out', 'manifest.json'))).toBe(true);
  }, 60_000);

  it('a file at the id', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    fs.writeFileSync(leaf, 'a file where the leaf was');
    expectMismatch(collectAudit(h, { pre: AGED }), 'is a link or not a directory');
  }, 60_000);
});

describe.skipIf(!LINUX)('a leaf that vanishes while its identity is read: a retry, never witness-mismatch (spec §5.10)', () => {
  /** The identity check's rc 1 is also "nothing stands": this seam removes the leaf and answers 1, as a race would. */
  const VANISH = '_ws_collect_ident() { rm -rf -- "$1"; return 1; };';

  it('PROVEN gone after the directory test: unmeasured `leaf`, exit 1, no token, journaled nowhere', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} ${VANISH}` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('leaf');
    expect(String(a.doc!['detail'])).toContain('vanished while its identity was read');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('an absence that cannot be measured after the identity answered 1: unmeasured `leaf`, never witness-mismatch', () => {
    const { leaf } = makeOrphan(h);
    const seam = '_ws_collect_ident() { : > "$HOME/ident-asked"; return 1; };'
      + ' eval "_orig_absent() $(declare -f _ws_reclaim_absent | tail -n +2)";'
      + ` _ws_reclaim_absent() { if [[ "$1" == '${leaf}' && -e "$HOME/ident-asked" ]]; then`
      + ' _WS_ABSENT_WHY="stub: $1 could not be looked at"; return 2; fi; _orig_absent "$@"; };';
    const a = collectAudit(h, { pre: `${AGED} ${seam}` });
    expect(a.code, a.stderr).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('leaf');
    expect(String(a.doc!['detail'])).toContain('stub:');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('a witness whose leaf is PROVEN gone: collectable at once, so the verb can drop the witness', () => {
  it('exists false, no walk, a token of its own, and the witness still standing', () => {
    const { leaf } = makeOrphan(h);
    const present = collectAudit(h, { pre: AGED }).doc!['token'];
    fs.rmSync(leaf, { recursive: true });
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ exists: false, verdict: 'collectable' });
    expect(walked(h), 'nothing to walk').toBe(false);
    expect(collectOf(a)).toMatchObject({ newestCtimeNs: null, entries: null, idleAt: null });
    expect(a.doc!['token']).toMatch(/^[0-9a-f]{64}$/);
    expect(a.doc!['token']).not.toBe(present);
    expect(fs.existsSync(witnessOf(h)), 'an audit drops nothing').toBe(true);
  }, 60_000);

  // AN ABSENCE NEEDS THE RECORDED DEVICE (spec §5.10, departure collect-absence-needs-the-recorded-device): with
  // `~/.cc-tmp`'s volume missing and its mount point standing empty, every leaf reads absent. So before the arm
  // believes the absence, the physical `~/.cc-tmp` must be on the device the witness carries. A forged `dev=` in the
  // witness stands for the missing volume, with no mount.
  it('a witness whose device is not the physical ~/.cc-tmp’s: unmeasured `device`, exit 1, no token — the witness as it was', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    const real = fs.readFileSync(witnessOf(h), 'utf8');
    const dev = /\bdev=(\d+)\b/.exec(real)![1]!;
    expect(verdictOf(collectAudit(h, { pre: NO_WALK })), 'the CONTROL: the device it carries').toBe('collectable');
    const forged = real.replace(/\bdev=\d+\b/, 'dev=1');
    fs.writeFileSync(witnessOf(h), forged);
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('device');
    const root = fs.realpathSync(path.dirname(leaf));
    expect(String(a.doc!['detail'])).toBe(`${root} is on device ${dev}, not on device 1 that the witness of ${COL_ID} carries`
      + " — a mount point on another device is never read as the leaf's absence: nothing is dropped, and the next"
      + ' pass asks again');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness').toBe(forged);
  }, 60_000);

  it('a ~/.cc-tmp PROVEN absent has no device to compare: unmeasured `device`, never a dropped witness', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(path.dirname(leaf), { recursive: true });
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stderr).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('device');
    expect(String(a.doc!['detail'])).toContain('cannot be resolved');
    expect(String(a.doc!['detail'])).toContain('so its device was never compared with device');
    expect(a.doc!['token']).toBeUndefined();
    expect(fs.existsSync(witnessOf(h))).toBe(true);
  }, 60_000);

  it('a device that cannot be read: unmeasured `device`', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    const root = fs.realpathSync(path.dirname(leaf));
    const seam = 'eval "_orig_devino() $(declare -f _plat_devino | tail -n +2)";'
      + ` _plat_devino() { if [[ "$1" == '${root}' ]]; then return 1; fi; _orig_devino "$@"; };`;
    const a = collectAudit(h, { pre: `${NO_WALK} ${seam}` });
    expect(a.code, a.stderr).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('device');
    expect(String(a.doc!['detail'])).toContain(`the device of ${root} could not be read`);
    expect(a.doc!['token']).toBeUndefined();
  }, 60_000);

  it.skipIf(ROOT)('a leaf whose absence cannot be proven is unmeasured `leaf`, never gone', () => {
    const { leaf } = makeOrphan(h);
    const root = path.dirname(leaf);
    fs.chmodSync(root, 0o000);
    try {
      const a = collectAudit(h, { pre: AGED });
      expect(a.code, a.stderr).toBe(1);
      expect(collectOf(a)['unmeasured']).toBe('leaf');
    } finally { fs.chmodSync(root, 0o700); }
  }, 60_000);
});

// THE QUARANTINE QUESTION (spec §5.10, departure audit-asks-the-quarantine-question): the verb refuses on a quarantine
// that is not a real directory of this uid at 0700, so the audit asks the same READ-ONLY question first, and a pass
// never licenses a move the verb would refuse on every pass. The audit makes nothing: only the verb makes it.
describe.skipIf(!LINUX)('the quarantine: the audit asks what the verb refuses on, and makes nothing', () => {
  const lsnap = (p: string): string => {
    try { const s = fs.lstatSync(p, { bigint: true }); return `${s.ino}:${(s.mode & 0o7777n).toString(8)}:${s.isSymbolicLink()}`; } catch { return 'absent'; }
  };
  const expectUnmeasured = (a: Answer, why: string): void => {
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('quarantine');
    expect(String(a.doc!['detail'])).toContain(why);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home), 'a retried word is journaled nowhere').toEqual([]);
  };

  it('no quarantine: collectable, a token minted — and the audit leaves none behind', () => {
    makeOrphan(h);
    expect(fs.existsSync(quarantineOf(h)), 'the CONTROL: none stands').toBe(false);
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('collectable');
    expect(a.doc!['token']).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(quarantineOf(h)), 'the audit made the quarantine').toBe(false);
  }, 60_000);

  it.each([
    ['a link to a 0700 directory', (q: string): void => { fs.mkdirSync(`${q}.real`, { mode: 0o700 }); fs.symlinkSync(`${q}.real`, q); }, 'is not a real directory'],
    ['a file', (q: string): void => { fs.writeFileSync(q, 'x', { mode: 0o600 }); }, 'is not a real directory'],
    ['a directory at mode 0755', (q: string): void => { fs.mkdirSync(q); fs.chmodSync(q, 0o755); }, 'is mode 755, not 0700'],
    ['a directory at mode 2700 (setgid)', (q: string): void => { fs.mkdirSync(q); fs.chmodSync(q, 0o2700); }, 'is mode 2700, not 0700'],
  ])('a quarantine that is %s: unmeasured `quarantine`, exit 1, no token — and it stands as it was', (_label, plant, why) => {
    const { leaf } = makeOrphan(h);
    plant(quarantineOf(h));
    const before = lsnap(quarantineOf(h));
    expectUnmeasured(collectAudit(h, { pre: AGED }), why);
    expect(lsnap(quarantineOf(h)), 'the audit changed the quarantine').toBe(before);
    expect(fs.existsSync(path.join(leaf, 'cdk.out', 'manifest.json')), 'the leaf').toBe(true);
  }, 60_000);

  it('another uid’s quarantine: unmeasured `quarantine`', () => {
    makeOrphan(h);
    fs.mkdirSync(quarantineOf(h), { mode: 0o700 });
    const uid = 'eval "_orig_uid() $(declare -f _ws_leaf_uid | tail -n +2)";'
      + ' _ws_leaf_uid() { if [[ "$1" == */.ccd-quarantine ]]; then echo 999999; return 0; fi; _orig_uid "$@"; };';
    expectUnmeasured(collectAudit(h, { pre: `${AGED} ${uid}` }), 'belongs to uid 999999');
  }, 60_000);

  it('a quarantine whose absence cannot be proven: unmeasured `quarantine`, and nothing is made', () => {
    makeOrphan(h);
    const seam = 'eval "_orig_absent() $(declare -f _ws_reclaim_absent | tail -n +2)";'
      + ' _ws_reclaim_absent() { if [[ "$1" == */.ccd-quarantine ]]; then _WS_ABSENT_WHY="stub: $1 could not be looked at"; return 2; fi;'
      + ' _orig_absent "$@"; };';
    expectUnmeasured(collectAudit(h, { pre: `${AGED} ${seam}` }), 'whether the quarantine stands was never asked');
    expect(fs.existsSync(quarantineOf(h))).toBe(false);
  }, 60_000);
});

// A RECORDLESS SLOT BESIDE A PRESENT LEAF (spec §5.10, departure fresh-collect-refuses-beside-a-standing-slot): a slot
// of the id that no record names may hold an earlier leaf of it. Collecting the present leaf would drop the witness,
// the id would leave the population, and that slot would never be listed again — so the fresh arm refuses, TERMINAL,
// and the witness stays beside it. Asked right after the quarantine question, before the leaf's own words.
describe.skipIf(!LINUX)('quarantine-kept: a present leaf beside a slot of its id that no record names', () => {
  const slotFor = (id: string): string => path.join(quarantineOf(h), `slot.${id}.1791000000000000000.4242`);

  it('refused quarantine-kept: TERMINAL, journaled, the slot named — the witness, the slot and the leaf as they were', () => {
    const { leaf } = makeOrphan(h);
    fs.mkdirSync(quarantineOf(h), { mode: 0o700 });
    fs.mkdirSync(path.join(slotFor(COL_ID), 'leaf'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(slotFor(COL_ID), 'leaf', 'earlier.txt'), 'an earlier leaf of the id\n');
    const witness = fs.readFileSync(witnessOf(h), 'utf8');
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('quarantine-kept');
    expect(String(a.doc!['detail'])).toBe(`kept as it stands, listed for the operator, and the witness of ${COL_ID} stays:`
      + ` the quarantine slot ${path.basename(slotFor(COL_ID))} stands with no record naming it, and the leaf at ${leaf}`
      + ' is not collected beside it');
    expect(a.doc!['token']).toBeUndefined();
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'quarantine-kept' }]);
    expect(fs.readFileSync(witnessOf(h), 'utf8'), 'the witness').toBe(witness);
    expect(fs.readFileSync(path.join(slotFor(COL_ID), 'leaf', 'earlier.txt'), 'utf8')).toBe('an earlier leaf of the id\n');
    expect(fs.existsSync(path.join(leaf, 'cdk.out', 'manifest.json')), 'the leaf').toBe(true);
  }, 60_000);

  it('it outranks the leaf’s own words: a recordless slot beside a REPLACED leaf is quarantine-kept, not witness-mismatch', () => {
    makeOrphan(h);
    replaceLeaf(h);
    fs.mkdirSync(quarantineOf(h), { mode: 0o700 });
    fs.mkdirSync(slotFor(COL_ID), { mode: 0o700 });
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('quarantine-kept');
  }, 60_000);

  it('a NESTED id’s slot is another id’s: not counted — the present leaf is collectable', () => {
    makeOrphan(h);
    fs.mkdirSync(quarantineOf(h), { mode: 0o700 });
    fs.mkdirSync(slotFor(`${COL_ID}.v2-quiet-river`), { mode: 0o700 });
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('collectable');
  }, 60_000);

  it('slots that cannot be listed: unmeasured `quarantine`, never "no slot"', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_collect_slots_of() { _WS_QSLOTS=(); _WS_QSLOTS_WHY='stub: the quarantine could not be listed'; return 2; };` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('quarantine');
    expect(String(a.doc!['detail'])).toContain('stub: the quarantine could not be listed');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

// OWNER WRITE (spec §5.10, departure audit-asks-owner-write): a directory whose own mode lacks owner write cannot be
// renamed to another parent (the rename rewrites its `..`), so a 0555 leaf the audit licensed would fail the verb's
// NOREPLACE rename on every pass. The audit answers it unmeasured, naming the mode. The collector never changes a
// leaf's mode before the move — the token binds it — so the leaf stays listed, as it is.
describe.skipIf(!LINUX || ROOT)('mode: a leaf without owner write is never licensed to move', () => {
  const expectMode = (a: Answer, mode: string): void => {
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('mode');
    expect(String(a.doc!['detail'])).toContain(`is mode ${mode}`);
    expect(String(a.doc!['detail'])).toContain('without owner write');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home), 'a retried word is journaled nowhere').toEqual([]);
  };

  it('a 0555 leaf: unmeasured `mode`, exit 1, no token — its mode and its contents as they were; owner write back, collectable', () => {
    const { leaf } = makeOrphan(h);
    chmodFor(leaf, 0o555);
    const before = (fs.readdirSync(leaf, { recursive: true }) as string[]).map(String).sort();
    expectMode(collectAudit(h, { pre: AGED }), '555');
    expect(fs.statSync(leaf).mode & 0o7777, 'the audit never changes a leaf’s mode').toBe(0o555);
    expect((fs.readdirSync(leaf, { recursive: true }) as string[]).map(String).sort()).toEqual(before);
    fs.chmodSync(leaf, 0o700);
    expect(verdictOf(collectAudit(h, { pre: AGED })), 'the CONTROL: owner write back').toBe('collectable');
  }, 60_000);

  it('a 2555 leaf: the OWNER digit is read, third from the right of the octal print, never the first', () => {
    const { leaf } = makeOrphan(h);
    chmodFor(leaf, 0o2555);
    expect(fs.statSync(leaf).mode & 0o7777, 'the CONTROL: the setgid bit took').toBe(0o2555);
    expectMode(collectAudit(h, { pre: AGED }), '2555');
    fs.chmodSync(leaf, 0o2755);
    expect(verdictOf(collectAudit(h, { pre: AGED })), 'the CONTROL: 2755 has owner write').toBe('collectable');
  }, 60_000);

  it('a leaf whose mode cannot be read: unmeasured `mode`, never licensed', () => {
    const { leaf } = makeOrphan(h);
    const seam = 'eval "_orig_mode() $(declare -f _plat_mode | tail -n +2)";'
      + ` _plat_mode() { if [[ "$1" == '${leaf}' ]]; then return 1; fi; _orig_mode "$@"; };`;
    const a = collectAudit(h, { pre: `${AGED} ${seam}` });
    expect(a.code, a.stderr).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('mode');
    expect(String(a.doc!['detail'])).toContain(`the mode of ${leaf} could not be read`);
    expect(a.doc!['token']).toBeUndefined();
  }, 60_000);
});

describe.skipIf(!LINUX)('changed-recently: the newest CTIME under the leaf, against max(24 h, the knob)', () => {
  it('a fresh leaf, through the REAL walk: changed-recently, with the instant it turns collectable', () => {
    makeOrphan(h);
    const before = Math.floor(Date.now() / 1000);
    const a = collectAudit(h);
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('changed-recently');
    const c = collectOf(a);
    expect(c['entries'], 'the leaf itself, cdk.out and its manifest').toBe(3);
    expect(Number(c['idleAt'])).toBeGreaterThanOrEqual(before + 86_400 - 5);
    expect(Number(c['idleAt'])).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 86_400 + 1);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('the boundary: five seconds short of the floor is changed-recently, five seconds past it is collectable', () => {
    makeOrphan(h);
    expect(verdictOf(collectAudit(h, { pre: walkAt(secondsAgoNs(86_400 - 5)) }))).toBe('changed-recently');
    expect(verdictOf(collectAudit(h, { pre: walkAt(secondsAgoNs(86_400 + 5)) }))).toBe('collectable');
  }, 60_000);

  it('the knob RAISES the floor', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `WS_COLLECT_IDLE_FLOOR_S=200000; ${AGED}` });
    expect(verdictOf(a)).toBe('changed-recently');
    expect(collectOf(a)['floorS']).toBe(200_000);
  }, 60_000);

  it.each(['60', '0', ''])('the knob %j never LOWERS it', (k) => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `WS_COLLECT_IDLE_FLOOR_S='${k}'; ${walkAt(secondsAgoNs(3600))}` });
    expect(verdictOf(a)).toBe('changed-recently');
    expect(collectOf(a)['floorS']).toBe(86_400);
  }, 60_000);

  it.each(['-5', 'abc', '1e9'])('a knob %j that is no whole number is unmeasured `floor`, never folded to 24 h', (k) => {
    // Task 4's `_ws_collect_floor_s` prints NOTHING for a set, non-empty knob that is not a whole number: a raise asked
    // for unreadably is never read as no raise. The document then names no floor, and no instant it turns idle.
    makeOrphan(h);
    const a = collectAudit(h, { pre: `WS_COLLECT_IDLE_FLOOR_S='${k}'; ${walkAt(secondsAgoNs(3600))}` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)).toMatchObject({ unmeasured: 'floor', floorS: null, idleAt: null });
    expect(String(a.doc!['detail'])).toContain('WS_COLLECT_IDLE_FLOOR_S');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('a newest change in the FUTURE (a clock stepped back) is changed-recently, never idle', () => {
    makeOrphan(h);
    expect(verdictOf(collectAudit(h, { pre: walkAt(secondsAgoNs(-3600)) }))).toBe('changed-recently');
  }, 60_000);

  it('a clock that cannot be read is unmeasured `clock`, never idle (Task 4’s `_ws_collect_floor_held` answers 2)', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_collect_now_ns() { echo soon; };` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('clock');
    expect(a.doc!['token']).toBeUndefined();
  }, 60_000);

  it('mtime is never read: a leaf whose every mtime is years old is still changed-recently (the REAL walk)', () => {
    const { leaf } = makeOrphan(h);
    const old = new Date('2020-01-01T00:00:00Z');
    for (const p of [path.join(leaf, 'cdk.out', 'manifest.json'), path.join(leaf, 'cdk.out'), leaf]) fs.utimesSync(p, old, old);
    expect(verdictOf(collectAudit(h))).toBe('changed-recently');
  }, 60_000);
});

describe.skipIf(!LINUX)('in-use: a process of this uid in the leaf, by cwd or by TMPDIR', () => {
  it('a process whose cwd is in the leaf', () => {
    const { leaf } = makeOrphan(h);
    const p = holdCwd(path.join(leaf, 'cdk.out'));
    try {
      const a = collectAudit(h, { pre: AGED });
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('in-use');
      expect(String(a.doc!['detail'])).toContain(String(p.pid));
      expect(a.doc!['token']).toBeUndefined();
    } finally { p.stop(); }
  }, 60_000);

  it('a process whose TMPDIR is the leaf, with its cwd elsewhere: the shape that re-created a leaf', () => {
    const { leaf } = makeOrphan(h);
    const p = holdTmpdir(leaf);
    try {
      expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('in-use');
    } finally { p.stop(); }
  }, 60_000);

  it('a probe that cannot answer is unmeasured `in-use`, never "nobody"', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_path_users() { _WS_PATH_USERS_WHY='stub: the table would not list'; return 2; };` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('in-use');
  }, 60_000);
});

describe.skipIf(!LINUX)('containment-unproven: TERMINAL — a checkout git records elsewhere, or a row at, inside or through the leaf', () => {
  it('a worktree moved into the leaf, whose admin directory is gone: journaled, and nothing touched', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('containment-unproven');
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'containment-unproven' }]);
    expect(fs.existsSync(path.join(leaf, 'wt', '.git'))).toBe(true);
  }, 60_000);

  it('a stopped session’s row inside the leaf (the measured loss): containment-unproven', () => {
    const { leaf } = makeOrphan(h);
    fs.mkdirSync(path.join(leaf, 'clone'));
    fs.writeFileSync(path.join(regDir(h), 'demo-other.workdir'), path.join(leaf, 'clone'));
    fs.writeFileSync(path.join(regDir(h), 'demo-other.uuid'), 'deadbeef-0000-4000-8000-000000000000');
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('containment-unproven');
  }, 60_000);

  it('the row rule is asked of the id and of the leaf’s own path', () => {
    const { leaf } = makeOrphan(h);
    const rows = `_ws_collect_rows_clear() { printf '%s|%s' "$1" "$2" > "$HOME/rows-asked"; _WS_COLLECT_ROWS_WHY='stub: a row'; return 1; };`;
    expect(verdictOf(collectAudit(h, { pre: `${AGED} ${rows}` }))).toBe('containment-unproven');
    expect(fs.readFileSync(path.join(h.home, 'rows-asked'), 'utf8')).toBe(`${COL_ID}|${leaf}`);
  }, 60_000);

  it('a checkout scan that cannot answer: unmeasured `checkouts`', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_leaf_checkouts() { _WS_CHECKOUTS_WHY='stub: the walk timed out'; return 2; };` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('checkouts');
  }, 60_000);

  it('a row rule that cannot answer: unmeasured `rows`', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_collect_rows_clear() { _WS_COLLECT_ROWS_WHY='stub: unplaceable'; return 2; };` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('rows');
  }, 60_000);
});

describe.skipIf(!LINUX)('paused: read inside the lock, the last rung', () => {
  it('the kill-switch: paused, exit 0, no token, nothing journaled; lowered, collectable', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} ${PAUSE}` });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('paused');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
    fs.rmSync(path.join(regDir(h), 'reclaim-paused'));
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('collectable');
  }, 60_000);

  it('a dangling link at the switch pauses too', () => {
    makeOrphan(h);
    fs.symlinkSync(path.join(h.home, 'nowhere'), path.join(regDir(h), 'reclaim-paused'));
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('paused');
  }, 60_000);
});

describe.skipIf(!LINUX)('the order: the first rung that does not pass ends the evaluation', () => {
  it('witness-mismatch outranks changed-recently, in-use, containment and the pause', () => {
    const { leaf } = makeOrphan(h);
    replaceLeaf(h);
    plantForeignCheckout(leaf);
    const p = holdCwd(leaf);
    try { expect(verdictOf(collectAudit(h, { pre: PAUSE }))).toBe('witness-mismatch'); } finally { p.stop(); }
  }, 60_000);

  it('changed-recently (the REAL walk) outranks in-use, containment and the pause', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    const p = holdCwd(leaf);
    try { expect(verdictOf(collectAudit(h, { pre: PAUSE }))).toBe('changed-recently'); } finally { p.stop(); }
  }, 60_000);

  it('in-use outranks containment and the pause', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    const p = holdCwd(leaf);
    try { expect(verdictOf(collectAudit(h, { pre: `${AGED} ${PAUSE}` }))).toBe('in-use'); } finally { p.stop(); }
  }, 60_000);

  it('containment outranks the pause: a paused fleet still learns its terminal refusals', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    expect(verdictOf(collectAudit(h, { pre: `${AGED} ${PAUSE}` }))).toBe('containment-unproven');
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'containment-unproven' }]);
  }, 60_000);
});

// The leaf the document names is `_child_tmpdir`'s spelling, untouched by any of the rungs above.
it.skipIf(!LINUX)('every rung leaves the leaf as it found it', () => {
  const { leaf } = makeOrphan(h);
  const before = (fs.readdirSync(leaf, { recursive: true }) as string[]).map(String).sort();
  for (const pre of [AGED, '', `${AGED} ${PAUSE}`]) collectAudit(h, { pre });
  expect((fs.readdirSync(leafOf(h), { recursive: true }) as string[]).map(String).sort()).toEqual(before);
}, 90_000);
