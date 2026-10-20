// D-6034 (ARCH-10, #543, step 1): the `ran` arm. Both runners used to forge `code: 1` when the command never ran or the
// link failed, so an agent drop read as a ccd refusal at every site that reads only `ok`. This step adds `ran: false`
// as an ADDITIVE arm at the runner, carries it into `CcdResult`, and the two refusal-classifying lanes the issue names
// read it FIRST. Proven here:
//   - each runner says `ran: false`, with the right reason, exactly where the command never ran (or may not have),
//     and keeps every field it produced before (the forged code, the stderr, the kill halves or their absence);
//   - `ccd()` carries the arm, and a ran answer reaches `CcdResult` with no new key (byte-identical);
//   - `cutShort`, the one reader dispatch's adoption gate rests on, answers what it answered before for every shape;
//   - the expiry executor and the collect executor report `ran: false` as unmeasured and retryable, never as a
//     classified refusal, a box word, a die or a composition error, even when the runner's words spell one.
// FIXTURE HOME ONLY: a scripted runner answers; nothing here reaches a box.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../../agent/src/server.js';
import { AgentOpError, LinkNotSentError, type ConnectedFleet, type FleetClient } from '../src/remote/client.js';
import { createRunner } from '../src/remote/runner.js';
import { realRunner, UNMEASURED, type ExecResult, type Runner } from '../src/exec.js';
import { ccd, cutShort } from '../src/lifecycle.js';
import { CCD_ARGV, ACTOR_FLAGS_CAP, EXPIRE_CAP } from '../src/ccdargv.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { expireArchived, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import { EXPIRE_LANE_LIVE_MARKER } from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import { collectTempRoot } from '../src/coord/collectTempRoot.js';
import { ID as COLLECT_ID, auditDoc as collectAuditDoc, rig as collectRig } from './collectTempRootFixture.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';
import { notRan, ranExit, ranOk } from './helpers/ranFakes.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

// ── the runners ──────────────────────────────────────────────────────────────

describe('the remote runner says ran:false, and why, where the command never ran', () => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;
  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('ACCEPTANCE: a disconnect returns ran:false with reason transport, keeping the forged code and no kill half', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    await agent.close();
    agent = undefined;
    const res = await fleet.runner('tmux', ['has-session', '-t', 'cc-nope']);
    expect(res).toMatchObject({ code: 1, stdout: '', ran: false, reason: 'transport' });
    expect(res.ran === false && res.detail).toBe(res.stderr);
    expect(res).not.toHaveProperty('killed');
    expect(res).not.toHaveProperty('signal');
  });

  it('the agent declining a command (forbidden) is spawn: it started nothing', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    const res = await fleet.runner('rm', ['-rf', '/']);
    expect(res).toMatchObject({ code: 1, stdout: '', stderr: 'forbidden', ran: false, reason: 'spawn', detail: 'forbidden' });
  });

  it('a command that ran carries no ran key: byte-identical to before', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    const res = await fleet.runner('tmux', ['has-session', '-t', 'cc-nope']);
    expect(res).not.toHaveProperty('ran');
    expect(res).not.toHaveProperty('reason');
  });

  it.each<[string, () => Error, string]>([
    ['the client\'s own wait expired', () => new Error('timeout'), 'timeout'],
    ['the socket closed after the send', () => new Error('disconnected'), 'transport'],
    ['an abort after the send', () => new Error('aborted'), 'transport'],
    ['no ready link at the call (never sent)', () => new LinkNotSentError('disconnected'), 'transport'],
    ['a frame never handed to the link, whose words happen to be timeout', () => new LinkNotSentError('timeout'), 'transport'],
    ['the agent declined: forbidden', () => new AgentOpError('forbidden', null), 'spawn'],
    ['the agent declined: an agent word spelled timeout', () => new AgentOpError('timeout', null), 'spawn'],
  ])('%s: reason %s', async (_what, err, reason) => {
    const e = err();
    const client = { request: async () => { throw e; } } as unknown as FleetClient;
    const res = await createRunner(client)('ccd', ['ls']);
    expect(res).toEqual({ code: 1, stdout: '', stderr: e.message, ran: false, reason, detail: e.message });
  });

  it('a thrown non-Error is transport', async () => {
    const client = { request: async () => { throw 'gone'; } } as unknown as FleetClient;
    expect(await createRunner(client)('ccd', ['ls'])).toMatchObject({ code: 1, stderr: 'gone', ran: false, reason: 'transport' });
  });
});

