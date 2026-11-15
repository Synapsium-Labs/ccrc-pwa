// Landing order wave 5i, Task 5: the next-to-land cue. `nextLandingNoticeOf` (L1) decides the recipient, the episode and
// the canonical tuple; `CoordStore.applyLandingControl` applies the measured main health and queues the cue in ONE
// transaction through the existing mail bodies. Pure rows read facts off a real store; every other row is a real store
// over a temporary coord.db with a configured journal, never mocked. Fixed clock, neutral names.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { LandingControlRead } from '../src/coord/radar.js';
import type { LandingAdvance } from '../src/coord/landingEntry.js';
import { nextLandingNoticeOf, type NextLandingFacts } from '../src/coord/landingNext.js';
import { OUTSTANDING_DELIVERY_STATES, TERMINAL_DELIVERY_STATES, MAIL_SUBJECT_MAX_BYTES } from '../../shared/api.js';
import { CONTROL_BASE_SHA, CONTROL_HEAD_SHA, CONTROL_NOW, controlRead, landingFactsOf, landingStoreOver } from './landingFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.useRealTimers(); removeTmpFixtures(); });

const P = 'project-a';
const HC = 'c'.repeat(40);
const BASE_B = 'd'.repeat(40);
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

let dbPath: string;
let coord: CoordStore;
const reopen = (): void => { coord.db.close(); coord = landingStoreOver(openCoordDb(dbPath), dbPath); };
beforeEach(() => {
  dbPath = path.join(mkTmp('ccrc-next-'), '.ccrc', 'coord.db');
  coord = landingStoreOver(openCoordDb(dbPath), dbPath);
});

const step = (id: number, to: Parameters<CoordStore['advance']>[1]): void => {
  if (!coord.advance(id, to, 'test').ok) throw new Error(`fixture advance to ${to} refused`);
};
const pin = (): LandingAdvance =>
  ({ kind: 'pin', head: CONTROL_HEAD_SHA, pr: 7, mode: 'off', handoffCommit: HC });
/** A run claimed by `claimedBy` at `awaiting-review`. */
const atReview = (claimedBy = 'coordinator-a', waveOf: number | null = 2): number => {
  const opened = coord.openRun({ program: 'prog-a', title: 't', project: P, wave: 1, waveOf, claimedBy });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  coord.setSession(opened.id, 'lane-a-project-a-ws1');
  step(opened.id, 'dispatched'); step(opened.id, 'working'); step(opened.id, 'awaiting-review');
  return opened.id;
};
const enterMerging = (id: number): void => {
  if (!coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() }).ok) throw new Error('fixture pin refused');
};
const atMerging = (claimedBy = 'coordinator-a', waveOf: number | null = 2): number => { const id = atReview(claimedBy, waveOf); enterMerging(id); return id; };
const retreat = (id: number): void => {
  if (!coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: { kind: 'retreat', ejection: null } }).ok) throw new Error('fixture retreat refused');
};

type Probe = Extract<LandingControlRead['probe'], { ok: true }>;
type Health = Extract<LandingControlRead['health'], { ok: true }>;
/** The baseline bundle against `base`, with main `green` or `red` (a red doc names the required context failing). */
const controlAt = (base: string = CONTROL_BASE_SHA, state: 'green' | 'red' = 'green'): LandingControlRead => {
  const c = controlRead(); const probe = c.probe as Probe; const health = c.health as Health;
  return controlRead({
    probe: { ok: true, doc: { ...probe.doc, baseSha: base } },
    health: { ok: true, doc: { ...health.doc, sha: base, state, failing: state === 'red' ? ['required-a'] : [] } },
  });
};
const apply = (control: LandingControlRead = controlAt(), store: CoordStore = coord) =>
  store.applyLandingControl({ project: P, control, nowMs: CONTROL_NOW });

