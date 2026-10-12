// Child reclamation wave 9 (spec §5.10, §5.9): the temp-root collector's attention. The lane's memory says what stands
// for each id; `collectAttentionItems` (L1) turns it into ONE item per id plus the box-wide lines, and
// `childReclaimAttentionWithLeaves` merges them: a reclaim item over a collector item over a kept-leaf item, the winner
// carrying the loser's operator instruction as a second clause. Pure: no clock, file or row is read here, and the last
// case reads the result through the PWA's own reader, so every shape renders with no PWA edit.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  COLLECT_BOX_LABELS, isSessionIdShape, isTmpRootId, lcRefusalWord,
  type ChildReclaimAttention, type ChildReclaimCollectAttention,
} from '../../shared/api.js';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_KEPT_MANY_OVER, CHILD_RECLAIM_SKIP, CHILD_RECLAIM_TIER_NONE,
  childReclaimAttentionWithLeaves, childReclaimClipsSecond, childReclaimCollectManySentence,
  childReclaimKeptManySentence, childReclaimTierFrom, type ChildReclaimCollectInput, type ChildReclaimLeafKept,
} from '../src/childReclaimSweep.js';
import {
  COLLECT_RUN_NONE, collectAfterAct, collectAfterAudit, collectAfterHold, collectAfterPresence, collectAttentionItems,
  collectAttentionViewOf, collectBoxProbesAfter, collectBoxProbesAtArrival, collectFeedStep, collectFirstSighting, collectPassClass,
  collectRunTier, collectWouldCollectKey, parseCollectResult,
  type CollectAttentionView, type CollectAudit, type CollectBoxFacts, type CollectBoxProbeState, type CollectEntry,
  type CollectRunView,
} from '../src/collectLane.js';
import { COLLECTED, DAY, DIE, NO_DOCUMENT, T1, collectable, step, unmeasured, verdict } from './collectAnswers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = 90_000_000;                      // the lane's monotonic clock
const CEIL = CHILD_RECLAIM_DEFER_CEILING_MS;
const NL = String.fromCharCode(10);
const RLO = String.fromCharCode(0x202e);

const NO_RUN: CollectRunView = { tier: CHILD_RECLAIM_TIER_NONE, word: null, detail: null };
const runOf = (cls: string, word: string, n: number, stuck = false, detail: string | null = null): CollectRunView =>
  ({ tier: childReclaimTierFrom(cls, n, stuck), word, detail });
const view = (over: Partial<CollectAttentionView> = {}): CollectAttentionView => ({
  witnessRun: 41, leaf: '/h/tmp-root/demo-a', failing: NO_RUN, verbFailed: NO_RUN, terminal: NO_RUN, deferral: null,
  presenceSince: null, hold: null, changedRecentlySince: null, die: null, wouldCollect: false, ...over,
});
const BOX: CollectBoxFacts = {
  unmeasured: [], refusedNames: 0, boxProbes: new Map(), passAudits: new Map(), flockLatched: false, unsettled: new Map(),
};
const items = (entries: Readonly<Record<string, CollectAttentionView>>, box: Partial<CollectBoxFacts> = {},
  nowMono = NOW): ChildReclaimCollectInput =>
  collectAttentionItems({ entries: new Map(Object.entries(entries)), box: { ...BOX, ...box }, nowMono });
const one = (v: CollectAttentionView, nowMono = NOW): ChildReclaimCollectAttention | undefined =>
  items({ 'demo-a': v }, {}, nowMono).perId[0];

