// Path identity W1a (spec §2.3): `readSessionRecord` answers `bad-id` for an id `isRegistryId`
// refuses, BEFORE any listing, and every caller that acts on absence reads that answer as unmeasured,
// never as absent.
//
// Each absence-acting case below uses an UNLISTED non-registry id unless its title says the row is
// planted. Unlisted is the input on which `bad-id` and `absent` part: an `absent` arm re-lists, finds
// nothing, and acts (`dead`, `ok`, `gone`, `not-a-child`). So a mutant that folds `bad-id` into
// `absent` goes red here instead of passing for the wrong reason. The route cases plant the row, so
// that only the read's own answer can refuse.
//
// Nothing here reaches a live HOME. Every registry is a fixture HOME's, a dash-named row is a plain
// file in it, and ccd and tmux are scripted recorders.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { readRegistry, readSessionRecord } from '../src/registry.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { measureClaimant, type ReclaimDeps } from '../src/coord/reclaim.js';
import { childBindGate } from '../src/coord/childBind.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_LICENCE_NONE, reclaimChild, type ChildReclaimDeps,
} from '../src/coord/childReclaim.js';
import { childGateAtClose, closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { DEAD_COORDINATOR_AFTER_MS, DEAD_COORDINATOR_LANE_LIVE_MARKER } from '../src/deadCoordinator.js';
import { NotifyLog } from '../src/notifylog.js';
import { Tmux, type Runner, type SessionVerdict } from '../src/exec.js';
import { askKey } from '../src/askkey.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okAsk, okRun } from './coordReadHelpers.js';
import { appFor, recorder, seedRow, storedRun } from './idGateFixture.js';

const BAD = '--actor';
const CLAIMANT = 'demo-coord-a';
const WORKER = 'demo-worker-1';
const PARENT = 'demo-coordinator';
const TOKEN = 'f'.repeat(64);
const T0 = 1_790_000_000_000;
const GONE: SessionVerdict = { verdict: 'gone' };
const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
const ASK_KEY = askKey({ questions: [QUESTION] })!;
const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
const BAD_CLAIMANT = {
  state: 'unmeasurable', why: 'the claimant id is not a registry id, so it is never measured or composed',
};

const store = (home: string): CoordStore => new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
const regOf = (home: string): string => path.join(home, '.cc-sessions');
/** Read back from disk, so no case depends on the uuid `seedRow` happens to write. */
const uuidOf = (home: string, id: string): string => readFileSync(path.join(regOf(home), `${id}.uuid`), 'utf8');

/** tmux answers `capture-pane` with the ask's own menu, so a press that got past the guard WOULD land
 *  and the no-keys assertion cannot pass for the wrong reason. Every other exec succeeds, empty. */
const paneRunner = (pane: string): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return args[0] === 'capture-pane' ? { code: 0, stdout: pane, stderr: '' } : { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe('readSessionRecord answers bad-id before any read (spec §2.3)', () => {
  it("a planted --actor row answers {kind:'bad-id'} with zero listings and zero field reads", async () => {
    const home = mkTmp('ccrc-bad-id-read-');
    seedRow(home, BAD);
    expect(readdirSync(regOf(home)), 'the row really is planted').toContain(`${BAD}.uuid`);
    let listings = 0;
    let fieldReads = 0;
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => { listings += 1; return localIO.readdir(p); },
      readFileMeasured: async (p) => { fieldReads += 1; return localIO.readFileMeasured(p); },
    };
    expect(await readSessionRecord(io, testDeps(home).cfg, BAD)).toEqual({ kind: 'bad-id' });
    expect(listings, 'no listing is spent on an id ccd could read as a flag').toBe(0);
    expect(fieldReads, 'and no field is read').toBe(0);
  });

  it('.hidden and a 256-character id answer bad-id', async () => {
    const home = mkTmp('ccrc-bad-id-read-');
    seedRow(home, '.hidden');   // planted, so only the predicate can refuse it
    const cfg = testDeps(home).cfg;
    expect(await readSessionRecord(localIO, cfg, '.hidden')).toEqual({ kind: 'bad-id' });
    expect(await readSessionRecord(localIO, cfg, 'x'.repeat(256))).toEqual({ kind: 'bad-id' });
  });

  it('control: a planted a--actor row is found', async () => {
    const home = mkTmp('ccrc-bad-id-read-');
    seedRow(home, 'a--actor');
    const read = await readSessionRecord(localIO, testDeps(home).cfg, 'a--actor');
    expect(read.kind).toBe('found');
    expect(read.kind === 'found' && read.record.id).toBe('a--actor');
  });
});

describe('every absence-acting caller holds on bad-id (spec §2.3)', () => {
  const claimantDeps = (home: string): ReclaimDeps =>
    ({ coord: store(home), io: localIO, cfg: testDeps(home).cfg, tmux: { sessionVerdict: async () => GONE } });

  it("measureClaimant('--actor') is unmeasurable, never dead", async () => {
    const home = mkTmp('ccrc-bad-id-claimant-');
    seedRow(home, CLAIMANT);   // the registry lists cleanly, and names no --actor
    expect(readdirSync(regOf(home)), 'unlisted: the input on which bad-id and absent part').not.toContain(`${BAD}.uuid`);
    expect(await measureClaimant(claimantDeps(home), BAD, Date.now())).toEqual(BAD_CLAIMANT);
  });

  it('with its row planted, still unmeasurable', async () => {
    const home = mkTmp('ccrc-bad-id-claimant-');
    seedRow(home, BAD);
    expect(await measureClaimant(claimantDeps(home), BAD, Date.now())).toEqual(BAD_CLAIMANT);
  });

  it('the dead-coordinator lane leaves a run claimed by --actor', async () => {
    let clock = T0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const home = mkTmp('ccrc-bad-id-lane-');
    seedRoster(home);
    const reg = regOf(home);
    mkdirSync(path.join(reg, '.lifecycle'), { recursive: true });
    // ARMED: a fold of bad-id into absent would END the programme here, not merely record it.
    writeFileSync(path.join(reg, DEAD_COORDINATOR_LANE_LIVE_MARKER), '');
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => {
      if (path.basename(cmd) === 'tmux') {
        if (args[0] !== 'has-session') return { code: 1, stdout: '', stderr: '' };
        const id = (args[2] ?? '').replace(/^=cc-/, '').replace(/:$/, '');
        return { code: 1, stdout: '', stderr: `can't find session: cc-${id}` };
      }
      calls.push(args);
      return { code: 0, stdout: '', stderr: '' };
    };
    const coord = store(home);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const base = testDeps(home, run);
    const deps = { ...base, cfg, coord, notifyLog, tmux: new Tmux(run), presence: { isVisible: () => false } };
    const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
    watcher.useCoordSerialiser({ withSweepAbandon: (c, fn) => fn((runId, crashedId, stillCrashed) =>
      closeRun({ coord: c, io: deps.io, cfg, runCcd: deps.runCcd }, runId, { intent: 'abandon' }, 'sweep',
        { claimedBy: crashedId, stillCrashed })) });
    const id = storedRun(coord, { state: 'working', sessionId: WORKER, claimedBy: BAD });
    // A journal history for --actor. Folded into `absent`, an unlisted claimant WITH history reads
    // CRASHED (one with none reads unmeasured on its own), so this is the input on which the arms part.
    coord.ingestJournal({ gen: '1790000000000000000', cursor: 1, size: 1, at: 1, rows: [parseJournalLine(JSON.stringify(
      { v: 1, uid: `badid.create.${clock}`, at: clock, act: 'create', outcome: 'done', id: BAD, dec: { surface: 'none' } }))] });
    const pass = async (): Promise<void> => {
      await watcher.sweepLifecycle();
      await watcher.sweepDeadCoordinators(await readRegistry(deps.io, cfg), readdirSync(reg));
    };
    // The first pass, passes nine minutes apart across the hour, then one more: an act would land here.
    await pass();
    for (let done = 0; done < DEAD_COORDINATOR_AFTER_MS; done += 9 * 60_000) {
      clock += Math.min(9 * 60_000, DEAD_COORDINATOR_AFTER_MS - done);
      await pass();
    }
    clock += CHILD_RECLAIM_SWEEP_MS + 1;
    await pass();
    expect(okRun(coord.run(id))!.state, 'never abandoned').toBe('working');
    expect(calls, 'no ccd verb composed').toEqual([]);
    expect(coord.feedEvents(50).filter((e) => e.title.startsWith('dead coordinator: programme')), 'no feed death row')
      .toEqual([]);
  });

  it('childBindGate(--actor) answers spent-unmeasured, never ok, and composes no pr-state', async () => {
    const home = mkTmp('ccrc-bad-id-bind-');
    seedRow(home, CLAIMANT);
    const rec = recorder();
    const base = testDeps(home, rec.run);
    const verdict = await childBindGate({ io: base.io, cfg: base.cfg, runCcd: base.runCcd }, store(home), BAD);
    expect(verdict).toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the session id is not a registry id' });
    expect(rec.calls.filter((c) => c[0] === 'pr-state')).toEqual([]);
  });

  it('reclaimChild(--actor) defers marker-unreadable', async () => {
    const home = mkTmp('ccrc-bad-id-reclaim-child-');
    seedRow(home, CLAIMANT);
    const rec = recorder();
    const base = testDeps(home, rec.run);
    const coord = store(home);
    const runId = storedRun(coord, { state: 'planned', sessionId: null, claimedBy: CLAIMANT });
    const m = coord.insertMail({ fromId: CLAIMANT, fromUuid: 'u', toId: BAD, runId: null,
      kind: 'status', subject: 's', body: 'b', artifacts: [] });
    const delivery = coord.queueDelivery(m.id, BAD, '<mail/>').id;
    const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd };
    const out = await reclaimChild(deps, { sessionId: BAD, runId, trigger: 'close', deferExpired: false,
      deferredSinceMs: null, feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: CHILD_RECLAIM_LICENCE_NONE });
    expect(out).toEqual({ kind: 'deferred', sessionId: BAD, runId, why: 'marker-unreadable',
      detail: 'the session id is not a registry id' });
    const state = (coord.db.prepare('SELECT state FROM mail_deliveries WHERE id = ?').get(delivery) as { state: string }).state;
    expect(state, 'its outstanding delivery stays outstanding').toBe('queued');
    expect(rec.calls, 'no runCcd').toEqual([]);
  });

  it('childGateAtClose(--actor) reads the mark unreadable, never not-a-child, with no second listing', async () => {
    const home = mkTmp('ccrc-bad-id-close-gate-');
    seedRow(home, CLAIMANT);
    const rec = recorder();
    const base = testDeps(home, rec.run);
    const coord = store(home);
    const id = storedRun(coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMANT });
    let listings = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { listings += 1; return localIO.readdir(p); } };
    const deps: CloseRunDeps = { coord, io, cfg: base.cfg, runCcd: base.runCcd };
    const gate = await childGateAtClose(deps, okRun(coord.run(id))!, BAD, { ok: true, siblings: [] }, false, 'failed', null);
    expect(gate).toEqual({ decision: { reclaim: false, why: 'marker-unreadable' }, request: null });
    expect(listings, 'nothing ever listed this id, so nothing is re-listed for it').toBe(0);
    expect(rec.calls).toEqual([]);
  });

  it('POST /api/sessions/--actor/kickoff, /stop and /swap answer 400 bad-session-id', async () => {
    const home = mkTmp('ccrc-bad-id-routes-');
    seedRow(home, BAD);   // planted: only the read's own answer can refuse
    const rec = recorder();
    const w = await appFor(home, rec.run);
    app = w.app;
    const kick = await app.inject({ method: 'POST', url: `/api/sessions/${BAD}/kickoff`,
      payload: { slug: 'demo-programme', title: 'Demo programme' } });
    expect(kick.statusCode).toBe(400);
    expect(kick.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(w.coord.dueDeliveries(Date.now(), 60_000), 'no kickoff mail queued').toEqual([]);
    const stop = await app.inject({ method: 'POST', url: `/api/sessions/${BAD}/stop` });
    expect(stop.statusCode).toBe(400);
    expect(stop.json()).toEqual({ ok: false, error: 'bad-session-id' });
    const swap = await app.inject({ method: 'POST', url: `/api/sessions/${BAD}/swap`, payload: { wrapper: 'claude' } });
    expect(swap.statusCode).toBe(400);
    expect(swap.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(rec.calls.filter((c) => c[0] === 'stop' || c[0] === 'swap'), 'no stop or swap argv').toEqual([]);
  });

  it('POST /api/runs/:id/reclaim with claimedBy --actor answers 400 bad-session-id', async () => {
    const home = mkTmp('ccrc-bad-id-reclaim-');
    seedRow(home, CLAIMANT);
    const rec = recorder();
    const w = await appFor(home, rec.run);
    app = w.app;
    const id = storedRun(w.coord, { state: 'working', sessionId: WORKER, claimedBy: CLAIMANT });
    const res = await app.inject({ method: 'POST', url: `/api/runs/${id}/reclaim`, payload: { claimedBy: BAD } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session-id', detail: 'claimedBy is not a registry id' });
    expect(okRun(w.coord.run(id))!.claimedBy, "the run's claimant is unchanged").toBe(CLAIMANT);
    expect(rec.calls).toEqual([]);
  });

  it('POST /api/asks/:id/answer for an ask whose stored childId is --actor answers 409 child-unmeasurable', async () => {
    const home = mkTmp('ccrc-bad-id-ask-');
    seedRow(home, PARENT);
    seedRow(home, BAD);   // planted, with a live hook state, so only the read's own answer can refuse
    const now = Date.now();
    writeFileSync(path.join(regOf(home), `${BAD}.hookstate.json`), JSON.stringify({
      v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(home, BAD), pid: 4242,
      updatedAt: now, ask: { questions: [QUESTION] }, subagents: [],
    }));
    const panes = paneRunner(ASK_PANE);
    const w = await appFor(home, panes.run, { mailToken: TOKEN });
    app = w.app;
    const askId = w.coord.insertAsk({
      childId: BAD, parentId: PARENT, runId: null, askKey: ASK_KEY, askAt: now, dialogId: 'dlg-1',
      question: QUESTION.question, options: QUESTION.options.map((o) => o.label), now,
    });
    const res = await app.inject({ method: 'POST', url: `/api/asks/${askId}/answer`,
      headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { fromId: PARENT, fromUuid: uuidOf(home, PARENT), optionIndexes: [1] } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'child-unmeasurable' });
    expect(panes.calls.filter((c) => c[0] === 'send-keys'), 'no tmux keys are sent').toEqual([]);
    expect(okAsk(w.coord.askById(askId))!.state, 'the ask stays held').toBe('held');
  });
});
