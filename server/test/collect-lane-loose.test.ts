// Fleet disk retention DR-15 (D-6627, spec 2026-10-23 section 2.4): the collect lane's LOOSE arm, in shadow.
// The first block CHARACTERISES what the lane did before the arm (green on the old code): a witnessed leaf is the
// whole population, and the open-run hold holds a fresh witnessed collection that names no run. FIXTURE HOME ONLY.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { collectOpenRunHold, collectTempRoot } from '../src/coord/collectTempRoot.js';
import {
  COLLECT_LOOSE_FEED_TITLE, collectFeedCollectedBody, collectFeedTitle, collectFeedWouldCollectBody, collectIsLoose,
  collectLooseHexOf, collectLooseId, collectLooseNameText, collectPopulation, parseCollectCensus, parseCollectLooseAudit,
  parseCollectLooseResult, type CollectLooseCensus,
} from '../src/collectLane.js';
import { COLLECT_LOOSE_CAP } from '../src/ccdargv.js';
import { isTmpRootId } from '../../shared/api.js';
import { collectRig, type CollectRig } from './collectLaneFixture.js';
import { FULL_CAPS, RIPE, TOK, TOK2, rig } from './collectTempRootFixture.js';
import { COLLECT_LOOSE_LIVE_MARKER } from '../../shared/switches.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('characterisation: the lane before the loose arm', () => {
  it('a witnessed id is the whole population, and a registry row filters it', () => {
    const pop = collectPopulation({
      tmproots: { kind: 'listed', names: ['demo-a', 'demo-b'] }, tmpquarantine: { kind: 'absent' },
      registryNames: new Set(['demo-b.child']),
    });
    expect(pop.ids).toEqual(['demo-a', 'demo-b']);
    expect(pop.candidates).toEqual(['demo-a']);
    expect(pop.bothMeasured).toBe(true);
  });

  it('a witnessed leaf is audited, and two observations an interval apart record its would-collect', async () => {
    const f = await collectRig();
    f.pastHoldOff();
    f.witness('demo-a');
    await f.passesUntil(() => f.wouldCollects('demo-a').length > 0, 4);
    expect(f.audits('demo-a').length).toBeGreaterThanOrEqual(2);
    expect(f.collects('demo-a')).toEqual([]);
  });

  it('the open-run hold holds a fresh collection whose witness names no run', () => {
    const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-loose-char-'), '.ccrc', 'coord.db')));
    expect(collectOpenRunHold(coord, 'demo-a', { resume: null, witnessRun: null, witnessAt: null }))
      .toMatchObject({ kind: 'held', why: 'no-witness-run' });
  });
});

// ── the loose arm ────────────────────────────────────────────────────────────────────────────────────────────────

const hexOf = (name: string): string => Buffer.from(name, 'utf8').toString('hex');
const measured = (looseNames: readonly string[], o: Partial<Extract<CollectLooseCensus, { kind: 'measured' }>> = {}): CollectLooseCensus =>
  ({ kind: 'measured', truncated: false, looseHex: looseNames.map(hexOf), recordHex: [], recordsUnmeasured: 0, ...o });
const none = { tmproots: { kind: 'absent' }, tmpquarantine: { kind: 'absent' }, registryNames: new Set<string>() } as const;

describe('the loose id: a name the temp-root predicate refuses', () => {
  it('round-trips a hex, and is refused by isTmpRootId so no witnessed argv can be built from it', () => {
    const id = collectLooseId(hexOf('-rf'));
    expect(collectLooseHexOf(id)).toBe(hexOf('-rf'));
    expect(collectIsLoose(id)).toBe(true);
    expect(isTmpRootId(id)).toBe(false);
  });
  it('reads nothing as a loose id that is not one: no prefix, odd or upper-case hex, empty, over 255 bytes, not a string', () => {
    for (const bad of ['demo-a', 'loose:', 'loose:abc', 'loose:AB', 'loose:zz', `loose:${'ab'.repeat(256)}`, 'loose:ab/ab', null, 7]) {
      expect(collectLooseHexOf(bad), String(bad)).toBeNull();
    }
    expect(collectLooseHexOf(`loose:${'ab'.repeat(255)}`)).not.toBeNull();
  });
});

