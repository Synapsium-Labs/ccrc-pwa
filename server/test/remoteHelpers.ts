import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startAgent, type AgentOpts, type RunningAgent } from '../../agent/src/server.js';
import { connectFleet, type ConnectedFleet, type RemoteFleetConfig } from '../src/remote/client.js';

/** Test-only helpers for the RemoteFleet client suite — boots a real
 *  in-process ccrc-agent against a tmp fixture $HOME, and connects a real
 *  `connectFleet` client to it over a real loopback WS. */

export const TOKEN = 'remote-fleet-test-token';

export interface RemoteFixture { home: string; projectsRoot: string }

export function makeFixture(): RemoteFixture {
  const home = mkdtempSync(path.join(tmpdir(), 'ccrc-remote-home-'));
  for (const dir of ['.cc-sessions', '.cc-limits', '.cc-clips', '.claude']) {
    mkdirSync(path.join(home, dir), { recursive: true });
  }
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'ccrc-remote-projects-'));
  return { home, projectsRoot };
}

export async function bootAgent(fixture: RemoteFixture, extra: Partial<AgentOpts> = {}): Promise<RunningAgent> {
  return startAgent({
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    home: fixture.home,
    projectsRoot: fixture.projectsRoot,
    helloTimeoutMs: 300,
    ...extra,
  });
}

/** `reconnectMinMs`/`reconnectMaxMs`/`heartbeatMs` default fast — real
 *  values (1s/30s/15s) would make the test suite glacial. Override
 *  `heartbeatMs` up when a test doesn't want heartbeat misses interfering. */
export function connectToAgent(port: number, extra: Partial<RemoteFleetConfig> = {}): ConnectedFleet {
  return connectFleet({
    url: `ws://127.0.0.1:${port}`,
    token: TOKEN,
    reconnectMinMs: 30,
    reconnectMaxMs: 100,
    heartbeatMs: 60_000,
    requestTimeoutMs: 2_000,
    ...extra,
  });
}
