// A whole box-token rotation in process (spec §5, 10.1, 10.2): the real boot,
// holder, driver, claim door and box-token lanes, with a FAKE agent that answers
// `token-sync` by claiming over `app.inject`, writing a fixture fleet home's
// token and generation files, and proving with one `GET /api/ledger`. The real
// verb against loopback is Part B's (token-rotation-real-verb.test.ts). Also the
// link's answer mapping and the generation reader, over fakes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { bootBoxToken, type BootResult } from '../src/token/boot.js';
import { BoxTokenDriver } from '../src/token/driver.js';
import { gateRowsOver, generationReaderOver, tokenSyncLinkOver } from '../src/token/link.js';
import {
  fileBothRoleWriter, fileTokenStore, readRetired, readState, tokenPaths, valueDigestHex, writeFleetTokenFile, writeGenerationFile,
} from '../src/token/files.js';
import {
  CONFIRM_DEADLINE_MS, GRACE_HARD_MS, GRACE_MS, HOLD_REPROBE_MS, STALL_ALERT_MS, TOKEN_FILE_REREAD_MS, type GateNode, type SyncResult,
} from '../src/token/policy.js';
import type { TokenStore, TokenSyncLink } from '../src/token/ports.js';
import { checkMailToken, extractToken } from '../src/coord/token.js';
import { AgentOpError, LinkNotSentError } from '../src/remote/client.js';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { TOKEN_SYNC_OP_TIMEOUT_MS } from '../../shared/agent-protocol.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NODE = '11111111-2222-4333-8444-555555555555';
const HDR = ['x', 'ccrc', 'mail', 'token'].join('-');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

afterEach(() => { vi.restoreAllMocks(); });

const fleetRow = (over: Partial<GateNode> = {}): GateNode => ({
  nodeId: NODE, nodeIdMeasured: true, label: 'fleet', role: 'fleet', reachable: true, os: 'linux',
  caps: ['token-sync'], agentOps: ['update', 'token-sync'], updateState: 'idle', reportedPhase: null, ...over,
});

interface Rig {
  home: string; fleetHome: string; app: FastifyInstance; driver: BoxTokenDriver; boot: BootResult;
  agent: FakeAgent; clock: { offset: number; step: number }; rows: { row: GateNode; linkUp: boolean; readyAt: number };
  printed: string[]; lane(value: string): Promise<number>; fleetValue(): string | null;
}
type Mode = 'normal' | 'lose-result' | 'replay' | 'verb-missing' | 'claim-only';
interface FakeAgent extends TokenSyncLink { mode: Mode; calls: number; codes: string[] }

/** The fake agent: claim over inject, write the fleet files, prove once, answer like the verb would. */
function fakeAgent(appRef: () => FastifyInstance, fleetHome: string): FakeAgent {
  const fleetFile = path.join(fleetHome, '.cc-secrets', 'ccrc-mail.token');
  const genFile = path.join(fleetHome, '.ccrc', 'box-token-generation');
  const agent: FakeAgent = {
    mode: 'normal', calls: 0, codes: [],
    async send(code: string): Promise<SyncResult> {
      agent.calls++;
      agent.codes.push(code);
      if (agent.mode === 'verb-missing') return { kind: 'refused', word: 'spawn-failed', detail: 'ccrc: unknown argument: token' };
      const app = appRef();
      const claim = await app.inject({ method: 'POST', url: '/api/token/claim', payload: { code, nodeId: NODE } });
      if (claim.statusCode === 410 && claim.json().error === 'code-used') return { kind: 'refused', word: 'code-used', detail: null };
      if (claim.statusCode !== 200) return { kind: 'refused', word: 'claim-refused', detail: null };
      if (agent.mode === 'replay') {
        const again = await app.inject({ method: 'POST', url: '/api/token/claim', payload: { code, nodeId: NODE } });
        expect([again.statusCode, again.json().error]).toEqual([410, 'code-used']);
      }
      // `claim-only` (plan assembly): someone claims first and the op is lost before the fleet writes anything.
      if (agent.mode === 'claim-only') return { kind: 'lost', why: 'timeout' };
      const { value, generation } = claim.json() as { value: string; generation: string };
      await writeFleetTokenFile(fleetFile, value);
      await writeGenerationFile(genFile, generation);
      const proof = await app.inject({ method: 'GET', url: '/api/ledger', headers: { [HDR]: value } });
      if (proof.statusCode === 401) return { kind: 'refused', word: 'proof-failed', detail: null };
      if (proof.statusCode !== 400) return { kind: 'refused', word: 'proof-unmeasured', detail: null };
      if (agent.mode === 'lose-result') return { kind: 'lost', why: 'timeout' };
      return { kind: 'synced', generation, transport: 'https' };
    },
  };
  return agent;
}

async function rig(opts: { home?: string; fleetHome?: string; handMade?: string | null; wrap?: (s: TokenStore) => TokenStore;
  lockDirForBoot?: boolean; link?: TokenSyncLink; mutateBoot?: (b: BootResult) => BootResult } = {}): Promise<Rig> {
  const home = opts.home ?? mkTmp('ccrc-token-e2e-');
  const fleetHome = opts.fleetHome ?? mkTmp('ccrc-token-e2e-fleet-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  mkdirSync(path.join(fleetHome, '.ccrc'), { recursive: true });
  const paths = tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
  if (opts.handMade) writeFileSync(paths.current, `${opts.handMade}\n`, { mode: 0o600 });
  const printed: string[] = [];
  for (const m of ['warn', 'log', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a) => { printed.push(a.join(' ')); });
  // `step` (A9): every reading advances by one more ms, so two readings in one tick never agree (D-4407's test).
  const clock = { offset: 0, step: 0 };
  let reads = 0;
  const now = (): number => Date.now() + clock.offset + (clock.step > 0 ? (reads += clock.step) : 0);
  // `lockDirForBoot` (plan assembly): the boot mint fails (EACCES), as token-boot.test.ts's failed-mint case; the
  // directory is writable again before the driver's first tick, so its mint retry can succeed.
  if (opts.lockDirForBoot) chmodSync(path.join(home, '.ccrc'), 0o500);
  let boot: BootResult;
  try {
    boot = await bootBoxToken({ mailTokenPath: paths.current, home, role: 'server', roleSource: 'recorded', fleetMode: 'remote', now: now() });
  } finally { if (opts.lockDirForBoot) chmodSync(path.join(home, '.ccrc'), 0o700); }
  printed.push(...boot.warnings);
  if (opts.mutateBoot) boot = opts.mutateBoot(boot);
  const rows = { row: fleetRow(), linkUp: true, readyAt: 1 };
  let app: FastifyInstance | null = null;
  const agent = fakeAgent(() => app as FastifyInstance, fleetHome);
  const driver = new BoxTokenDriver({
    store: (opts.wrap ?? ((x) => x))(fileTokenStore(paths)), holder: boot.holder, link: opts.link ?? agent,
    generation: generationReaderOver(localIO, path.join(fleetHome, '.ccrc'), now),
    rows: { nodes: () => [rows.row], linkUp: () => rows.linkUp, lastReadyAt: () => rows.readyAt },
    env: { fleetMode: 'remote', role: 'server', roleSource: 'recorded', agentEnvMarksFleet: false },
    bothWriter: null, now, warn: (l) => printed.push(l),
  }, boot);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  app = await buildServer({ ...testDeps(home), mailToken: boot.holder, coord, tokenDriver: driver }, new Bus());
  const fleetFile = path.join(fleetHome, '.cc-secrets', 'ccrc-mail.token');
  return {
    home, fleetHome, app, driver, boot, agent, clock, rows, printed,
    lane: async (value) => (await app.inject({ method: 'GET', url: '/api/ledger', headers: { [HDR]: value } })).statusCode,
    fleetValue: () => (existsSync(fleetFile) ? extractToken(readFileSync(fleetFile, 'utf8')) : null),
  };
}
const genOf = (fleetHome: string): string => readFileSync(path.join(fleetHome, '.ccrc', 'box-token-generation'), 'utf8').trim();

describe('a whole rotation', () => {
  it('adopted value -> staged, handed out, confirmed by the op result, promoted; grace; retired once presented', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    try {
      expect(r.driver.view()).toMatchObject({ origin: 'adopted', rotationOwed: true, phase: 'idle' });
      await r.driver.tick();
      const fresh = r.fleetValue() as string;
      expect(fresh).not.toBe(leaked);
      expect(r.boot.holder.currentValue()).toBe(fresh);
      expect(await r.lane(fresh)).toBe(400);                          // accepted (400 = query missing)
      expect(await r.lane(leaked)).toBe(400);                         // still accepted: grace
      const s = await readState(tokenPaths(path.join(r.home, '.ccrc', 'mail.token'), r.home).state);
      expect(s.kind === 'state' && [s.state.origin, s.state.rotationOwed, s.state.current.id]).toEqual(['rotated', false, genOf(r.fleetHome)]);
      expect(r.driver.view()).toMatchObject({ phase: 'grace', fleetConfirmed: 'current', fleetTransport: 'https', lastSync: { word: 'synced' } });
      // F10 (spec 7.1): the real claim door's hand-out line carries the outcome's word and the node id.
      expect(r.printed.filter((l) => l.includes('claim door handed-out')), 'one hand-out line').toEqual([
        `ccrc-server: box token: claim door handed-out: generation #${s.kind === 'state' ? s.state.current.seq : '?'} handed out to node ${NODE}`]);
      // past grace, after the new value was presented (the lane call above): retired, and refused for good
      r.clock.offset = GRACE_MS + 1000;
      await r.driver.tick();
      expect(await r.lane(leaked)).toBe(401);
      expect(r.driver.view()).toMatchObject({ phase: 'idle', retiredRefused: true, retiredPresented: 1 });
      expect(existsSync(path.join(r.home, '.ccrc', 'mail-previous.token'))).toBe(false);
      expect(await r.lane(fresh)).toBe(400);
      expect(r.agent.calls).toBe(1);
    } finally { await r.app.close(); }
  });

  it('nothing printed: no value, code or digest in any log line across a rotation', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
    try {
      await r.driver.tick();
      r.clock.offset = GRACE_MS + 1000;
      await r.lane(r.fleetValue() as string);
      await r.driver.tick();
    } finally { vi.mocked(process.stdout.write).mockRestore(); vi.mocked(process.stderr.write).mockRestore(); await r.app.close(); }
    const text = [...r.printed, ...out, JSON.stringify(r.driver.view())].join('\n');
    expect(r.printed.length).toBeGreaterThan(0);
    for (const secret of [leaked, r.fleetValue() as string, ...r.agent.codes]) {
      expect(text.includes(secret)).toBe(false);
      expect(text.includes(valueDigestHex(secret))).toBe(false);
    }
  });
});

describe('a lost result after the fleet wrote the file (review focus 1)', () => {
  it('the handed-out value stays accepted, is never promoted on its presentation, and a later generation read confirms it', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    try {
      r.agent.mode = 'lose-result';
      await r.driver.tick();
      const g = r.fleetValue() as string;
      expect(r.driver.view()).toMatchObject({ phase: 'handed-out', lastFailure: 'timeout', failures: 1 });
      expect(r.boot.holder.currentValue()).toBe(leaked);              // not promoted
      expect(await r.lane(g)).toBe(400);                              // the fleet sees no 401
      expect(await r.lane(g)).toBe(400);
      expect(r.boot.holder.currentValue()).toBe(leaked);              // presentation promoted nothing
      r.agent.mode = 'normal';
      await r.driver.tick();                                          // reads box-token-generation, measured after the hand-out
      expect(r.boot.holder.currentValue()).toBe(g);
      expect(r.agent.calls).toBe(1);                                  // confirmed without a second sync
      expect(await r.lane(leaked)).toBe(400);                         // previous, in grace
    } finally { await r.app.close(); }
  });
});

describe('a door-side replay discards nothing', () => {
  it('claim 200, replay 410 code-used, and the value is still promoted', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.agent.mode = 'replay';
      await r.driver.tick();
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
      expect(r.driver.view().origin).toBe('rotated');
    } finally { await r.app.close(); }
  });
});

describe('one rotation at a time', () => {
  it('an owed rotation, "Rotate now" and a second tick at once produce one generation', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      const now = Date.now();
      const [, answer] = await Promise.all([r.driver.tick(), r.driver.rotateNow(now), r.driver.tick()]);
      await r.driver.tick();
      expect(answer.ok && answer.outcome).toMatch(/started|joined/);
      expect(r.agent.calls).toBe(1);
      expect(r.driver.view().currentSeq).toBe(2);
    } finally { await r.app.close(); }
  });
});

describe('mixed versions and named holds', () => {
  it('an agent whose ready lacks token-sync is never sent the op; the old value stays current', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.rows.row = fleetRow({ agentOps: ['update'] });
      await r.driver.tick();
      expect(r.agent.calls).toBe(0);
      expect(r.driver.view()).toMatchObject({ phase: 'held', hold: 'agent-predates-op', holdNode: 'fleet' });
      expect(r.boot.holder.currentValue()).toBe('e'.repeat(64));
    } finally { await r.app.close(); }
  });

  it('a ccrc without the verb is the named hold verb-missing, not a failure, re-probed on a fresh ready (D-4395)', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.agent.mode = 'verb-missing';
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ hold: null, failures: 0 });
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ phase: 'held', hold: 'verb-missing', failures: 0, banner: false });
      expect(r.agent.calls).toBe(1);                                 // held: no second send
      r.agent.mode = 'normal';
      r.rows.readyAt = Date.now() + 10;                              // a fresh ready re-probes at once
      await r.driver.tick();
      expect(r.agent.calls).toBe(2);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
    } finally { await r.app.close(); }
  });
});