describe('the census reader: total, and an unreadable census is never an empty one', () => {
  const doc = (o: Record<string, unknown> = {}): string => JSON.stringify({
    mode: 'collect-census', truncated: false, max: 1024, counts: {}, entries: [{ hex: hexOf('a'), class: 'loose' }, { hex: hexOf('b'), class: 'witnessed' }],
    records: [{ hex: hexOf('c'), record: 'x.1.1' }], recordsUnmeasured: 0, ...o });
  it('lists only the loose class and the records’ entries', () => {
    expect(parseCollectCensus(true, doc(), '')).toEqual(measured(['a'], { recordHex: [hexOf('c')] }));
  });
  it('exit 1 with the unmeasured document is unmeasured with ccd’s why', () => {
    expect(parseCollectCensus(false, JSON.stringify({ mode: 'collect-census', unmeasured: 'the walk failed', entries: [] }), 'retry'))
      .toEqual({ kind: 'unmeasured', why: 'the walk failed' });
  });
  it.each([
    ['empty stdout', true, ''], ['not JSON', true, '{'], ['another mode', true, JSON.stringify({ mode: 'collect' })],
    ['no truncated flag', true, doc({ truncated: undefined })], ['an entry that is no object', true, doc({ entries: [1] })],
    ['a negative unread count', true, doc({ recordsUnmeasured: -1 })], ['exit 1 with a measured body', false, doc()],
  ] as const)('%s is unmeasured', (_n, ok, out) => {
    expect(parseCollectCensus(ok, out, '').kind).toBe('unmeasured');
  });
});

describe('the loose audit and verb readers share the witnessed readers’ strictness', () => {
  const hex = hexOf('scratch');
  const tok = 'a'.repeat(64);
  const audit = (o: Record<string, unknown> = {}): string => JSON.stringify({
    mode: 'collect-loose', name: hex, collect: { class: 'loose', unmeasured: null }, verdict: 'collectable', detail: '', token: tok, ...o });
  it('a collectable audit carries its token, no witness and no leaf', () => {
    expect(parseCollectLooseAudit(hex, true, audit(), '')).toMatchObject({ kind: 'collectable', token: tok, witnessRun: null, witnessAt: null, leaf: null, resume: null });
  });
  it('a resume phase is carried, and a document for another entry is unreadable', () => {
    expect(parseCollectLooseAudit(hex, true, audit({ resume: 'moved' }), '')).toMatchObject({ kind: 'collectable', resume: 'moved' });
    expect(parseCollectLooseAudit(hex, true, audit({ name: hexOf('other') }), '').kind).toBe('unreadable');
    expect(parseCollectLooseAudit(hex, true, audit({ mode: 'collect' }), '').kind).toBe('unreadable');
  });
  it('a token that is not 64 lowercase hex is unreadable; a refusal is a verdict; exit 1 is unmeasured; nothing is no-document', () => {
    expect(parseCollectLooseAudit(hex, true, audit({ token: 'A'.repeat(64) }), '').kind).toBe('unreadable');
    expect(parseCollectLooseAudit(hex, true, audit({ verdict: 'changed-recently', token: undefined }), ''))
      .toMatchObject({ kind: 'verdict', verdict: 'changed-recently' });
    expect(parseCollectLooseAudit(hex, false, audit({ verdict: 'unmeasured', token: undefined, collect: { unmeasured: 'in-use' } }), ''))
      .toMatchObject({ kind: 'unmeasured', probe: 'in-use' });
    expect(parseCollectLooseAudit(hex, true, '', 'boom').kind).toBe('no-document');
  });
  it('the verb: collected needs its record, its resumed flag and `loose`, for THIS entry; a refusal and a die read as the witnessed verb’s', () => {
    const done = (o: Record<string, unknown> = {}): string => JSON.stringify({ collected: hex, record: 'r.1.1', resumed: false, loose: true, ...o });
    expect(parseCollectLooseResult(hex, true, done(), '')).toEqual({ kind: 'collected', record: 'r.1.1', resumed: false, witness: 'absent' });
    expect(parseCollectLooseResult(hex, true, done({ collected: hexOf('x') }), '').kind).toBe('failed');
    expect(parseCollectLooseResult(hex, true, done({ loose: undefined }), '').kind).toBe('failed');
    expect(parseCollectLooseResult(hex, true, done({ record: '' }), '').kind).toBe('failed');
    expect(parseCollectLooseResult(hex, false, done(), '').kind).toBe('failed');
    expect(parseCollectLooseResult(hex, true, JSON.stringify({ refused: 'in-use', detail: 'x', paths: [] }), ''))
      .toMatchObject({ kind: 'refused', word: 'in-use' });
    expect(parseCollectLooseResult(hex, false, '', '').kind).toBe('no-document');
  });
});