describe('the local runner says ran:false only for a spawn error', () => {
  it('a binary that does not exist is spawn, and both kill halves stay measured as before (cutShort false)', async () => {
    const res = await realRunner(path.join(mkTmp('ccrc-ran-'), 'no-such-binary'), []);
    expect(res).toMatchObject({ code: 1, stdout: '', killed: false, signal: null, ran: false, reason: 'spawn' });
    expect(res.ran === false && res.detail).toContain('ENOENT');
  });

  it('a command that ran and exited 1 carries no ran key', async () => {
    const res = await realRunner('sh', ['-c', 'exit 1']);
    expect(res).toEqual({ code: 1, stdout: '', stderr: '', killed: false, signal: null });
  });
});

// ── the carry into CcdResult ─────────────────────────────────────────────────

describe('ccd() carries the arm, and nothing else moves', () => {
  const cfg = testDeps(mkTmp('ccrc-ran-cfg-')).cfg;
  const via = (r: ExecResult) => ccd(async () => r, cfg, CCD_ARGV.ensure('demo-quiet-dune'));

  it('ran:false reaches CcdResult beside every field it had before, and cutShort still answers UNMEASURED', async () => {
    const res = await via(notRan('transport'));
    expect(res).toEqual({ ok: false, stdout: '', stderr: 'disconnected', killed: UNMEASURED, signal: UNMEASURED,
      ran: false, reason: 'transport', detail: 'disconnected' });
    expect(cutShort(res)).toBe(UNMEASURED);
  });

  it('a local spawn error keeps its measured halves: cutShort false, as before', async () => {
    const res = await via({ code: 1, stdout: '', stderr: 'x', killed: false, signal: null, ran: false, reason: 'spawn', detail: 'x' });
    expect(res).toMatchObject({ ok: false, killed: false, signal: null, ran: false, reason: 'spawn' });
    expect(cutShort(res)).toBe(false);
  });

  it.each<[string, ExecResult]>([
    ['ranOk', ranOk('{}')],
    ['ranExit', ranExit(1, '', 'ccd: refused')],
    ['a bare literal', { code: 1, stdout: '', stderr: 'ccd: refused' }],
  ])('a ran answer (%s) reaches CcdResult with no new key', async (_what, r) => {
    const res = await via(r);
    expect(Object.keys(res).sort()).toEqual(['killed', 'ok', 'signal', 'stderr', 'stdout']);
  });
});

// ── the expiry lane ──────────────────────────────────────────────────────────

const EXP_ID = 'demo-quiet-dune';
const TOK = 'c'.repeat(64);
const ARCH = 1_789_000_000;
const DUE = ARCH + 604_800;
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP] };
const expireAudit = JSON.stringify({ session: EXP_ID, mode: 'expire', archivedAt: ARCH, expiresAt: DUE, alive: false,
  exists: true, reaping: null, sensitive: [], verdict: 'expirable', token: TOK, detail: '' });

const expiryRig = async (answer: { audit: () => ExecResult; verb: () => ExecResult }) => {
  const home = mkTmp('ccrc-ran-expire-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, EXPIRE_LANE_LIVE_MARKER), '');
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return args[0] === 'ws-audit' ? answer.audit() : answer.verb();
  };
  const base = testDeps(home, run);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ExpireArchivedDeps = {
    coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))), cfg: base.cfg, io: base.io,
    runCcd: base.runCcd, fleetState: CAPS, presence: { isVisible: () => false }, notifyLog,
  };
  return { deps, calls, req: { sessionId: EXP_ID, archivedAt: ARCH, expiresAt: DUE } };
};

