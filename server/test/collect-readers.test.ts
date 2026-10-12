// Child reclamation wave 9: the temp-root collector's two readers, and the two tables they classify by (spec §5.10).
// - `parseCollectAudit` reads `ws-audit --collect`. Only its exit-0 `collectable` arm carries a token, and that token
//   is the ONE value the collector ever spends.
// - `parseCollectResult` reads `ws-collect`. Its no-document answer has three arms, never folded: a recognised die
//   acted nothing, and anything else MAY have acted.
// - The probe and refusal tables, and the recognised die texts, are pinned BOTH WAYS against ccd's own text, read here
//   at test time.
// - The cases that run the real verbs do so in a FIXTURE HOME (`makePrHarness`), never against the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLcRefusalToken } from '../../shared/api.js';
import {
  COLLECT_DIE_TEXT, COLLECT_LANE_LIVE_MARKER, COLLECT_LOCK_DIE_PREFIX, COLLECT_PROBE_CLASS, COLLECT_PROBES, COLLECT_REFUSAL_CLASS,
  COLLECT_REFUSAL_WORDS, collectProbeClass, collectRefusalClass, parseCollectAudit, parseCollectResult,
  type CollectProbeClass,
} from '../src/collectLane.js';
import { SENTENCES } from '../src/wsaudit.js';
import { CCD } from './ccdWsHelpers.js';
import { codeOnly } from './sourceScan.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { COL_ID, COL_RUN, WRONG_TOKEN, collectAudit, collectVerb, makeOrphan, regOf } from './wsCollectFixture.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p: string): string => path.relative(ccrcRoot, p);
const LINUX = process.platform === 'linux';

// ── ccd's text, read at test time ───────────────────────────────────────────────────────────────────────────────
const ccdSrc = readFileSync(CCD, 'utf8');
/** Whole-line `#` comments dropped, so prose that names a word is never read as a call. */
const bashCode = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
/** ccd's text from `from` to the first `to` after it. Both anchors are asserted, so a lost one reds rather than
 *  widening the slice to the rest of the file. */
const between = (from: string, to: string): string => {
  const a = ccdSrc.indexOf(from);
  expect(a, `ccd/ccd: ${JSON.stringify(from)} is gone`).toBeGreaterThan(-1);
  const b = ccdSrc.indexOf(to, a + from.length);
  expect(b, `ccd/ccd: ${JSON.stringify(to)} does not follow ${JSON.stringify(from)}`).toBeGreaterThan(a);
  return ccdSrc.slice(a, b);
};
const uniq = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

/** Every probe word ccd's collector answers `unmeasured` with: the literal first argument of each
 *  `_ws_collect_unmeasured` call, and the walk words `_ws_collect_eval` admits (its `case`, and its default). */
const probesFromCcd = (): string[] => {
  const code = bashCode(ccdSrc);
  const literal = [...code.matchAll(/_ws_collect_unmeasured ([a-z][a-z-]*)\b/g)].map((m) => m[1]!);
  expect([...code.matchAll(/_ws_collect_unmeasured "idle:\$why"/g)], 'the walk probe is composed once').toHaveLength(1);
  const ev = between('\n_ws_collect_eval() {', '\n_ws_collect_resume_eval() {');
  const cased = /case "\$\{_WS_IDLE_WHY-\}" in ([a-z|-]+)\)/.exec(ev);
  const dflt = /\blocal [^\n]*\bwhy=([a-z-]+)/.exec(ev);
  expect(cased, 'the case that admits a walk word').not.toBeNull();
  expect(dflt, 'the walk word a failure that names no admitted word reads').not.toBeNull();
  return uniq([...literal, ...[...cased![1]!.split('|'), dflt![1]!].map((w) => `idle:${w}`)]);
};

/** The collector's whole region, from its first helper to the capability's marker. */
const collectRegion = (): string => bashCode(between('\n_ws_collect_enc() {', '\n# COLLECT-V1.'));
/** Every word `ws-collect` can print as `refused`, by the five routes a word reaches `_ws_collect_refused` or a
 *  literal refusal document. `collectable` and `unmeasured` are verdicts, not refusals. */
