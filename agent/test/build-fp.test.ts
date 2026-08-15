// The build stamp the agent reports on its `ready` frame — what the FLEET
// HOST is running, stated by the fleet host itself.
//
// Until this existed the server had no way to learn it. The link between the
// two boxes carried `ccdVerbs` and `rosterFp` and nothing else, so a deploy
// that landed on one box and not the other was invisible: the server's own
// `/health` reports the server's sha, and the fleet host's sha was legible
// only by ssh'ing there and reading `~/.ccrc/build.json` by hand. Every
// symptom of that skew (a `ccd` verb the server thinks exists, a hook writing
// a field the server does not read) shows up as a behaviour, never as a
// version.
//
// What is read is `~/.ccrc/build.json` — the stamp `deploy/deploy.sh`'s
// `stamp_build` installs on the AGENT lane, after the remote build that can
// fail and before the restart that makes it live. It is the same file `ccd
// version` reads, so this frame answers with exactly what a human on that box
// would be told.
//
// The parse is `parseBuildInfo` (`shared/buildinfo.ts`) — the same validator
// the server applies to its OWN stamp, imported rather than restated, so the
// two boxes can never come to disagree about what a well-formed stamp is
// while comparing their shas.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import type { AgentReady } from '../../shared/agent-protocol.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

/** Writes `~/.ccrc/build.json` exactly as `stamp_build` does — raw text, so a
 *  test can hand it something that is not a stamp at all. */
function writeStamp(home: string, body: string): void {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'build.json'), body);
}

const STAMP = { sha: 'deadbeef', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false };

describe('the ready frame carries the box\'s own build stamp', () => {
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

  it('reports its own build stamp on the authenticated ready frame', async () => {
    fixture = makeFixture();
    writeStamp(fixture.home, `${JSON.stringify(STAMP)}\n`);
    agent = await boot(fixture);
    client = new TestClient(agent.port);

    // Whole-object equality, not `.sha` alone: `dirty` is the field that stops
    // a working-tree deploy masquerading as the clean sha it names, and it is
    // the one a narrower assertion would let a reader quietly drop.
    expect((await client.hello() as AgentReady).build).toEqual(STAMP);
  });

  it('omits the field entirely when the box carries no stamp — absence is not a lie', async () => {
    // Not an empty object, not a null: `AgentReady` declares it optional and
    // the server's reader turns absence into "no evidence". A dev checkout, a
    // box that was never deployed to, and an older agent that predates this
    // field are all the same condition on the wire, and none of them is
    // "the fleet host is running a different build".
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);

    const ready = await client.hello() as AgentReady;
    expect(ready.t).toBe('ready');
    expect('build' in ready).toBe(false);
  });

  it('omits the field when the stamp is unparseable, rather than forwarding garbage', async () => {
    fixture = makeFixture();
    writeStamp(fixture.home, '{');
    agent = await boot(fixture);
    client = new TestClient(agent.port);

    expect('build' in (await client.hello() as AgentReady)).toBe(false);
  });

  it('omits the field when the stamp is well-formed JSON of the wrong shape', async () => {
    // The half-stamp is the interesting one, and the reason the validation
    // lives in `parseBuildInfo` rather than in a `JSON.parse` and a cast: a
    // torn or hand-edited `build.json` parses fine and yields an object with
    // no `sha` at all, or a numeric one. Forwarding that puts a
    // `build.sha === undefined` on the wire, which the comparison downstream
    // would read as a sha that differs from the server's — an alarm invented
    // out of a file this box could not read.
    fixture = makeFixture();
    writeStamp(fixture.home, JSON.stringify({ sha: 42, ref: 'main', builtAt: 'x', dirty: false }));
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    expect('build' in (await client.hello() as AgentReady)).toBe(false);

    // ...and a stamp missing a field outright, which is what a truncated write
    // leaves behind.
    client.ws.close();
    writeStamp(fixture.home, JSON.stringify({ ref: 'main', builtAt: 'x', dirty: false }));
    client = new TestClient(agent.port);
    expect('build' in (await client.hello() as AgentReady)).toBe(false);
  });

  it('re-reads on every connection, so a redeploy is picked up without an agent restart', async () => {
    // Read fresh per `ready`, never cached at boot: the agent unit is restarted
    // by its own deploy lane, but the SERVER's link is the thing that reconnects
    // afterwards, and a stamp cached in a process that outlived the stamp file
    // would answer with the sha the box used to run.
    fixture = makeFixture();
    writeStamp(fixture.home, JSON.stringify(STAMP));
    agent = await boot(fixture);

    const first = new TestClient(agent.port);
    expect((await first.hello() as AgentReady).build).toEqual(STAMP);
    first.ws.close();

    const NEXT = { ...STAMP, sha: 'cafebabe', dirty: true };
    writeStamp(fixture.home, JSON.stringify(NEXT));
    client = new TestClient(agent.port);
    expect((await client.hello() as AgentReady).build).toEqual(NEXT);
  });
});