describe('collectAttentionItems — one item per id, each at its own threshold (spec §5.10)', () => {
  it('in-use is listed at once, naming the holder ccd named, through childReclaimDetailText', () => {
    const a = one(view({ deferral: { word: 'in-use', detail: `pid 7 (tmux: server) holds /proc/7/fd/3${NL}${RLO}x`, since: NOW } }));
    expect(a).toEqual({ kind: 'collect', sessionId: 'demo-a', runId: 41, word: 'in-use', sentence:
      'A process still uses its temp root /h/tmp-root/demo-a, so the temp-root collector leaves it alone. What ccd '
      + 'said: pid 7 (tmux: server) holds /proc/7/fd/3 x. ccrc never stops a process; it asks again later, and this '
      + 'line ends once nothing uses it.' });
  });

  it('a standing registered, in-progress, presence or per-id hold is listed under its own word (WHEN each stands is Task 4’s)', () => {
    const cases: readonly (readonly [string, CollectAttentionView])[] = [
      ['registered', view({ deferral: { word: 'registered', detail: '', since: 0 } })],
      ['in-progress', view({ deferral: { word: 'in-progress', detail: '', since: 0 } })],
      ['presence', view({ presenceSince: 0 })],
      ['held', view({ hold: { why: 'run-open', since: 0 } })],
    ];
    for (const [word, v] of cases) expect(one(v)?.word, word).toBe(word);
  });

  it('in-progress names the reap lock path, and no holder ccd did not name', () => {
    const s = one(view({ deferral: { word: 'in-progress', detail: '', since: NOW - CEIL - 1 } }))!.sentence;
    expect(s).toContain('~/.cc-sessions/.reap-demo-a.lock');
    expect(s).not.toMatch(/pid|holder/);
  });

  it('a per-leaf deterministic answer is listed at once; a load-sensitive one, no-document and lock only at tier entry', () => {
    expect(one(view({ failing: runOf('failing', 'device', 1, true, 'a mount') }))?.word, 'device at once').toBe('per-leaf');
    for (const probe of ['checkouts', 'no-document', 'lock', 'idle:timeout']) {
      expect(one(view({ failing: runOf('failing', probe, 3) })), `${probe} x3`).toBeUndefined();
      expect(one(view({ failing: runOf('failing', probe, 4) }))?.word, `${probe} x4`).toBe('failing');
    }
    expect(one(view({ failing: runOf('failing', 'no-document', 4) }))!.sentence).toContain('(ccd answered nothing)');
  });

  it('a verb failure is listed at tier entry, never before', () => {
    expect(one(view({ verbFailed: runOf('verb-failed', 'probe-unmeasured', 3) }))).toBeUndefined();
    expect(one(view({ verbFailed: runOf('verb-failed', 'probe-unmeasured', 4) }))?.word).toBe('verb-failed');
  });

  it('an unknown probe or failure word reaches its sentence only through childReclaimDetailText', () => {
    const bad = `fro${NL}${RLO}b`;
    for (const v of [view({ failing: runOf('failing', bad, 4) }), view({ verbFailed: runOf('verb-failed', bad, 4) })]) {
      const s = one(v)!.sentence;
      expect(s.includes(NL) || s.includes(RLO), s).toBe(false);
      expect(s).toContain('(fro b)');
    }
  });

  it('a terminal answer is listed at once with what ccd last answered, never that it refuses now, and outranks a standing in-use', () => {
    const terminal = runOf('terminal', 'witness-mismatch', 1, true, 'witness unreadable');
    expect(one(view({ witnessRun: null, terminal }))).toEqual({ kind: 'collect', sessionId: 'demo-a', runId: null,
      word: 'witness-mismatch', sentence: 'Its temp root /h/tmp-root/demo-a: ccd’s last terminal answer for it was '
        + `witness-mismatch, which said: “${lcRefusalWord('witness-mismatch')}” What ccd said: witness unreadable. `
        + 'ccrc asks again on a long, capped schedule.' });
    expect(one(view({ terminal, deferral: { word: 'in-use', detail: 'pid 7', since: NOW } }))?.word).toBe('witness-mismatch');
    expect(one(view({ terminal: runOf('terminal', 'containment-unproven', 1, true) }))!.sentence)
      .toContain('ccd’s last terminal answer for it was containment-unproven, which means');
  });

  it('a standing changed-recently is listed', () => {
    expect(one(view({ changedRecentlySince: 0 }))?.word).toBe('changed-recently');
  });

  it('a standing would-collect episode is listed, in words true whether the lane is still shadowed or armed since', () => {
    const a = one(view({ wouldCollect: true }))!;
    expect(a.word).toBe('would-collect');
    expect(a.sentence).toContain('While the collector was shadowed');
    expect(a.sentence, 'a flip to live does not end the episode, so no present-tense shadow').not.toMatch(/is shadowed|arms it by hand/);
  });

  it('a pre-lock die recurring past the ceiling is listed, naming ccd’s word; nothing was removed', () => {
    const a = one(view({ die: { word: 'lock-unopenable', since: 0 } }))!;
    expect(a.word).toBe('die');
    expect(a.sentence).toContain('(lock-unopenable)');
    expect(a.sentence).toContain('nothing was removed');
  });

  it('records lists no per-id item while tmpquarantine is unmeasured', () => {
    const v = { 'demo-a': view({ failing: runOf('failing', 'records', 4) }) };
    expect(items(v).perId.map((a) => a.word)).toEqual(['failing']);
    const blind = items(v, { unmeasured: [{ listing: 'tmpquarantine', kind: 'unmeasured', why: 'x' }] });
    expect(blind.perId).toEqual([]);
    expect(blind.box.map((a) => a.word)).toEqual(['tmpquarantine']);
  });

  it('an id that fails isTmpRootId never lists, and nothing standing lists nothing', () => {
    const inUse = view({ deferral: { word: 'in-use', detail: 'pid 7', since: NOW } });
    expect(items({ '-x': inUse, '.y': inUse }).perId).toEqual([]);
    expect(items({ 'demo-a': view() })).toEqual({ perId: [], manyLead: {}, box: [] });
  });
});

