// Child reclamation wave 9 (spec §5.10): the temp-root collector's feed bodies. A witness-only collect says no leaf
// stood and never that a temp root was removed; shadow says "would collect <id>"; each switch flip says which way it
// went; and every ccd-sourced string reaches a body only through childReclaimDetailText.
import { describe, it, expect } from 'vitest';
import {
  COLLECT_FEED_TITLE, collectFeedAnswerBody, collectFeedCollectedBody, collectFeedCueOfAct, collectFeedCueOfAudit,
  collectFeedReadBody, collectFeedStep, collectFeedWouldCollectBody, collectFirstSighting, collectSwitchFeedBody,
  collectWouldCollectKey, type CollectLaneNotes, type CollectReadWhat,
} from '../src/collectLane.js';
import {
  ACT_NO_DOCUMENT, COLLECTED, DIE, NO_DOCUMENT, T1, UNREADABLE, collectable, failedAct, refusedAct, unmeasured, verdict,
} from './collectAnswers.js';

const NL = String.fromCharCode(10);
const RLO = String.fromCharCode(0x202e);

describe('the collector feed bodies (spec §5.10)', () => {
  it('a witness-only collect says no leaf stood and the witness was dropped, and never that anything was removed', () => {
    const b = collectFeedCollectedBody('demo-a', 41, '/h/tmp-root/demo-a', { kind: 'collected', record: null, resumed: false, witness: 'dropped' });
    expect(b).toBe('demo-a, child of run #41: no leaf stood at /h/tmp-root/demo-a, so nothing was moved; its witness was dropped.');
    for (const witness of ['dropped', 'kept', 'absent'] as const) {
      expect(collectFeedCollectedBody('demo-a', null, null, { kind: 'collected', record: null, resumed: false, witness }), witness)
        .not.toMatch(/remov/);
    }
  });

  it('a collect with a record names the leaf and the record; a resume says it finished an earlier attempt', () => {
    expect(collectFeedCollectedBody('demo-a', 41, '/h/tmp-root/demo-a', { kind: 'collected', record: 'demo-a.17.42', resumed: true, witness: 'kept' }))
      .toBe('demo-a, child of run #41: the temp-root collector removed its temp root /h/tmp-root/demo-a (record '
        + 'demo-a.17.42), finishing a collection an earlier attempt began; its witness was kept: a newer spawn on this '
        + 'id had written it again.');
  });

  it('shadow writes "would collect <id>" and says nothing was removed', () => {
    expect(collectFeedWouldCollectBody('demo-a', 41, '/h/tmp-root/demo-a')).toBe('would collect demo-a, child of run '
      + '#41: its temp root /h/tmp-root/demo-a was found orphaned and idle by two audits at least a pass apart. The '
      + 'collector is shadowed, so nothing was removed.');
  });

  it('each switch flip writes one row naming the lane now live or now shadowed', () => {
    const notes: CollectLaneNotes = { latchDue: false, markerRecreated: false };
    expect(collectSwitchFeedBody({ kind: 'live', armedBy: 'legacy-marker', notes }).startsWith('the collector lane is now live')).toBe(true);
    expect(collectSwitchFeedBody({ kind: 'shadowed', why: 'off', notes }).startsWith('the collector lane is now shadowed')).toBe(true);
  });

  it('every ccd-sourced string reaches a body only through childReclaimDetailText: detail, paths, the leaf, a record name and an unknown word', () => {
    const bad = `x${NL}${RLO}y`;
    const bodies = [
      collectFeedAnswerBody('demo-a', null, bad, bad, [bad, bad]),
      collectFeedCollectedBody('demo-a', null, bad, { kind: 'collected', record: bad, resumed: false, witness: 'dropped' }),
      collectFeedCollectedBody('demo-a', null, bad, { kind: 'collected', record: null, resumed: false, witness: 'dropped' }),
      collectFeedWouldCollectBody('demo-a', null, bad),
    ];
    for (const b of bodies) {
      expect(b.includes(NL), b).toBe(false);
      expect(b.includes(RLO), b).toBe(false);
    }
    expect(collectFeedAnswerBody('demo-a', 41, 'in-use', 'pid 7', ['/p/a', '/p/b']))
      .toBe('demo-a, child of run #41: ccd answered in-use: pid 7 (paths: /p/a, /p/b).');
  });

  it.each<readonly [CollectReadWhat, string]>([
    ['no-document', 'demo-a, child of run #41: ccd answered nothing; what ccrc saw: ccd: killed.'],
    ['unreadable', 'demo-a, child of run #41: ccrc could not read ccd’s answer; what ccrc saw: ccd: killed.'],
    ['unaccepted', 'demo-a, child of run #41: ccrc could not accept ccd’s answer; what ccrc saw: ccd: killed.'],
  ])('an answer this reader made, %s, is worded as ccrc’s, with what ccrc saw after it', (what, body) => {
    expect(collectFeedReadBody('demo-a', 41, what, 'ccd: killed')).toBe(body);
  });

  it('an answer this reader made says what ccrc saw only when it is something, and escapes it like any other string', () => {
    expect(collectFeedReadBody('demo-a', null, 'no-document', '')).toBe('demo-a: ccd answered nothing.');
    expect(collectFeedReadBody('demo-a', null, 'unaccepted', `${RLO}${NL}`)).toBe('demo-a: ccrc could not accept ccd’s answer.');
    const bad = `x${NL}${RLO}y`;
    const body = collectFeedReadBody('demo-a', null, 'unreadable', bad);
    expect(body).toBe('demo-a: ccrc could not read ccd’s answer; what ccrc saw: x y.');
    expect(body.includes(NL) || body.includes(RLO)).toBe(false);
  });

  it('the titles are the lane’s own: distinct, and none is a child reclaim title', () => {
    const titles = Object.values(COLLECT_FEED_TITLE);
    expect(new Set(titles).size).toBe(titles.length);
    for (const t of titles) expect(t.startsWith('child reclaim'), t).toBe(false);
  });
});

