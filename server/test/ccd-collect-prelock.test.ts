// path-identity W1b: the collector opens `$REG/.reap-<id>.lock` only after an ADVISORY parse (path-identity spec §2.5).
// A reap lock is never unlinked, so the first open of one makes a name for good. Before this wave the collect audit and
// `ws-collect` opened it for any id with a witness FILE or a record FILE NAME, before either body was read: a junk
// witness, a junk record or an id with no dash left a permanent lock behind. `_ws_collect_prelock` now answers each of
// those before the lock, in the words the locked evaluation gives the same disk, and a registry row of any kind still
// opens the lock, so `registered` keeps its place ahead of `witness-mismatch`. Sound input still takes the lock.
// FIXTURE HOME ONLY (`makePrHarness`): every path derives from `h.home`, and both verbs run as SOURCED functions, never
// through the installed launcher and never against the live HOME. Linux only where the collector measures: on Darwin
// the audit answers unmeasured `platform` before it reads anything. The source cases run everywhere.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf, readJournal, refusalsOf } from './lifecycleHelpers.js';
import {
  AGED, COL_ID, PAUSE, type Answer, collectAudit, collectOf, identityOf, lockOf, makeOrphan, moveIntoSlot, plantRecord,
  recName, recordFor, recordLine, recordsDir, regDir, verdictOf, witnessOf,
} from './collectFixture.js';
import { WRONG_TOKEN, collectVerb, docOf } from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-prelock-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;
/** A witness line in no grammar ccd writes. */
const JUNK_WITNESS = 'v=2 junk\n';
/** A record line in no grammar ccd writes. */
const JUNK_RECORD = 'v=1 junk\n';
/** An id with no `-`: it names no project and slug, so `_ws_slug_free` cannot be asked of it. */
const NODASH = 'nodash';
/** A second id, for the case that needs its own lock beside COL_ID's. */
const REC_ID = 'demo-quiet-basin';
/** The id a foreign record names. */
const OTHER_ID = 'demo-quiet-other';
const junkWitness = (): void => { fs.writeFileSync(witnessOf(h), JUNK_WITNESS); };
const locked = (id: string = COL_ID): boolean => fs.existsSync(lockOf(h, id));
/** `_ws_reclaim_absent` answering UNMEASURED for a `.child` name alone (`ccd-collect-audit-rungs.test.ts`'s seam): a
 *  `.child` whose absence cannot be proven. Every other path asks the real function. */
const UNMEASURABLE_CHILD = 'eval "_orig_absent() $(declare -f _ws_reclaim_absent | tail -n +2)";'
  + ' _ws_reclaim_absent() { if [[ "$1" == *.child ]]; then _WS_ABSENT_WHY="stub: $1 could not be looked at"; return 2; fi;'
  + ' _orig_absent "$@"; };';
/** A record reader that parses every record as another id's: the id compare behind the real reader, reached. */
const READS_AS_OTHER = `_ws_collect_record_read() { _WS_QREC_ID=${OTHER_ID}; return 0; };`;