describe('resync after a write-back (review focus 3)', () => {
  it('the written-back value answers 401 and is counted; the fleet is resynced through the code path', async () => {
    const leaked = 'e'.repeat(64);
    const first = await rig({ handMade: leaked });
    await first.driver.tick();
    first.clock.offset = GRACE_MS + 1000;
    await first.lane(first.fleetValue() as string);
    await first.driver.tick();                                       // leaked value retired
    await first.app.close();
    const tok = path.join(first.home, '.ccrc', 'mail.token');
    rmSync(tok);
    writeFileSync(tok, `# an older deploy.sh shipped this\n${leaked}\n`, { mode: 0o600 });
    const r = await rig({ home: first.home, fleetHome: first.fleetHome });
    try {
      expect(r.driver.view()).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
      expect(await r.lane(leaked)).toBe(401);
      expect(r.boot.holder.counters().retired).toBe(1);
      await r.driver.tick();                                         // the claim needs no box token
      expect(r.fleetValue()).toBe(r.boot.holder.currentValue());
      expect(await r.lane(r.fleetValue() as string)).toBe(400);
      expect(await r.lane(leaked)).toBe(401);
    } finally { await r.app.close(); }
  });
});

describe('the hand-out is recorded before the 200 (D-4394)', () => {
  it('a hand-out that cannot be recorded answers 503, is never handed out, and the old value stays current', async () => {
    let failNext = true;
    const r = await rig({ handMade: 'e'.repeat(64), wrap: (st) => ({ ...st, writeState: async (s) => {
      if (failNext && s.pending.some((p) => p.handedOutAt !== null)) { failNext = false; throw Object.assign(new Error('injected'), { code: 'ENOSPC' }); }
      return st.writeState(s);
    } }) });
    try {
      await r.driver.tick();
      expect(r.fleetValue()).toBeNull();                               // the fleet never received a value
      expect(r.driver.view()).toMatchObject({ origin: 'adopted', rotationOwed: true, phase: 'idle' });
      expect(r.boot.holder.currentValue()).toBe('e'.repeat(64));
      const st = await readState(tokenPaths(path.join(r.home, '.ccrc', 'mail.token'), r.home).state);
      expect(st.kind === 'state' && st.state.pending).toEqual([]);
      expect(readdirSync(path.join(r.home, '.ccrc')).filter((n) => n.startsWith('mail-pending-'))).toEqual([]);
    } finally { await r.app.close(); }
  });
});

// ── added at plan assembly (review findings); not prototyped, so each is run red first against its mutation ──

describe('a fresh two-box install (review: critical)', () => {
  it('fresh server, no fleet file: one tick later the fleet file holds an accepted value and the view says fleetConfirmed current', async () => {
    const r = await rig();
    try {
      expect(r.fleetValue()).toBeNull();
      expect(r.driver.view()).toMatchObject({ origin: 'minted', rotationOwed: false });
      await r.driver.tick();                                          // the absent fleet generation reads behind
      const v = r.fleetValue() as string;
      expect(v).toBe(r.boot.holder.currentValue());
      expect(await r.lane(v)).toBe(400);
      expect(r.driver.view()).toMatchObject({ origin: 'rotated', fleetConfirmed: 'current' });
      expect(r.agent.calls).toBe(1);
    } finally { await r.app.close(); }
  });
});

describe('Rotate now: its rate limit and its hold (review: driver guards)', () => {
  it('twice within a minute on an idle state: the second answers rate-limited with a positive retryAfterS', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      const t = Date.now();
      const first = await r.driver.rotateNow(t);
      await r.driver.tick();                                          // joins the tick rotateNow started
      expect(first).toMatchObject({ ok: true, outcome: 'started' });
      expect(r.driver.view().phase).toBe('grace');                   // the rotation completed: nothing pending
      const second = await r.driver.rotateNow(t + 1000);
      expect(second.ok).toBe(false);
      expect(!second.ok && second.error).toBe('rate-limited');
      expect(!second.ok && second.error === 'rate-limited' && second.retryAfterS).toBeGreaterThan(0);
      expect(r.agent.calls).toBe(1);
    } finally { await r.app.close(); }
  });

  it('on a closed gate it answers held with the hold word and its node, and sends nothing', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.rows.row = fleetRow({ agentOps: ['update'] });
      const a = await r.driver.rotateNow(Date.now());
      expect(a).toMatchObject({ ok: false, error: 'held', hold: 'agent-predates-op', node: 'fleet' });
      await r.driver.tick();
      expect(r.agent.calls).toBe(0);
    } finally { await r.app.close(); }
  });
});

describe('F1 (review 362): the view never claims a current value the holder does not hold', () => {
  it.skipIf(isRoot)('a box with history whose boot mint fails: no current generation, no fleet confirmation of it', async () => {
    const first = await rig({ handMade: 'e'.repeat(64) });
    await first.driver.tick();                                                   // rotated: generation #2, the fleet confirmed it
    expect(first.driver.view()).toMatchObject({ currentSeq: 2, fleetConfirmed: 'current' });
    await first.app.close();
    const dir = path.join(first.home, '.ccrc');
    rmSync(path.join(dir, 'mail.token'));
    rmSync(path.join(dir, 'mail-previous.token'), { force: true });
    const r = await rig({ home: first.home, fleetHome: first.fleetHome, lockDirForBoot: true });   // ~/.ccrc unwritable at boot (EACCES)
    try {
      expect(r.boot.mintFailed).toBe(true);
      expect(r.boot.holder.hasCurrent()).toBe(false);
      const v = r.driver.view();
      expect(v).toMatchObject({ phase: 'unconfigured', stalled: { why: 'mint-failed' }, currentSeq: null, currentSince: null });
      expect(['current', 'own-write'], 'the fleet confirmed a generation the holder does not hold').not.toContain(v.fleetConfirmed);
      expect(v.fleetConfirmed).toBe('unknown');
    } finally { await r.app.close(); }
  });
});

describe('a failed boot mint is retried (spec 10.1, review: driver guards)', () => {
  it.skipIf(isRoot)('boot mints nothing, every lane refuses, the stall alert names mint-failed; one tick later a lane answers ok', async () => {
    const r = await rig({ lockDirForBoot: true });
    try {
      expect(r.boot.mintFailed).toBe(true);
      expect(r.boot.holder.hasCurrent()).toBe(false);
      expect(r.driver.view().stalled).toMatchObject({ why: 'mint-failed' });
      await r.driver.tick();
      expect(r.boot.holder.hasCurrent()).toBe(true);
      expect(await r.lane(r.boot.holder.currentValue() as string)).toBe(400);
      expect(r.driver.view()).toMatchObject({ stalled: null, lastFailure: null });
      expect(r.printed.join('\n')).toMatch(/minted a new value at .* after a failed mint/);
    } finally { await r.app.close(); }
  });
});

describe('a handed-out value unaccounted for (spec §5.1, §6 "Someone claims first")', () => {
  it('past confirmBy it is warned once, and the forward rotation that follows discards it', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.agent.mode = 'claim-only';
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ phase: 'handed-out' });
      expect(r.fleetValue()).toBeNull();
      r.agent.mode = 'normal';
      r.clock.offset = CONFIRM_DEADLINE_MS + 1000;
      await r.driver.tick();
      await r.driver.tick();
      const alerts = r.printed.filter((l) => /a handed-out value is unaccounted for \(generation #\d+\)/.test(l));
      expect(alerts).toHaveLength(1);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
      expect(r.driver.view()).toMatchObject({ origin: 'rotated' });
    } finally { await r.app.close(); }
  });
});

describe('the stall alert (review: the downside of doctor arms off)', () => {
  it('a rotation owed and held past STALL_ALERT_MS raises the stall alert; before that it does not', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.rows.row = fleetRow({ agentOps: ['update'] });
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ phase: 'held', rotationOwed: true, stalled: null, banner: false });
      r.clock.offset = STALL_ALERT_MS + 1000;
      await r.driver.tick();
      expect(r.driver.view().stalled).toMatchObject({ why: 'owed' });
      expect(r.driver.view().failures).toBe(0);                       // a hold is never a failure: the banner alone would stay dark
    } finally { await r.app.close(); }
  });
});

describe('the run-time re-read (spec 4.2, §6 "A token file broken on re-read")', () => {
  it('mail.token truncated at run time: lanes stay ok, one warning, fileProblem recorded', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    const paths = tokenPaths(path.join(r.home, '.ccrc', 'mail.token'), r.home);
    try {
      r.rows.row = fleetRow({ agentOps: ['update'] });               // held: no rotation rewrites the file
      truncateSync(paths.current, 0);
      await r.driver.tick();
      expect(await r.lane(leaked)).toBe(400);                         // the last good value is kept
      expect(r.driver.view().fileProblem).toMatchObject({ file: 'current', word: 'unusable' });
      r.clock.offset = TOKEN_FILE_REREAD_MS + 1000;
      await r.driver.tick();
      expect(r.printed.filter((l) => l.includes(`${paths.current} carries no usable value on re-read`))).toHaveLength(1);
      const st = await readState(paths.state);
      expect(st.kind === 'state' && st.state.fileProblem?.word).toBe('unusable');
    } finally { await r.app.close(); }
  });

  it('a retired value written into mail.token at run time: still refused, warned, never adopted', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    const paths = tokenPaths(path.join(r.home, '.ccrc', 'mail.token'), r.home);
    try {
      await r.driver.tick();                                          // rotate
      const fresh = r.fleetValue() as string;
      r.clock.offset = GRACE_MS + 1000;
      await r.lane(fresh);
      await r.driver.tick();                                          // the leaked value retired
      writeFileSync(paths.current, `${leaked}\n`, { mode: 0o600 });  // an older deploy.sh ships it back
      r.clock.offset = TOKEN_FILE_REREAD_MS + 2000;
      await r.driver.tick();
      expect(await r.lane(leaked)).toBe(401);
      expect(r.boot.holder.currentValue()).toBe(fresh);
      expect(await r.lane(fresh)).toBe(400);
      expect(r.driver.view().fileProblem).toMatchObject({ file: 'current', word: 'retired' });
      expect(r.printed.some((l) => l.includes(`${paths.current} holds a retired value on re-read`))).toBe(true);
    } finally { await r.app.close(); }
  });
});

describe('tokenSyncLinkOver maps every answer to one SyncResult', () => {
  const G = '0123456789abcdef';
  const over = (impl: () => Promise<unknown>) => {
    const request = vi.fn(impl);
    return { link: tokenSyncLinkOver({ request } as never), request };
  };
  it('sends only the code, with the op\'s own deadline', async () => {
    const { link, request } = over(async () => ({ t: 'res', id: 1, ok: true, synced: G, transport: 'http' }));
    expect(await link.send('c'.repeat(43))).toEqual({ kind: 'synced', generation: G, transport: 'http' });
    expect(request).toHaveBeenCalledWith({ t: 'req', op: 'token-sync', code: 'c'.repeat(43) }, TOKEN_SYNC_OP_TIMEOUT_MS);
  });
  it.each<[string, () => Promise<unknown>, SyncResult]>([
    ['no transport reads unmeasured', async () => ({ ok: true, synced: G }), { kind: 'synced', generation: G, transport: 'unmeasured' }],
    ['a malformed synced is refused, never synced', async () => ({ ok: true, synced: 'G' }), { kind: 'refused', word: 'spawn-failed', detail: 'the agent answered ok without a generation id' }],
    ['bad-request: the agent predates the op', async () => { throw new AgentOpError('bad-request', null); }, { kind: 'predates-op' }],
    ['a token-sync word', async () => { throw new AgentOpError('stale-client', 'x'); }, { kind: 'refused', word: 'stale-client', detail: 'x' }],
    ['another agent word', async () => { throw new AgentOpError('weird', null); }, { kind: 'refused', word: 'spawn-failed', detail: 'weird' }],
    ['never sent', async () => { throw new LinkNotSentError('disconnected'); }, { kind: 'unsent' }],
    ['timeout after the send', async () => { throw new Error('timeout'); }, { kind: 'lost', why: 'timeout' }],
    ['disconnected after the send', async () => { throw new Error('disconnected'); }, { kind: 'lost', why: 'disconnected' }],
  ])('%s', async (_n, impl, want) => {
    expect(await over(impl).link.send('c'.repeat(43))).toEqual(want);
  });
});

describe('generationReaderOver', () => {
  it('reads absent, an id, and malformed as unreadable; measuredAt is taken after the read resolves', async () => {
    const dir = mkTmp('ccrc-token-gen-');
    let t = 100;
    const order: string[] = [];
    const io: FleetIO = { ...localIO, lstatMeasured: async (p) => { order.push('lstat'); return localIO.lstatMeasured(p); } };
    const reader = generationReaderOver(io, dir, () => { order.push('now'); return ++t; });
    expect((await reader.read()).read).toEqual({ kind: 'absent' });
    writeFileSync(path.join(dir, 'box-token-generation'), '0123456789abcdef\n');
    order.length = 0;
    expect(await reader.read()).toEqual({ read: { kind: 'id', id: '0123456789abcdef' }, measuredAt: 102 });
    expect(order).toEqual(['lstat', 'now']);
    writeFileSync(path.join(dir, 'box-token-generation'), 'nope\n');
    expect((await reader.read()).read).toEqual({ kind: 'unreadable' });
  });
});

describe('gateRowsOver', () => {
  it('maps live node rows to the gate\'s shape, measuring the node id with the store\'s own rule; no coord is null', () => {
    const row = { nodeId: NODE, role: 'fleet', label: 'fleet', reachable: true, os: 'linux', caps: ['token-sync'],
      agentOps: ['update', 'token-sync'], updateState: 'idle', reportedPhase: null } as never;
    const placeholder = { ...(row as object), nodeId: 'fleet' } as never;
    const src = gateRowsOver({ nodes: () => [row, placeholder] }, () => true, () => 7);
    expect(src.nodes()).toEqual([fleetRow(), fleetRow({ nodeId: 'fleet', nodeIdMeasured: false })]);
    expect([src.linkUp(), src.lastReadyAt()]).toEqual([true, 7]);
    expect(gateRowsOver(null, () => false, () => null).nodes()).toBeNull();
  });
});

