// path-identity W2, Task 10: ccd admits a sole parseable compare-and-drop aside before the lock, and judges it as the
// witness (path-identity spec §3.6; TR6 A, Option X). A crash inside the collector's compare-and-drop can leave the
// witness at its aside, `$REG/tmproots/.<id>.drop.<pid>`, and no witness. The server composes `ws-collect` only after
// two `collectable` audits with one token, so the AUDIT must judge such an id, or nothing ever restores the aside:
// - a SOLE aside that parses as the id's witness is judged as the witness, read-only, and the token it mints is the
//   one the witness itself mints (the token binds the witness's fields, never its file name);
// - two or more asides, or one that does not parse, answer the per-leaf probe word `aside` (R20), and only after the
//   registry peek, so a row keeps `registered` (R23); asides that cannot be listed keep `witness`;
// - an old-generation aside beside a new leaf is the terminal `witness-mismatch`, its uncut detail naming the aside
//   (R19, P11; the stated residual `stale-aside-beside-a-new-leaf-is-a-mismatch`).
// NOTHING HERE RESTORES AN ASIDE: the restore is the settle's, under the reap lock (Task 11), and every verb case here
// holds on either side of it.
// FIXTURE HOME ONLY (`makePrHarness`): every path derives from `h.home`, and both verbs run as SOURCED functions, never
// through the installed launcher and never against the live HOME. Every audit that reaches the in-use probe stubs it
// (`NOBODY`), so no case shells the real /proc walk. Linux only where the collector measures: on Darwin the audit
// answers unmeasured `platform` before it reads anything. The source case runs everywhere.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf, readJournal, refusalsOf } from './lifecycleHelpers.js';
import {
  AGED, COL_ID, NO_WALK, collectAudit, collectForkOf, collectOf, holdLock, lockOf, makeOrphan, regDir, replaceLeaf,
  verdictOf, walked, witnessOf,
} from './collectFixture.js';
import { NOBODY } from './collectRaceFixture.js';
import { WRONG_TOKEN, collectVerb, docOf } from './wsCollectFixture.js';
import { collectProbeClass } from '../src/collectLane.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-aside-admission-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
/** Another id: the one a foreign body names, and the one a foreign aside is for. */
const OTHER_ID = 'demo-quiet-other';
/** `$REG/tmproots/.<id>.drop.<pid>`, the name `_ws_collect_witness_cad` moves a witness to (ccd composes it once, in
 *  `_ws_tmproot_aside_path`; it is spelled here for the fixture alone). */
const asideOf = (pid: number, id: string = COL_ID): string =>
  path.join(path.dirname(witnessOf(h)), `.${id}.drop.${pid}`);
/** The witness moved to an aside BYTE FOR BYTE, as a crash inside the compare-and-drop leaves it. Returns its body. */
const toAside = (pid = 4242): string => {
  const body = fs.readFileSync(witnessOf(h), 'utf8');
  fs.renameSync(witnessOf(h), asideOf(pid));
  return body;
};
const locked = (): boolean => fs.existsSync(lockOf(h));
/** The lock an earlier audit of the same disk made, removed BY HAND (a fixture HOME: ccd itself never unlinks a reap
 *  lock), so that the next audit's lock is its own. */
const unlock = (): void => { fs.rmSync(lockOf(h)); };
/** `_ws_collect_asides_of` answering "could not be listed". */
const ASIDES_UNLISTABLE = '_ws_collect_asides_of() { _WS_ASIDES_WHY=stub; return 2; };';
/** `_ws_collect_prelock`, logged on entry to `$HOME/prelock-calls`, then the real one. */
const PRELOCK_SPY = 'eval "_orig_prelock() $(declare -f _ws_collect_prelock | tail -n +2)";'
  + ' _ws_collect_prelock() { printf \'%s\\n\' "$1" >> "$HOME/prelock-calls"; _orig_prelock "$@"; };';
/** `_ws_collect_aside_judge` asked in THIS shell after a reset, everything it prints caught in `$HOME/judge-out`:
 *  `[rc=<rc>] <aside read>|<probe>|<verdict>|<run read>`. */
const JUDGE = `_ws_collect_reset; _ws_collect_aside_judge ${COL_ID} >"$HOME/judge-out" 2>&1; rc=$?;`
  + ' printf \'[rc=%s] %s|%s|%s|%s\' "$rc" "$_WS_COLLECT_ASIDE" "$_WS_COLLECT_PROBE" "$REAP_VERDICT" "$_WS_WIT_RUN"';