const verbRefusalsFromCcd = (): string[] => {
  const r = collectRegion();
  return uniq([
    ...[...r.matchAll(/_ws_collect_refused "\$id" "[^"]*" ([a-z][a-z-]*)/g)].map((m) => m[1]!),
    ...[...r.matchAll(/_WS_REPROVE_WORD=([a-z][a-z-]*)/g)].map((m) => m[1]!),
    ...[...r.matchAll(/_ws_collect_refuse ([a-z][a-z-]*)/g)].map((m) => m[1]!),
    ...[...r.matchAll(/REAP_VERDICT=([a-z][a-z-]*)/g)].map((m) => m[1]!),
    ...[...r.matchAll(/"refused":"([a-z-]+)"/g)].map((m) => m[1]!),
  ].filter((w) => w !== 'collectable' && w !== 'unmeasured'));
};
/** The audit's own refusal words: the ones `_ws_collect_eval`, its resume and the audit's own rungs set. */
const auditRefusalsFromCcd = (): string[] =>
  uniq([...collectRegion().matchAll(/_ws_collect_refuse ([a-z][a-z-]*)/g)].map((m) => m[1]!));
/** The words the audit JOURNALS, its terminal ones: `_ws_collect_audit_doc`'s case. */
const auditJournaledFromCcd = (): string[] => {
  const doc = between('\n_ws_collect_audit_doc() {', '\n# ── end ws-audit --collect');
  return uniq([...doc.matchAll(/^\s+([a-z-]+)\)\s+_lc_emit collect refused "\$id" "" verb ws-audit refusal ([a-z-]+) /gm)]
    .map((m) => { expect(m[2], 'the case arm journals its own word').toBe(m[1]); return m[1]!; }));
};
/** Every message `cmd_ws_collect` dies with before its lock: each `die "…"`, and each `_lc_refuse collect`'s message.
 *  A message ccd builds with a variable is read up to the `$`, its fixed prefix. */
