// The host report on the agent's ready frame (Overlord W1, plan `w1-isolation.md` Task 2, question 13): the agent's uid and
// two digests of its host ids keyed by the bearer. Synthetic trees under the run's temp root only: no case reads the live
// host's ids, and nothing is printed.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunningAgent } from '../src/server.js';
import type { AgentReady } from '../../shared/agent-protocol.js';
import { hostDigest } from '../../shared/host-identity.mjs';
import { readHostReport } from '../../shared/isolation.js';
import { boot, makeFixture, TestClient, TOKEN } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const MACHINE = 'b'.repeat(32);
const BOOT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function roots(): { procRoot: string; etcRoot: string; platform: string } {
  const root = mkTmp('ccrc-agent-hostroots-');
  mkdirSync(path.join(root, 'etc'), { recursive: true });
  mkdirSync(path.join(root, 'proc/sys/kernel/random'), { recursive: true });
  writeFileSync(path.join(root, 'etc/machine-id'), `${MACHINE}\n`);
  writeFileSync(path.join(root, 'proc/sys/kernel/random/boot_id'), `${BOOT}\n`);
  return { procRoot: path.join(root, 'proc'), etcRoot: path.join(root, 'etc'), platform: 'linux' };
}

describe('the ready frame carries the host report', () => {
  let agent: RunningAgent | undefined;
  const clients: TestClient[] = [];
  const connect = (port: number): TestClient => { const c = new TestClient(port); clients.push(c); return c; };
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    vi.restoreAllMocks();
  });

  it('sends host, which readHostReport accepts, with the digests of the synthetic ids under the bearer', async () => {
    agent = await boot(makeFixture(), { hostRoots: roots() });
    const ready = await connect(agent.port).hello() as AgentReady;
    const uid = process.getuid?.();
    expect(ready.host).toEqual({
      uid: uid === undefined ? 'unmeasured' : uid,
      machine: hostDigest(TOKEN, 'machine', MACHINE),
      boot: hostDigest(TOKEN, 'boot', BOOT),
    });
    expect(readHostReport(ready.host)).toEqual(ready.host);
  });

  it('a second bearer gives other digests of the same ids', async () => {
    const token = 'another-bearer-for-this-case';
    agent = await boot(makeFixture(), { hostRoots: roots(), token });
    const ready = await connect(agent.port).hello(token) as AgentReady;
    expect(ready.host?.machine).toBe(hostDigest(token, 'machine', MACHINE));
    expect(ready.host?.machine).not.toBe(hostDigest(TOKEN, 'machine', MACHINE));
    expect(ready.host?.boot).not.toBe(hostDigest(TOKEN, 'boot', BOOT));
  });

  it('sends unmeasured ids where the synthetic tree has none, and a platform that is not Linux reads both unmeasured', async () => {
    const empty = mkTmp('ccrc-agent-hostroots-empty-');
    agent = await boot(makeFixture(), { hostRoots: { procRoot: empty, etcRoot: empty, platform: 'linux' } });
    const a = await connect(agent.port).hello() as AgentReady;
    expect([a.host?.machine, a.host?.boot]).toEqual(['unmeasured', 'unmeasured']);
    await agent.close();
    agent = await boot(makeFixture(), { hostRoots: { ...roots(), platform: 'darwin' } });
    const b = await connect(agent.port).hello() as AgentReady;
    expect([b.host?.machine, b.host?.boot]).toEqual(['unmeasured', 'unmeasured']);
  });

  it('prints nothing while it measures and sends', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    agent = await boot(makeFixture(), { hostRoots: roots() });
    await connect(agent.port).hello();
    for (const s of spies) {
      for (const call of s.mock.calls) {
        const line = call.map(String).join(' ');
        expect(line).not.toMatch(/[0-9a-f]{64}/);
        expect(line).not.toContain(MACHINE);
        expect(line).not.toContain(BOOT);
      }
    }
  });
});