describe('whose words a sentence quotes: ccd’s, or ccrc’s own (spec §5.10)', () => {
  const SAW = 'ws-collect reported collecting demo-other, not demo-a';
  const ccrcsOwn = 'keep failing (ccrc could not accept ccd’s answer). What ccrc saw: ws-collect reported collecting demo-other, not demo-a.';

  it('a verb failure this reader made reads as ccrc’s: no empty brackets, and no “What ccd said”', () => {
    const s = one(view({ verbFailed: runOf('verb-failed', '', 4, false, SAW) }))!.sentence;
    expect(s).toContain(ccrcsOwn);
    expect(s).not.toContain('()');
    expect(s).not.toContain('What ccd said');
  });

  it.each<readonly [string, 'failing' | 'verb-failed', string]>([
    ['an empty word, which the reader makes', 'verb-failed', ''],
    ['no-document, from an act', 'verb-failed', 'no-document'],
    ['no-document, from an audit', 'failing', 'no-document'],
    ['unreadable, from an audit', 'failing', 'unreadable'],
  ])('%s: its detail is what ccrc saw, never what ccd said', (_what, run, word) => {
    const r = runOf(run, word, 4, false, 'text ccrc saw');
    const s = one(view(run === 'failing' ? { failing: r } : { verbFailed: r }))!.sentence;
    expect(s).toContain(' What ccrc saw: text ccrc saw.');
    expect(s).not.toContain('What ccd said');
  });

  it('CONTROL: a word ccd said keeps “What ccd said”, in a terminal item, a per-leaf item and a verb failure alike', () => {
    expect(one(view({ verbFailed: runOf('verb-failed', 'probe-unmeasured', 4, false, 'd') }))!.sentence)
      .toContain('(probe-unmeasured). What ccd said: d.');
    expect(one(view({ failing: runOf('failing', 'device', 1, true, 'a mount') }))!.sentence).toContain('What ccd said: a mount.');
    const t = one(view({ terminal: runOf('terminal', 'witness-mismatch', 1, true, 'w') }))!.sentence;
    expect(t).toContain('What ccd said: w.');
    expect(t).not.toContain('What ccrc saw');
  });

  it('a word made only of characters a sentence may not carry reads as one this build cannot show, never as empty brackets', () => {
    for (const v of [view({ failing: runOf('failing', RLO, 4) }), view({ verbFailed: runOf('verb-failed', RLO, 4) })]) {
      const s = one(v)!.sentence;
      expect(s).toContain('(a word this build cannot show)');
      expect(s).not.toContain('()');
    }
  });

  it.each<readonly [string, string, string]>([
    ['a collected document for another id', JSON.stringify({ collected: 'demo-other', record: null, resumed: false, witness: 'dropped' }), SAW],
    ['a failed document with no word', JSON.stringify({ failed: '', detail: 'ccd’s own text' }), 'ws-collect answered failed with no word'],
  ])('end to end: %s, four times over, is listed as ccrc’s own words', (_what, doc, saw) => {
    const result = parseCollectResult('demo-a', false, `${doc}\n`, '');
    expect(result).toEqual({ kind: 'failed', token: '', detail: saw });
    const e = [2, 3, 4, 5].reduce((x, gen) => collectAfterAct(x, result, step(gen * 1000, gen)), collectFirstSighting(1));
    const sentence = one(collectAttentionViewOf(e))!.sentence;
    expect(sentence).toContain(`keep failing (ccrc could not accept ccd’s answer). What ccrc saw: ${saw}.`);
    expect(sentence).not.toContain('What ccd said');
    expect(sentence).not.toContain('()');
  });
});