const diesFromCcd = (): string[] => {
  const region = bashCode(between('\ncmd_ws_collect() {', '\n_ws_collect_locked() {'));
  const re = /\bdie "((?:[^"\\]|\\.)*)"|_lc_refuse\s+collect\s+"\$id"\s+\S+[\s\\]*"((?:[^"\\]|\\.)*)"/g;
  return uniq([...region.matchAll(re)].map((m) => {
    const t = (m[1] ?? m[2])!;
    const d = t.indexOf('$');
    return d === -1 ? t : t.slice(0, d);
  }));
};
/** The four dec dies. The reader does not recognise them, so they read as arm 3 (MAY have acted). The server's dec is a constant
 *  that never reaches them. */
const DEC_DIES = ['--actor is longer than ', '--actor must be non-blank', '--reason is longer than ', '--reason must be non-blank'];

// ── the audit reader ────────────────────────────────────────────────────────────────────────────────────────────
const ID = 'demo-quiet-mesa';
const TOK = 'b'.repeat(64);
const WIT = { dev: '2049', ino: '131077', btime: '1789990000', run: '41', at: '1789990000123' };
const LEAF = `/home/u/.cc-tmp/${ID}`;
/** An audit document in ccd's shape: a fresh `collectable` unless `over` says otherwise. A key set to `undefined` is
 *  dropped by `JSON.stringify`, so it is absent. */
const audit = (over: Record<string, unknown> = {}, collect: Record<string, unknown> = {}): string => `${JSON.stringify({
  session: ID, mode: 'collect', exists: true,
  collect: { leaf: LEAF, witness: WIT, records: [], newestCtimeNs: '1789990000000000000', entries: 3, floorS: 86400,
    idleAt: 1790076400, unmeasured: null, ...collect },
  verdict: 'collectable', detail: '', token: TOK, ...over,
})}\n`;
const A = (stdout: string, ok = true, stderr = '') => parseCollectAudit(ID, ok, stdout, stderr);

describe('parseCollectAudit — exit 0: only an exact collectable with a 64-hex token is spendable (spec §5.10)', () => {
  it('a fresh collectable document reads as collectable, with its witness run and instant, and no resume', () => {
    expect(A(audit())).toEqual({ kind: 'collectable', token: TOK, resume: null, witnessRun: 41,
      witnessAt: 1789990000123, leaf: LEAF, detail: '' });
  });

  it('a resume document carries its phase: the key’s presence is what tells a resume', () => {
    expect(A(audit({ resume: 'moved' }))).toMatchObject({ kind: 'collectable', resume: 'moved' });
  });

  it('a collectable document whose witness is null reads, with no run and no instant (the open-run hold decides)', () => {
    expect(A(audit({}, { witness: null }))).toMatchObject({ kind: 'collectable', witnessRun: null, witnessAt: null });
  });

  it('a leaf that is not a string is carried as null', () => {
    expect(A(audit({}, { leaf: 3 }))).toMatchObject({ kind: 'collectable', leaf: null });
  });

  it.each<readonly [string, string]>([
    ['no token', audit({ token: undefined })],
    ['a null token', audit({ token: null })],
    ['a 63-character token', audit({ token: TOK.slice(1) })],
    ['a 65-character token', audit({ token: `${TOK}b` })],
    ['an upper-case token', audit({ token: TOK.toUpperCase() })],
    ['a token with a trailing newline', audit({ token: `${TOK}\n` })],
    ['a number for a token', audit({ token: 7 })],
    ['an empty resume', audit({ resume: '' })],
    ['a null resume', audit({ resume: null })],
    ['no collect block', audit({ collect: undefined })],
    ['no witness key', audit({}, { witness: undefined })],
    ['a resume with no witness key (the stricter reading)', audit({ resume: 'moved' }, { witness: undefined })],
    ['a witness that is an array', audit({}, { witness: [] })],
    ['a witness run of 0', audit({}, { witness: { ...WIT, run: '0' } })],
    ['a witness run that is a number', audit({}, { witness: { ...WIT, run: 41 } })],
    ['a witness run of eleven digits', audit({}, { witness: { ...WIT, run: '12345678901' } })],
    ['a witness at of twelve digits', audit({}, { witness: { ...WIT, at: '178999000012' } })],
    ['a witness with no dev', audit({}, { witness: { ...WIT, dev: undefined } })],
  ])('collectable with %s is unreadable, never spent', (_what, doc) => {
    expect(A(doc).kind).toBe('unreadable');
  });

  it('an unknown verdict that begins collectable, token and all, is a verdict, never collectable', () => {
    expect(A(audit({ verdict: 'collectable-later' })))
      .toEqual({ kind: 'verdict', verdict: 'collectable-later', idleAt: 1790076400, witnessRun: 41, leaf: LEAF, detail: '' });
  });

  it('a refusal reads as a verdict, with ccd’s detail and its idleAt', () => {
    expect(A(audit({ verdict: 'changed-recently', detail: 'young', token: undefined })))
      .toEqual({ kind: 'verdict', verdict: 'changed-recently', idleAt: 1790076400, witnessRun: 41, leaf: LEAF, detail: 'young' });
  });

  // ccd prints `collect.witness` and `collect.leaf` on every document, and attention's runId and leaf sentence read the
  // LATEST document, so a verdict carries them too. A null witness carries no run; a malformed one is never read.
  it('a verdict whose witness is null or absent, or whose leaf is not a string, carries null for each', () => {
    expect(A(audit({ verdict: 'in-use', token: undefined }, { witness: null, leaf: 3 })))
      .toMatchObject({ kind: 'verdict', witnessRun: null, leaf: null });
    expect(A(audit({ verdict: 'in-use', token: undefined }, { witness: undefined })))
      .toMatchObject({ kind: 'verdict', witnessRun: null, leaf: LEAF });
  });

  it.each<readonly [string, unknown]>([
    ['a witness run of 0', { ...WIT, run: '0' }],
    ['a witness at of twelve digits', { ...WIT, at: '178999000012' }],
    ['a witness that is an array', []],
  ])('a verdict with %s is unreadable', (_what, witness) => {
    expect(A(audit({ verdict: 'in-use', token: undefined }, { witness })).kind).toBe('unreadable');
  });

  it.each<readonly [unknown, number | null]>([
    [0, 0], [1790076400, 1790076400], [1.5, null], [-1, null], ['1790076400', null], [null, null], [2 ** 60, null],
  ])('an idleAt of %j is carried as %j', (idleAt, want) => {
    expect(A(audit({ verdict: 'changed-recently', token: undefined }, { idleAt }))).toMatchObject({ idleAt: want });
  });

  it.each([['unmeasured'], [''], [3], [null]])('an exit-0 verdict of %j is unreadable', (verdict) => {
    expect(A(audit({ verdict })).kind).toBe('unreadable');
  });
});

describe('parseCollectAudit — identity: this id’s collect document, or unreadable (spec §5.10)', () => {
  it.each<readonly [string, string]>([
    ['another session', audit({ session: 'demo-other' })],
    ['no session key', audit({ session: undefined })],
    ['reclaim’s id key instead', audit({ session: undefined, id: ID })],
    ['mode reclaim', audit({ mode: 'reclaim' })],
    ['no mode', audit({ mode: undefined })],
    ['an array', '[1,2]'],
    ['a JSON string', '"collectable"'],
    ['text that is not JSON', 'ccd: something went wrong'],
  ])('%s is unreadable', (_what, doc) => {
    expect(A(doc).kind).toBe('unreadable');
  });
});

describe('parseCollectAudit — exit 1: only unmeasured, with its probe word (spec §5.10)', () => {
  const unmeasured = (probe: unknown, over: Record<string, unknown> = {}, collect: Record<string, unknown> = {}): string =>
    audit({ verdict: 'unmeasured', detail: 'why', token: undefined, ...over }, { unmeasured: probe, ...collect });

  it.each(['checkouts', 'idle:timeout', 'frobnicate'])('unmeasured %j reads as itself, verbatim', (probe) => {
    expect(A(unmeasured(probe), false, 'ccd: … — retry'))
      .toEqual({ kind: 'unmeasured', probe, witnessRun: 41, leaf: LEAF, detail: 'why' });
  });

  it('unmeasured with a null witness carries no run, and keeps its leaf', () => {
    expect(A(unmeasured('witness', {}, { witness: null }), false))
      .toMatchObject({ kind: 'unmeasured', probe: 'witness', witnessRun: null, leaf: LEAF });
  });

  it.each<readonly [string, string]>([
    ['collectable with a good token', audit()],
    ['a refusal', audit({ verdict: 'in-use', token: undefined })],
    ['unmeasured with a null probe', unmeasured(null)],
    ['unmeasured with an empty probe', unmeasured('')],
    ['unmeasured with no collect block', unmeasured('checkouts', { collect: undefined })],
    ['unmeasured with a witness run of 0', unmeasured('checkouts', {}, { witness: { ...WIT, run: '0' } })],
  ])('at exit 1, %s is unreadable: no exit-1 document is ever spent', (_what, doc) => {
    expect(A(doc, false).kind).toBe('unreadable');
  });
});

describe('parseCollectAudit — no document is its own arm (spec §5.10)', () => {
  it.each<readonly [string, boolean]>([['', false], ['  \n', false], ['', true]])('stdout %j at ok=%s is no-document', (out, ok) => {
    expect(A(out, ok, '  ccd: killed\n')).toEqual({ kind: 'no-document', stderr: 'ccd: killed' });
  });
});

// ── the verb reader ─────────────────────────────────────────────────────────────────────────────────────────────
const J = (o: Record<string, unknown>): string => `${JSON.stringify(o)}\n`;
const R = (stdout: string, ok: boolean, stderr = '') => parseCollectResult(ID, ok, stdout, stderr);
const REC = `${ID}.1790000000000000000.4242`;

describe('parseCollectResult — the three documents (spec §5.10)', () => {
  it.each<readonly [string, Record<string, unknown>]>([
    ['a fresh collection', { collected: ID, record: REC, resumed: false, witness: 'dropped' }],
    ['a resume', { collected: ID, record: REC, resumed: true, witness: 'dropped' }],
    ['a recycled spawn’s witness put back', { collected: ID, record: REC, resumed: false, witness: 'kept' }],
    ['a witness already gone', { collected: ID, record: REC, resumed: false, witness: 'absent' }],
    ['a witness-only drop', { collected: ID, record: null, resumed: false, witness: 'dropped' }],
  ])('%s reads as collected', (_what, doc) => {
    const { collected: _c, ...rest } = doc;
    expect(R(J(doc), true)).toEqual({ kind: 'collected', ...rest });
  });

  it('a collected document naming another id is failed', () => {
    expect(R(J({ collected: 'demo-other', record: REC, resumed: false, witness: 'dropped' }), true))
      .toEqual({ kind: 'failed', token: '', detail: `ws-collect reported collecting demo-other, not ${ID}` });
  });

  it.each<readonly [string, Record<string, unknown>]>([
    ['an unknown witness word', { collected: ID, record: REC, resumed: false, witness: 'gone' }],
    ['no witness', { collected: ID, record: REC, resumed: false }],
    ['a resumed that is a string', { collected: ID, record: REC, resumed: 'false', witness: 'dropped' }],
    ['a record that is a number', { collected: ID, record: 3, resumed: false, witness: 'dropped' }],
    ['an empty record', { collected: ID, record: '', resumed: false, witness: 'dropped' }],
  ])('a collected document with %s is failed, never read as collected', (_what, doc) => {
    expect(R(J(doc), true)).toMatchObject({ kind: 'failed', token: '' });
  });

  it('a collected or refused document at a non-zero exit is failed', () => {
    expect(R(J({ collected: ID, record: null, resumed: false, witness: 'dropped' }), false)).toMatchObject({ kind: 'failed', token: '' });
    expect(R(J({ refused: 'in-use', detail: 'd', paths: [] }), false)).toMatchObject({ kind: 'failed', token: '' });
  });

  it('a refusal reads with its word, ccd’s detail and its paths; an unknown word is kept verbatim', () => {
    expect(R(J({ refused: 'in-use', detail: 'd', paths: [] }), true)).toEqual({ kind: 'refused', word: 'in-use', detail: 'd', paths: [] });
    expect(R(J({ refused: 'in-use', detail: 'd', paths: ['/p'] }), true)).toMatchObject({ paths: ['/p'] });
    expect(R(J({ refused: 'frobnicate', detail: 'd', paths: [] }), true)).toMatchObject({ kind: 'refused', word: 'frobnicate' });
  });

  it.each<readonly [string, unknown]>([['a string', '/p'], ['a non-string member', ['/p', 1]], ['none', undefined]])(
    'paths that are %s read as none', (_what, paths) => {
      expect(R(J({ refused: 'in-use', detail: 'd', paths }), true)).toMatchObject({ paths: [] });
    });

  it('a failure reads its word and detail, and nothing of a crumb', () => {
    expect(R(J({ failed: 'probe-unmeasured', detail: 'd', crumb: true }), false))
      .toEqual({ kind: 'failed', token: 'probe-unmeasured', detail: 'd' });
    expect(R(J({ failed: 'quarantine-kept', detail: 'k' }), false)).toEqual({ kind: 'failed', token: 'quarantine-kept', detail: 'k' });
  });

  it.each<readonly [string, boolean, Record<string, unknown>]>([
    ['at exit 1, with ccd’s detail', false, { failed: '', detail: 'ccd’s own text' }],
    ['at exit 0, with none', true, { failed: '' }],
  ])('a failure with no word reads as this reader’s: its token is empty and its detail is ccrc’s sentence, %s', (_what, ok, doc) => {
    expect(R(J(doc), ok)).toEqual({ kind: 'failed', token: '', detail: 'ws-collect answered failed with no word' });
  });
});

describe('parseCollectResult — no document: three arms, never folded (spec §5.10)', () => {
  it('ccd’s die texts are exactly its recognised texts and its four dec dies, read off cmd_ws_collect', () => {
    expect(diesFromCcd()).toEqual(uniq([...Object.values(COLLECT_DIE_TEXT), COLLECT_LOCK_DIE_PREFIX, ...DEC_DIES]));
  });

  it.each(Object.keys(COLLECT_DIE_TEXT))('%s: ccd’s whole stderr, with nothing on stdout, is that die (arm 1)', (word) => {
    const msg = COLLECT_DIE_TEXT[word as keyof typeof COLLECT_DIE_TEXT];
    expect(R('', false, `ccd: ${msg}\n`)).toEqual({ kind: 'die', word });
  });

  it.each(Object.keys(COLLECT_DIE_TEXT))('%s, EXTENDED or after another line, is not recognised (arm 3)', (word) => {
    const msg = COLLECT_DIE_TEXT[word as keyof typeof COLLECT_DIE_TEXT];
    expect(R('', false, `ccd: ${msg} (more)`)).toEqual({ kind: 'no-document', stderr: `ccd: ${msg} (more)` });
    expect(R('', false, `ccd: warn\nccd: ${msg}`).kind).toBe('no-document');
  });

  it('a die text at exit 0, or beside a stdout, is not recognised', () => {
    const msg = COLLECT_DIE_TEXT['bad-token'];
    expect(R('', true, `ccd: ${msg}`).kind).toBe('no-document');
    expect(R('partial', false, `ccd: ${msg}`).kind).toBe('no-document');
  });

  it.each(DEC_DIES)('the dec die %j is not recognised: arm 3, which MAY have acted', (msg) => {
    expect(R('', false, `ccd: ${msg}`).kind).toBe('no-document');
  });

  const LOCK = `/home/u/.cc-sessions/.reap-${ID}.lock`;
  const bashLine = (p: string): string => `/home/u/ccrc/ccd/ccd: line 34099: ${p}: Is a directory`;
  const lockDie = (p: string = LOCK): string => `ccd: ${COLLECT_LOCK_DIE_PREFIX}${p}`;

  it.each<readonly [string, string]>([
    ['bash’s line, then ccd’s', `${bashLine(LOCK)}\n${lockDie()}`],
    ['ccd’s line alone', lockDie()],
    ['two bash lines for the same path', `${bashLine(LOCK)}\n/x: line 9: ${LOCK}: Permission denied\n${lockDie()}`],
  ])('lock-unopenable for this id’s lock: %s', (_what, err) => {
    expect(R('', false, err)).toEqual({ kind: 'die', word: 'lock-unopenable' });
  });

  it.each<readonly [string, string]>([
    ['another id’s lock', `${bashLine('/home/u/.cc-sessions/.reap-other.lock')}\n${lockDie('/home/u/.cc-sessions/.reap-other.lock')}`],
    ['a longer id that ends in this one', lockDie('/home/u/.cc-sessions/.reap-x-demo-quiet-mesa.lock')],
    ['a path past the lock name', lockDie(`${LOCK}.bak`)],
    ['a bash line naming another path', `${bashLine('/elsewhere')}\n${lockDie()}`],
    ['a bash line for this lock, and one naming another path', `${bashLine(LOCK)}\n${bashLine('/elsewhere')}\n${lockDie()}`],
    ['a line after ccd’s', `${lockDie()}\nccd: more`],
  ])('not this id’s lock die: %s (arm 3)', (_what, err) => {
    expect(R('', false, err).kind).toBe('no-document');
  });

  it('nothing at all, a JSON value with none of the three keys, and a cut line are no-document', () => {
    expect(R('', false, '')).toEqual({ kind: 'no-document', stderr: '' });
    expect(R(J({ other: 1 }), true).kind).toBe('no-document');
    expect(R('[1]', true).kind).toBe('no-document');
    expect(R('{"collected":"demo-qu', false, 'killed').kind).toBe('no-document');
  });
});

// ── the tables ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('COLLECT_PROBE_CLASS — total over ccd’s probe words, pinned both ways (spec §5.10)', () => {
  it('its keys are the twenty words _ws_collect_unmeasured is called with, and the four walk words _ws_collect_eval admits', () => {
    const got = probesFromCcd();
    expect(got.filter((w) => !w.startsWith('idle:'))).toHaveLength(20);
    expect(got.filter((w) => w.startsWith('idle:'))).toEqual(['idle:cap', 'idle:timeout', 'idle:unreadable', 'idle:walk-failed']);
    expect([...COLLECT_PROBES].sort()).toEqual(got);
  });

  it('each class holds exactly its words', () => {
    const of = (c: CollectProbeClass): string[] => COLLECT_PROBES.filter((p) => COLLECT_PROBE_CLASS[p] === c).sort();
    expect(of('box-wide')).toEqual(['clock', 'eval', 'flock', 'floor', 'mv', 'platform', 'quarantine', 'witness']);
    expect(of('per-leaf')).toEqual(['device', 'idle:cap', 'idle:unreadable', 'mode']);
    expect(of('load-sensitive')).toEqual(['checkouts', 'identity', 'idle:timeout', 'idle:walk-failed', 'in-use', 'leaf',
      'lock', 'records', 'registry', 'rows', 'slot', 'token']);
  });

  it.each(COLLECT_PROBES.map((p) => [p, COLLECT_PROBE_CLASS[p]] as const))('%s is %s', (p, c) => {
    expect(collectProbeClass(p)).toBe(c);
  });

  it.each(['frobnicate', 'idle:other', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'an unknown probe word %j is load-sensitive', (w) => {
      expect(collectProbeClass(w)).toBe('load-sensitive');
    });
});

describe('COLLECT_REFUSAL_CLASS — total over the words ws-collect refuses with, pinned both ways (spec §5.10)', () => {
  it('its keys are every word the verb prints as refused', () => {
    expect([...COLLECT_REFUSAL_WORDS].sort()).toEqual(verbRefusalsFromCcd());
  });

  it('the audit refuses with the same words, save state-changed, which only the verb’s token comparison answers', () => {
    expect(auditRefusalsFromCcd()).toEqual(COLLECT_REFUSAL_WORDS.filter((w) => w !== 'state-changed').sort());
  });

  it('the terminal words are exactly the ones the audit journals', () => {
    expect(COLLECT_REFUSAL_WORDS.filter((w) => COLLECT_REFUSAL_CLASS[w] === 'terminal').sort()).toEqual(auditJournaledFromCcd());
  });

  it('five are L0’s collect words, and five are the shared tokens wsaudit.ts words', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    const l0 = uniq([...api.matchAll(/^\s+\| '([a-z-]+)'\s*;?\s*\/\/ ws-audit --collect and ws-collect\b/gm)].map((m) => m[1]!));
    expect(l0).toEqual(['changed-recently', 'not-witnessed', 'quarantine-kept', 'registered', 'witness-mismatch']);
    expect(COLLECT_REFUSAL_WORDS.filter((w) => isLcRefusalToken(w)).sort()).toEqual(l0);
    const shared = COLLECT_REFUSAL_WORDS.filter((w) => !isLcRefusalToken(w)).sort();
    expect(shared).toEqual(['containment-unproven', 'in-progress', 'in-use', 'paused', 'state-changed']);
    for (const w of shared) expect(Object.prototype.hasOwnProperty.call(SENTENCES, w), w).toBe(true);
  });

  it.each(['frobnicate', '', 'constructor', '__proto__', 'refused'])('an unknown word %j is a retry, never terminal', (w) => {
    expect(collectRefusalClass(w)).toBe('retry');
  });
});