describe.skipIf(!LINUX)('an id a compare-and-drop aside is for: admitted before the lock, judged as the witness (path-identity spec §3.6)', () => {
  it('case 1: aside-only, the leaf absent: collectable, the token the witness minted, and a lock of its own', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    const before = collectAudit(h, { pre: NO_WALK });
    expect(verdictOf(before), 'the CONTROL: the witness in place, its leaf gone').toBe('collectable');
    unlock();
    const body = toAside();
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stdout + a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('collectable');
    expect(a.doc!['token'], 'the token binds the witness’s fields, never its file name').toBe(before.doc!['token']);
    expect(collectOf(a)['witness'], 'the document reports the aside’s fields as the witness')
      .toEqual(collectOf(before)['witness']);
    expect(collectOf(a)['unmeasured']).toBeNull();
    expect(locked(), 'the aside put the id in the population, and the pass let the lock open').toBe(true);
    expect(fs.existsSync(witnessOf(h)), 'the audit reads only: nothing is restored').toBe(false);
    expect(fs.readFileSync(asideOf(4242), 'utf8'), 'the aside stands as it was').toBe(body);
    expect(walked(h), 'nothing to walk').toBe(false);
    expect(readJournal(h.home), 'a collectable answer is journaled nowhere').toEqual([]);
  }, 60_000);

  it('case 2: aside-only, the leaf present: collectable through the full ladder, with the token the witness minted', () => {
    const { leaf } = makeOrphan(h);
    const pre = `${AGED} ${NOBODY}`;
    const before = collectAudit(h, { pre });
    expect(verdictOf(before), 'the CONTROL: the witness in place').toBe('collectable');
    unlock();
    toAside();
    const a = collectAudit(h, { pre });
    expect(a.code, a.stdout + a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ exists: true, verdict: 'collectable' });
    expect(a.doc!['token'], 'the same token through the full ladder').toBe(before.doc!['token']);
    expect(collectOf(a)['witness']).toEqual(collectOf(before)['witness']);
    expect(locked()).toBe(true);
    expect(fs.existsSync(path.join(leaf, 'cdk.out', 'manifest.json')), 'nothing moved').toBe(true);
    expect(fs.existsSync(witnessOf(h)), 'nothing is restored').toBe(false);
  }, 90_000);

  it('case 3: two parseable asides and no witness: unmeasured `aside`, exit 1, no lock, nothing journaled', () => {
    makeOrphan(h);
    const body = toAside(4242);
    fs.writeFileSync(asideOf(4243), body);
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stdout).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('aside');
    const d = String(a.doc!['detail']);
    expect(d).toMatch(new RegExp(`^2 compare-and-drop asides of ${COL_ID} stand and no witness does`));
    expect(d, 'each is named (the audit document’s detail is the uncut REAP_DETAIL)').toContain(asideOf(4242));
    expect(d).toContain(asideOf(4243));
    expect(collectOf(a)['witness'], 'neither is read as the witness').toBeNull();
    expect(locked(), 'never chosen between: no lock').toBe(false);
    expect(walked(h), 'no evaluation ran').toBe(false);
    expect(readJournal(h.home), 'unmeasured is journaled nowhere').toEqual([]);
  }, 60_000);

  it('case 4: one aside whose body is `x`, and no witness: unmeasured `aside`, no lock', () => {
    makeOrphan(h);
    fs.rmSync(witnessOf(h));
    fs.writeFileSync(asideOf(4242), 'x');
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stdout).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('aside');
    expect(String(a.doc!['detail']))
      .toMatch(new RegExp(`^the one compare-and-drop aside of ${COL_ID} does not read as its witness`));
    expect(locked()).toBe(false);
    expect(fs.readFileSync(asideOf(4242), 'utf8'), 'the aside stands as it was').toBe('x');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('case 5: an aside whose body names another id: unmeasured `aside`, no lock', () => {
    makeOrphan(h);
    const body = toAside();
    const foreign = body.replace(` id=${COL_ID} `, ` id=${OTHER_ID} `);
    expect(foreign, 'the fixture names another id').not.toBe(body);
    fs.writeFileSync(asideOf(4242), foreign);
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stdout).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('aside');
    expect(String(a.doc!['detail']))
      .toMatch(new RegExp(`^the one compare-and-drop aside of ${COL_ID} does not read as its witness`));
    expect(locked()).toBe(false);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('case 6: the asides cannot be listed, no witness and no record: unmeasured `witness`, exit 1, no lock — never not-witnessed', () => {
    makeOrphan(h);
    toAside();
    const a = collectAudit(h, { pre: ASIDES_UNLISTABLE });
    expect(a.code, a.stdout).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured'], 'a listing failure keeps the box-wide word (R20)').toBe('witness');
    expect(a.doc!['detail']).toBe(`stub — whether a compare-and-drop aside of ${COL_ID} stands was never asked`);
    expect(locked()).toBe(false);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('case 7: the verb, aside-only, a wrong token: it reaches the lock and answers refused state-changed', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    toAside();
    const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc['refused'], 'judged under the lock, then its token compared').toBe('state-changed');
    expect(String(doc['detail'])).toMatch(/^nothing was moved: /);
    expect(locked(), 'the population admitted it, and the pass let the lock open').toBe(true);
    expect(eventsOf(h.home, 'collect').at(-1))
      .toMatchObject({ outcome: 'refused', refusal: 'state-changed', verb: 'ws-collect' });
  }, 60_000);

  it('case 8: two asides beside a registry row: the peek opens the lock, and the answer is `registered`, unjournaled (R23)', () => {
    makeOrphan(h);
    const body = toAside(4242);
    fs.writeFileSync(asideOf(4243), body);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.uuid`), '8');
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stdout + a.stderr).toBe(0);
    expect(verdictOf(a), '`registered` keeps its place ahead of `aside`').toBe('registered');
    expect(String(a.doc!['detail'])).toContain(`${COL_ID}.uuid`);
    expect(collectOf(a)['unmeasured']).toBeNull();
    expect(locked(), 'the lock belongs to an id with a row').toBe(true);
    expect(readJournal(h.home), 'a retryable word is journaled nowhere').toEqual([]);
  }, 60_000);

  it('case 8b: the same disk, the lock held by another: in-progress, with no probe word left over from the pass', () => {
    makeOrphan(h);
    const body = toAside(4242);
    fs.writeFileSync(asideOf(4243), body);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.uuid`), '8');
    const a = collectAudit(h, { pre: `${NO_WALK} ${holdLock()}` });
    expect(a.code, a.stdout + a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('in-progress');
    expect(collectOf(a)['unmeasured'], 'the pass’s first aside answer was cleared before the peek').toBeNull();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('case 9: an old-generation aside beside a new leaf: terminal witness-mismatch, journaled, its detail naming the aside (R19, P11)', () => {
    makeOrphan(h);
    const body = toAside();
    expect(body, 'the old generation').toMatch(/ run=7 /);
    const leaf = replaceLeaf(h);
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stdout + a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('witness-mismatch');
    expect(refusalsOf(h.home), 'journaled once').toEqual([{ act: 'collect', token: 'witness-mismatch' }]);
    const f = collectForkOf(h, { pre: AGED });
    expect(f.verdict).toBe('witness-mismatch');
    expect(f.detail.startsWith(`${leaf} is `), 'the leaf leads').toBe(true);
    expect(f.detail, 'the uncut detail names the aside where it would say "its witness"')
      .toContain(`the compare-and-drop aside ${asideOf(4242)} (read as its witness) names`);
    expect(fs.existsSync(witnessOf(h)), 'nothing is restored: stale-aside-beside-a-new-leaf-is-a-mismatch').toBe(false);
    expect(fs.readFileSync(asideOf(4242), 'utf8')).toBe(body);
  }, 60_000);

  it('case 9b: an aside judged as the witness, a link at the leaf’s path: witness-mismatch, its detail naming the aside (P11)', () => {
    const { leaf } = makeOrphan(h);
    toAside();
    const moved = path.join(h.home, 'moved');
    fs.renameSync(leaf, moved);
    fs.symlinkSync(moved, leaf);
    const a = collectAudit(h, { pre: AGED });
    expect(verdictOf(a)).toBe('witness-mismatch');
    const f = collectForkOf(h, { pre: AGED });
    expect(f.verdict).toBe('witness-mismatch');
    expect(f.detail).toContain('is a link or not a directory');
    expect(f.detail)
      .toContain(`the collector takes only the directory the compare-and-drop aside ${asideOf(4242)} (read as its witness) names`);
    expect(fs.existsSync(path.join(moved, 'cdk.out', 'manifest.json')), 'nothing behind the link is touched').toBe(true);
  }, 60_000);

  it('case 9c: an aside that records no birth time: witness-mismatch, its detail naming the aside (P11)', () => {
    makeOrphan(h);
    const body = toAside();
    expect(body, 'the fixture box records a birth time').toMatch(/ btime=[1-9][0-9]* /);
    fs.writeFileSync(asideOf(4242), body.replace(/ btime=[1-9][0-9]* /, ' btime=- '));
    const a = collectAudit(h, { pre: AGED });
    expect(verdictOf(a)).toBe('witness-mismatch');
    const f = collectForkOf(h, { pre: AGED });
    expect(f.detail.startsWith(`the compare-and-drop aside ${asideOf(4242)}, read as the witness of ${COL_ID},`
      + ' records no birth time'), f.detail).toBe(true);
  }, 60_000);

  it('case 10: no witness, no record and no aside of ITS id: not-witnessed before any lock, in today’s words (control)', () => {
    const dir = path.dirname(witnessOf(h));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const n of [`.${OTHER_ID}.drop.5`, `.${COL_ID}.v2-x.drop.3`, `.${COL_ID}.123.456.tmp`, `.${COL_ID}.drop.x`]) {
      fs.writeFileSync(path.join(dir, n), 'x');
    }
    const a = collectAudit(h);
    expect(a.code, a.stdout + a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('not-witnessed');
    expect(a.doc!['detail']).toBe(`no witness stands for ${COL_ID} and no quarantine record names it — ccd never handed`
      + ' out a temp root under this id that is still to be collected');
    expect(locked()).toBe(false);
    const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = docOf(r.stdout);
    expect(doc['refused']).toBe('not-witnessed');
    expect(String(doc['detail'])).toMatch(/^no lock was taken, and there is nothing to collect: no witness \(/);
    expect(String(doc['detail'])).toContain(witnessOf(h));
    expect(locked()).toBe(false);
  }, 60_000);

  it('case 11: the verb, no witness and no record, the asides unlistable: failed probe-unmeasured in the records statement, before the pass, no lock', () => {
    makeOrphan(h);
    toAside();
    const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID, pre: `${ASIDES_UNLISTABLE} ${PRELOCK_SPY}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('probe-unmeasured');
    expect(String(doc['detail'])).toMatch(
      /^no lock was taken, and nothing was moved or removed: no witness stands for demo-\S+, and its compare-and-drop asides could not be listed \(stub\)/);
    expect(fs.existsSync(path.join(h.home, 'prelock-calls')), 'answered before the pre-lock pass').toBe(false);
    expect(locked()).toBe(false);
  }, 60_000);

  it('case 13: the judge’s contract — rc, globals, nothing printed — and _ws_collect_reset clears the aside it read', () => {
    makeOrphan(h);
    const body = fs.readFileSync(witnessOf(h), 'utf8');
    fs.rmSync(witnessOf(h));
    const out = path.join(h.home, 'judge-out');
    const judge = (pre = ''): string => {
      const s = h.sh(`${pre} ${JUDGE}`);
      expect(fs.readFileSync(out, 'utf8'), 'the judge prints nothing').toBe('');
      return s;
    };
    expect(judge(), 'no aside stands: 1, nothing set').toBe('[rc=1] |||');
    fs.writeFileSync(asideOf(4242), body);
    expect(judge(), 'the sole aside parses as the witness').toBe(`[rc=0] ${asideOf(4242)}|||7`);
    expect(h.sh(`${JUDGE}; _ws_collect_reset; printf ' [%s]' "$_WS_COLLECT_ASIDE"`), 'the reset clears it')
      .toBe(`[rc=0] ${asideOf(4242)}|||7 []`);
    expect(judge(ASIDES_UNLISTABLE), 'a listing failure keeps `witness`').toBe('[rc=2] |witness|unmeasured|');
    fs.writeFileSync(asideOf(4243), body);
    expect(judge(), 'two are never chosen between').toBe('[rc=2] |aside|unmeasured|');
    fs.rmSync(asideOf(4243));
    fs.writeFileSync(asideOf(4242), 'x');
    expect(judge(), 'one that does not parse').toBe('[rc=2] |aside|unmeasured|');
  }, 90_000);
});

describe('the probe word `aside`: answered by the aside judge alone, listed per-leaf by the lane (R20)', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  /** Whole-line `#` comments dropped, so prose that names a call is never read as one. */
  const code = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  /** `name`'s body, from its head line to its first closing brace at column 0, or '' when it is not defined. */
  const bodyOf = (name: string): string => {
    const a = src.indexOf(`\n${name}() {`);
    const b = a > -1 ? src.indexOf('\n}\n', a) : -1;
    return b > a ? src.slice(a, b) : '';
  };
  const calls = (t: string): number => [...code(t).matchAll(/_ws_collect_unmeasured aside\b/g)].length;

  it('case 12: every `_ws_collect_unmeasured aside` lies in _ws_collect_aside_judge, and the lane classes `aside` per-leaf', () => {
    const judge = bodyOf('_ws_collect_aside_judge');
    expect(judge.length, 'the judge could not be sliced').toBeGreaterThan(300);
    expect(calls(judge), 'its two answers: two or more, and one that does not parse').toBe(2);
    expect(calls(src), 'and no other site answers `aside`').toBe(calls(judge));
    expect(collectProbeClass('aside'), 'a fact about this temp root that will not change by itself').toBe('per-leaf');
  });
});
