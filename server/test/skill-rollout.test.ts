// D-8126 (autonomy plan Task A9-3, spec §9.3; review focus F14: the rollout mail sent twice, or sent to a worker): one
// system mail per coordinator per coordinator-skill revision. `decideRollout` is the L1 decision over literal facts, held
// by a mutant set; `skillRolloutPass` is the L4 lane, proven against a real coord store in a fixture HOME. No box is
// touched.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as rollout from '../src/coord/skillRollout.js';
import { skillRolloutPass, type RolloutListing } from '../src/coord/skillRolloutLane.js';
import { queueRolloutMail } from '../src/coord/skillRolloutTx.js';
import { laneRow } from '../src/laneSchedule.js';
import type { ChildMark } from '../../shared/api.js';
import { MAIL_DISABLED_MARKER } from '../../shared/switches.js';
import { mkTmp } from './tmpHelpers.js';
import { runMutants, type MutantSet, type SuiteCase } from './sim/mutate.js';
import { sourceOfSymbol } from './scan/symbols.js';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { PushPayload } from '../src/push.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps, withFakeClock } from './helpers.js';
import { quietAtTestEnd } from './laneQuiet.js';

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
        expect(d(facts({ mailDisabled, claimants: [c('coord-a')] }))).toEqual({ mails: [], holds: [{ why: MAIL_DISABLED_MARKER }], settled: false });
      }
    },
    'no claimant: settled, nothing to send': () => {
      expect(d(facts())).toEqual({ mails: [], holds: [], settled: true });
    },
    'the push lane\'s predicate: the operator\'s rollout mail of any revision, and nothing else': () => {
      expect(m.isSkillRolloutMail({ fromId: 'operator', subject: m.rolloutMailSubject('clause-21') })).toBe(true);
      expect(m.isSkillRolloutMail({ fromId: 'operator', subject: m.rolloutMailSubject('clause-22') })).toBe(true);
      expect(m.isSkillRolloutMail({ fromId: 'coord-a', subject: m.rolloutMailSubject('clause-21') }), 'a session cannot borrow it').toBe(false);
      expect(m.isSkillRolloutMail({ fromId: 'operator', subject: 'stall: coord-a' })).toBe(false);
      expect(m.isSkillRolloutMail({ fromId: 'operator', subject: 're: coordinator skill changed (clause 21)' })).toBe(false);
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
    { id: 'R10', old: "m.fromId === 'operator' && ", new: '' },
    { id: 'R11', old: 'm.subject.startsWith(ROLLOUT_SUBJECT_HEAD)', new: 'm.subject.includes(ROLLOUT_SUBJECT_HEAD)' },
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

// The migrations run once, into a template, and each case opens a copy: a fresh store per case without paying for every
// migration per case (about 8 s each on a loaded box).
let template = '';
beforeAll(() => {
  const home = mkTmp('skill-rollout-template-');
  template = path.join(home, 'coord.db');
  openCoordDb(template).close();
});
afterAll(() => { if (template !== '') fs.rmSync(path.dirname(template), { recursive: true, force: true }); });

describe('skillRolloutPass — the lane, against a real coord store', () => {
  const homes: string[] = [];
  afterEach(() => { for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true }); });
  const build = () => {
    const home = mkTmp('skill-rollout-');
    homes.push(home);
    fs.copyFileSync(template, path.join(home, 'coord.db'));
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

  it('queueRolloutMail: one transaction, a never wake, and a second write under the same subject is a duplicate', () => {
    const t = build();
    const m = { toId: 'coord-a', subject: rolloutMailSubject('clause-21'), body: rolloutMailBody('clause-21') };
    expect(queueRolloutMail(t.coord, m)).toMatchObject({ queued: true });
    expect(queueRolloutMail(t.coord, m)).toEqual({ queued: false, why: 'duplicate' });
    expect(t.mails('coord-a')).toHaveLength(1);
    expect(t.coord.db.prepare('SELECT d.wake FROM mail_deliveries d JOIN mail m ON m.id = d.mailId WHERE m.toId = ?').all('coord-a'))
      .toEqual([{ wake: 'never' }]);
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
    const tick = sourceOfSymbol('server/src/watch.ts', 'FleetWatcher.tick');
    const at = tick.indexOf("this.runLane('skillRollout'");
    expect(at, 'the tick runs the lane').toBeGreaterThan(-1);
    expect(tick.indexOf("this.runLane('skillRollout'", at + 1), 'one call site').toBe(-1);
    const call = tick.slice(at, tick.indexOf('?.catch(', at));
    for (const part of ['skillRolloutPass({', 'revision: rolloutRevision', 'settled: this.skillRolloutSettled',
      'recordAlways: true, recordOnly: true, dedupeKey', "kind: 'coord'", 'rolloutListingOf(registryRead)']) expect(call).toContain(part);
    // Gated on the revision the composition root sets: a watcher built without it (a test, a script) never runs the lane.
    expect(tick).toContain('const rolloutRevision = this.deps.skillRolloutRevision;');
    expect(tick.slice(tick.lastIndexOf('\n', at), at)).toContain('rolloutRevision !== undefined');
  });

  it('the composition root sets the shipped revision, once', () => {
    const index = fs.readFileSync(path.join(ROOT, 'server/src/index.ts'), 'utf8');
    expect(index.split('\n').filter((l) => l.startsWith('deps.skillRolloutRevision = '))).toEqual([
      'deps.skillRolloutRevision = COORDINATOR_SKILL_REVISION;   // D-8126 (A9-3): the watcher\'s `skillRollout` lane runs only where this is set',
    ]);
  });
});