const rows = (sql: string): Record<string, unknown>[] => coord.db.prepare(sql).all() as Record<string, unknown>[];
const cueMails = (): Record<string, unknown>[] => rows("SELECT * FROM mail WHERE subject LIKE 'next-to-land:%' ORDER BY id");
const cueObservations = (): Record<string, unknown>[] => rows("SELECT * FROM run_events WHERE detail LIKE 'landing:next:v1:%' ORDER BY id");
const flags = (): { operatorPaused: boolean; mainRedHold: boolean } => {
  const r = coord.db.prepare('SELECT operatorPaused, mainRedHold FROM landing_projects WHERE project = ?').get(P) as { operatorPaused: number; mainRedHold: number } | undefined;
  return { operatorPaused: (r?.operatorPaused ?? 0) !== 0, mainRedHold: (r?.mainRedHold ?? 0) !== 0 };
};

/** The pure decider's input, read off the real store: the first entry's run and its current episode. */
const nextFacts = (control: LandingControlRead | undefined = controlAt(), over: Partial<NextLandingFacts> = {}): NextLandingFacts => {
  const facts = landingFactsOf(coord, P);
  const runId = facts.entries[0]?.runId ?? null;
  const read = runId === null ? null : coord.run(runId);
  const r = read !== null && read.ok ? read.run : null;
  const ep = runId === null ? null : coord.currentEpisode(runId);
  const run = r === null ? null : { id: r.id, project: r.project, state: r.state, claimedBy: r.claimedBy, program: r.program, wave: r.wave,
    waveOf: r.waveOf, episode: ep === null ? null : { e: ep.e, head: ep.head, pr: ep.pr } };
  return { facts, control, nowMs: CONTROL_NOW, run, ...over };
};
const sent = (f: NextLandingFacts): Extract<ReturnType<typeof nextLandingNoticeOf>, { kind: 'send' }> => {
  const out = nextLandingNoticeOf(f);
  if (out.kind !== 'send') throw new Error(`expected a send, got ${out.reason}`);
  return out;
};

