// token-rotation-real-verb.test.ts — one rotation through the REAL fleet verb
// (design 2026-10-07 §10.2, Figure 4; plan Task B4). Everything is real and in
// this process except the two boxes' homes, which are fixtures:
//   - the server: `buildServer` with the real holder (`bootBoxToken`), the real
//     claim door and rotate route (`registerTokenRoutes` via `deps.tokenDriver`),
//     a real coord store (so `GET /api/ledger` answers 400, not 501), on loopback;
//   - the driver: `BoxTokenDriver` with the real link (`tokenSyncLinkOver`) and
//     the real generation reader (`generationReaderOver`) over a real
//     `connectFleet` client;
//   - the agent: `startAgent` with `spawnTokenSync: makeTokenSyncSpawn(...)`,
//     which spawns `<fleet home>/.local/bin/ccrc token sync --from agent` — a
//     launcher into THIS checkout's `ccd/ccrc`, which runs the real
//     `ccd/ccrc-token-sync` with the real curl behind the loopback front.
// The release-lane case lays the fleet HOME out as `ccrc install` does (tree under ~/ccrc-versions/<tag>/ccd, ~/ccrc a
// symlink to it, ~/.local/bin/ccrc the generated launcher) and presents the fleet file to the server throughout.
// Where Part A as merged decided differently from the plan's expectation, the case says so by name (D-4409 item 6:
// the verb's own proof in a pending slot counts as a presentation of the new current, so grace ends on time).
// Only the gate's rows are a literal (a `GateRowsSource` is a port; index.ts
// maps coord's node rows, which this file has no inventory sweep to fill), and
// a case that needs a lost result or a blind read wraps the real link or reader.
//
// The values are FIXTURES: OLD is planted, the new value is whatever the server
// minted, read back from the fixture files only to compare them.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { bootBoxToken } from '../src/token/boot.js';
import { BoxTokenDriver } from '../src/token/driver.js';
import { tokenSyncLinkOver, generationReaderOver } from '../src/token/link.js';
import { fileTokenStore, tokenPaths } from '../src/token/files.js';
import { GRACE_MS, type GateNode } from '../src/token/policy.js';
import type { GenerationReader, TokenSyncLink } from '../src/token/ports.js';
import { makeTokenSyncSpawn, tokenSyncEnv, type TokenSyncSpawn } from '../../agent/src/tokensync.js';
import { bootAgent, connectToAgent } from './remoteHelpers.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import type { RunningAgent } from '../../agent/src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { harnessBin } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import type { NodeOs } from '../../shared/api.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const OLD = ['0d', 'd0'].join('').repeat(16);
const NODE_ID = '0123abcd-0000-4000-8000-000000000001';
const PREAMBLE = '# ccrc box token — fixture preamble\n\n';
const CAPS = ['verify', 'node-id', 'floor', 'update-json', 'update-gate', 'rollback', 'versions', 'token-sync', 'detach'];
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');
/** The extraction rule every reader applies: the first non-blank, non-`#` line. */
const valueOf = (p: string): string =>
  read(p).split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#')) ?? '';

interface Opts {
  link?: (real: TokenSyncLink) => TokenSyncLink;
  generation?: (real: GenerationReader) => GenerationReader;
  agentOps?: readonly string[];        // the fleet row's ops, instead of the live ready frame's
  caps?: readonly string[];
  os?: NodeOs;
  launcher?: 'real' | 'no-verb' | 'release-lane';
}
interface Harness {
  serverHome: string; fleetHome: string; port: number;
  driver: BoxTokenDriver; holder: Awaited<ReturnType<typeof bootBoxToken>>['holder'];
  spawned: () => number; advance: (ms: number) => void; warnings: string[];
  fleetToken: string; serverToken: string;
  probe: (file: string) => Promise<string>;
  /** release-lane only: the script path of every `bash` the fleet box's PATH started, in order. */
  bashScripts: () => string[];
  /** In memory only, never printed: every value written to a pending file, in order. */
  staged: string[];
  /** release-lane only: the in-send presentations (after the verb exited, before the driver acts on its result). */
  preSend: Array<{ answer: string; presented: 'old' | 'fresh'; promoted: boolean }>;
  releaseTree: string;
  tickUntil: (pred: () => boolean, max?: number) => Promise<void>;
  close: () => Promise<void>;
}