// ── added at A9 (controller rulings D-4400, D-4406, D-4407 and the preflight carries); each run red first ──

const eio = (): Error => Object.assign(new Error('injected'), { code: 'EIO' });
const tokPaths = (r: Rig) => tokenPaths(path.join(r.home, '.ccrc', 'mail.token'), r.home);
const pendingFiles = (r: Rig): string[] => readdirSync(path.join(r.home, '.ccrc')).filter((n) => n.startsWith('mail-pending-'));
const onDisk = async (r: Rig) => {
  const st = await readState(tokPaths(r).state);
  if (st.kind !== 'state') throw new Error('no state on disk');
  return st.state;
};

describe('LIVE SAFETY: part A alone rotates nothing on a fleet whose ccrc has no token verb (D-4395)', () => {
  it('verb-missing through the real link mapping: a named hold, never a failure; nothing promoted; re-probed only on a fresh ready or after HOLD_REPROBE_MS', async () => {
    const leaked = 'e'.repeat(64);
    let sends = 0;
    // What the agent answers when the spawned `ccrc` is the one on a fleet box today: no `token` verb.
    const link = tokenSyncLinkOver({ request: async () => { sends++; throw new AgentOpError('spawn-failed', 'ccrc: unknown argument: token'); } } as never);
    const r = await rig({ handMade: leaked, link });
    try {
      await r.driver.tick();
      expect(sends).toBe(1);
      expect(r.driver.view()).toMatchObject({ hold: null, failures: 0, lastFailure: null });   // learned, not yet a held phase
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ phase: 'held', hold: 'verb-missing', failures: 0, lastFailure: null, banner: false,
        origin: 'adopted', rotationOwed: true, lastSync: { word: 'spawn-failed' } });
      // Part B's doctor reads `held:<hold>` from this file, so the hold must be on disk, not only in memory (D-4409)
      expect(await onDisk(r)).toMatchObject({ hold: 'verb-missing', holdNode: 'fleet' });
      // no storm: ten more ticks, five minutes apart, send nothing
      for (let i = 1; i <= 10; i++) { r.clock.offset = i * 5 * 60_000; await r.driver.tick(); }
      expect(sends).toBe(1);
      // a fresh ready re-probes once, and the hold stands again
      r.rows.readyAt = Date.now() + 10;
      await r.driver.tick();
      expect(sends).toBe(2);
      await r.driver.tick();
      await r.driver.tick();
      expect(sends).toBe(2);
      expect(r.driver.view()).toMatchObject({ phase: 'held', hold: 'verb-missing', failures: 0 });
      // and the hourly re-probe, once
      r.clock.offset = 50 * 60_000 + HOLD_REPROBE_MS + 1000;
      await r.driver.tick();
      await r.driver.tick();
      expect(sends).toBe(3);
      // nothing rotated: same value, same origin, no pending value anywhere, no fleet file, no promotion on disk or in memory
      expect(r.boot.holder.currentValue()).toBe(leaked);
      expect(await r.lane(leaked)).toBe(400);
      expect(r.fleetValue()).toBeNull();
      expect(pendingFiles(r)).toEqual([]);
      expect(await onDisk(r)).toMatchObject({ origin: 'adopted', pending: [], previous: null, promoting: null, failures: 0, rotationOwed: true });
      expect(r.driver.view()).toMatchObject({ origin: 'adopted', lastRotationAt: null, fleetConfirmed: 'absent' });
      const text = [...r.printed, JSON.stringify(r.driver.view())].join('\n');
      expect(text.includes(leaked) || text.includes(valueDigestHex(leaked))).toBe(false);
      expect(r.printed.some((l) => l.includes('held: verb-missing'))).toBe(true);
    } finally { await r.app.close(); }
  });
});

describe('LIVE SAFETY, the gate arm: caps were read and lack token-sync', () => {
  it('the gate holds verb-missing before any send: no op, no staged value, no failure, the old value stays current', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    try {
      r.rows.row = fleetRow({ caps: ['update'] });
      for (let i = 0; i < 3; i++) await r.driver.tick();
      expect(r.agent.calls).toBe(0);
      expect(r.driver.view()).toMatchObject({ phase: 'held', hold: 'verb-missing', holdNode: 'fleet', failures: 0, origin: 'adopted' });
      expect(r.boot.holder.currentValue()).toBe(leaked);
      expect(pendingFiles(r)).toEqual([]);
      expect(r.fleetValue()).toBeNull();
    } finally { await r.app.close(); }
  });
});

describe('promotion keeps a LATER handed-out value accepted (D-4400)', () => {
  it('G1 confirmed by a generation read while G2 is handed out: G2, its file and its slot stay, and its own confirmation promotes it', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    const genFile = path.join(r.fleetHome, '.ccrc', 'box-token-generation');
    try {
      r.agent.mode = 'lose-result';
      await r.driver.tick();                                           // G1 handed out, the fleet wrote it, the result was lost
      const g1 = genOf(r.fleetHome);
      const g1v = r.fleetValue() as string;
      rmSync(genFile);                                                  // the next tick reads the fleet generation as absent
      r.agent.mode = 'claim-only';
      r.clock.offset = CONFIRM_DEADLINE_MS + 1000;
      await r.driver.tick();                                           // past confirmBy: G2 handed out, its result lost too
      const pend = (await onDisk(r)).pending;
      expect(pend.map((p) => p.handedOutAt !== null)).toEqual([true, true]);
      const g2 = pend[1].id;
      const g2v = r.boot.holder.pendingValue(g2) as string;
      writeFileSync(genFile, `${g1}\n`);
      await r.driver.tick();                                           // the read shows G1: G1 promotes, G2 is NOT discarded
      expect(r.boot.holder.currentValue()).toBe(g1v);
      expect(r.boot.holder.pendingValue(g2)).toBe(g2v);
      expect(await r.lane(g2v)).toBe(400);
      expect(existsSync(tokPaths(r).pending(g2))).toBe(true);
      expect((await onDisk(r)).pending.map((p) => p.id)).toEqual([g2]);
      writeFileSync(genFile, `${g2}\n`);
      await r.driver.tick();                                           // G2's own confirmation promotes it normally
      expect(r.boot.holder.currentValue()).toBe(g2v);
      expect(pendingFiles(r)).toEqual([]);
    } finally { await r.app.close(); }
  });
});

describe('a promotion naming a generation that is no longer pending (driver guard)', () => {
  it('clears the persisted promoting, owes a rotation, warns once and promotes nothing; no tick failure', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked, mutateBoot: (b) => ({ ...b, state: { ...(b.state as NonNullable<BootResult['state']>), promoting: { id: '0123456789abcdef' } } }) });
    try {
      await r.driver.tick();
      expect(r.printed.filter((l) => l.includes('a promotion named no pending value'))).toHaveLength(1);
      expect(r.printed.some((l) => l.includes('a driver tick failed'))).toBe(false);
      expect(await onDisk(r)).toMatchObject({ promoting: null, rotationOwed: true });
      expect(r.boot.holder.currentValue()).toBe(leaked);
      expect(r.agent.calls).toBe(0);
    } finally { await r.app.close(); }
  });
});

describe('a directory-fsync rejection leaves the target unknown, never assumed unchanged (preflight carry)', () => {
  it('promotion: a rename that happened but rejected is re-read, the value is current and the old one stays in grace', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked, wrap: (st) => ({ ...st, renameOver: async (from, to) => { await st.renameOver(from, to); throw eio(); } }) });
    try {
      await r.driver.tick();
      expect(r.printed.some((l) => l.includes('a driver tick failed'))).toBe(false);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
      expect(await r.lane(leaked)).toBe(400);                           // previous, in grace
      expect(r.printed.some((l) => l.includes('could not confirm the directory sync after promoting'))).toBe(true);
      expect(r.driver.view()).toMatchObject({ origin: 'rotated', phase: 'grace' });
    } finally { await r.app.close(); }
  });

  it('staging: a pending file written but rejected is removed; nothing is sent', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked, wrap: (st) => ({ ...st, writeValue: async (p, v) => {
      const rec = await st.writeValue(p, v);
      if (p.includes('mail-pending-')) throw eio();
      return rec;
    } }) });
    try {
      await r.driver.tick();
      expect(pendingFiles(r)).toEqual([]);
      expect(r.agent.calls).toBe(0);
      expect(r.driver.view()).toMatchObject({ failures: 1 });
      expect(r.boot.holder.currentValue()).toBe(leaked);
    } finally { await r.app.close(); }
  });

  it.skipIf(isRoot)('mint retry: a mail.token written but rejected is read back and kept, not retried over', async () => {
    const r = await rig({ lockDirForBoot: true, wrap: (st) => ({ ...st, writeValue: async (p, v) => {
      const rec = await st.writeValue(p, v);
      if (p === st.paths.current) throw eio();
      return rec;
    } }) });
    try {
      expect(r.boot.mintFailed).toBe(true);
      await r.driver.tick();
      expect(r.boot.holder.hasCurrent()).toBe(true);
      expect(await r.lane(r.boot.holder.currentValue() as string)).toBe(400);
      expect(r.driver.view()).toMatchObject({ stalled: null });
      expect(r.printed.some((l) => l.includes('could not confirm the directory sync after writing'))).toBe(true);
    } finally { await r.app.close(); }
  });

  it('hand-out: a state record written but rejected leaves no handed-out record on disk and no pending file (pin)', async () => {
    let failNext = true;
    const r = await rig({ handMade: 'e'.repeat(64), wrap: (st) => ({ ...st, writeState: async (s) => {
      if (failNext && s.pending.some((p) => p.handedOutAt !== null)) { failNext = false; await st.writeState(s); throw eio(); }
      return st.writeState(s);
    } }) });
    try {
      await r.driver.tick();
      expect(r.fleetValue()).toBeNull();
      expect((await onDisk(r)).pending).toEqual([]);
      expect(pendingFiles(r)).toEqual([]);
    } finally { await r.app.close(); }
  });
});

describe('the door\'s alerts are acted on (D-4406)', () => {
  /** A rig whose gate closes the moment a generation is staged: the staged value is left pending and not handed out. */
  async function stagedAndHeld(extra: (st: TokenStore) => Partial<TokenStore> = () => ({})) {
    let rr: Rig | null = null;
    let closeOnStage = false;
    const r = await rig({ handMade: 'e'.repeat(64), wrap: (st) => ({ ...st, ...extra(st), writeState: async (s) => {
      if (closeOnStage && rr !== null && s.pending.length > 0 && s.pending.every((p) => p.handedOutAt === null)) {
        rr.rows.row = fleetRow({ agentOps: ['update'] });
      }
      return st.writeState(s);
    } }) });
    rr = r;
    await r.driver.tick();                                             // the owed rotation completes
    expect(r.driver.view()).toMatchObject({ rotationOwed: false });
    closeOnStage = true;
    await r.driver.rotateNow(Date.now());
    await r.driver.tick();
    const staged = (await onDisk(r)).pending;
    expect(staged).toHaveLength(1);
    expect(staged[0].handedOutAt).toBeNull();
    return { r, id: staged[0].id };
  }

  it.each(['expired', 'wrongNode'] as const)('a burned code (%s) discards its staged generation: slot, state and file; a wrong node also owes claim-misbound', async (kind) => {
    const { r, id } = await stagedAndHeld();
    try {
      expect(r.boot.holder.pendingValue(id)).not.toBeNull();
      r.driver.door.alerts[kind].push(id);
      await r.driver.tick();
      expect(r.boot.holder.pendingValue(id)).toBeNull();
      expect(existsSync(tokPaths(r).pending(id))).toBe(false);
      expect((await onDisk(r)).pending).toEqual([]);
      expect(r.driver.door.alerts[kind]).toEqual([]);
      expect(r.driver.view()).toMatchObject(kind === 'wrongNode' ? { rotationOwed: true, owedWhy: 'claim-misbound' } : { rotationOwed: false });
    } finally { await r.app.close(); }
  });

  // Final review M3 (D-4409 item 7): the value leaves the holder and the state BEFORE its file is deleted.
  it('a staged file that cannot be deleted leaves an orphan file only: the value is out of the holder and out of box-token.json, and the tick survives', async () => {
    let failRemove = false;
    const { r, id } = await stagedAndHeld((st) => ({ removeValue: async (p) => {
      if (failRemove && p.includes('mail-pending-')) throw Object.assign(new Error('injected'), { code: 'EACCES' });
      return st.removeValue(p);
    } }));
    try {
      failRemove = true;
      r.driver.door.alerts.expired.push(id);
      await r.driver.tick();
      expect(r.printed.some((l) => l.includes('a driver tick failed'))).toBe(false);
      expect(r.boot.holder.pendingValue(id)).toBeNull();              // no longer accepted
      expect((await onDisk(r)).pending).toEqual([]);                  // and no longer on record: a restart cannot bring it back
      expect(existsSync(tokPaths(r).pending(id))).toBe(true);         // only an orphan file remains (boot treats it as unverifiable)
      expect(r.printed.some((l) => l.includes('could not delete') && l.includes('EACCES'))).toBe(true);
    } finally { await r.app.close(); }
  });

  it('a HANDED-OUT generation is never dropped by an alert', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.agent.mode = 'claim-only';
      await r.driver.tick();                                           // handed out, result lost
      const id = (await onDisk(r)).pending[0].id;
      r.driver.door.alerts.expired.push(id);
      r.driver.door.alerts.wrongNode.push(id);
      await r.driver.tick();
      expect(r.boot.holder.pendingValue(id)).not.toBeNull();
      expect(existsSync(tokPaths(r).pending(id))).toBe(true);
      expect((await onDisk(r)).pending.map((p) => p.id)).toEqual([id]);
    } finally { await r.app.close(); }
  });
});

