import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

interface CapsRes { ok: boolean; verbs?: string[]; err?: string }

/** Writes the ccd the agent will actually exec: `resolveSpawnCmd` resolves
 *  `ccd` against `home`, never PATH, so a stub here is the whole fake. */
function writeCcd(home: string, body: string): void {
  const dir = path.join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ccd');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

describe('caps op', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;

  afterEach(async () => {
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('answers with the verbs ccd currently prints, not the ones it printed at boot', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start\necho stop');
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    expect(await client.req<CapsRes>(1, { op: 'caps' }))
      .toMatchObject({ ok: true, verbs: ['start', 'stop'] });

    // A new ccd lands under the running agent — the case the outage was.
    writeCcd(fixture.home, 'echo start\necho stop\necho ws-rename');
    expect(await client.req<CapsRes>(2, { op: 'caps' }))
      .toMatchObject({ ok: true, verbs: ['start', 'stop', 'ws-rename'] });
  });

  it('a caps read that fails yields [] rather than keeping a list that no longer holds', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start');
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    expect(await client.req<CapsRes>(1, { op: 'caps' })).toMatchObject({ verbs: ['start'] });

    writeCcd(fixture.home, 'exit 1');
    expect(await client.req<CapsRes>(2, { op: 'caps' })).toMatchObject({ verbs: [] });
  });

  it('an unchanged ccd is not re-execed', async () => {
    fixture = makeFixture();
    // Appends a line per invocation, so the file's length counts execs.
    const marker = path.join(fixture.home, 'execs');
    writeCcd(fixture.home, `echo x >> ${marker}\necho start`);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    await client.req<CapsRes>(1, { op: 'caps' });
    const after1 = readFileSync(marker, 'utf8').length;
    await client.req<CapsRes>(2, { op: 'caps' });
    expect(readFileSync(marker, 'utf8').length).toBe(after1);
  });
});