const open: Harness[] = [];
afterEach(async () => { while (open.length > 0) await open.pop()!.close(); });

async function waitFor(pred: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error('waitFor: condition never held');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The bytes `_inst_shim` emits, taken from ccd/ccrc's own `CCRC_SHIM` heredoc text (never hand-copied). */
function shimBytes(): string {
  const src = readFileSync(CCRC, 'utf8');
  const open = "  cat <<'CCRC_SHIM'\n";
  const at = src.indexOf(open);
  expect(at, '_inst_shim moved — re-point this extraction').toBeGreaterThan(-1);
  const from = at + open.length;
  const to = src.indexOf('\nCCRC_SHIM\n', from);
  expect(to, 'the CCRC_SHIM terminator moved').toBeGreaterThan(from);
  return src.slice(from, to + 1);
}

async function harness(o: Opts = {}): Promise<Harness> {
  let offset = 0;
  const clock = (): number => Date.now() + offset;
  const warnings: string[] = [];

  // ── the server box ──
  const serverHome = mkTmp('tok-real-server-');
  const base = testDeps(serverHome);
  mkdirSync(path.dirname(base.cfg.mailTokenPath), { recursive: true });
  writeFileSync(base.cfg.mailTokenPath, `${OLD}\n`, { mode: 0o600 });   // hand-made: adopted, rotation owed
  const db = openCoordDb(join(serverHome, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const boot = await bootBoxToken({ mailTokenPath: base.cfg.mailTokenPath, home: serverHome,
    role: 'server', roleSource: 'recorded', fleetMode: 'remote', now: clock() });
  warnings.push(...boot.warnings);

  // ── the fleet box ──
  const fleetHome = mkTmp('tok-real-fleet-');
  for (const d of ['.cc-sessions', '.cc-limits', '.cc-clips', '.claude', '.ccrc']) mkdirSync(join(fleetHome, d), { recursive: true });
  mkdirSync(join(fleetHome, '.cc-secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(fleetHome, '.ccrc', 'node-id'), `${NODE_ID}\n`);
  const fleetToken = join(fleetHome, '.cc-secrets', 'ccrc-mail.token');
  writeFileSync(fleetToken, `${PREAMBLE}${OLD}\n`, { mode: 0o600 });
  let target = CCRC;
  if (o.launcher === 'no-verb') {
    // A ccrc from before the verb: this checkout's ccrc with its `token)` dispatch line removed, so
    // `ccrc token …` is `_ccrc_usage_die`'s "unknown argument: token" (D-4395's first prefix).
    const old = join(fleetHome, 'old-tree', 'ccd');
    mkdirSync(old, { recursive: true });
    const src = readFileSync(CCRC, 'utf8');
    const line = '  token)   cmd_token "$@" ;;\n';
    expect(src.split(line).length - 1, 'the token dispatch line moved — re-point this fixture').toBe(1);
    target = join(old, 'ccrc');
    writeFileSync(target, src.replace(line, ''), { mode: 0o755 });
  }
  const releaseTree = join(fleetHome, 'ccrc-versions', 'v0.0.1');
  if (o.launcher === 'release-lane') {
    // A release-lane box as `ccrc install` lays it out: the tree under ~/ccrc-versions/<tag>/ccd, ~/ccrc a symlink to
    // it, and ~/.local/bin/ccrc the generated launcher. Copies of this checkout's files; nothing points back at it.
    // `ccrc` sources nothing at load (its check table and shape library are read inside functions), so the verb needs
    // ccrc and ccrc-token-sync only.
    mkdirSync(join(releaseTree, 'ccd'), { recursive: true });
    for (const f of ['ccrc', 'ccrc-token-sync']) {
      copyFileSync(join(REPO, 'ccd', f), join(releaseTree, 'ccd', f));
      chmodSync(join(releaseTree, 'ccd', f), 0o755);
    }
    symlinkSync(join('ccrc-versions', 'v0.0.1'), join(fleetHome, 'ccrc'));
    writeFileSync(join(harnessBin(fleetHome), 'ccrc'), shimBytes(), { mode: 0o755 });
  } else {
    // The launcher the agent's frozen argv names (updateLauncherPath): <home>/.local/bin/ccrc.
    writeFileSync(join(harnessBin(fleetHome), 'ccrc'), `#!/usr/bin/env bash\nexec bash ${JSON.stringify(target)} "$@"\n`, { mode: 0o755 });
  }
  const env = ccrcContainedEnv(fleetHome, process.env, { managers: true, curl: 'loopback' });
  const bashLog = join(fleetHome, 'bash-scripts.log');
  if (o.launcher === 'release-lane') {
    // Records which script each `#!/usr/bin/env bash` start ran (argv[1]), then runs the real bash unchanged. The shim's
    // `exec "$CCRC_SHIPPED"` reaches bash through this, so the log names the tree's ccrc. (`cmd_token` then execs `$BASH`,
    // the real path, so the verb's own hop is not logged; it is `$CCRC_HERE/ccrc-token-sync`, and the tree is all there is.)
    const realBash = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(harnessBin(fleetHome), 'bash'),
      `#!/bin/sh\nprintf '%s\\n' "$1" >> ${JSON.stringify(bashLog)}\nexec ${JSON.stringify(realBash)} "$@"\n`, { mode: 0o755 });
  }
  assertNoRealTool(env, fleetHome);
  const real = makeTokenSyncSpawn(tokenSyncEnv(fleetHome, { PATH: env['PATH'], LANG: 'C' }));
  let spawned = 0;
  const counted = ((...a: Parameters<TokenSyncSpawn>) => { spawned += 1; return real(...a); }) as TokenSyncSpawn;
  const agent: RunningAgent = await bootAgent({ home: fleetHome, projectsRoot: mkTmp('tok-real-projects-') },
    { spawnTokenSync: counted });
  const fleet: ConnectedFleet = connectToAgent(agent.port, { requestTimeoutMs: 60_000 });
  await waitFor(() => fleet.state.connected && fleet.state.agentOps !== undefined);

  // ── the driver ──
  const realLink = tokenSyncLinkOver(fleet.client);
  const realGen = generationReaderOver(fleet.io, join(fleetHome, '.ccrc'), clock);
  const fleetRow = (): GateNode => ({
    nodeId: NODE_ID, nodeIdMeasured: true, label: 'fleet', role: 'fleet', reachable: true,
    os: o.os ?? 'linux', caps: o.caps ?? CAPS, agentOps: o.agentOps ?? fleet.state.agentOps ?? null,
    updateState: 'idle', reportedPhase: null,
  });
  const serverRow: GateNode = {
    nodeId: '0123abcd-0000-4000-8000-000000000002', nodeIdMeasured: true, label: 'server', role: 'server',
    reachable: true, os: 'linux', caps: CAPS, agentOps: null, updateState: 'idle', reportedPhase: null,
  };
  const staged: string[] = [];
  const realStore = fileTokenStore(tokenPaths(base.cfg.mailTokenPath, serverHome));
  const store = { ...realStore, writeValue: (p: string, v: string) => {
    if (path.basename(p).startsWith('mail-pending-')) staged.push(v);
    return realStore.writeValue(p, v);
  } };
  const preSend: Harness['preSend'] = [];
  let probeRef: (file: string) => Promise<string> = () => Promise.resolve('probe: not wired');
  // A pass-through on the release lane (not a stub on the verb path): the real send runs the real verb; once it has
  // exited, and before the driver acts on its result, the fleet file is presented to the server through the launcher.
  const releaseLink = (real: TokenSyncLink): TokenSyncLink => ({ send: async (code) => {
    const result = await real.send(code);
    const presented = valueOf(fleetToken) === OLD ? 'old' : 'fresh';
    preSend.push({ presented, promoted: driver.view().origin === 'rotated', answer: await probeRef(fleetToken) });
    return result;
  } });
  const driver = new BoxTokenDriver({
    store,
    holder: boot.holder,
    link: o.link ? o.link(realLink) : o.launcher === 'release-lane' ? releaseLink(realLink) : realLink,
    generation: o.generation ? o.generation(realGen) : realGen,
    rows: { nodes: () => [serverRow, fleetRow()], linkUp: () => fleet.state.connected, lastReadyAt: () => null },
    env: { fleetMode: 'remote', role: 'server', roleSource: 'recorded', agentEnvMarksFleet: false },
    bothWriter: null,
    now: clock,
    warn: (l) => { warnings.push(l); },
  }, boot);

  // ── the server, on loopback, and the fleet pointed at it ──
  const app: FastifyInstance = await buildServer({ ...base, mailToken: boot.holder, coord, tokenDriver: driver });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  writeFileSync(join(fleetHome, '.ccrc', 'agent.env'), `CCRC_AGENT_TOKEN=irrelevant\nCCRC_SERVER_URL=http://127.0.0.1:${port}\n`);
  writeFileSync(join(fleetHome, 'curl-allow-ports'), `${port}\n`);

  /** The real `ccrc token probe`, ASYNC (the server is in this process). One line back. */
  const probe = (file: string): Promise<string> => new Promise((resolve) => {
    const args = ['token', 'probe', '--file', file, '--url', `http://127.0.0.1:${port}`];
    // On the release lane the probe goes where an operator's would: through ~/.local/bin/ccrc into the tree.
    const child = o.launcher === 'release-lane'
      ? spawn(join(harnessBin(fleetHome), 'ccrc'), args, { env })
      : spawn('bash', [CCRC, ...args], { env });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.stdin.end();
    child.on('error', (e: NodeJS.ErrnoException) => { resolve(`probe: could not start the launcher (${e.code ?? 'error'})`); });
    child.on('close', () => resolve(out.trim()));
  });
  probeRef = probe;
  const tickUntil = async (pred: () => boolean, max = 8): Promise<void> => {
    for (let i = 0; i < max && !pred(); i++) await driver.tick();
    expect(pred(), `the driver never reached the state; view: ${JSON.stringify(driver.view())}`).toBe(true);
  };

  const h: Harness = {
    serverHome, fleetHome, port, driver, holder: boot.holder,
    spawned: () => spawned, advance: (ms) => { offset += ms; }, warnings,
    fleetToken, serverToken: base.cfg.mailTokenPath, probe, tickUntil, releaseTree, staged, preSend,
    bashScripts: () => read(bashLog).split('\n').filter((l) => l !== ''),
    close: async () => {
      driver.stop();
      await fleet.close();
      await agent.close();
      await app.close();
      db.close();
    },
  };
  open.push(h);
  return h;
}

describe('one rotation through the real ccrc token sync (spec §10.2, Figure 4)', () => {
  it('stages, hands out, syncs, promotes on the op result; the old value is accepted through grace and refused after', async () => {
    const h = await harness();
    const before = h.driver.view();
    expect(before.origin).toBe('adopted');
    expect(before.rotationOwed).toBe(true);
    expect(h.holder.match(OLD)).toBe('current');

    // Figure 4, steps 1-13: one rotation, ending in grace.
    await h.tickUntil(() => h.driver.view().phase === 'grace');
    expect(h.spawned()).toBe(1);
    const fresh = valueOf(h.fleetToken);
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(fresh).not.toBe(OLD);
    expect(read(h.fleetToken), 'the fleet file kept its preamble').toBe(`${PREAMBLE}${fresh}\n`);
    expect(read(h.serverToken), 'mail.token is the promoted value, one bare line').toBe(`${fresh}\n`);
    const report = JSON.parse(read(join(h.fleetHome, '.ccrc', 'token-sync.json'))) as Record<string, unknown>;
    expect(report).toMatchObject({ v: 1, result: 'synced', transport: 'http', proof: 'proved' });
    const state = JSON.parse(read(join(h.serverHome, '.ccrc', 'box-token.json'))) as { current: { id: string } };
    expect(read(join(h.fleetHome, '.ccrc', NODE_FILES.tokenGeneration))).toBe(`${state.current.id}\n`);
    expect(report['generation']).toBe(state.current.id);
    const v = h.driver.view();
    expect(v).toMatchObject({ origin: 'rotated', rotationOwed: false, fleetConfirmed: 'current', fleetTransport: 'http', failures: 0 });
    expect(v.lastSync?.word).toBe('synced');
    expect(v.currentSeq).toBeGreaterThan(before.currentSeq ?? 0);
    expect(h.holder.match(fresh)).toBe('current');
    expect(h.holder.match(OLD)).toBe('previous');

    // Grace: the old value still works over HTTP, through the real probe.
    const oldFile = join(h.fleetHome, 'old.token');
    writeFileSync(oldFile, `${OLD}\n`, { mode: 0o600 });
    expect(await h.probe(oldFile)).toBe('probe: 400 accepted');

    // The presentation rule AS PART A DECIDED IT (D-4409 item 6; the brief expected otherwise): the verb's own proof is a
    // presentation of the handed-out value in its PENDING slot, and a promotion of a generation presented there counts as
    // a presentation of the new current (`promotionPresentsCurrent`). So past grace the old value retires on the next
    // tick with no further presentation; grace extends only for a generation never presented (not reachable with the
    // real verb, whose last act is that proof; `token-policy.test.ts` pins the extension).
    h.advance(GRACE_MS + 1_000);
    await h.tickUntil(() => h.driver.view().phase === 'idle');
    expect(h.driver.view().retiredRefused).toBe(true);
    expect(existsSync(join(h.serverHome, '.ccrc', 'mail-previous.token'))).toBe(false);
    expect(read(join(h.serverHome, '.ccrc', 'box-token-retired.json'))).toContain(sha(OLD));

    // Afterwards the old value is refused, and counted as a retired presentation.
    expect(h.holder.match(OLD)).toBeNull();
    expect(await h.probe(oldFile)).toBe('probe: 401 refused');
    expect(h.driver.view().retiredPresented).toBeGreaterThanOrEqual(1);
    expect(await h.probe(h.fleetToken)).toBe('probe: 400 accepted');

    // Nothing printed a value, or its hash.
    const texts = [...h.warnings, JSON.stringify(h.driver.view()), read(join(h.serverHome, '.ccrc', 'box-token.json')),
      read(join(h.fleetHome, '.ccrc', 'token-sync.json'))];
    for (const s of [fresh, sha(fresh), OLD]) {
      for (const t of texts) expect(t.includes(s), 'a value reached a log, the view or a report').toBe(false);
    }
  }, 120_000);

  it('a lost result: the fleet wrote the file, an HTTP presentation never promotes, and a generation read measured after the hand-out does', async () => {
    let blind = true;
    const h = await harness({
      // The result frame is lost AFTER the fleet box really synced (spec §6, "The op result is lost after the fleet wrote the file").
      link: (real) => ({ send: async (code) => { await real.send(code); return { kind: 'lost', why: 'timeout' }; } }),
      generation: (real) => ({ read: async () => (blind ? { read: { kind: 'unreadable' }, measuredAt: Date.now() } : real.read()) }),
    });
    await h.tickUntil(() => h.driver.view().phase === 'handed-out');
    const fresh = valueOf(h.fleetToken);
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(h.holder.match(OLD)).toBe('current');
    expect(h.holder.match(fresh)).toBe('pending0');
    // The fleet's own proof was accepted: no 401 at any point (G3).
    expect(JSON.parse(read(join(h.fleetHome, '.ccrc', 'token-sync.json')))).toMatchObject({ result: 'synced', proof: 'proved' });

    // An HTTP presentation of the handed-out value is not a confirmation.
    expect(await h.probe(h.fleetToken)).toBe('probe: 400 accepted');
    await h.driver.tick();
    expect(h.driver.view().phase).toBe('handed-out');
    expect(h.holder.match(OLD)).toBe('current');

    // The generation read, measured after the hand-out, confirms it.
    blind = false;
    await h.tickUntil(() => h.driver.view().phase === 'grace');
    expect(h.holder.match(fresh)).toBe('current');
    expect(h.holder.match(OLD)).toBe('previous');
    expect(h.spawned()).toBe(1);
    expect(h.driver.view().fleetConfirmed).toBe('current');
  }, 120_000);
});

/** One driver tick with the fleet box's token file presented to the server, as it stands, by the real probe in a loop
 *  WHILE the tick runs (the verb's rename and the server's promotion land inside it) and once more after. */
async function tickWatched(h: Harness, answers: string[]): Promise<void> {
  let done = false;
  const ticking = h.driver.tick().then(() => null, (e: unknown) => e).then((r) => { done = true; return r; });
  while (!done) answers.push(await h.probe(h.fleetToken));
  const failure = await ticking;
  if (failure !== null) throw failure;
  answers.push(await h.probe(h.fleetToken));
}

describe('a release-lane fleet box (coordinator ledger ruling), with the real verb', () => {
  it('release-lane fleet box, remote server: from an adopted hand-made token through the first rotation, no fleet lane answers 401', async () => {
    const h = await harness({ launcher: 'release-lane' });
    const launcher = join(h.fleetHome, '.local', 'bin', 'ccrc');
    const treeCcrc = join(h.fleetHome, 'ccrc', 'ccd', 'ccrc');

    // The box is laid out as `ccrc install` lays out a release-lane box, and nothing on it points at this checkout.
    expect(lstatSync(join(h.fleetHome, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(h.fleetHome, 'ccrc'))).toBe(join('ccrc-versions', 'v0.0.1'));
    expect(read(launcher), '~/.local/bin/ccrc holds exactly the bytes _inst_shim emits').toBe(shimBytes());
    expect(read(launcher)).toContain('exec "$CCRC_SHIPPED" "$@"');
    expect(read(treeCcrc), 'the tree holds a copy of ccd/ccrc').toBe(read(CCRC));
    expect(read(join(h.releaseTree, 'ccd', 'ccrc-token-sync'))).toBe(read(join(REPO, 'ccd', 'ccrc-token-sync')));
    expect(read(launcher).includes(REPO), 'the launcher does not name this checkout').toBe(false);

    // Adopted: the hand-made value is current on the server and the fleet file starts with the same value.
    expect(h.driver.view()).toMatchObject({ origin: 'adopted', rotationOwed: true });
    expect(valueOf(h.fleetToken)).toBe(OLD);
    expect(valueOf(h.serverToken)).toBe(OLD);

    // Every fleet-lane presentation of the fleet file as it stands: before the first tick, during and after each tick,
    // through promotion, grace and the old value's retirement. Not one may be a 401.
    const answers: string[] = [await h.probe(h.fleetToken)];
    await tickWatched(h, answers);
    expect(h.driver.view().phase, `after the first tick; view: ${JSON.stringify(h.driver.view())}`).toBe('grace');
    expect(h.holder.match(valueOf(h.fleetToken))).toBe('current');
    const fresh = valueOf(h.fleetToken);
    expect(fresh).not.toBe(OLD);

    // Grace: the old value is still accepted, through the same real probe.
    const oldFile = join(h.fleetHome, 'old.token');
    writeFileSync(oldFile, `${OLD}\n`, { mode: 0o600 });
    const graceOld = await h.probe(oldFile);
    answers.push(await h.probe(h.fleetToken));
    h.advance(GRACE_MS + 1_000);
    for (let i = 0; i < 8 && h.driver.view().phase !== 'idle'; i++) await tickWatched(h, answers);

    // The 401 claim first, so a regression that refuses the fleet file is named as that, not as a stalled phase.
    expect(graceOld).toBe('probe: 400 accepted');
    expect(answers.length, 'the presentations did not happen').toBeGreaterThanOrEqual(6);
    expect(answers.filter((a) => a !== 'probe: 400 accepted'), 'a fleet-file presentation was not accepted').toEqual([]);
    expect(answers.some((a) => a.includes('401'))).toBe(false);
    expect(h.driver.view().phase).toBe('idle');
    expect(h.driver.view().retiredRefused).toBe(true);

    // The end state: the old value refused, the fleet file's value accepted.
    expect(await h.probe(oldFile)).toBe('probe: 401 refused');
    expect(await h.probe(h.fleetToken)).toBe('probe: 400 accepted');
    expect(valueOf(h.fleetToken)).toBe(fresh);
    expect(valueOf(h.serverToken)).toBe(fresh);

    // The window between the verb's exit and the driver's promotion, presented through the launcher by the pass-through
    // link: the fresh value is on the fleet box by then, and the server (still on OLD as current) accepts it as pending.
    expect(h.preSend.length, 'the in-send presentation did not happen').toBe(1);
    expect(h.preSend[0]).toEqual({ presented: 'fresh', promoted: false, answer: 'probe: 400 accepted' });

    // Nothing printed a value, or its hash (as case 1 does).
    const texts = [...h.warnings, JSON.stringify(h.driver.view()), read(join(h.serverHome, '.ccrc', 'box-token.json')),
      read(join(h.fleetHome, '.ccrc', 'token-sync.json')), h.bashScripts().join('\n'), answers.join('\n')];
    for (const v of [fresh, sha(fresh), OLD, sha(OLD)]) {
      for (const t of texts) expect(t.includes(v), 'a value reached a log, the view, a report or a probe line').toBe(false);
    }

    // The verb that ran was the release tree's copy: one agent spawn, every bash start the fleet box's PATH made was the
    // launcher, then the tree's ccrc (the shim's exec), and nothing named this checkout.
    expect(h.spawned()).toBe(1);
    const scripts = h.bashScripts();
    // Order-free: the agent's verb spawn runs concurrently with the in-tick probes, so two starts may interleave.
    const viaLauncher = scripts.filter((l) => l === launcher).length;
    const viaTree = scripts.filter((l) => l === treeCcrc).length;
    expect(viaLauncher + viaTree, 'every bash start is the launcher or the tree\'s ccrc').toBe(scripts.length);
    expect(viaTree, 'each launcher run execs the tree\'s ccrc').toBe(viaLauncher);
    expect(viaLauncher, 'the verb\'s launch and every probe').toBeGreaterThan(answers.length);
    expect(scripts.some((l) => l.startsWith(join(REPO, 'ccd') + path.sep))).toBe(false);   // (TMPDIR may sit inside the checkout, so REPO itself is no test)
    const report = JSON.parse(read(join(h.fleetHome, '.ccrc', 'token-sync.json'))) as Record<string, unknown>;
    expect(report).toMatchObject({ v: 1, result: 'synced', proof: 'proved' });
  }, 180_000);
});

describe('mixed versions, with the real verb (spec §10.2)', () => {
  it('an agent whose ready lacks token-sync is never sent the op, and the old value stays current', async () => {
    const h = await harness({ agentOps: ['update'] });
    const fleetBefore = read(h.fleetToken);
    const serverBefore = read(h.serverToken);
    await h.driver.tick();
    await h.driver.tick();
    expect(h.spawned()).toBe(0);
    expect(h.driver.view()).toMatchObject({ hold: 'agent-predates-op', failures: 0 });
    expect(h.holder.match(OLD)).toBe('current');
    expect(read(h.fleetToken)).toBe(fleetBefore);
    expect(read(h.serverToken)).toBe(serverBefore);
    expect(existsSync(join(h.fleetHome, '.ccrc', NODE_FILES.tokenGeneration))).toBe(false);
  }, 120_000);

  it('an agent with the op whose ccrc lacks the verb answers spawn-failed: the verb-missing hold, never a failure, nothing changed', async () => {
    // A deploy.sh-placed node: no caps file read (os unknown, no caps), so the op itself probes (spec §9.2).
    const h = await harness({ launcher: 'no-verb', caps: [], os: 'unknown' });
    const fleetBefore = read(h.fleetToken);
    const serverBefore = read(h.serverToken);
    await h.tickUntil(() => h.driver.view().hold === 'verb-missing');
    expect(h.spawned()).toBe(1);
    expect(h.driver.view()).toMatchObject({ failures: 0, lastFailure: null, banner: false });
    expect(h.holder.match(OLD)).toBe('current');
    expect(read(h.fleetToken)).toBe(fleetBefore);
    expect(read(h.serverToken)).toBe(serverBefore);
    expect(existsSync(join(h.fleetHome, '.ccrc', NODE_FILES.tokenGeneration))).toBe(false);
    expect(existsSync(join(h.fleetHome, '.ccrc', 'token-sync.json'))).toBe(false);
    // What Part A does with the generation it staged for the lost send: it is DROPPED (the refusal is not a failure, the
    // pending entry and its file go, and its sequence number is spent: nextSeq 3 after seq 2). The holder never accepts it.
    const state = JSON.parse(read(join(h.serverHome, '.ccrc', 'box-token.json'))) as { pending: unknown[]; nextSeq: number; hold: string };
    expect(state).toMatchObject({ pending: [], hold: 'verb-missing', nextSeq: 3 });
    expect(readdirSync(join(h.serverHome, '.ccrc')).filter((f) => f.startsWith('mail-pending-'))).toEqual([]);
    expect(h.staged.length, 'one generation was staged for the one send').toBe(1);
    expect(h.holder.match(h.staged[0]!), 'the dropped generation is accepted on no slot').toBeNull();
    expect(h.holder.match(OLD)).toBe('current');
    // The hold is re-probed on a fresh ready or hourly, not on the next tick.
    await h.driver.tick();
    expect(h.spawned()).toBe(1);
  }, 120_000);
});