// ── the readers never borrow reclaim's, and the one cast ───────────────────────────────────────────────────────
describe('the collect readers are their own (spec §5.10)', () => {
  const SRC = path.join(ccrcRoot, 'server', 'src');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    if (e.startsWith('__')) return [];
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
  /** The lane's files: every `collect<Name>.ts` under server/src, so the executor joins when it lands. */
  const laneFiles = (): string[] => walk(SRC).filter((f) => /^collect[A-Z]\w*\.ts$/.test(path.basename(f)));
  const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));

  it('CONTROL: the lane’s files are found, collectLane.ts among them', () => {
    expect(laneFiles().map(rel)).toContain('server/src/collectLane.ts');
  });

  it('no lane file names a reclaim reader', () => {
    const BORROW = /\bparseChildReclaim(?:Result|Audit|AuditFailed)\b/;
    expect(BORROW.test('return parseChildReclaimResult(id, out, err);'), 'CONTROL').toBe(true);
    expect(laneFiles().filter((f) => BORROW.test(codeOnly(readFileSync(f, 'utf8')))).map(rel)).toEqual([]);
  });

  it('collectLane.ts is L1: it imports shared/api.js and childReclaimSweep.js only, and no module at run time', () => {
    const code = codeOnly(readFileSync(path.join(SRC, 'collectLane.ts'), 'utf8'));
    const specs = uniq([...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!));
    // Task 4 adds `./childReclaimSweep.js` (L1 to L1, one way), and its pacing suite pins the exact pair. This case
    // refuses only a third specifier, so it stays green at Task 4's commit (no commit is red).
    expect(specs).toContain('../../shared/api.js');
    expect(specs.filter((s) => s !== '../../shared/api.js' && s !== './childReclaimSweep.js'), 'a specifier outside that pair')
      .toEqual([]);
    expect(code).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
  });

  it('the live switch’s marker is spelled here: collect-lane-live (spec §5.10)', () => {
    expect(COLLECT_LANE_LIVE_MARKER).toBe('collect-lane-live');
  });

  it('the shipped tree casts to CollectToken once, inside parseCollectAudit', () => {
    const CAST = /\bas\s+CollectToken\b/g;
    const hits = ROOTS.flatMap(walk).flatMap((f) => [...codeOnly(readFileSync(f, 'utf8')).matchAll(CAST)].map(() => rel(f)));
    expect(hits).toEqual(['server/src/collectLane.ts']);
    const lane = codeOnly(readFileSync(path.join(SRC, 'collectLane.ts'), 'utf8'));
    const at = lane.indexOf('export function parseCollectAudit(');
    expect(at).toBeGreaterThan(-1);
    const end = lane.indexOf('\nexport ', at + 1);
    expect(lane.slice(at, end === -1 ? undefined : end)).toMatch(/\bas\s+CollectToken\b/);
  });
});

