// A standing quarantine record makes `ws-audit --collect` a RESUME (the temp-root collector, spec §5.10). The record
// is the authority, whatever the witness now says, and a resume never walks the tree or asks the floor. Its phase is
// read off the disk — `unmoved`, `moved`, `removed` — and anything the collector did not leave there is
// `quarantine-kept`: TERMINAL, journaled, and the operator's. A `moved` leaf is re-proven as the verb re-proves it
// after a move. FIXTURE HOME ONLY (`collectFixture.ts`). Linux only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, readJournal, refusalsOf } from './lifecycleHelpers.js';
import { holdCwd } from './wsExpireFixture.js';
import {
  AGED, COL_ID, NO_WALK, PAUSE, type Answer, type Identity, type RecordFields, collectAudit, collectForkOf,
  collectOf, holdTmpdir, identityOf, leafOf, lockOf, makeOrphan, moveIntoSlot, plantRecord, quarantineOf, recName,
  recordFor, recordLine, regDir, verdictOf, walked, witnessOf,
} from './collectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-resume-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';

const setup = (): { leaf: string; ident: Identity } => {
  const { leaf } = makeOrphan(h);
  return { leaf, ident: identityOf(leaf) };
};
const plantOwn = (ident: Identity, over: Partial<RecordFields> = {}, name: string = recName()): string =>
  plantRecord(h, name, recordLine({ ...recordFor(ident), ...over }));

describe.skipIf(!LINUX)('the phases, read off the disk', () => {
  it('unmoved: the record stands and the leaf never left — resume `unmoved`, and no walk', () => {
    const { ident } = setup();
    plantOwn(ident);
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stderr).toBe(0);
    expect(Object.keys(a.doc!)).toEqual(['session', 'mode', 'exists', 'collect', 'resume', 'verdict', 'detail', 'token']);
    expect(a.doc).toMatchObject({ resume: 'unmoved', verdict: 'collectable', exists: true });
    expect(collectOf(a)).toMatchObject({ records: [recName()], newestCtimeNs: null, entries: null, idleAt: null });
    expect(walked(h), 'a resume never walks the tree').toBe(false);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('unmoved, with its empty slot already made: still unmoved', () => {
    const { ident } = setup();
    plantOwn(ident);
    fs.mkdirSync(path.join(quarantineOf(h), `slot.${recName()}`), { recursive: true, mode: 0o700 });
    expect(collectAudit(h).doc).toMatchObject({ resume: 'unmoved', verdict: 'collectable' });
  }, 60_000);

  it('moved: the leaf stands in its slot — resume `moved`, nothing at the id', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ resume: 'moved', verdict: 'collectable', exists: false });
    expect(walked(h)).toBe(false);
  }, 60_000);

  it('removed: the slot is empty and the leaf is in neither place — resume `removed`', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = moveIntoSlot(h);
    fs.rmSync(path.join(slot, 'leaf'), { recursive: true });
    expect(collectAudit(h).doc).toMatchObject({ resume: 'removed', verdict: 'collectable', exists: false });
  }, 60_000);

  it('the resume token is the fork’s, binds the phase, and is never the fresh token', () => {
    const { ident } = setup();
    const fresh = collectAudit(h, { pre: AGED }).doc!['token'];
    plantOwn(ident);
    const unmoved = collectAudit(h).doc!['token'];
    expect(unmoved).toMatch(/^[0-9a-f]{64}$/);
    expect(unmoved).toBe(collectForkOf(h).token);
    expect(collectForkOf(h).phase).toBe('unmoved');
    moveIntoSlot(h);
    const moved = collectAudit(h).doc!['token'];
    expect(new Set([fresh, unmoved, moved]).size).toBe(3);
  }, 90_000);

  it('the resume token binds the record’s checkouts: a record that differs only there mints another token', () => {
    // The verb hands `checkouts=` to the removal as the checkouts it accepts, so a changed list is another consent.
    const { ident } = setup();
    const rec = plantOwn(ident);
    const plain = collectForkOf(h).token;
    expect(plain).toMatch(/^[0-9a-f]{64}$/);
    fs.writeFileSync(rec, recordLine({ ...recordFor(ident), checkouts: '/x/admin=/x/back' }));
    const widened = collectForkOf(h).token;
    expect(widened).toMatch(/^[0-9a-f]{64}$/);
    expect(widened).not.toBe(plain);
    fs.writeFileSync(rec, recordLine(recordFor(ident)));
    expect(collectForkOf(h).token, 'the CONTROL: the same record mints the same token').toBe(plain);
  }, 90_000);

  it('a path retaken since the move is quarantine-kept: TERMINAL, on every audit, asked before the row it brought', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const before = collectAudit(h).doc!['token'];
    // A new child on the same slug: `mkdir -p` makes a NEW leaf at the id, and its first spawn rewrites the witness.
    // Its `.child` row is LEFT standing: the retake is asked before the registry, or `registered` would hide it.
    h.sh(`_reg_set ${COL_ID} child 9 && _child_tmpdir ${COL_ID} >/dev/null`);
    expect(identityOf(leafOf(h)).ino, 'the CONTROL: another inode stands at the id').not.toBe(ident.ino);
    const a = collectAudit(h);
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ verdict: 'quarantine-kept' });
    expect(String(a.doc!['detail'])).toContain('retaken');
    expect(a.doc!['token']).toBeUndefined();
    expect(collectOf(a)['records'], 'a kept record is listed, never silent').toEqual([recName()]);
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'quarantine-kept' }]);
    expect(verdictOf(collectAudit(h)), 'answered on every audit').toBe('quarantine-kept');
    // Read off the disk: once the original path is free again (and its row gone), the record resumes as before, and
    // the rewritten witness changed nothing — the record is the authority.
    fs.rmSync(leafOf(h), { recursive: true });
    fs.rmSync(path.join(regDir(h), `${COL_ID}.child`));
    const c = collectAudit(h);
    expect(c.doc).toMatchObject({ resume: 'moved', verdict: 'collectable' });
    expect(c.doc!['token'], 'the witness is no input of a resume').toBe(before);
  }, 60_000);

  it('a record with no witness at all is resumed, and its lock taken', () => {
    const { ident } = setup();
    plantOwn(ident);
    fs.rmSync(witnessOf(h));
    const a = collectAudit(h);
    expect(a.doc).toMatchObject({ resume: 'unmoved', verdict: 'collectable' });
    expect(collectOf(a)['witness']).toBeNull();
    expect(fs.existsSync(lockOf(h))).toBe(true);
  }, 60_000);
});

