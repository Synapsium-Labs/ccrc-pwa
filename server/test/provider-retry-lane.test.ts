// The provider-failure ladder's beat, through the real watcher (plan docs/superpowers/plans/2026-11-25-provider-retry.md): the
// stall pass reads each live session's marker, the ladder queues one run-less mail to the session itself, the mail lane types its
// line, and an outage raises one sessionless notice. The rules are pinned pure in `provider-retry.test.ts` and
// `provider-outage.test.ts`; here is what only the lane can get wrong: which sessions it reaches, what it writes, what it reads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher, STALL_SWEEP_MS, type StallTick } from '../src/watch.js';
import type { SessionRecord } from '../src/registry.js';
import type { PushPayload } from '../src/push.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { STALL_QUIET_MS } from '../src/coord/stall.js';
import { NotifyLog } from '../src/notifylog.js';
import { PROVIDER_RETRY_BODY, isProviderRetryMail, providerRetrySubject, renderProviderRetryLine } from '../../shared/provider-retry.js';
import { reviveFleetSession, type FleetSession } from '../../shared/api.js';
import { assembleFleet } from '../src/fleet.js';
import { liveStateReaderOver } from '../src/livestate.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';

const MIN = 60_000;
const H = 60 * MIN;
const FAIL_AT = Date.parse('2026-11-25T10:00:00Z');
const PID = 4242;
const UUID = 'a'.repeat(36);
const [A, B, C, COORD] = ['lane-a-project-a', 'lane-b-project-b', 'lane-c-project-c', 'lane-d-project-a'] as const;
const at = (ms: number): void => { vi.setSystemTime(ms); };

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); at(FAIL_AT - 2 * H); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const fleetRow = (id: string, over: Partial<FleetSession> = {}): FleetSession => ({
  hibernatedAt: null, id, wrapper: 'claude', home: '/home/u', project: 'demo', workdir: '/w/demo', workspace: `${id}-ws`, name: null, title: null,
  status: 'idle', statusUpdatedAt: FAIL_AT, limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null, hookState: null, askSummary: null,
  subagents: null, background: null, lastEnd: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null, limitWait: null,
  substrate: null, started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' },
  role: 'coordinator', releasedFrom: null, withCoordinator: null, ...over,
}) as FleetSession;
const regRow = (id: string, over: Partial<SessionRecord> = {}): SessionRecord => ({
  hibernatedAt: null, namedByOperator: false, title: null, id, wrapper: 'claude', project: 'demo', projectEvidence: 'measured', workdir: '/w/demo',
  uuid: UUID, started: true, home: null, pool: null, lastswap: null, workspace: `${id}-ws`, branch: null, branchEvidence: 'absent', base: null,
  prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null, substrate: null, stopped: null,
  supervisedAt: null, swapBlocked: null, stranded: null, spawn: null, lastEnd: null, lifecycleUnmeasured: [], unmeasured: [], route: null,
  child: { kind: 'none' }, ...over,
}) as unknown as SessionRecord;

