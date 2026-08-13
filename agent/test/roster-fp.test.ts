// The `rosterFp` the agent reports on its `ready` frame — the digest of the
// roster projection THIS box's `ccd` actually sources.
//
// The server compares it against the digest of the projection its own roster
// produces (`rosterAgreement`, server/src/fleetstate.ts). Until this existed,
// the two boxes' account lists could disagree indefinitely with nothing
// noticing: `~/.ccrc/accounts.json` is user-owned and never overwritten by a
// deploy, so an account added to one box and not the other is a hand-edit
// away, and the symptom is a session attributed to the wrong account rather
// than an error anyone can search for.
//
// What is digested is the INSTALLED `accounts.sh`, not `accounts.json`. That
// is the stricter choice and the reason for it is here rather than in a
// comment on the field: nothing on this box READS accounts.json at runtime.
// `ccd` sources the generated projection; the deploy is what turns one into
// the other. A box whose accounts.json was hand-edited and never redeployed
// has two JSON files that agree and a `ccd` that behaves like neither.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { bodyDigest, markGenerated } from '../../shared/mark.mjs';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

interface Ready { t: string; v: number; ccdVerbs?: string[]; rosterFp?: string }

/** Writes `~/.ccrc/accounts.sh` exactly as a deploy does — body through
 *  `markGenerated`, so the file carries the provenance marker a real one has
 *  and the digest under test is proven to be marker-independent. */
function writeProjection(home: string, body: string): void {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), markGenerated(body));
}

const BODY = '#!/usr/bin/env bash\nCCRC_ACCOUNTS=(claude zeta)\nCCRC_UPSTREAM=claude\n';

describe('the ready frame carries a roster fingerprint', () => {
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

  it('digests the installed projection, ignoring the provenance marker line', async () => {
    fixture = makeFixture();
    writeProjection(fixture.home, BODY);
    agent = await boot(fixture);
    client = new TestClient(agent.port);

    // `bodyDigest(BODY)` — the BODY, not the marked file. The server computes
    // its side as `bodyDigest(generateAccountsSh(roster))`, which never has a
    // marker at all, so the two agree only because `bodyDigest` strips one.
    expect((await client.hello() as Ready).rosterFp).toBe(bodyDigest(BODY));
  });

  it('omits the field entirely on a box with no projection', async () => {
    // Not an empty string, not a null: `AgentReady` declares it optional and
    // the server's reader turns absence into "no evidence". An agent must
    // never let its own inability to read a file become an alarm over there.
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);

    const ready = await client.hello() as Ready;
    expect(ready.t).toBe('ready');
    expect('rosterFp' in ready).toBe(false);
  });

  it('re-reads on every connection, so a redeploy is picked up without a restart', async () => {
    fixture = makeFixture();
    writeProjection(fixture.home, BODY);
    agent = await boot(fixture);

    const first = new TestClient(agent.port);
    expect((await first.hello() as Ready).rosterFp).toBe(bodyDigest(BODY));
    first.ws.close();

    const CHANGED = `${BODY}CCRC_MEASURED=(claude)\n`;
    writeProjection(fixture.home, CHANGED);
    client = new TestClient(agent.port);
    expect((await client.hello() as Ready).rosterFp).toBe(bodyDigest(CHANGED));
  });

  it('reports the digest of what the file NOW says, not what its marker claims', async () => {
    // The difference between this and `verifyMarker`. A hand-edited
    // `accounts.sh` still carries the marker of the body it used to have, so
    // trusting the embedded digest would report agreement with a box running
    // different bash. Re-hashing the body is what makes a hand-edit visible.
    fixture = makeFixture();
    writeProjection(fixture.home, BODY);
    const edited = `${markGenerated(BODY)}CCRC_HOME_ABLE=(zeta)\n`;
    writeFileSync(path.join(fixture.home, '.ccrc', 'accounts.sh'), edited);
    agent = await boot(fixture);
    client = new TestClient(agent.port);

    const fp = (await client.hello() as Ready).rosterFp;
    expect(fp).not.toBe(bodyDigest(BODY));
    expect(fp).toBe(bodyDigest(edited));
  });
});
