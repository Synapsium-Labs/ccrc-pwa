// D-8126 (autonomy plan Task A9-3, spec §9.3; review focus F14: the rollout mail sent twice, or sent to a worker): one
// system mail per coordinator per coordinator-skill revision. `decideRollout` is the L1 decision over literal facts, held
// by a mutant set; `skillRolloutPass` is the L4 lane, proven against a real coord store in a fixture HOME. No box is
// touched.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as rollout from '../src/coord/skillRollout.js';
import { skillRolloutPass, type RolloutListing } from '../src/coord/skillRolloutLane.js';
import { laneRow } from '../src/laneSchedule.js';
import type { ChildMark } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { runMutants, type MutantSet, type SuiteCase } from './sim/mutate.js';

const { COORDINATOR_SKILL_REVISION, decideRollout, rolloutKey, rolloutMailBody, rolloutMailSubject } = rollout;
type RolloutModule = typeof rollout;
type Facts = Parameters<RolloutModule['decideRollout']>[0];

const ROOT = path.resolve(__dirname, '../..');
const c = (id: string, over: Partial<Facts['claimants'][number]> = {}): Facts['claimants'][number] =>
  ({ id, child: 'none', told: false, ...over });
const facts = (over: Partial<Facts> = {}): Facts => ({ revision: 'clause-21', mailDisabled: 'clear', claimants: [], ...over });

/** The decider's cases, written once: run against the real module below and against each mutant. */
function decideCases(m: RolloutModule): Record<string, SuiteCase> {
  const d = (f: Facts) => m.decideRollout(f);
  const ids = (f: Facts) => d(f).mails.map((x) => x.toId);
  return {
    'each claimant once, in the order given, with its key, subject and body': () => {
      const p = d(facts({ claimants: [c('coord-a'), c('coord-b'), c('coord-a')] }));
      expect(p.mails.map((x) => x.toId)).toEqual(['coord-a', 'coord-b']);
      expect(p.mails[0]).toEqual({ toId: 'coord-a', key: 'skill-rollout:clause-21:coord-a',
        subject: 'coordinator skill changed (clause 21)',
        body: 'The coordinator skill changed (clause 21). Re-read `ccrc-coordinator`, then `goals show` for your programme.' });
      expect(p).toMatchObject({ holds: [], settled: true });
    },
    'a claimant already told gets none': () => {
      expect(ids(facts({ claimants: [c('coord-a', { told: true }), c('coord-b')] }))).toEqual(['coord-b']);
    },
    'a child is never mailed, and settles': () => {
      expect(d(facts({ claimants: [c('worker-w', { child: 'child' })] }))).toEqual({ mails: [], holds: [], settled: true });
    },
    'a claimant with no registry row is not mailed, and settles': () => {
      expect(d(facts({ claimants: [c('gone-g', { child: 'unlisted' })] }))).toEqual({ mails: [], holds: [], settled: true });
    },
    'an unreadable child marker or a refused id holds that claimant, never told on a guess; the rest go': () => {
      const p = d(facts({ claimants: [c('coord-u', { child: 'unreadable' }), c('coord-r', { child: 'refused' }), c('coord-a')] }));
      expect(p.mails.map((x) => x.toId)).toEqual(['coord-a']);
      expect(p.holds).toEqual([{ why: 'unmeasured', id: 'coord-u' }, { why: 'unmeasured', id: 'coord-r' }]);
      expect(p.settled).toBe(false);
    },
    'an unreadable claimant already told is not held': () => {
      expect(d(facts({ claimants: [c('coord-u', { child: 'unreadable', told: true })] }))).toEqual({ mails: [], holds: [], settled: true });
    },
    'mail-disabled set, or unreadable, holds every mail and settles nothing': () => {
      for (const mailDisabled of ['set', 'unmeasurable'] as const) {
        expect(d(facts({ mailDisabled, claimants: [c('coord-a')] }))).toEqual({ mails: [], holds: [{ why: 'mail-disabled' }], settled: false });
      }
    },
    'no claimant: settled, nothing to send': () => {
      expect(d(facts())).toEqual({ mails: [], holds: [], settled: true });
    },
    'a later revision has its own key and words': () => {
      const p = d(facts({ revision: 'clause-22', claimants: [c('coord-a')] }));
      expect(p.mails[0]).toMatchObject({ key: 'skill-rollout:clause-22:coord-a', subject: 'coordinator skill changed (clause 22)' });
    },
  };
}