describe('box-wide lines: single items under fixed labels (spec §5.10)', () => {
  it('every label is spelled once, holds a slash, which no registry file name can carry, and is no session id', () => {
    const labels = Object.values(COLLECT_BOX_LABELS);
    expect(Object.keys(COLLECT_BOX_LABELS).sort()).toEqual(['box-probe', 'flock', 'lock', 'no-document', 'no-run',
      'refused-names', 'tmpquarantine', 'tmproots', 'unsettled', 'unvouched']);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) {
      expect(/\//.test(l), l).toBe(true);
      expect(isSessionIdShape(l), l).toBe(false);
      expect(isTmpRootId(l), l).toBe(false);
    }
  });

  it('an unmeasured listing, an over-cap listing and refused names: one line each, in the label table’s order, counts only', () => {
    const got = items({}, { unmeasured: [{ listing: 'tmpquarantine', kind: 'unmeasured', why: `a symbolic link${NL}` },
      { listing: 'tmproots', kind: 'over-cap', count: 100_000 }], refusedNames: 3 }).box;
    expect(got.map((a) => [a.sessionId, a.word, a.runId])).toEqual([
      [COLLECT_BOX_LABELS.tmproots, 'tmproots', null], [COLLECT_BOX_LABELS.tmpquarantine, 'tmpquarantine', null],
      [COLLECT_BOX_LABELS['refused-names'], 'refused-names', null]]);
    expect(got[0]!.sentence).toContain(`${COLLECT_BOX_LABELS.tmproots} holds 100000 names`);
    expect(got[1]!.sentence.includes(NL)).toBe(false);
    expect(got[2]!.sentence.startsWith('3 names under')).toBe(true);
    expect(got[2]!.sentence, 'Task 3 counts more than dashes and length').toContain('is no quarantine record of one');
  });

  it('box-wide probes: ONE line naming each probe with ccd’s detail', () => {
    const got = items({}, { boxProbes: new Map([['mv', `no mv${NL}${RLO}`], ['floor', 'unset']]) }).box;
    expect(got).toHaveLength(1);
    expect(got[0]!.sessionId).toBe(COLLECT_BOX_LABELS['box-probe']);
    expect(got[0]!.sentence).toContain('floor (unset); mv (no mv)');
  });

  it('no-document and lock: a line only for two or more ids, with nothing else answered that pass', () => {
    const pa = (e: Readonly<Record<string, 'no-document' | 'lock' | 'other'>>): string[] =>
      items({}, { passAudits: new Map(Object.entries(e)) }).box.map((a) => a.word);
    expect(pa({ a: 'no-document' })).toEqual([]);
    expect(pa({ a: 'no-document', b: 'no-document' })).toEqual(['no-document']);
    expect(pa({ a: 'no-document', b: 'no-document', c: 'other' })).toEqual([]);
    expect(pa({ a: 'lock' }), 'one id with a planted lock directory raises no box-wide line').toEqual([]);
    expect(pa({ a: 'lock', b: 'lock' })).toEqual(['lock']);
    expect(pa({ a: 'lock', b: 'lock', c: 'no-document' })).toEqual([]);
  });

  it('the flock latch and unsettled calls or jobs each raise one line; unsettled names its ids, and a job says the act slot is held, its act out or not', () => {
    expect(items({}, { flockLatched: true }).box.map((a) => a.word)).toEqual(['flock']);
    const two = items({}, { unsettled: new Map([['demo-b', 'audit'], ['demo-a', 'audit']]) }).box;
    expect(two.map((a) => a.word)).toEqual(['unsettled']);
    expect(two[0]!.sentence).toContain('demo-a, demo-b');
    expect(two[0]!.sentence, 'audits alone hold no slot').not.toContain('act slot');
    const u = items({}, { unsettled: new Map([['demo-b', 'audit'], ['demo-a', 'act']]) }).box;
    expect(u[0]!.sentence).toContain('within its bound for demo-b.');
    expect(u[0]!.sentence, 'a job whose act is out holds the slot too').toContain('act slot is held by the job for demo-a');
    const j = items({}, { unsettled: new Map([['demo-b', 'audit'], ['demo-c', 'job']]) }).box;
    expect(j.map((a) => a.word)).toEqual(['unsettled']);
    expect(j[0]!.sentence).toContain('within its bound for demo-b.');
    expect(j[0]!.sentence).toContain('act slot is held by the job for demo-c');
  });

  it('ids held by run-absent or run-after-witness share ONE line naming at most five ids (a hold short of the ceiling projects to null)', () => {
    const held = (why: 'run-absent' | 'run-after-witness' | 'run-open') => view({ hold: { why, since: 0 } });
    const entries = Object.fromEntries([
      ...['demo-1', 'demo-2', 'demo-3', 'demo-4'].map((id) => [id, held('run-absent')]),
      ...['demo-5', 'demo-6', 'demo-7'].map((id) => [id, held('run-after-witness')]),
      ['demo-8', held('run-open')], ['demo-9', view()],
    ]);
    const got = items(entries);
    expect(got.perId.map((a) => [a.sessionId, a.word])).toEqual([['demo-8', 'held']]);
    expect(got.box.map((a) => a.word)).toEqual(['unvouched']);
    expect(got.box[0]!.sentence).toContain('7 temp roots are held');
    expect(got.box[0]!.sentence).toContain('demo-1, demo-2, demo-3, demo-4, demo-5, and 2 more');
  });
});

describe('collectPassClass and collectBoxProbesAfter (spec §5.10)', () => {
  it('classes an audit for the two pass-scoped lines', () => {
    expect(collectPassClass(NO_DOCUMENT)).toBe('no-document');
    expect(collectPassClass(unmeasured('lock'))).toBe('lock');
    expect(collectPassClass(unmeasured('checkouts'))).toBe('other');
    expect(collectPassClass(verdict('in-use'))).toBe('other');
  });

  it('a box-wide probe stands until an answer passes every rung; a per-id answer leaves it standing', () => {
    const s1 = collectBoxProbesAfter(new Map(), unmeasured('mv'));
    expect([...s1]).toEqual([['mv', 'mv: d']]);
    for (const a of [unmeasured('checkouts'), verdict('registered'), NO_DOCUMENT]) {
      expect(collectBoxProbesAfter(s1, a), JSON.stringify(a)).toBe(s1);
    }
    for (const a of [collectable(T1), verdict('changed-recently'), COLLECTED]) {
      expect(collectBoxProbesAfter(s1, a).size, JSON.stringify(a)).toBe(0);
    }
  });
});