describe('nextLandingNoticeOf: recipient and tuple policy (pure)', () => {
  it('a run-bound row sends to the run\'s claimant with the canonical tuple of its current episode', () => {
    const id = atMerging();
    const f = nextFacts();
    const out = sent(f);
    const e = f.facts.entries[0]!;
    expect(out.toId).toBe('coordinator-a');
    expect(out.runId).toBe(id);
    expect(out.episode).toEqual({ kind: 'run', runId: id, episode: f.run!.episode!.e, toId: 'coordinator-a' });
    expect(JSON.parse(out.identity)).toEqual(['landing-next', 1, P, e.id, 7, CONTROL_HEAD_SHA, HC, e.pinnedAt, 'run', id, f.run!.episode!.e, CONTROL_BASE_SHA, 'coordinator-a']);
    expect(out.body.startsWith(`Next-to-land cue for ${P} #7 at ${CONTROL_HEAD_SHA}, measured against base ${CONTROL_BASE_SHA}.`)).toBe(true);
    expect(out.body).toContain('This is not merge permission.');
    expect(out.body).toContain(out.identity);
  });

  it('refuses a recipient it cannot name: a missing, foreign or unreadable run, a run that left merging, no claimant, no episode', () => {
    atMerging();
    const f = nextFacts();
    const run = f.run!;
    const reason = (over: Partial<NextLandingFacts>): string => { const o = nextLandingNoticeOf({ ...f, ...over }); return o.kind === 'send' ? 'send' : o.reason; };
    expect(reason({ run: null })).toBe('run-unreadable');
    expect(reason({ run: { ...run, project: 'project-b' } })).toBe('run-unreadable');
    expect(reason({ run: { ...run, id: run.id + 1 } })).toBe('run-unreadable');
    expect(reason({ run: { ...run, state: 'awaiting-review' } })).toBe('run-not-merging');
    expect(reason({ run: { ...run, claimedBy: null } })).toBe('recipient-missing');
    expect(reason({ run: { ...run, episode: null } })).toBe('episode-unreadable');
    expect(reason({ run: { ...run, episode: { ...run.episode!, head: 'e'.repeat(40) } } })).toBe('episode-changed');
    expect(reason({ run: { ...run, episode: { ...run.episode!, pr: 8 } } })).toBe('episode-changed');
    expect(reason({ run: { ...run, episode: { ...run.episode!, pr: null } } })).toBe('episode-changed');
  });

  it('a valid run with a null wave total is eligible, and the null passes through unchanged', () => {
    atMerging('coordinator-a', null);
    const f = nextFacts();
    expect(f.run!.waveOf).toBeNull();
    expect(sent(f).toId).toBe('coordinator-a');
  });

  it('a no-run row goes to the journal creation claimant, never to a later order setter', () => {
    expect(coord.writeLandingAuthority({ kind: 'entry', project: P, pr: 7, pinnedSha: CONTROL_HEAD_SHA, handoffCommit: HC, setBy: 'creator-a' }, 1000)).toMatchObject({ ok: true });
    const first = sent(nextFacts());
    expect(first.toId).toBe('creator-a');
    expect(first.runId).toBeNull();
    expect(coord.writeLandingAuthority({ kind: 'order', project: P, pr: 7, fixesMain: true, setBy: 'lane-b' }, 2000)).toMatchObject({ ok: true });
    const f = nextFacts();
    const later = sent(f);
    expect(later.toId, 'not the later order setter').toBe('creator-a');
    expect(f.facts.entries[0]!.setBy).toBe('lane-b');
    expect(later.episode).toEqual({ kind: 'no-run', creationSeq: f.facts.creations[0]!.seq, toId: 'creator-a' });
    expect(JSON.parse(later.identity)).toEqual(['landing-next', 1, P, f.facts.entries[0]!.id, 7, CONTROL_HEAD_SHA, HC, 1000, 'no-run', null, f.facts.creations[0]!.seq, CONTROL_BASE_SHA, 'creator-a']);
  });

  it('a no-run row with no recorded creation is creation-unrecorded, and a creation is never read off the projection', () => {
    coord.writeLandingAuthority({ kind: 'entry', project: P, pr: 7, pinnedSha: CONTROL_HEAD_SHA, handoffCommit: HC, setBy: 'creator-a' }, 1000);
    const f = nextFacts();
    expect(nextLandingNoticeOf({ ...f, facts: { ...f.facts, creations: [] } })).toEqual({ kind: 'no-send', reason: 'creation-unrecorded' });
    expect(f.facts.creations).toEqual([{ id: f.facts.entries[0]!.id, seq: expect.any(Number), setBy: 'creator-a' }]);
  });

  it('a binding refusal carries its own word, and a proven marker absence is inert', () => {
    atMerging();
    expect(nextLandingNoticeOf(nextFacts(controlRead({ lander: { ok: false, reason: 'absent' } })))).toEqual({ kind: 'no-send', reason: 'inert' });
    expect(nextLandingNoticeOf(nextFacts(controlRead({ lander: { ok: false, reason: 'unreadable' } })))).toEqual({ kind: 'no-send', reason: 'opt-in-unknown' });
    expect(nextLandingNoticeOf(nextFacts(controlAt(CONTROL_BASE_SHA, 'red')))).toEqual({ kind: 'no-send', reason: 'main-red' });
  });

  it('a fixesMain head under red is named as the exception in the body', () => {
    atMerging();
    expect(coord.writeLandingAuthority({ kind: 'order', project: P, pr: 7, fixesMain: true, setBy: 'lane-b' }, 2000)).toMatchObject({ ok: true });
    const out = sent(nextFacts(controlAt(CONTROL_BASE_SHA, 'red')));
    expect(out.body).toContain('fixes main');
    expect(sent(nextFacts()).body).not.toContain('fixes main');
  });
});

