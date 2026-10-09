// `ws-audit --session <id> --collect`: the temp-root collector's audit (spec §5.10), read as the server's lane will
// read it — ONE JSON document on stdout, exit 1 only when a probe could not answer. The fresh rungs are held one by
// one in `ccd-collect-audit-rungs.test.ts`, the resume of a standing quarantine record in
// `ccd-collect-audit-resume.test.ts`. This file holds the document, the token, the population rule, the lock, the
// exits, the journal, the hand-off, the two declared words and the source pins.
// FIXTURE HOME ONLY (`collectFixture.ts`). Linux only where the collector measures: on Darwin it answers unmeasured
// before it reads anything, which the platform case pins on every platform.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf, readJournal, refusalsOf } from './lifecycleHelpers.js';
import { holdCwd } from './wsExpireFixture.js';
import { LC_REFUSAL_WORD, isLcRefusalToken } from '../../shared/api.js';
import {
  AGED, AGED_NS, COL_ID, NO_MV, PAUSE, collectAudit, collectForkOf, collectOf, holdLock, identityOf, leafOf, lockOf,
  makeOrphan, plantRecord, recName, recordFor, recordLine, regDir, replaceLeaf, verdictOf, walkAt, walkUnmeasured,
  witnessOf,
} from './collectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-audit-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';