describe('collectBoxProbesAtArrival: an answer older than the probes\' latest change says nothing of them (spec §5.10)', () => {
  const STAMP = 1_000;
  const standing = (): CollectBoxProbeState => ({ probes: new Map([['mv', 'mv: d']]), changedAtMono: STAMP });

  it('an answer that arrived before the latest change is skipped whole: the very state comes back', () => {
    const s = standing();
    expect(collectBoxProbesAtArrival(s, collectable(T1), STAMP - 1)).toBe(s);
    expect(collectBoxProbesAtArrival(s, unmeasured('floor'), STAMP - 1), 'an older set is skipped too').toBe(s);
  });

  it('a tie applies: an answer that arrived at the stamp itself is not older', () => {
    const got = collectBoxProbesAtArrival(standing(), collectable(T1), STAMP);
    expect([got.probes.size, got.changedAtMono]).toEqual([0, STAMP]);
  });

  it('an answer collectBoxProbesAfter returns the standing map for (a per-id probe, a non-passing verdict, no document) never moves the stamp: the very state comes back (an empty pass is a new map, below)', () => {
    const s = standing();
    for (const a of [unmeasured('checkouts'), verdict('registered'), NO_DOCUMENT]) {
      expect(collectBoxProbesAtArrival(s, a, STAMP + 500), JSON.stringify(a)).toBe(s);
    }
  });

  it('an answer that changes the probes moves the stamp to its own arrival', () => {
    const set = collectBoxProbesAtArrival(standing(), unmeasured('floor'), STAMP + 500);
    expect([...set.probes], 'a second probe joins').toEqual([['mv', 'mv: d'], ['floor', 'floor: d']]);
    expect(set.changedAtMono).toBe(STAMP + 500);
    const cleared = collectBoxProbesAtArrival(set, COLLECTED, STAMP + 900);
    expect([cleared.probes.size, cleared.changedAtMono], 'an answer that passes every rung clears them').toEqual([0, STAMP + 900]);
  });

  it('a box-wide answer re-asserting a standing probe is a newer word about the box: it moves the stamp, so an older passing answer is skipped', () => {
    const empty: CollectBoxProbeState = { probes: new Map(), changedAtMono: Number.NEGATIVE_INFINITY };
    const s1 = collectBoxProbesAtArrival(empty, unmeasured('mv'), 50);
    const s2 = collectBoxProbesAtArrival(s1, unmeasured('mv'), 150);
    expect([...s2.probes]).toEqual([...s1.probes]);
    expect(s2.changedAtMono).toBe(150);
    expect(collectBoxProbesAtArrival(s2, collectable(T1), 100)).toBe(s2);
  });

  it('an empty pass is a new map: a passing answer with nothing standing moves the stamp, so an older raise folded after it is skipped', () => {
    const empty: CollectBoxProbeState = { probes: new Map(), changedAtMono: Number.NEGATIVE_INFINITY };
    const passed = collectBoxProbesAtArrival(empty, collectable(T1), 100);
    expect([passed.probes.size, passed.changedAtMono], 'nothing stood, and the stamp moved').toEqual([0, 100]);
    expect(collectBoxProbesAtArrival(passed, unmeasured('mv'), 50), 'a raise that arrived before the pass')
      .toBe(passed);
  });

  it('a passing answer older than a later set is skipped, and one at or after it clears', () => {
    const empty: CollectBoxProbeState = { probes: new Map(), changedAtMono: Number.NEGATIVE_INFINITY };
    const set = collectBoxProbesAtArrival(empty, unmeasured('mv'), 200);
    expect([[...set.probes], set.changedAtMono], 'from the first state, anything applies').toEqual([[['mv', 'mv: d']], 200]);
    expect(collectBoxProbesAtArrival(set, collectable(T1), 150), 'a passing answer that arrived before the set').toBe(set);
    expect(collectBoxProbesAtArrival(set, collectable(T1), 200).probes.size).toBe(0);
  });
});