describe('the retirement warning tells the truth about the self-check (D-4407)', () => {
  it('grace retirement prints " and is refused" when the retired value is refused, however the clock moves between readings', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    r.clock.step = 1;                                                   // every reading differs from the last
    try {
      await r.driver.tick();
      r.clock.offset = GRACE_MS + 1000;
      await r.lane(r.fleetValue() as string);
      await r.driver.tick();
      expect(await r.lane(leaked)).toBe(401);
      expect(r.driver.view()).toMatchObject({ retiredRefused: true });
      expect(r.printed.some((l) => /grace ended; the previous value was retired and is refused$/.test(l))).toBe(true);
    } finally { await r.app.close(); }
  });
});

describe('the hold is recorded on disk and cleared there (D-4409 item 1)', () => {
  it('a closed gate writes hold and holdNode to box-token.json; a reopened gate writes them back to null', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.rows.row = fleetRow({ agentOps: ['update'] });
      await r.driver.tick();
      expect(await onDisk(r)).toMatchObject({ hold: 'agent-predates-op', holdNode: 'fleet' });
      r.rows.row = fleetRow();
      await r.driver.tick();
      expect(r.driver.view().hold).toBeNull();
      expect(await onDisk(r)).toMatchObject({ hold: null, holdNode: null });
    } finally { await r.app.close(); }
  });
});

describe('a promotion interrupted after its rename (D-4408 items 4 and 5)', () => {
  /** G1 handed out and its result lost, then G2 handed out the same way; G2's id is then the fleet's generation. */
  async function twoHandedOut() {
    const leaked = 'e'.repeat(64);
    let armed = false;
    const r = await rig({ handMade: leaked, wrap: (st) => ({ ...st, removeValue: async (p) => {
      if (armed && p.includes('mail-pending-')) { armed = false; throw Object.assign(new Error('injected'), { code: 'EACCES' }); }
      return st.removeValue(p);
    } }) });
    const genFile = path.join(r.fleetHome, '.ccrc', 'box-token-generation');
    r.agent.mode = 'lose-result';
    await r.driver.tick();
    rmSync(genFile);
    r.agent.mode = 'claim-only';
    r.clock.offset = CONFIRM_DEADLINE_MS + 1000;
    await r.driver.tick();
    const pend = (await onDisk(r)).pending;
    expect(pend).toHaveLength(2);
    const g2 = pend[1].id;
    return { r, leaked, g2, g2v: r.boot.holder.pendingValue(g2) as string, genFile, arm: () => { armed = true; } };
  }

  it('the rename done and a later step failing: the next tick finishes it and the old value stays accepted as previous', async () => {
    const { r, leaked, g2, g2v, genFile, arm } = await twoHandedOut();
    try {
      writeFileSync(genFile, `${g2}\n`);
      arm();                                                           // dropping the earlier sibling's file will fail once
      await r.driver.tick();
      expect(r.printed.some((l) => l.includes('a driver tick failed'))).toBe(true);
      expect(extractToken(readFileSync(tokPaths(r).current, 'utf8'))).toBe(g2v);   // (c) happened
      expect(r.boot.holder.currentValue()).toBe(leaked);               // the swap did not
      await r.driver.tick();
      expect(r.boot.holder.currentValue()).toBe(g2v);
      expect(await r.lane(leaked)).toBe(400);                           // the old value is previous, in grace
      expect(r.driver.view()).toMatchObject({ phase: 'grace', origin: 'rotated' });
      expect((await onDisk(r)).previous).not.toBeNull();
    } finally { await r.app.close(); }
  });

  it('a pending file deleted out of band: mail.token is rewritten from memory with the promoted value, and the record follows it', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    try {
      r.agent.mode = 'lose-result';
      await r.driver.tick();                                           // G handed out, the fleet wrote it, the result was lost
      const g = genOf(r.fleetHome);
      const gv = r.fleetValue() as string;
      rmSync(tokPaths(r).pending(g));                                  // out of band
      await r.driver.tick();                                           // the generation read confirms G
      expect(extractToken(readFileSync(tokPaths(r).current, 'utf8'))).toBe(gv);
      expect(r.boot.holder.currentValue()).toBe(gv);
      expect(await r.lane(leaked)).toBe(400);
      expect(r.printed.some((l) => l.includes('did not carry the promoted value; it was rewritten from memory'))).toBe(true);
      // the recorded write follows the new file, so a restart still proves it server-written
      const st = await onDisk(r);
      const meta = statSync(tokPaths(r).current);
      expect([st.current.write?.dev, st.current.write?.ino]).toEqual([meta.dev, meta.ino]);
    } finally { await r.app.close(); }
  });
});

describe('a presentation of the new value during the promotion commit counts (D-4409 item 2)', () => {
  it('the new current presented while its record is being written is counted as presented', async () => {
    let rr: Rig | null = null;
    let done = false;
    const r = await rig({ handMade: 'e'.repeat(64), wrap: (st) => ({ ...st, writeState: async (s) => {
      if (!done && rr !== null && s.origin === 'rotated' && s.previous !== null) {
        done = true;
        await rr.lane(rr.boot.holder.currentValue() as string);        // the new current is already accepted
      }
      return st.writeState(s);
    } }) });
    rr = r;
    try {
      await r.driver.tick();
      await r.driver.tick();                                           // noteCounters
      expect(done).toBe(true);
      expect((await onDisk(r)).previous?.currentPresented).toBe(true);
    } finally { await r.app.close(); }
  });
});

describe('a mint is never asked of a boot that did not fail one (D-4409 item 3)', () => {
  it('a null state with no failed mint leaves mail.token as it is, warns once, and sends nothing', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked, mutateBoot: (b) => ({ ...b, state: null, mintFailed: false }) });
    try {
      await r.driver.tick();
      await r.driver.tick();
      expect(extractToken(readFileSync(tokPaths(r).current, 'utf8'))).toBe(leaked);
      expect(r.boot.holder.currentValue()).toBe(leaked);
      expect(r.printed.filter((l) => l.includes('a mint was asked for but no mint failed at boot'))).toHaveLength(1);
      expect(r.agent.calls).toBe(0);
    } finally { await r.app.close(); }
  });
});