describe.skipIf(!LINUX)('the collector opens the reap lock only after an advisory parse (path-identity spec §2.5)', () => {
  describe('the audit, ws-audit --collect', () => {
    it('a junk witness with no record answers witness-mismatch, journaled once, and leaves no lock', () => {
      makeOrphan(h);
      junkWitness();
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('witness-mismatch');
      expect(a.doc!['detail'], 'the locked evaluation’s words, byte for byte').toBe(
        `the witness ${witnessOf(h)} cannot be read as ccd writes it — a temp root nothing vouches for is offered to the operator, never taken`);
      expect(a.doc!['token']).toBeUndefined();
      expect(collectOf(a)['witness']).toBeNull();
      expect(refusalsOf(h.home), 'journaled once').toEqual([{ act: 'collect', token: 'witness-mismatch' }]);
      expect(eventsOf(h.home, 'collect')[0]!['verb']).toBe('ws-audit');
      expect(locked(), 'no reap lock for a name nothing vouches for').toBe(false);
    }, 60_000);

    it('a record whose body is junk, with no witness, answers quarantine-kept, lists the record, and leaves no lock', () => {
      const rec = plantRecord(h, recName(), JUNK_RECORD);
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('quarantine-kept');
      expect(a.doc!['detail']).toBe(
        `the quarantine record ${rec} cannot be read as ccd writes it — it, and whatever it names, are kept for the operator`);
      expect(collectOf(a)['records'], 'a kept record is listed, never silent').toEqual([recName()]);
      expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'quarantine-kept' }]);
      expect(locked(), 'no reap lock for a record nothing vouches for').toBe(false);
      expect(fs.readFileSync(rec, 'utf8'), 'the record stands as it was').toBe(JUNK_RECORD);
    }, 60_000);

    it('a junk record beside a sound witness answers quarantine-kept, reports the witness, and leaves no lock', () => {
      makeOrphan(h);
      plantRecord(h, recName(), JUNK_RECORD);
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('quarantine-kept');
      expect(collectOf(a)['witness'], 'the document reports the witness, as the fork’s resume arm does').not.toBeNull();
      expect(locked(), 'no reap lock for a record nothing vouches for').toBe(false);
    }, 60_000);

    it('a junk witness beside quarantine records that cannot be listed answers unmeasured records, exit 1, with no lock', () => {
      makeOrphan(h);
      junkWitness();
      const elsewhere = path.join(h.home, 'not-the-records');
      fs.mkdirSync(elsewhere);
      fs.symlinkSync(elsewhere, recordsDir(h));
      const a = collectAudit(h);
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('records');
      expect(readJournal(h.home), 'unmeasured is journaled nowhere').toEqual([]);
      expect(locked(), 'records that cannot be listed prove no absence: no lock, and no witness word').toBe(false);
    }, 60_000);

    it('two junk records answer quarantine-kept, naming both, with no lock', () => {
      plantRecord(h, recName(), JUNK_RECORD);
      plantRecord(h, `${COL_ID}.1.2`, JUNK_RECORD);
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('quarantine-kept');
      expect(a.doc!['detail']).toBe(`2 quarantine records name ${COL_ID} — a resume completes one record and never chooses`
        + ' between several; they are kept for the operator');
      expect([...(collectOf(a)['records'] as string[])].sort(), 'both are listed').toEqual([`${COL_ID}.1.2`, recName()].sort());
      expect(locked()).toBe(false);
    }, 60_000);

    it('one well-formed record that names another id answers quarantine-kept, with no lock', () => {
      // ON THE DISK: a line ccd would write, for another id, under this id's record name. The reader refuses it whole
      // (its name and its body name two ids), so the judgement answers it as a record ccd never wrote.
      plantRecord(h, recName(), recordLine(recordFor({ dev: '1', ino: '2', btime: '3' }, OTHER_ID)));
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('quarantine-kept');
      expect(String(a.doc!['detail'])).toContain('cannot be read as ccd writes it');
      expect(locked(), 'the record on the disk opens no lock').toBe(false);
      // BEHIND THE READER: the id compare, reached by a reader that parses the record as another id's. The pass
      // answers it in the compare's own words, and still before any lock.
      const b = collectAudit(h, { pre: READS_AS_OTHER });
      expect(b.code, b.stderr).toBe(0);
      expect(verdictOf(b)).toBe('quarantine-kept');
      expect(b.doc!['detail']).toBe(`the quarantine record ${path.join(recordsDir(h), recName())} names ${OTHER_ID},`
        + ` not ${COL_ID} — it is kept for the operator`);
      expect(locked(), 'a reader that parses it as another id’s opens no lock').toBe(false);
    }, 90_000);

    it('a sound record whose ~/.cc-tmp cannot be resolved answers unmeasured quarantine, exit 1, with no lock', () => {
      const tmp = path.join(h.home, '.cc-tmp');
      fs.mkdirSync(tmp, { recursive: true });
      const dev = String(fs.statSync(tmp, { bigint: true }).dev);
      plantRecord(h, recName(), recordLine(recordFor({ dev, ino: '2', btime: '3' })));
      fs.rmSync(tmp, { recursive: true, force: true });
      const a = collectAudit(h);
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('quarantine');
      expect(String(a.doc!['detail'])).toContain('was never derived');
      expect(collectOf(a)['records'], 'the record is still listed').toEqual([recName()]);
      expect(readJournal(h.home), 'unmeasured is journaled nowhere').toEqual([]);
      expect(locked(), 'no lock until a body is parsed and its slot derived').toBe(false);
      // The CONTROL: ~/.cc-tmp stands again, the same record parses, and it takes the lock. Its leaf and slot stand
      // nowhere, so the resume reads `removed`.
      fs.mkdirSync(tmp, { mode: 0o700 });
      expect(collectAudit(h).doc).toMatchObject({ resume: 'removed', verdict: 'collectable' });
      expect(locked()).toBe(true);
    }, 90_000);

    it('an id with no dash answers unmeasured registry, exit 1, with no lock', () => {
      makeOrphan(h, NODASH);
      const a = collectAudit(h, { id: NODASH });
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('registry');
      expect(readJournal(h.home)).toEqual([]);
      expect(locked(NODASH), 'no reap lock for an id that names no slug').toBe(false);
      // Its detail is `_ws_collect_registered`'s own, byte for byte, asked as its callers ask it: with the lock held.
      const reg = h.sh(`exec 9>>"$REG/.reap-${NODASH}.lock"; _ws_collect_registered ${NODASH};`
        + ' printf \'%s|%s\' "$?" "$_WS_COLLECT_REG_WHY"');
      expect(reg).toBe(`2|${String(a.doc!['detail'])}`);
    }, 60_000);

    it.each([
      ['a .uuid', `${COL_ID}.uuid`],
      ['a .child', `${COL_ID}.child`],
      ['a .hold', `${COL_ID}.hold`],
      ['a .reaping', `${COL_ID}.reaping`],
      ['a dot-family residue', `.${COL_ID}.compactset.4242`],
    ] as const)('a junk witness beside a registry row answers registered and journals nothing: %s', (_what, row) => {
      makeOrphan(h);
      junkWitness();
      fs.writeFileSync(path.join(regDir(h), row), '8');
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a), 'registered keeps its place ahead of witness-mismatch').toBe('registered');
      expect(String(a.doc!['detail'])).toContain(row);
      expect(readJournal(h.home), 'a retryable word is journaled nowhere').toEqual([]);
      expect(locked(), 'the lock belongs to an id with a row').toBe(true);
    }, 60_000);

    it('a junk witness beside a `.child` whose absence cannot be measured takes the lock and answers unmeasured registry', () => {
      makeOrphan(h);
      junkWitness();
      const a = collectAudit(h, { pre: UNMEASURABLE_CHILD });
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('registry');
      expect(String(a.doc!['detail'])).toContain(`${COL_ID}.child could not be looked at`);
      expect(readJournal(h.home)).toEqual([]);
      expect(locked(), 'a row the peek could not rule out opens the lock, as today').toBe(true);
    }, 60_000);

    it.skipIf(ROOT)('a junk witness beside a registry that can be searched but not listed takes the lock and answers unmeasured registry', () => {
      makeOrphan(h);
      junkWitness();
      const reg = regDir(h);
      fs.writeFileSync(path.join(reg, `${COL_ID}.hold`), 'x');
      const mode = fs.statSync(reg).mode & 0o777;
      fs.chmodSync(reg, 0o300);
      let a: Answer;
      try { a = collectAudit(h); } finally { fs.chmodSync(reg, mode); }
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('registry');
      expect(String(a.doc!['detail'])).toContain('wildcard listing');
      expect(readJournal(h.home)).toEqual([]);
      expect(locked(), 'a glob that cannot list is no proof of no row: the lock opens, as today').toBe(true);
    }, 60_000);

    it('a parsed witness, and a record with no witness, still take the lock', () => {
      makeOrphan(h);
      const w = collectAudit(h, { pre: AGED });
      expect(w.code, w.stderr).toBe(0);
      expect(verdictOf(w), 'a parsed witness is judged under the lock').toBe('collectable');
      expect(locked(), 'its lock was taken').toBe(true);
      const { leaf } = makeOrphan(h, REC_ID);
      plantRecord(h, recName(REC_ID), recordLine(recordFor(identityOf(leaf), REC_ID)));
      fs.rmSync(witnessOf(h, REC_ID));
      const r = collectAudit(h, { id: REC_ID });
      expect(r.code, r.stderr).toBe(0);
      expect(r.doc, 'a parsed record is judged under the lock').toMatchObject({ resume: 'unmoved', verdict: 'collectable' });
      expect(locked(REC_ID), 'its lock was taken').toBe(true);
    }, 90_000);
  });

  describe('the verb, ws-collect', () => {
    it('a junk witness is refused witness-mismatch at exit 0, the detail says "no lock was taken", and there is no lock', () => {
      const { leaf } = makeOrphan(h);
      junkWitness();
      const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      const doc = docOf(r.stdout);
      expect(doc['refused']).toBe('witness-mismatch');
      expect(String(doc['detail'])).toMatch(/^no lock was taken: the witness /);
      expect(String(doc['detail'])).toContain('cannot be read as ccd writes it');
      expect(eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'], e['verb']]))
        .toEqual([['refused', 'witness-mismatch', 'ws-collect']]);
      expect(locked()).toBe(false);
      expect(fs.existsSync(path.join(leaf, 'cdk.out', 'manifest.json')), 'nothing moved').toBe(true);
    }, 60_000);

    it('a junk witness with the pause standing is refused witness-mismatch, not paused, with no lock', () => {
      makeOrphan(h);
      junkWitness();
      const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID, pre: PAUSE });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(docOf(r.stdout)['refused'], 'the pass answers before the pause, which is read under the lock')
        .toBe('witness-mismatch');
      expect(fs.existsSync(path.join(regDir(h), 'reclaim-paused')), 'the CONTROL: the pause stood').toBe(true);
      expect(locked()).toBe(false);
    }, 60_000);

    it('a junk record is refused quarantine-kept, with no lock', () => {
      const rec = plantRecord(h, recName(), JUNK_RECORD);
      const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      const doc = docOf(r.stdout);
      expect(doc['refused']).toBe('quarantine-kept');
      expect(String(doc['detail'])).toMatch(/^no lock was taken: the quarantine record /);
      expect(locked()).toBe(false);
      expect(fs.readFileSync(rec, 'utf8'), 'the record is kept as it stands').toBe(JUNK_RECORD);
    }, 60_000);

    it('an id with no dash fails probe-unmeasured at exit 1, with no lock', () => {
      makeOrphan(h, NODASH);
      const r = collectVerb(h, WRONG_TOKEN, { id: NODASH });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      expect(doc['detail'], 'the locked evaluation’s detail first, the no-lock clause after it')
        .toBe(`${NODASH} names no project and slug, so whether its slug is free cannot be asked;`
          + ' no lock was taken, and nothing was moved or removed');
      expect(locked(NODASH)).toBe(false);
    }, 60_000);

    it('a resume record whose slot cannot be derived keeps "was never derived" whole: the detail first, then the no-lock clause', () => {
      // THE RESUME'S SHAPE: a crashed run's slot holds the leaf, and its record names it. The reader's rc 3 (the
      // physical ~/.cc-tmp stops resolving) is stubbed as `ccd-ws-collect-resume.test.ts` stubs it, so the pass
      // answers unmeasured `quarantine` in the locked evaluation's words, before any lock. `_ws_leaf_why_line` cuts the
      // verb's line at 300 bytes. The stub's why is padded by a length the case computes from its OWN record path, so
      // the operative clause ends between byte 248 and byte 300 of the detail-first line at any TMPDIR: the 53-byte
      // clause "no lock was taken, and nothing was moved or removed" ahead of the detail would push it past the cut.
      const { leaf } = makeOrphan(h);
      const ident = identityOf(leaf);
      const slot = moveIntoSlot(h);
      const rec = plantRecord(h, recName(), recordLine(recordFor(ident)));
      const STUB = 'stub: ~/.cc-tmp cannot be resolved';
      /** The detail-first line through its operative clause, as `_ws_leaf_why_line` spells it ("—" reads "-"). */
      const head = (why: string): string => `${why} - the slot of ${rec} was never derived`;
      const why = STUB + '_'.repeat(Math.max(0, 274 - Buffer.byteLength(head(STUB))));
      const end = Buffer.byteLength(head(why));
      expect(end, `the clause ends inside the window (a ${Buffer.byteLength(rec)}-byte record path)`).toBeGreaterThanOrEqual(248);
      expect(end, `the clause ends inside the window (a ${Buffer.byteLength(rec)}-byte record path)`).toBeLessThanOrEqual(300);
      const unresolved = `_ws_collect_record_read() { [[ -e "$1" ]] || return 1; _WS_QPATH_WHY='${why}'; return 3; };`;
      const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID, pre: unresolved });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      const detail = String(doc['detail']);
      expect(detail, 'the operative clause survives the cut').toContain('was never derived');
      expect(detail.startsWith(head(why)), `the locked evaluation's detail comes first: ${detail}`).toBe(true);
      expect(detail.endsWith('…'), 'the line was cut, after the operative clause').toBe(true);
      expect(eventsOf(h.home, 'collect').at(-1), 'one detail, journaled as printed')
        .toMatchObject({ outcome: 'failed', refusal: 'probe-unmeasured', detail });
      expect(locked(), 'no lock was taken').toBe(false);
      expect(identityOf(path.join(slot, 'leaf')).ino, 'the slot’s leaf, untouched').toBe(ident.ino);
      expect(fs.readFileSync(rec, 'utf8'), 'the record stands as it was').toBe(recordLine(recordFor(ident)));
    }, 60_000);
  });
});