describe('collectAttentionViewOf — Task 4’s causes decide what stands, first answer to latest, inclusive (spec §5.10)', () => {
  const after = (answers: readonly (readonly [number, CollectAudit])[]): CollectEntry =>
    answers.reduce((e, [mono, a], k) => collectAfterAudit(e, a, step(mono, k + 2), true), collectFirstSighting(1));

  it('in-use stands at its first answer, with ccd’s latest detail', () => {
    expect(collectAttentionViewOf(after([[0, verdict('in-use')]])).deferral)
      .toEqual({ word: 'in-use', detail: 'in-use: d', since: 0 });
  });

  it('registered and in-progress stand once their first and latest answers are a ceiling apart, not a millisecond sooner', () => {
    for (const word of ['registered', 'in-progress']) {
      expect(collectAttentionViewOf(after([[0, verdict(word)], [CEIL - 1, verdict(word)]])).deferral, `${word} short`).toBeNull();
      expect(collectAttentionViewOf(after([[0, verdict(word)], [CEIL, verdict(word)]])).deferral, `${word} at the ceiling`)
        .toEqual({ word, detail: `${word}: d`, since: 0 });
    }
  });

  it('changed-recently stands once its streak spans a day, first answer to latest', () => {
    const cr = verdict('changed-recently');
    expect(collectAttentionViewOf(after([[0, cr], [DAY - 1, cr]])).changedRecentlySince).toBeNull();
    expect(collectAttentionViewOf(after([[0, cr], [DAY, cr]])).changedRecentlySince).toBe(0);
  });

  it('a hold and presence stand once they span a ceiling, first answer to latest', () => {
    const held = (gap: number): CollectEntry =>
      collectAfterHold(collectAfterHold(collectFirstSighting(1), 'run-open', step(0, 2)), 'run-open', step(gap, 3));
    expect(collectAttentionViewOf(held(CEIL - 1)).hold, 'held short').toBeNull();
    expect(collectAttentionViewOf(held(CEIL)).hold).toEqual({ why: 'run-open', since: 0 });
    const present = (gap: number): CollectEntry =>
      collectAfterPresence(collectAfterPresence(collectFirstSighting(1), step(0, 2)), step(gap, 3));
    expect(collectAttentionViewOf(present(CEIL - 1)).presenceSince, 'presence short').toBeNull();
    expect(collectAttentionViewOf(present(CEIL)).presenceSince).toBe(0);
  });

  it('a pre-lock die recurring for a ceiling, first answer to latest, stands; a shorter recurrence does not', () => {
    const died = (gap: number): CollectEntry =>
      collectAfterAct(collectAfterAct(collectFirstSighting(1), DIE, step(0, 2)), DIE, step(gap, 3));
    expect(collectAttentionViewOf(died(CEIL - 1)).die).toBeNull();
    expect(collectAttentionViewOf(died(CEIL)).die).toEqual({ word: 'lock-unopenable', since: 0 });
  });

  it('each run projects its tier, its latest word and detail; the evidence is the latest document’s', () => {
    const e = after([[0, unmeasured('device')]]);
    const v = collectAttentionViewOf(e);
    expect(v.failing).toEqual({ tier: collectRunTier(e.failing, 'failing'), word: 'device', detail: 'device: d' });
    expect(v.failing.tier.tier, 'a per-leaf probe enters the tier at once').toBe(true);
    expect(v.terminal).toEqual({ tier: collectRunTier(COLLECT_RUN_NONE, 'terminal'), word: null, detail: null });
    expect([v.witnessRun, v.leaf]).toEqual([7, '/home/u/.cc-tmp/demo-a']);
  });

  it('wouldCollect is true while the would-collect episode stands, and false once another row opens', () => {
    const w = collectFeedStep(collectFirstSighting(1), { kind: 'row', key: collectWouldCollectKey(T1) }).entry;
    expect(collectAttentionViewOf(w).wouldCollect).toBe(true);
    expect(collectAttentionViewOf(collectFeedStep(w, { kind: 'row', key: 'in-use' }).entry).wouldCollect).toBe(false);
  });
});