describe('the hand-out line names the node the code was bound to, and only a well-shaped id (F10)', () => {
  it('a bound id that fails NODE_ID_RE is not printed: the driver re-checks it before the line', async () => {
    const hostile = 'x\nccrc-server: forged line';
    let rr: Rig | null = null;
    // The door can never match a hostile id (a presented id must pass the shape), so the hand-out is recorded directly,
    // for the generation `send` staged and bound to the hostile node: the line is the driver's own.
    const link: TokenSyncLink = { async send() {
      const r = rr as Rig;
      const [g] = (await onDisk(r)).pending;
      await r.driver.commitHandOut(g!.id, Date.now());
      return { kind: 'lost', why: 'disconnected' };
    } };
    const r = await rig({ handMade: 'e'.repeat(64), link });
    rr = r;
    try {
      r.rows.row = fleetRow({ nodeId: hostile });
      await r.driver.tick();
      const lines = r.printed.filter((l) => l.includes('claim door handed-out'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^ccrc-server: box token: claim door handed-out: generation #\d+ handed out$/);
      expect(r.printed.join('\n')).not.toContain('forged');
    } finally { await r.app.close(); }
  });
});

describe('a code never outlives its op (D-4409 item 4)', () => {
  it('a link that rejects still has its code revoked: presenting it afterwards is a miss, not a hand-out', async () => {
    const codes: string[] = [];
    const link: TokenSyncLink = { send: async (code) => { codes.push(code); throw new Error('boom'); } };
    const r = await rig({ handMade: 'e'.repeat(64), link });
    try {
      await r.driver.tick();
      expect(codes).toHaveLength(1);
      const claim = await r.app.inject({ method: 'POST', url: '/api/token/claim', payload: { code: codes[0], nodeId: NODE } });
      expect([claim.statusCode, claim.json().error]).toEqual([404, 'no-claim']);
      expect((await onDisk(r)).pending.every((p) => p.handedOutAt === null)).toBe(true);
    } finally { await r.app.close(); }
  });
});

// ── the final whole-branch review (D-4403 item 2, D-4409 items 5 to 7); each run red first ──

describe('the hand-out lands in memory before its write (D-4409 item 5)', () => {
  /** A rig whose link claims over the door and then loses the op result while the hand-out record is still being
   *  written: the write is held open on a gate that the test releases. */
  async function heldHandOut() {
    let rr: Rig | null = null;
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    let entered: () => void = () => {};
    const enteredP = new Promise<void>((res) => { entered = res; });
    let claim: Promise<{ statusCode: number; json(): { value: string; generation: string } }> | null = null;
    const link: TokenSyncLink = { async send(code) {
      claim = Promise.resolve((rr as Rig).app.inject({ method: 'POST', url: '/api/token/claim', payload: { code, nodeId: NODE } })) as never;
      await enteredP;                                                  // the claim is burned and its record is in flight
      await new Promise((res) => setTimeout(res, 15));
      return { kind: 'lost', why: 'disconnected' };                    // the link drops during that write
    } };
    const r = await rig({ handMade: 'e'.repeat(64), link, wrap: (st) => ({ ...st, writeState: async (s) => {
      if (s.pending.some((p) => p.handedOutAt !== null) && gateOpen.value) { gateOpen.value = false; entered(); await gate; }
      return st.writeState(s);
    } }) });
    rr = r;
    return { r, release, getClaim: () => claim as NonNullable<typeof claim> };
  }
  const gateOpen = { value: true };

  it('a lost op result while the hand-out is being written keeps the value accepted; the 200 carries it; a later generation read promotes it', async () => {
    gateOpen.value = true;
    const { r, release, getClaim } = await heldHandOut();
    try {
      const tick = r.driver.tick();
      await new Promise((res) => setTimeout(res, 40));                // the op result is lost and folded meanwhile
      release();
      await tick;
      const res = await getClaim();
      expect(res.statusCode).toBe(200);
      const { value, generation } = res.json();
      expect(await r.lane(value)).toBe(400);                           // still accepted (400 = query missing): no 401
      expect((await onDisk(r)).pending.map((p) => [p.id, p.handedOutAt !== null])).toEqual([[generation, true]]);
      expect(pendingFiles(r)).toEqual([`mail-pending-${generation}.token`]);
      // The fleet's verb went on: it wrote the value and the generation. A later read naming it promotes it.
      await writeGenerationFile(path.join(r.fleetHome, '.ccrc', 'box-token-generation'), generation);
      r.clock.offset += 1000;
      await r.driver.tick();
      expect(r.boot.holder.currentValue()).toBe(value);
      expect(r.printed.filter((l) => l.includes('a promotion named no pending value'))).toEqual([]);
    } finally { release(); await r.app.close(); }
  });
});

describe('a promotion naming a pending entry with no value drops it, once (D-4409 item 5)', () => {
  it('the entry leaves pending (persisted), one warning, and the next ticks do not repeat it', async () => {
    const ghost = '0123456789abcdef';
    const r = await rig({ handMade: 'e'.repeat(64), mutateBoot: (b) => ({ ...b, state: { ...(b.state as NonNullable<BootResult['state']>),
      rotationOwed: false, owedWhy: null,
      pending: [{ id: ghost, seq: 9, stagedAt: 1, handedOutAt: 1, confirmBy: 1 + CONFIRM_DEADLINE_MS, write: { dev: 0, ino: 0, writtenAtMs: 0 } }] } }) });
    try {
      await writeGenerationFile(path.join(r.fleetHome, '.ccrc', 'box-token-generation'), ghost);
      r.agent.mode = 'verb-missing';                                   // nothing may rotate behind the guard
      for (let i = 0; i < 5; i++) { r.clock.offset += 60_000; await r.driver.tick(); }
      expect(r.printed.filter((l) => l.includes('a promotion named no pending value'))).toHaveLength(1);
      expect((await onDisk(r)).pending.map((p) => p.id)).not.toContain(ghost);
    } finally { await r.app.close(); }
  });
});

describe('an idle both box rotates once, not every grace (D-4409 item 6)', () => {
  it('a recorded both box, adopted value, an hour of idle ticks: exactly one promotion', async () => {
    const home = mkTmp('ccrc-token-e2e-both-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const paths = tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
    writeFileSync(paths.current, `${'a'.repeat(64)}\n`, { mode: 0o600 });
    let off = 0;
    const now = (): number => Date.now() + off;
    const printed: string[] = [];
    const boot = await bootBoxToken({ mailTokenPath: paths.current, home, role: 'both', roleSource: 'recorded', fleetMode: 'local', now: now() });
    const own: GateNode = { nodeId: 'x', nodeIdMeasured: true, label: 'self', role: 'both', reachable: true, os: 'linux',
      caps: ['token-sync'], agentOps: null, updateState: 'idle', reportedPhase: null };
    const driver = new BoxTokenDriver({ store: fileTokenStore(paths), holder: boot.holder, link: null, generation: null,
      rows: { nodes: () => [own], linkUp: () => false, lastReadyAt: () => null },
      env: { fleetMode: 'local', role: 'both', roleSource: 'recorded', agentEnvMarksFleet: false },
      bothWriter: fileBothRoleWriter(paths), now, warn: (l) => printed.push(l) }, boot);
    for (let m = 0; m < 60; m++) { await driver.tick(); off += 60_000; }
    expect(printed.filter((l) => l.includes('and promoted'))).toHaveLength(1);
    expect(printed.some((l) => l.includes('grace extended'))).toBe(false);
    const st = await readState(paths.state);
    expect(st.kind === 'state' && [st.state.previous, st.state.rotationOwed]).toEqual([null, false]);   // retired at grace end
  });

  it('a fleet proof call against the pending value counts as the new current being presented: grace ends with a retirement, not an extension', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    try {
      await r.driver.tick();                                           // the fake agent proves G (a pending-slot match) before promotion
      expect((await onDisk(r)).previous?.currentPresented).toBe(true);
      r.clock.offset = GRACE_MS + 1000;                                // nobody presents the promoted current afterwards
      await r.driver.tick();
      expect(r.printed.some((l) => l.includes('grace extended'))).toBe(false);
      expect(await r.lane(leaked)).toBe(401);
      expect(r.agent.calls).toBe(1);
    } finally { await r.app.close(); }
  });
});

describe('an unreadable retired list is kept in memory at retirement (D-4403 item 2)', () => {
  it('a retired file that cannot be read at grace end: one warning, the tick survives, the previous value is still retired', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    try {
      await r.driver.tick();
      mkdirSync(tokPaths(r).retired);                                  // EISDIR on every read from here on
      r.clock.offset = GRACE_MS + 1000;
      await r.driver.tick();
      expect(r.printed.some((l) => l.includes('a driver tick failed'))).toBe(false);
      expect(r.printed.filter((l) => l.includes('cannot be read (EISDIR); the retired list in memory is kept'))).toHaveLength(1);
      expect(await r.lane(leaked)).toBe(401);                          // out of the accept-set
    } finally { await r.app.close(); }
  });
});

// ── fix round 1, batch 1: D-4413 (the pending cap's exit), F3 (backoff on every route) ────────────────────────
describe('the pending cap has an exit (D-4413)', () => {
  afterEach(() => { vi.useRealTimers(); });
  /** The claim route stamps a hand-out with `Date.now()`, so these tests drive the one clock the route and the driver
   *  share: `Date` is faked after the rig is built (the rig's own offset stays 0) and moved with `at`. */
  function clock(): (ms: number) => void {
    const base = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(base);
    return (ms) => { vi.setSystemTime(base + ms); };
  }
  /** Two hand-outs lost: G1, then (past its confirmBy) G2. Returns their ids and values. */
  async function twoLost(r: Rig, at: (ms: number) => void): Promise<{ ids: string[]; values: string[] }> {
    r.agent.mode = 'claim-only';
    await r.driver.tick();                                             // G1 handed out at 0, its result lost (confirmBy 300 s)
    at(CONFIRM_DEADLINE_MS + 1000);
    await r.driver.tick();                                             // G1 overdue: G2 handed out at 301 s (confirmBy 601 s), result lost
    const pend = (await onDisk(r)).pending;
    expect(pend.map((p) => p.handedOutAt !== null)).toEqual([true, true]);
    const ids = pend.map((p) => p.id);
    return { ids, values: ids.map((id) => r.boot.holder.pendingValue(id) as string) };
  }

  it('after two lost hand-outs the exit rotation runs and confirms, and both older values leave', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    const at = clock();
    try {
      const { ids, values } = await twoLost(r, at);
      expect(r.agent.calls).toBe(2);
      // G2 still waits for its confirmation: no third value is staged (the exit is for BOTH past confirmBy)
      at(CONFIRM_DEADLINE_MS + 2000);
      await r.driver.tick();
      expect(r.agent.calls).toBe(2);
      expect((await onDisk(r)).pending).toHaveLength(2);
      // both are past confirmBy: the exit stages a third value, hands it out, and its confirmation drops the two
      r.agent.mode = 'normal';
      at(2 * CONFIRM_DEADLINE_MS + 2000);
      await r.driver.tick();
      expect(r.agent.calls).toBe(3);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
      expect(r.driver.view()).toMatchObject({ origin: 'rotated', rotationOwed: false, hold: null });
      for (const id of ids) expect(r.boot.holder.pendingValue(id)).toBeNull();
      for (const v of values) expect(await r.lane(v), 'an older lost value is refused once the exit is confirmed').toBe(401);
      expect(await r.lane(leaked)).toBe(400);                           // the previous value stays in grace
      expect((await onDisk(r)).pending).toEqual([]);
      expect(pendingFiles(r)).toEqual([]);
    } finally { await r.app.close(); }
  });

  it('never more than three pending: with the exit\'s own hand-out lost too, the gate holds and no fourth is staged', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    const at = clock();
    try {
      await twoLost(r, at);
      at(2 * CONFIRM_DEADLINE_MS + 2000);
      await r.driver.tick();                                           // the exit: a third value handed out, its result lost
      expect(r.agent.calls).toBe(3);
      expect((await onDisk(r)).pending).toHaveLength(3);
      expect(r.boot.holder.pendingValue((await onDisk(r)).pending[2].id)).not.toBeNull();   // the third holder slot is filled
      for (let i = 1; i <= 4; i++) {
        at((2 + i * 2) * CONFIRM_DEADLINE_MS);
        await r.driver.tick();
        expect((await onDisk(r)).pending, `tick ${i}`).toHaveLength(3);
        expect(r.driver.view()).toMatchObject({ phase: 'held', hold: 'pending-cap' });
      }
      expect(r.agent.calls).toBe(3);
      expect(pendingFiles(r)).toHaveLength(3);
    } finally { await r.app.close(); }
  });

  it('Rotate now at the cap with nothing in flight answers the pending-cap hold, not joined; it starts once the exit is open', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    const at = clock();
    try {
      await twoLost(r, at);
      at(CONFIRM_DEADLINE_MS + 2000);                                   // G2 still waits: the exit is shut
      const held = await r.driver.rotateNow(Date.now());
      expect(held).toMatchObject({ ok: false, error: 'held', hold: 'pending-cap', node: 'fleet' });
      expect(r.agent.calls).toBe(2);
      r.agent.mode = 'normal';
      at(2 * CONFIRM_DEADLINE_MS + 2000);                               // both past confirmBy: the exit is open
      const started = await r.driver.rotateNow(Date.now());
      expect(started).toMatchObject({ ok: true, outcome: 'started' });
      await r.driver.tick();
      expect(r.agent.calls).toBe(3);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
    } finally { await r.app.close(); }
  });

  it('Rotate now with three handed out (the exit spent) also answers the hold', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    const at = clock();
    try {
      await twoLost(r, at);
      at(2 * CONFIRM_DEADLINE_MS + 2000);
      await r.driver.tick();                                           // the exit's hand-out is lost too
      at(6 * CONFIRM_DEADLINE_MS);
      expect(await r.driver.rotateNow(Date.now())).toMatchObject({ ok: false, error: 'held', hold: 'pending-cap' });
    } finally { await r.app.close(); }
  });

  it('at the cap the pending-cap hold answers before the rate limit, within a minute of an earlier press', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    const at = clock();
    try {
      await twoLost(r, at);
      at(2 * CONFIRM_DEADLINE_MS + 2000);
      expect(await r.driver.rotateNow(Date.now())).toMatchObject({ ok: true, outcome: 'started' });
      await r.driver.tick();                                           // the exit's hand-out is lost: three handed out
      expect((await onDisk(r)).pending).toHaveLength(3);
      at(2 * CONFIRM_DEADLINE_MS + 2000 + 5000);                       // five seconds after the press that started it
      expect(await r.driver.rotateNow(Date.now())).toMatchObject({ ok: false, error: 'held', hold: 'pending-cap' });
    } finally { await r.app.close(); }
  });

  it('Rotate now during a confirm wait answers started, not joined: the operator asked for a rotation (ruling letter)', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.agent.mode = 'claim-only';
      await r.driver.tick();                                           // G1 handed out, its result lost: waiting for its confirmation
      expect(await r.driver.rotateNow(Date.now())).toMatchObject({ ok: true, outcome: 'started' });
      await r.driver.tick();
      expect(r.agent.calls, 'it stages nothing while G1 is inside its deadline').toBe(1);
    } finally { await r.app.close(); }
  });

  it('Rotate now answers joined while a send is actually in flight, and starts nothing', async () => {
    let release: (v: SyncResult) => void = () => {};
    let entered: () => void = () => {};
    const inSend = new Promise<void>((res) => { entered = res; });
    const link: TokenSyncLink = { send: () => { entered(); return new Promise<SyncResult>((res) => { release = res; }); } };
    const r = await rig({ handMade: 'e'.repeat(64), link });
    try {
      const tick = r.driver.tick();
      await inSend;
      r.rows.linkUp = false;                                           // the gate shuts under the running send: it is still in flight
      const a = await r.driver.rotateNow(Date.now());
      expect(a).toMatchObject({ ok: true, outcome: 'joined' });
      release({ kind: 'unsent' });
      await tick;
    } finally { await r.app.close(); }
  });

  it('boot\'s unverifiable pending files take the same exit: once both are past confirmBy a rotation runs and drops them', async () => {
    const home = mkTmp('ccrc-token-e2e-orphan-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const paths = tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
    const orphans = ['a', 'b'].map((c) => ({ id: c.repeat(16), value: c.repeat(64) }));
    for (const o of orphans) writeFileSync(paths.pending(o.id), `${o.value}\n`, { mode: 0o600 });
    const r = await rig({ home, handMade: 'e'.repeat(64) });
    try {
      expect(r.driver.view()).toMatchObject({ origin: 'adopted', rotationOwed: true, phase: 'handed-out' });
      expect(r.printed.join('\n')).toContain('stay accepted as unverifiable');
      for (const o of orphans) expect(await r.lane(o.value)).toBe(400);
      await r.driver.tick();
      expect(r.agent.calls).toBe(0);                                   // inside confirmBy: they wait, like any handed-out value
      r.clock.offset = CONFIRM_DEADLINE_MS + 1000;
      await r.driver.tick();
      expect(r.agent.calls).toBe(1);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
      for (const o of orphans) {
        expect(await r.lane(o.value), 'an unverifiable value is dropped by the exit rotation').toBe(401);
        expect(existsSync(paths.pending(o.id))).toBe(false);
      }
    } finally { await r.app.close(); }
  });
});