describe.skipIf(!LINUX)('quarantine-kept: TERMINAL and journaled — what the collector did not leave is the operator’s', () => {
  const expectKept = (a: Answer, detail: string): void => {
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('quarantine-kept');
    expect(String(a.doc!['detail'])).toContain(detail);
    expect(a.doc!['token']).toBeUndefined();
    expect(collectOf(a)['records'], 'a kept record is listed, never silent').not.toEqual([]);
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'quarantine-kept' }]);
    expect(eventsOf(h.home, 'collect')[0]!['verb']).toBe('ws-audit');
  };

  // The three RECORD-level shapes assert the word only: whether the record reader or this audit names the fault
  // is the reader's to decide, and either way the record is kept.
  it('a record ccd cannot read as it writes it', () => {
    setup();
    plantRecord(h, recName(), 'v=1 junk\n');
    expectKept(collectAudit(h), '');
  }, 60_000);

  it('a record that names another id', () => {
    const { ident } = setup();
    plantOwn(ident, { id: 'demo-other-id' });
    expectKept(collectAudit(h), '');
  }, 60_000);

  it('a record with no birth time', () => {
    const { ident } = setup();
    plantOwn(ident, { btime: '-' });
    expectKept(collectAudit(h), '');
  }, 60_000);

  it('a slot whose leaf is a link, to the very directory the record names: never followed, nothing behind it touched', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = moveIntoSlot(h);
    const away = path.join(h.home, 'away');
    fs.renameSync(path.join(slot, 'leaf'), away);
    fs.symlinkSync(away, path.join(slot, 'leaf'));
    expectKept(collectAudit(h), 'is a link or not a directory');
    expect(fs.existsSync(path.join(away, 'cdk.out', 'manifest.json'))).toBe(true);
  }, 60_000);

  it('a slot leaf that no longer matches its record', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = path.join(quarantineOf(h), `slot.${recName()}`);
    fs.mkdirSync(path.join(slot, 'leaf'), { recursive: true, mode: 0o700 });
    expectKept(collectAudit(h), 'its record names');
  }, 60_000);

  it('a slot leaf of another inode with NOTHING at the id: quarantine-kept by verdict, never a moved resume', () => {
    // Nothing stands at the original path, so only the slot leaf's identity check stands between this and phase
    // `moved` with a resume token over a directory the record does not name.
    const { ident } = setup();
    plantOwn(ident);
    const slot = moveIntoSlot(h);
    fs.renameSync(path.join(slot, 'leaf'), path.join(h.home, 'old-slot-leaf'));
    fs.mkdirSync(path.join(slot, 'leaf'), { mode: 0o700 });
    expect(fs.existsSync(leafOf(h)), 'the CONTROL: nothing stands at the id').toBe(false);
    expectKept(collectAudit(h), 'its record names');
  }, 60_000);

  it('a slot holding what the collector never put there: kept, and it stays', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = moveIntoSlot(h);
    fs.writeFileSync(path.join(slot, 'stranger'), 's');
    expectKept(collectAudit(h), 'never put there');
    expect(fs.existsSync(path.join(slot, 'stranger'))).toBe(true);
    expect(fs.existsSync(path.join(slot, 'leaf', 'cdk.out'))).toBe(true);
  }, 60_000);

  it('two records of one id: a resume completes one and never chooses', () => {
    const { ident } = setup();
    plantOwn(ident);
    plantOwn(ident, {}, `${COL_ID}.1.2`);
    const a = collectAudit(h);
    expectKept(a, '2 quarantine records');
    expect(collectOf(a)['records']).toHaveLength(2);
  }, 60_000);
});