describe('applyLandingControl: the cue is queued once, durably', () => {
  it('queues one mail and one observation, with the digest in the subject and detail and the tuple in the body', () => {
    const id = atMerging();
    const out = apply();
    expect(out).toMatchObject({ kind: 'queued', holdChanged: false });
    const [mail] = cueMails();
    const identity = JSON.parse((mail!.body as string).split('\n').find((l) => l.startsWith('["landing-next"'))!) as unknown[];
    const digest = sha256(JSON.stringify(identity));
    expect(mail).toMatchObject({ fromId: 'operator', toId: 'coordinator-a', runId: id, kind: 'status', subject: `next-to-land:#7:${digest}` });
    expect(Buffer.byteLength(mail!.subject as string, 'utf8')).toBeLessThan(MAIL_SUBJECT_MAX_BYTES);
    expect(rows('SELECT * FROM mail_deliveries')).toHaveLength(1);
    expect(cueObservations()).toHaveLength(1);
    expect(cueObservations()[0]).toMatchObject({ runId: id, detail: `landing:next:v1:${digest}` });
    expect(out).toMatchObject({ mailId: mail!.id });
    const envelope = rows('SELECT envelope FROM mail_deliveries')[0]!.envelope as string;
    expect(envelope).toContain(`subject: next-to-land:#7:${digest}`);
    expect(envelope).toContain('id: 1');
  });

  it('a null wave total reaches the envelope unchanged: no total, no synthetic one', () => {
    atMerging('coordinator-a', null);
    expect(apply()).toMatchObject({ kind: 'queued' });
    const envelope = rows('SELECT envelope FROM mail_deliveries')[0]!.envelope as string;
    expect(envelope).toContain('(program:prog-a wave 1)');
    expect(envelope).not.toContain('wave 1/');
  });

  it.each([...OUTSTANDING_DELIVERY_STATES, ...TERMINAL_DELIVERY_STATES])('M19: a retry after the delivery reached %s, and after a restart, is a duplicate (run arm)', (state) => {
    atMerging();
    expect(apply()).toMatchObject({ kind: 'queued' });
    coord.db.prepare('UPDATE mail_deliveries SET state = ?').run(state);
    expect(apply()).toEqual({ kind: 'duplicate', holdChanged: false });
    reopen();
    expect(apply()).toEqual({ kind: 'duplicate', holdChanged: false });
    expect(cueMails()).toHaveLength(1);
    expect(cueObservations()).toHaveLength(1);
  });

  it.each([...OUTSTANDING_DELIVERY_STATES, ...TERMINAL_DELIVERY_STATES])('M19: a retry after the delivery reached %s, and after a restart, is a duplicate (no-run arm)', (state) => {
    coord.writeLandingAuthority({ kind: 'entry', project: P, pr: 7, pinnedSha: CONTROL_HEAD_SHA, handoffCommit: HC, setBy: 'creator-a' }, 1000);
    expect(apply()).toMatchObject({ kind: 'queued' });
    expect(cueObservations()).toHaveLength(0);
    coord.db.prepare('UPDATE mail_deliveries SET state = ?').run(state);
    expect(apply()).toEqual({ kind: 'duplicate', holdChanged: false });
    reopen();
    expect(apply()).toEqual({ kind: 'duplicate', holdChanged: false });
    expect(cueMails()).toHaveLength(1);
    expect(cueMails()[0]).toMatchObject({ toId: 'creator-a', runId: null });
  });

  it('M20: a distinct base yields one new cue, and the same base again is a duplicate', () => {
    atMerging();
    expect(apply()).toMatchObject({ kind: 'queued' });
    expect(apply(controlAt(BASE_B))).toMatchObject({ kind: 'queued' });
    expect(apply(controlAt(BASE_B))).toMatchObject({ kind: 'duplicate' });
    expect(apply()).toMatchObject({ kind: 'duplicate' });
    expect(cueMails()).toHaveLength(2);
    expect(new Set(cueMails().map((m) => m.subject)).size).toBe(2);
  });

  it('M20 / NOTICE-same-ms: two verified episodes with an equal pinnedAt each get exactly one cue', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_784_600_000_000);
    const id = atMerging();
    const pinnedAt = landingFactsOf(coord, P).entries[0]!.pinnedAt;
    const first = coord.currentEpisode(id)!.e;
    expect(apply()).toMatchObject({ kind: 'queued' });
    retreat(id);
    step(id, 'awaiting-review');
    enterMerging(id);
    expect(landingFactsOf(coord, P).entries[0]!.pinnedAt, 'the same millisecond').toBe(pinnedAt);
    expect(coord.currentEpisode(id)!.e).not.toBe(first);
    expect(apply()).toMatchObject({ kind: 'queued' });
    expect(apply()).toMatchObject({ kind: 'duplicate' });
    expect(cueMails()).toHaveLength(2);
    expect(cueObservations()).toHaveLength(2);
  });

  it('M20 / NOTICE-return: coordinator A to B to A in one episode and base is two mails in total, one per recipient', () => {
    atMerging();
    expect(apply()).toMatchObject({ kind: 'queued' });
    coord.db.prepare("UPDATE runs SET claimedBy = 'coordinator-b'").run();
    expect(apply()).toMatchObject({ kind: 'queued' });
    coord.db.prepare("UPDATE runs SET claimedBy = 'coordinator-a'").run();
    expect(apply()).toMatchObject({ kind: 'duplicate' });
    expect(cueMails().map((m) => m.toId)).toEqual(['coordinator-a', 'coordinator-b']);
  });

  it('M20: a no-run row converted to a run (a new run episode) is one new cue to the run\'s claimant', () => {
    coord.writeLandingAuthority({ kind: 'entry', project: P, pr: 7, pinnedSha: CONTROL_HEAD_SHA, handoffCommit: HC, setBy: 'creator-a' }, 1000);
    expect(apply()).toMatchObject({ kind: 'queued' });
    atMerging('coordinator-b');
    expect(landingFactsOf(coord, P).entries[0]!.runId).not.toBeNull();
    expect(apply()).toMatchObject({ kind: 'queued' });
    expect(apply()).toMatchObject({ kind: 'duplicate' });
    expect(cueMails().map((m) => m.toId)).toEqual(['creator-a', 'coordinator-b']);
  });

  it('a head that leaves and returns without a new pin or base mints no new episode', () => {
    atMerging();
    const moved = controlRead({ probe: { ok: true, doc: { ...(controlRead().probe as Probe).doc, heads: [{ pr: 7, head: 'e'.repeat(40), branch: 'ws/alpha', id: null, base: { state: 'clean' } }] } } });
    expect(apply()).toMatchObject({ kind: 'queued' });
    expect(apply(moved)).toEqual({ kind: 'no-send', reason: 'head-mismatch', holdChanged: false });
    expect(apply()).toMatchObject({ kind: 'duplicate' });
    expect(cueMails()).toHaveLength(1);
  });
});

