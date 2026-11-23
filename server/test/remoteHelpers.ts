import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startAgent, type AgentOpts, type RunningAgent } from '../../agent/src/server.js';
import { connectFleet, type ConnectedFleet, type RemoteFleetConfig } from '../src/remote/client.js';
import type { PeerSeams } from '../src/isolationFacts.js';
import { mkTmp } from './tmpHelpers.js';

/** Test-only helpers for the RemoteFleet client suite — boots a real
 *  in-process ccrc-agent against a tmp fixture $HOME, and connects a real
 *  `connectFleet` client to it over a real loopback WS. */

export const TOKEN = 'remote-fleet-test-token';

export interface RemoteFixture { home: string; projectsRoot: string }

export function makeFixture(): RemoteFixture {
  const home = mkTmp('ccrc-remote-home-');
  for (const dir of ['.cc-sessions', '.cc-limits', '.cc-clips', '.claude']) {
    mkdirSync(path.join(home, dir), { recursive: true });
  }
  const projectsRoot = mkTmp('ccrc-remote-projects-');
  return { home, projectsRoot };
}

/** The synthetic ids a booted agent reports (Overlord W1, the isolation word): `b` for a host that is not the server's.
 *  No test reads the live host's machine id or boot id. */
export const AGENT_MACHINE_ID = 'b'.repeat(32);
export const AGENT_BOOT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** A synthetic `/proc` and `/etc` holding the two ids, under the run's temp root, for an agent's `hostRoots`. */
export function hostRootsFor(machine: string, boot: string): { procRoot: string; etcRoot: string; platform: string } {
  const root = mkTmp('ccrc-remote-hostroots-');
  mkdirSync(path.join(root, 'etc'), { recursive: true });
  mkdirSync(path.join(root, 'proc/sys/kernel/random'), { recursive: true });
  writeFileSync(path.join(root, 'etc/machine-id'), `${machine}\n`);
  writeFileSync(path.join(root, 'proc/sys/kernel/random/boot_id'), `${boot}\n`);
  return { procRoot: path.join(root, 'proc'), etcRoot: path.join(root, 'etc'), platform: 'linux' };
}

/** The client's peer measurement over nothing of the live host (Overlord W1, the isolation word): no interface
 *  addresses, and socket tables that cannot be read, so a loopback peer reads `local` with its uid `unmeasured`. */
export const TEST_PEER_SEAMS: PeerSeams = { interfaceAddresses: () => [], tables: () => 'unmeasured' };

export async function bootAgent(fixture: RemoteFixture, extra: Partial<AgentOpts> = {}): Promise<RunningAgent> {
  return startAgent({
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    home: fixture.home,
    projectsRoot: fixture.projectsRoot,
    helloTimeoutMs: 300,
    // Overlord W1 (R10): the ready frame's `overlord-history` check reads the platform; Linux here, so every runner's real-agent
    // `ops` pins see one list.
    historySeams: { platform: 'linux' },
    hostRoots: hostRootsFor(AGENT_MACHINE_ID, AGENT_BOOT_ID),
    ...extra,
  });
}

/** `reconnectMinMs`/`reconnectMaxMs` default fast, so a reconnect row is quick; `heartbeatMs` defaults SLOW
 *  (60 s), so no row sees a heartbeat miss it did not ask for. Pass `heartbeatMs` down to test the heartbeat
 *  (remote-liveness.test.ts's W27-L8) and `connectTimeoutMs` to test the deadline before ready. */
export function connectToAgent(port: number, extra: Partial<RemoteFleetConfig> = {}): ConnectedFleet {
  return connectFleet({
    url: `ws://127.0.0.1:${port}`,
    token: TOKEN,
    reconnectMinMs: 30,
    reconnectMaxMs: 100,
    heartbeatMs: 60_000,
    requestTimeoutMs: 2_000,
    peerSeams: TEST_PEER_SEAMS,
    ...extra,
  });
}