const DECIDE_SET: MutantSet<RolloutModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/skillRollout.ts'),
  mutants: [
    { id: 'R1', old: "if (f.mailDisabled !== 'clear') return", new: "if (f.mailDisabled === 'set') return" },
    { id: 'R2', old: 'if (seen.has(c.id)) continue;', new: '' },
    { id: 'R3', old: 'if (c.told || ', new: 'if (' },
    { id: 'R4', old: " || c.child === 'child' || ", new: ' || ' },
    { id: 'R5', old: " || c.child === 'unlisted') continue;", new: ') continue;' },
    { id: 'R6', old: "if (c.child !== 'none') { holds.push({ why: 'unmeasured', id: c.id }); continue; }", new: '' },
    { id: 'R7', old: 'settled: holds.length === 0 }', new: 'settled: true }' },
    { id: 'R8', old: "revision.replace(/-/g, ' ')", new: 'revision' },
    { id: 'R9', old: '`skill-rollout:${revision}:${sessionId}`', new: '`skill-rollout:${sessionId}`' },
  ],
  suite: decideCases,
};

describe('decideRollout — the L1 decision', () => {
  for (const [name, fn] of Object.entries(decideCases(rollout))) it(name, fn);

  it('every mutant of the decider is killed by the cases above', async () => {
    const report = await runMutants(DECIDE_SET);
    expect(report.results.filter((r) => r.status !== 'killed').map((r) => `${r.id} ${r.status}: ${r.detail}`), 'surviving mutants').toEqual([]);
    expect(report.score).toBe(1);
  }, 60_000);

  it('the shipped revision names the skill\'s autonomy clause by its real number', () => {
    expect(COORDINATOR_SKILL_REVISION).toBe('clause-21');
    const skill = fs.readFileSync(path.join(ROOT, 'ccd/coordinator-skill/SKILL.md'), 'utf8');
    expect(skill.split('\n').some((l) => l.startsWith('21. This session decides by default and keeps going.')),
      'clause 21 of the coordinator skill is the autonomy clause the mail points at').toBe(true);
  });
});