describe('the merge: reclaim over collector over leaf-kept, with second clauses (spec §5.9, §5.10)', () => {
  const CLAUSE = 'its clips directory ~/.cc-clips/demo-c (refused: its removal helper refused it)';
  const col = (sessionId: string, word: string, runId: number | null = 41): ChildReclaimCollectAttention =>
    ({ kind: 'collect', sessionId, runId, word, sentence: `c ${sessionId}.` });
  const leaf = (sessionId: string, clipsClause: string | null): ChildReclaimLeafKept => ({
    item: { kind: 'leaf-kept', sessionId, runId: 41, sentence: `s ${sessionId}`, at: 1 }, source: 1, detail: null, clipsClause });
  const input = (perId: readonly ChildReclaimCollectAttention[], box: readonly ChildReclaimCollectAttention[] = []): ChildReclaimCollectInput =>
    ({ perId, manyLead: Object.fromEntries(perId.map((c) => [c.word, `lead ${c.word}`])), box });
  const term: ChildReclaimAttention = { kind: 'terminal', sessionId: 'demo-c', runId: 1, token: 'tree-unreadable', sentence: 't.', at: 1 };
  const ids = (n: number): string[] => Array.from({ length: n }, (_, k) => `demo-${String.fromCharCode(97 + k)}`);

  it('the clips clause and the collapsed sentence, verbatim', () => {
    expect(childReclaimClipsSecond('X')).toBe('Also, an earlier reclaim of this id may have left a clips directory on '
      + 'disk: X. ccrc never removes the clips directory; a person removes it once nothing still uses it.');
    expect(childReclaimCollectManySentence(6, 'L')).toBe('6 temp roots are listed for the same reason. For each one: L');
  });

  it('a reclaim item wins over a collector item and carries a quarantine-kept sentence; any other collector word is dropped', () => {
    expect(childReclaimAttentionWithLeaves([term], [], input([{ ...col('demo-c', 'quarantine-kept'), sentence: 'Q.' }])))
      .toEqual([{ ...term, sentence: 't. Q.' }]);
    expect(childReclaimAttentionWithLeaves([term], [], input([col('demo-c', 'in-use')]))).toEqual([term]);
  });

  it('a second clause the winner already gives is not given twice', () => {
    const said: ChildReclaimAttention = { ...term, sentence: 't. Q.' };
    expect(childReclaimAttentionWithLeaves([said], [], input([{ ...col('demo-c', 'quarantine-kept'), sentence: 'Q.' }])))
      .toEqual([said]);
  });

  it('leaf-yield-carries-the-clips-clause: a reclaim item carries a leaf’s clips clause; a leaf with none adds nothing', () => {
    expect(childReclaimAttentionWithLeaves([term], [leaf('demo-c', CLAUSE)], input([])))
      .toEqual([{ ...term, sentence: `t. ${childReclaimClipsSecond(CLAUSE)}` }]);
    expect(childReclaimAttentionWithLeaves([term], [leaf('demo-c', null)], input([]))).toEqual([term]);
  });

  it('a collector item wins over a leaf item and carries its clips clause', () => {
    expect(childReclaimAttentionWithLeaves([], [leaf('demo-c', CLAUSE)], input([col('demo-c', 'in-use')])))
      .toEqual([{ ...col('demo-c', 'in-use'), sentence: `c demo-c. ${childReclaimClipsSecond(CLAUSE)}` }]);
  });

  it('an item carrying a second clause never collapses: an id with both, among six collector items with runs, keeps its clips sentence', () => {
    const seven = ids(7).map((id) => col(id, 'failing'));
    const six = seven.filter((c) => c.sessionId !== 'demo-c');
    expect(childReclaimAttentionWithLeaves([], [leaf('demo-c', CLAUSE)], input(seven))).toEqual([
      { ...col('demo-c', 'failing'), sentence: `c demo-c. ${childReclaimClipsSecond(CLAUSE)}` },
      { kind: 'kept-many', word: 'collect:failing', members: six.map((c) => ({ sessionId: c.sessionId, runId: 41 })),
        sentence: childReclaimCollectManySentence(6, 'lead failing') },
    ]);
  });

  it(`more than ${CHILD_RECLAIM_KEPT_MANY_OVER} with runs of one word collapse under a word no other line uses; five stay single`, () => {
    const six = ids(6).map((id) => col(id, 'in-use'));
    const out = childReclaimAttentionWithLeaves([], [], input(six));
    expect(out).toEqual([{ kind: 'kept-many', word: 'collect:in-use', members: six.map((c) => ({ sessionId: c.sessionId, runId: 41 })),
      sentence: childReclaimCollectManySentence(6, 'lead in-use') }]);
    const five = ids(5).map((id) => col(id, 'in-use'));
    const loose = ['demo-v', 'demo-w', 'demo-x', 'demo-y', 'demo-z'].map((id) => col(id, 'in-use', null));
    expect(childReclaimAttentionWithLeaves([], [], input([...loose, ...five]))).toEqual([...five, ...loose]);
  });

  it('six unreadable witnesses (no run) list as ONE box-wide count line naming at most five ids', () => {
    const six = ids(6).map((id) => col(id, 'witness-mismatch', null));
    expect(childReclaimAttentionWithLeaves([], [], input(six))).toEqual([{ kind: 'collect',
      sessionId: COLLECT_BOX_LABELS['no-run'], runId: null, word: 'no-run',
      sentence: 'Temp roots with no recorded run are listed together. 6 are listed under witness-mismatch: demo-a, demo-b, '
        + 'demo-c, demo-d, demo-e, and 1 more. For each one: lead witness-mismatch' }]);
  });

  it('a reclaim kept-many member carrying a second clause leaves the line and stays single', () => {
    const members = ids(7).map((sessionId, runId) => ({ sessionId, runId }));
    const many: ChildReclaimAttention = { kind: 'kept-many', word: 'minting-run-absent', members,
      sentence: childReclaimKeptManySentence('minting-run-absent', 7) };
    const out = childReclaimAttentionWithLeaves([many], [leaf('demo-c', CLAUSE)], input([]));
    expect(out).toEqual([
      { kind: 'kept', sessionId: 'demo-c', runId: 2, word: 'minting-run-absent',
        sentence: `${CHILD_RECLAIM_SKIP['minting-run-absent'].sentence} ${childReclaimClipsSecond(CLAUSE)}` },
      { kind: 'kept-many', word: 'minting-run-absent', members: members.filter((m) => m.sessionId !== 'demo-c'),
        sentence: childReclaimKeptManySentence('minting-run-absent', 6) },
    ]);
  });

  it('the order: reclaim, the collector’s per-id items, its box lines, then the kept leaves; box lines take no id', () => {
    const r: ChildReclaimAttention = { ...term, sessionId: 'demo-r' };
    const b: ChildReclaimCollectAttention = { kind: 'collect', sessionId: COLLECT_BOX_LABELS.flock, runId: null, word: 'flock', sentence: 'f.' };
    const z = leaf('demo-z', null);
    expect(childReclaimAttentionWithLeaves([r], [z], input([col('demo-a', 'in-use')], [b])))
      .toEqual([r, col('demo-a', 'in-use'), b, z.item]);
  });
});