describe('F3: backoff applies on every route (review 349)', () => {
  const TEN_MINUTES = 10;
  /** Tick once a minute for ten minutes of failures. */
  async function tenMinutes(r: Rig): Promise<void> {
    for (let m = 1; m <= TEN_MINUTES; m++) {
      r.clock.offset = m * 60_000;
      await r.driver.tick();
    }
  }
  const enospc = (): Error => Object.assign(new Error('injected'), { code: 'ENOSPC' });
  /** The backoff ladder's most attempts in the first ten minutes (60 s, 120 s, 240 s, 480 s: attempts at 0, 1, 3, 7). */
  const LADDER_MAX = 4;

  it('(a) one Rotate now press, then ten minutes of staging failures, stays within the ladder', async () => {
    let attempts = 0;
    const r = await rig({ handMade: 'e'.repeat(64), wrap: (st) => ({ ...st, writeValue: async (p, v) => {
      if (p.includes('mail-pending-')) { attempts++; throw enospc(); }
      return st.writeValue(p, v);
    } }) });
    try {
      const first = await r.driver.rotateNow(Date.now());
      expect(first).toMatchObject({ ok: true, outcome: 'started' });
      await r.driver.tick();                                           // joins the tick the press started
      expect(attempts).toBe(1);
      await tenMinutes(r);
      expect(attempts).toBeGreaterThan(2);                             // it does retry
      expect(attempts).toBeLessThanOrEqual(LADDER_MAX);
      // the flag is spent: a later press is a new start, not 'joined' on a stale flag
      r.clock.offset = 20 * 60_000;
      expect(await r.driver.rotateNow(Date.now() + r.clock.offset)).toMatchObject({ ok: true, outcome: 'started' });
    } finally { await r.app.close(); }
  });

  it('(a) a press that meets a failed stage does not leave the flag set for the next successful stage', async () => {
    let fail = false;
    let attempts = 0;
    const r = await rig({ wrap: (st) => ({ ...st, writeValue: async (p, v) => {
      if (fail && p.includes('mail-pending-')) { attempts++; throw enospc(); }
      return st.writeValue(p, v);
    } }) });
    try {
      // a minted, fully-rotated install: nothing is owed, so only the press asks for a stage
      r.rows.row = fleetRow();
      await r.driver.tick();
      const calls = r.agent.calls;
      expect(r.driver.view()).toMatchObject({ origin: 'rotated', rotationOwed: false, phase: 'grace' });
      fail = true;
      expect(await r.driver.rotateNow(Date.now())).toMatchObject({ ok: true, outcome: 'started' });
      await r.driver.tick();
      expect(attempts).toBe(1);
      fail = false;
      r.clock.offset = 90_000;                                         // past the 60 s backoff
      await r.driver.tick();
      expect(r.agent.calls, 'a spent press stages nothing by itself').toBe(calls);
      expect(attempts).toBe(1);
    } finally { await r.app.close(); }
  });

  it('(b) staging failures with the state file failing the same way: the backoff is set before the commit that throws', async () => {
    let attempts = 0;
    const r = await rig({ handMade: 'e'.repeat(64), wrap: (st) => ({ ...st,
      writeValue: async (p, v) => {
        if (p.includes('mail-pending-')) { attempts++; throw enospc(); }
        return st.writeValue(p, v);
      },
      writeState: async () => { throw enospc(); } }) });
    try {
      await r.driver.tick();                                           // the stage fails, then its commit throws too
      expect(attempts).toBe(1);
      expect(r.printed.some((l) => l.includes('a driver tick failed'))).toBe(true);
      await tenMinutes(r);
      expect(attempts).toBeLessThanOrEqual(LADDER_MAX);
      expect(attempts).toBeGreaterThan(2);
    } finally { await r.app.close(); }
  });

  /** A recorded both box; the staged value is promoted by the server's own write. `writerFails`: that write fails;
   *  `failState`: the state file then fails the same way; `stageFailsOnce`: the first pending-file write fails. */
  async function bothBox(opts: { failState?: boolean; writerFails?: boolean; stageFailsOnce?: boolean }): Promise<{
    driver: BoxTokenDriver; writes: () => number; off: (ms: number) => void; printed: string[]; paths: ReturnType<typeof tokenPaths> }> {
    const home = mkTmp('ccrc-token-e2e-both-f3-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const paths = tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
    writeFileSync(paths.current, `${'a'.repeat(64)}\n`, { mode: 0o600 });
    let offset = 0;
    const now = (): number => Date.now() + offset;
    const printed: string[] = [];
    const boot = await bootBoxToken({ mailTokenPath: paths.current, home, role: 'both', roleSource: 'recorded', fleetMode: 'local', now: now() });
    const own: GateNode = { nodeId: 'x', nodeIdMeasured: true, label: 'self', role: 'both', reachable: true, os: 'linux',
      caps: ['token-sync'], agentOps: null, updateState: 'idle', reportedPhase: null };
    let writes = 0;
    let stageFailed = false;
    const base = fileTokenStore(paths);
    const store: TokenStore = { ...base,
      writeValue: async (p, v) => {
        if (opts.stageFailsOnce && !stageFailed && p.includes('mail-pending-')) { stageFailed = true; throw enospc(); }
        return base.writeValue(p, v);
      },
      writeState: async (s) => { if (opts.failState && s.lastFailure === 'write-failed') throw enospc(); return base.writeState(s); } };
    const real = fileBothRoleWriter(paths);
    const driver = new BoxTokenDriver({ store, holder: boot.holder, link: null, generation: null,
      rows: { nodes: () => [own], linkUp: () => false, lastReadyAt: () => null },
      env: { fleetMode: 'local', role: 'both', roleSource: 'recorded', agentEnvMarksFleet: false },
      bothWriter: { write: async (v, g) => { writes++; if (opts.writerFails) throw enospc(); await real.write(v, g); } },
      now, warn: (l) => printed.push(l) }, boot);
    return { driver, writes: () => writes, off: (ms) => { offset = ms; }, printed, paths };
  }

  it('(c) a both box whose fleet-file write keeps failing is retried on the ladder, not every tick', async () => {
    const b = await bothBox({ writerFails: true });
    await b.driver.tick();
    expect(b.writes()).toBe(1);
    for (let m = 1; m <= TEN_MINUTES; m++) { b.off(m * 60_000); await b.driver.tick(); }
    expect(b.writes()).toBeLessThanOrEqual(LADDER_MAX);
    expect(b.writes()).toBeGreaterThan(2);
    expect(b.driver.view()).toMatchObject({ lastFailure: 'write-failed' });
    expect(b.printed.filter((l) => l.includes('could not write the fleet file')).length).toBeLessThanOrEqual(LADDER_MAX);
  });

  it('(b, own write) a both box whose state file fails the same way sets the backoff before the commit that throws', async () => {
    const b = await bothBox({ writerFails: true, failState: true });
    await b.driver.tick();
    expect(b.writes()).toBe(1);
    for (let m = 1; m <= TEN_MINUTES; m++) { b.off(m * 60_000); await b.driver.tick(); }
    expect(b.writes()).toBeLessThanOrEqual(LADDER_MAX);
    expect(b.writes()).toBeGreaterThan(2);
  });

  it('(a) a press whose gate closes before its stage runs is spent: reopening the gate stages nothing by itself', async () => {
    const r = await rig();
    try {
      await r.driver.tick();                                           // a fresh install's first rotation completes
      expect(r.driver.view()).toMatchObject({ origin: 'rotated', rotationOwed: false });
      const calls = r.agent.calls;
      expect(await r.driver.rotateNow(Date.now())).toMatchObject({ ok: true, outcome: 'started' });
      r.rows.row = fleetRow({ agentOps: ['update'] });                 // the gate closes before the started tick reads it
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ phase: 'held', hold: 'agent-predates-op' });
      r.rows.row = fleetRow();
      r.clock.offset = 5 * 60_000;
      await r.driver.tick();
      await r.driver.tick();
      expect(r.agent.calls, 'a spent press stages nothing when the gate reopens').toBe(calls);
    } finally { await r.app.close(); }
  });

  it('a stage that works after a bypassed backoff does not leave the backoff standing for the own-write promote', async () => {
    const b = await bothBox({ stageFailsOnce: true });
    await b.driver.tick();                                             // the stage fails: a backoff of a minute
    expect(b.driver.view()).toMatchObject({ failures: 1 });
    expect(b.writes()).toBe(0);
    b.off(10_000);
    expect(await b.driver.rotateNow(Date.now() + 10_000)).toMatchObject({ ok: true, outcome: 'started' });
    await b.driver.tick();                                             // the press bypasses the backoff: staged and promoted at once
    expect(b.writes()).toBe(1);
    expect(b.driver.view()).toMatchObject({ origin: 'rotated', rotationOwed: false });
  });

  it('a press during an own-write backoff answers started, not joined (ruling letter)', async () => {
    const b = await bothBox({ writerFails: true });
    await b.driver.tick();                                             // staged, the fleet-file write fails: a backoff stands
    expect(b.writes()).toBe(1);
    b.off(10_000);
    expect(await b.driver.rotateNow(Date.now() + 10_000)).toMatchObject({ ok: true, outcome: 'started' });
    await b.driver.tick();
    expect(b.writes(), 'the backoff still gates the promote').toBe(1);
  });
});

// ── fix round 1, batch 2: D-4410 (a retired digest is never lost), D-4411 (the third exit from Previous), D-4412 ───
const retiredDigests = async (r: Rig): Promise<string[]> => {
  const rd = await readRetired(tokPaths(r).retired);
  return rd.kind === 'retired' ? rd.digests : [];
};
const stateOf = async (r: Rig) => {
  const s = await readState(tokPaths(r).state);
  if (s.kind !== 'state') throw new Error('no state');
  return s.state;
};
const enospc = (): Error => Object.assign(new Error('injected'), { code: 'ENOSPC' });
const writeBack = (home: string, value: string): void => {
  const tok = path.join(home, '.ccrc', 'mail.token');
  rmSync(tok);
  writeFileSync(tok, `# an older deploy.sh shipped this\n${value}\n`, { mode: 0o600 });
};

describe('a retired value\'s digest is durable before it leaves the accept set (D-4410, review 349 sec-M2)', () => {
  /** L adopted, one rotation, the new value presented: the next tick past grace retires L. */
  async function throughGrace(r: Rig): Promise<string> {
    await r.driver.tick();
    const fresh = r.fleetValue() as string;
    await r.lane(fresh);
    r.clock.offset = GRACE_MS + 1000;
    return fresh;
  }

  it("sec-M2's probe: ENOSPC on the append, then a restart with L written back: L is still refused, and the record lands later", async () => {
    const L = 'e'.repeat(64);
    const fail = { append: true };
    const first = await rig({ handMade: L, wrap: (st) => ({ ...st, appendRetired: async (d, at) => {
      if (fail.append) throw enospc();
      return st.appendRetired(d, at);
    } }) });
    await throughGrace(first);
    await first.driver.tick();                                           // retires L; the append fails
    expect(first.printed.filter((l) => l.includes('could not record a retired digest'))).toHaveLength(1);
    expect(await retiredDigests(first)).toEqual([]);                    // the file never got it
    expect((await stateOf(first)).retiring).toEqual([{ sha256: valueDigestHex(L), at: expect.any(Number) }]);   // box-token.json did
    expect(await first.lane(L)).toBe(401);                              // refused, and recognised as retired
    expect(first.boot.holder.counters().retired).toBe(1);
    await first.app.close();
    writeBack(first.home, L);
    const r = await rig({ home: first.home, fleetHome: first.fleetHome });
    try {
      expect(r.boot.holder.currentValue()).not.toBe(L);
      expect(await r.lane(L)).toBe(401);
      expect(r.driver.view()).toMatchObject({ origin: 'minted', owedWhy: 'retired-written-back' });
      await r.driver.tick();                                             // the record lands in the (still absent) retired file
      expect(await retiredDigests(r)).toEqual([valueDigestHex(L)]);
      expect((await stateOf(r)).retiring ?? []).toEqual([]);
      expect(await r.lane(L)).toBe(401);
    } finally { await r.app.close(); }
  });

  it('a failed append is retried from the record on the next ticks, warned once while it keeps failing, and then settled', async () => {
    const L = 'e'.repeat(64);
    const fail = { append: true };
    const r = await rig({ handMade: L, wrap: (st) => ({ ...st, appendRetired: async (d, at) => {
      if (fail.append) throw enospc();
      return st.appendRetired(d, at);
    } }) });
    try {
      await throughGrace(r);
      await r.driver.tick();
      await r.driver.tick();
      await r.driver.tick();
      expect(r.printed.filter((l) => l.includes('could not record a retired digest'))).toHaveLength(1);
      expect((await stateOf(r)).retiring).toHaveLength(1);
      fail.append = false;
      await r.driver.tick();
      expect(await retiredDigests(r)).toEqual([valueDigestHex(L)]);
      expect((await stateOf(r)).retiring ?? []).toEqual([]);
      expect(await r.lane(L)).toBe(401);
    } finally { await r.app.close(); }
  });

  it('the digest is in box-token.json BEFORE the value leaves the accept set', async () => {
    const L = 'e'.repeat(64);
    const seen: ('accepted' | 'refused')[] = [];
    let rr: Rig | null = null;
    const r = await rig({ handMade: L, wrap: (st) => ({ ...st, writeState: async (s) => {
      if (s.retiring?.some((e) => e.sha256 === valueDigestHex(L))) seen.push(rr?.boot.holder.match(L) === null ? 'refused' : 'accepted');
      return st.writeState(s);
    } }) });
    rr = r;
    try {
      await throughGrace(r);
      await r.driver.tick();
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0], 'the first write carrying the digest finds the value still accepted').toBe('accepted');
      expect(await r.lane(L)).toBe(401);
    } finally { await r.app.close(); }
  });

  it('a record that cannot be written keeps the value accepted, and the retirement is retried (a failure never drops the digest)', async () => {
    const L = 'e'.repeat(64);
    const fail = { record: true };
    const r = await rig({ handMade: L, wrap: (st) => ({ ...st, writeState: async (s) => {
      if (fail.record && s.retiring && s.retiring.length > 0) throw enospc();
      return st.writeState(s);
    } }) });
    try {
      await throughGrace(r);
      await r.driver.tick();                                             // the record fails: the tick throws and warns
      expect(r.printed.some((l) => l.includes('a driver tick failed'))).toBe(true);
      expect(await r.lane(L)).toBe(400);                                 // still accepted: it never left unrecorded
      expect(existsSync(tokPaths(r).previous)).toBe(true);
      fail.record = false;
      await r.driver.tick();
      expect(await r.lane(L)).toBe(401);
      expect(await retiredDigests(r)).toEqual([valueDigestHex(L)]);
      expect((await stateOf(r)).retiring ?? []).toEqual([]);
    } finally { await r.app.close(); }
  });

  it('a landed append whose record cannot be cleared still teaches the holder the retired value (review of batch 2)', async () => {
    const L = 'e'.repeat(64);
    const fail = { clear: true };
    const r = await rig({ handMade: L, wrap: (st) => ({ ...st, writeState: async (s) => {
      if (fail.clear && s.retiring !== undefined && s.retiring.length === 0) { fail.clear = false; throw enospc(); }
      return st.writeState(s);
    } }) });
    try {
      await throughGrace(r);
      await r.driver.tick();                                             // the append lands; the commit that clears the record throws
      expect(r.printed.some((l) => l.includes('a driver tick failed'))).toBe(true);
      expect(await retiredDigests(r)).toEqual([valueDigestHex(L)]);
      expect(await r.lane(L)).toBe(401);
      expect(r.boot.holder.counters().retired, 'recognised as retired, not a plain bad value').toBe(1);
    } finally { await r.app.close(); }
  });

  it("F1's sequence through the driver: an unusable retired file at retirement, then L written back and a restart: L is refused", async () => {
    const L = 'e'.repeat(64);
    const first = await rig({ handMade: L });
    await first.driver.tick();
    await first.lane(first.fleetValue() as string);
    writeFileSync(tokPaths(first).retired, '{"v":2,"retired":[]}\n', { mode: 0o600 });   // a later format, or corruption
    first.clock.offset = GRACE_MS + 1000;
    await first.driver.tick();                                           // the append refuses the unusable file: the record stays
    expect((await stateOf(first)).retiring).toEqual([{ sha256: valueDigestHex(L), at: expect.any(Number) }]);
    expect(await first.lane(L)).toBe(401);
    await first.app.close();
    writeBack(first.home, L);
    const r = await rig({ home: first.home, fleetHome: first.fleetHome });
    try {
      expect(await r.lane(L)).toBe(401);
      expect(r.boot.holder.currentValue()).not.toBe(L);
      expect(readdirSync(path.join(r.home, '.ccrc')).filter((n) => n.startsWith('box-token-retired.json.unusable-'))).toHaveLength(1);
      await r.driver.tick();
      expect(await retiredDigests(r)).toEqual([valueDigestHex(L)]);     // the fresh list has it
    } finally { await r.app.close(); }
  });

  it('nothing printed: the digest is never in a log line, the view, or any file but box-token.json and the retired file', async () => {
    const L = 'e'.repeat(64);
    const r = await rig({ handMade: L, wrap: (st) => ({ ...st, appendRetired: async () => { throw enospc(); } }) });
    try {
      await throughGrace(r);
      await r.driver.tick();
      const d = valueDigestHex(L);
      expect([...r.printed, JSON.stringify(r.driver.view())].join('\n').includes(d)).toBe(false);
      for (const n of readdirSync(path.join(r.home, '.ccrc'))) {
        if (n === 'box-token.json' || n === 'box-token-retired.json' || n.includes('.tmp-')) continue;
        const p = path.join(r.home, '.ccrc', n);
        if (statSync(p).isFile() && n !== 'coord.db' && !n.startsWith('coord.db')) expect(readFileSync(p, 'utf8').includes(d), n).toBe(false);
      }
    } finally { await r.app.close(); }
  });
});