describe('the feed cue of each answer (spec §5.10): an observation writes no row; every other answer is a row keyed by its word', () => {
  it('audits', () => {
    expect(collectFeedCueOfAudit(collectable(T1))).toEqual({ kind: 'observe', token: T1 });
    expect(collectFeedCueOfAudit(verdict('in-use'))).toEqual({ kind: 'row', key: 'in-use' });
    expect(collectFeedCueOfAudit(unmeasured('mv'))).toEqual({ kind: 'row', key: 'unmeasured mv' });
    expect(collectFeedCueOfAudit(NO_DOCUMENT)).toEqual({ kind: 'row', key: 'no-document' });
    expect(collectFeedCueOfAudit(UNREADABLE)).toEqual({ kind: 'row', key: 'unreadable' });
  });

  it('acts', () => {
    expect(collectFeedCueOfAct(COLLECTED)).toEqual({ kind: 'row', key: 'collected' });
    expect(collectFeedCueOfAct(refusedAct('in-use'))).toEqual({ kind: 'row', key: 'refused in-use', outlivesObservations: true });
    expect(collectFeedCueOfAct(failedAct('probe-unmeasured'))).toEqual({ kind: 'row', key: 'failed probe-unmeasured' });
    expect(collectFeedCueOfAct(DIE)).toEqual({ kind: 'row', key: 'die lock-unopenable', outlivesObservations: true });
    expect(collectFeedCueOfAct(ACT_NO_DOCUMENT)).toEqual({ kind: 'row', key: 'act no-document' });
  });

  it('through Task 4’s episode memory: a repeat is quiet, and a would-collect episode survives an observation of its own token', () => {
    const first = collectFeedStep(collectFirstSighting(1), collectFeedCueOfAudit(verdict('in-use')));
    expect(first.opened).toBe('in-use');
    expect(collectFeedStep(first.entry, collectFeedCueOfAudit(verdict('in-use'))).opened).toBeNull();
    const w = collectFeedStep(collectFirstSighting(1), { kind: 'row', key: collectWouldCollectKey(T1) }).entry;
    expect(collectFeedStep(w, collectFeedCueOfAudit(collectable(T1))).entry.feedEpisode).toBe(collectWouldCollectKey(T1));
  });
});