describe('applyLandingControl: the facts are revalidated inside the transaction (M21)', () => {
  // The control bundle was "collected" first; the database then moves before the store operation runs.
  it('a head changed after evidence collection sends nothing', () => {
    atMerging();
    const control = controlAt();
    coord.db.prepare("UPDATE landing_entries SET pinnedSha = ?").run('e'.repeat(40));
    expect(apply(control)).toEqual({ kind: 'no-send', reason: 'head-mismatch', holdChanged: false });
    expect(cueMails()).toHaveLength(0);
  });

  it('an entry that left the line, a pause and a run that left merging send nothing', () => {
    const id = atMerging();
    const control = controlAt();
    coord.db.prepare("UPDATE landing_projects SET operatorPaused = 1 WHERE project = ?").run(P);
    coord.db.prepare('INSERT OR IGNORE INTO landing_projects (project, operatorPaused) VALUES (?, 1)').run(P);
    expect(apply(control)).toMatchObject({ kind: 'no-send', reason: 'paused' });
    coord.db.prepare("UPDATE landing_projects SET operatorPaused = 0").run();
    coord.db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(id);
    expect(apply(control)).toMatchObject({ kind: 'no-send', reason: 'run-not-merging' });
    coord.db.prepare("UPDATE runs SET state = 'merging' WHERE id = ?").run(id);
    coord.db.prepare("UPDATE landing_entries SET state = 'landed'").run();
    expect(apply(control)).toMatchObject({ kind: 'no-send', reason: 'empty-or-blocked' });
    expect(cueMails()).toHaveLength(0);
    expect(cueObservations()).toHaveLength(0);
  });

  it('a claimant changed after evidence collection is the newly valid recipient, never the stale one', () => {
    atMerging();
    const control = controlAt();
    coord.db.prepare("UPDATE runs SET claimedBy = 'coordinator-b'").run();
    expect(apply(control)).toMatchObject({ kind: 'queued' });
    expect(cueMails().map((m) => m.toId)).toEqual(['coordinator-b']);
  });

  it('a run episode that disagrees with the entry sends nothing: episode-changed, not a cue at the newer head', () => {
    const id = atMerging();
    const control = controlAt();
    const e = coord.currentEpisode(id)!;
    coord.db.prepare('UPDATE run_events SET detail = replace(detail, ?, ?) WHERE id = ?').run(e.head, 'e'.repeat(40), e.e);
    expect(coord.currentEpisode(id)!.head).toBe('e'.repeat(40));
    expect(apply(control)).toEqual({ kind: 'no-send', reason: 'episode-changed', holdChanged: false });
    expect(cueMails()).toHaveLength(0);
    expect(cueObservations()).toHaveLength(0);
  });

  it('a fixesMain jump after evidence collection binds the fix entry, not the one the evidence named', () => {
    atMerging();
    const control = controlAt();
    expect(coord.writeLandingAuthority({ kind: 'entry', project: P, pr: 8, pinnedSha: 'f'.repeat(40), handoffCommit: HC, setBy: 'creator-a' }, 3000)).toMatchObject({ ok: true });
    expect(coord.writeLandingAuthority({ kind: 'order', project: P, pr: 8, fixesMain: true, setBy: 'lane-b' }, 4000)).toMatchObject({ ok: true });
    expect(apply(control)).toMatchObject({ kind: 'no-send', reason: 'head-mismatch' });
    expect(cueMails()).toHaveLength(0);
  });
});