describe('archivedExpiry: ran:false is unmeasured and retryable, never a classified refusal', () => {
  it.each(['transport', 'timeout', 'spawn'] as const)('the audit not answered (%s) is audit-failed, and no verb is composed', async (reason) => {
    const s = await expiryRig({ audit: () => notRan(reason), verb: () => ranOk('{}') });
    const out = await expireArchived(s.deps, s.req);
    expect(out).toMatchObject({ kind: 'audit-failed' });
    expect(out.kind === 'audit-failed' && out.detail).toContain(`(${reason}: `);
    expect(s.calls.map((c) => c[0])).toEqual(['ws-audit']);
  });

  it.each<[string, string]>([
    ['a box word (flock-unavailable)', 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised'],
    ['a composition die (bad token): never asked again, were it read', 'ccd: bad token'],
    ['a composition die (usage)', 'ccd: usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]'],
    ['the link\'s own word', 'disconnected'],
  ])('the verb not answered, its runner words spelling %s, is failed and resumable', async (_what, words) => {
    const s = await expiryRig({ audit: () => ranOk(expireAudit), verb: () => notRan('transport', words) });
    const out = await expireArchived(s.deps, s.req);
    expect(out).toMatchObject({ kind: 'failed', resumable: true });
    expect(out.kind === 'failed' && out.detail).toContain('(transport: ');
    expect(out.kind === 'failed' && out.detail).toContain('unmeasured');
  });

  it('CONTROL: the same words from a verb that RAN are still read as ccd said them', async () => {
    const s = await expiryRig({ audit: () => ranOk(expireAudit), verb: () => ranExit(1, '', 'ccd: bad token') });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'composition' });
    const f = await expiryRig({ audit: () => ranOk(expireAudit),
      verb: () => ranExit(1, '', 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised') });
    expect(await expireArchived(f.deps, f.req)).toMatchObject({ kind: 'box', word: 'flock-unavailable' });
  });
});

// ── the collect lane ─────────────────────────────────────────────────────────

describe('the collect lane: ran:false is no-document (it may have acted), never a recognised die', () => {
  const job = { id: COLLECT_ID, epoch: 0 };

  it.each<[string, string]>([
    ['bad-token', 'ccd: bad token'],
    ['bad-session-id', 'ccd: bad session id'],
    ['flock-unavailable', 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised'],
  ])('an act not answered, its runner words spelling the %s die, is no-document: the lane keeps the id and the slot', async (_w, words) => {
    const r = collectRig();
    r.answerAct(() => notRan('transport', words));
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted', result: { kind: 'no-document', stderr: words } });
  });

  it('CONTROL: the same words from an act that RAN are the die ccd printed', async () => {
    const r = collectRig();
    r.answerAct(() => ranExit(1, '', 'ccd: bad token'));
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted', result: { kind: 'die', word: 'bad-token' } });
  });

  it.each(['transport', 'timeout', 'spawn'] as const)('an audit not answered (%s) is an audit with no document, never a probe: nothing is composed', async (reason) => {
    const r = collectRig();
    r.answerAudit(() => notRan(reason));
    expect(await collectTempRoot(r.deps, job))
      .toMatchObject({ kind: 'answered', step: 4, why: 'not-collectable', audit: { value: { kind: 'no-document' } } });
    expect(r.attempts.map((a) => a[0])).toEqual(['ws-audit']);
  });

  it('CONTROL: the rig\'s collectable audit still reaches the act', async () => {
    const r = collectRig();
    r.answerAudit(() => ranOk(collectAuditDoc({ witness: r.witness })));
    expect(await collectTempRoot(r.deps, job)).toMatchObject({ kind: 'acted' });
  });
});