describe('the population (D-6627): a census name joins as a loose id, and doubt keeps rather than takes', () => {
  it('a loose census name joins the population as a candidate, beside a witnessed id, never pre-filtered by a row', () => {
    const pop = collectPopulation({ ...none, tmproots: { kind: 'listed', names: ['demo-a'] }, loose: measured(['scratch', '-rf', 'a b']) });
    expect(pop.ids).toEqual(expect.arrayContaining(['demo-a', collectLooseId(hexOf('scratch')), collectLooseId(hexOf('-rf')), collectLooseId(hexOf('a b'))]));
    expect(pop.candidates).toEqual(pop.ids);
    expect(pop.looseDoubt).toBeNull();
  });

  it('a record’s entry is a candidate and a record id even when the census is cut', () => {
    const pop = collectPopulation({ ...none, loose: measured(['x'], { truncated: true, recordHex: [hexOf('killed')] }) });
    expect(pop.ids).toEqual([collectLooseId(hexOf('killed'))]);
    expect(pop.recordIds.has(collectLooseId(hexOf('killed')))).toBe(true);
  });

  it('a truncated census adds no loose name and records why', () => {
    const pop = collectPopulation({ ...none, loose: measured(['x', 'y'], { truncated: true }) });
    expect(pop.ids).toEqual([]);
    expect(pop.looseDoubt).toMatch(/cut at its bound/);
  });

  it('an unmeasured census adds no name and says so; an unavailable one, or none asked, is no doubt', () => {
    const un = collectPopulation({ ...none, loose: { kind: 'unmeasured', why: 'find failed' } });
    expect(un.ids).toEqual([]);
    expect(un.looseDoubt).toMatch(/measured nothing \(find failed\)/);
    expect(collectPopulation({ ...none, loose: { kind: 'unavailable' } }).looseDoubt).toBeNull();
    expect(collectPopulation({ ...none }).looseDoubt).toBeNull();
  });

  it('unread records are said, and a hex that is no hex is counted and never carried', () => {
    const pop = collectPopulation({ ...none, loose: { kind: 'measured', truncated: false, looseHex: ['zz', hexOf('ok')], recordHex: [], recordsUnmeasured: 2 } });
    expect(pop.ids).toEqual([collectLooseId(hexOf('ok'))]);
    expect(pop.refusedNames).toBe(1);
    expect(pop.looseDoubt).toMatch(/2 loose quarantine record/);
  });

  it('a census past the population bound adds none', () => {
    const many = Array.from({ length: 1025 }, (_, i) => `n${i}`);
    const pop = collectPopulation({ ...none, loose: measured(many) });
    expect(pop.ids).toEqual([]);
    expect(pop.looseDoubt).toMatch(/past the 1024/);
  });
});

describe('the open-run hold: rule (e) is a witnessed leaf’s', () => {
  const coord = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-loose-hold-'), '.ccrc', 'coord.db')));
  it('never holds a loose entry for a missing witness run, and still holds a witnessed leaf with none', () => {
    const c = coord();
    const doc = { resume: null, witnessRun: null, witnessAt: null } as const;
    expect(collectOpenRunHold(c, collectLooseId(hexOf('scratch')), doc)).toEqual({ kind: 'clear' });
    expect(collectOpenRunHold(c, 'demo-a', doc)).toMatchObject({ kind: 'held', why: 'no-witness-run' });
  });
});