describe('applyLandingControl: failure is atomic and the fence stands until a durable replay (M22, M27)', () => {
  const FAULTS: [string, string][] = [
    ['the mail insert', 'CREATE TRIGGER boom BEFORE INSERT ON mail BEGIN SELECT RAISE(ABORT, \'boom\'); END;'],
    ['the delivery insert', 'CREATE TRIGGER boom BEFORE INSERT ON mail_deliveries BEGIN SELECT RAISE(ABORT, \'boom\'); END;'],
    ['the stamp', 'CREATE TRIGGER boom BEFORE UPDATE ON mail_deliveries BEGIN SELECT RAISE(ABORT, \'boom\'); END;'],
    ['the observation insert', 'CREATE TRIGGER boom BEFORE INSERT ON run_events WHEN NEW.detail LIKE \'landing:next:v1:%\' BEGIN SELECT RAISE(ABORT, \'boom\'); END;'],
    ['the health update', 'CREATE TRIGGER boom BEFORE UPDATE ON landing_projects BEGIN SELECT RAISE(ABORT, \'boom\'); END;'],
  ];
  const closedStamp = 'CREATE TRIGGER boom AFTER INSERT ON mail_deliveries BEGIN UPDATE mail_deliveries SET state = \'acked\' WHERE id = NEW.id; END;';

  const expectUntouched = (): void => {
    expect(rows('SELECT * FROM mail')).toHaveLength(0);
    expect(rows('SELECT * FROM mail_deliveries')).toHaveLength(0);
    expect(cueObservations()).toHaveLength(0);
    expect(flags()).toEqual({ operatorPaused: false, mainRedHold: false });
  };

  it.each(FAULTS)('a fault in %s rolls back everything, fences the line, and only a durable replay lets one cue through', (_name, sql) => {
    atMerging();
    coord.db.prepare('INSERT INTO landing_projects (project) VALUES (?) ON CONFLICT(project) DO NOTHING').run(P);
    // a red reading changes the flag, so the health update is the first write a fault there interrupts
    const control = _name === 'the health update' ? controlAt(CONTROL_BASE_SHA, 'red') : controlAt();
    coord.db.exec(sql);
    const out = apply(control);
    expect(out.kind).toBe('failure');
    expect(out).toMatchObject({ failure: { error: 'landing-db-apply', recovery: 'replay', mayApply: true } });
    expectUntouched();
    expect(coord.readLanding(P)).toMatchObject({ ok: false, error: 'landing-fenced' });
    // scheduled passes send nothing while the fence stands, whatever they are given
    expect(apply(control)).toEqual({ kind: 'failure', failure: { error: 'landing-fenced', recovery: 'replay' } });
    expect(apply(control)).toMatchObject({ kind: 'failure' });
    expectUntouched();
    coord.db.exec('DROP TRIGGER boom');
    expect(coord.replayLandingJournal()).toMatchObject({ ok: true });
    expect(apply(controlAt())).toMatchObject({ kind: 'queued' });
    expect(apply(controlAt())).toMatchObject({ kind: 'duplicate' });
    expect(cueMails()).toHaveLength(1);
  });

  it('a red reading that set the flag is rolled back with a cue that then fails', () => {
    atMerging();
    expect(coord.writeLandingAuthority({ kind: 'order', project: P, pr: 7, fixesMain: true, setBy: 'lane-b' }, 2000)).toMatchObject({ ok: true });
    coord.db.exec(FAULTS[0]![1]);
    expect(apply(controlAt(CONTROL_BASE_SHA, 'red'))).toMatchObject({ kind: 'failure', failure: { error: 'landing-db-apply' } });
    expectUntouched();
  });

  it('M22: a stamp that finds the delivery already terminal is a failure, never a half cue', () => {
    atMerging();
    coord.db.exec(closedStamp);
    expect(apply()).toMatchObject({ kind: 'failure', failure: { error: 'landing-db-apply' } });
    expect(rows('SELECT * FROM mail')).toHaveLength(0);
    expect(rows('SELECT * FROM mail_deliveries')).toHaveLength(0);
    expect(cueObservations()).toHaveLength(0);
    expect(coord.readLanding(P)).toMatchObject({ ok: false, error: 'landing-fenced' });
  });

  it('a COMMIT fault is landing-db-commit: nothing committed, the fence stands, and a replay reopens the line', () => {
    atMerging();
    coord.db.exec('CREATE TABLE zz_parent (id INTEGER PRIMARY KEY)');
    coord.db.exec('CREATE TABLE zz_child (ref INTEGER REFERENCES zz_parent(id) DEFERRABLE INITIALLY DEFERRED)');
    coord.db.exec('CREATE TRIGGER boom AFTER INSERT ON mail BEGIN INSERT INTO zz_child (ref) VALUES (999); END;');
    const out = apply();
    expect(out).toMatchObject({ kind: 'failure', failure: { error: 'landing-db-commit', recovery: 'replay', mayApply: true } });
    expect(rows('SELECT * FROM mail')).toHaveLength(0);
    expect(cueObservations()).toHaveLength(0);
    expect(coord.readLanding(P)).toMatchObject({ ok: false, error: 'landing-fenced' });
    expect(apply()).toEqual({ kind: 'failure', failure: { error: 'landing-fenced', recovery: 'replay' } });
    coord.db.exec('DROP TRIGGER boom');
    expect(coord.replayLandingJournal()).toMatchObject({ ok: true });
    expect(apply()).toMatchObject({ kind: 'queued' });
    expect(cueMails()).toHaveLength(1);
  });

  it('a store with no journal port refuses with landing-journal-unavailable and touches nothing', () => {
    atMerging();
    const bare = new CoordStore(coord.db);
    expect(apply(controlAt(), bare)).toEqual({ kind: 'failure', failure: { error: 'landing-journal-unavailable', recovery: 'restart' } });
    expect(cueMails()).toHaveLength(0);
  });

  it('a refused fact read is a typed failure with no write, not a no-send', () => {
    atMerging();
    coord.db.prepare("UPDATE landing_entries SET pr = 0").run();
    expect(apply()).toEqual({ kind: 'failure', failure: { error: 'landing-projection-unreadable', recovery: 'repair' } });
    expect(cueMails()).toHaveLength(0);
  });
});
