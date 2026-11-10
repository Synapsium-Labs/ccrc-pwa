// D-8126 (plan Task A9-3, spec §9.3): one system mail per coordinator per skill revision. `rolloutMailsDue` is the L1
// decision over literal inputs; `runSkillRollout` is the L4 pass, proven against a real coord store (F14: sent twice, or
// sent to a worker). No box is touched.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { rolloutMailsDue, rolloutKey, rolloutMailBody } from '../src/coord/skillRollout.js';
import { runSkillRollout } from '../src/skillRolloutLane.js';
import { COORDINATOR_SKILL_REVISION } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

describe('rolloutMailsDue — the L1 decision', () => {
  it('names each claimant once, in order, unless it was already sent', () => {
    const due = rolloutMailsDue(['coord-a', 'coord-b', 'coord-a', 'coord-c'], (id) => id === 'coord-c', 'clause-21');
    expect(due.map((m) => m.toId)).toEqual(['coord-a', 'coord-b']);
    expect(due[0]).toMatchObject({ key: 'skill-rollout:clause-21:coord-a', body: rolloutMailBody('clause-21') });
  });

  it('the words are the approved sentence', () => {
    expect(rolloutMailBody('clause-21')).toBe(
      'The coordinator skill changed (clause 21). Re-read `ccrc-coordinator`, then `goals show` for your programme.');
  });

  it('a later revision has a different key', () => {
    expect(rolloutKey('clause-22', 'coord-a')).not.toBe(rolloutKey('clause-21', 'coord-a'));
  });

  it('the shipped revision is clause-21', () => {
    expect(COORDINATOR_SKILL_REVISION).toBe('clause-21');
  });
});

describe('runSkillRollout — the start-up pass', () => {
  const dirs: string[] = [];
  afterEach(() => { dirs.length = 0; });

  const build = () => {
    const home = mkTmp('skill-rollout-');
    dirs.push(home);
    const coord = new CoordStore(openCoordDb(path.join(home, 'coord.db')));
    let seq = 0;
    const record = (e: { sessionId: string; title: string; body: string }, dedupeKey: string): void => {
      seq += 1;
      coord.recordFeedEvent('epoch-a', { seq, at: seq, kind: 'coord', sessionId: e.sessionId, title: e.title, body: e.body, runId: null }, dedupeKey);
    };
    const open = (program: string, claimedBy: string, session?: string): number => {
      const r = coord.openRun({ program, title: program, project: 'project-a', wave: 1, waveOf: 1, claimedBy });
      if (!('id' in r)) throw new Error('openRun refused');
      if (session !== undefined) coord.setSession(r.id, session);
      return r.id;
    };
    const rollout = (revision = 'clause-21') => runSkillRollout({ coord, record }, revision);
    const mails = (id: string) => coord.outstandingMailFor(id).filter((m) => m.subject.includes('skill'));
    return { coord, open, rollout, mails };
  };

  it('two claimants get one mail each, and a restart sends none', () => {
    const t = build();
    t.open('prog-a', 'coord-a');
    t.open('prog-b', 'coord-b');
    expect(t.rollout().sent).toEqual(['coord-a', 'coord-b']);
    expect(t.mails('coord-a')).toHaveLength(1);
    expect(t.mails('coord-b')).toHaveLength(1);
    expect(t.mails('coord-a')[0]!.subject).toBe('coordinator skill changed (clause 21)');
    expect(t.coord.hasNotice('coord', 'coord-a', 'skill-rollout:clause-21:coord-a')).toBe(true);
    // the restart: the first mail is delivered or not, the durable row answers
    expect(t.rollout().sent).toEqual([]);
    expect(t.mails('coord-a')).toHaveLength(1);
  });

  it('a worker (a child that claims its own sub-run) gets none', () => {
    const t = build();
    t.open('prog-a', 'coord-a', 'worker-w');
    t.open('prog-w', 'worker-w');
    expect(t.rollout().sent).toEqual(['coord-a']);
    expect(t.mails('worker-w')).toHaveLength(0);
  });

  it('a terminal run\'s claimant gets none', () => {
    const t = build();
    const id = t.open('prog-a', 'coord-a');
    t.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    expect(t.rollout().sent).toEqual([]);
  });

  it('a later revision constant sends again', () => {
    const t = build();
    t.open('prog-a', 'coord-a');
    t.rollout('clause-21');
    expect(t.rollout('clause-22').sent).toEqual(['coord-a']);
    expect(t.rollout('clause-22').sent).toEqual([]);
  });
});