describe.skipIf(!LINUX)('a moved leaf is re-proven: registered, in use under either spelling, a row on the pre-move spelling, the pause', () => {
  it('a recycled spawn’s marker: registered — retried, never kept, never journaled', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.child`), '9');
    const a = collectAudit(h);
    expect(verdictOf(a)).toBe('registered');
    expect(collectOf(a)['records'], 'the record is still listed').toEqual([recName()]);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('a process whose TMPDIR is the PRE-MOVE spelling: in-use', () => {
    const { leaf, ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const p = holdTmpdir(leaf);
    try {
      expect(collectAudit(h).doc).toMatchObject({ resume: 'moved', verdict: 'in-use' });
    } finally { p.stop(); }
  }, 60_000);

  it('a process whose cwd is in the slot leaf: in-use', () => {
    const { ident } = setup();
    plantOwn(ident);
    const slot = moveIntoSlot(h);
    const p = holdCwd(path.join(slot, 'leaf', 'cdk.out'));
    try {
      expect(verdictOf(collectAudit(h))).toBe('in-use');
    } finally { p.stop(); }
  }, 60_000);

  it('the row rule is asked of the PRE-MOVE spelling', () => {
    const { leaf, ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const rows = `_ws_collect_rows_clear() { printf '%s|%s' "$1" "$2" > "$HOME/rows-asked"; _WS_COLLECT_ROWS_WHY='stub: a row'; return 1; };`;
    expect(verdictOf(collectAudit(h, { pre: rows }))).toBe('containment-unproven');
    expect(fs.readFileSync(path.join(h.home, 'rows-asked'), 'utf8')).toBe(`${COL_ID}|${leaf}`);
  }, 60_000);

  it('the pause holds a resume too', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    expect(collectAudit(h, { pre: PAUSE }).doc).toMatchObject({ resume: 'moved', verdict: 'paused' });
  }, 60_000);

  it('a slot leaf that vanishes while its identity is read: unmeasured `slot`, never quarantine-kept', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const seam = 'eval "_orig_ident() $(declare -f _ws_collect_ident | tail -n +2)";'
      + ' _ws_collect_ident() { if [[ "$1" == */leaf ]]; then rm -rf -- "$1"; return 1; fi; _orig_ident "$@"; };';
    const a = collectAudit(h, { pre: seam });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('slot');
    expect(String(a.doc!['detail'])).toContain('vanished while its identity was read');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('a slot leaf whose absence cannot be measured after its identity answered 1: unmeasured `slot`', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const seam = 'eval "_orig_ident() $(declare -f _ws_collect_ident | tail -n +2)";'
      + ' _ws_collect_ident() { if [[ "$1" == */leaf ]]; then : > "$HOME/ident-asked"; return 1; fi; _orig_ident "$@"; };'
      + ' eval "_orig_absent() $(declare -f _ws_reclaim_absent | tail -n +2)";'
      + ' _ws_reclaim_absent() { if [[ "$1" == */leaf && -e "$HOME/ident-asked" ]]; then'
      + ' _WS_ABSENT_WHY="stub: $1 could not be looked at"; return 2; fi; _orig_absent "$@"; };';
    const a = collectAudit(h, { pre: seam });
    expect(a.code, a.stderr).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('slot');
    expect(String(a.doc!['detail'])).toContain('stub:');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('a quarantine directory that is a link is never followed: unmeasured `quarantine`, exit 1', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const q = quarantineOf(h);
    const real = path.join(h.home, 'qreal');
    fs.renameSync(q, real);
    fs.symlinkSync(real, q);
    const a = collectAudit(h);
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('quarantine');
  }, 60_000);

  // The resume asks the fresh arm's READ-ONLY quarantine question (`_ws_collect_qcheck`, spec §5.10, departure
  // audit-asks-the-quarantine-question), MODE INCLUDED: a slot is never read through a quarantine the verb would refuse.
  it.each([
    ['mode 0755', 0o755, 'is mode 755, not 0700'],
    ['mode 2700 (setgid)', 0o2700, 'is mode 2700, not 0700'],
  ])('a quarantine at %s: unmeasured `quarantine`, exit 1, journaled nowhere — the record and its slot as they were', (_label, mode, why) => {
    const { ident } = setup();
    const rec = plantOwn(ident);
    const slot = moveIntoSlot(h);
    fs.chmodSync(quarantineOf(h), mode);
    expect(fs.statSync(quarantineOf(h)).mode & 0o7777, 'the CONTROL').toBe(mode);
    const a = collectAudit(h);
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('quarantine');
    expect(String(a.doc!['detail'])).toContain(why);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
    expect(fs.existsSync(rec), 'the record').toBe(true);
    expect(identityOf(path.join(slot, 'leaf')), 'the slot’s leaf').toEqual(ident);
    expect(fs.statSync(quarantineOf(h)).mode & 0o7777, 'never chmod-ed').toBe(mode);
  }, 60_000);

  it('another uid’s quarantine: unmeasured `quarantine`', () => {
    const { ident } = setup();
    plantOwn(ident);
    moveIntoSlot(h);
    const uid = 'eval "_orig_uid() $(declare -f _ws_leaf_uid | tail -n +2)";'
      + ' _ws_leaf_uid() { if [[ "$1" == */.ccd-quarantine ]]; then echo 999999; return 0; fi; _orig_uid "$@"; };';
    const a = collectAudit(h, { pre: uid });
    expect(a.code, a.stderr).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('quarantine');
    expect(String(a.doc!['detail'])).toContain('belongs to uid 999999');
  }, 60_000);

  it('no quarantine at all: an unmoved resume is collectable, and the audit makes none', () => {
    const { ident } = setup();
    plantOwn(ident);
    expect(fs.existsSync(quarantineOf(h)), 'the CONTROL: none stands').toBe(false);
    const a = collectAudit(h);
    expect(a.doc).toMatchObject({ resume: 'unmoved', verdict: 'collectable' });
    expect(fs.existsSync(quarantineOf(h)), 'the audit made the quarantine').toBe(false);
  }, 60_000);

  it('a record whose slot cannot be derived — the physical ~/.cc-tmp cannot be resolved — is unmeasured `quarantine`: exit 1, never kept, journaled nowhere (ruling R-a)', () => {
    // The record is well formed; only its slot, `<physical ~/.cc-tmp>/.ccd-quarantine/slot.<name>`, cannot be derived.
    // A later pass may resolve it (a bind mount not up yet, `~/.cc-tmp` not yet remade), so the record reader answers
    // rc 3 and the resume answers the retried unmeasured — never the TERMINAL `quarantine-kept`, journaled every pass.
    const { ident } = setup();
    const rec = plantOwn(ident);
    fs.rmSync(path.join(h.home, '.cc-tmp'), { recursive: true, force: true });
    const a = collectAudit(h);
    expect(a.code).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('quarantine');
    expect(String(a.doc!['detail'])).toContain('was never derived');
    expect(collectOf(a)['records'], 'the record is still listed').toEqual([recName()]);
    expect(readJournal(h.home)).toEqual([]);
    expect(fs.existsSync(rec), 'the record stands').toBe(true);
    // Read off the disk: once ~/.cc-tmp stands again, the same record resumes. Its leaf went with ~/.cc-tmp, and its
    // slot was never made, so it stands at neither: `removed`.
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { mode: 0o700 });
    expect(collectAudit(h).doc).toMatchObject({ resume: 'removed', verdict: 'collectable' });
  }, 60_000);
});