interface Rig { home: string; coord: CoordStore; w: FleetWatcher; sent: PushPayload[]; calls: string[][]; pane: { text: string } }
async function rig(home = mkTmp('ccrc-provider-retry-'), prior?: CoordStore): Promise<Rig> {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  const pane = { text: '❯ \n' };
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    const out = args[0] === 'list-panes' ? `${PID}\n` : args[0] === 'capture-pane' ? pane.text : '';
    return { ran: true as const, code: ['list-panes', 'has-session', 'capture-pane', 'send-keys'].includes(args[0]!) ? 0 : 1, stdout: out, stderr: '' };
  };
  const coord = prior ?? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const sent: PushPayload[] = [];
  const base = testDeps(home, run);
  const deps: Deps = { ...base, coord, push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
    notifyLog: new NotifyLog(path.join(home, '.ccrc', 'notify.json')) };
  const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000, path.join(home, 'state-cache.json')));
  await w.tick();
  return { home, coord, w, sent, calls, pane };
}
function seed(home: string, id: string): void {
  const reg = path.join(home, '.cc-sessions');
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid: UUID, started: '1' })) writeFileSync(path.join(reg, `${id}.${k}`), v);
}
function seedLive(home: string, over: Record<string, unknown> = {}): void {
  mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'sessions', `${PID}.json`), JSON.stringify({ pid: PID, sessionId: UUID, cwd: '/w/demo', name: null,
    nameSource: null, status: 'idle', statusUpdatedAt: FAIL_AT + 1_000, version: '2.1.332', startedAt: FAIL_AT - 24 * H, ...over }));
}
function seedMark(home: string, id: string, over: Record<string, unknown> = {}): void {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.turn.json`), JSON.stringify({ v: 1, sessionId: UUID, state: 'failed', event: 'StopFailure',
    at: FAIL_AT, turnAt: FAIL_AT - MIN, stopAt: FAIL_AT, bg: 0, bgKinds: '', bgIds: '', err: 'server_error', restartAt: null, lostBg: 0,
    lostKinds: '', lostIds: '', crons: 0, failAts: [FAIL_AT], ...over }));
}
const tickOf = (...ids: string[]): StallTick => ({ panePids: new Map(ids.map((i): [string, number | null] => [i, PID])), records: ids.map((i) => regRow(i)), refused: new Set() });
interface MailRow { id: number; toId: string; runId: number | null; kind: string; subject: string; body: string }
const mails = (coord: CoordStore): MailRow[] =>
  coord.db.prepare("SELECT id, toId, runId, kind, subject, body FROM mail WHERE fromId = 'operator' ORDER BY id").all() as unknown as MailRow[];
const retries = (coord: CoordStore): MailRow[] => mails(coord).filter((m) => isProviderRetryMail({ fromId: 'operator', subject: m.subject }));
const delivery = (coord: CoordStore): { id: number; state: string; lastError: string | null; attempts: number } =>
  coord.db.prepare('SELECT id, state, lastError, attempts FROM mail_deliveries ORDER BY id DESC LIMIT 1').get() as never;
const outages = (r: Rig): PushPayload[] => r.sent.filter((p) => p.tag?.startsWith('provider-outage-'));
const feed = (coord: CoordStore): { title: string; body: string }[] =>
  (coord.db.prepare("SELECT title, body FROM feed_events WHERE kind = 'coord' ORDER BY id").all() as unknown as { title: string; body: string }[])
    .filter((f) => /errors/.test(f.title));

/** One session of the operator's own, whose turn ended on a provider error at FAIL_AT. */
async function one(id: string = A): Promise<Rig & { sweep: (ms: number, names?: readonly string[]) => Promise<void> }> {
  const r = await rig();
  seed(r.home, id); seedLive(r.home); seedMark(r.home, id);
  return { ...r, sweep: async (ms, names = []) => { at(ms); await r.w.sweepStalls([fleetRow(id)], names, tickOf(id)); } };
}

describe('the nudge, for any live session', () => {
  it('a session on no run: one self-mail a minute after the failure, run-less, its words, and no second while it is out', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN - 1);
    expect(retries(r.coord)).toEqual([]);
    await r.sweep(FAIL_AT + MIN - 1 + STALL_SWEEP_MS);
    expect(retries(r.coord)).toEqual([{ id: expect.any(Number), toId: A, runId: null, kind: 'status', subject: providerRetrySubject(FAIL_AT + MIN), body: PROVIDER_RETRY_BODY }]);
    for (let i = 2; i <= 40; i += 1) await r.sweep(FAIL_AT + MIN + i * STALL_SWEEP_MS);
    expect(retries(r.coord), 'queued: never two outstanding').toHaveLength(1);
    expect(mails(r.coord), 'nobody else is mailed').toHaveLength(1);
  }, 60_000);

  it('a nudge that landed and started no turn is repeated 15 minutes later, then again', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN);
    r.coord.markAcked(delivery(r.coord).id, FAIL_AT + MIN + 10_000);
    for (let t = FAIL_AT + 2 * MIN; t <= FAIL_AT + 16 * MIN; t += STALL_SWEEP_MS) await r.sweep(t);
    expect(retries(r.coord)).toHaveLength(1);
    await r.sweep(FAIL_AT + 17 * MIN);
    expect(retries(r.coord).map((m) => m.subject)).toEqual([providerRetrySubject(FAIL_AT + MIN), providerRetrySubject(FAIL_AT + 16 * MIN + 10_000)]);
  }, 60_000);

  it('a restart that relabelled the failed line done is still nudged', async () => {
    const r = await one();
    seedMark(r.home, A, { state: 'done', event: 'SessionStart', at: FAIL_AT + 20_000, restartAt: FAIL_AT + 20_000 });
    await r.sweep(FAIL_AT + MIN);
    expect(retries(r.coord)).toHaveLength(1);
  }, 60_000);

  it('a run worker and its coordinator are each nudged, run-less, and no mail goes to a coordinator about a worker', async () => {
    const r = await rig();
    for (const id of [B, COORD]) { seed(r.home, id); seedMark(r.home, id); }
    seedLive(r.home);
    const opened = r.coord.openRun({ program: 'demo-program', title: 'demo-program', project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
    if (!('id' in opened)) throw new Error(JSON.stringify(opened));
    r.coord.markDispatched(opened.id, B, `${B}-ws`, `ws/${B}`, false, FAIL_AT - H);
    const adv = r.coord.advance(opened.id, 'dispatched', 'coordinator');
    if (!adv.ok) throw new Error(JSON.stringify(adv));
    for (const ms of [FAIL_AT + MIN, FAIL_AT + 30 * MIN]) { at(ms); await r.w.sweepStalls([fleetRow(B), fleetRow(COORD)], ['stall-watch-live', 'stall-watch-escalate', 'stall-watch-w2-live'], tickOf(B, COORD)); }
    expect(mails(r.coord).map((m) => [m.toId, m.runId]).sort()).toEqual([[B, null], [COORD, null]]);
  }, 60_000);

  it('the quiet ladder is held for a worker that owes a retry: no stall check at the quiet time, and one again once it does not', async () => {
    const r = await rig();
    seed(r.home, B); seedMark(r.home, B); seedLive(r.home);
    const opened = r.coord.openRun({ program: 'demo-program', title: 'demo-program', project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
    if (!('id' in opened)) throw new Error(JSON.stringify(opened));
    r.coord.markDispatched(opened.id, B, `${B}-ws`, `ws/${B}`, false, FAIL_AT - H);
    const adv = r.coord.advance(opened.id, 'dispatched', 'coordinator');
    if (!adv.ok) throw new Error(JSON.stringify(adv));
    const checks = (): number => mails(r.coord).filter((m) => m.subject.startsWith('stall-check:')).length;
    at(FAIL_AT + STALL_QUIET_MS + MIN);
    await r.w.sweepStalls([fleetRow(B)], ['stall-watch-live'], tickOf(B));
    expect(checks()).toBe(0);
    seedMark(r.home, B, { state: 'done', event: 'Stop', failAts: [] });
    at(FAIL_AT + STALL_QUIET_MS + 3 * MIN);
    await r.w.sweepStalls([fleetRow(B)], ['stall-watch-live'], tickOf(B));
    expect(checks(), 'control: the same worker with nothing owed is checked').toBe(1);
  }, 60_000);

  it('an archived and a hibernated session are not nudged, though a pane answers', async () => {
    const r = await one();
    at(FAIL_AT + MIN);
    await r.w.sweepStalls([fleetRow(A, { archivedAt: 1_700_000_000 })], [], tickOf(A));
    at(FAIL_AT + 3 * MIN);
    await r.w.sweepStalls([fleetRow(A)], [], { ...tickOf(A), records: [regRow(A, { hibernatedAt: 1_700_000_000 } as Partial<SessionRecord>)] });
    expect(retries(r.coord)).toEqual([]);
    at(FAIL_AT + 5 * MIN);
    await r.w.sweepStalls([fleetRow(A)], [], tickOf(A));
    expect(retries(r.coord), 'control').toHaveLength(1);
  }, 60_000);

  it('the nudge never wakes a session that went to sleep after it was queued', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN);
    expect(r.coord.db.prepare('SELECT wake FROM mail_deliveries').all()).toEqual([{ wake: 'never' }]);
  }, 60_000);

  it('a failure older than the watch\'s mail horizon is nudged once per due time, never twice for one', async () => {
    const r = await one();
    const old = FAIL_AT - 3 * 24 * H;
    seedMark(r.home, A, { at: old, stopAt: old, turnAt: old - MIN, failAts: [old] });
    seedLive(r.home, { statusUpdatedAt: old + 1_000, startedAt: old - H });
    await r.sweep(FAIL_AT);
    r.coord.markAcked(delivery(r.coord).id, FAIL_AT + 5_000);
    await r.sweep(FAIL_AT + 2 * MIN);
    expect(retries(r.coord).map((m) => m.subject)).toEqual([providerRetrySubject(old + MIN)]);
    await r.sweep(FAIL_AT + 16 * MIN);
    expect(retries(r.coord)).toHaveLength(2);
  }, 60_000);

  it('a nudge that left the watch\'s own mail read still spaces the next one, which is sent', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN);
    r.coord.markAcked(delivery(r.coord).id, FAIL_AT + MIN + 5_000);
    await r.sweep(FAIL_AT + 26 * H);                  // nobody swept for a day: the nudge is out of the 24 h read
    expect(retries(r.coord).map((m) => m.subject)).toEqual([providerRetrySubject(FAIL_AT + MIN), providerRetrySubject(FAIL_AT + 16 * MIN + 5_000)]);
  }, 60_000);

  it('a queued nudge the session has moved past is taken back, and says why', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN);
    seedMark(r.home, A, { state: 'working', event: 'UserPromptSubmit', at: FAIL_AT + 90_000, turnAt: FAIL_AT + 90_000 });
    await r.sweep(FAIL_AT + 2 * MIN);
    expect(delivery(r.coord)).toMatchObject({ state: 'rejected', lastError: expect.stringContaining('moved past') });
  }, 60_000);

  it('the mail is recorded on the phone and never pushed', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN);
    seedLive(r.home);
    await r.w.tick();
    expect(r.sent.filter((p) => p.tag?.startsWith('mail-')), 'no push').toEqual([]);
    const rows = r.coord.db.prepare("SELECT body FROM feed_events WHERE kind = 'mail'").all() as { body: string }[];
    expect(rows.map((x) => x.body)).toEqual([providerRetrySubject(FAIL_AT + MIN)]);
  }, 60_000);
});

describe('the console\'s words on the wire: FleetSession.providerRetry (wave 2)', () => {
  const said = (r: Rig): unknown => r.w.currentProviderRetries().get(A);
  it('a pass publishes what the session owes, off the schedule, and a pass with a turn since takes it away', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + 10_000);
    expect(said(r)).toEqual({ err: 'server_error', since: FAIL_AT, attempts: 1, nextAt: FAIL_AT + MIN, phase: 'retrying' });
    seedMark(r.home, A, { state: 'working', event: 'UserPromptSubmit', at: FAIL_AT + 30_000, turnAt: FAIL_AT + 30_000 });
    await r.sweep(FAIL_AT + 10_000 + STALL_SWEEP_MS);
    expect(said(r)).toBeUndefined();
  });
  it('the pass that queues the nudge says its due time; the next one, with it still untyped, promises none', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN);
    expect(retries(r.coord)).toHaveLength(1);
    expect(said(r)).toMatchObject({ nextAt: FAIL_AT + MIN });
    await r.sweep(FAIL_AT + MIN + STALL_SWEEP_MS);
    expect(said(r)).toMatchObject({ nextAt: null });
  });
  it.each([['mail-disabled', ['mail-disabled']], ['the kill switch', ['stall-watch-disabled']]])('%s takes it away at once', async (_n, names) => {
    const r = await one();
    await r.sweep(FAIL_AT + 10_000);
    expect(said(r)).toBeDefined();
    await r.sweep(FAIL_AT + 10_000 + STALL_SWEEP_MS, names);
    expect(said(r)).toBeUndefined();
  });
  it('a session whose pane is gone, and one whose marker stopped reading, is not said to be retrying', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + 10_000);
    writeFileSync(path.join(r.home, '.cc-sessions', `${A}.turn.json`), 'torn');
    await r.sweep(FAIL_AT + 10_000 + STALL_SWEEP_MS);
    expect(said(r), 'not measured').toBeUndefined();
    seedMark(r.home, A);
    await r.sweep(FAIL_AT + 10_000 + 2 * STALL_SWEEP_MS);
    expect(said(r)).toBeDefined();
    at(FAIL_AT + 10_000 + 3 * STALL_SWEEP_MS);
    await r.w.sweepStalls([fleetRow(A)], [], { panePids: new Map(), records: [regRow(A)], refused: new Set() });
    expect(said(r)).toBeUndefined();
  });
  it('the assembly carries it as it is, leaves the key out for a session that owes none, and for one whose turn runs now', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + 10_000);
    const opts = { providerRetries: r.w.currentProviderRetries(), records: [regRow(A), regRow(B)] };
    const rows = async (): Promise<FleetSession[]> => {
      const d = testDeps(r.home, async (_c, args) => ({ ran: true as const, code: 0, stdout: args[0] === 'list-panes' ? `${PID}\n` : '', stderr: '' }));
      return assembleFleet(d.io, d.cfg, d.tmux, liveStateReaderOver(d.io), undefined, opts);
    };
    const [a, b] = await rows();
    expect(a!.providerRetry).toEqual({ err: 'server_error', since: FAIL_AT, attempts: 1, nextAt: FAIL_AT + MIN, phase: 'retrying' });
    expect('providerRetry' in b!).toBe(false);
    expect(reviveFleetSession(JSON.parse(JSON.stringify(a)))!.providerRetry).toEqual(a!.providerRetry);
    expect('providerRetry' in reviveFleetSession(JSON.parse(JSON.stringify(b)))!, 'an older frame').toBe(false);
    expect('providerRetry' in reviveFleetSession({ ...JSON.parse(JSON.stringify(a)), providerRetry: { ...a!.providerRetry, phase: 'no-lane' } })!, 'a later phase').toBe(false);
    seedLive(r.home, { status: 'busy' });
    expect('providerRetry' in (await rows())[0]!).toBe(false);
  });
});

describe('the arming, through the lane', () => {
  it('no marker touched: armed. The wave-2 marker is not asked', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN, []);
    expect(retries(r.coord)).toHaveLength(1);
  }, 60_000);
  it.each([['stall-watch-disabled', ['stall-watch-disabled', 'stall-watch-live', 'stall-watch-w2-live']], ['mail-disabled', ['mail-disabled', 'stall-watch-live']]])(
    '%s stops it', async (_n, names) => {
      const r = await one();
      await r.sweep(FAIL_AT + MIN, names);
      expect(retries(r.coord)).toEqual([]);
    }, 60_000);
  it.each([['off', 0], ['log', 0], ['check', 1], ['all', 1]] as const)('the chosen level %s: %i nudge', async (level, n) => {
    const r = await one();
    const set = r.coord.setStallSettings({ level }, Date.now(), r.coord.stallSettings());
    expect(set).toMatchObject({ kind: 'written' });
    await r.sweep(FAIL_AT + MIN, ['stall-watch-live']);
    expect(retries(r.coord)).toHaveLength(n);
  }, 60_000);
});

describe('the mail lane types it', () => {
  it('a person\'s draft in the box is refused: no key is pressed, nothing is stashed, and the row waits with no attempt counted', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN);
    r.pane.text = `${'─'.repeat(80)}\n❯ a half typed note\n${'─'.repeat(80)}\n  ⏵⏵ auto mode on\n`;
    at(FAIL_AT + 3 * MIN);
    await r.w.sweepMail();
    expect(r.calls.filter((c) => c[0] === 'send-keys')).toEqual([]);
    expect(delivery(r.coord)).toMatchObject({ state: 'queued', lastError: 'draft-present', attempts: 0 });
  }, 60_000);
  it('an empty box gets the line, and nothing else', async () => {
    const r = await one();
    await r.sweep(FAIL_AT + MIN);
    at(FAIL_AT + 3 * MIN);
    await r.w.sweepMail();
    const typed = r.calls.filter((c) => c[0] === 'send-keys' && c.includes('-l')).map((c) => c.at(-1));
    expect(typed).toEqual([renderProviderRetryLine()]);
  }, 60_000);
});

describe('the operator\'s one notice per provider per outage', () => {
  async function three(r: Rig, over: Record<string, unknown> = {}): Promise<(ms: number) => Promise<void>> {
    for (const id of [A, B, C]) { seed(r.home, id); seedMark(r.home, id, over); }
    seedLive(r.home);
    return async (ms) => { at(ms); await r.w.sweepStalls([fleetRow(A), fleetRow(B), fleetRow(C)], [], tickOf(A, B, C)); };
  }
  const markFile = (home: string): string => path.join(home, '.ccrc', 'provider-outages.json');

  it('three sessions owing on one provider raise one push, sessionless; more sweeps and a restarted server raise none', async () => {
    const r = await rig();
    const sweep = await three(r);
    await sweep(FAIL_AT + MIN);
    expect(outages(r)).toEqual([expect.objectContaining({ sessionId: '', tag: 'provider-outage-anthropic', title: 'Anthropic is returning errors' })]);
    expect(outages(r)[0]!.body).toContain('3 or more sessions');
    expect(JSON.parse(readFileSync(markFile(r.home), 'utf8'))).toEqual([{ key: 'anthropic', name: 'Anthropic', since: FAIL_AT + MIN }]);
    await sweep(FAIL_AT + 3 * MIN);
    await sweep(FAIL_AT + 30 * MIN);
    expect(outages(r)).toHaveLength(1);
    const again = await rig(r.home, r.coord);
    at(FAIL_AT + 32 * MIN);
    for (const id of [A, B, C]) seedMark(r.home, id, { at: FAIL_AT + 31 * MIN, stopAt: FAIL_AT + 31 * MIN, turnAt: FAIL_AT + 30 * MIN, failAts: [FAIL_AT + 31 * MIN] });
    await again.w.sweepStalls([fleetRow(A), fleetRow(B), fleetRow(C)], [], tickOf(A, B, C));
    expect(outages(again), 'the mark resumed the standing outage').toEqual([]);
  }, 60_000);

  it('cleared record-only once none has owed for 10 minutes, and a later outage pushes again', async () => {
    const r = await rig();
    const sweep = await three(r);
    await sweep(FAIL_AT + MIN);
    for (const id of [A, B, C]) seedMark(r.home, id, { state: 'done', event: 'Stop', failAts: [], turnAt: FAIL_AT + 2 * MIN, stopAt: FAIL_AT + 2 * MIN, at: FAIL_AT + 2 * MIN });
    for (let t = FAIL_AT + 2 * MIN; t <= FAIL_AT + 10 * MIN; t += MIN) await sweep(t);
    expect(feed(r.coord).map((f) => f.title)).toEqual(['Anthropic is returning errors']);
    await sweep(FAIL_AT + 11 * MIN);
    expect(feed(r.coord).map((f) => f.title)).toEqual(['Anthropic is returning errors', 'Anthropic errors have stopped']);
    expect(outages(r), 'the clear is recorded, never pushed').toHaveLength(1);
    expect(existsSync(markFile(r.home))).toBe(false);
    for (const id of [A, B, C]) seedMark(r.home, id, { at: FAIL_AT + 20 * MIN, stopAt: FAIL_AT + 20 * MIN, turnAt: FAIL_AT + 19 * MIN, failAts: [FAIL_AT + 20 * MIN] });
    await sweep(FAIL_AT + 21 * MIN);
    expect(outages(r)).toHaveLength(2);
  }, 60_000);

  it('a server that stopped between the mark and the push tells the operator when it returns', async () => {
    const r = await rig();
    await three(r);
    mkdirSync(path.join(r.home, '.ccrc'), { recursive: true });
    writeFileSync(markFile(r.home), JSON.stringify([{ key: 'anthropic', name: 'Anthropic', since: FAIL_AT }]));
    at(FAIL_AT + MIN);
    await r.w.sweepStalls([fleetRow(A), fleetRow(B), fleetRow(C)], [], tickOf(A, B, C));
    expect(outages(r)).toHaveLength(1);
  }, 60_000);

  it('two sessions raise nothing, nor do three on three providers', async () => {
    const r = await rig();
    await three(r);
    at(FAIL_AT + MIN);
    await r.w.sweepStalls([fleetRow(A), fleetRow(B), fleetRow(C)], [], tickOf(A, B));
    at(FAIL_AT + 3 * MIN);
    await r.w.sweepStalls([fleetRow(A), fleetRow(B, { wrapper: 'gpt' }), fleetRow(C, { wrapper: 'no-such-lane' })], [], tickOf(A, B, C));
    expect(outages(r)).toEqual([]);
  }, 60_000);

  it('a session whose marker cannot be read keeps the outage standing', async () => {
    const r = await rig();
    const sweep = await three(r);
    await sweep(FAIL_AT + MIN);
    for (const id of [A, B, C]) writeFileSync(path.join(r.home, '.cc-sessions', `${id}.turn.json`), 'torn');
    for (let t = FAIL_AT + 2 * MIN; t <= FAIL_AT + 30 * MIN; t += MIN) await sweep(t);
    expect(feed(r.coord).map((f) => f.title)).toEqual(['Anthropic is returning errors']);
  }, 60_000);

  it('a coordinator whose marker turned unreadable keeps the outage standing when every other session has recovered', async () => {
    const r = await rig();
    await three(r);
    seed(r.home, COORD); seedMark(r.home, COORD);
    const opened = r.coord.openRun({ program: 'demo-program', title: 'demo-program', project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
    if (!('id' in opened)) throw new Error(JSON.stringify(opened));
    r.coord.markDispatched(opened.id, 'lane-e-project-a', 'ws', 'ws/x', false, FAIL_AT - H);
    const adv = r.coord.advance(opened.id, 'dispatched', 'coordinator');
    if (!adv.ok) throw new Error(JSON.stringify(adv));
    const sweep = async (ms: number): Promise<void> => { at(ms); await r.w.sweepStalls([A, B, C, COORD].map((i) => fleetRow(i)), [], tickOf(A, B, C, COORD)); };
    await sweep(FAIL_AT + MIN);
    for (const id of [A, B, C]) seedMark(r.home, id, { state: 'done', event: 'Stop', failAts: [], turnAt: FAIL_AT + 2 * MIN, stopAt: FAIL_AT + 2 * MIN, at: FAIL_AT + 2 * MIN });
    writeFileSync(path.join(r.home, '.cc-sessions', `${COORD}.turn.json`), 'torn');
    for (let t = FAIL_AT + 2 * MIN; t <= FAIL_AT + 20 * MIN; t += MIN) await sweep(t);
    expect(feed(r.coord).map((f) => f.title)).toEqual(['Anthropic is returning errors']);
    seedMark(r.home, COORD, { state: 'done', event: 'Stop', failAts: [], turnAt: FAIL_AT + 21 * MIN, stopAt: FAIL_AT + 21 * MIN, at: FAIL_AT + 21 * MIN });
    for (let t = FAIL_AT + 21 * MIN; t <= FAIL_AT + 32 * MIN; t += MIN) await sweep(t);
    expect(feed(r.coord).map((f) => f.title), 'control: it clears once the coordinator reads again').toContain('Anthropic errors have stopped');
  }, 60_000);

  it('a stopped ladder raises none', async () => {
    const r = await rig();
    await three(r);
    at(FAIL_AT + MIN);
    await r.w.sweepStalls([fleetRow(A), fleetRow(B), fleetRow(C)], ['mail-disabled'], tickOf(A, B, C));
    expect(outages(r)).toEqual([]);
  }, 60_000);
});