// Review 3077 F2 and F3: what the queued mail does downstream, through a real FleetWatcher. It never asks a sleeping
// coordinator's wake (`wake = 'never'`: the mail sweep holds it for a hibernated recipient, with no `ccd ensure`), and the
// push lane records it without pushing, also when it is queued on a later tick, after the push lane's watermark is primed.
describe('the rollout mail downstream: no wake, no push (review 3077 F2, F3)', () => {
  const NOW = 1_800_000_000_000;
  const ID = 'project-a-calm-coord';
  const homes: string[] = [];
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true }); });

  const rig = async (revision: string | null = 'clause-21') => {
    const home = mkTmp('skill-rollout-watch-');
    homes.push(home);
    const reg = path.join(home, '.cc-sessions');
    fs.mkdirSync(reg, { recursive: true });
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.copyFileSync(template, path.join(home, '.ccrc', 'coord.db'));
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    // Every session is proven gone from tmux, so nothing is typed into a pane.
    const run: Runner = async (_cmd, args) => (args[0] === 'has-session'
      ? { ran: true, code: 1, stdout: '', stderr: "can't find session: cc-x\n" } : { ran: true, code: 1, stdout: '', stderr: '' });
    const ccd: string[][] = [];
    const sent: PushPayload[] = [];
    const notifyLog = new NotifyLog(path.join(home, 'notify.json'));
    await notifyLog.load();
    const deps: Deps = { ...testDeps(home, run), coord, notifyLog,
      runCcd: async (a) => { ccd.push([...a]); return { ran: true, ok: true, stdout: '', stderr: '', killed: false, signal: null }; },
      push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
      ...(revision === null ? {} : { skillRolloutRevision: revision }) };
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000));
    const row = (id: string): void => {
      for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: 'a'.repeat(36), started: '1' })) {
        fs.writeFileSync(path.join(reg, `${id}.${k}`), v);
      }
    };
    const hibernate = (id: string): void => {
      fs.writeFileSync(path.join(reg, `${id}.stopped`), `${Math.floor(NOW / 1000)} ccd`);
      fs.writeFileSync(path.join(reg, `${id}.hibernated`), `${Math.floor(NOW / 1000) - 7 * 3600} 7`);
    };
    const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
    const beat = async (ms = 31_000): Promise<void> => { vi.setSystemTime(Date.now() + ms); await w.tick(); await settle(); };
    const rollout = () => coord.db.prepare(
      "SELECT d.id, d.wake, d.state, d.lastGate FROM mail m JOIN mail_deliveries d ON d.mailId = m.id WHERE m.subject = ?",
    ).all(rolloutMailSubject('clause-21')) as { id: number; wake: string | null; state: string; lastGate: string | null }[];
    return { home, reg, coord, w, ccd, sent, row, hibernate, beat, settle, rollout };
  };
  const open = (coord: CoordStore, claimedBy: string): void => {
    const r = coord.openRun({ program: 'prog-a', title: 'prog-a', project: 'project-a', wave: 1, waveOf: 1, claimedBy });
    if (!('id' in r)) throw new Error('openRun refused');
  };

  it('a hibernated coordinator gets the mail with a never wake, and the mail sweep asks no ensure for it', async () => {
    const t = await rig();
    t.row(ID); t.hibernate(ID); open(t.coord, ID);
    await t.w.tick(); await t.settle();
    await t.beat();
    expect(t.rollout()).toHaveLength(1);
    expect(t.rollout()[0]!.wake).toBe('never');
    for (let i = 0; i < 3; i++) { vi.setSystemTime(Date.now() + 11_000); await t.w.sweepMail(); }
    expect(t.ccd.filter((a) => a[0] === 'ensure'), 'no wake asked for the rollout mail').toEqual([]);
    expect(t.rollout()[0]).toMatchObject({ state: 'queued', lastGate: 'hibernated' });
  }, 60_000);

  it('a mail queued on a later tick (held by mail-disabled, then released) is recorded and never pushed', async () => {
    const t = await rig();
    t.row(ID); open(t.coord, ID);
    fs.writeFileSync(path.join(t.reg, MAIL_DISABLED_MARKER), '');
    await t.w.tick(); await t.settle();
    await t.beat();
    expect(t.rollout(), 'held while mail-disabled stands').toHaveLength(0);
    fs.rmSync(path.join(t.reg, MAIL_DISABLED_MARKER));
    await t.beat();
    expect(t.rollout(), 'queued on a later tick, after the push lane is primed').toHaveLength(1);
    await t.beat(); await t.beat();
    const subject = rolloutMailSubject('clause-21');
    expect(t.coord.feedEvents(50).filter((e) => e.kind === 'mail' && e.body === subject), 'the push lane saw the mail and recorded it')
      .toHaveLength(1);
    expect(t.sent.filter((p) => p.body === subject), 'never pushed').toEqual([]);
  }, 60_000);

  it('CONTROL: a watcher built without the revision queues no rollout mail', async () => {
    const t = await rig(null);
    t.row(ID); open(t.coord, ID);
    await t.w.tick(); await t.settle();
    await t.beat(); await t.beat();
    expect(t.rollout()).toHaveLength(0);
  }, 60_000);
});

describe('the skill rollout lane row (D-8126, A9-3)', () => {
  it('looks every 30 s, one pass at a time, abandons a pass older than two minutes, and names its warning', () => {
    expect(laneRow('skillRollout')).toEqual({
      name: 'skillRollout', cadenceMs: 30_000, derivedFrom: null, clock: 'mono', flight: 'skip',
      staleAfterMs: 120_000, warnKey: 'ccrc-server: the skill rollout lane failed',
    });
  });
});