describe('skillRolloutPass — the lane, against a real coord store', () => {
  const homes: string[] = [];
  afterEach(() => { for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true }); });

  const build = () => {
    const home = mkTmp('skill-rollout-');
    homes.push(home);
    const coord = new CoordStore(openCoordDb(path.join(home, 'coord.db')));
    let seq = 0;
    let recordThrows = false;
    const record = (e: { sessionId: string; title: string; body: string }, dedupeKey: string): void => {
      if (recordThrows) throw new Error('feed unwritable');
      seq += 1;
      coord.recordFeedEvent('epoch-a', { seq, at: seq, kind: 'coord', sessionId: e.sessionId, title: e.title, body: e.body, runId: null } as never, dedupeKey);
    };
    const open = (program: string, claimedBy: string): number => {
      const r = coord.openRun({ program, title: program, project: 'project-a', wave: 1, waveOf: 1, claimedBy });
      if (!('id' in r)) throw new Error('openRun refused');
      return r.id as number;
    };
    const rows: { id: string; child: ChildMark }[] = [];
    const row = (id: string, child: ChildMark = { kind: 'none' }): void => { rows.push({ id, child }); };
    const listing = (over: Partial<RolloutListing> = {}): RolloutListing => ({ records: rows, refused: new Set(), mailDisabled: 'clear', ...over });
    const logs: string[] = [];
    /** One process's memory: a new one is a restart. */
    const proc = (revision = 'clause-21') => {
      const settled = new Set<string>();
      return (l: RolloutListing | null = listing()) => skillRolloutPass({ coord, record, revision, settled, log: (x) => logs.push(x) }, l);
    };
    const mails = (id: string) => coord.outstandingMailFor(id).filter((m) => m.subject.startsWith('coordinator skill changed'));
    return { coord, open, row, listing, proc, mails, logs, failRecord: (v: boolean) => { recordThrows = v; } };
  };

  it('two claimants get one mail each; the next beat and a restart send none', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    t.open('prog-b', 'coord-b'); t.row('coord-b');
    const p = t.proc();
    expect(p()).toEqual({ sent: ['coord-a', 'coord-b'], settled: true });
    expect(t.mails('coord-a')).toHaveLength(1);
    expect(t.mails('coord-b')).toHaveLength(1);
    expect(t.mails('coord-a')[0]!.subject).toBe(rolloutMailSubject('clause-21'));
    expect(t.coord.hasNotice('coord', 'coord-a', rolloutKey('clause-21', 'coord-a'))).toBe(true);
    expect(p()).toEqual({ sent: [], settled: true });
    expect(t.proc()()).toEqual({ sent: [], settled: true });   // the restart: the mail row answers
    expect(t.mails('coord-a')).toHaveLength(1);
  });

  it('a restart after the feed archive pruned the rollout row still sends none', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    expect(t.proc()().sent).toEqual(['coord-a']);
    t.coord.db.prepare('DELETE FROM feed_events').run();
    expect(t.coord.hasNotice('coord', 'coord-a', rolloutKey('clause-21', 'coord-a'))).toBe(false);
    expect(t.proc()().sent).toEqual([]);
    expect(t.mails('coord-a')).toHaveLength(1);
  });

  it('a delivered and acked mail is still the durable answer: a restart sends none', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    t.proc()();
    t.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();
    t.coord.db.prepare('DELETE FROM feed_events').run();
    expect(t.proc()().sent).toEqual([]);
  });

  it('the feed row under its once-only key answers too: a claimant with that row and no mail row is not mailed', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    t.coord.recordFeedEvent('epoch-a', { seq: 1, at: 1, kind: 'coord', sessionId: 'coord-a', title: 'Coordinator skill changed',
      body: rolloutMailBody('clause-21'), runId: null } as never, rolloutKey('clause-21', 'coord-a'));
    expect(t.proc()()).toEqual({ sent: [], settled: true });
    expect(t.mails('coord-a')).toHaveLength(0);
  });

  it('a worker (a child that claims its own sub-run) gets none', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    t.open('prog-w', 'worker-w'); t.row('worker-w', { kind: 'child', runId: 7 });
    expect(t.proc()()).toEqual({ sent: ['coord-a'], settled: true });
    expect(t.mails('worker-w')).toHaveLength(0);
  });

  it('holds while mail-disabled stands or cannot be read, and sends once it clears', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    const p = t.proc();
    expect(p(t.listing({ mailDisabled: 'set' }))).toEqual({ sent: [], settled: false });
    expect(p(t.listing({ mailDisabled: 'unmeasurable' }))).toEqual({ sent: [], settled: false });
    expect(p(null)).toEqual({ sent: [], settled: false });   // the registry did not list
    expect(t.mails('coord-a')).toHaveLength(0);
    expect(t.coord.hasNotice('coord', 'coord-a', rolloutKey('clause-21', 'coord-a'))).toBe(false);
    expect(p()).toEqual({ sent: ['coord-a'], settled: true });
  });

  it('an unreadable child marker or a refused id holds that claimant, and the next beat takes it', () => {
    const t = build();
    t.open('prog-u', 'coord-u'); t.row('coord-u', { kind: 'unreadable' });
    t.open('prog-r', 'coord-r'); t.row('coord-r');
    const p = t.proc();
    expect(p(t.listing({ refused: new Set(['coord-r']) }))).toEqual({ sent: [], settled: false });
    expect(t.mails('coord-u')).toHaveLength(0);
    expect(t.mails('coord-r')).toHaveLength(0);
    expect(p(t.listing({ records: [{ id: 'coord-u', child: { kind: 'none' } }, { id: 'coord-r', child: { kind: 'none' } }] })))
      .toEqual({ sent: ['coord-u', 'coord-r'], settled: true });
  });

  it('a claimant with no registry row is not mailed', () => {
    const t = build();
    t.open('prog-a', 'gone-g');
    expect(t.proc()()).toEqual({ sent: [], settled: true });
    expect(t.mails('gone-g')).toHaveLength(0);
  });

  it('a terminal run\'s claimant gets none', () => {
    const t = build();
    const id = t.open('prog-a', 'coord-a'); t.row('coord-a');
    t.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    expect(t.proc()()).toEqual({ sent: [], settled: true });
  });

  it('once settled, the process looks no more: a coordinator that opens its first run later is not mailed', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    const p = t.proc();
    p();
    t.open('prog-b', 'coord-b'); t.row('coord-b');
    expect(p()).toEqual({ sent: [], settled: true });
    expect(t.mails('coord-b')).toHaveLength(0);
  });

  it('a feed write that throws leaves the pass unsettled, and the next beat settles without a second mail', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    const p = t.proc();
    t.failRecord(true);
    expect(p()).toEqual({ sent: [], settled: false });
    expect(t.logs.join('\n')).toMatch(/skill rollout to coord-a failed/);
    t.failRecord(false);
    expect(p()).toEqual({ sent: [], settled: true });
    expect(t.mails('coord-a')).toHaveLength(1);
  });

  it('a later revision sends again, once', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    t.proc('clause-21')();
    expect(t.proc('clause-22')().sent).toEqual(['coord-a']);
    expect(t.proc('clause-22')().sent).toEqual([]);
    expect(t.mails('coord-a').map((m) => m.subject).sort()).toEqual([rolloutMailSubject('clause-21'), rolloutMailSubject('clause-22')]);
  });

  it('the mail is the operator\'s system mail with the approved words, about no run', () => {
    const t = build();
    t.open('prog-a', 'coord-a'); t.row('coord-a');
    t.proc()();
    const row = t.coord.db.prepare('SELECT fromId, toId, runId, kind, subject, body FROM mail').get() as Record<string, unknown>;
    expect(row).toEqual({ fromId: 'operator', toId: 'coord-a', runId: null, kind: 'status',
      subject: 'coordinator skill changed (clause 21)', body: rolloutMailBody('clause-21') });
    expect(decideRollout).toBeTypeOf('function');
  });
});