describe('the feed words (D-6627)', () => {
  const id = collectLooseId(hexOf('scratch dir'));
  it('titles a loose entry’s rows as temp entries and a witnessed id’s as temp roots', () => {
    expect(collectFeedTitle(id, 'would-collect')).toBe('temp entry would be collected');
    expect(collectFeedTitle(id, 'collected')).toBe('temp entry collected');
    expect(COLLECT_LOOSE_FEED_TITLE).toEqual({ collected: 'temp entry collected', 'would-collect': 'temp entry would be collected' });
    expect(collectFeedTitle('demo-a', 'would-collect')).toBe('temp root would be collected');
    expect(collectFeedTitle('demo-a', 'collected')).toBe('temp root collected');
  });
  it('words the name, decoded and made one safe line, never the hex', () => {
    expect(collectFeedWouldCollectBody(id, null, null)).toMatch(/^would collect temp entry scratch dir: /);
    expect(collectFeedWouldCollectBody(id, null, null)).toMatch(/shadowed, so nothing was removed/);
    const body = collectFeedCollectedBody(id, null, null, { kind: 'collected', record: 'r.1.1', resumed: true, witness: 'absent' });
    expect(body).toMatch(/^temp entry scratch dir: the temp-entry collector removed it \(record r\.1\.1\), finishing a collection an earlier attempt began\.$/);
    expect(body).not.toMatch(/witness/);
    expect(collectLooseNameText(hexOf('a\nb\u0007c'))).toBe('a b c');
    expect(collectLooseNameText('ff')).toMatch(/^an entry named by ff/);
  });
});