describe('a later generation the fleet confirmed retires a previous value early (D-4411, review 349 F2)', () => {
  it("the probe's sequence: L is retired at the second promotion, with the retire line and its digest recorded, and is refused afterwards", async () => {
    const L = 'e'.repeat(64);
    const r = await rig({ handMade: L });
    try {
      await r.driver.tick();                                             // rotation 1: G1 is current, L is previous in grace
      expect(await r.lane(L)).toBe(400);
      const lines = r.printed.length;
      r.clock.offset = 2 * 60_000;                                       // well inside GRACE_MS and the hard bound
      expect(await r.driver.rotateNow(Date.now() + r.clock.offset)).toMatchObject({ ok: true, outcome: 'started' });
      await r.driver.tick();                                             // rotation 2 is confirmed: the third exit
      const g2 = r.fleetValue() as string;
      expect(r.boot.holder.currentValue()).toBe(g2);
      expect(await r.lane(L)).toBe(401);
      expect(await r.lane(L)).toBe(401);
      const after = r.printed.slice(lines).filter((l) => l.includes('the previous value was retired'));
      // R0b (D-4411's wording, review 352): the early retirement says WHY it happened, a later confirmed generation, and not
      // "grace ended", which was not what ended it. The rule is unchanged; only this line differs from the retire action's.
      expect(after, 'one line for the early retirement').toHaveLength(1);
      expect(after[0]).toBe('ccrc-server: box token: the fleet confirmed a later generation; the previous value was retired early and is refused');
      expect(after[0]).not.toContain('grace ended');
      expect(await retiredDigests(r)).toEqual([valueDigestHex(L)]);
      expect(r.driver.view()).toMatchObject({ retiredRefused: true });
      expect(existsSync(tokPaths(r).previous)).toBe(true);               // G1 is the previous now
      expect(await r.lane(g2)).toBe(400);
    } finally { await r.app.close(); }
  });

  it('the early retirement records its digest like any other: a failed append is kept in box-token.json and refused after a restart', async () => {
    const L = 'e'.repeat(64);
    const first = await rig({ handMade: L, wrap: (st) => ({ ...st, appendRetired: async () => { throw enospc(); } }) });
    await first.driver.tick();
    first.clock.offset = 2 * 60_000;
    await first.driver.rotateNow(Date.now() + first.clock.offset);
    await first.driver.tick();
    expect((await stateOf(first)).retiring).toEqual([{ sha256: valueDigestHex(L), at: expect.any(Number) }]);
    expect(await first.lane(L)).toBe(401);
    await first.app.close();
    writeBack(first.home, L);
    const r = await rig({ home: first.home, fleetHome: first.fleetHome });
    try {
      expect(await r.lane(L)).toBe(401);
      expect(r.boot.holder.currentValue()).not.toBe(L);
    } finally { await r.app.close(); }
  });
});

describe('a retired presentation on a box-token lane owes one forward rotation, bounded (D-4412, state-machine I3)', () => {
  /** L adopted, rotated, presented, retired: the box is idle with nothing owed. */
  async function idleAfterRetirement(): Promise<{ r: Rig; L: string; fresh: string }> {
    const L = 'e'.repeat(64);
    const r = await rig({ handMade: L });
    await r.driver.tick();
    const fresh = r.fleetValue() as string;
    await r.lane(fresh);
    r.clock.offset = GRACE_MS + 1000;
    await r.driver.tick();
    expect(r.driver.view()).toMatchObject({ phase: 'idle', rotationOwed: false, retiredRefused: true });
    return { r, L, fresh };
  }

  it("I3's fleet-only write-back is resynced through the code path, with no 401 after the first", async () => {
    const { r, L, fresh } = await idleAfterRetirement();
    try {
      const fleetFile = path.join(r.fleetHome, '.cc-secrets', 'ccrc-mail.token');
      await writeFleetTokenFile(fleetFile, L);                           // an older deploy.sh ran its agent arm: the fleet file alone
      expect(r.driver.view().owedWhy).toBeNull();                        // the generation file still names current: not "behind"
      const calls = r.agent.calls;
      expect(await r.lane(L)).toBe(401);                                 // the first 401 (the fleet's own call)
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ retiredPresented: 1 });
      expect(r.agent.calls).toBe(calls + 1);                             // one rotation, owed for this word
      expect(r.fleetValue()).toBe(r.boot.holder.currentValue());
      expect(r.fleetValue()).not.toBe(fresh);
      for (let i = 0; i < 3; i++) expect(await r.lane(r.fleetValue() as string)).toBe(400);   // resynced: no 401 after the first
      expect(r.printed.some((l) => l.includes('retired-presented'))).toBe(true);
    } finally { await r.app.close(); }
  });

  it('the owed word is retired-presented', async () => {
    const { r, L } = await idleAfterRetirement();
    try {
      r.rows.linkUp = false;                                             // hold the gate so the owed state stands
      await r.lane(L);
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ rotationOwed: true, owedWhy: 'retired-presented', hold: 'link-down' });
    } finally { await r.app.close(); }
  });

  it('a flood of retired presentations owes exactly one rotation per HOLD_REPROBE_MS', async () => {
    const { r, L } = await idleAfterRetirement();
    try {
      const base = r.agent.calls;
      const flood = async (n: number): Promise<void> => { for (let i = 0; i < n; i++) { expect(await r.lane(L)).toBe(401); await r.driver.tick(); } };
      await flood(20);
      expect(r.agent.calls, 'the first presentation owes one rotation; the flood owes no more').toBe(base + 1);
      r.clock.offset += HOLD_REPROBE_MS - 5000;                          // just inside the bound
      await flood(10);
      expect(r.agent.calls).toBe(base + 1);
      r.clock.offset += 10_000;                                          // past it
      await flood(10);
      expect(r.agent.calls, 'one more per bound').toBe(base + 2);
      await flood(10);
      expect(r.agent.calls).toBe(base + 2);
    } finally { await r.app.close(); }
  });

  it('nothing new is owed while a rotation is owed: presentations during a held gate add no second rotation', async () => {
    const { r, L } = await idleAfterRetirement();
    try {
      const base = r.agent.calls;
      r.rows.linkUp = false;
      for (let i = 0; i < 5; i++) { await r.lane(L); await r.driver.tick(); }
      expect(r.agent.calls).toBe(base);
      r.rows.linkUp = true;
      await r.driver.tick();
      expect(r.agent.calls, 'one rotation once the gate opens').toBe(base + 1);
      expect(r.driver.view()).toMatchObject({ rotationOwed: false });
    } finally { await r.app.close(); }
  });

  it('the gate still applies: a closed gate (a named hold) sends nothing for a retired presentation', async () => {
    const { r, L } = await idleAfterRetirement();
    try {
      const base = r.agent.calls;
      r.rows.row = fleetRow({ agentOps: ['update'] });                   // agent-predates-op
      await r.lane(L);
      await r.driver.tick();
      expect(r.agent.calls).toBe(base);
      expect(r.driver.view()).toMatchObject({ hold: 'agent-predates-op', rotationOwed: true, owedWhy: 'retired-presented' });
    } finally { await r.app.close(); }
  });
});

// ── D-4414 (review 352 F2, F3, F6): no path retires or drops a value without its durable digest, and no failure makes
// boot adopt a value it did not write ───────────────────────────────────────────────────────────────────────────
/** A recorded both box over a fixture home: boot, the fleet-file writer (which can be made to fail), a shared clock. */
async function bothAt(home: string, ctl: { off: number; writerFails: boolean; lockDirForBoot?: boolean }): Promise<{
  driver: BoxTokenDriver; boot: BootResult; paths: ReturnType<typeof tokenPaths>; printed: string[]; now: () => number }> {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const paths = tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
  const now = (): number => Date.now() + ctl.off;
  const printed: string[] = [];
  if (ctl.lockDirForBoot) chmodSync(path.join(home, '.ccrc'), 0o500);
  let boot: BootResult;
  try {
    boot = await bootBoxToken({ mailTokenPath: paths.current, home, role: 'both', roleSource: 'recorded', fleetMode: 'local', now: now() });
  } finally { if (ctl.lockDirForBoot) chmodSync(path.join(home, '.ccrc'), 0o700); }
  printed.push(...boot.warnings);
  const own: GateNode = { nodeId: 'x', nodeIdMeasured: true, label: 'self', role: 'both', reachable: true, os: 'linux',
    caps: ['token-sync'], agentOps: null, updateState: 'idle', reportedPhase: null };
  const real = fileBothRoleWriter(paths);
  const driver = new BoxTokenDriver({ store: fileTokenStore(paths), holder: boot.holder, link: null, generation: null,
    rows: { nodes: () => [own], linkUp: () => false, lastReadyAt: () => null },
    env: { fleetMode: 'local', role: 'both', roleSource: 'recorded', agentEnvMarksFleet: false },
    bothWriter: { write: async (v, g) => { if (ctl.writerFails) throw enospc(); await real.write(v, g); } },
    now, warn: (l) => printed.push(l) }, boot);
  return { driver, boot, paths, printed, now };
}
const retiredIn = async (paths: ReturnType<typeof tokenPaths>): Promise<string[]> => {
  const rd = await readRetired(paths.retired);
  return rd.kind === 'retired' ? rd.digests : [];
};

