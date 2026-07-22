import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

describe('ccrc-agent auth', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;

  afterEach(async () => {
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('never binds 0.0.0.0', async () => {
    fixture = makeFixture();
    await expect(boot(fixture, { host: '0.0.0.0' })).rejects.toThrow(/0\.0\.0\.0/);
  });

  it('never binds ::', async () => {
    fixture = makeFixture();
    await expect(boot(fixture, { host: '::' })).rejects.toThrow(/::/);
  });

  it('closes the socket with code 4401 if no hello arrives before the timeout', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    const client = new TestClient(agent.port);
    await client.opened();
    const closed = client.closed();
    // deliberately send nothing
    const { code } = await closed;
    expect(code).toBe(4401);
  });

  it('closes the socket with code 4401 on a wrong token', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    const client = new TestClient(agent.port);
    await client.opened();
    client.send({ t: 'hello', token: 'wrong-token' });
    const { code } = await client.closed();
    expect(code).toBe(4401);
  });

  it('replies ready and accepts requests after a correct hello', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    const client = new TestClient(agent.port);
    await client.hello();
    client.send({ t: 'ping' });
    const pong = await client.waitFor((m) => (m as { t?: unknown }).t === 'pong');
    expect(pong).toEqual({ t: 'pong' });
    client.ws.close();
  });

  it('rejects a hello with the wrong token shape as unauthorized (4401), not a crash', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    const client = new TestClient(agent.port);
    await client.opened();
    client.send({ t: 'not-hello' });
    const { code } = await client.closed();
    expect(code).toBe(4401);
  });

  it('closes the connection on malformed JSON after auth', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    const client = new TestClient(agent.port);
    await client.hello();
    const closed = client.closed();
    client.ws.send('{not valid json');
    await closed;
  });

  it('allows multiple concurrent authenticated clients', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    const a = new TestClient(agent.port);
    const b = new TestClient(agent.port);
    await Promise.all([a.hello(), b.hello()]);
    a.send({ t: 'ping' });
    b.send({ t: 'ping' });
    await Promise.all([
      a.waitFor((m) => (m as { t?: unknown }).t === 'pong'),
      b.waitFor((m) => (m as { t?: unknown }).t === 'pong'),
    ]);
    a.ws.close();
    b.ws.close();
  });
});