describe('the lane drives a loose entry: shadow unless BOTH the loose marker and a live lane stand', () => {
  const caps = (f: CollectRig): void => { f.fleetState.ccdVerbs = [...FULL_CAPS, COLLECT_LOOSE_CAP]; };
  const rows = (f: CollectRig, title: string) => f.feed().filter((e) => e.title === title);

  it('a loose census name is audited, and a lane that is not live records would-collect after two observations and composes nothing', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff();
    const id = f.loose.add('scratch');
    await f.passesUntil(() => rows(f, 'temp entry would be collected').length > 0, 6);
    expect(f.audits(id).length).toBeGreaterThanOrEqual(2);
    expect(f.collects()).toEqual([]);
    expect(rows(f, 'temp entry would be collected')[0]!.body).toMatch(/^would collect temp entry scratch: /);
    expect(f.loose.has('scratch')).toBe(true);
  });

  it('a live lane without the loose marker is would-collect: the entry is never removed', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff(); await f.goLive();
    const id = f.loose.add('scratch');
    await f.passesUntil(() => rows(f, 'temp entry would be collected').length > 0, 6);
    for (let i = 0; i < 3; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.collects(id)).toEqual([]);
    expect(f.loose.has('scratch')).toBe(true);
  });

  it('with the lane live AND the loose marker, the second unchanged observation acts, once, with the audit’s own token', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff(); await f.goLive();
    f.loose.arm();
    const id = f.loose.add('scratch');
    await f.passesUntil(() => f.collects(id).length > 0, 8);
    expect(f.audits(id).length, 'one learning audit, then the job’s own').toBeGreaterThanOrEqual(2);
    expect(f.collects(id)).toHaveLength(1);
    expect(f.collects(id)[0]!.token).toBe(f.loose.token(hexOf('scratch')));
    expect(f.loose.has('scratch'), 'the scripted ccd removed it').toBe(false);
    await vi.waitFor(() => expect(rows(f, 'temp entry collected')).toHaveLength(1));
    expect(rows(f, 'temp entry collected')[0]!.body).toMatch(/^temp entry scratch: the temp-entry collector removed it/);
  });

  it('the loose marker alone never arms: a lane that is not live stays shadow', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff();
    f.loose.arm();
    f.loose.add('scratch');
    for (let i = 0; i < 4; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.collects()).toEqual([]);
    expect(rows(f, 'temp entry would be collected').length).toBeGreaterThan(0);
  });

  it('the lane’s pause stops loose acts too: a raised reclaim pause asks nothing', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff(); await f.goLive(); f.loose.arm();
    f.loose.add('scratch');
    f.pause();
    for (let i = 0; i < 3; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.calls.filter((c) => c.id.startsWith('loose:'))).toEqual([]);
    expect(f.collects()).toEqual([]);
  });

  it('the lane going shadow after the loose marker was armed stops the act: the lane’s own switch is never bypassed', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff(); await f.goLive(); f.loose.arm();
    f.disarm();
    f.loose.add('scratch');
    for (let i = 0; i < 4; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.collects()).toEqual([]);
  });

  it('a ccd without collect-loose-v1 skips loose names: no census is asked and nothing loose is audited', async () => {
    const f = await collectRig();                          // FULL_CAPS: no loose capability
    f.pastHoldOff(); await f.goLive(); f.loose.arm();
    f.loose.add('scratch');
    for (let i = 0; i < 3; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.loose.censusCalls()).toBe(0);
    expect(f.calls.filter((c) => c.id.startsWith('loose:'))).toEqual([]);
  });

  it('a class other than loose is never audited: a witnessed, registered or refused entry is the census’s to name, not the lane’s', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff();
    for (const cls of ['witnessed', 'registered', 'refused', 'quarantine']) f.loose.add(`n-${cls}`, cls);
    for (let i = 0; i < 3; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.loose.censusCalls()).toBeGreaterThan(0);
    expect(f.calls.filter((c) => c.id.startsWith('loose:'))).toEqual([]);
  });

  it('a truncated census audits no entry', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff();
    f.loose.add('scratch'); f.loose.truncate(true);
    for (let i = 0; i < 3; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.loose.censusCalls()).toBeGreaterThan(0);
    expect(f.calls.filter((c) => c.id.startsWith('loose:'))).toEqual([]);
  });

  it('an unreadable census is not an empty one: nothing is audited, and the next readable census resumes', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff();
    f.loose.add('scratch'); f.loose.answerCensus({ code: 1, stdout: 'not json' });
    for (let i = 0; i < 2; i += 1) { f.next(); await f.pass(); await f.settled(); }
    expect(f.calls.filter((c) => c.id.startsWith('loose:'))).toEqual([]);
    f.loose.answerCensus(null);
    await f.passesUntil(() => f.audits(f.loose.idOf('scratch')).length > 0, 3);
  });

  it('a loose entry that left the census is forgotten: its observation does not carry to a recreated name', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff();
    const id = f.loose.add('scratch');
    await f.passesUntil(() => f.lane().entries.has(id), 3);
    f.loose.remove('scratch');
    f.next(); await f.pass(); await f.settled();
    expect(f.lane().entries.has(id)).toBe(false);
  });

  it('a witnessed temp root beside it is unchanged: still audited, still held when its witness names no run', async () => {
    const f = await collectRig(); caps(f);
    f.pastHoldOff();
    f.witness('demo-a'); f.loose.add('scratch');
    await f.passesUntil(() => f.wouldCollects('demo-a').length > 0, 6);
    expect(f.audits('demo-a').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the executor’s loose job: its own capabilities, the licence, and the marker read from the LAST listing', () => {
  const NAME_HEX = hexOf('scratch');
  const ID_L = collectLooseId(NAME_HEX);
  const LOOSE_CAPS = [...FULL_CAPS, COLLECT_LOOSE_CAP];
  const looseDoc = (token = TOK): string => JSON.stringify({
    mode: 'collect-loose', name: NAME_HEX, collect: { class: 'loose', unmeasured: null }, verdict: 'collectable', detail: '', token });
  const doneDoc = JSON.stringify({ collected: NAME_HEX, record: 'r.1.1', resumed: false, loose: true });
  const looseRig = (o: Parameters<typeof rig>[0] = {}) => {
    const r = rig({ caps: LOOSE_CAPS, ...o });
    r.answerAudit(() => ({ code: 0, stdout: looseDoc(), stderr: '' }));
    r.answerAct(() => ({ code: 0, stdout: doneDoc, stderr: '' }));
    return r;
  };
  const verbs = (r: ReturnType<typeof looseRig>): string[] => r.attempts.map((a) => a[0]!);

  it('with the lane live and the marker standing, the act is the loose verb: the audit’s own token, the entry’s hex, never a --session', async () => {
    const r = looseRig();
    r.raise(COLLECT_LOOSE_LIVE_MARKER);
    const out = await collectTempRoot(r.deps, r.job(ID_L));
    expect(out).toMatchObject({ kind: 'acted', result: { kind: 'collected', record: 'r.1.1', resumed: false } });
    expect(r.attempts[0]).toEqual(['ws-audit', '--loose-hex', NAME_HEX, '--collect']);
    expect(r.attempts[1]!.slice(0, 5)).toEqual(['ws-collect', '--expect', TOK, '--loose-hex', NAME_HEX]);
    expect(r.attempts.flat()).not.toContain('--session');
  });

  it('without the loose marker the same live lane is would-collect: the verb is never composed', async () => {
    const r = looseRig();
    expect(await collectTempRoot(r.deps, r.job(ID_L))).toMatchObject({ kind: 'would-collect' });
    expect(verbs(r)).toEqual(['ws-audit']);
  });

  it('the marker is read from the FINAL listing: raised only at step 5 it acts, lowered at step 5 it does not', async () => {
    const late = looseRig();
    late.hooks.listing = (n) => { if (n === 2) late.raise(COLLECT_LOOSE_LIVE_MARKER); };
    expect(await collectTempRoot(late.deps, late.job(ID_L))).toMatchObject({ kind: 'acted' });
    const gone = looseRig();
    gone.raise(COLLECT_LOOSE_LIVE_MARKER);
    gone.hooks.listing = (n) => { if (n === 2) gone.lower(COLLECT_LOOSE_LIVE_MARKER); };
    expect(await collectTempRoot(gone.deps, gone.job(ID_L))).toMatchObject({ kind: 'would-collect' });
    expect(verbs(gone)).toEqual(['ws-audit']);
  });

  it('the marker never arms a lane that is not live', async () => {
    const r = looseRig({ live: false });
    r.raise(COLLECT_LOOSE_LIVE_MARKER);
    expect(await collectTempRoot(r.deps, r.job(ID_L))).toMatchObject({ kind: 'would-collect' });
    expect(verbs(r)).toEqual(['ws-audit']);
  });

  it('a withdrawn loose capability before the act leaves shadow, and before the job asks anything it is a lane-wide clear', async () => {
    const r = looseRig();
    r.raise(COLLECT_LOOSE_LIVE_MARKER);
    r.hooks.audit = () => { r.state.ccdVerbs = [...FULL_CAPS]; };
    const out = await collectTempRoot(r.deps, r.job(ID_L));
    expect(out.kind).not.toBe('acted');
    expect(verbs(r)).toEqual(['ws-audit']);
    const bare = rig();                                             // FULL_CAPS: no collect-loose-v1
    expect(await collectTempRoot(bare.deps, bare.job(ID_L))).toMatchObject({ kind: 'not-asked', step: 1, why: 'caps' });
    expect(bare.attempts).toEqual([]);
    expect(bare.lane.clears).toEqual(['caps']);
  });

  it('a single observation never licenses: no observation 1 composes nothing, and neither does another token', async () => {
    const none = looseRig({ obs1: null });
    none.raise(COLLECT_LOOSE_LIVE_MARKER);
    expect(await collectTempRoot(none.deps, none.job(ID_L))).toMatchObject({ kind: 'answered', why: 'not-licensed' });
    expect(verbs(none)).toEqual(['ws-audit']);
    const other = looseRig({ obs1: { ...RIPE, token: TOK2 } });
    other.raise(COLLECT_LOOSE_LIVE_MARKER);
    expect(await collectTempRoot(other.deps, other.job(ID_L))).toMatchObject({ kind: 'answered', why: 'not-licensed' });
    expect(verbs(other)).toEqual(['ws-audit']);
  });

  it('a malformed loose id is refused before any argv: no census prefix, no odd hex', async () => {
    const r = looseRig();
    for (const id of ['loose:', 'loose:abc', 'loose:ZZ', 'loose:ab cd']) {
      expect(await collectTempRoot(r.deps, r.job(id)), id).toMatchObject({ kind: 'not-asked', step: 1, why: 'id-refused' });
    }
    expect(r.attempts).toEqual([]);
  });

  it('a pause stops a loose job at step 2, whatever the marker says', async () => {
    const r = looseRig({ paused: true });
    r.raise(COLLECT_LOOSE_LIVE_MARKER);
    expect(await collectTempRoot(r.deps, r.job(ID_L))).toMatchObject({ kind: 'not-asked', step: 2, why: 'paused' });
    expect(r.attempts).toEqual([]);
  });

  it('a refusal from the loose verb is the witnessed verb’s refusal, read by the same reader', async () => {
    const r = looseRig();
    r.raise(COLLECT_LOOSE_LIVE_MARKER);
    r.answerAct(() => ({ code: 0, stdout: JSON.stringify({ refused: 'state-changed', detail: 'it moved', paths: [] }), stderr: '' }));
    expect(await collectTempRoot(r.deps, r.job(ID_L))).toMatchObject({ kind: 'acted', result: { kind: 'refused', word: 'state-changed' } });
  });
});