describe('D-4414 F2: a failing own-write never blocks the previous value\'s retirement at its hard bound', () => {
  it('own-write failing persistently past hardUntil, then L written back and a restart: L is refused', async () => {
    const L = 'a'.repeat(64);
    const home = mkTmp('ccrc-token-e2e-f2-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'mail.token'), `${L}\n`, { mode: 0o600 });
    const ctl = { off: 0, writerFails: false };
    const b = await bothAt(home, ctl);
    await b.driver.tick();                                               // G1 promoted by the own write: L is previous, in grace
    expect(existsSync(b.paths.previous)).toBe(true);
    ctl.writerFails = true;                                              // the fleet file can no longer be written (ENOSPC / EACCES)
    ctl.off = 2 * 60_000;
    expect(await b.driver.rotateNow(b.now())).toMatchObject({ ok: true, outcome: 'started' });
    await b.driver.tick();
    expect(b.driver.view()).toMatchObject({ lastFailure: 'write-failed' });
    ctl.off = GRACE_HARD_MS + 5 * 60_000;                                // past L's hard bound, the write still failing
    await b.driver.tick();
    expect(b.driver.view()).toMatchObject({ lastFailure: 'write-failed' });
    expect(await retiredIn(b.paths), 'L\'s digest is durable').toEqual([valueDigestHex(L)]);
    expect(existsSync(b.paths.previous)).toBe(false);
    expect(checkMailToken(b.boot.holder, L)).toBe('bad');
    expect(b.printed.filter((l) => l.includes('the previous value was retired at the hard bound') || l.includes('grace ended'))).toHaveLength(1);
    // the write-back and the restart
    rmSync(b.paths.current);
    writeFileSync(b.paths.current, `# an older deploy.sh shipped this\n${L}\n`, { mode: 0o600 });
    ctl.writerFails = false;
    const b2 = await bothAt(home, ctl);
    expect(checkMailToken(b2.boot.holder, L)).toBe('bad');
    expect(b2.boot.holder.currentValue()).not.toBe(L);
    expect(b2.boot.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    const text = [...b.printed, ...b2.printed].join('\n');
    expect(text.includes(L) || text.includes(valueDigestHex(L))).toBe(false);
  });
});

describe('D-4414 F3: a value file is never deleted before its digest is durable', () => {
  /** L adopted and rotated away (a previous in grace), the server stopped, and the previous file made unreadable. */
  async function restartedOverUnreadablePrevious(): Promise<{ r: Rig; L: string; fresh: string; prev: string }> {
    const L = 'e'.repeat(64);
    const first = await rig({ handMade: L });
    await first.driver.tick();
    const fresh = first.fleetValue() as string;
    await first.app.close();
    const prev = tokPaths(first).previous;
    chmodSync(prev, 0o000);
    const r = await rig({ home: first.home, fleetHome: first.fleetHome });
    return { r, L, fresh, prev };
  }

  it.skipIf(isRoot)('boot keeps an unreadable previous file; at the hard bound the driver keeps it, warns once, and records the digest once a read works', async () => {
    const { r, L, prev } = await restartedOverUnreadablePrevious();
    try {
      expect(r.boot.warnings.some((w) => w.includes('cannot be read (EACCES)'))).toBe(true);
      expect(r.boot.state?.previous, 'the record of the previous value is kept').not.toBeNull();
      expect(await r.lane(L), 'the accept set does not hold a value it cannot read').toBe(401);
      r.clock.offset = GRACE_HARD_MS + 1000;                              // past the hard bound
      await r.driver.tick();
      await r.driver.tick();
      expect(r.agent.calls, 'the owed rotation still runs while the file stays unreadable').toBeGreaterThan(0);
      expect(existsSync(prev), 'no deletion').toBe(true);
      expect(await retiredDigests(r)).toEqual([]);
      expect((await stateOf(r)).previous).not.toBeNull();
      expect(await r.lane(L), 'still dropped from the accept set, in memory').toBe(401);
      expect(r.printed.filter((l) => l.includes('the read is retried each tick'))).toHaveLength(1);
      chmodSync(prev, 0o600);
      await r.driver.tick();                                              // a later tick: the read works
      expect(await retiredDigests(r)).toEqual([valueDigestHex(L)]);
      // The rotation that boot owed then ran, so the previous slot holds that rotation's value: never L's file.
      expect(existsSync(prev) ? readFileSync(prev, 'utf8').includes(L) : false).toBe(false);
      expect(r.boot.holder.currentValue()).not.toBe(L);
      await r.app.close();
      writeBack(r.home, L);                                                // a write-back is refused
      const r3 = await rig({ home: r.home, fleetHome: r.fleetHome });
      try {
        expect(await r3.lane(L)).toBe(401);
        expect(r3.boot.holder.currentValue()).not.toBe(L);
      } finally { await r3.app.close(); }
      const text = [...r.printed].join('\n');
      expect(text.includes(L) || text.includes(valueDigestHex(L))).toBe(false);
    } finally { if (existsSync(prev)) chmodSync(prev, 0o600); await r.app.close().catch(() => {}); }
  });

  it.skipIf(isRoot)('a promotion over an unreadable previous value does not overwrite its file: it waits, and retires it with its digest first', async () => {
    const { r, L, fresh, prev } = await restartedOverUnreadablePrevious();
    try {
      const ino = statSync(prev).ino;
      expect(await r.driver.rotateNow(Date.now() + r.clock.offset)).toMatchObject({ ok: true, outcome: 'started' });
      await r.driver.tick();
      expect(statSync(prev).ino, 'the file L\'s value is in is still the same file').toBe(ino);
      expect(r.boot.holder.currentValue(), 'nothing was promoted over it').toBe(fresh);
      expect(await retiredDigests(r)).toEqual([]);
      chmodSync(prev, 0o600);
      await r.driver.tick();                                              // the generation read confirms G2: L is retired, then G2 promoted
      expect(await retiredDigests(r)).toEqual([valueDigestHex(L)]);
      expect(r.boot.holder.currentValue()).not.toBe(fresh);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
      expect(await r.lane(L)).toBe(401);
    } finally { if (existsSync(prev)) chmodSync(prev, 0o600); await r.app.close().catch(() => {}); }
  });
});

describe('D-4414 F6: a failed foreign mint keeps its owed rotation', () => {
  it.skipIf(isRoot)('foreign posture, a failed mint, then the retry: the rotation owed is retired-written-back and the fleet file is rewritten', async () => {
    const H = 'b'.repeat(64);
    const home = mkTmp('ccrc-token-e2e-f6-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const paths = tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
    writeFileSync(paths.current, `${H}\n`, { mode: 0o600 });             // the hand-made value, shipped to both files
    await writeFleetTokenFile(paths.fleetFile, H);
    writeFileSync(paths.retired, '{"v":2,"retired":[]}\n', { mode: 0o600 });   // an unusable retired file: the foreign posture
    const ctl = { off: 0, writerFails: false, lockDirForBoot: true };
    const b = await bothAt(home, ctl);                                   // the mint fails: the directory is read-only during boot
    expect(b.boot.mintFailed).toBe(true);
    expect(b.boot.mintOwed).toBe('retired-written-back');
    expect(b.driver.view().stalled).toMatchObject({ why: 'mint-failed' });
    await b.driver.tick();                                               // retry-mint, then the owed forward rotation, own-written
    const fresh = b.boot.holder.currentValue() as string;
    expect(fresh).not.toBe(H);
    expect(extractToken(readFileSync(paths.fleetFile, 'utf8')), 'the fleet file no longer holds the foreign value').toBe(fresh);
    expect(checkMailToken(b.boot.holder, H)).toBe('bad');
    expect(b.printed.some((l) => l.includes('rotation started') && l.includes('retired-written-back'))).toBe(true);
    expect(b.driver.view()).toMatchObject({ origin: 'rotated', rotationOwed: false, fleetConfirmed: 'own-write' });
  });
});

// ── part B task R0b (review 352 F5, F7, F8, F9, F10, F11, F12): conformance to the rulings, the spec and the plan ──
describe('R0b: Rotate now, the cap alert, the hand-out lines and the attribution pins (review 352)', () => {
  afterEach(() => { vi.useRealTimers(); });
  /** The claim route stamps a hand-out with `Date.now()`, so these tests drive the one clock the route and the driver share. */
  function clock(): (ms: number) => void {
    const base = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(base);
    return (ms) => { vi.setSystemTime(base + ms); };
  }

  // F5: "joined" only while a send or a promotion is actually in flight (D-4413 as ruled).
  it('F5: a stale press flag never answers joined: a press during a confirm wait, then a press during an unrelated tick, on a closed gate, answers held', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.agent.mode = 'claim-only';
      await r.driver.tick();                                           // G1 handed out, its result lost: a confirm wait
      const t = Date.now();
      expect(await r.driver.rotateNow(t)).toMatchObject({ ok: true, outcome: 'started' });
      await r.driver.tick();                                           // the wait: the tick returns `none`, the press flag stays set
      expect(r.agent.calls).toBe(1);
      r.rows.linkUp = false;                                           // the gate closes
      const unrelated = r.driver.tick();                               // an unrelated 60 s tick is running when the next press lands
      const a = await r.driver.rotateNow(t + 120_000);
      await unrelated;
      expect(a, 'nothing is in flight: not joined').not.toMatchObject({ ok: true, outcome: 'joined' });
      expect(a).toMatchObject({ ok: false, error: 'held', hold: 'link-down' });
    } finally { await r.app.close(); }
  });

  it('F5: a second press while the first press\'s own tick is still before its send answers the rate limit, not joined', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      const t = Date.now();
      expect(await r.driver.rotateNow(t)).toMatchObject({ ok: true, outcome: 'started' });
      expect(await r.driver.rotateNow(t + 1)).toMatchObject({ ok: false, error: 'rate-limited' });
      await r.driver.tick();
      expect(r.agent.calls).toBe(1);
    } finally { await r.app.close(); }
  });

  // F8: the recorded-promotion arm.
  it('F8: a press against a recorded promotion that stalled between ticks answers joined and starts nothing', async () => {
    let armed = true;
    const r = await rig({ handMade: 'e'.repeat(64), wrap: (st) => ({ ...st, writeValue: async (p, v) => {
      if (armed && p === st.paths.previous) { armed = false; throw Object.assign(new Error('injected'), { code: 'EACCES' }); }
      return st.writeValue(p, v);
    } }) });
    try {
      await r.driver.tick();                                           // the op result confirms G1; step (b) fails after `promoting` is recorded
      expect(r.printed.some((l) => l.includes('a driver tick failed'))).toBe(true);
      expect((await onDisk(r)).promoting).not.toBeNull();
      expect(r.driver.view().phase).toBe('promoting');
      const calls = r.agent.calls;
      expect(await r.driver.rotateNow(Date.now() + 120_000)).toMatchObject({ ok: true, outcome: 'joined' });
      await r.driver.tick();                                           // the retry finishes the promotion; the press staged nothing
      expect(r.agent.calls).toBe(calls);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
    } finally { await r.app.close(); }
  });

  // F7: the third slot's presentation is attributed to the exit rotation's value.
  it('F7: a presentation of the exit rotation\'s value in the THIRD pending slot counts for the new current (no extra grace, no extra rotation)', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    const at = clock();
    try {
      r.agent.mode = 'claim-only';
      await r.driver.tick();                                           // G1 handed out, lost
      at(CONFIRM_DEADLINE_MS + 1000);
      await r.driver.tick();                                           // G2 handed out, lost
      at(2 * CONFIRM_DEADLINE_MS + 2000);
      r.agent.mode = 'lose-result';                                    // the exit rotation G3: the fleet writes and proves it, the result is lost
      await r.driver.tick();
      const pend = (await onDisk(r)).pending;
      expect(pend).toHaveLength(3);
      expect(r.agent.calls).toBe(3);
      at(2 * CONFIRM_DEADLINE_MS + 4000);
      await r.driver.tick();                                           // a generation read names G3: promoted
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
      const s = await onDisk(r);
      expect(s.current.id).toBe(pend[2]!.id);
      expect(s.previous, 'the fleet\'s own proof call against slot 2 counted as the new current presented').toMatchObject({ currentPresented: true });
    } finally { await r.app.close(); }
  });

  // F9 (option b): D-4412's busy arm is dead in the driver, so it is removed; what the driver really does is pinned.
  it('F9: a retired presentation made while a send is in flight is weighed on the next tick, not lost, and owes one rotation', async () => {
    const L = 'e'.repeat(64);
    let rr: Rig | null = null;
    let during: (() => Promise<void>) | null = null;
    let sends = 0;
    const link: TokenSyncLink = { send: async (code) => {
      sends++;
      if (during !== null) { const f = during; during = null; await f(); return { kind: 'unsent' }; }
      return (rr as Rig).agent.send(code);
    } };
    const r = await rig({ handMade: L, link });
    rr = r;
    try {
      await r.driver.tick();
      await r.lane(r.fleetValue() as string);
      r.clock.offset = GRACE_MS + 1000;
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ phase: 'idle', rotationOwed: false, retiredRefused: true });
      const base = sends;
      during = async () => { expect(await r.lane(L)).toBe(401); };       // the retired value is presented mid-send
      expect(await r.driver.rotateNow(Date.now() + r.clock.offset)).toMatchObject({ ok: true, outcome: 'started' });
      await r.driver.tick();
      expect(sends).toBe(base + 1);
      expect(r.driver.view().retiredPresented).toBe(1);
      expect(r.driver.view().rotationOwed, 'not yet weighed: the weighing is the next tick\'s preamble').toBe(false);
      await r.driver.tick();
      expect(sends, 'weighed on the next tick: one rotation owed and run').toBe(base + 2);
      expect(r.printed.some((l) => l.includes('retired-presented'))).toBe(true);
    } finally { await r.app.close(); }
  });

  // F10: the hand-out line names the node even when the link drops while the record is being written.
  it('F10: the hand-out line names the node the code was bound to even when the op ends before the record lands', async () => {
    let rr: Rig | null = null;
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    let entered: () => void = () => {};
    const enteredP = new Promise<void>((res) => { entered = res; });
    let claimed: Promise<unknown> | null = null;
    let armed = true;
    let ended: () => void = () => {};
    const endedP = new Promise<void>((res) => { ended = res; });
    const link: TokenSyncLink = { async send(code) {
      claimed = Promise.resolve((rr as Rig).app.inject({ method: 'POST', url: '/api/token/claim', payload: { code, nodeId: NODE } }));
      await enteredP;                                                  // the claim is burned and its record is in flight
      ended();
      return { kind: 'lost', why: 'disconnected' };                    // the link drops during that write: `send` ends, the binding is gone
    } };
    const r = await rig({ handMade: 'e'.repeat(64), link, wrap: (st) => ({ ...st, writeState: async (s) => {
      if (armed && s.pending.some((p) => p.handedOutAt !== null)) { armed = false; entered(); await gate; }
      return st.writeState(s);
    } }) });
    rr = r;
    try {
      const tick = r.driver.tick();
      await endedP;
      await new Promise((res) => setTimeout(res, 25));                 // `send` has settled and its `finally` has run; the record is still unwritten
      release();
      await tick;
      await claimed;
      const lines = r.printed.filter((l) => l.includes('claim door handed-out'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(new RegExp(`handed out to node ${NODE}$`));
    } finally { release(); await r.app.close(); }
  });

  // F11: the hand-out-not-recorded lines carry the outcome word and the node id.
  it('F11: a hand-out that cannot be recorded logs the outcome word and the node id, in the driver\'s line and the route\'s, never a code or a value', async () => {
    let failNext = true;
    const r = await rig({ handMade: 'e'.repeat(64), wrap: (st) => ({ ...st, writeState: async (s) => {
      if (failNext && s.pending.some((p) => p.handedOutAt !== null)) { failNext = false; throw enospc(); }
      return st.writeState(s);
    } }) });
    try {
      await r.driver.tick();
      const lines = r.printed.filter((l) => l.includes('could not be recorded'));
      expect(lines, 'the driver\'s line and the route\'s').toHaveLength(2);
      for (const l of lines) {
        expect(l).toContain('unavailable');
        expect(l).toContain(`node ${NODE}`);
      }
      const secrets = [...r.agent.codes, 'e'.repeat(64)];
      for (const l of r.printed) for (const x of secrets) expect(l.includes(x)).toBe(false);
    } finally { await r.app.close(); }
  });

  // F12: the pending-cap alert says what is true where it prints. A tick can print it only with three values pending and all
  // three past their deadline (with two handed out, an unexpired one is a rotation in flight and `nextAction` answers `none`
  // before any hold), where no exit remains.
  it('F12: the pending-cap alert, printed at the third slot, does not promise an exit that is spent', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    const at = clock();
    try {
      r.agent.mode = 'claim-only';
      await r.driver.tick();
      at(CONFIRM_DEADLINE_MS + 1000);
      await r.driver.tick();                                           // G2 handed out
      at(2 * CONFIRM_DEADLINE_MS + 2000);
      await r.driver.tick();                                           // the exit: G3 handed out, three handed out
      const alerts = (): string[] => r.printed.filter((l) => l.includes('handed-out values unaccounted for'));
      expect(alerts(), 'nothing printed while the third value is inside its deadline').toHaveLength(0);
      at(4 * CONFIRM_DEADLINE_MS);
      await r.driver.tick();                                           // all three overdue and nothing can start
      expect(r.driver.view()).toMatchObject({ hold: 'pending-cap' });
      expect(alerts()).toHaveLength(1);
      expect(alerts()[0], 'all three overdue: the line must not name a deadline as the way out').not.toContain('past their confirm deadline');
      expect(alerts()[0]).toContain('until the fleet confirms one');
    } finally { await r.app.close(); }
  });
});