describe('the watcher runs the lane on its tick (D-8126, A9-3)', () => {
  it('the tick calls the pass under its row, with the shipped revision, this tick\'s listing and the process memory', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/src/watch.ts'), 'utf8');
    const call = src.split('\n').filter((l) => l.includes("this.runLane('skillRollout'"));
    expect(call, 'one call site').toHaveLength(1);
    expect(call[0]).toContain('skillRolloutPass({');
    expect(call[0]).toContain('revision: COORDINATOR_SKILL_REVISION');
    expect(call[0]).toContain('settled: this.skillRolloutSettled');
    const at = src.indexOf("this.runLane('skillRollout'");
    expect(src.slice(at, src.indexOf('\n', src.indexOf('\n', at) + 1))).toContain('rolloutListingOf(registryRead)');
    expect(src.slice(at, src.indexOf('\n', src.indexOf('\n', at) + 1))).toContain('recordAlways: true, recordOnly: true, dedupeKey');
  });
});

describe('the skill rollout lane row (D-8126, A9-3)', () => {
  it('looks every 30 s, one pass at a time, abandons a pass older than two minutes, and names its warning', () => {
    expect(laneRow('skillRollout')).toEqual({
      name: 'skillRollout', cadenceMs: 30_000, derivedFrom: null, clock: 'mono', flight: 'skip',
      staleAfterMs: 120_000, warnKey: 'ccrc-server: the skill rollout lane failed',
    });
  });
});