describe.skipIf(!LINUX)('ws-audit --collect: the document and the token', () => {
  it('a witnessed orphan past the idle floor is collectable: the document, in order, and the fork’s own token', () => {
    const { leaf } = makeOrphan(h);
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(Object.keys(a.doc!)).toEqual(['session', 'mode', 'exists', 'collect', 'verdict', 'detail', 'token']);
    expect(a.doc).toMatchObject({ session: COL_ID, mode: 'collect', exists: true, verdict: 'collectable', detail: '' });
    const c = collectOf(a);
    expect(Object.keys(c)).toEqual(['leaf', 'witness', 'records', 'newestCtimeNs', 'entries', 'floorS', 'idleAt', 'unmeasured']);
    expect(c).toMatchObject({
      leaf, records: [], newestCtimeNs: String(AGED_NS), entries: 3, floorS: 86_400, unmeasured: null,
      idleAt: Number(AGED_NS / 1_000_000_000n) + 86_400,
    });
    const id = identityOf(leaf);
    expect(c['witness']).toMatchObject({ dev: id.dev, ino: id.ino, btime: id.btime, run: '7' });
    expect(a.doc!['token']).toMatch(/^[0-9a-f]{64}$/);
    expect(a.doc!['token'], 'the audit prints what the one shared evaluation mints')
      .toBe(collectForkOf(h, { pre: AGED }).token);
  }, 60_000);

  it('the token moves with each fact it binds: the newest change, the entry count, the witness', () => {
    makeOrphan(h);
    const t0 = collectForkOf(h, { pre: walkAt(AGED_NS, 3) }).token;
    expect(t0).toMatch(/^[0-9a-f]{64}$/);
    expect(collectForkOf(h, { pre: walkAt(AGED_NS + 1n, 3) }).token, 'the newest change').not.toBe(t0);
    expect(collectForkOf(h, { pre: walkAt(AGED_NS, 4) }).token, 'the entry count').not.toBe(t0);
    // A later run is handed the same leaf: the witness is rewritten (its run and at move), the leaf is not.
    h.sh(`_reg_set ${COL_ID} child 8 && _child_tmpdir ${COL_ID} >/dev/null && rm -f "$REG/${COL_ID}.child"`);
    expect(collectForkOf(h, { pre: walkAt(AGED_NS, 3) }).token, 'the witness').not.toBe(t0);
  }, 90_000);

  it('it reads, and writes nothing it judges: the lock it held is the one file it adds', () => {
    const { leaf } = makeOrphan(h);
    const snap = (): Record<string, unknown> => ({
      leaf: (fs.readdirSync(leaf, { recursive: true }) as string[]).map(String).sort(),
      mtime: fs.statSync(leaf).mtimeMs,
      witness: fs.readFileSync(witnessOf(h), 'utf8'),
      tmp: fs.readdirSync(path.dirname(leaf)).sort(),
    });
    const regBefore = fs.readdirSync(regDir(h)).sort();
    const before = snap();
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('collectable');
    expect(snap()).toEqual(before);
    expect(fs.readdirSync(regDir(h)).sort(), 'the one file the audit adds is the lock it held')
      .toEqual([...regBefore, `.reap-${COL_ID}.lock`].sort());
    expect(readJournal(h.home), 'a collectable answer is journaled nowhere').toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('the population: a witness or a record of the id, and a foreign name is never locked', () => {
  it('no witness and no record: not-witnessed, exit 0, no lock file, nothing journaled', () => {
    const a = collectAudit(h, { id: 'demo-foreign-name' });
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ verdict: 'not-witnessed', exists: false });
    expect(a.doc!['token']).toBeUndefined();
    expect(fs.existsSync(lockOf(h, 'demo-foreign-name')), 'a name ccd never handed a temp root gets no lock').toBe(false);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('the record lookup is EXACT: a nested id’s record never puts its parent in the population', () => {
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    const nested = `${COL_ID}.7`;
    plantRecord(h, recName(nested), recordLine(recordFor({ dev: '1', ino: '2', btime: '3' }, nested)));
    plantRecord(h, `${COL_ID}.123.abc`, 'not a record of anyone\n');
    const parent = collectAudit(h);
    expect(verdictOf(parent)).toBe('not-witnessed');
    expect(fs.existsSync(lockOf(h)), `${COL_ID} is not in the population`).toBe(false);
    const child = collectAudit(h, { id: nested });
    expect(child.code, child.stderr).toBe(0);
    expect(collectOf(child)['records']).toEqual([recName(nested)]);
    expect(verdictOf(child), 'a record alone is the population').toBe('collectable');
    expect(child.doc!['resume'], 'nothing stands at either place: the record only waits to be dropped').toBe('removed');
    expect(fs.existsSync(lockOf(h, nested))).toBe(true);
  }, 60_000);

  it('a witness behind a tmproots/ that is itself a link is never followed: unmeasured, exit 1, no lock', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, COL_ID), 'v=1 planted\n');
    fs.symlinkSync(elsewhere, path.join(regDir(h), 'tmproots'));
    const a = collectAudit(h);
    expect(a.code).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('witness');
    expect(fs.existsSync(lockOf(h))).toBe(false);
  }, 60_000);

  it('an id ccd never mints dies before anything is read: nothing on stdout, no lock', () => {
    for (const bad of ['.hidden', 'a/b', 'x y']) {
      const r = h.run(`cmd_ws_audit --session '${bad}' --collect`);
      expect(r.code, bad).toBe(1);
      expect(r.stdout, bad).toBe('');
      expect(r.stderr, bad).toContain('bad session id');
    }
    expect(fs.readdirSync(regDir(h)).filter((f) => f.startsWith('.reap-'))).toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('the lock: another holder of the id’s reap lock', () => {
  it('answers in-progress, exit 0, no token, nothing journaled — and released, the same leaf is collectable', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} ${holdLock()}` });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('in-progress');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
    expect(verdictOf(collectAudit(h, { pre: AGED })), 'the CONTROL: released').toBe('collectable');
  }, 60_000);
});

describe.skipIf(!LINUX)('unmeasured: exit 1, the probe named, no token, journaled nowhere', () => {
  it.each(['timeout', 'unreadable', 'cap', 'walk-failed'])('the idle walk answers %s', (why) => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: walkUnmeasured(why) });
    expect(a.code).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe(`idle:${why}`);
    expect(a.doc!['token']).toBeUndefined();
    expect(a.stderr).toContain('ws-audit --collect measured nothing');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('a walk that answers a word it does not have, or no number, reads walk-failed', () => {
    makeOrphan(h);
    for (const pre of [
      '_ws_collect_idle() { _WS_IDLE_NEWEST_NS=; _WS_IDLE_COUNT=; _WS_IDLE_WHY=bogus; _WS_IDLE_DETAIL=x; _WS_IDLE_LEAF=; return 2; };',
      '_ws_collect_idle() { _WS_IDLE_NEWEST_NS=abc; _WS_IDLE_COUNT=3; _WS_IDLE_WHY=; _WS_IDLE_DETAIL=; _WS_IDLE_LEAF="$1"; return 0; };']) {
      const a = collectAudit(h, { pre });
      expect(a.code, pre).toBe(1);
      expect(collectOf(a)['unmeasured'], pre).toBe('idle:walk-failed');
    }
  }, 60_000);

  // `collectable` MEANS a token: each of the three mints — the fresh present leaf's, the witness-only arm's and a
  // resume's — answers unmeasured `token` when what it minted is not 64 lowercase hex.
  const NOT_HEX = '_ws_reclaim_fingerprint() { echo nothex; };';
  const expectNoToken = (a: ReturnType<typeof collectAudit>): void => {
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('token');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  };
  it('a token that could not be minted, fresh present leaf: unmeasured `token`, never collectable', () => {
    makeOrphan(h);
    expectNoToken(collectAudit(h, { pre: `${AGED} ${NOT_HEX}` }));
  }, 60_000);
  it('a token that could not be minted, witness whose leaf is proven gone: unmeasured `token`, never collectable', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    expectNoToken(collectAudit(h, { pre: NOT_HEX }));
  }, 60_000);
  it('a token that could not be minted, a resume: unmeasured `token`, never collectable', () => {
    const { leaf } = makeOrphan(h);
    plantRecord(h, recName(), recordLine(recordFor(identityOf(leaf))));
    expectNoToken(collectAudit(h, { pre: NOT_HEX }));
  }, 60_000);

  it('a box whose mv has no --no-copy: unmeasured `mv`', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} ${NO_MV}` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('mv');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

describe('on Darwin the collector measures nothing: unmeasured `platform`, exit 1, no lock', () => {
  it('answers before it reads the population', () => {
    const a = collectAudit(h, { pre: 'CCD_OS=darwin;' });
    expect(a.code).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('platform');
    expect(fs.existsSync(lockOf(h))).toBe(false);
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('the journal: a TERMINAL refusal, act collect, verb ws-audit, and nothing else', () => {
  it('witness-mismatch is journaled; changed-recently, through the REAL walk, is not', () => {
    makeOrphan(h);
    expect(verdictOf(collectAudit(h)), 'a fresh leaf').toBe('changed-recently');
    expect(readJournal(h.home), 'a retryable word is never journaled').toEqual([]);
    replaceLeaf(h);
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('witness-mismatch');
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'witness-mismatch' }]);
    expect(eventsOf(h.home, 'collect')[0]!['verb']).toBe('ws-audit');
  }, 60_000);

  it.each([
    ['registered', (): string => { fs.writeFileSync(path.join(regDir(h), `${COL_ID}.uuid`), 'u'); return AGED; }],
    ['in-use', (): string => AGED],
    ['paused', (): string => `${AGED} ${PAUSE}`],
    ['in-progress', (): string => `${AGED} ${holdLock()}`],
    ['unmeasured', (): string => walkUnmeasured('timeout')],
  ] as const)('%s is journaled nowhere', (word, arrange) => {
    const { leaf } = makeOrphan(h);
    const pre = arrange();
    const p = word === 'in-use' ? holdCwd(leaf) : null;
    try {
      expect(verdictOf(collectAudit(h, { pre }))).toBe(word);
    } finally { p?.stop(); }
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('the detail it journals is ONE line cut at 300 bytes; the document carries it whole', () => {
    makeOrphan(h);
    const why = `_ws_collect_rows_clear() { _WS_COLLECT_ROWS_WHY="$(printf 'x%.0s' {1..600})"$'\\n'second; return 1; };`;
    const a = collectAudit(h, { pre: `${AGED} ${why}` });
    expect(verdictOf(a)).toBe('containment-unproven');
    expect(String(a.doc!['detail']).length, 'the document is not cut').toBeGreaterThan(600);
    const detail = String(eventsOf(h.home, 'collect')[0]!['detail']);
    expect(detail).not.toContain('\n');
    expect(detail.length).toBeLessThanOrEqual(301);
    expect(detail.endsWith('…')).toBe(true);
  }, 60_000);
});

describe('the hand-off: `--collect` third and alone; the plain audit never takes it', () => {
  it('a fourth argument is a usage error that names --collect, with nothing on stdout', () => {
    const r = h.run(`cmd_ws_audit --session ${COL_ID} --collect --defer-expired`);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire | --collect]');
  }, 60_000);

  it('the plain audit carries no collect mode', () => {
    const r = h.run(`cmd_ws_audit --session ${COL_ID}`);
    expect(r.stdout).not.toContain('"mode":"collect"');
    expect(r.stdout).not.toContain('collectable');
  }, 60_000);
});

describe('the two TERMINAL words are declared, each with a sentence true under any server', () => {
  it.each(['witness-mismatch', 'quarantine-kept'] as const)('%s', (t) => {
    expect(isLcRefusalToken(t)).toBe(true);
    expect(LC_REFUSAL_WORD[t]).toMatch(/Nothing (further )?was removed/);
    expect(LC_REFUSAL_WORD[t]).toMatch(/on its own/);
    expect(LC_REFUSAL_WORD[t]).toMatch(/listed for you/);
  });
});

describe('the source: three terminal words journaled, and no line in a harvested shape', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  const b = src.indexOf('WS-AUDIT-COLLECT ──');
  const e = src.indexOf('WS-AUDIT-COLLECT-CLOSE ──');
  const block = b > -1 && e > b ? src.slice(b, e) : '';

  it('found the block, and it holds the audit: an empty cut proves nothing', () => {
    expect(block.length).toBeGreaterThan(8000);
    expect(block).toContain('_ws_collect_audit_contained() {');
    expect(block).toContain('_ws_collect_fork() {');
  });

  it('journals exactly witness-mismatch, quarantine-kept and containment-unproven, under verb ws-audit', () => {
    const found = [...block.matchAll(/_lc_emit collect refused "\$id" "" verb ws-audit refusal ([a-z-]+)/g)]
      .map((m) => m[1]).sort();
    expect(found).toEqual(['containment-unproven', 'quarantine-kept', 'witness-mismatch']);
    expect([...block.matchAll(/_lc_emit /g)], 'no other journal line').toHaveLength(3);
  });

  it('spells no word in a shape the refusal harvests read (wsaudit.test.ts, ccd-wsaudit-nonpoison.test.ts)', () => {
    const shapes = [/_reap_refuse\s+[a-zA-Z]/, /"refused":"[a-zA-Z0-9-]+"/, /'![a-zA-Z0-9-]+/, /"verdict":"[a-zA-Z0-9-]+"/];
    expect(block.split('\n').filter((l) => shapes.some((s) => s.test(l)))).toEqual([]);
  });
});

// The leaf path the document names, as `_child_tmpdir` composes it, never resolved.
it.skipIf(!LINUX)('the document names the leaf as `_child_tmpdir` spells it', () => {
  makeOrphan(h);
  expect(collectOf(collectAudit(h))['leaf']).toBe(leafOf(h));
}, 60_000);