describe('every collector shape renders through the PWA’s one reader, with no PWA edit', () => {
  it('a per-id item, a collapsed line and a box-wide line; an unmeasured listing with no measured id included', async () => {
    const words = await import(path.join(ROOT, 'pwa/src/fleet/childReclaimWords.ts')) as {
      childReclaimAttentionOf: (coord: unknown) => unknown[] };
    const seven = ['demo-a', 'demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f', 'demo-g'];
    const crowd = items(Object.fromEntries(seven.map((id) => [id,
      view({ leaf: `/h/tmp-root/${id}`, deferral: { word: 'in-use', detail: 'pid 7', since: NOW } })])),
    { unmeasured: [{ listing: 'tmproots', kind: 'unmeasured', why: 'a symbolic link' }] });
    const lone = items({}, { unmeasured: [{ listing: 'tmproots', kind: 'unmeasured', why: 'a symbolic link' }] });
    for (const list of [childReclaimAttentionWithLeaves([], [], crowd), childReclaimAttentionWithLeaves([], [], lone)]) {
      expect(list.length).toBeGreaterThan(0);
      expect(words.childReclaimAttentionOf({ childReclaimAttention: list })).toEqual(list);
    }
  });
});

describe('the collapsed and count lines stay true after a terminal answer and a later collectable (spec §5.10)', () => {
  // terminal-collapsed-and-count-lines-past-tense: a `collectable` after a terminal answer leaves the terminal run
  // standing, so neither line may say ccd's LAST answer was terminal, or that the ids answer the word now.
  it('six ids with a run and six without, each terminal then collectable, through the projection, the items and the merge', () => {
    const fold = (witnessRun: number | null): CollectEntry =>
      collectAfterAudit(collectAfterAudit(collectFirstSighting(1), verdict('witness-mismatch'), step(0, 2), true),
        collectable(T1, { witnessRun }), step(60_000, 3), true);
    const withRun = ids6('demo-r');
    const runless = ids6('demo-n');
    const entries = new Map<string, CollectAttentionView>([
      ...withRun.map((id) => [id, collectAttentionViewOf(fold(41))] as const),
      ...runless.map((id) => [id, collectAttentionViewOf(fold(null))] as const),
    ]);
    for (const v of entries.values()) expect(v.terminal.tier.tier, 'the terminal run stands after collectable').toBe(true);
    const out = childReclaimAttentionWithLeaves([], [],
      collectAttentionItems({ entries, box: BOX, nowMono: NOW }));
    const many = out.find((a) => a.kind === 'kept-many');
    const count = out.find((a) => a.kind === 'collect' && a.word === 'no-run');
    expect(many?.word).toBe('collect:witness-mismatch');
    expect(count).toBeDefined();
    for (const s of [many!.sentence, count!.sentence]) {
      expect(s, s).not.toMatch(/last answer[^.;]*terminal/);
      expect(s, s).not.toMatch(/\d+ answer /);
      expect(s, s).toContain('has answered its temp root with a terminal word');
    }
  });

  // count-line-word-through-detail-text: the count line's word reaches the sentence only through childReclaimDetailText.
  it('a hostile word on six run-less items reaches the count line escaped', () => {
    const word = `wit${NL}${String.fromCodePoint(0xe0001)}ness`;
    const six = ids6('demo-h').map((sessionId): ChildReclaimCollectAttention =>
      ({ kind: 'collect', sessionId, runId: null, word, sentence: 's.' }));
    const out = childReclaimAttentionWithLeaves([], [], { perId: six, manyLead: { [word]: 'L' }, box: [] });
    expect(out).toEqual([{ kind: 'collect', sessionId: COLLECT_BOX_LABELS['no-run'], runId: null, word: 'no-run',
      sentence: 'Temp roots with no recorded run are listed together. 6 are listed under wit ness: demo-ha, demo-hb, '
        + 'demo-hc, demo-hd, demo-he, and 1 more. For each one: L' }]);
  });
});

function ids6(prefix: string): string[] {
  return Array.from({ length: 6 }, (_, k) => `${prefix}${String.fromCharCode(97 + k)}`);
}
