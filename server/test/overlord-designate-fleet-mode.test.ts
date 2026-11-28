// Overlord W1, overlord-v1 fix round 1 (call 1941, review 4172 F1): Start the Overlord's history arm is decided by the configured
// fleet mode, booted the way the composition root builds the server: the real `buildServer`, sign-in armed with a real session and
// a real step-up, a real coordination store, and the fleet state shaped as `index.ts` builds it in local mode (connected, no agent
// ops) or as a remote link reports it. A fixture box lacks what a real one has (the agent's pool answer, ccd's words), so Start
// still refuses `capability-missing` here; each case reads the one thing this arm decides: whether `needs` names the history op.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { FleetState } from '../src/fleetstate.js';
import type { FleetMode } from '../src/config.js';
import { OVERLORD_HISTORY_OP } from '../../shared/agent-protocol.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'a test passphrase for the fleet mode suite';
const ORIGIN = 'http://localhost:7788';
const PAYLOAD = { model: 'opus', accountPools: { pools: ['pool-a', 'pool-b'], untagged: false } };

let app: FastifyInstance | null = null;
const stores: CoordStore[] = [];
afterEach(async () => {
  await app?.close();
  app = null;
  for (const s of stores.splice(0)) if (s.db.isOpen) s.db.close();
  removeTmpFixtures();
});

/** `index.ts`'s local-mode fleet state: this box, connected, no other box's build or roster, and no agent ops (no agent). */
const localState = (): FleetState => ({ connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null });
/** A remote link's state as the fleet client keeps it: its connection and the ops its agent advertised on `ready`. */
const remoteState = (connected: boolean, agentOps?: readonly string[]): FleetState =>
  ({ connected, downSince: connected ? null : 1, ccdVerbs: null, rosterFp: null, build: null, ...(agentOps === undefined ? {} : { agentOps }) });

async function startNeeds(fleetMode: FleetMode, fleetState: FleetState): Promise<{ status: number; error: unknown; needs: readonly string[] }> {
  const home = mkTmp('ccrc-overlord-fleet-mode-');
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  stores.push(coord);
  const base = testDeps(home);
  // `index.ts` wires the authority journal beside the store; a refused start appends nothing, so this one refuses every append.
  const journal = { appendInTx: () => ({ ok: false, error: 'journal-unreadable', detail: 'this suite appends nothing' }) } as unknown as NonNullable<Deps['overlordAuthority']>;
  const deps: Deps = {
    ...base, coord, fleetState, overlordAuthority: journal,
    cfg: { ...base.cfg, ccrcDir, fleetMode, authEnabled: true, cookieSecure: false, rpId: 'localhost', origin: ORIGIN },
  };
  app = await buildServer(deps, new Bus());
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE }, headers: { 'user-agent': 'a test phone', origin: ORIGIN } });
  expect(login.statusCode, login.body).toBe(204);
  const set = login.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  const cookie = line.slice(0, line.indexOf(';'));
  const up = await app.inject({ method: 'POST', url: '/api/auth/step-up/passphrase', payload: { passphrase: PASSPHRASE }, headers: { cookie, origin: ORIGIN } });
  expect(up.statusCode, up.body).toBeLessThan(300);
  const res = await app.inject({ method: 'POST', url: '/api/overlord/designate', payload: PAYLOAD, headers: { cookie, origin: ORIGIN } });
  const body = res.json() as { error?: unknown; needs?: readonly string[] };
  return { status: res.statusCode, error: body.error, needs: body.needs ?? [] };
}

describe('Start the Overlord: the history arm reads the configured fleet mode (call 1941)', () => {
  it('local mode, over index.ts\'s own fleet state: the history op is not asked', async () => {
    const r = await startNeeds('local', localState());
    expect(r.error).toBe('capability-missing');
    expect(r.needs.length).toBeGreaterThan(0);
    expect(r.needs).not.toContain(OVERLORD_HISTORY_OP);
  });

  it('remote mode, one connected agent that serves the op: the history op is not missing', async () => {
    const r = await startNeeds('remote', remoteState(true, [OVERLORD_HISTORY_OP]));
    expect(r.error).toBe('capability-missing');
    expect(r.needs).not.toContain(OVERLORD_HISTORY_OP);
  });

  it('remote mode, a connected agent that does not advertise the op: the history op is missing', async () => {
    for (const ops of [[], undefined]) {
      const r = await startNeeds('remote', remoteState(true, ops));
      expect(r.error, JSON.stringify(ops)).toBe('capability-missing');
      expect(r.needs, JSON.stringify(ops)).toContain(OVERLORD_HISTORY_OP);
      await app?.close(); app = null;
    }
  });

  it('remote mode, the link down: the history op is missing', async () => {
    const r = await startNeeds('remote', remoteState(false, [OVERLORD_HISTORY_OP]));
    expect(r.error).toBe('capability-missing');
    expect(r.needs).toContain(OVERLORD_HISTORY_OP);
  });
});