describe('the source: one dash-free sentence, and a pass that writes nothing (path-identity spec §2.5)', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  /** `name`'s body, from its head line to its first closing brace at column 0, or '' when it is not defined. */
  const bodyOf = (name: string): string => {
    const a = src.indexOf(`\n${name}() {`);
    const b = a > -1 ? src.indexOf('\n}\n', a) : -1;
    return b > a ? src.slice(a, b) : '';
  };
  const SENTENCE = 'names no project and slug, so whether its slug is free cannot be asked';

  it('the sentence an id with no dash answers is spelled once, in _ws_collect_slug_askable', () => {
    expect(src.split(SENTENCE).length - 1, 'the sentence is spelled once').toBe(1);
    expect(bodyOf('_ws_collect_slug_askable')).toContain(SENTENCE);
    expect(bodyOf('_ws_collect_registered')).toContain('_ws_collect_slug_askable "$id" || return 2');
  });

  it('the pass prints nothing, journals nothing and opens no lock of its own', () => {
    const code = bodyOf('_ws_collect_prelock').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code.length, 'the pass could not be sliced').toBeGreaterThan(600);
    expect(code, 'it journals nothing: the audit document and _ws_collect_refused do').not.toMatch(/\b_lc_[a-z_]+/);
    expect(code, 'it prints nothing').not.toMatch(/\b(?:printf|echo)\b/);
    expect(code, 'it opens no lock').not.toMatch(/\bexec\s*\{|\bflock\b/);
  });
});