// ── the real verbs, in a fixture HOME ──────────────────────────────────────────────────────────────────────────
describe.skipIf(!LINUX)('the readers against the real ccd, in a fixture HOME (spec §5.10)', () => {
  let h: PrHarness;
  beforeEach(() => { h = makePrHarness('ccrc-collect-readers-'); });
  afterEach(() => { h.cleanup(); });

  it('a real collectable audit reads as collectable; its token, spent, reads as collected; and the id then reads not-witnessed', () => {
    makeOrphan(h);
    const a = collectAudit(h);
    expect(a.stdout.trim().split('\n'), 'ONE line, as the runner hands it over').toHaveLength(1);
    const read = parseCollectAudit(COL_ID, a.code === 0, a.stdout, a.stderr);
    expect(read).toMatchObject({ kind: 'collectable', resume: null, witnessRun: COL_RUN });
    if (read.kind !== 'collectable') throw new Error(`not collectable: ${a.stdout}${a.stderr}`);
    expect(Math.abs(read.witnessAt! - Date.now())).toBeLessThan(600_000);
    const v = collectVerb(h, read.token);
    expect(parseCollectResult(COL_ID, v.code === 0, v.stdout, v.stderr))
      .toMatchObject({ kind: 'collected', resumed: false, witness: 'dropped' });
    const again = collectAudit(h);
    expect(parseCollectAudit(COL_ID, again.code === 0, again.stdout, again.stderr))
      .toMatchObject({ kind: 'verdict', verdict: 'not-witnessed' });
  }, 120_000);

  it('a token that no longer matches reads as the refusal state-changed', () => {
    makeOrphan(h);
    const v = collectVerb(h, WRONG_TOKEN);
    expect(parseCollectResult(COL_ID, v.code === 0, v.stdout, v.stderr)).toMatchObject({ kind: 'refused', word: 'state-changed' });
  }, 60_000);

  it('a box whose mv has no --no-copy reads as unmeasured mv at exit 1', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: '_ws_collect_mv_ok() { return 1; };' });
    expect(a.code).toBe(1);
    expect(parseCollectAudit(COL_ID, false, a.stdout, a.stderr)).toMatchObject({ kind: 'unmeasured', probe: 'mv' });
  }, 60_000);

  it('a lock that is a directory dies lock-unopenable, read as arm 1', () => {
    makeOrphan(h);
    mkdirSync(path.join(regOf(h), `.reap-${COL_ID}.lock`));
    const v = collectVerb(h, WRONG_TOKEN);
    expect(v.stdout.trim(), 'nothing on stdout').toBe('');
    expect(parseCollectResult(COL_ID, v.code === 0, v.stdout, v.stderr), v.stderr).toEqual({ kind: 'die', word: 'lock-unopenable' });
  }, 60_000);

  it('the usage and bad-token dies read as arm 1', () => {
    const usage = collectVerb(h, WRONG_TOKEN, { extra: '--defer-expired' });
    expect(parseCollectResult(COL_ID, usage.code === 0, usage.stdout, usage.stderr), usage.stderr).toEqual({ kind: 'die', word: 'usage' });
    const bad = collectVerb(h, 'xyz');
    expect(parseCollectResult(COL_ID, bad.code === 0, bad.stdout, bad.stderr), bad.stderr).toEqual({ kind: 'die', word: 'bad-token' });
  }, 60_000);
});
